import { MetricsCollector } from '../metrics-collector';
import { normalizeFlows } from '../flow/definition';
import { startTrace, withTrace } from '../flow';
import {
  FLOW_BANDS,
  FLOW_QUEUE_STEP,
  FLOW_UNKNOWN_STEP,
  emptyFlowPoint,
  mergeFlowPoints,
  readFlowStepPoint,
} from '../metrics/flow-metrics';
import {
  denseHistogram,
  histogramBand,
  histogramQuantile,
} from '../metrics/histogram';
import {
  AGENT_LATENCY_BOUNDS_MS,
  latencyPercentile,
} from '../metrics/agent-metrics';
import { FakeRedis } from './helpers/agent-fakes';
import { flowQueue, flush, processorJob } from './helpers/flow-fakes';
import type { FlowHarness, Lib, RawJob } from './helpers/flow-fakes';
import type { FlowConfig, FlowsOptions } from '../flow';
import type { TFlowPoint } from '../metrics/flow-metrics';
import type { MetricsConfig } from '../typings/config';

const PREFIX = 'test::metrics::';
const CONFIG: Required<MetricsConfig> = {
  redisPrefix: PREFIX,
  collectInterval: { minutes: 1 },
  maxMetrics: 4320,
  retention: { raw: 4320, rollups: [{ everyMs: 3600000, keep: 720 }] },
  blacklist: [],
};
const T0 = Date.parse('2026-10-15T10:00:00.000Z');
const FLOW_ID = 'content-ingest';

const NAMES = [
  'content:Verify',
  'content:Extract',
  'content:Transcribe',
  'content:Fallback',
  'content:Save',
  'content:Error',
  'content:Misc',
];

export const FLOW: FlowConfig = {
  id: FLOW_ID,
  label: 'Ingestão de conteúdo',
  entry: 'content:Verify',
  onError: 'content:Error',
  complete: ['content:Save'],
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
    'misc-a': { queue: 'content:Misc', jobs: ['a'] },
    'misc-b': { queue: 'content:Misc', jobs: ['b'] },
  },
};

const silent = () => undefined;

type Setup = {
  redis: FakeRedis;
  h: Record<string, FlowHarness>;
  collector: MetricsCollector;
};

const collectors: MetricsCollector[] = [];
afterEach(() => {
  collectors.splice(0).forEach((c) => c.stopCollecting());
});

function setup(lib: Lib, options: FlowsOptions = {}, flow = FLOW): Setup {
  const redis = new FakeRedis();
  const h: Record<string, FlowHarness> = {};
  for (const name of NAMES) h[name] = flowQueue(redis, name, lib);
  const queues = Object.values(h).map((x) => x.queue);
  const { flows } = normalizeFlows([flow], queues, silent);
  const collector = new MetricsCollector(
    queues,
    CONFIG,
    {},
    { flows, options }
  );
  collector.startCollecting();
  collectors.push(collector);
  return { redis, h, collector };
}

/** First attempt as each lib stores it on a finished job. */
const first = (lib: Lib) => ({ attemptsMade: lib === 'bull' ? 0 : 1 });

const entryJob = (
  lib: Lib,
  id: string,
  over: Partial<RawJob> = {},
  key = 'v1'
): RawJob => ({
  id,
  name: 'verify',
  data: startTrace(
    { videoId: key, tiktokId: `t-${key}` },
    { flow: FLOW_ID, now: T0 }
  ),
  timestamp: T0,
  processedOn: T0 + 1000,
  finishedOn: T0 + 1500,
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
  processedOn: at + 2000,
  finishedOn: at + 2500,
  state: 'completed',
  ...first(lib),
  ...over,
});

async function complete(setup: Setup, queue: string, job: RawJob) {
  setup.h[queue].store.put(job);
  setup.h[queue].emitCompleted(job.id);
  await flush();
}
async function fail(setup: Setup, queue: string, job: RawJob) {
  setup.h[queue].store.put({ ...job, state: 'failed' });
  setup.h[queue].emitFailed(job.id);
  await flush();
}

