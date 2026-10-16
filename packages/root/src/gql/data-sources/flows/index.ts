import { BullMonitorError } from '../../../errors';
import { FlowsErrorEnum } from './errors-enum';
import { readTrace } from '../../../flow/trace';
import {
  FLOW_TRACE_ID_PATTERN,
  hasOwn,
  clipText,
} from '../../../flow/contract';
import { resolveFlowStep } from '../../../flow/definition';
import { currentAttempt } from '../../../shared/attempt';
import { denseHistogram, histogramQuantile } from '../../../metrics/histogram';
import {
  FLOW_BANDS,
  FLOW_DURATION_BOUNDS_MS,
  FLOW_OTHER_KEY,
  emptyFlowPoint,
  emptyFlowStepPoint,
  implicitTraceId,
  mergeFlowPoints,
  readFlowStepPoint,
} from '../../../metrics/flow-metrics';
import {
  FlowCheckLevel,
  FlowEdgeKind,
  FlowStepKind,
  FlowTraceMatch,
  FlowTraceStatus,
  JobStatus,
  QueueProvider,
} from '../../../typings/gql';
import type { MetricsCollector } from '../../../metrics-collector';
import type {
  TFlowStepPoint,
  TFlowTraceJob,
  TFlowTraceMeta,
} from '../../../metrics/flow-metrics';
import type {
  FlowCheck as TFlowCheck,
  NormalizedFlow,
  NormalizedFlowStep,
  NormalizedFlows,
} from '../../../flow/definition';
import type { FlowsOptions } from '../../../flow/contract';
import type { Job, JobCounts, Queue } from '../../../queue';
import type {
  Flow,
  FlowCheck,
  FlowEdgeStats,
  FlowStepError,
  FlowStepStats,
  FlowSummary,
  FlowTrace,
  FlowTraceCandidate,
  FlowTraceJob,
  FlowTraceResult,
  Maybe,
} from '../../../typings/gql';

const DAY_MS = 24 * 3600 * 1000;
export const FLOW_SEARCH_MAX_CHARS = 256;
export const FLOW_TRACE_CANDIDATES_MAX = 20;
export const FLOW_SPARK_BUCKETS = 32;
/** Failed jobs read per queue for the recent errors. */
export const FLOW_ERRORS_SCAN = 200;
const FLOW_ERRORS_TOP = 5;
const FLOW_ERROR_MESSAGE_CHARS = 120;
/** A step is the bottleneck only when its average wait reaches 1 s. */
export const FLOW_BOTTLENECK_MIN_WAIT_MS = 1000;
/** Distinct queues touched per request (fan-out cap). */
export const FLOW_MAX_FANOUT_QUEUES = 64;
const PENDING_PAGE = 100;
/**
 * Request budget of the pending scan (security review S1). The data source
 * is built per GraphQL request (`createContext`), so these are per request:
 * at most this many scans, each reading at most `FLOW_SCAN_TOTAL_MAX` jobs
 * across all queues (on top of `pendingScanLimit` per queue). Past the
 * budget a trace comes from the index only, flagged `partial`.
 */
export const FLOW_SCANS_PER_REQUEST = 2;
export const FLOW_SCAN_TOTAL_MAX = 2000;
/** The id `startTrace` generates: the only free-text query worth a scan. */
const GENERATED_TRACE_ID = /^tr_[0-9a-f]{16}$/;
const MAX_IMPLICIT_JOINS = 4;
const MAX_EDGE_CHECKS = 10;

const CHECK_LEVEL: Record<TFlowCheck['level'], FlowCheckLevel> = {
  ok: FlowCheckLevel.Ok,
  warn: FlowCheckLevel.Warn,
  error: FlowCheckLevel.Error,
};
const STEP_KIND: Record<NormalizedFlowStep['kind'], FlowStepKind> = {
  step: FlowStepKind.Step,
  end: FlowStepKind.End,
  error: FlowStepKind.Error,
};
const EDGE_KIND = {
  next: FlowEdgeKind.Next,
  conditional: FlowEdgeKind.Conditional,
  fallback: FlowEdgeKind.Fallback,
  sidecar: FlowEdgeKind.Sidecar,
  end: FlowEdgeKind.End,
} as const;

const ZERO_COUNTS = {
  waiting: 0,
  active: 0,
  delayed: 0,
  failed: 0,
} as JobCounts;

