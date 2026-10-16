import { graphql } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from '../gql/type-defs';
import { resolvers } from '../gql/resolvers';
import { FlowsDataSource } from '../gql/data-sources';
import {
  FLOW_SCANS_PER_REQUEST,
  FLOW_SCAN_TOTAL_MAX,
} from '../gql/data-sources/flows';
import { MetricsCollector } from '../metrics-collector';
import { normalizeFlows } from '../flow/definition';
import { normalizeFlowsOptions } from '../flow/contract';
import { startTrace, withTrace } from '../flow';
import { FakeRedis } from './helpers/agent-fakes';
import { flowQueue, flush, processorJob } from './helpers/flow-fakes';
import type { FlowHarness, Lib, RawJob } from './helpers/flow-fakes';
import type { FlowConfig, FlowsOptions } from '../flow';
import type { MetricsConfig } from '../typings/config';
import type { Queue } from '../queue';

const schema = makeExecutableSchema({
  typeDefs: typeDefs as any,
  resolvers: resolvers as any,
});

const METRICS: Required<MetricsConfig> = {
  redisPrefix: 'test::metrics::',
  collectInterval: { minutes: 1 },
  maxMetrics: 4320,
  retention: { raw: 4320, rollups: [] },
  blacklist: [],
};
const NOW = Date.now();
const T0 = NOW - 3600000;
const FLOW_ID = 'content-ingest';
const NAMES = [
  'content:Verify',
  'content:Extract',
  'content:Transcribe',
  'content:Fallback',
  'content:Save',
  'content:Error',
];

const FLOW: FlowConfig = {
  id: FLOW_ID,
  label: 'Ingestão de conteúdo',
  entry: 'content:Verify',
  onError: 'content:Error',
  trace: { key: 'videoId', aliases: ['tiktokId'] },
  steps: {
    'content:Verify': {
      next: [
        { to: 'content:Extract', when: 'novo' },
        { end: 'só atualiza números', when: 'já existe' },
      ],
    },
    'content:Extract': { next: 'content:Transcribe' },
    'content:Transcribe': {
      next: ['content:Save', { to: 'content:Fallback', kind: 'fallback' }],
    },
    'content:Fallback': { next: 'content:Save' },
    'content:Save': {},
    'content:Error': {},
  },
};
const BROKEN: FlowConfig = {
  id: 'broken',
  entry: 'ghost-queue',
  steps: { 'ghost-queue': {} },
};

const silent = () => undefined;
const collectors: MetricsCollector[] = [];
afterEach(() => collectors.splice(0).forEach((c) => c.stopCollecting()));

type Setup = {
  redis: FakeRedis;
  h: Record<string, FlowHarness>;
  collector?: MetricsCollector;
  run: (query: string, variables?: Record<string, unknown>) => Promise<any>;
  persist: () => Promise<void>;
};

function setup(
  lib: Lib,
  opts: {
    collector?: boolean;
    options?: FlowsOptions;
    flows?: FlowConfig[];
  } = {}
): Setup {
  const redis = new FakeRedis();
  const h: Record<string, FlowHarness> = {};
  for (const name of NAMES) h[name] = flowQueue(redis, name, lib);
  const queues = Object.values(h).map((x) => x.queue);
  const queuesMap = new Map<string, Queue>(queues.map((q) => [q.id, q]));
  const normalized = normalizeFlows(
    opts.flows ?? [FLOW, BROKEN],
    queues,
    silent
  );
  const options = normalizeFlowsOptions(opts.options);
  let collector: MetricsCollector | undefined;
  if (opts.collector !== false) {
    collector = new MetricsCollector(
      queues,
      METRICS,
      {},
      {
        flows: normalized.flows,
        options,
      }
    );
    collector.startCollecting();
    collectors.push(collector);
  }
  // One data source per request, as `createContext` does.
  const context = () => ({
    dataSources: {
      flows: new FlowsDataSource(queuesMap, normalized, options, collector),
    },
  });
  return {
    redis,
    h,
    collector,
    run: async (source, variableValues) => {
      const result = await graphql({
        schema,
        source,
        contextValue: context(),
        variableValues,
      });
      return result;
    },
    persist: async () => {
      if (!collector) return;
      await collector.flows.persist(collector.flows.drain(Date.now()));
    },
  };
}

