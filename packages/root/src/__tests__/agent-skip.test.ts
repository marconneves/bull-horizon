import { graphql } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from '../gql/type-defs';
import { resolvers } from '../gql/resolvers';
import {
  AgentsDataSource,
  BullDataSource,
  MetricsDataSource,
  PoliciesDataSource,
} from '../gql/data-sources';
import { MetricsCollector } from '../metrics-collector';
import {
  AgentMetrics,
  emptyAgentPoint,
  mergeAgentPoints,
} from '../metrics/agent-metrics';
import {
  AGENT_RUN_LOG_PREFIX,
  AGENT_RUN_SKIP_LOG_PREFIX,
  createAgentRun,
  formatAgentRunSkipLine,
  markAgentRunSkipped,
  parseAgentRunLine,
  parseAgentRunSkipLine,
} from '../agent';
import { FakeRedis, bullHarness, bullmqHarness } from './helpers/agent-fakes';
import type { AgentRunV1 } from '../agent';
import type { MetricsConfig } from '../typings/config';

const METRICS: Required<MetricsConfig> = {
  redisPrefix: 'test::metrics::',
  collectInterval: { minutes: 1 },
  maxMetrics: 4320,
  retention: { raw: 4320, rollups: [] },
  blacklist: [],
};
const T0 = Date.parse('2026-10-14T19:05:28.514Z');
const iso = (ms: number) => new Date(ms).toISOString();
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

const fakeJob = (attemptsMade = 0) => {
  const lines: string[] = [];
  return {
    lines,
    job: {
      attemptsMade,
      log: async (row: string) => {
        lines.push(row);
      },
    },
  };
};

const run = (overrides: Partial<AgentRunV1> = {}): AgentRunV1 => ({
  v: 1,
  detail: 'basic',
  model: 'gemini-3.8-flash',
  attempt: 1,
  startedAt: iso(T0),
  finishedAt: iso(T0 + 1000),
  durationMs: 1000,
  inputTokens: 100,
  outputTokens: 10,
  steps: [],
  final: { cards: [] },
  error: null,
  ...overrides,
});
const runLine = (r: AgentRunV1) => AGENT_RUN_LOG_PREFIX + JSON.stringify(r);
const skipLine = (attempt: number, at: number, reason = 'already-answered') =>
  formatAgentRunSkipLine(attempt, reason, new Date(at));

describe('recorder.skip / markAgentRunSkipped', () => {
  it('writes one skip line with the attempt, clipped reason and time', async () => {
    const { job, lines } = fakeJob(1);
    const recorder = createAgentRun({
      job,
      model: 'm',
      now: () => new Date(T0),
    });

    await recorder.skip('x'.repeat(500));

    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith(AGENT_RUN_SKIP_LOG_PREFIX)).toBe(true);
    // Never mistaken for a run line.
    expect(parseAgentRunLine(lines[0])).toBeNull();
    expect(parseAgentRunSkipLine(lines[0])).toEqual({
      v: 1,
      // Bull: attemptsMade 1 inside the processor = second attempt.
      attempt: 2,
      reason: 'x'.repeat(119) + '…',
      at: iso(T0),
    });
  });

  it('omits an empty or missing reason', async () => {
    const { job, lines } = fakeJob();
    await markAgentRunSkipped(job);
    await markAgentRunSkipped(job, { reason: '' });
    expect(lines.map((l) => parseAgentRunSkipLine(l))).toEqual([
      expect.not.objectContaining({ reason: expect.anything() }),
      expect.not.objectContaining({ reason: expect.anything() }),
    ]);
  });

  it('first of finish/fail/skip wins', async () => {
    const a = fakeJob();
    const finished = createAgentRun({ job: a.job, model: 'm' });
    await finished.finish('done');
    await finished.skip('late');
    expect(a.lines).toHaveLength(1);
    expect(parseAgentRunLine(a.lines[0])).not.toBeNull();

    const b = fakeJob();
    const skipped = createAgentRun({ job: b.job, model: 'm' });
    await Promise.all([skipped.skip('fresh'), skipped.skip('again')]);
    await skipped.finish('done');
    await skipped.fail(new Error('x'));
    expect(b.lines).toHaveLength(1);
    expect(parseAgentRunSkipLine(b.lines[0])?.reason).toBe('fresh');
  });

  it('never throws nor rejects, whatever job.log does', async () => {
    const onError = jest.fn();
    const throwing = {
      attemptsMade: 0,
      log: () => {
        throw new Error('sync');
      },
    };
    const rejecting = {
      attemptsMade: 0,
      log: () => Promise.reject(new Error('async')),
    };
    await expect(
      createAgentRun({ job: throwing, model: 'm', onError }).skip('r')
    ).resolves.toBeUndefined();
    await expect(
      markAgentRunSkipped(rejecting, { reason: 'r', onError })
    ).resolves.toBeUndefined();
    await expect(
      markAgentRunSkipped(null as any, {
        onError: () => {
          throw new Error('handler');
        },
      })
    ).resolves.toBeUndefined();
    await expect(
      markAgentRunSkipped(
        { attemptsMade: 0, log: () => new Promise(() => undefined) },
        { writeTimeoutMs: 5, onError }
      )
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });

  it('uses an explicit attempt, and keeps notes from faking a skip line', async () => {
    const { job, lines } = fakeJob();
    await markAgentRunSkipped(job, { attempt: 4 });
    const recorder = createAgentRun({ job, model: 'm' });
    recorder.note(AGENT_RUN_SKIP_LOG_PREFIX + '{"v":1}');
    await flush();
    expect(lines).toHaveLength(1);
    expect(parseAgentRunSkipLine(lines[0])?.attempt).toBe(4);
  });

  it('rejects malformed or oversized skip lines', () => {
    for (const line of [
      'plain',
      AGENT_RUN_SKIP_LOG_PREFIX + '{bad',
      AGENT_RUN_SKIP_LOG_PREFIX + '{"v":2,"attempt":1,"at":"x"}',
      AGENT_RUN_SKIP_LOG_PREFIX + '{"v":1,"at":"x"}',
      AGENT_RUN_SKIP_LOG_PREFIX +
        JSON.stringify({ v: 1, attempt: 1, at: 'x', reason: 'r'.repeat(5000) }),
    ]) {
      expect(parseAgentRunSkipLine(line)).toBeNull();
    }
  });

  it('merges skipped as a sum, old points reading as 0', () => {
    const old = emptyAgentPoint();
    delete old.skipped;
    expect(
      mergeAgentPoints(old, { ...emptyAgentPoint(), skipped: 3 }).skipped
    ).toBe(3);
  });
});

