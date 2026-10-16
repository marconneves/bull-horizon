import { JsonService } from '../services/json';
import { TieredSeries } from './tiered-series';
import { histogramBand, mergeSparseHistograms } from './histogram';
import type { TSparseHistogram } from './histogram';
import { terminalAttempts } from '../shared/attempt';
import { readTrace } from '../flow/trace';
import {
  FLOW_KEY_MAX_CHARS,
  FLOW_TRACE_ID_PATTERN,
  FLOW_TRACE_VERSION,
  clipRef,
  clipText,
  hasOwn,
  readPath,
} from '../flow/contract';
import { resolveFlowStep } from '../flow/definition';
import { QueueProvider } from '../typings/gql';
import type { FlowTraceV1, FlowsOptions } from '../flow/contract';
import type { NormalizedFlow, NormalizedFlowStep } from '../flow/definition';
import type { Job, JobId, Queue, RedisClient } from '../queue';
import type { MetricsConfig } from '../typings/config';

/** Bands (ms) of the three histograms. Index `length` = overflow. Changing them needs a new `h`. */
export const FLOW_DURATION_BOUNDS_MS = [
  10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000,
  120000, 300000, 600000, 1200000, 1800000, 3600000, 7200000,
];
export const FLOW_HIST_VERSION = 1;
export const FLOW_BANDS = FLOW_DURATION_BOUNDS_MS.length + 1;
/** Edge keys per point; the excess folds into `(other)`. */
export const FLOW_MAX_EDGES = 64;
export const FLOW_EDGE_KEY_CHARS = 160;
/** Step keys read per point (config steps + `(queue)`). */
export const FLOW_MAX_POINT_STEPS = 128;
export const FLOW_OTHER_KEY = '(other)';
/** Edge source when the parent job's step could not be resolved. */
export const FLOW_UNKNOWN_STEP = '(unknown)';
/** `lost` of a queue holding several steps (the event has no job name). */
export const FLOW_QUEUE_STEP = '(queue)';
/** Distinct business keys (key + aliases) indexed per trace. */
export const FLOW_MAX_KEYS_PER_TRACE = 4;
/** `getJob` calls to find a parent declared as predecessor. */
const PARENT_LOOKUP_MAX = 8;
export const FLOW_ERROR_CHARS = 160;
/** Index separator and markers (`~` sorts after the base64 queue ids). */
const SEP = '\u0000';
const KEY_MARK = '~k';
const TRUNCATED_MARK = '~x';

export type TFlowStepPoint = {
  c: number;
  f: number;
  lost: number;
  untraced: number;
  retried: number;
  /** Processing time. */
  pr: TSparseHistogram;
  prSum: number;
  prMax: number;
  /** Wait in queue (first attempt only). */
  wq: TSparseHistogram;
  wqSum: number;
  wqN: number;
  wqMax: number;
};

export type TFlowPoint = {
  timestamp: number;
  windowMs: number;
  h: 1;
  /** Key = step id (config), plus `(queue)` for lost events. */
  steps: Record<string, TFlowStepPoint>;
  e2e: TSparseHistogram;
  e2eN: number;
  e2eSum: number;
  e2eMax: number;
  /** Terminal events of the entry step(s). */
  entries: number;
  /** End-to-end completions. */
  done: number;
  /** Passes through the onError step. */
  errors: number;
  /** 'from>to'; from may be '(unknown)'. */
  edges: Record<string, number>;
};

/** Index entry of one job of a trace (metadata only, never payload). */
export type TFlowTraceJob = {
  /** step, queueId, jobId, terminal attempt. */
  s: string;
  q: string;
  j: string;
  a: number;
  st: 'c' | 'f';
  /** enqueued, started, finished. */
  t0: number;
  t1: number | null;
  t2: number | null;
  /** [queueId, jobId] of the parent ('' when its queue is unknown). */
  p?: [string, string];
  /** failedReason, first line, 160 chars. */
  e?: string;
};