const first = (lib: Lib) => ({ attemptsMade: lib === 'bull' ? 0 : 1 });

const entryJob = (
  lib: Lib,
  id: string,
  key: string,
  at = T0,
  over: Partial<RawJob> = {}
): RawJob => ({
  id,
  name: 'verify',
  data: startTrace(
    { videoId: key, tiktokId: `t-${key}` },
    { flow: FLOW_ID, now: at }
  ),
  timestamp: at,
  processedOn: at + 1000,
  finishedOn: at + 1500,
  state: 'completed',
  ...first(lib),
  ...over,
});
const childJob = (
  lib: Lib,
  parent: RawJob,
  parentQueue: string,
  id: string,
  name: string,
  at: number,
  over: Partial<RawJob> = {}
): RawJob => ({
  id,
  name,
  data: withTrace(processorJob(lib, parentQueue, parent), {
    videoId: (parent.data as any)?.videoId,
  }),
  timestamp: at,
  processedOn: at + 10000,
  finishedOn: at + 12000,
  state: 'completed',
  ...first(lib),
  ...over,
});

async function finish(s: Setup, queue: string, job: RawJob) {
  s.h[queue].store.put(job);
  if (job.state === 'failed') s.h[queue].emitFailed(job.id);
  else s.h[queue].emitCompleted(job.id);
  await flush();
}

/** Verify > Extract > Transcribe > (Save | Fallback > Save | fail). */
async function path(
  s: Setup,
  lib: Lib,
  base: string,
  key: string,
  at: number,
  end: 'save' | 'fallback' | 'fail' | 'pending'
) {
  const verify = entryJob(lib, `${base}-v`, key, at);
  await finish(s, 'content:Verify', verify);
  const extract = childJob(
    lib,
    verify,
    'content:Verify',
    `${base}-e`,
    'extract',
    at + 2000
  );
  if (end === 'pending') {
    s.h['content:Extract'].store.put({
      ...extract,
      state: 'waiting',
      processedOn: undefined,
      finishedOn: undefined,
    });
    return { verify, extract };
  }
  await finish(s, 'content:Extract', extract);
  const transcribe = childJob(
    lib,
    extract,
    'content:Extract',
    `${base}-t`,
    'transcribe',
    at + 20000,
    end === 'fail'
      ? {
          state: 'failed',
          failedReason: 'Error: whisper 503\n  at call',
          ...(lib === 'bull' ? { attemptsMade: 1 } : {}),
        }
      : {}
  );
  await finish(s, 'content:Transcribe', transcribe);
  if (end === 'fail') return { verify, extract, transcribe };
  let last = transcribe;
  let lastQueue = 'content:Transcribe';
  if (end === 'fallback') {
    last = childJob(
      lib,
      transcribe,
      'content:Transcribe',
      `${base}-f`,
      'fallback',
      at + 40000
    );
    await finish(s, 'content:Fallback', last);
    lastQueue = 'content:Fallback';
  }
  const save = childJob(lib, last, lastQueue, `${base}-s`, 'save', at + 60000);
  await finish(s, 'content:Save', save);
  return { verify, extract, transcribe, save };
}

const traceIdOf = (job: RawJob) => (job.data as any)._trace.traceId as string;