describe.each([
  ['bull', bullHarness],
  ['bullmq', bullmqHarness],
] as const)('skipped attempts on %s', (_lib, makeHarness) => {
  let stops: Array<() => void> = [];
  afterEach(() => {
    stops.forEach((stop) => stop());
    stops = [];
  });

  const collectorOn = () => {
    const redis = new FakeRedis();
    const harness = makeHarness(redis, { detail: 'basic' });
    const agents = new AgentMetrics({
      config: METRICS,
      agents: { pricing: {}, recentRuns: 2000 },
      client: async () => redis as any,
      rereadDelayMs: 5,
    });
    stops.push(() => agents.stop());
    const drain = () => agents.drain([harness.queue])[0]?.point;
    const indexSize = () =>
      redis.hashes.get(agents.runsDataKey(harness.queue.id))?.size ?? 0;
    return { harness, agents, drain, indexSize };
  };

  it('counts a skipped attempt as skipped, not unrecorded, and indexes nothing', async () => {
    const { harness, agents, drain, indexSize } = collectorOn();
    harness.store.add('1', 'reply', [skipLine(1, T0 + 10)], {
      processedOn: T0,
    });

    await agents.onJobFinished(harness.queue, '1');

    expect(drain()).toMatchObject({ runs: 0, skipped: 1, unrecorded: 0 });
    expect(indexSize()).toBe(0);
  });

  it('counts the skip without processedOn when no run line exists', async () => {
    const { harness, agents, drain } = collectorOn();
    harness.store.add('1', 'reply', [skipLine(1, T0)]);

    await agents.onJobFinished(harness.queue, '1');
    await flush();

    expect(drain()).toMatchObject({ skipped: 1, unrecorded: 0 });
  });

  it('lets a run line of the same attempt win over a skip line', async () => {
    const { harness, agents, drain } = collectorOn();
    harness.store.add('1', 'reply', [runLine(run()), skipLine(1, T0 + 2000)], {
      processedOn: T0,
    });

    await agents.onJobFinished(harness.queue, '1');

    expect(drain()).toMatchObject({ runs: 1, skipped: 0, unrecorded: 0 });
  });

  it('counts a run for an attempt after an earlier skipped one', async () => {
    const { harness, agents, drain } = collectorOn();
    harness.store.add(
      '1',
      'reply',
      [skipLine(1, T0 - 5000), runLine(run({ attempt: 2 }))],
      { processedOn: T0 }
    );

    await agents.onJobFinished(harness.queue, '1');

    expect(drain()).toMatchObject({ runs: 1, skipped: 0, unrecorded: 0 });
  });

  it('keeps counting unrecorded when there is no line at all', async () => {
    const { harness, agents, drain } = collectorOn();
    harness.store.add('1', 'reply', ['plain line'], { processedOn: T0 });

    await agents.onJobFinished(harness.queue, '1');
    await flush();

    expect(drain()).toMatchObject({ skipped: 0, unrecorded: 1 });
  });

  it('end to end: recorder.skip in the worker, skipped on the summary, no agentRuns', async () => {
    const redis = new FakeRedis();
    const harness = makeHarness(redis, { detail: 'basic' });
    const queue = harness.queue;
    Object.defineProperty(queue, 'client', {
      get: () => Promise.resolve(redis),
    });
    const map = new Map([[queue.id, queue]]);
    const collector = new MetricsCollector([queue], METRICS, {});
    stops.push(() => collector.agents.stop());
    const { job, lines } = fakeJob();
    await createAgentRun({ job, model: 'm' }).skip('content-fresh');
    harness.store.add('1', 'reply', lines);
    await collector.agents.onJobFinished(queue, '1');
    await collector.agents.persist(collector.agents.drain([queue], Date.now()));

    const schema = makeExecutableSchema({
      typeDefs: typeDefs as any,
      resolvers: resolvers as any,
    });
    const { data, errors } = await graphql({
      schema,
      source: `query($queue: ID!) {
        agentsSummary(since: 1) { runs unrecorded skipped }
        job(queue: $queue, id: "1") { agentRuns { attempt } }
      }`,
      contextValue: {
        dataSources: {
          bull: new BullDataSource([queue], map, {}),
          metrics: new MetricsDataSource(collector),
          policies: new PoliciesDataSource(map),
          agents: new AgentsDataSource([queue], map, collector, {}),
        },
      },
      variableValues: { queue: queue.id },
    });

    expect(errors).toBeUndefined();
    expect(data?.agentsSummary).toEqual({ runs: 0, unrecorded: 0, skipped: 1 });
    expect(data?.job).toEqual({ agentRuns: [] });
  });
});
