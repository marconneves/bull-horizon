import { MetricsCollector } from '../metrics-collector';
import {
  AGENT_LATENCY_BOUNDS_MS,
  AGENT_MAX_TOOLS,
  AGENT_OTHER_KEY,
  AgentMetrics,
  accumulateAgentRun,
  agentRunOutcome,
  emptyAgentPoint,
  latencyBand,
  latencyPercentile,
  mergeAgentPoints,
} from '../metrics/agent-metrics';
import { AGENT_RUN_LOG_PREFIX } from '../agent';
import type { AgentRunV1 } from '../agent';
import { FakeRedis, bullHarness, bullmqHarness } from './helpers/agent-fakes';
import type { Harness } from './helpers/agent-fakes';
import type { MetricsConfig } from '../typings/config';

const HOUR_MS = 3600000;
const PREFIX = 'test::metrics::';
const CONFIG: Required<MetricsConfig> = {
  redisPrefix: PREFIX,
  collectInterval: { minutes: 1 },
  maxMetrics: 4320,
  retention: { raw: 4320, rollups: [{ everyMs: HOUR_MS, keep: 720 }] },
  blacklist: [],
};

const T0 = Date.parse('2026-10-14T19:05:28.514Z');

const run = (overrides: Partial<AgentRunV1> = {}): AgentRunV1 => ({
  v: 1,
  detail: 'basic',
  model: 'gemini-3.8-flash',
  attempt: 1,
  startedAt: new Date(T0).toISOString(),
  finishedAt: new Date(T0 + 14814).toISOString(),
  durationMs: 14814,
  inputTokens: 9534,
  outputTokens: 1057,
  steps: [
    {
      step: 1,
      startedAt: new Date(T0 + 50).toISOString(),
      durationMs: 4086,
      finishReason: 'tool-calls',
      inputTokens: 2788,
      outputTokens: 154,
      tools: [
        {
          name: 'listRecipes',
          ok: true,
          durationMs: 55,
          summary: '0 results',
          empty: true,
        },
      ],
    },
    {
      step: 2,
      startedAt: new Date(T0 + 4140).toISOString(),
      durationMs: 3431,
      finishReason: 'stop',
      inputTokens: 6746,
      outputTokens: 903,
      tools: [],
    },
  ],
  final: { cards: [{ type: 'RECIPE', title: 'Crepioca' }] },
  error: null,
  ...overrides,
});

const line = (r: AgentRunV1) => AGENT_RUN_LOG_PREFIX + JSON.stringify(r);