const FLOWS_QUERY = `{
  flows {
    id label group keyLabel entry complete onError definition
    steps { id kind label queue queueId jobs sharedQueue }
    edges { from to kind when declared }
    checks { level code message }
  }
}`;
const SUMMARY_QUERY = `query($flow: ID!, $since: Float) {
  flowSummary(flow: $flow, since: $since) {
    flowId since entries done errors failed e2eAvg e2eP50 e2eP95 bottleneck coverage
    steps {
      stepId waiting active delayed failedNow completed failed lost untraced retried
      throughputPerMin procP50 procP95 waitAvg waitP95 failureRate bottleneck spark
      errors { message count lastJobId }
    }
    edges { from to count declared waitAvg }
    checks { level code message }
  }
}`;
const TRACE_QUERY = `query($flow: ID!, $query: String!, $traceId: ID) {
  flowTrace(flow: $flow, query: $query, traceId: $traceId) {
    matchedBy indexFull
    candidates { traceId startedAt status }
    trace {
      traceId key startedAt finishedAt durationMs status truncated partial
      longestWait { stepId waitMs }
      jobs {
        stepId queueId jobId attempt status parentQueueId parentJobId parentStepId
        enqueuedAt startedAt finishedAt waitMs processMs failedReason fallback pending
      }
    }
  }
}`;