export type TFlowTraceMeta = { k?: string; s: number };

export type TFlowTraceRead = {
  jobs: TFlowTraceJob[];
  keys: string[];
  truncated: boolean;
};

const emptyRecord = <T>(): Record<string, T> =>
  Object.create(null) as Record<string, T>;

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
const optNum = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const emptyFlowStepPoint = (): TFlowStepPoint => ({
  c: 0,
  f: 0,
  lost: 0,
  untraced: 0,
  retried: 0,
  pr: emptyRecord(),
  prSum: 0,
  prMax: 0,
  wq: emptyRecord(),
  wqSum: 0,
  wqN: 0,
  wqMax: 0,
});

export const emptyFlowPoint = (timestamp = 0, windowMs = 0): TFlowPoint => ({
  timestamp,
  windowMs,
  h: FLOW_HIST_VERSION,
  steps: emptyRecord(),
  e2e: emptyRecord(),
  e2eN: 0,
  e2eSum: 0,
  e2eMax: 0,
  entries: 0,
  done: 0,
  errors: 0,
  edges: emptyRecord(),
});

/** A step point read back from JSON: every field sanitized. */
export function readFlowStepPoint(raw: unknown): TFlowStepPoint {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const field = (key: string) => (hasOwn(value, key) ? value[key] : undefined);
  return {
    c: num(field('c')),
    f: num(field('f')),
    lost: num(field('lost')),
    untraced: num(field('untraced')),
    retried: num(field('retried')),
    pr: mergeSparseHistograms(field('pr'), undefined, FLOW_BANDS),
    prSum: num(field('prSum')),
    prMax: num(field('prMax')),
    wq: mergeSparseHistograms(field('wq'), undefined, FLOW_BANDS),
    wqSum: num(field('wqSum')),
    wqN: num(field('wqN')),
    wqMax: num(field('wqMax')),
  };
}

function mergeStepPoints(a: unknown, b: unknown): TFlowStepPoint {
  const x = readFlowStepPoint(a);
  const y = readFlowStepPoint(b);
  return {
    c: x.c + y.c,
    f: x.f + y.f,
    lost: x.lost + y.lost,
    untraced: x.untraced + y.untraced,
    retried: x.retried + y.retried,
    pr: mergeSparseHistograms(x.pr, y.pr, FLOW_BANDS),
    prSum: x.prSum + y.prSum,
    prMax: Math.max(x.prMax, y.prMax),
    wq: mergeSparseHistograms(x.wq, y.wq, FLOW_BANDS),
    wqSum: x.wqSum + y.wqSum,
    wqN: x.wqN + y.wqN,
    wqMax: Math.max(x.wqMax, y.wqMax),
  };
}

const ownEntries = (record: unknown): Array<[string, unknown]> =>
  record && typeof record === 'object' && !Array.isArray(record)
    ? Object.keys(record).map((key) => [
        key,
        (record as Record<string, unknown>)[key],
      ])
    : [];

/** Adds to `record[key]`, folding into `(other)` past `max` keys. Own keys only. */
function addCapped(
  record: Record<string, number>,
  rawKey: string,
  delta: number,
  max: number
) {
  const key = clipText(rawKey, FLOW_EDGE_KEY_CHARS);
  // `(other)` counts toward the cap: the record never exceeds `max` keys.
  const room = hasOwn(record, FLOW_OTHER_KEY) ? max : max - 1;
  const target =
    hasOwn(record, key) || Object.keys(record).length < room
      ? key
      : FLOW_OTHER_KEY;
  record[target] = (hasOwn(record, target) ? record[target] : 0) + delta;
}