const toCheck = (check: TFlowCheck): FlowCheck => ({
  level: CHECK_LEVEL[check.level],
  code: check.code,
  message: check.message,
});

const finiteOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const jobKey = (queueId: string, jobId: string) => `${queueId}\u0000${jobId}`;

type TPendingJob = {
  job: Job;
  status: JobStatus;
  step: NormalizedFlowStep;
};

/**
 * Flows (definition, works without the collector), the flow summary and the
 * trace search (both need the collector). Read only: no mutation.
 *
 * Fan-out is bounded everywhere: distinct queues only (at most 64), exact
 * search only (no free text), pending scan limited per queue.
 */
export class FlowsDataSource {
  private _byId: Map<string, NormalizedFlow> = new Map();
  private _queuesByName: Map<string, Queue> = new Map();
  /** Same (flow, query, traceId) twice in one request = one evaluation. */
  private _traceCache: Map<string, Promise<Maybe<FlowTraceResult>>> = new Map();
  private _scansLeft = FLOW_SCANS_PER_REQUEST;

  constructor(
    private _queuesMap: Map<string, Queue>,
    private _flows: NormalizedFlows,
    private _options: Required<FlowsOptions>,
    private _collector?: MetricsCollector
  ) {
    for (const flow of _flows.flows) this._byId.set(flow.id, flow);
    for (const queue of _queuesMap.values()) {
      if (!this._queuesByName.has(queue.name)) {
        this._queuesByName.set(queue.name, queue);
      }
    }
  }

