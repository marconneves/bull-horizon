import { JsonService } from '../services/json';
import { TieredSeries } from './tiered-series';
import { histogramBand, histogramQuantile } from './histogram';
import {
  AGENT_RUN_MAX_READ_CHARS,
  isAgentRunV1,
  applyAgentRunDetail,
  parseAgentRunLine,
  parseAgentRunSkipLine,
  recordedAgentRunDetail,
} from '../agent';
import { clipId } from '../agent/limits';
import type { AgentRunDetail, AgentRunV1 } from '../agent';
import type { Queue, JobId, RedisClient } from '../queue';
import type { AgentsConfig, MetricsConfig } from '../typings/config';

/** Latency bands, ms. Index `length` = overflow. Changing them needs a new `h`. */
export const AGENT_LATENCY_BOUNDS_MS = [
  500, 1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12500, 15000, 20000,
  25000, 30000, 40000, 60000, 90000, 120000, 180000, 300000,
];
export const AGENT_LATENCY_VERSION = 1;
/** `steps` buckets: 1, 2, 3, 4, 5+. */
export const AGENT_STEPS_BUCKETS = ['1', '2', '3', '4', '5+'];
/** Cardinality caps per point; the excess folds into `(other)`. */
export const AGENT_MAX_TOOLS = 50;
export const AGENT_MAX_MODELS = 20;
export const AGENT_MAX_OUTCOMES = 20;
export const AGENT_OTHER_KEY = '(other)';
/** Log lines read per job; the helper writes the run line last. */
export const AGENT_LOG_TAIL = 200;
/** Tool chain kept per entry of the recent runs index. */
export const AGENT_INDEX_CHAIN_MAX = 30;
const INDEX_ERROR_MAX = 200;

export type TAgentToolStats = { c: number; e: number; z: number; ms: number };
export type TAgentModelStats = { r: number; i: number; o: number };

export type TAgentPoint = {
  timestamp: number;
  windowMs: number;
  /** Version of the latency bands. */
  h: 1;
  runs: number;
  /** `error != null`. */
  failed: number;
  /** Job removed before the collector could read its logs. */
  lost: number;
  /**
   * Finished agent job with no run at all: no run line in its log and no run
   * in its returnvalue (e.g. a worker without `createAgentRun`). Absent on
   * points written before it existed: read as 0.
   */
  unrecorded?: number;
  /**
   * Finished agent job whose attempt was deliberately skipped (a skip line,
   * `recorder.skip()` / `markAgentRunSkipped`, and no run line). Not a run.
   * Absent on points written before it existed: read as 0.
   */
  skipped?: number;
  /** Runs with at least one empty tool result. */
  emptyRuns: number;
  durSum: number;
  durMax: number;
  /** Count per latency band (bounds.length + 1 positions). */
  lat: number[];
  /** Sum of (step duration - tool time of the step). */
  llmMs: number;
  toolMs: number;
  /** [1, 2, 3, 4, 5+]. */
  steps: number[];
  outcomes: Record<string, number>;
  /** calls, errors, empty, summed ms. */
  tools: Record<string, TAgentToolStats>;
  /** runs, tokens in, tokens out. */
  models: Record<string, TAgentModelStats>;
};

/** Entry of the recent runs index. Always basic, whatever the queue level. */
export type TAgentRunIndexEntry = {
  /** jobId, attempt, job name. */
  j: string;
  a: number;
  n: string;
  /** finishedAt ms, durationMs. */
  t: number;
  d: number | null;
  /** model, steps. */
  m: string;
  s: number;
  /** tokens. */
  i: number;
  o: number;
  /** outcome. */
  oc: string;
  /** Chain: [tool, ok, empty], up to 30. */
  tc: [string, 0 | 1, 0 | 1][];
  /** error, 200 chars. */
  e?: string;
  /**
   * `input.conversationId`, clipped. Absent on runs without one and on
   * entries written before the conversation view: those never join one.
   */
  c?: string;
};

/**
 * Record keyed by external data (tool, model, outcome names): no prototype,
 * so `constructor`, `toString` or `__proto__` are plain own keys.
 */
const emptyRecord = <T>(): Record<string, T> =>
  Object.create(null) as Record<string, T>;