/** Sum of counters and histograms, max on maxima, union of steps/edges. */
export function mergeFlowPoints(
  base: TFlowPoint,
  next: TFlowPoint
): TFlowPoint {
  const steps = emptyRecord<TFlowStepPoint>();
  for (const source of [base?.steps, next?.steps]) {
    for (const [key, value] of ownEntries(source)) {
      const id = clipText(key, FLOW_EDGE_KEY_CHARS);
      if (
        !hasOwn(steps, id) &&
        Object.keys(steps).length >= FLOW_MAX_POINT_STEPS
      ) {
        continue;
      }
      steps[id] = hasOwn(steps, id)
        ? mergeStepPoints(steps[id], value)
        : readFlowStepPoint(value);
    }
  }
  const edges = emptyRecord<number>();
  for (const source of [base?.edges, next?.edges]) {
    for (const [key, value] of ownEntries(source)) {
      const count = num(value);
      if (count) addCapped(edges, key, count, FLOW_MAX_EDGES);
    }
  }
  return {
    timestamp: base.timestamp,
    windowMs: num(base.windowMs) + num(next.windowMs),
    h: FLOW_HIST_VERSION,
    steps,
    e2e: mergeSparseHistograms(base.e2e, next.e2e, FLOW_BANDS),
    e2eN: num(base.e2eN) + num(next.e2eN),
    e2eSum: num(base.e2eSum) + num(next.e2eSum),
    e2eMax: Math.max(num(base.e2eMax), num(next.e2eMax)),
    entries: num(base.entries) + num(next.entries),
    done: num(base.done) + num(next.done),
    errors: num(base.errors) + num(next.errors),
    edges,
  };
}

function addSample(hist: TSparseHistogram, ms: number) {
  const band = histogramBand(ms, FLOW_DURATION_BOUNDS_MS);
  hist[band] = (hist[band] ?? 0) + 1;
}

const firstLine = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value) return undefined;
  const line = clipText(value.split('\n')[0], FLOW_ERROR_CHARS);
  return line || undefined;
};

/** Parses one member of `traces::jobs` (job entry). Null for markers/garbage. */
export function parseTraceJobMember(member: string): TFlowTraceJob | null {
  try {
    const parts = member.split(SEP);
    if (parts.length < 5) return null;
    const json = JsonService.maybeParse(parts.slice(4).join(SEP));
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const value = json as Record<string, unknown>;
    const field = (key: string) =>
      hasOwn(value, key) ? value[key] : undefined;
    const s = clipRef(field('s'), FLOW_EDGE_KEY_CHARS);
    const q = clipRef(parts[1], 256);
    const j = clipRef(parts[2]);
    const a = Number(parts[3]);
    const st = field('st');
    if (!s || !q || !j || !Number.isInteger(a) || a < 1) return null;
    if (st !== 'c' && st !== 'f') return null;
    const entry: TFlowTraceJob = {
      s,
      q,
      j,
      a,
      st,
      t0: optNum(field('t0')) ?? 0,
      t1: optNum(field('t1')),
      t2: optNum(field('t2')),
    };
    const p = field('p');
    if (Array.isArray(p) && p.length === 2) {
      const pq = typeof p[0] === 'string' ? clipText(p[0], 256) : '';
      const pj = clipRef(p[1]);
      if (pj) entry.p = [pq, pj];
    }
    const e = firstLine(field('e'));
    if (e) entry.e = e;
    return entry;
  } catch {
    return null;
  }
}

type TFlowMetricsOptions = {
  config: Required<MetricsConfig>;
  options: Required<FlowsOptions>;
  client: () => Promise<RedisClient>;
  /** Queues known to the collector (parent lookup by name / id). */
  queues: () => Queue[];
  /** Monitor clock (eviction score). Tests only. */
  clock?: () => number;
};

/** A `_trace.startedAt` further in the future than this is not believed. */
export const FLOW_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Flow aggregates and the trace index, composed by the `MetricsCollector`.
 * Fed by the terminal events (completed/failed) of queues that belong to a
 * flow. Aggregates per step do not need `_trace`; the trace adds edges,
 * end-to-end time and the index. Every public method swallows its errors.
 *
 * Counters are not idempotent (two monitor replicas count twice, like the
 * throughput); the index is (deterministic members, ZADD).
 */