/** Lets the voided async ingestion settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

const buildCollector = (
  harness: Harness,
  redis: FakeRedis,
  recentRuns?: number
) => {
  // `client` is read through the first queue; point it at the fake.
  Object.defineProperty(harness.queue, 'client', {
    get: () => Promise.resolve(redis),
  });
  const collector = new MetricsCollector(
    [harness.queue],
    CONFIG,
    recentRuns ? { recentRuns } : {}
  );
  collector.startCollecting();
  return collector;
};

describe.each([
  ['bull', bullHarness],
  ['bullmq', bullmqHarness],
] as const)('agent ingestion on %s', (_provider, makeHarness) => {
  let redis: FakeRedis;
  let harness: Harness;
  let collector: MetricsCollector;

  beforeEach(() => {
    redis = new FakeRedis();
    harness = makeHarness(redis, { jobs: ['reply'], detail: 'basic' });
    collector = buildCollector(harness, redis);
  });
  afterEach(() => collector.stopCollecting());

  const drain = () => collector.agents.drain([harness.queue]);
  const runsKey = () => collector.agents.runsKey(harness.queue.id);

  it('ingests the run line of a completed job', async () => {
    harness.store.add('1', 'reply', ['[início] modelo x', line(run())]);
    harness.emitCompleted('1');
    await flush();

    const [{ point }] = drain();
    expect(point).toMatchObject({
      runs: 1,
      failed: 0,
      emptyRuns: 1,
      durSum: 14814,
      durMax: 14814,
      toolMs: 55,
      llmMs: 4086 - 55 + 3431,
      outcomes: { stop: 1 },
      tools: { listRecipes: { c: 1, e: 0, z: 1, ms: 55 } },
      models: { 'gemini-3.8-flash': { r: 1, i: 9534, o: 1057 } },
    });
    expect(point.steps).toEqual([0, 1, 0, 0, 0]);
    expect(point.lat[latencyBand(14814)]).toBe(1);

    const [entry] = await collector.agents.getRecentRuns(harness.queue.id, 0);
    expect(entry).toMatchObject({
      j: '1',
      a: 1,
      n: 'reply',
      d: 14814,
      oc: 'stop',
      s: 2,
      tc: [['listRecipes', 1, 1]],
    });
  });

  it('ingests every attempt of a failed job, once, on the terminal event', async () => {
    harness.store.add('2', 'reply', [
      line(
        run({
          attempt: 1,
          error: 'quota',
          startedAt: '2026-10-14T19:00:00.000Z',
        })
      ),
      line(
        run({
          attempt: 2,
          error: 'quota',
          startedAt: '2026-10-14T19:01:00.000Z',
        })
      ),
    ]);
    harness.emitFailed('2');
    harness.emitFailed('2'); // duplicate event, or a second monitor replica
    await flush();

    const [{ point }] = drain();
    expect(point.runs).toBe(2);
    expect(point.failed).toBe(2);
    expect(point.outcomes).toEqual({ error: 2 });
    expect(redis.zsets.get(runsKey())?.size).toBe(2);
  });

  it('counts a job removed before the read as lost', async () => {
    harness.emitCompleted('gone');
    await flush();

    const [{ point }] = drain();
    expect(point).toMatchObject({ runs: 0, lost: 1 });
  });

  it('ignores jobs outside `ai.jobs`', async () => {
    harness.store.add('3', 'translate', [line(run())]);
    harness.emitCompleted('3');
    await flush();

    expect(drain()).toEqual([]);
  });

  it('writes sparse points into the agent series and its rollups', async () => {
    harness.store.add('4', 'reply', [line(run())]);
    harness.emitCompleted('4');
    await flush();
    await collector.agents.persist(drain());
    // Idle tick: nothing new, nothing written.
    await collector.agents.persist(drain());

    const raw = redis.lists.get(`${PREFIX}${harness.queue.id}::ai`);
    expect(raw).toHaveLength(1);
    expect(
      redis.lists.get(`${PREFIX}${harness.queue.id}::ai::r${HOUR_MS}`)
    ).toHaveLength(1);
    const points = await collector.agents.extractSince(harness.queue.id, 1);
    expect(points[0].runs).toBe(1);
  });

  it('clears the series, the index and its data along with the throughput', async () => {
    harness.store.add('5', 'reply', [line(run())]);
    harness.emitCompleted('5');
    await flush();
    await collector.agents.persist(drain());

    await collector.clear(harness.queue.id);

    for (const key of collector.agents.keys(harness.queue.id)) {
      expect(
        redis.lists.has(key) || redis.zsets.has(key) || redis.hashes.has(key)
      ).toBe(false);
    }
    expect(collector.agents.keys(harness.queue.id)).toHaveLength(4);
  });
});

describe('AgentMetrics index and re-read', () => {
  const setup = (recentRuns = 2000, rereadDelayMs = 2000) => {
    const redis = new FakeRedis();
    const harness = bullHarness(redis, true);
    const agents = new AgentMetrics({
      config: CONFIG,
      agents: { pricing: {}, recentRuns },
      client: async () => redis as any,
      rereadDelayMs,
    });
    return { redis, harness, agents };
  };

  it('trims the recent runs index, from the zset and the hash alike', async () => {
    const { redis, harness, agents } = setup(2);
    for (const id of ['a', 'b', 'c']) {
      const startedAt = new Date(T0 + id.charCodeAt(0) * 1000).toISOString();
      harness.store.add(id, 'reply', [
        line(run({ startedAt, finishedAt: startedAt })),
      ]);
      await agents.onJobFinished(harness.queue, id);
    }
    const runsKey = agents.runsKey(harness.queue.id);
    const members = Array.from(redis.zsets.get(runsKey)?.keys() ?? []);
    expect(members.map((m) => m.split(':')[0]).sort()).toEqual(['b', 'c']);
    expect(
      Array.from(
        redis.hashes.get(agents.runsDataKey(harness.queue.id))?.keys() ?? []
      ).sort()
    ).toEqual(members.sort());
    // Newest first.
    const recent = await agents.getRecentRuns(harness.queue.id, 0);
    expect(recent.map((e) => e.j)).toEqual(['c', 'b']);
  });

  it('re-reads once when the line was not there yet', async () => {
    const { harness, agents } = setup(2000, 5);
    harness.store.add('late', 'reply', ['[início] modelo x']);
    await agents.onJobFinished(harness.queue, 'late');
    // The helper's un-awaited finish() lands after the event.
    harness.store.logs.get('late')?.push(line(run()));
    await flush();

    const [{ point }] = agents.drain([harness.queue]);
    expect(point.runs).toBe(1);
    agents.stop();
  });

  it('cuts the read run to the queue level before indexing', async () => {
    const { redis, harness, agents } = setup();
    const full = run({ detail: 'full', error: 'boom' });
    (full.steps[0].tools[0] as any).output = { secret: 'S3CRET' };
    (full.steps[0] as any).text = 'S3CRET';
    harness.store.add('f', 'reply', [line(full)]);
    await agents.onJobFinished(harness.queue, 'f');

    const data = Array.from(
      redis.hashes.get(agents.runsDataKey(harness.queue.id))?.values() ?? []
    );
    expect(data.join('')).not.toContain('S3CRET');
  });
});

describe('agent point math', () => {
  it('merges by summing, max-ing durMax and adding arrays position-wise', () => {
    const a = emptyAgentPoint(1000, 60000);
    const b = emptyAgentPoint(2000, 60000);
    accumulateAgentRun(a, run());
    accumulateAgentRun(
      b,
      run({ durationMs: 30000, error: 'x', model: 'other' })
    );
    const merged = mergeAgentPoints(a, b);
    expect(merged).toMatchObject({
      timestamp: 1000,
      windowMs: 120000,
      runs: 2,
      failed: 1,
      durSum: 44814,
      durMax: 30000,
      outcomes: { stop: 1, error: 1 },
      tools: { listRecipes: { c: 2, e: 0, z: 2, ms: 110 } },
    });
    expect(Object.keys(merged.models).sort()).toEqual([
      'gemini-3.8-flash',
      'other',
    ]);
    expect(merged.lat.reduce((x, y) => x + y, 0)).toBe(2);
    expect(merged.steps).toEqual([0, 2, 0, 0, 0]);
  });

  it('folds tools past the cardinality cap into (other)', () => {
    const point = emptyAgentPoint();
    const tools = Array.from({ length: AGENT_MAX_TOOLS + 10 }, (_, i) => ({
      name: `tool-${i}`,
      ok: true,
      durationMs: 1,
      summary: '',
    }));
    accumulateAgentRun(point, run({ steps: [{ ...run().steps[0], tools }] }));
    expect(Object.keys(point.tools)).toHaveLength(AGENT_MAX_TOOLS + 1);
    expect(point.tools[AGENT_OTHER_KEY].c).toBe(10);

    // Merging two capped points stays capped too.
    const other = emptyAgentPoint();
    accumulateAgentRun(
      other,
      run({
        steps: [
          {
            ...run().steps[0],
            tools: tools.map((t) => ({ ...t, name: `x-${t.name}` })),
          },
        ],
      })
    );
    expect(Object.keys(mergeAgentPoints(point, other).tools)).toHaveLength(
      AGENT_MAX_TOOLS + 1
    );
  });

  it('estimates percentiles by interpolating inside the band', () => {
    const lat = new Array(AGENT_LATENCY_BOUNDS_MS.length + 1).fill(0);
    // Ten runs in (1000, 2000]: p50 lands half-way through that band.
    lat[latencyBand(1500)] = 10;
    expect(latencyPercentile(lat, 0.5, 1999)).toBeCloseTo(1500, 0);
    expect(latencyPercentile(lat, 0.95, 1999)).toBeCloseTo(1950, 0);
    // Never above the observed maximum.
    expect(latencyPercentile(lat, 0.95, 1700)).toBe(1700);
  });

  it('answers durMax for the overflow band and null without runs', () => {
    const lat = new Array(AGENT_LATENCY_BOUNDS_MS.length + 1).fill(0);
    expect(latencyPercentile(lat, 0.5, 0)).toBeNull();
    lat[AGENT_LATENCY_BOUNDS_MS.length] = 1;
    expect(latencyPercentile(lat, 0.5, 400000)).toBe(400000);
    expect(latencyBand(400000)).toBe(AGENT_LATENCY_BOUNDS_MS.length);
    expect(latencyBand(500)).toBe(0);
  });

  it('derives the outcome', () => {
    expect(agentRunOutcome(run())).toBe('stop');
    expect(agentRunOutcome(run({ error: 'x' }))).toBe('error');
    expect(agentRunOutcome(run({ steps: [run().steps[0]] }))).toBe('max-steps');
    expect(agentRunOutcome(run({ steps: [] }))).toBe('unknown');
  });
});

describe('Queue.agent', () => {
  it('normalizes the config and filters job names', () => {
    const redis = new FakeRedis();
    const basic = bullHarness(redis, true).queue;
    expect(basic.agent).toEqual({ detail: 'basic', label: 'brand-app:ai' });
    expect(basic.isAgentJob('anything')).toBe(true);

    const scoped = bullmqHarness(redis, {
      jobs: ['reply'],
      detail: 'full',
      label: 'Assistants',
    }).queue;
    expect(scoped.agent).toMatchObject({ detail: 'full', label: 'Assistants' });
    expect(scoped.isAgentJob('reply')).toBe(true);
    expect(scoped.isAgentJob('translate')).toBe(false);

    const plain = bullHarness(redis, false).queue;
    expect(plain.agent).toBeUndefined();
    expect(plain.isAgentJob('reply')).toBe(false);
  });

  it('reads a bounded tail of the logs on both adapters', async () => {
    const redis = new FakeRedis();
    for (const harness of [
      bullHarness(redis, true),
      bullmqHarness(redis, true),
    ]) {
      harness.store.add('1', 'reply', ['a', 'b', 'c']);
      const { logs, count } = await harness.queue.getJobLogs('1', -2, -1);
      expect(logs).toEqual(['b', 'c']);
      expect(count).toBe(3);
    }
  });
});

describe('AgentMetrics re-read targets the last attempt (QA 004 F2)', () => {
  it.each([
    ['bull', bullHarness],
    ['bullmq', bullmqHarness],
  ] as const)(
    '%s: no re-read once the line of the attempt that ended is there',
    async (_lib, makeHarness) => {
      const redis = new FakeRedis();
      const harness = makeHarness(redis, true);
      const agents = new AgentMetrics({
        config: CONFIG,
        agents: { pricing: {}, recentRuns: 2000 },
        client: async () => redis as any,
        rereadDelayMs: 5,
      });
      const second = run({
        attempt: 2,
        startedAt: new Date(T0 + 5000).toISOString(),
        finishedAt: new Date(T0 + 6000).toISOString(),
      });
      harness.store.add(
        'j',
        'reply',
        [line(run({ attempt: 1, error: 'boom' })), line(second)],
        { processedOn: T0 + 4990 }
      );
      await agents.onJobFinished(harness.queue, 'j');
      // A line showing up later would only be ingested by a re-read.
      harness.store.logs.get('j')?.push(
        line({
          ...second,
          attempt: 3,
          startedAt: new Date(T0 + 7000).toISOString(),
        })
      );
      await flush();
      const [{ point }] = agents.drain([harness.queue]);
      agents.stop();
      expect(point.runs).toBe(2);
    }
  );
});