  public getFlows(): Flow[] {
    const global = this._flows.checks.map(toCheck);
    return this._flows.flows.map((flow) => ({
      id: flow.id,
      label: flow.label,
      group: flow.group ?? null,
      keyLabel: flow.trace.keyLabel ?? null,
      entry: flow.entry,
      complete: flow.complete,
      onError: flow.onError ?? null,
      steps: Array.from(flow.steps.values()).map((step) => ({
        id: step.id,
        kind: STEP_KIND[step.kind],
        label: step.label,
        description: step.description ?? null,
        when: step.when ?? null,
        queue: step.queue ?? null,
        queueId: step.queueId ?? null,
        jobs: step.jobs ?? null,
        sharedQueue: step.sharedQueue,
      })),
      edges: flow.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        kind: EDGE_KIND[edge.kind],
        when: edge.when ?? null,
        declared: true,
      })),
      definition: flow.definition,
      checks: [...flow.checks.map(toCheck), ...global],
    }));
  }

  public async getSummary(
    flowId: string,
    since?: Maybe<number>
  ): Promise<Maybe<FlowSummary>> {
    const flow = this._byId.get(flowId);
    if (!flow || !this._collector) return null;
    const now = Date.now();
    const start =
      typeof since === 'number' && Number.isFinite(since) && since < now
        ? since
        : now - DAY_MS;
    const points = await this._collector.flows.extractSince(flow.id, start);
    const total = points.reduce(mergeFlowPoints, emptyFlowPoint(start));
    const stepPoint = (id: string): TFlowStepPoint =>
      hasOwn(total.steps, id)
        ? readFlowStepPoint(total.steps[id])
        : emptyFlowStepPoint();
    const realSteps = Array.from(flow.steps.values()).filter(
      (step) => step.kind !== 'end'
    );
    const queueIds = this._distinctQueues(realSteps);
    const [counts, failedJobs] = await Promise.all([
      this._liveCounts(queueIds),
      this._failedJobs(queueIds),
    ]);
    const minutes = Math.max((now - start) / 60000, 1 / 60);
    const span = Math.max(now - start, 1);

    const steps: FlowStepStats[] = realSteps.map((step) => {
      const stats = stepPoint(step.id);
      const live = (step.queueId && counts.get(step.queueId)) || ZERO_COUNTS;
      const spark = new Array(FLOW_SPARK_BUCKETS).fill(0);
      for (const point of points) {
        if (!hasOwn(point.steps, step.id)) continue;
        const bucket = Math.min(
          Math.max(
            Math.floor(((point.timestamp - start) / span) * FLOW_SPARK_BUCKETS),
            0
          ),
          FLOW_SPARK_BUCKETS - 1
        );
        spark[bucket] += readFlowStepPoint(point.steps[step.id]).c;
      }
      const terminal = stats.c + stats.f;
      const pr = denseHistogram(stats.pr, FLOW_BANDS);
      const wq = denseHistogram(stats.wq, FLOW_BANDS);
      return {
        stepId: step.id,
        waiting: Number(live.waiting) || 0,
        active: Number(live.active) || 0,
        delayed: Number(live.delayed) || 0,
        failedNow: Number(live.failed) || 0,
        completed: stats.c,
        failed: stats.f,
        lost: stats.lost,
        untraced: stats.untraced,
        retried: stats.retried,
        throughputPerMin: stats.c / minutes,
        procP50: histogramQuantile(
          pr,
          FLOW_DURATION_BOUNDS_MS,
          0.5,
          stats.prMax
        ),
        procP95: histogramQuantile(
          pr,
          FLOW_DURATION_BOUNDS_MS,
          0.95,
          stats.prMax
        ),
        waitAvg: stats.wqN ? stats.wqSum / stats.wqN : null,
        waitP95: histogramQuantile(
          wq,
          FLOW_DURATION_BOUNDS_MS,
          0.95,
          stats.wqMax
        ),
        failureRate: terminal ? stats.f / terminal : 0,
        bottleneck: false,
        spark,
        errors: this._stepErrors(
          flow,
          step,
          step.queueId ? failedJobs.get(step.queueId) ?? [] : [],
          start
        ),
      };
    });

    // Bottleneck: highest average wait (>= 1 s), ties broken by live waiting.
    let bottleneck: FlowStepStats | undefined;
    for (const stats of steps) {
      if ((stats.waitAvg ?? 0) < FLOW_BOTTLENECK_MIN_WAIT_MS) continue;
      if (
        !bottleneck ||
        (stats.waitAvg as number) > (bottleneck.waitAvg as number) ||
        (stats.waitAvg === bottleneck.waitAvg &&
          stats.waiting > bottleneck.waiting)
      ) {
        bottleneck = stats;
      }
    }
    if (bottleneck) bottleneck.bottleneck = true;

    const waitOf = new Map(steps.map((s) => [s.stepId, s.waitAvg]));
    const observed = new Map<string, number>();
    for (const key of Object.keys(total.edges)) {
      const count = Number(total.edges[key]);
      if (Number.isFinite(count) && count > 0) observed.set(key, count);
    }
    const edges: FlowEdgeStats[] = [];
    const declaredKeys = new Set<string>();
    for (const edge of flow.edges) {
      if (edge.kind === 'end') continue;
      const key = `${edge.from}>${edge.to}`;
      if (declaredKeys.has(key)) continue;
      declaredKeys.add(key);
      edges.push({
        from: edge.from,
        to: edge.to,
        count: observed.get(key) ?? 0,
        declared: true,
        waitAvg: waitOf.get(edge.to) ?? null,
      });
    }
    const undeclared: FlowEdgeStats[] = [];
    const toError: FlowEdgeStats[] = [];
    observed.forEach((count, key) => {
      if (declaredKeys.has(key)) return;
      const [from, to] = this._splitEdge(flow, key);
      // Any real step -> onError is implicitly declared (kind onError).
      const implicit =
        !!flow.onError &&
        to === flow.onError &&
        flow.steps.get(from)?.kind !== undefined &&
        flow.steps.get(from)?.kind !== 'end';
      (implicit ? toError : undeclared).push({
        from,
        to,
        count,
        declared: implicit,
        waitAvg: waitOf.get(to) ?? null,
      });
    });
    edges.push(...toError.sort((a, b) => b.count - a.count));
    edges.push(...undeclared.sort((a, b) => b.count - a.count));

    const events = steps.reduce((sum, s) => sum + s.completed + s.failed, 0);
    const untraced = steps.reduce((sum, s) => sum + s.untraced, 0);
    const lost =
      steps.reduce((sum, s) => sum + s.lost, 0) + stepPoint('(queue)').lost;
    const coverage = events ? 1 - untraced / events : null;
    const checks: FlowCheck[] = [];
    if (coverage !== null) {
      const pct = Math.round(coverage * 1000) / 10;
      checks.push(
        coverage < 1
          ? {
              level: FlowCheckLevel.Warn,
              code: 'coverage',
              message: `${pct}% of the finished jobs carried a valid trace in the window`,
            }
          : {
              level: FlowCheckLevel.Ok,
              code: 'coverage',
              message: 'every finished job carried a valid trace in the window',
            }
      );
    }
    if (lost) {
      checks.push({
        level: FlowCheckLevel.Warn,
        code: 'lost',
        message: `${lost} jobs were removed before the collector could read them (removeOnComplete/removeOnFail: true?)`,
      });
    }
    undeclared.slice(0, MAX_EDGE_CHECKS).forEach((edge) =>
      checks.push({
        level: FlowCheckLevel.Warn,
        code: 'undeclared-edge',
        message: `observed edge ${edge.from} > ${edge.to} (${edge.count}) is not declared`,
      })
    );
    if (coverage) {
      edges
        .filter((edge) => edge.declared && !edge.count)
        .slice(0, MAX_EDGE_CHECKS)
        .forEach((edge) =>
          checks.push({
            level: FlowCheckLevel.Warn,
            code: 'unseen-edge',
            message: `declared edge ${edge.from} > ${edge.to} was not seen in the window`,
          })
        );
    }

    const e2e = denseHistogram(total.e2e, FLOW_BANDS);
    return {
      flowId: flow.id,
      since: start,
      entries: total.entries,
      done: total.done,
      errors: total.errors,
      failed: steps.reduce((sum, s) => sum + s.failed, 0),
      e2eAvg: total.e2eN ? total.e2eSum / total.e2eN : null,
      e2eP50: histogramQuantile(
        e2e,
        FLOW_DURATION_BOUNDS_MS,
        0.5,
        total.e2eMax
      ),
      e2eP95: histogramQuantile(
        e2e,
        FLOW_DURATION_BOUNDS_MS,
        0.95,
        total.e2eMax
      ),
      bottleneck: bottleneck?.stepId ?? null,
      coverage,
      steps,
      edges,
      checks,
    };
  }

  public async getTrace(
    flowId: string,
    query: string,
    traceId?: Maybe<string>
  ): Promise<Maybe<FlowTraceResult>> {
    const value = typeof query === 'string' ? query.trim() : '';
    if (!value || value.length > FLOW_SEARCH_MAX_CHARS) {
      throw new BullMonitorError(FlowsErrorEnum.BAD_QUERY);
    }
    const cacheKey = JSON.stringify([flowId, value, traceId ?? null]);
    const cached = this._traceCache.get(cacheKey);
    if (cached) return cached;
    const result = this._getTrace(flowId, value, traceId);
    this._traceCache.set(cacheKey, result);
    return result;
  }

  private async _getTrace(
    flowId: string,
    value: string,
    traceId?: Maybe<string>
  ): Promise<Maybe<FlowTraceResult>> {
    const flow = this._byId.get(flowId);
    if (!flow || !this._collector) return null;
    const index = this._collector.flows;
    const indexFull =
      (await index.indexSize(flow.id)) >= this._options.recentTraces;

    // 1) exact trace id.
    if (
      FLOW_TRACE_ID_PATTERN.test(value) &&
      (await index.hasTrace(flow.id, value))
    ) {
      return {
        matchedBy: FlowTraceMatch.TraceId,
        trace: await this._buildTrace(flow, value),
        candidates: [],
        indexFull,
      };
    }
    // 2) job id, in the flow's queues.
    const found = await this._findJob(flow, value);
    if (found) {
      return {
        matchedBy: FlowTraceMatch.JobId,
        trace: await this._buildTrace(flow, found.traceId, found),
        candidates: [],
        indexFull,
      };
    }
    // 3) business key value (key and aliases).
    const ids = await index.tracesByKey(flow.id, value);
    if (ids.length) {
      const meta = await index.traceMeta(flow.id, ids);
      const sorted = ids
        .map((id) => ({ id, s: meta.get(id)?.s ?? 0 }))
        .sort((a, b) => b.s - a.s);
      const chosen =
        traceId && sorted.some((c) => c.id === traceId)
          ? traceId
          : sorted[0].id;
      const candidates: FlowTraceCandidate[] =
        sorted.length > 1
          ? await Promise.all(
              sorted.slice(0, FLOW_TRACE_CANDIDATES_MAX).map(async (c) => ({
                traceId: c.id,
                startedAt: c.s,
                status: traceStatus(
                  flow,
                  this._toTraceJobs(
                    flow,
                    (
                      await index.readTrace(flow.id, c.id)
                    ).jobs
                  )
                ),
              }))
            )
          : [];
      return {
        matchedBy: FlowTraceMatch.Key,
        trace: await this._buildTrace(flow, chosen),
        candidates,
        indexFull,
      };
    }
    // 4) a trace id with no terminal event yet: bounded pending scan, only
    // for an id in the generated format or one passed explicitly.
    const scanId =
      traceId && FLOW_TRACE_ID_PATTERN.test(traceId)
        ? traceId
        : GENERATED_TRACE_ID.test(value)
        ? value
        : undefined;
    if (scanId) {
      const trace = await this._buildTrace(flow, scanId);
      if (trace.jobs.length) {
        return {
          matchedBy: FlowTraceMatch.TraceId,
          trace,
          candidates: [],
          indexFull,
        };
      }
    }
    return {
      matchedBy: FlowTraceMatch.None,
      trace: null,
      candidates: [],
      indexFull,
    };
  }

  /**
   * A job id looked up in each distinct queue of the flow (at most 64): the
   * first one with a trace of this flow wins; an entry job without `_trace`
   * maps to its implicit trace.
   */
  private async _findJob(
    flow: NormalizedFlow,
    jobId: string
  ): Promise<
    { traceId: string; job: Job; step: NormalizedFlowStep } | undefined
  > {
    const queues = this._distinctQueues(
      Array.from(flow.steps.values()).filter((step) => step.kind !== 'end')
    )
      .map((id) => this._queuesMap.get(id))
      .filter((queue): queue is Queue => !!queue);
    const jobs = await Promise.all(
      queues.map((queue) => queue.getJob(jobId).catch(() => undefined))
    );
    for (let i = 0; i < queues.length; i++) {
      const job = jobs[i];
      if (!job) continue;
      const step = resolveFlowStep(flow, queues[i].id, job.name);
      if (!step) continue;
      const trace = readTrace(job.data, flow.trace.field);
      if (trace && trace.flow === flow.id) {
        return { traceId: trace.traceId, job, step };
      }
      if (!trace && flow.entry.includes(step.id)) {
        const implicit = implicitTraceId(queues[i].name, String(job.id));
        if (implicit) return { traceId: implicit, job, step };
      }
    }
    return undefined;
  }

  private async _buildTrace(
    flow: NormalizedFlow,
    traceId: string,
    seed?: { job: Job; step: NormalizedFlowStep }
  ): Promise<FlowTrace> {
    const index = (this._collector as MetricsCollector).flows;
    const read = await index.readTrace(flow.id, traceId);
    const meta: TFlowTraceMeta | undefined = (
      await index.traceMeta(flow.id, [traceId])
    ).get(traceId);
    let entries = read.jobs;

    // 3.6: a child that opened its own trace under an implicit entry trace.
    const inTrace = new Set(entries.map((e) => jobKey(e.q, e.j)));
    const joined = new Set<string>([traceId]);
    for (const entry of [...entries]) {
      if (joined.size > MAX_IMPLICIT_JOINS) break;
      if (
        !entry.p ||
        !entry.p[0] ||
        inTrace.has(jobKey(entry.p[0], entry.p[1]))
      ) {
        continue;
      }
      const queue = this._queuesMap.get(entry.p[0]);
      const implicit = queue && implicitTraceId(queue.name, entry.p[1]);
      if (!implicit || joined.has(implicit)) continue;
      joined.add(implicit);
      if (!(await index.hasTrace(flow.id, implicit))) continue;
      const extra = (await index.readTrace(flow.id, implicit)).jobs;
      entries = [...extra, ...entries];
      extra.forEach((e) => inTrace.add(jobKey(e.q, e.j)));
    }

    const jobs = this._toTraceJobs(flow, entries);
    const known = new Set(jobs.map((j) => jobKey(j.queueId, j.jobId)));

    // A job found by id that the index does not hold (evicted, or still running).
    if (seed && !known.has(jobKey(seed.job.queue.id, String(seed.job.id)))) {
      const status = await seed.job.getState().catch(() => JobStatus.Unknown);
      jobs.push(
        this._liveJob(flow, seed.job, seed.step, status as JobStatus, jobs)
      );
      known.add(jobKey(seed.job.queue.id, String(seed.job.id)));
    }

    // Pending jobs of this trace in every step (fan-out siblings included).
    const { pending, partial } = await this._scanPending(flow, traceId, known);
    for (const item of pending) {
      jobs.push(this._liveJob(flow, item.job, item.step, item.status, jobs));
    }
    jobs.sort(
      (a, b) =>
        a.enqueuedAt - b.enqueuedAt ||
        (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity)
    );

    const status = traceStatus(flow, jobs);
    const startedAt =
      meta?.s ?? (jobs.length ? Math.min(...jobs.map((j) => j.enqueuedAt)) : 0);
    const done =
      status === FlowTraceStatus.Completed ||
      status === FlowTraceStatus.CompletedWithFallback ||
      status === FlowTraceStatus.Failed;
    const ends = jobs
      .map((j) => j.finishedAt)
      .filter((t): t is number => typeof t === 'number');
    const finishedAt = done && ends.length ? Math.max(...ends) : null;
    let longestWait: FlowTraceJob | null = null;
    for (const job of jobs) {
      if (
        job.waitMs != null &&
        (!longestWait || job.waitMs > (longestWait.waitMs as number))
      ) {
        longestWait = job;
      }
    }
    return {
      traceId,
      key: meta?.k ?? read.keys[0] ?? null,
      startedAt,
      finishedAt,
      durationMs:
        finishedAt !== null ? Math.max(finishedAt - startedAt, 0) : null,
      status,
      jobs,
      longestWait,
      truncated: read.truncated,
      partial,
    };
  }

  /** Index entries -> trace jobs: dedupe (highest attempt), parent step, fallback. */
  private _toTraceJobs(
    flow: NormalizedFlow,
    entries: TFlowTraceJob[]
  ): FlowTraceJob[] {
    const byJob = new Map<string, TFlowTraceJob>();
    for (const entry of entries) {
      const key = jobKey(entry.q, entry.j);
      const current = byJob.get(key);
      if (!current || entry.a > current.a) byJob.set(key, entry);
    }
    const stepOf = new Map<string, string>();
    byJob.forEach((entry, key) => stepOf.set(key, entry.s));
    return Array.from(byJob.values()).map((entry) => {
      const parentStepId = entry.p
        ? stepOf.get(jobKey(entry.p[0], entry.p[1])) ?? null
        : null;
      const t1 = finiteOrNull(entry.t1);
      const t2 = finiteOrNull(entry.t2);
      return {
        stepId: entry.s,
        queueId: entry.q,
        jobId: entry.j,
        attempt: entry.a,
        status: entry.st === 'c' ? JobStatus.Completed : JobStatus.Failed,
        parentQueueId: entry.p?.[0] || null,
        parentJobId: entry.p?.[1] ?? null,
        parentStepId,
        enqueuedAt: entry.t0,
        startedAt: t1,
        finishedAt: t2,
        waitMs: t1 !== null && t1 >= entry.t0 ? t1 - entry.t0 : null,
        processMs: t1 !== null && t2 !== null && t2 >= t1 ? t2 - t1 : null,
        failedReason: entry.e ?? null,
        fallback: isFallback(flow, parentStepId, entry.s),
        pending: false,
      };
    });
  }

  /** A job read live (found by id or by the pending scan). */
  private _liveJob(
    flow: NormalizedFlow,
    job: Job,
    step: NormalizedFlowStep,
    status: JobStatus,
    others: FlowTraceJob[]
  ): FlowTraceJob {
    const trace = readTrace(job.data, flow.trace.field);
    const parentQueue = trace?.parent?.queue
      ? this._queuesByName.get(trace.parent.queue)
      : undefined;
    const parentJobId = trace?.parent?.jobId ?? null;
    const parentQueueId = parentQueue?.id ?? null;
    const parentStepId =
      parentJobId && parentQueueId
        ? others.find(
            (o) => o.queueId === parentQueueId && o.jobId === parentJobId
          )?.stepId ?? null
        : parentJobId
        ? others.find((o) => o.jobId === parentJobId)?.stepId ?? null
        : null;
    const enqueuedAt = typeof job.timestamp === 'number' ? job.timestamp : 0;
    const startedAt = finiteOrNull(job.processedOn);
    const finishedAt = finiteOrNull(job.finishedOn);
    const isPending =
      status !== JobStatus.Completed && status !== JobStatus.Failed;
    const failedReason =
      status === JobStatus.Failed && typeof job.failedReason === 'string'
        ? clipText(job.failedReason.split('\n')[0], 160)
        : null;
    return {
      stepId: step.id,
      queueId: job.queue.id,
      jobId: String(job.id),
      attempt: currentAttempt(job.rawJob ?? {}),
      status,
      parentQueueId,
      parentJobId,
      parentStepId,
      enqueuedAt,
      startedAt,
      finishedAt: isPending ? null : finishedAt,
      waitMs:
        startedAt !== null && startedAt >= enqueuedAt
          ? startedAt - enqueuedAt
          : null,
      processMs:
        !isPending &&
        startedAt !== null &&
        finishedAt !== null &&
        finishedAt >= startedAt
          ? finishedAt - startedAt
          : null,
      failedReason,
      fallback: isFallback(flow, parentStepId, step.id),
      pending: isPending,
    };
  }

  /**
   * Reads waiting/active/delayed/paused (+ prioritized on BullMQ) of the
   * queues of every step of the flow (distinct, at most 64), in pages, up to
   * `pendingScanLimit` jobs per queue, and keeps the jobs of this trace.
   * Every step, not only the next ones: a fan-out sibling of a step that
   * already has a finished job is still pending (QA 005 G2).
   */
  private async _scanPending(
    flow: NormalizedFlow,
    traceId: string,
    known: Set<string>
  ): Promise<{ pending: TPendingJob[]; partial: boolean }> {
    if (this._scansLeft <= 0) return { pending: [], partial: true };
    this._scansLeft -= 1;
    const budget = { left: FLOW_SCAN_TOTAL_MAX };
    const scanned = new Set<string>();
    const steps = Array.from(flow.steps.values()).filter(
      (step) => step.kind !== 'end' && !!step.queueId
    );
    steps.forEach((step) => scanned.add(step.id));
    const queueIds = this._distinctQueues(steps);
    const results = await Promise.all(
      queueIds.map((queueId) => {
        const queue = this._queuesMap.get(queueId);
        return queue
          ? this._scanQueue(flow, queue, traceId, scanned, budget)
          : Promise.resolve({ pending: [] as TPendingJob[], partial: false });
      })
    );
    const pending: TPendingJob[] = [];
    for (const result of results) {
      for (const item of result.pending) {
        const key = jobKey(item.job.queue.id, String(item.job.id));
        if (known.has(key)) continue;
        known.add(key);
        pending.push(item);
      }
    }
    return { pending, partial: results.some((r) => r.partial) };
  }

  private async _scanQueue(
    flow: NormalizedFlow,
    queue: Queue,
    traceId: string,
    scanned: Set<string>,
    budget: { left: number }
  ): Promise<{ pending: TPendingJob[]; partial: boolean }> {
    const limit = this._options.pendingScanLimit;
    const statuses = [
      JobStatus.Waiting,
      JobStatus.Active,
      JobStatus.Delayed,
      JobStatus.Paused,
      ...(queue.provider === QueueProvider.Bullmq
        ? [JobStatus.Prioritized]
        : []),
    ];
    const pending: TPendingJob[] = [];
    let read = 0;
    for (const status of statuses) {
      for (let start = 0; ; start += PENDING_PAGE) {
        const size = Math.min(PENDING_PAGE, limit - read, budget.left);
        if (size <= 0) return { pending, partial: true };
        // Reserved before the read: parallel queues share the total budget.
        budget.left -= size;
        const page = await queue
          .getJobs(status, start, start + size - 1)
          .catch(() => [] as Job[]);
        budget.left += size - page.length;
        read += page.length;
        for (const job of page) {
          if (!job) continue;
          const trace = readTrace(job.data, flow.trace.field);
          if (trace?.traceId !== traceId) continue;
          const step = resolveFlowStep(flow, queue.id, job.name);
          if (step && scanned.has(step.id)) pending.push({ job, status, step });
        }
        if (page.length < size) break;
      }
    }
    return { pending, partial: false };
  }

  private _stepErrors(
    flow: NormalizedFlow,
    step: NormalizedFlowStep,
    failed: Job[],
    since: number
  ): FlowStepError[] {
    const groups = new Map<string, { count: number; lastJobId: string }>();
    for (const job of failed) {
      if (!job || !step.queueId) continue;
      if (resolveFlowStep(flow, step.queueId, job.name)?.id !== step.id) {
        continue;
      }
      if (typeof job.finishedOn === 'number' && job.finishedOn < since)
        continue;
      const reason =
        typeof job.failedReason === 'string' && job.failedReason
          ? job.failedReason
          : 'unknown error';
      const message =
        clipText(reason.split('\n')[0], FLOW_ERROR_MESSAGE_CHARS) ||
        'unknown error';
      const group = groups.get(message);
      // Newest first: the first job seen is the last one that failed.
      if (group) group.count += 1;
      else groups.set(message, { count: 1, lastJobId: String(job.id) });
    }
    return Array.from(groups.entries())
      .map(([message, group]) => ({
        message,
        count: group.count,
        lastJobId: group.lastJobId,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, FLOW_ERRORS_TOP);
  }

  private _distinctQueues(steps: NormalizedFlowStep[]): string[] {
    const ids: string[] = [];
    for (const step of steps) {
      if (step.queueId && !ids.includes(step.queueId)) ids.push(step.queueId);
    }
    return ids.slice(0, FLOW_MAX_FANOUT_QUEUES);
  }

  private async _liveCounts(
    queueIds: string[]
  ): Promise<Map<string, JobCounts>> {
    const out = new Map<string, JobCounts>();
    await Promise.all(
      queueIds.map(async (id) => {
        const queue = this._queuesMap.get(id);
        if (!queue) return;
        try {
          out.set(id, await queue.getJobCounts());
        } catch {
          // A queue that cannot answer shows zeros, not a broken screen.
        }
      })
    );
    return out;
  }

  private async _failedJobs(queueIds: string[]): Promise<Map<string, Job[]>> {
    const out = new Map<string, Job[]>();
    await Promise.all(
      queueIds.map(async (id) => {
        const queue = this._queuesMap.get(id);
        if (!queue) return;
        try {
          out.set(
            id,
            await queue.getJobs(JobStatus.Failed, 0, FLOW_ERRORS_SCAN - 1)
          );
        } catch {
          out.set(id, []);
        }
      })
    );
    return out;
  }

  /** 'from>to' back into its parts, preferring a known target step. */
  private _splitEdge(flow: NormalizedFlow, key: string): [string, string] {
    if (key === FLOW_OTHER_KEY) return [FLOW_OTHER_KEY, FLOW_OTHER_KEY];
    for (const id of flow.steps.keys()) {
      if (key.endsWith(`>${id}`) && key.length > id.length + 1) {
        return [key.slice(0, key.length - id.length - 1), id];
      }
    }
    const at = key.lastIndexOf('>');
    return at > 0 ? [key.slice(0, at), key.slice(at + 1)] : [key, key];
  }
}

function isFallback(
  flow: NormalizedFlow,
  from: string | null,
  to: string
): boolean {
  if (!from) return false;
  return flow.edges.some(
    (edge) => edge.kind === 'fallback' && edge.from === from && edge.to === to
  );
}

/**
 * COMPLETED when a completion step concluded (or a step with an `end`
 * branch concluded with no child) and no job of the trace is pending
 * anywhere in the flow; WITH_FALLBACK when a
 * job entered through a fallback edge too; FAILED when a failed job has no
 * child; RUNNING when something is pending; UNKNOWN otherwise.
 */
export function traceStatus(
  flow: NormalizedFlow,
  jobs: FlowTraceJob[]
): FlowTraceStatus {
  const finished = jobs.filter((j) => !j.pending);
  const hasPending = jobs.some((j) => j.pending);
  const parents = new Set(
    jobs
      .filter((j) => j.parentJobId)
      .map((j) => jobKey(j.parentQueueId ?? '', j.parentJobId as string))
  );
  const parentIds = new Set(
    jobs.filter((j) => j.parentJobId).map((j) => j.parentJobId as string)
  );
  const hasChild = (j: FlowTraceJob) =>
    parents.has(jobKey(j.queueId, j.jobId)) ||
    (parentIds.has(j.jobId) &&
      jobs.some((c) => c.parentJobId === j.jobId && !c.parentQueueId));
  const endSources = new Set(
    flow.edges.filter((e) => e.kind === 'end').map((e) => e.from)
  );
  const completed = finished.some(
    (j) =>
      j.status === JobStatus.Completed &&
      (flow.complete.includes(j.stepId) ||
        (endSources.has(j.stepId) && !hasChild(j) && !hasPending))
  );
  // Anything still pending decides first: a dead-end failure in one branch
  // must not read FAILED and then flip to COMPLETED when a sibling finishes.
  if (hasPending) return FlowTraceStatus.Running;
  if (finished.some((j) => j.status === JobStatus.Failed && !hasChild(j))) {
    return FlowTraceStatus.Failed;
  }
  if (completed) {
    return jobs.some((j) => j.fallback)
      ? FlowTraceStatus.CompletedWithFallback
      : FlowTraceStatus.Completed;
  }
  return FlowTraceStatus.Unknown;
}