export class FlowMetrics {
  private _series: TieredSeries<TFlowPoint>;
  private _pending: Map<string, TFlowPoint> = new Map();
  private _windowStartedAt = Date.now();
  private _flows: NormalizedFlow[] = [];
  private _byQueue: Map<string, NormalizedFlow[]> = new Map();

  constructor(
    private _options: TFlowMetricsOptions,
    flows: NormalizedFlow[] = []
  ) {
    this._series = new TieredSeries<TFlowPoint>({
      config: _options.config,
      client: _options.client,
      merge: mergeFlowPoints,
      suffix: '::flow',
    });
    this.setFlows(flows);
  }

  public setFlows(flows: NormalizedFlow[]): void {
    this._flows = flows;
    this._byQueue = new Map();
    for (const flow of flows) {
      for (const queueId of flow.stepsByQueue.keys()) {
        this._byQueue.set(queueId, [
          ...(this._byQueue.get(queueId) ?? []),
          flow,
        ]);
      }
    }
  }
  public get flows(): NormalizedFlow[] {
    return this._flows;
  }
  public get options(): Required<FlowsOptions> {
    return this._options.options;
  }
  /** Whether a queue holds a step of some flow. */
  public hasQueue(queueId: string): boolean {
    return this._byQueue.has(queueId);
  }
  public flowsOfQueue(queueId: string): NormalizedFlow[] {
    return this._byQueue.get(queueId) ?? [];
  }
  public start(): void {
    this._windowStartedAt = Date.now();
  }

  /**
   * Terminal event hook. `job` is the one the collector already fetched
   * (null = removed before the read). Never throws.
   */
  public async onJobFinished(
    queue: Queue,
    jobId: JobId,
    job: Job | null | undefined,
    status: 'completed' | 'failed'
  ): Promise<void> {
    for (const flow of this.flowsOfQueue(queue.id)) {
      try {
        await this._ingest(flow, queue, String(jobId), job ?? null, status);
      } catch (e) {
        console.error('[bull-horizon] flow metrics ingestion error: ', e);
      }
    }
  }

  /** One point per flow that saw an event this tick. Sparse on purpose. */
  public drain(
    timestamp = Date.now()
  ): Array<{ queue: string; point: TFlowPoint }> {
    const windowMs = timestamp - this._windowStartedAt;
    this._windowStartedAt = timestamp;
    const ids = new Set(this._flows.map((flow) => flow.id));
    const out: Array<{ queue: string; point: TFlowPoint }> = [];
    this._pending.forEach((point, flowId) => {
      if (ids.has(flowId)) {
        out.push({
          queue: this.seriesId(flowId),
          point: { ...point, timestamp, windowMs },
        });
      }
    });
    this._pending.clear();
    return out;
  }
  public async persist(
    entries: Array<{ queue: string; point: TFlowPoint }>
  ): Promise<void> {
    if (entries.length) await this._series.append(entries);
  }
  /** Points of the window, finest tier that covers it. */
  public async extractSince(
    flowId: string,
    since: number,
    until?: number
  ): Promise<TFlowPoint[]> {
    const points = await this._series.since(this.seriesId(flowId), since);
    return until == null
      ? points
      : points.filter((point) => point.timestamp <= until);
  }

  // Keys.
  public seriesId(flowId: string): string {
    return `flow:${flowId}`;
  }
  public tracesKey(flowId: string): string {
    return `${this._options.config.redisPrefix}flow:${flowId}::traces`;
  }
  public traceJobsKey(flowId: string): string {
    return `${this.tracesKey(flowId)}::jobs`;
  }
  public traceKeysKey(flowId: string): string {
    return `${this.tracesKey(flowId)}::keys`;
  }
  public traceMetaKey(flowId: string): string {
    return `${this.tracesKey(flowId)}::meta`;
  }
  /** Every key of a flow: series tiers + the four index keys. */
  public keys(flowId: string): string[] {
    return [
      ...this._series.keys(this.seriesId(flowId)),
      this.tracesKey(flowId),
      this.traceJobsKey(flowId),
      this.traceKeysKey(flowId),
      this.traceMetaKey(flowId),
    ];
  }
  /** Keys of every flow that holds a step on `queueId`. */
  public keysOfQueue(queueId: string): string[] {
    return this.flowsOfQueue(queueId).flatMap((flow) => this.keys(flow.id));
  }
  public allKeys(): string[] {
    return this._flows.flatMap((flow) => this.keys(flow.id));
  }