const hasOwn = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

export const emptyAgentPoint = (timestamp = 0, windowMs = 0): TAgentPoint => ({
  timestamp,
  windowMs,
  h: AGENT_LATENCY_VERSION,
  runs: 0,
  failed: 0,
  lost: 0,
  unrecorded: 0,
  skipped: 0,
  emptyRuns: 0,
  durSum: 0,
  durMax: 0,
  lat: new Array(AGENT_LATENCY_BOUNDS_MS.length + 1).fill(0),
  llmMs: 0,
  toolMs: 0,
  steps: new Array(AGENT_STEPS_BUCKETS.length).fill(0),
  outcomes: emptyRecord(),
  tools: emptyRecord(),
  models: emptyRecord(),
});

/**
 * `error` if the attempt failed; `max-steps` if the last step still asked for
 * a tool (the loop stopped with the model wanting more); otherwise the last
 * step's finish reason, `unknown` when absent.
 */
export function agentRunOutcome(run: AgentRunV1): string {
  if (run.error != null) return 'error';
  const last = run.steps[run.steps.length - 1];
  if (!last?.finishReason) return 'unknown';
  if (last.finishReason === 'tool-calls') return 'max-steps';
  return last.finishReason;
}

export function latencyBand(ms: number): number {
  return histogramBand(ms, AGENT_LATENCY_BOUNDS_MS);
}

/**
 * Estimated percentile from the band histogram: walk the bands up to
 * `q * total`, then interpolate linearly inside the band. The overflow band
 * answers `durMax`. Error is at most the width of the band. The algorithm is
 * `histogramQuantile` (shared with the flow series).
 */
export function latencyPercentile(
  lat: number[],
  q: number,
  durMax: number
): number | null {
  return histogramQuantile(lat, AGENT_LATENCY_BOUNDS_MS, q, durMax);
}

/**
 * Adds `delta` under `key`, folding into `(other)` once the record holds
 * `max` keys. Bounds the point size whatever names a job writes. Own keys
 * only (never `in`): an inherited `constructor` would turn the sum into NaN.
 * The key is capped too: the reader does not trust the writer.
 */
function addCapped<T>(
  record: Record<string, T>,
  rawKey: string,
  max: number,
  delta: T,
  add: (a: T, b: T) => T
) {
  const key = clipId(rawKey);
  const target =
    hasOwn(record, key) || Object.keys(record).length < max
      ? key
      : AGENT_OTHER_KEY;
  record[target] = hasOwn(record, target) ? add(record[target], delta) : delta;
}

const addTool = (a: TAgentToolStats, b: TAgentToolStats) => ({
  c: a.c + b.c,
  e: a.e + b.e,
  z: a.z + b.z,
  ms: a.ms + b.ms,
});
const addModel = (a: TAgentModelStats, b: TAgentModelStats) => ({
  r: a.r + b.r,
  i: a.i + b.i,
  o: a.o + b.o,
});
const addCount = (a: number, b: number) => a + b;

const sumArrays = (a: number[] = [], b: number[] = []) =>
  Array.from(
    { length: Math.max(a.length, b.length) },
    (_, i) => (a[i] ?? 0) + (b[i] ?? 0)
  );

/** Union of two records (either may come straight from `JSON.parse`). */
function mergeRecord<T>(
  a: Record<string, T> | null | undefined,
  b: Record<string, T> | null | undefined,
  max: number,
  add: (x: T, y: T) => T
): Record<string, T> {
  const out = emptyRecord<T>();
  for (const source of [a, b]) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      addCapped(out, key, max, value, add);
    }
  }
  return out;
}

