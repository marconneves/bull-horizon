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
  agentRunFromReturnValue,
  emptyAgentPoint,
  mergeAgentPoints,
  resetAgentDetailMismatchWarnings,
} from '../metrics/agent-metrics';
import { AGENT_RUN_LOG_PREFIX, AGENT_RUN_MAX_READ_CHARS } from '../agent';
import { FakeRedis, bullHarness, bullmqHarness } from './helpers/agent-fakes';
import type { AgentQueueConfig, AgentRunV1 } from '../agent';
import type { MetricsConfig } from '../typings/config';

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
const T0 = Date.parse('2026-10-14T19:05:28.514Z');
const iso = (ms: number) => new Date(ms).toISOString();
const SECRET = 'patient has diabetes';

/** What an old brand worker returns: AiTrace v1, no `detail`, full content. */
const trace = (overrides: Partial<AgentRunV1> = {}): AgentRunV1 => ({
  v: 1,
  model: 'gemini-3.8-flash',
  attempt: 1,
  startedAt: iso(T0),
  finishedAt: iso(T0 + 1000),
  durationMs: 1000,
  inputTokens: 100,
  outputTokens: 10,
  steps: [
    {
      step: 1,
      startedAt: iso(T0),
      durationMs: 1000,
      finishReason: 'stop',
      inputTokens: 100,
      outputTokens: 10,
      text: SECRET,
      tools: [
        {
          name: 'listRecipes',
          ok: true,
          durationMs: 10,
          summary: '2 results',
          input: { q: SECRET },
          output: { recipes: [SECRET] },
        },
      ],
    },
  ],
  final: { text: SECRET, cards: [{ type: 'RECIPE', title: 'Crepioca' }] },
  error: null,
  input: { conversationId: 'c-1', text: SECRET },
  ...overrides,
});
const line = (r: AgentRunV1) => AGENT_RUN_LOG_PREFIX + JSON.stringify(r);
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('agentRunFromReturnValue', () => {
  it('accepts an object or a JSON string, rejects anything else', () => {
    expect(
      agentRunFromReturnValue({ returnvalue: trace(), attemptsMade: 1 })
    ).toMatchObject({ v: 1, attempt: 1 });
    expect(
      agentRunFromReturnValue({
        returnvalue: JSON.stringify(trace({ attempt: 2 })),
        attemptsMade: 2,
      })
    ).toMatchObject({ attempt: 2 });
    for (const returnvalue of [
      null,
      undefined,
      'ok',
      '{bad json',
      42,
      [trace()],
      { ok: true },
      { ...trace(), v: 2 },
    ]) {
      expect(agentRunFromReturnValue({ returnvalue, attemptsMade: 1 })).toBe(
        null
      );
    }
  });

  it('derives a missing attempt from the job', () => {
    const { attempt: _omit, ...noAttempt } = trace();
    expect(
      agentRunFromReturnValue({ returnvalue: noAttempt, attemptsMade: 3 })
        ?.attempt
    ).toBe(3);
    expect(
      agentRunFromReturnValue({ returnvalue: noAttempt, attemptsMade: 0 })
        ?.attempt
    ).toBe(1);
  });

  it('ignores a returnvalue above the read cap', () => {
    const big = trace({
      final: { text: 'x'.repeat(AGENT_RUN_MAX_READ_CHARS), cards: [] },
    });
    expect(agentRunFromReturnValue({ returnvalue: big, attemptsMade: 1 })).toBe(
      null
    );
    expect(
      agentRunFromReturnValue({
        returnvalue: JSON.stringify(big),
        attemptsMade: 1,
      })
    ).toBe(null);
  });

  it('merges unrecorded as a sum, old points reading as 0', () => {
    const old = emptyAgentPoint();
    delete old.unrecorded;
    const next = { ...emptyAgentPoint(), unrecorded: 2 };
    expect(mergeAgentPoints(old, next).unrecorded).toBe(2);
    expect(mergeAgentPoints(next, old).unrecorded).toBe(2);
  });
});