  // Index reads.
  public async hasTrace(flowId: string, traceId: string): Promise<boolean> {
    const client = await this._options.client();
    const score = await client.zscore(this.tracesKey(flowId), traceId);
    return score !== null && score !== undefined;
  }
  public async indexSize(flowId: string): Promise<number> {
    const client = await this._options.client();
    return Number(await client.zcard(this.tracesKey(flowId))) || 0;
  }
  public async traceMeta(
    flowId: string,
    traceIds: string[]
  ): Promise<Map<string, TFlowTraceMeta>> {
    const out = new Map<string, TFlowTraceMeta>();
    if (!traceIds.length) return out;
    const client = await this._options.client();
    const raw: Array<string | null> = await client.hmget(
      this.traceMetaKey(flowId),
      ...traceIds
    );
    raw.forEach((value, i) => {
      const parsed = value ? JsonService.maybeParse(value) : null;
      if (!parsed || typeof parsed !== 'object') return;
      const s = optNum(hasOwn(parsed, 's') ? parsed.s : undefined);
      if (s === null) return;
      const meta: TFlowTraceMeta = { s };
      const k = hasOwn(parsed, 'k')
        ? clipRef(parsed.k, FLOW_KEY_MAX_CHARS)
        : undefined;
      if (k) meta.k = k;
      out.set(traceIds[i], meta);
    });
    return out;
  }
  /** Trace ids indexed under a business key value (at most `limit`). */
  public async tracesByKey(
    flowId: string,
    key: string,
    limit = 200
  ): Promise<string[]> {
    const value = clipText(key, FLOW_KEY_MAX_CHARS);
    if (!value) return [];
    const client = await this._options.client();
    const members: string[] = await client.zrangebylex(
      this.traceKeysKey(flowId),
      `[${value}${SEP}`,
      `(${value}\u0001`,
      'LIMIT',
      0,
      limit
    );
    return Array.from(
      new Set(
        members
          .map((member) => member.slice(value.length + 1))
          .filter((id) => FLOW_TRACE_ID_PATTERN.test(id))
      )
    );
  }
  /** Every index entry of a trace: jobs, keys and the truncation marker. */
  public async readTrace(
    flowId: string,
    traceId: string
  ): Promise<TFlowTraceRead> {
    const client = await this._options.client();
    const members: string[] = await client.zrangebylex(
      this.traceJobsKey(flowId),
      `[${traceId}${SEP}`,
      `(${traceId}\u0001`
    );
    const out: TFlowTraceRead = { jobs: [], keys: [], truncated: false };
    const prefix = traceId + SEP;
    for (const member of members) {
      const rest = member.slice(prefix.length);
      if (rest === TRUNCATED_MARK) {
        out.truncated = true;
      } else if (rest.startsWith(KEY_MARK + SEP)) {
        out.keys.push(rest.slice(KEY_MARK.length + 1));
      } else {
        const job = parseTraceJobMember(member);
        if (job) out.jobs.push(job);
      }
    }
    return out;
  }

  private _accumulator(flowId: string): TFlowPoint {
    let point = this._pending.get(flowId);
    if (!point) {
      point = emptyFlowPoint();
      this._pending.set(flowId, point);
    }
    return point;
  }
  private _step(point: TFlowPoint, stepId: string): TFlowStepPoint {
    if (!hasOwn(point.steps, stepId)) {
      point.steps[stepId] = emptyFlowStepPoint();
    }
    return point.steps[stepId];
  }