describe.each<Lib>(['bull', 'bullmq'])('flows GraphQL on %s', (lib) => {
  it('flows works without the collector; summary and trace are null', async () => {
    const s = setup(lib, { collector: false });
    const result = await s.run(FLOWS_QUERY);
    expect(result.errors).toBeUndefined();
    const [flow, broken] = result.data.flows;
    expect(flow).toMatchObject({
      id: FLOW_ID,
      label: 'Ingestão de conteúdo',
      keyLabel: 'videoId',
      entry: ['content:Verify'],
      onError: 'content:Error',
      checks: [],
    });
    expect(flow.complete).toContain('content:Save');
    expect(flow.steps.map((st: any) => st.kind)).toEqual(
      expect.arrayContaining(['STEP', 'END', 'ERROR'])
    );
    const end = flow.steps.find((st: any) => st.kind === 'END');
    expect(end).toMatchObject({ queue: null, queueId: null, jobs: null });
    expect(flow.edges.map((e: any) => e.kind)).toEqual(
      expect.arrayContaining(['CONDITIONAL', 'END', 'NEXT', 'FALLBACK'])
    );
    expect(flow.definition).toContain('id: content-ingest');
    expect(broken.checks).toEqual([
      expect.objectContaining({ level: 'ERROR', code: 'unknown-queue' }),
    ]);
    const summary = await s.run(SUMMARY_QUERY, { flow: FLOW_ID });
    expect(summary.data.flowSummary).toBeNull();
    const trace = await s.run(TRACE_QUERY, { flow: FLOW_ID, query: 'x' });
    expect(trace.data.flowTrace).toBeNull();
  });

  it('summarizes steps, KPIs, bottleneck, errors and dynamic checks', async () => {
    const s = setup(lib);
    await path(s, lib, 'a', 'v1', T0, 'save');
    await path(s, lib, 'b', 'v2', T0 + 60000, 'fallback');
    await path(s, lib, 'c', 'v3', T0 + 120000, 'fail');
    await path(s, lib, 'd', 'v4', T0 + 180000, 'fail');
    // An untraced job, an undeclared edge, a lost job, a live waiting job.
    const v1 = entryJob(lib, 'x-v', 'v9', T0);
    await finish(
      s,
      'content:Save',
      childJob(lib, v1, 'content:Verify', 'x-s', 'save', T0)
    );
    await finish(s, 'content:Extract', {
      id: 'u1',
      name: 'extract',
      data: {},
      timestamp: T0,
      processedOn: T0 + 1,
      finishedOn: T0 + 2,
      state: 'completed',
      ...first(lib),
    });
    s.h['content:Verify'].emitCompleted('gone');
    await flush();
    s.h['content:Transcribe'].store.put({
      id: 'w1',
      name: 'transcribe',
      state: 'waiting',
      timestamp: NOW,
    });
    await s.persist();

    const result = await s.run(SUMMARY_QUERY, {
      flow: FLOW_ID,
      since: T0 - 1000,
    });
    expect(result.errors).toBeUndefined();
    const summary = result.data.flowSummary;
    expect(summary).toMatchObject({
      flowId: FLOW_ID,
      since: T0 - 1000,
      entries: 4, // verify jobs that finished (the lost one has no name)
      done: 3,
      failed: 2,
      errors: 0,
      bottleneck: 'content:Transcribe',
    });
    expect(summary.e2eAvg).toBeGreaterThan(0);
    expect(summary.e2eP95).toBeGreaterThanOrEqual(summary.e2eP50);
    const step = (id: string) =>
      summary.steps.find((st: any) => st.stepId === id);
    const transcribe = step('content:Transcribe');
    expect(transcribe).toMatchObject({
      completed: 2,
      failed: 2,
      waiting: 1,
      failedNow: 2,
      failureRate: 0.5,
      bottleneck: true,
      waitAvg: 10000,
    });
    expect(transcribe.errors).toEqual([
      { message: 'Error: whisper 503', count: 2, lastJobId: 'd-t' },
    ]);
    expect(transcribe.spark).toHaveLength(32);
    expect(transcribe.spark.reduce((a: number, b: number) => a + b, 0)).toBe(2);
    expect(transcribe.procP50).toBeGreaterThan(0);
    expect(step('content:Verify')).toMatchObject({ completed: 4, lost: 1 });
    expect(step('content:Extract').untraced).toBe(1);
    expect(step('content:Verify').throughputPerMin).toBeGreaterThan(0);
    expect(
      summary.steps.find((st: any) => st.stepId.includes('::end'))
    ).toBeUndefined();
    expect(summary.coverage).toBeLessThan(1);
    const edge = (from: string, to: string) =>
      summary.edges.find((e: any) => e.from === from && e.to === to);
    expect(edge('content:Verify', 'content:Extract')).toMatchObject({
      count: 4,
      declared: true,
    });
    expect(edge('content:Transcribe', 'content:Fallback')).toMatchObject({
      count: 1,
      declared: true,
      waitAvg: 10000,
    });
    expect(edge('content:Verify', 'content:Save')).toMatchObject({
      count: 1,
      declared: false,
    });
    const codes = summary.checks.map((c: any) => c.code);
    expect(codes).toEqual(
      expect.arrayContaining(['coverage', 'lost', 'undeclared-edge'])
    );
    expect(codes).not.toContain('unseen-edge');
  });

  it('finds a trace by trace id, job id and key (candidates newest first)', async () => {
    const s = setup(lib);
    const older = await path(s, lib, 'a', 'v1', T0, 'save');
    const newer = await path(s, lib, 'b', 'v1', T0 + 600000, 'fallback');

    const byId = await s.run(TRACE_QUERY, {
      flow: FLOW_ID,
      query: ` ${traceIdOf(older.verify)} `,
    });
    expect(byId.errors).toBeUndefined();
    const trace = byId.data.flowTrace.trace;
    expect(byId.data.flowTrace).toMatchObject({
      matchedBy: 'TRACE_ID',
      candidates: [],
      indexFull: false,
    });
    expect(trace).toMatchObject({
      traceId: traceIdOf(older.verify),
      key: 'v1',
      startedAt: T0,
      status: 'COMPLETED',
      truncated: false,
      partial: false,
    });
    expect(trace.jobs.map((j: any) => j.stepId)).toEqual([
      'content:Verify',
      'content:Extract',
      'content:Transcribe',
      'content:Save',
    ]);
    expect(trace.jobs[1]).toMatchObject({
      jobId: 'a-e',
      status: 'completed',
      attempt: 1,
      parentJobId: 'a-v',
      parentStepId: 'content:Verify',
      parentQueueId: s.h['content:Verify'].queue.id,
      waitMs: 10000,
      processMs: 2000,
      fallback: false,
      pending: false,
    });
    expect(trace.finishedAt).toBe(older.save!.finishedOn);
    expect(trace.durationMs).toBe((older.save!.finishedOn as number) - T0);
    expect(trace.longestWait.waitMs).toBe(10000);

    const byJob = await s.run(TRACE_QUERY, { flow: FLOW_ID, query: 'b-e' });
    expect(byJob.data.flowTrace.matchedBy).toBe('JOB_ID');
    expect(byJob.data.flowTrace.trace).toMatchObject({
      traceId: traceIdOf(newer.verify),
      status: 'COMPLETED_WITH_FALLBACK',
    });
    expect(
      byJob.data.flowTrace.trace.jobs.find(
        (j: any) => j.stepId === 'content:Fallback'
      ).fallback
    ).toBe(true);

    for (const query of ['v1', 't-v1']) {
      const byKey = await s.run(TRACE_QUERY, { flow: FLOW_ID, query });
      expect(byKey.data.flowTrace.matchedBy).toBe('KEY');
      expect(byKey.data.flowTrace.candidates).toEqual([
        {
          traceId: traceIdOf(newer.verify),
          startedAt: T0 + 600000,
          status: 'COMPLETED_WITH_FALLBACK',
        },
        {
          traceId: traceIdOf(older.verify),
          startedAt: T0,
          status: 'COMPLETED',
        },
      ]);
      expect(byKey.data.flowTrace.trace.traceId).toBe(traceIdOf(newer.verify));
    }
    const picked = await s.run(TRACE_QUERY, {
      flow: FLOW_ID,
      query: 'v1',
      traceId: traceIdOf(older.verify),
    });
    expect(picked.data.flowTrace.trace.traceId).toBe(traceIdOf(older.verify));

    const none = await s.run(TRACE_QUERY, {
      flow: FLOW_ID,
      query: 'nothing-here',
    });
    expect(none.data.flowTrace).toEqual({
      matchedBy: 'NONE',
      trace: null,
      candidates: [],
      indexFull: false,
    });
  });

  it('derives FAILED, RUNNING (pending frontier) and the end-branch completion', async () => {
    const s = setup(lib);
    const failed = await path(s, lib, 'a', 'v1', T0, 'fail');
    const running = await path(s, lib, 'b', 'v2', T0, 'pending');
    const onlyVerify = entryJob(lib, 'c-v', 'v3', T0);
    await finish(s, 'content:Verify', onlyVerify);

    const f = (
      await s.run(TRACE_QUERY, {
        flow: FLOW_ID,
        query: traceIdOf(failed.verify),
      })
    ).data.flowTrace.trace;
    expect(f.status).toBe('FAILED');
    expect(
      f.jobs.find((j: any) => j.stepId === 'content:Transcribe')
    ).toMatchObject({
      status: 'failed',
      failedReason: 'Error: whisper 503',
    });

    // The failed trace's frontier (Save, Fallback, Error) was read above.
    Object.values(s.h).forEach((x) => (x.store.getJobsCalls = 0));
    const r = (
      await s.run(TRACE_QUERY, {
        flow: FLOW_ID,
        query: traceIdOf(running.verify),
      })
    ).data.flowTrace.trace;
    expect(r.status).toBe('RUNNING');
    expect(r.finishedAt).toBeNull();
    expect(r.jobs[1]).toMatchObject({
      stepId: 'content:Extract',
      jobId: 'b-e',
      status: 'waiting',
      pending: true,
      parentStepId: 'content:Verify',
      startedAt: null,
    });
    // Every step's queue is scanned (bounded per queue), each at most once
    // per status: waiting/active/delayed/paused (+ prioritized on BullMQ).
    const statuses = lib === 'bull' ? 4 : 5;
    for (const name of NAMES) {
      expect(s.h[name].store.getJobsCalls).toBe(statuses);
    }

    const e = (
      await s.run(TRACE_QUERY, { flow: FLOW_ID, query: traceIdOf(onlyVerify) })
    ).data.flowTrace.trace;
    expect(e.status).toBe('COMPLETED');
  });

  it('keeps a trace RUNNING while a fan-out sibling is delayed (G2)', async () => {
    const s = setup(lib);
    const done = await path(s, lib, 'a', 'v1', T0, 'save');
    // A sibling of the finished Extract job, delayed in the same step.
    const sibling = childJob(
      lib,
      done.verify,
      'content:Verify',
      'a-e2',
      'extract',
      T0 + 2000,
      {
        state: 'delayed',
        processedOn: undefined,
        finishedOn: undefined,
        opts: { delay: 60000 },
      }
    );
    s.h['content:Extract'].store.put(sibling);
    const t = (
      await s.run(TRACE_QUERY, { flow: FLOW_ID, query: traceIdOf(done.verify) })
    ).data.flowTrace.trace;
    expect(t.status).toBe('RUNNING');
    expect(t.finishedAt).toBeNull();
    const pending = t.jobs.filter((j: any) => j.pending);
    expect(pending).toEqual([
      expect.objectContaining({
        stepId: 'content:Extract',
        jobId: 'a-e2',
        status: 'delayed',
        parentStepId: 'content:Verify',
      }),
    ]);
    // Once it is gone, the trace is complete again.
    s.h['content:Extract'].store.remove('a-e2');
    const after = (
      await s.run(TRACE_QUERY, { flow: FLOW_ID, query: traceIdOf(done.verify) })
    ).data.flowTrace.trace;
    expect(after.status).toBe('COMPLETED');
  });

  it('finds a trace id with no terminal event yet via the pending scan (G4)', async () => {
    const s = setup(lib);
    const waiting = entryJob(lib, 'w-v', 'v7', T0, {
      state: 'waiting',
      processedOn: undefined,
      finishedOn: undefined,
    });
    s.h['content:Verify'].store.put(waiting);
    const result = (
      await s.run(TRACE_QUERY, { flow: FLOW_ID, query: traceIdOf(waiting) })
    ).data.flowTrace;
    expect(result.matchedBy).toBe('TRACE_ID');
    expect(result.trace).toMatchObject({
      traceId: traceIdOf(waiting),
      status: 'RUNNING',
      startedAt: T0,
    });
    expect(result.trace.jobs).toEqual([
      expect.objectContaining({
        jobId: 'w-v',
        status: 'waiting',
        pending: true,
      }),
    ]);
    const none = (
      await s.run(TRACE_QUERY, { flow: FLOW_ID, query: 'tr_0000000000000000' })
    ).data.flowTrace;
    expect(none.matchedBy).toBe('NONE');
  });

  it('treats a step -> onError edge as implicitly declared (G3)', async () => {
    const s = setup(lib);
    const failed = await path(s, lib, 'a', 'v1', T0, 'fail');
    await finish(
      s,
      'content:Error',
      childJob(
        lib,
        failed.transcribe!,
        'content:Transcribe',
        'a-x',
        'save-error',
        T0 + 30000
      )
    );
    await s.persist();
    const summary = (
      await s.run(SUMMARY_QUERY, { flow: FLOW_ID, since: T0 - 1000 })
    ).data.flowSummary;
    expect(
      summary.edges.find(
        (e: any) => e.from === 'content:Transcribe' && e.to === 'content:Error'
      )
    ).toMatchObject({ count: 1, declared: true });
    expect(summary.checks.map((c: any) => c.code)).not.toContain(
      'undeclared-edge'
    );
    expect(summary.errors).toBe(1);
  });

  it('bounds pending scans per request and memoizes repeated searches (S1)', async () => {
    const s = setup(lib);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const done = await path(s, lib, `s${i}`, `k${i}`, T0 + i, 'save');
      ids.push(traceIdOf(done.verify));
    }
    Object.values(s.h).forEach((x) => (x.store.getJobsCalls = 0));
    const fields = ids
      .map(
        (id, i) =>
          `t${i}: flowTrace(flow: "${FLOW_ID}", query: "${id}") { trace { partial status } }`
      )
      .join('\n');
    // Same search aliased twice more: memoized, no extra scan.
    const query = `{ ${fields}\n d0: flowTrace(flow: "${FLOW_ID}", query: "${ids[0]}") { trace { partial } }\n d1: flowTrace(flow: "${FLOW_ID}", query: "${ids[0]}") { trace { partial } } }`;
    const result = await s.run(query);
    expect(result.errors).toBeUndefined();
    const statuses = lib === 'bull' ? 4 : 5;
    const calls = Object.values(s.h).reduce(
      (n, x) => n + x.store.getJobsCalls,
      0
    );
    expect(calls).toBeLessThanOrEqual(
      FLOW_SCANS_PER_REQUEST * NAMES.length * statuses
    );
    const partials = ids.map((_, i) => result.data[`t${i}`].trace.partial);
    expect(partials.filter((p: boolean) => !p)).toHaveLength(
      FLOW_SCANS_PER_REQUEST
    );
    // Past the budget: index-only result, flagged partial, still found.
    expect(result.data.t4.trace).toEqual({
      partial: true,
      status: 'COMPLETED',
    });
    expect(result.data.d0).toEqual(result.data.d1);
  });

  it('runs no pending scan for a query that is not a generated trace id (S1)', async () => {
    const s = setup(lib);
    await path(s, lib, 'a', 'v1', T0, 'save');
    Object.values(s.h).forEach((x) => (x.store.getJobsCalls = 0));
    for (const query of ['nothing-here', 'unknown:id', 'tr_short']) {
      const result = await s.run(TRACE_QUERY, { flow: FLOW_ID, query });
      expect(result.data.flowTrace.matchedBy).toBe('NONE');
    }
    expect(
      Object.values(s.h).reduce((n, x) => n + x.store.getJobsCalls, 0)
    ).toBe(0);
    // The generated format (or an explicit traceId) does scan.
    await s.run(TRACE_QUERY, { flow: FLOW_ID, query: 'tr_00000000000000aa' });
    expect(
      Object.values(s.h).reduce((n, x) => n + x.store.getJobsCalls, 0)
    ).toBeGreaterThan(0);
  });

  it('caps the total jobs read by one scan across all queues (S1)', async () => {
    const s = setup(lib, { options: { pendingScanLimit: 1000 } });
    const verify = entryJob(lib, 'a-v', 'v1', T0);
    await finish(s, 'content:Verify', verify);
    for (const name of [
      'content:Extract',
      'content:Transcribe',
      'content:Fallback',
      'content:Save',
    ]) {
      for (let i = 0; i < 600; i++) {
        s.h[name].store.put({
          id: `n${i}`,
          name: 'x',
          state: 'waiting',
          timestamp: NOW + i,
          data: {},
        });
      }
    }
    const t = (
      await s.run(TRACE_QUERY, { flow: FLOW_ID, query: traceIdOf(verify) })
    ).data.flowTrace.trace;
    expect(t.partial).toBe(true);
    const read = Object.values(s.h).reduce((n, x) => n + x.store.jobsRead, 0);
    expect(read).toBeLessThanOrEqual(FLOW_SCAN_TOTAL_MAX);
  });

  it('marks the pending scan partial when it hits pendingScanLimit', async () => {
    const s = setup(lib, { options: { pendingScanLimit: 2 } });
    const verify = entryJob(lib, 'a-v', 'v1', T0);
    await finish(s, 'content:Verify', verify);
    for (let i = 0; i < 3; i++) {
      s.h['content:Extract'].store.put({
        id: `noise${i}`,
        name: 'extract',
        state: 'waiting',
        timestamp: NOW + i,
        data: {},
      });
    }
    const t = (
      await s.run(TRACE_QUERY, { flow: FLOW_ID, query: traceIdOf(verify) })
    ).data.flowTrace.trace;
    expect(t.partial).toBe(true);
    expect(t.status).toBe('COMPLETED'); // end branch, nothing pending found
  });

  it('joins a child trace to the implicit trace of an untraced entry job', async () => {
    const s = setup(lib);
    const cron: RawJob = {
      id: 'cron1',
      name: 'verify',
      data: { videoId: 'v5' },
      timestamp: T0,
      processedOn: T0 + 5,
      finishedOn: T0 + 10,
      state: 'completed',
      ...first(lib),
    };
    await finish(s, 'content:Verify', cron);
    const extract: RawJob = {
      id: 'e1',
      name: 'extract',
      data: withTrace(
        processorJob(lib, 'content:Verify', cron),
        {},
        { flow: FLOW_ID }
      ),
      timestamp: T0 + 20,
      processedOn: T0 + 30,
      finishedOn: T0 + 40,
      state: 'completed',
      ...first(lib),
    };
    await finish(s, 'content:Extract', extract);
    const result = (
      await s.run(TRACE_QUERY, { flow: FLOW_ID, query: traceIdOf(extract) })
    ).data.flowTrace;
    expect(result.trace.jobs.map((j: any) => j.jobId)).toEqual(['cron1', 'e1']);
    expect(result.trace.jobs[1].parentStepId).toBe('content:Verify');
    const implicit = (
      await s.run(TRACE_QUERY, { flow: FLOW_ID, query: 'cron1' })
    ).data.flowTrace;
    expect(implicit).toMatchObject({ matchedBy: 'JOB_ID' });
    expect(implicit.trace.traceId).toBe('content:Verify:cron1');
  });

  it('flags indexFull at the cap and validates the query', async () => {
    const s = setup(lib, { options: { recentTraces: 1 } });
    await finish(s, 'content:Verify', entryJob(lib, 'a-v', 'v1', T0));
    const full = await s.run(TRACE_QUERY, { flow: FLOW_ID, query: 'zzz' });
    expect(full.data.flowTrace.indexFull).toBe(true);
    for (const query of ['', '   ', 'q'.repeat(257)]) {
      const bad = await s.run(TRACE_QUERY, { flow: FLOW_ID, query });
      expect(bad.errors?.[0].message).toBe(
        'Trace search must be 1 to 256 characters'
      );
    }
    const unknown = await s.run(TRACE_QUERY, { flow: 'nope', query: 'x' });
    expect(unknown.data.flowTrace).toBeNull();
    expect(
      (await s.run(SUMMARY_QUERY, { flow: 'nope' })).data.flowSummary
    ).toBeNull();
  });

  it('handles prototype-named steps, keys and queries', async () => {
    const steps = JSON.parse(
      '{"constructor": {"queue": "content:Verify", "next": "toString"}, "toString": {"queue": "content:Save"}}'
    );
    const s = setup(lib, {
      flows: [
        { id: 'proto', entry: 'constructor', trace: { key: 'k' }, steps },
      ],
    });
    const entry: RawJob = {
      id: '__proto__',
      name: 'x',
      data: startTrace({ k: '__proto__' }, { flow: 'proto', now: T0 }),
      timestamp: T0,
      processedOn: T0 + 1,
      finishedOn: T0 + 2,
      state: 'completed',
      ...first(lib),
    };
    await finish(s, 'content:Verify', entry);
    const save: RawJob = {
      id: 'constructor',
      name: 'y',
      data: withTrace(processorJob(lib, 'content:Verify', entry), {
        k: '__proto__',
      }),
      timestamp: T0,
      processedOn: T0 + 1,
      finishedOn: T0 + 2,
      state: 'completed',
      ...first(lib),
    };
    await finish(s, 'content:Save', save);
    await s.persist();
    const summary = await s.run(SUMMARY_QUERY, {
      flow: 'proto',
      since: T0 - 1,
    });
    expect(summary.errors).toBeUndefined();
    expect(
      summary.data.flowSummary.steps.map((st: any) => [st.stepId, st.completed])
    ).toEqual([
      ['constructor', 1],
      ['toString', 1],
    ]);
    expect(summary.data.flowSummary.edges[0]).toMatchObject({
      from: 'constructor',
      to: 'toString',
      count: 1,
    });
    for (const query of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
    ]) {
      const result = await s.run(TRACE_QUERY, { flow: 'proto', query });
      expect(result.errors).toBeUndefined();
    }
    const byKey = await s.run(TRACE_QUERY, {
      flow: 'proto',
      query: '__proto__',
    });
    expect(byKey.data.flowTrace.trace.status).toBe('COMPLETED');
    expect(({} as any).completed).toBeUndefined();
  });
});