const drained = (s: Setup): TFlowPoint => {
  const entries = s.collector.flows.drain();
  expect(entries).toHaveLength(1);
  expect(entries[0].queue).toBe(`flow:${FLOW_ID}`);
  return entries[0].point;
};

/** A happy path: Verify > Extract > Transcribe > Save. */
async function happyPath(s: Setup, lib: Lib, key = 'v1', base = '') {
  const verify = entryJob(lib, `${base}1`, {}, key);
  await complete(s, 'content:Verify', verify);
  const extract = childJob(
    lib,
    verify,
    'content:Verify',
    `${base}2`,
    'extract',
    T0 + 2000
  );
  await complete(s, 'content:Extract', extract);
  const transcribe = childJob(
    lib,
    extract,
    'content:Extract',
    `${base}3`,
    'transcribe',
    T0 + 5000
  );
  await complete(s, 'content:Transcribe', transcribe);
  const save = childJob(
    lib,
    transcribe,
    'content:Transcribe',
    `${base}4`,
    'save',
    T0 + 9000
  );
  await complete(s, 'content:Save', save);
  return { verify, extract, transcribe, save };
}

describe.each<Lib>(['bull', 'bullmq'])('flow metrics on %s', (lib) => {
  it('aggregates steps, edges and end-to-end from terminal events', async () => {
    const s = setup(lib);
    const { save } = await happyPath(s, lib);
    const point = drained(s);
    const verify = readFlowStepPoint(point.steps['content:Verify']);
    expect(verify).toMatchObject({ c: 1, f: 0, untraced: 0, retried: 0 });
    expect(verify.prSum).toBe(500);
    expect(verify.wqSum).toBe(1000);
    expect(verify.wqN).toBe(1);
    expect(
      denseHistogram(verify.wq, FLOW_BANDS)[
        histogramBand(1000, [10, 25, 50, 100, 250, 500, 1000])
      ]
    ).toBe(1);
    expect(point.entries).toBe(1);
    expect(point.done).toBe(1);
    expect(point.e2eSum).toBe((save.finishedOn as number) - T0);
    expect({ ...point.edges }).toEqual({
      'content:Verify>content:Extract': 1,
      'content:Extract>content:Transcribe': 1,
      'content:Transcribe>content:Save': 1,
    });
  });

  it('reads the job once per completion event for a flow queue', async () => {
    const s = setup(lib);
    await complete(s, 'content:Verify', entryJob(lib, '1'));
    expect(s.h['content:Verify'].store.getJobCalls).toBe(1);
  });

  it('indexes the trace with its keys and aliases', async () => {
    const s = setup(lib);
    const { verify } = await happyPath(s, lib);
    const traceId = (verify.data as any)._trace.traceId;
    const flows = s.collector.flows;
    expect(await flows.hasTrace(FLOW_ID, traceId)).toBe(true);
    const read = await flows.readTrace(FLOW_ID, traceId);
    expect(read.truncated).toBe(false);
    expect(read.jobs.map((j) => j.s)).toEqual(
      expect.arrayContaining([
        'content:Verify',
        'content:Extract',
        'content:Transcribe',
        'content:Save',
      ])
    );
    const extract = read.jobs.find((j) => j.s === 'content:Extract');
    expect(extract).toMatchObject({
      j: '2',
      a: 1,
      st: 'c',
      t0: T0 + 2000,
      t1: T0 + 4000,
      t2: T0 + 4500,
      p: [s.h['content:Verify'].queue.id, '1'],
    });
    expect(read.keys.sort()).toEqual(['t-v1', 'v1']);
    expect(await flows.tracesByKey(FLOW_ID, 'v1')).toEqual([traceId]);
    expect(await flows.tracesByKey(FLOW_ID, 't-v1')).toEqual([traceId]);
    expect((await flows.traceMeta(FLOW_ID, [traceId])).get(traceId)).toEqual({
      s: T0,
      k: 'v1',
    });
  });

  it('a repeated event does not duplicate the index entry', async () => {
    const s = setup(lib);
    const job = entryJob(lib, '1');
    await complete(s, 'content:Verify', job);
    s.h['content:Verify'].emitCompleted('1');
    await flush();
    const jobsKey = s.collector.flows.traceJobsKey(FLOW_ID);
    const members = Array.from(s.redis.zsets.get(jobsKey)?.keys() ?? []);
    expect(members.filter((m) => !m.includes('\u0000~'))).toHaveLength(1);
  });

  it('counts every failure event as final, attempts left or not (G1)', async () => {
    const s = setup(lib);
    // discard() (Bull) / UnrecoverableError (BullMQ) on attempt 1 of 3:
    // both libs count the failed attempt (attemptsMade 1).
    const discarded = entryJob(lib, '0', {
      opts: { attempts: 3 },
      failedReason: 'UnrecoverableError: bad input',
      processedOn: T0 + 1000,
      finishedOn: T0 + 1200,
      attemptsMade: 1,
    });
    await fail(s, 'content:Verify', discarded);
    const first = readFlowStepPoint(drained(s).steps['content:Verify']);
    expect(first).toMatchObject({ c: 0, f: 1, retried: 0, wqN: 1 });
    const discardedRead = await s.collector.flows.readTrace(
      FLOW_ID,
      (discarded.data as any)._trace.traceId
    );
    expect(discardedRead.jobs[0]).toMatchObject({
      st: 'f',
      a: 1,
      e: 'UnrecoverableError: bad input',
    });

    const base = entryJob(lib, '1', {
      opts: { attempts: 3 },
      failedReason: 'Error: boom\n    at x',
      finishedOn: undefined,
    });
    await fail(s, 'content:Verify', {
      ...base,
      attemptsMade: 3,
      processedOn: T0 + 60000,
      finishedOn: T0 + 61000,
    });
    const verify = readFlowStepPoint(drained(s).steps['content:Verify']);
    expect(verify).toMatchObject({ c: 0, f: 1, retried: 1, wqN: 0 });
    expect(verify.prSum).toBe(1000);
    const traceId = (base.data as any)._trace.traceId;
    const read = await s.collector.flows.readTrace(FLOW_ID, traceId);
    expect(read.jobs[0]).toMatchObject({ st: 'f', a: 3, e: 'Error: boom' });
  });

  it('counts passes through the error step', async () => {
    const s = setup(lib);
    const verify = entryJob(lib, '1');
    await complete(s, 'content:Verify', verify);
    await complete(
      s,
      'content:Error',
      childJob(lib, verify, 'content:Verify', '9', 'save-error', T0 + 3000)
    );
    const point = drained(s);
    expect(point.errors).toBe(1);
    expect(point.edges['content:Verify>content:Error']).toBe(1);
  });

  it('counts a removed job as lost: on its step, or (queue) on a shared queue', async () => {
    const s = setup(lib);
    s.h['content:Verify'].emitCompleted('gone');
    s.h['content:Misc'].emitFailed('gone-too');
    await flush();
    const point = drained(s);
    expect(readFlowStepPoint(point.steps['content:Verify']).lost).toBe(1);
    expect(readFlowStepPoint(point.steps[FLOW_QUEUE_STEP]).lost).toBe(1);
  });

  it('counts jobs without _trace as untraced; an entry gets an implicit trace', async () => {
    const s = setup(lib);
    await complete(s, 'content:Extract', {
      id: '5',
      name: 'extract',
      data: { videoId: 'v9' },
      timestamp: T0,
      processedOn: T0 + 10,
      finishedOn: T0 + 20,
      state: 'completed',
      ...first(lib),
    });
    await complete(s, 'content:Verify', {
      id: '6',
      name: 'cron',
      data: { videoId: 'v9' },
      timestamp: T0,
      processedOn: T0 + 10,
      finishedOn: T0 + 20,
      state: 'completed',
      ...first(lib),
    });
    const point = drained(s);
    expect(readFlowStepPoint(point.steps['content:Extract']).untraced).toBe(1);
    expect(readFlowStepPoint(point.steps['content:Verify']).untraced).toBe(1);
    const flows = s.collector.flows;
    expect(await flows.hasTrace(FLOW_ID, 'content:Verify:6')).toBe(true);
    // Key read from the data via `trace.key`.
    expect(await flows.tracesByKey(FLOW_ID, 'v9')).toEqual([
      'content:Verify:6',
    ]);
    expect(await flows.indexSize(FLOW_ID)).toBe(1);
  });

  it('resolves the parent step by job id in the declared predecessors (no queue in the trace)', async () => {
    const s = setup(lib);
    const verify = entryJob(lib, '1');
    await complete(s, 'content:Verify', verify);
    const transcribe = childJob(
      lib,
      verify,
      'content:Verify',
      '30',
      'transcribe',
      T0
    );
    s.h['content:Transcribe'].store.put(transcribe);
    // Bull sandbox: the processor job has no `queue`.
    const sandboxParent = {
      id: '30',
      name: 'transcribe',
      data: transcribe.data,
      attemptsMade: 0,
      progress: () => 0,
    };
    const save: RawJob = {
      id: '40',
      name: 'save',
      data: withTrace(sandboxParent, {}),
      timestamp: T0,
      processedOn: T0 + 1,
      finishedOn: T0 + 2,
      state: 'completed',
      ...first(lib),
    };
    await complete(s, 'content:Save', save);
    const point = drained(s);
    expect(point.edges['content:Transcribe>content:Save']).toBe(1);
  });

  it('marks an unknown parent as (unknown)', async () => {
    const s = setup(lib);
    const verify = entryJob(lib, '1');
    const save: RawJob = {
      ...childJob(lib, verify, 'not-registered', '40', 'save', T0),
    };
    await complete(s, 'content:Save', save);
    expect(drained(s).edges[`${FLOW_UNKNOWN_STEP}>content:Save`]).toBe(1);
  });

  it('caps jobs per trace with a truncation marker', async () => {
    const s = setup(lib, { jobsPerTrace: 2 });
    const { verify } = await happyPath(s, lib);
    const traceId = (verify.data as any)._trace.traceId;
    const read = await s.collector.flows.readTrace(FLOW_ID, traceId);
    expect(read.jobs).toHaveLength(2);
    expect(read.truncated).toBe(true);
  });

  it('evicts the oldest traces with everything they own: no orphan key or member', async () => {
    const s = setup(lib, { recentTraces: 3 });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const verify = entryJob(lib, `v${i}`, { timestamp: T0 + i }, `key${i}`);
      (verify.data as any)._trace.startedAt = T0 + i;
      ids.push((verify.data as any)._trace.traceId);
      await complete(s, 'content:Verify', verify);
      await complete(
        s,
        'content:Extract',
        childJob(lib, verify, 'content:Verify', `e${i}`, 'extract', T0 + i)
      );
    }
    const flows = s.collector.flows;
    const kept = ids.slice(3);
    const traces = Array.from(
      s.redis.zsets.get(flows.tracesKey(FLOW_ID))!.keys()
    );
    expect(traces.sort()).toEqual([...kept].sort());
    const jobs = Array.from(
      s.redis.zsets.get(flows.traceJobsKey(FLOW_ID))!.keys()
    );
    // 2 jobs + 2 key markers per kept trace, nothing else.
    expect(jobs).toHaveLength(kept.length * 4);
    expect(jobs.every((m) => kept.includes(m.split('\u0000')[0]))).toBe(true);
    const keys = Array.from(
      s.redis.zsets.get(flows.traceKeysKey(FLOW_ID))!.keys()
    );
    expect(keys).toHaveLength(kept.length * 2);
    expect(keys.every((m) => kept.includes(m.split('\u0000')[1]))).toBe(true);
    const meta = Array.from(
      s.redis.hashes.get(flows.traceMetaKey(FLOW_ID))!.keys()
    );
    expect(meta.sort()).toEqual([...kept].sort());
    for (const evicted of ids.slice(0, 3)) {
      expect(await flows.hasTrace(FLOW_ID, evicted)).toBe(false);
      expect(
        await flows.tracesByKey(FLOW_ID, `key${ids.indexOf(evicted)}`)
      ).toEqual([]);
    }
  });

  it('evicts by ingestion time: a future startedAt does not pin a trace (S2)', async () => {
    const s = setup(lib, { recentTraces: 2 });
    const flows = s.collector.flows;
    const future = entryJob(lib, 'f1', {}, 'kf');
    const farAway = Date.now() + 365 * 24 * 3600 * 1000;
    (future.data as any)._trace.startedAt = farAway;
    await complete(s, 'content:Verify', future);
    const futureId = (future.data as any)._trace.traceId;
    const meta = (await flows.traceMeta(FLOW_ID, [futureId])).get(futureId);
    expect(meta!.s).toBeLessThanOrEqual(Date.now());
    const later: string[] = [];
    for (let i = 0; i < 2; i++) {
      const job = entryJob(lib, `n${i}`, {}, `kn${i}`);
      later.push((job.data as any)._trace.traceId);
      await complete(s, 'content:Verify', job);
    }
    expect(await flows.hasTrace(FLOW_ID, futureId)).toBe(false);
    for (const id of later)
      expect(await flows.hasTrace(FLOW_ID, id)).toBe(true);
  });

  it('counts every job of a trace toward jobsPerTrace, whatever the queue id (S4)', async () => {
    const s = setup(lib, { jobsPerTrace: 2 });
    const flows = s.collector.flows as any;
    const [flow] = flows.flows;
    const trace = {
      v: 1,
      traceId: 'tr_00000000000000s4',
      flow: FLOW_ID,
      startedAt: T0,
      hop: 0,
    };
    for (let i = 0; i < 3; i++) {
      await flows._index(
        flow,
        trace,
        {
          s: 'content:Verify',
          q: '\u00e9queue',
          j: `j${i}`,
          a: 1,
          st: 'c',
          t0: T0,
          t1: null,
          t2: null,
        },
        ['key-s4']
      );
    }
    const read = await s.collector.flows.readTrace(FLOW_ID, trace.traceId);
    expect(read.jobs).toHaveLength(2);
    expect(read.truncated).toBe(true);
    expect(read.keys).toEqual(['key-s4']);
  });

  it('writes the series under flow:<id>::flow and clear/clearAll delete every flow key', async () => {
    const s = setup(lib);
    await happyPath(s, lib);
    const flows = s.collector.flows;
    await flows.persist(flows.drain());
    expect(s.redis.lists.has(`${PREFIX}flow:${FLOW_ID}::flow`)).toBe(true);
    expect(s.redis.lists.has(`${PREFIX}flow:${FLOW_ID}::flow::r3600000`)).toBe(
      true
    );
    const points = await flows.extractSince(FLOW_ID, 0);
    expect(points).toHaveLength(1);
    const flowKeys = () =>
      [
        ...s.redis.lists.keys(),
        ...s.redis.zsets.keys(),
        ...s.redis.hashes.keys(),
      ].filter((key) => key.includes('flow:'));
    expect(flowKeys().sort()).toEqual(
      expect.arrayContaining([
        flows.tracesKey(FLOW_ID),
        flows.traceJobsKey(FLOW_ID),
        flows.traceKeysKey(FLOW_ID),
        flows.traceMetaKey(FLOW_ID),
      ])
    );
    await s.collector.clear(s.h['content:Save'].queue.id);
    expect(flowKeys()).toEqual([]);
    await happyPath(s, lib, 'v2', 'b');
    await flows.persist(flows.drain());
    expect(flowKeys().length).toBeGreaterThan(0);
    await s.collector.clearAll();
    expect(flowKeys()).toEqual([]);
  });
});