  private async _ingest(
    flow: NormalizedFlow,
    queue: Queue,
    jobId: string,
    job: Job | null,
    status: 'completed' | 'failed'
  ): Promise<void> {
    const candidates = flow.stepsByQueue.get(queue.id) ?? [];
    if (!job) {
      // Removed in the same script that emitted the event: the event has no
      // job name, so a queue with several steps counts it under `(queue)`.
      const point = this._accumulator(flow.id);
      const stepId =
        candidates.length === 1 ? candidates[0].id : FLOW_QUEUE_STEP;
      this._step(point, stepId).lost += 1;
      return;
    }
    const step = resolveFlowStep(flow, queue.id, job.name);
    if (!step) return;
    const bullmq = queue.provider === QueueProvider.Bullmq;
    const raw = (job.rawJob ?? job) as Record<string, unknown>;
    // Every failure event is final: neither lib emits one for an attempt
    // that will retry. A failure with attempts left (discard(),
    // UnrecoverableError, backoff -1, stalled) is still final and counts.
    const attempt = terminalAttempts(raw, status, bullmq);
    const point = this._accumulator(flow.id);
    const stats = this._step(point, step.id);
    if (status === 'completed') stats.c += 1;
    else stats.f += 1;
    if (attempt > 1) stats.retried += 1;
    const { processedOn, finishedOn, timestamp } = job;
    if (
      typeof processedOn === 'number' &&
      typeof finishedOn === 'number' &&
      finishedOn >= processedOn
    ) {
      const ms = finishedOn - processedOn;
      addSample(stats.pr, ms);
      stats.prSum += ms;
      stats.prMax = Math.max(stats.prMax, ms);
    }
    // With retries `processedOn` is the last attempt's: the "wait" would
    // include the backoff. Only first attempts measure the queue.
    if (
      attempt === 1 &&
      typeof processedOn === 'number' &&
      typeof timestamp === 'number'
    ) {
      const delay = Number(job.opts?.delay);
      const ready =
        timestamp + (Number.isFinite(delay) && delay > 0 ? delay : 0);
      if (processedOn >= ready) {
        const ms = processedOn - ready;
        addSample(stats.wq, ms);
        stats.wqSum += ms;
        stats.wqN += 1;
        stats.wqMax = Math.max(stats.wqMax, ms);
      }
    }
    const isEntry = flow.entry.includes(step.id);
    if (isEntry) point.entries += 1;
    if (step.id === flow.onError) point.errors += 1;

    let trace = readTrace(job.data, flow.trace.field);
    if (trace && trace.flow !== flow.id) trace = undefined;
    let implicit = false;
    if (!trace) {
      stats.untraced += 1;
      if (!isEntry) return;
      trace = implicitTrace(flow, queue, job);
      if (!trace) return;
      implicit = true;
    }

    let parent: [string, string] | undefined;
    if (trace.parent && !implicit) {
      const resolved = await this._resolveParent(flow, step, trace.parent);
      parent = [resolved.queueId ?? '', trace.parent.jobId];
      // hop 0 = the trace starts here (parent in another flow or untraced).
      if (trace.hop > 0) {
        addCapped(
          point.edges,
          `${resolved.stepId ?? FLOW_UNKNOWN_STEP}>${step.id}`,
          1,
          FLOW_MAX_EDGES
        );
      }
    }
    if (
      status === 'completed' &&
      flow.complete.includes(step.id) &&
      typeof finishedOn === 'number'
    ) {
      const ms = finishedOn - trace.startedAt;
      if (ms >= 0) {
        addSample(point.e2e, ms);
        point.e2eN += 1;
        point.e2eSum += ms;
        point.e2eMax = Math.max(point.e2eMax, ms);
        point.done += 1;
      }
    }

    const entry: TFlowTraceJob = {
      s: step.id,
      q: queue.id,
      j: jobId,
      a: attempt,
      st: status === 'completed' ? 'c' : 'f',
      t0: typeof timestamp === 'number' ? timestamp : 0,
      t1: typeof processedOn === 'number' ? processedOn : null,
      t2: typeof finishedOn === 'number' ? finishedOn : null,
    };
    if (parent) entry.p = parent;
    const error = status === 'failed' ? firstLine(job.failedReason) : undefined;
    if (error) entry.e = error;
    await this._index(flow, trace, entry, this._keysOf(flow, trace, job));
  }