/** Sum everywhere, max on `durMax`, position-wise arrays, union of records. */
export function mergeAgentPoints(
  base: TAgentPoint,
  next: TAgentPoint
): TAgentPoint {
  return {
    timestamp: base.timestamp,
    windowMs: (base.windowMs ?? 0) + (next.windowMs ?? 0),
    h: AGENT_LATENCY_VERSION,
    runs: base.runs + next.runs,
    failed: base.failed + next.failed,
    lost: base.lost + next.lost,
    unrecorded: (base.unrecorded ?? 0) + (next.unrecorded ?? 0),
    skipped: (base.skipped ?? 0) + (next.skipped ?? 0),
    emptyRuns: base.emptyRuns + next.emptyRuns,
    durSum: base.durSum + next.durSum,
    durMax: Math.max(base.durMax, next.durMax),
    lat: sumArrays(base.lat, next.lat),
    llmMs: base.llmMs + next.llmMs,
    toolMs: base.toolMs + next.toolMs,
    steps: sumArrays(base.steps, next.steps),
    outcomes: mergeRecord(
      base.outcomes,
      next.outcomes,
      AGENT_MAX_OUTCOMES,
      addCount
    ),
    tools: mergeRecord(base.tools, next.tools, AGENT_MAX_TOOLS, addTool),
    models: mergeRecord(base.models, next.models, AGENT_MAX_MODELS, addModel),
  };
}

/** Folds one run into a point (mutates it). */
export function accumulateAgentRun(point: TAgentPoint, run: AgentRunV1) {
  point.runs += 1;
  if (run.error != null) point.failed += 1;
  const tools = run.steps.flatMap((step) => step.tools);
  if (tools.some((tool) => tool.empty)) point.emptyRuns += 1;
  if (run.durationMs != null && run.durationMs >= 0) {
    point.durSum += run.durationMs;
    point.durMax = Math.max(point.durMax, run.durationMs);
    point.lat[latencyBand(run.durationMs)] += 1;
  }
  for (const step of run.steps) {
    const toolMs = step.tools.reduce((sum, tool) => sum + tool.durationMs, 0);
    point.toolMs += toolMs;
    // Parallel tools can add up to more than the step itself.
    point.llmMs += Math.max((step.durationMs ?? 0) - toolMs, 0);
  }
  const stepsBucket = Math.max(
    Math.min(run.steps.length, AGENT_STEPS_BUCKETS.length) - 1,
    0
  );
  point.steps[stepsBucket] += 1;
  addCapped(
    point.outcomes,
    agentRunOutcome(run),
    AGENT_MAX_OUTCOMES,
    1,
    addCount
  );
  for (const tool of tools) {
    addCapped(
      point.tools,
      tool.name,
      AGENT_MAX_TOOLS,
      {
        c: 1,
        e: tool.ok ? 0 : 1,
        z: tool.empty ? 1 : 0,
        ms: tool.durationMs,
      },
      addTool
    );
  }
  addCapped(
    point.models,
    run.model,
    AGENT_MAX_MODELS,
    { r: 1, i: run.inputTokens, o: run.outputTokens },
    addModel
  );
}

export function agentRunIndexEntry(
  jobId: JobId,
  jobName: string,
  run: AgentRunV1,
  finishedAt: number
): TAgentRunIndexEntry {
  const chain = run.steps
    .flatMap((step) => step.tools)
    .slice(0, AGENT_INDEX_CHAIN_MAX)
    .map((tool): [string, 0 | 1, 0 | 1] => [
      clipId(tool.name),
      tool.ok ? 1 : 0,
      tool.empty ? 1 : 0,
    ]);
  const entry: TAgentRunIndexEntry = {
    j: jobId,
    a: run.attempt,
    n: clipId(jobName),
    t: finishedAt,
    d: run.durationMs,
    m: clipId(run.model),
    s: run.steps.length,
    i: run.inputTokens,
    o: run.outputTokens,
    oc: clipId(agentRunOutcome(run)),
    tc: chain,
  };
  if (run.error != null) entry.e = run.error.slice(0, INDEX_ERROR_MAX);
  const conversationId = run.input?.conversationId;
  if (typeof conversationId === 'string' && conversationId) {
    entry.c = clipId(conversationId);
  }
  return entry;
}

/**
 * Compatibility source: a worker that predates `createAgentRun` may return
 * the whole run (AiTrace v1) as the job's returnvalue instead of logging it.
 * Accepted only if it passes the same shape guard and read cap as a log line.
 * It only covers the attempt that completed (failed attempts return nothing).
 * Without `attempt`, it is the job's attempt count. Never throws.
 */