describe('flow points', () => {
  it('merges counters, histograms, maxima and capped edges', () => {
    const a = emptyFlowPoint(1000, 60000);
    const b = emptyFlowPoint(2000, 60000);
    a.steps.s = { ...readFlowStepPoint({ c: 2, prMax: 5, pr: { 1: 2 } }) };
    b.steps.s = {
      ...readFlowStepPoint({ c: 3, f: 1, prMax: 9, pr: { 1: 1, 4: 2 } }),
    };
    a.edges['x>s'] = 2;
    b.edges['x>s'] = 1;
    a.e2eN = 1;
    a.e2eMax = 7;
    const merged = mergeFlowPoints(a, b);
    expect(merged.timestamp).toBe(1000);
    expect(merged.windowMs).toBe(120000);
    expect(merged.steps.s).toMatchObject({ c: 5, f: 1, prMax: 9 });
    expect({ ...merged.steps.s.pr }).toEqual({ 1: 3, 4: 2 });
    expect(merged.edges['x>s']).toBe(3);
    expect(merged.e2eMax).toBe(7);
  });

  it('survives prototype-named steps/edges and garbage from Redis', () => {
    const raw = JSON.parse(
      '{"timestamp": 1, "windowMs": 1, "h": 1,' +
        ' "steps": {"constructor": {"c": 1, "pr": {"__proto__": 3, "0": "x", "-1": 2, "99": 1}},' +
        ' "__proto__": {"c": 2}, "toString": {"c": "NaN"}},' +
        ' "edges": {"constructor>toString": 2, "__proto__": 1, "x": "bad"},' +
        ' "e2e": null, "e2eN": "1"}'
    );
    const merged = mergeFlowPoints(raw, raw);
    expect(merged.steps['constructor'].c).toBe(2);
    expect(merged.steps['__proto__'].c).toBe(4);
    expect(merged.steps['toString'].c).toBe(0);
    expect({ ...merged.steps['constructor'].pr }).toEqual({});
    expect(merged.edges['constructor>toString']).toBe(4);
    expect(merged.edges['__proto__']).toBe(2);
    expect(Number.isFinite(merged.e2eN)).toBe(true);
    expect(({} as any).c).toBeUndefined();
  });

  it('caps edge keys at 64 per point, the rest under (other)', () => {
    const point = emptyFlowPoint();
    for (let i = 0; i < 70; i++) point.edges[`a${i}>b`] = 1;
    const merged = mergeFlowPoints(emptyFlowPoint(), point);
    expect(Object.keys(merged.edges)).toHaveLength(64);
    expect(merged.edges['(other)']).toBe(7);
  });
});

describe('shared histogram (pure refactor of the agent percentile)', () => {
  it('matches latencyPercentile on the agent bands', () => {
    const lat = new Array(AGENT_LATENCY_BOUNDS_MS.length + 1).fill(0);
    lat[1] = 4;
    lat[3] = 2;
    lat[lat.length - 1] = 1;
    for (const q of [0.1, 0.5, 0.9, 0.95, 1]) {
      expect(histogramQuantile(lat, AGENT_LATENCY_BOUNDS_MS, q, 400000)).toBe(
        latencyPercentile(lat, q, 400000)
      );
    }
    expect(histogramQuantile([], AGENT_LATENCY_BOUNDS_MS, 0.5, 0)).toBeNull();
  });

  it('reads sparse histograms defensively', () => {
    expect(denseHistogram({ 0: 1, 2: 'x', 5: -1, 1.5: 3, 3: 2 }, 4)).toEqual([
      1, 0, 0, 2,
    ]);
    expect(denseHistogram('nope', 2)).toEqual([0, 0]);
    expect(denseHistogram([1, 2], 2)).toEqual([0, 0]);
  });
});