  /** Business keys of the job: the trace key (or `trace.key` path) + aliases. */
  private _keysOf(
    flow: NormalizedFlow,
    trace: FlowTraceV1,
    job: Job
  ): string[] {
    const keys: string[] = [];
    const push = (value: unknown) => {
      const key = clipRef(value, FLOW_KEY_MAX_CHARS);
      if (key && !keys.includes(key)) keys.push(key);
    };
    push(trace.key);
    if (flow.trace.key) push(readPath(job.data, flow.trace.key));
    for (const alias of flow.trace.aliases) push(readPath(job.data, alias));
    return keys.slice(0, FLOW_MAX_KEYS_PER_TRACE);
  }

  /**
   * The parent's step: by queue name + job name when the trace carries the
   * queue; otherwise the job id is looked up in the queues of the declared
   * predecessors (at most 8 `getJob`).
   */
  private async _resolveParent(
    flow: NormalizedFlow,
    step: NormalizedFlowStep,
    parent: NonNullable<FlowTraceV1['parent']>
  ): Promise<{ stepId?: string; queueId?: string }> {
    const queues = this._options.queues();
    if (parent.queue) {
      const queue = queues.find((q) => q.name === parent.queue);
      if (!queue) return {};
      const candidates = flow.stepsByQueue.get(queue.id) ?? [];
      const found = parent.name
        ? resolveFlowStep(flow, queue.id, parent.name)
        : candidates.length === 1
        ? candidates[0]
        : undefined;
      return { stepId: found?.id, queueId: queue.id };
    }
    const queueIds: string[] = [];
    for (const predecessor of flow.predecessors.get(step.id) ?? []) {
      const queueId = flow.steps.get(predecessor)?.queueId;
      if (queueId && !queueIds.includes(queueId)) queueIds.push(queueId);
    }
    for (const queueId of queueIds.slice(0, PARENT_LOOKUP_MAX)) {
      const queue = queues.find((q) => q.id === queueId);
      if (!queue) continue;
      const job = await queue.getJob(parent.jobId);
      if (!job) continue;
      return {
        stepId: resolveFlowStep(flow, queueId, job.name)?.id,
        queueId,
      };
    }
    return {};
  }