export function agentRunFromReturnValue(job: {
  returnvalue: unknown;
  attemptsMade: number;
}): AgentRunV1 | null {
  try {
    let value: unknown = job.returnvalue;
    if (value == null) return null;
    if (typeof value === 'string') {
      if (value.length > AGENT_RUN_MAX_READ_CHARS) return null;
      value = JSON.parse(value);
    } else {
      const json = JSON.stringify(value);
      if (!json || json.length > AGENT_RUN_MAX_READ_CHARS) return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const candidate =
      record.attempt === undefined
        ? {
            ...record,
            attempt: Math.max(Math.floor(Number(job.attemptsMade) || 0), 1),
          }
        : record;
    return isAgentRunV1(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

const warnedDetailMismatch = new Set<string>();

/**
 * Whether a stored run carries more than its queue declares (a worker with
 * `full` on a queue the monitor has as `basic`, or a legacy payload). The
 * monitor cuts it when serving, but the content is in Redis: warn the operator
 * once per queue per process, with no content in the message.
 */
export function checkAgentDetailMismatch(
  queueName: string,
  declared: AgentRunDetail,
  run: AgentRunV1
): boolean {
  const recorded = recordedAgentRunDetail(run);
  const mismatch = recorded === 'full' && declared === 'basic';
  if (mismatch && !warnedDetailMismatch.has(queueName)) {
    warnedDetailMismatch.add(queueName);
    console.warn(
      `[bull-horizon] queue "${queueName}" declares detail "${declared}" ` +
        `but carries runs recorded at "${recorded}": that content is stored ` +
        'in Redis. Use the same AgentQueueConfig in the worker.'
    );
  }
  return mismatch;
}
/** Tests only: forget which queues were already warned about. */
export function resetAgentDetailMismatchWarnings(): void {
  warnedDetailMismatch.clear();
}

const timeOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Whether the run belongs to the attempt that started at `processedOn` (the
 * job's current or last one: both libs overwrite `processedOn` on every
 * attempt). Earlier attempts finished before it. Without `processedOn` the
 * answer is unknown, reported as `false` so the caller stays on the safe side.
 */
export function isCurrentAttemptRun(
  run: Pick<AgentRunV1, 'startedAt' | 'finishedAt'>,
  processedOn: number | null | undefined
): boolean {
  if (typeof processedOn !== 'number' || !Number.isFinite(processedOn)) {
    return false;
  }
  const end = timeOf(run.finishedAt) ?? timeOf(run.startedAt);
  return end !== null && end >= processedOn;
}

type TAgentMetricsOptions = {
  config: Required<MetricsConfig>;
  agents: Required<AgentsConfig>;
  client: () => Promise<RedisClient>;
  /** Delay of the single re-read when the last attempt's line is missing. */
  rereadDelayMs?: number;
};

/**
 * Agent run aggregates, composed by the `MetricsCollector`. Fed by the same
 * terminal events as the throughput (completed/failed): on each one the job's
 * log tail is read, every run line is ingested once (ZADD NX on the recent
 * runs index makes it idempotent across duplicate events, manual retries and
 * monitor replicas), and the tick accumulator becomes a sparse tiered series.
 */
export class AgentMetrics {
  private _series: TieredSeries<TAgentPoint>;
  private _pending: Map<string, TAgentPoint> = new Map();
  private _timers: Set<ReturnType<typeof setTimeout>> = new Set();
  private _windowStartedAt = Date.now();

  constructor(private _options: TAgentMetricsOptions) {
    this._series = new TieredSeries<TAgentPoint>({
      config: _options.config,
      client: _options.client,
      merge: mergeAgentPoints,
      suffix: '::ai',
    });
  }

  public start(): void {
    this._windowStartedAt = Date.now();
  }
  /** Drops pending re-reads so a stopped collector leaves no timers behind. */
  public stop(): void {
    this._timers.forEach((timer) => clearTimeout(timer));
    this._timers.clear();
  }

  /** Terminal event hook (completed or failed). Never throws. */
  public async onJobFinished(
    queue: Queue,
    jobId: JobId,
    isReread = false
  ): Promise<void> {
    try {
      const agent = queue.agent;
      if (!agent) return;
      const job = await queue.getJob(jobId);
      if (!job) {
        // Removed in the same script that emitted the event
        // (`removeOnComplete: true`): the run is gone with it. Neither lib
        // puts the job name in the event, so in a queue that mixes agent and
        // non-agent jobs (`ai.jobs`) a removed non-agent job counts too:
        // `lost` means "terminal event whose job was already gone".
        this._accumulator(queue.id).lost += 1;
        return;
      }
      if (!queue.isAgentJob(job.name)) return;
      const { logs } = await queue.getJobLogs(jobId, -AGENT_LOG_TAIL, -1);
      const processedOn = job.processedOn;
      let currentSeen = false;
      const attempts = new Set<number>();
      const skips: Array<{ attempt: number; at: string }> = [];
      for (const line of logs ?? []) {
        const parsed = parseAgentRunLine(line);
        if (!parsed) {
          const skip = parseAgentRunSkipLine(line);
          if (skip) skips.push(skip);
          continue;
        }
        checkAgentDetailMismatch(queue.name, agent.detail, parsed);
        const run = applyAgentRunDetail(parsed, agent.detail);
        await this._ingest(queue, jobId, job.name, run);
        attempts.add(run.attempt);
        if (isCurrentAttemptRun(run, processedOn)) currentSeen = true;
      }
      // A skip line closes its attempt like a run line would, unless a run
      // line covers the same attempt (the run wins). Without `processedOn`
      // the current attempt is unknown: a skip with no run line at all counts.
      const liveSkips = skips.filter((skip) => !attempts.has(skip.attempt));
      const knownStart =
        typeof processedOn === 'number' && Number.isFinite(processedOn);
      const currentSkipped =
        !currentSeen &&
        (knownStart
          ? liveSkips.some((skip) =>
              isCurrentAttemptRun(
                { startedAt: skip.at, finishedAt: skip.at },
                processedOn
              )
            )
          : liveSkips.length > 0 && !attempts.size);
      if (currentSkipped) {
        this._accumulator(queue.id).skipped =
          (this._accumulator(queue.id).skipped ?? 0) + 1;
        return;
      }
      // Earlier attempts' lines can be new on this event (no lib emits a
      // global event on retry), so "something was ingested" does not mean
      // the attempt that just ended has its line: re-read until it shows.
      if (!currentSeen && !isReread) {
        this._scheduleReread(queue, jobId);
        return;
      }
      // Still no line for this attempt: fall back to the returnvalue (old
      // workers), unless a line already covers that attempt.
      const fallback = agentRunFromReturnValue(job);
      if (fallback && !attempts.has(fallback.attempt)) {
        checkAgentDetailMismatch(queue.name, agent.detail, fallback);
        await this._ingest(
          queue,
          jobId,
          job.name,
          applyAgentRunDetail(fallback, agent.detail)
        );
      } else if (!fallback && !attempts.size && !skips.length) {
        this._accumulator(queue.id).unrecorded =
          (this._accumulator(queue.id).unrecorded ?? 0) + 1;
      }
    } catch (e) {
      console.error('[bull-horizon] agent metrics ingestion error: ', e);
    }
  }

  /**
   * Hands the tick's accumulators over as points, one per queue that saw a
   * run, a lost, unrecorded or skipped job. Sparse on purpose: idle minutes
   * write nothing.
   */
  public drain(
    queues: Queue[],
    timestamp = Date.now()
  ): Array<{ queue: string; point: TAgentPoint }> {
    const windowMs = timestamp - this._windowStartedAt;
    this._windowStartedAt = timestamp;
    const ids = new Set(queues.map((queue) => queue.id));
    const out: Array<{ queue: string; point: TAgentPoint }> = [];
    this._pending.forEach((point, queue) => {
      if (
        ids.has(queue) &&
        point.runs +
          point.lost +
          (point.unrecorded ?? 0) +
          (point.skipped ?? 0) >
          0
      ) {
        out.push({ queue, point: { ...point, timestamp, windowMs } });
      }
    });
    this._pending.clear();
    return out;
  }
  public async persist(
    entries: Array<{ queue: string; point: TAgentPoint }>
  ): Promise<void> {
    if (entries.length) await this._series.append(entries);
  }

  /** Points of the window, finest tier that covers it. */
  public async extractSince(
    queue: string,
    since: number,
    until?: number
  ): Promise<TAgentPoint[]> {
    const points = await this._series.since(queue, since);
    return until == null
      ? points
      : points.filter((point) => point.timestamp <= until);
  }
  /** Recent runs index entries finished since `since`, newest first. */
  public async getRecentRuns(
    queue: string,
    since: number
  ): Promise<TAgentRunIndexEntry[]> {
    const client = await this._options.client();
    const members: string[] = await client.zrevrangebyscore(
      this.runsKey(queue),
      '+inf',
      since
    );
    if (!members.length) return [];
    const raw: Array<string | null> = await client.hmget(
      this.runsDataKey(queue),
      ...members
    );
    return raw
      .map((value) => (value ? JsonService.maybeParse(value) : null))
      .filter(
        (entry): entry is TAgentRunIndexEntry =>
          !!entry && typeof entry === 'object'
      );
  }

  /**
   * Every entry of the recent runs index (oldest first) plus whether the
   * index sits at its cap, i.e. older runs were already evicted. Bounded by
   * `recentRuns`: no scan outside the index, no extra key.
   */
  public async getAllRecentRuns(
    queue: string
  ): Promise<{ entries: TAgentRunIndexEntry[]; full: boolean }> {
    const client = await this._options.client();
    const members: string[] = await client.zrange(this.runsKey(queue), 0, -1);
    const full = members.length >= Math.max(this._options.agents.recentRuns, 1);
    if (!members.length) return { entries: [], full };
    const raw: Array<string | null> = await client.hmget(
      this.runsDataKey(queue),
      ...members
    );
    const entries = raw
      .map((value) => (value ? JsonService.maybeParse(value) : null))
      .filter(
        (entry): entry is TAgentRunIndexEntry =>
          !!entry && typeof entry === 'object'
      );
    return { entries, full };
  }

  public keys(queue: string): string[] {
    return [
      ...this._series.keys(queue),
      this.runsKey(queue),
      this.runsDataKey(queue),
    ];
  }
  public runsKey(queue: string): string {
    return this._series.key(queue) + '::runs';
  }
  public runsDataKey(queue: string): string {
    return this.runsKey(queue) + '::data';
  }

  private async _ingest(
    queue: Queue,
    jobId: JobId,
    jobName: string,
    run: AgentRunV1
  ): Promise<boolean> {
    const client = await this._options.client();
    const startedAt = timeOf(run.startedAt) ?? 0;
    const finishedAt =
      timeOf(run.finishedAt) ??
      (run.durationMs != null ? startedAt + run.durationMs : Date.now());
    const member = `${jobId}:${run.attempt}:${startedAt}`;
    const runsKey = this.runsKey(queue.id);
    const added = await client.zadd(runsKey, 'NX', finishedAt, member);
    if (Number(added) !== 1) return false;
    accumulateAgentRun(this._accumulator(queue.id), run);
    // Everything ranked below the newest `recentRuns` goes, from the zset and
    // the hash alike. Read first so HDEL removes exactly what ZREM removes.
    const cap = Math.max(this._options.agents.recentRuns, 1);
    const overflow: string[] = await client.zrange(runsKey, 0, -(cap + 1));
    const dataKey = this.runsDataKey(queue.id);
    const multi = client
      .multi()
      .hset(
        dataKey,
        member,
        JSON.stringify(agentRunIndexEntry(jobId, jobName, run, finishedAt))
      );
    if (overflow.length) {
      multi.zrem(runsKey, ...overflow).hdel(dataKey, ...overflow);
    }
    await multi.exec();
    return true;
  }

  /**
   * One re-read, not a retry loop: covers the app calling `finish()` without
   * awaiting it, so the line lands just after the terminal event. The last
   * attempt is told apart by time (`processedOn`), with no `attemptsMade`
   * arithmetic, which differs between Bull and BullMQ.
   */
  private _scheduleReread(queue: Queue, jobId: JobId) {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      void this.onJobFinished(queue, jobId, true);
    }, this._options.rereadDelayMs ?? 2000);
    (timer as { unref?: () => void }).unref?.();
    this._timers.add(timer);
  }

  private _accumulator(queue: string): TAgentPoint {
    let point = this._pending.get(queue);
    if (!point) {
      point = emptyAgentPoint();
      this._pending.set(queue, point);
    }
    return point;
  }
}