describe.each([
  ['bull', bullHarness],
  ['bullmq', bullmqHarness],
] as const)('returnvalue fallback on %s', (_lib, makeHarness) => {
  let warn: jest.SpyInstance;
  let stops: Array<() => void> = [];
  beforeEach(() => {
    resetAgentDetailMismatchWarnings();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    stops.forEach((stop) => stop());
    stops = [];
    warn.mockRestore();
  });

  const collectorOn = (ai: AgentQueueConfig = { detail: 'basic' }) => {
    const redis = new FakeRedis();
    const harness = makeHarness(redis, ai);
    const agents = new AgentMetrics({
      config: METRICS,
      agents: { pricing: {}, recentRuns: 2000 },
      client: async () => redis as any,
      rereadDelayMs: 5,
    });
    stops.push(() => agents.stop());
    const drain = () => {
      const [entry] = agents.drain([harness.queue]);
      return entry?.point;
    };
    const indexText = () =>
      Array.from(
        redis.hashes.get(agents.runsDataKey(harness.queue.id))?.values() ?? []
      ).join('\n');
    return { redis, harness, agents, drain, indexText };
  };

  it('ingests the returnvalue run after the reread, cut to basic in the index', async () => {
    const { harness, agents, drain, indexText } = collectorOn();
    harness.store.add('1', 'reply', ['plain line'], { returnvalue: trace() });

    await agents.onJobFinished(harness.queue, '1');
    await flush();

    const point = drain();
    expect(point).toMatchObject({ runs: 1, unrecorded: 0 });
    const index = indexText();
    expect(index).toContain('"c":"c-1"');
    expect(index).not.toContain(SECRET);
    // Warned about the full content, without the content.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(SECRET);
  });

  it('accepts a returnvalue stored as a JSON string', async () => {
    const { harness, agents, drain } = collectorOn();
    harness.store.add('1', 'reply', [], {
      returnvalue: JSON.stringify(trace()),
    });

    await agents.onJobFinished(harness.queue, '1', true);

    expect(drain()?.runs).toBe(1);
  });

  it('never duplicates an attempt a log line already covers', async () => {
    const { harness, agents, drain } = collectorOn();
    harness.store.add('1', 'reply', [line(trace())], {
      returnvalue: trace(),
    });

    await agents.onJobFinished(harness.queue, '1', true);
    await agents.onJobFinished(harness.queue, '1', true);

    expect(drain()?.runs).toBe(1);
  });

  it('adds the completed attempt when only an earlier one has a line', async () => {
    const { harness, agents, drain } = collectorOn();
    harness.store.add('1', 'reply', [line(trace({ error: 'quota' }))], {
      returnvalue: trace({ attempt: 2, startedAt: iso(T0 + 5000) }),
    });

    await agents.onJobFinished(harness.queue, '1', true);

    expect(drain()).toMatchObject({ runs: 2, failed: 1, unrecorded: 0 });
  });

  it('counts a finished agent job with no run anywhere as unrecorded, only after the reread', async () => {
    const { harness, agents, drain } = collectorOn();
    harness.store.add('1', 'reply', ['plain line'], {
      returnvalue: { ok: true },
    });
    harness.store.add('2', 'reply', []);

    await agents.onJobFinished(harness.queue, '1');
    await agents.onJobFinished(harness.queue, '2');
    expect(drain()).toBeUndefined();
    await flush();

    expect(drain()).toMatchObject({ runs: 0, lost: 0, unrecorded: 2 });
  });

  it('counts an oversized returnvalue as unrecorded', async () => {
    const { harness, agents, drain } = collectorOn();
    harness.store.add('1', 'reply', [], {
      returnvalue: trace({
        final: { text: 'x'.repeat(AGENT_RUN_MAX_READ_CHARS), cards: [] },
      }),
    });

    await agents.onJobFinished(harness.queue, '1', true);

    expect(drain()).toMatchObject({ runs: 0, unrecorded: 1 });
  });

  it('leaves non-agent jobs alone', async () => {
    const { harness, agents, drain } = collectorOn({
      detail: 'basic',
      jobs: ['reply'],
    });
    harness.store.add('1', 'translate', []);

    await agents.onJobFinished(harness.queue, '1', true);

    expect(drain()).toBeUndefined();
  });

  describe('GraphQL', () => {
    function setup(ai: AgentQueueConfig = { detail: 'basic' }) {
      const redis = new FakeRedis();
      const harness = makeHarness(redis, ai);
      const queue = harness.queue;
      Object.defineProperty(queue, 'client', {
        get: () => Promise.resolve(redis),
      });
      const map = new Map([[queue.id, queue]]);
      const collector = new MetricsCollector([queue], METRICS, {});
      stops.push(() => collector.agents.stop());
      const contextValue = {
        dataSources: {
          bull: new BullDataSource([queue], map, {}),
          metrics: new MetricsDataSource(collector),
          policies: new PoliciesDataSource(map),
          agents: new AgentsDataSource([queue], map, collector, {}),
        },
      };
      const query = (source: string) =>
        graphql({
          schema,
          source,
          contextValue,
          variableValues: { queue: queue.id },
        });
      return { queue, collector, query, store: harness.store };
    }

    it('serves the returnvalue run cut to the queue detail, marked as such', async () => {
      const { query, store } = setup();
      store.add('1', 'reply', [], { returnvalue: trace() });

      const { data, errors } = await query(
        `query($queue: ID!) { agentRun(queue: $queue, jobId: "1") {
          source detail detailMismatch attempt
          input { conversationId text } final { text cards { title } }
          steps { text tools { name input output } }
        } }`
      );

      expect(errors).toBeUndefined();
      expect(data?.agentRun).toEqual({
        source: 'returnvalue',
        detail: 'basic',
        detailMismatch: true,
        attempt: 1,
        input: { conversationId: 'c-1', text: null },
        final: { text: null, cards: [{ title: 'Crepioca' }] },
        steps: [
          {
            text: null,
            tools: [{ name: 'listRecipes', input: null, output: null }],
          },
        ],
      });
      expect(JSON.stringify(data)).not.toContain(SECRET);
    });

    it('serves full content at full detail', async () => {
      const { query, store } = setup({ detail: 'full' });
      store.add('1', 'reply', [], { returnvalue: trace() });

      const { data } = await query(
        `query($queue: ID!) { agentRun(queue: $queue, jobId: "1") { source detail final { text } } }`
      );

      expect(data?.agentRun).toEqual({
        source: 'returnvalue',
        detail: 'full',
        final: { text: SECRET },
      });
    });

    it('lists log runs and the returnvalue run on Job.agentRuns without duplicates', async () => {
      const { query, store } = setup();
      store.add('1', 'reply', [line(trace({ error: 'quota' }))], {
        returnvalue: trace({ attempt: 2, startedAt: iso(T0 + 5000) }),
      });
      store.add('2', 'reply', [line(trace())], { returnvalue: trace() });

      const { data, errors } = await query(
        `query($queue: ID!) {
          a: job(queue: $queue, id: "1") { agentRuns { attempt source } }
          b: job(queue: $queue, id: "2") { agentRuns { attempt source } }
        }`
      );

      expect(errors).toBeUndefined();
      expect(data?.a).toEqual({
        agentRuns: [
          { attempt: 1, source: 'log' },
          { attempt: 2, source: 'returnvalue' },
        ],
      });
      expect(data?.b).toEqual({ agentRuns: [{ attempt: 1, source: 'log' }] });
    });

    it('feeds the conversation and exposes unrecorded on the summary', async () => {
      const { query, store, queue, collector } = setup();
      store.add('1', 'reply', [], { returnvalue: trace() });
      store.add('2', 'reply', []);
      await collector.agents.onJobFinished(queue, '1', true);
      await collector.agents.onJobFinished(queue, '2', true);
      await collector.agents.persist(
        collector.agents.drain([queue], Date.now())
      );

      const { data, errors } = await query(
        `query($queue: ID!) {
          agentsSummary(since: 1) { runs lost unrecorded }
          agentConversation(queue: $queue, conversationId: "c-1") {
            messages { jobId run { source final { text } } }
          }
        }`
      );

      expect(errors).toBeUndefined();
      expect(data?.agentsSummary).toEqual({ runs: 1, lost: 0, unrecorded: 1 });
      expect(data?.agentConversation).toEqual({
        messages: [
          { jobId: '1', run: { source: 'returnvalue', final: { text: null } } },
        ],
      });
    });
  });
});