  /**
   * One MULTI: the trace (ZADD NX by start), its job (deterministic member),
   * its keys (also mirrored under the trace prefix, so eviction finds them)
   * and the meta (HSETNX: constant per trace). Above `jobsPerTrace` only a
   * truncation marker is written. Then the oldest traces past
   * `recentTraces` are evicted with everything they own.
   */
  private async _index(
    flow: NormalizedFlow,
    trace: FlowTraceV1,
    entry: TFlowTraceJob,
    keys: string[]
  ): Promise<void> {
    const client = await this._options.client();
    const id = trace.traceId;
    const jobsKey = this.traceJobsKey(flow.id);
    const member = [
      id,
      clipText(entry.q, 256),
      clipText(entry.j, 256),
      entry.a,
      JSON.stringify(entry),
    ].join(SEP);
    let truncated = false;
    const known: string[] = (
      await client.zrangebylex(
        jobsKey,
        `[${id}${SEP}${KEY_MARK}${SEP}`,
        `(${id}${SEP}${KEY_MARK}\u0001`
      )
    ).map((m: string) => m.slice(id.length + KEY_MARK.length + 2));
    // Every member of the trace (whatever the queue id's first char), minus
    // the key markers and the truncation marker (security review S4).
    // ZLEXCOUNT is a plain command; some ioredis typings lack it.
    const lex = client as unknown as {
      zlexcount(key: string, min: string, max: string): Promise<number>;
    };
    const all = Number(
      await lex.zlexcount(jobsKey, `[${id}${SEP}`, `(${id}\u0001`)
    );
    const marked = await client.zscore(jobsKey, `${id}${SEP}${TRUNCATED_MARK}`);
    const count =
      all - known.length - (marked === null || marked === undefined ? 0 : 1);
    if (count >= this._options.options.jobsPerTrace) {
      const existing = await client.zscore(jobsKey, member);
      truncated = existing === null || existing === undefined;
    }
    const fresh = keys
      .filter((key) => !known.includes(key))
      .slice(0, Math.max(FLOW_MAX_KEYS_PER_TRACE - known.length, 0));
    // Eviction runs on the monitor's ingestion time: `_trace.startedAt` is
    // written by the app (a future value would pin the trace; S2). It is
    // kept for display only, clamped to the monitor clock.
    const now = (this._options.clock ?? Date.now)();
    const meta: TFlowTraceMeta = {
      s: trace.startedAt > now + FLOW_CLOCK_SKEW_MS ? now : trace.startedAt,
    };
    const primary = keys[0] ?? known[0];
    if (primary) meta.k = primary;
    const multi = client
      .multi()
      .zadd(this.tracesKey(flow.id), 'NX', now, id)
      .hsetnx(this.traceMetaKey(flow.id), id, JSON.stringify(meta))
      .zadd(jobsKey, 0, truncated ? `${id}${SEP}${TRUNCATED_MARK}` : member);
    for (const key of fresh) {
      multi
        .zadd(this.traceKeysKey(flow.id), 0, `${key}${SEP}${id}`)
        .zadd(jobsKey, 0, `${id}${SEP}${KEY_MARK}${SEP}${key}`);
    }
    await multi.exec();
    await this._evict(flow);
  }

  /** Drops the oldest traces past the cap, each with all its members. */
  private async _evict(flow: NormalizedFlow): Promise<void> {
    const client = await this._options.client();
    const tracesKey = this.tracesKey(flow.id);
    const card = Number(await client.zcard(tracesKey)) || 0;
    const cap = this._options.options.recentTraces;
    if (card <= cap) return;
    const oldest: string[] = await client.zrange(tracesKey, 0, card - cap - 1);
    if (!oldest.length) return;
    const jobsKey = this.traceJobsKey(flow.id);
    const multi = client.multi();
    for (const id of oldest) {
      const keys: string[] = (
        await client.zrangebylex(
          jobsKey,
          `[${id}${SEP}${KEY_MARK}${SEP}`,
          `(${id}${SEP}${KEY_MARK}\u0001`
        )
      ).map((m: string) => m.slice(id.length + KEY_MARK.length + 2));
      multi.zremrangebylex(jobsKey, `[${id}${SEP}`, `(${id}\u0001`);
      if (keys.length) {
        multi.zrem(
          this.traceKeysKey(flow.id),
          ...keys.map((key) => `${key}${SEP}${id}`)
        );
      }
      multi.hdel(this.traceMetaKey(flow.id), id).zrem(tracesKey, id);
    }
    await multi.exec();
  }
}

/**
 * Entry job without `_trace` (cron, producer in another app): an implicit
 * trace `<queue>:<jobId>` in the index only (never written to the job).
 */
export function implicitTraceId(
  queueName: string,
  jobId: string
): string | undefined {
  const id = `${queueName}:${jobId}`;
  return FLOW_TRACE_ID_PATTERN.test(id) ? id : undefined;
}

function implicitTrace(
  flow: NormalizedFlow,
  queue: Queue,
  job: Job
): FlowTraceV1 | undefined {
  const traceId = implicitTraceId(queue.name, String(job.id));
  if (!traceId) return undefined;
  const trace: FlowTraceV1 = {
    v: FLOW_TRACE_VERSION,
    traceId,
    flow: flow.id,
    startedAt: typeof job.timestamp === 'number' ? job.timestamp : Date.now(),
    hop: 0,
  };
  return trace;
}
