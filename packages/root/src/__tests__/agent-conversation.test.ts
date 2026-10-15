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
import { AGENT_CONVERSATION_MAX_MESSAGES } from '../gql/data-sources/agents';
import { MetricsCollector } from '../metrics-collector';
import {
  agentRunIndexEntry,
  resetAgentDetailMismatchWarnings,
} from '../metrics/agent-metrics';
import { AGENT_RUN_LOG_PREFIX } from '../agent';
import { AGENT_RUN_ID_CHARS, clipId } from '../agent/limits';
import { FakeRedis, bullHarness, bullmqHarness } from './helpers/agent-fakes';
import type { AgentQueueConfig, AgentRunV1 } from '../agent';
import type { AgentsConfig, MetricsConfig } from '../typings/config';

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
const PRICE = { input: 0.3, output: 2.5 };
const T0 = Date.parse('2026-10-14T19:05:28.514Z');
const iso = (ms: number) => new Date(ms).toISOString();

/** One run of `durationMs` starting at `start`, two steps, one tool call. */
const run = (
  start: number,
  overrides: Partial<AgentRunV1> = {},
  durationMs = 1000
): AgentRunV1 => ({
  v: 1,
  detail: 'full',
  model: 'gemini-3.8-flash',
  attempt: 1,
  startedAt: iso(start),
  finishedAt: iso(start + durationMs),
  durationMs,
  inputTokens: 100,
  outputTokens: 10,
  steps: [
    {
      step: 1,
      startedAt: iso(start),
      durationMs: durationMs / 2,
      finishReason: 'tool-calls',
      inputTokens: 50,
      outputTokens: 5,
      text: 'thinking',
      tools: [
        {
          name: 'listRecipes',
          ok: true,
          durationMs: 10,
          summary: '2 results',
          input: { meal: 'LUNCH' },
          output: { recipes: [1, 2] },
        },
      ],
    },
    {
      step: 2,
      startedAt: iso(start + durationMs / 2),
      durationMs: durationMs / 2,
      finishReason: 'stop',
      inputTokens: 50,
      outputTokens: 5,
      text: 'answer',
      tools: [],
    },
  ],
  final: { text: 'the answer', cards: [{ type: 'RECIPE', title: 'Crepioca' }] },
  error: null,
  input: { conversationId: 'c-7f21', text: 'what do I eat?' },
  ...overrides,
});
const line = (r: AgentRunV1) => AGENT_RUN_LOG_PREFIX + JSON.stringify(r);

const CONVERSATION = `query($queue: ID!, $id: ID!) {
  agentConversation(queue: $queue, conversationId: $id) {
    queue conversationId maybeIncomplete
    messages {
      jobId attempt startedAt finishedAt durationMs model inputTokens
      outputTokens cost outcome steps jobRemoved
      run {
        attempt detail detailMismatch
        input { conversationId text }
        final { text cards { type title } }
        steps { text tools { name input output } }
      }
    }
    totals {
      messages durationMs aiMs inputTokens outputTokens cost
      hasUnpricedMessages steps toolCalls
    }
    tools { name count }
  }
}`;

describe.each([
  ['bull', bullHarness],
  ['bullmq', bullmqHarness],
] as const)('agentConversation on %s', (_lib, makeHarness) => {
  let stops: Array<() => void> = [];
  afterEach(() => {
    stops.forEach((stop) => stop());
    stops = [];
  });

  function setup(
    ai: AgentQueueConfig | boolean = { detail: 'full' },
    options: { collector?: boolean; agents?: AgentsConfig } = {}
  ) {
    const redis = new FakeRedis();
    const harness = makeHarness(redis, ai);
    const queue = harness.queue;
    Object.defineProperty(queue, 'client', {
      get: () => Promise.resolve(redis),
    });
    const map = new Map([[queue.id, queue]]);
    const agentsConfig = options.agents ?? {
      pricing: { 'gemini-3.8-flash': PRICE },
    };
    const collector =
      options.collector === false
        ? undefined
        : new MetricsCollector([queue], METRICS, agentsConfig);
    if (collector) stops.push(() => collector.agents.stop());
    const contextValue = {
      dataSources: {
        bull: new BullDataSource([queue], map, {}),
        metrics: new MetricsDataSource(collector),
        policies: new PoliciesDataSource(map),
        agents: new AgentsDataSource([queue], map, collector, agentsConfig),
      },
    };
    const query = (id: string, source = CONVERSATION, queueId = queue.id) =>
      graphql({
        schema,
        source,
        contextValue,
        variableValues: { queue: queueId, id },
      });
    /** Job with these attempts in its log, ingested into the index. */
    const message = async (jobId: string, ...runs: AgentRunV1[]) => {
      const lastStart = Date.parse(runs[runs.length - 1].startedAt);
      harness.store.add(jobId, 'reply', runs.map(line), {
        processedOn: lastStart,
      });
      await collector!.agents.onJobFinished(queue, jobId);
    };
    return { redis, queue, collector, query, message, store: harness.store };
  }

  it('groups by conversation, one message per job (highest attempt), oldest first', async () => {
    const { query, message } = setup();
    // Ingested out of order on purpose.
    await message('3', run(T0 + 60000));
    await message(
      '1',
      run(T0, { error: 'quota' }),
      run(T0 + 2000, { attempt: 2 })
    );
    await message('2', run(T0 + 30000, {}, 4000));
    await message('other', run(T0 + 5000, { input: { conversationId: 'x' } }));
    await message('none', run(T0 + 6000, { input: undefined }));

    const { data, errors } = await query('c-7f21');

    expect(errors).toBeUndefined();
    const conv = data?.agentConversation as any;
    expect(conv.queue).toBeTruthy();
    expect(conv.conversationId).toBe('c-7f21');
    expect(conv.maybeIncomplete).toBe(false);
    expect(conv.messages.map((m: any) => [m.jobId, m.attempt])).toEqual([
      ['1', 2],
      ['2', 1],
      ['3', 1],
    ]);
    const first = conv.messages[0];
    expect(first).toMatchObject({
      startedAt: T0 + 2000,
      finishedAt: T0 + 3000,
      durationMs: 1000,
      model: 'gemini-3.8-flash',
      outcome: 'stop',
      steps: 2,
      jobRemoved: false,
    });
    expect(first.run).toMatchObject({
      attempt: 2,
      detail: 'full',
      detailMismatch: false,
      input: { conversationId: 'c-7f21', text: 'what do I eat?' },
      final: { text: 'the answer' },
    });
    expect(first.run.steps[0].tools[0].input).toBe('{"meal":"LUNCH"}');
    const each = (100 * PRICE.input + 10 * PRICE.output) / 1e6;
    expect(first.cost).toBeCloseTo(each, 12);
    expect(conv.totals).toMatchObject({
      messages: 3,
      // First start (T0 + 2000) to last finish (T0 + 61000).
      durationMs: 59000,
      aiMs: 1000 + 4000 + 1000,
      inputTokens: 300,
      outputTokens: 30,
      hasUnpricedMessages: false,
      steps: 6,
      toolCalls: 3,
    });
    expect(conv.totals.cost).toBeCloseTo(3 * each, 12);
    expect(conv.tools).toEqual([{ name: 'listRecipes', count: 3 }]);
  });

  it('cuts user text and final answer at basic, keeping meta, chain and cards', async () => {
    resetAgentDetailMismatchWarnings();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { query, message } = setup({ detail: 'basic' });
      await message('1', run(T0));

      const { data, errors } = await query('c-7f21');

      expect(errors).toBeUndefined();
      const [msg] = (data?.agentConversation as any).messages;
      expect(msg.run.detail).toBe('basic');
      expect(msg.run.input).toEqual({ conversationId: 'c-7f21', text: null });
      expect(msg.run.final).toEqual({
        text: null,
        cards: [{ type: 'RECIPE', title: 'Crepioca' }],
      });
      expect(msg.run.steps.map((s: any) => s.text)).toEqual([null, null]);
      expect(msg.run.steps[0].tools[0]).toEqual({
        name: 'listRecipes',
        input: null,
        output: null,
      });
      // The line was recorded at full on a basic queue: cut and flagged.
      expect(msg.run.detailMismatch).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps a removed job as an index-only message', async () => {
    const { query, message, store } = setup();
    await message('1', run(T0));
    await message('2', run(T0 + 10000));
    store.jobs.delete('1');

    const { data } = await query('c-7f21');

    const conv = data?.agentConversation as any;
    expect(conv.messages[0]).toMatchObject({
      jobId: '1',
      jobRemoved: true,
      run: null,
      steps: 2,
      inputTokens: 100,
    });
    expect(conv.messages[1]).toMatchObject({ jobId: '2', jobRemoved: false });
    // The removed job's tools still count, from the index chain.
    expect(conv.totals.toolCalls).toBe(2);
    expect(conv.tools).toEqual([{ name: 'listRecipes', count: 2 }]);
  });

  it('never prices an unpriced model at 0', async () => {
    const { query, message } = setup({ detail: 'full' }, { agents: {} });
    await message('1', run(T0));

    const { data } = await query('c-7f21');

    const conv = data?.agentConversation as any;
    expect(conv.messages[0].cost).toBeNull();
    expect(conv.totals.cost).toBeNull();
    expect(conv.totals.hasUnpricedMessages).toBe(true);
  });

  it('sums only the priced messages when some are unpriced', async () => {
    const { query, message } = setup();
    await message('1', run(T0));
    await message('2', run(T0 + 5000, { model: 'unpriced-model' }));

    const { data } = await query('c-7f21');

    const totals = (data?.agentConversation as any).totals;
    expect(totals.cost).toBeCloseTo((100 * 0.3 + 10 * 2.5) / 1e6, 12);
    expect(totals.hasUnpricedMessages).toBe(true);
  });

  it(`serves only the newest ${AGENT_CONVERSATION_MAX_MESSAGES} messages and flags the cut`, async () => {
    const { query, message } = setup();
    const total = AGENT_CONVERSATION_MAX_MESSAGES + 5;
    for (let i = 0; i < total; i++) {
      await message(String(i), run(T0 + i * 1000, {}, 100));
    }

    const { data } = await query(
      'c-7f21',
      `query($queue: ID!, $id: ID!) {
        agentConversation(queue: $queue, conversationId: $id) {
          maybeIncomplete messages { jobId } totals { messages }
        }
      }`
    );

    const conv = data?.agentConversation as any;
    expect(conv.messages).toHaveLength(AGENT_CONVERSATION_MAX_MESSAGES);
    expect(conv.messages[0].jobId).toBe('5');
    expect(conv.messages[conv.messages.length - 1].jobId).toBe(
      String(total - 1)
    );
    expect(conv.totals.messages).toBe(AGENT_CONVERSATION_MAX_MESSAGES);
    expect(conv.maybeIncomplete).toBe(true);
  });

  it('flags a conversation as maybe incomplete once the index is at its cap', async () => {
    const { query, message } = setup(
      { detail: 'full' },
      { agents: { recentRuns: 2 } }
    );
    await message('1', run(T0));
    await message('2', run(T0 + 1000));
    await message('3', run(T0 + 2000));

    const { data } = await query('c-7f21');

    const conv = data?.agentConversation as any;
    expect(conv.messages.map((m: any) => m.jobId)).toEqual(['2', '3']);
    expect(conv.maybeIncomplete).toBe(true);
  });

  const MIN = 60 * 1000;
  const other = { input: { conversationId: 'other' } };

  it('is not incomplete when the full index reaches far back before the first message', async () => {
    const { query, message } = setup(
      { detail: 'full' },
      { agents: { recentRuns: 3 } }
    );
    await message('o', run(T0 - 120 * MIN, other));
    await message('1', run(T0));
    await message('2', run(T0 + MIN));

    const { data } = await query('c-7f21');

    const conv = data?.agentConversation as any;
    expect(conv.messages).toHaveLength(2);
    expect(conv.maybeIncomplete).toBe(false);
  });

  it('is incomplete when the full index does not reach past the largest pause', async () => {
    const { query, message } = setup(
      { detail: 'full' },
      { agents: { recentRuns: 3 } }
    );
    // 40 min before the first message, but the conversation pauses for 2 h.
    await message('o', run(T0 - 40 * MIN, other));
    await message('1', run(T0));
    await message('2', run(T0 + 120 * MIN));

    const { data } = await query('c-7f21');

    expect((data?.agentConversation as any).maybeIncomplete).toBe(true);
  });

  it('uses a 30 minute floor for the pause', async () => {
    const { query, message } = setup(
      { detail: 'full' },
      { agents: { recentRuns: 3 } }
    );
    await message('o', run(T0 - 20 * MIN, other));
    await message('1', run(T0));
    await message('2', run(T0 + MIN));

    const { data } = await query('c-7f21');

    expect((data?.agentConversation as any).maybeIncomplete).toBe(true);
  });

  it('is not incomplete while the index is below its cap', async () => {
    const { query, message } = setup(
      { detail: 'full' },
      { agents: { recentRuns: 10 } }
    );
    await message('1', run(T0));
    await message('2', run(T0 + 120 * MIN));

    const { data } = await query('c-7f21');

    expect((data?.agentConversation as any).maybeIncomplete).toBe(false);
  });

  it('answers an empty conversation for an unknown id', async () => {
    const { query, message } = setup();
    await message('1', run(T0));

    const { data } = await query('nope');

    expect(data?.agentConversation).toMatchObject({
      messages: [],
      maybeIncomplete: false,
      totals: { messages: 0, durationMs: null, cost: null, toolCalls: 0 },
      tools: [],
    });
  });

  it('treats prototype-named conversation and job ids as plain keys', async () => {
    const { query, message } = setup();
    const proto = { input: { conversationId: '__proto__' } };
    await message('__proto__', run(T0, proto));
    await message('constructor', run(T0 + 1000, proto));
    await message('1', run(T0 + 2000, { input: { conversationId: 'c' } }));

    const { data, errors } = await query('__proto__');

    expect(errors).toBeUndefined();
    const conv = data?.agentConversation as any;
    expect(conv.conversationId).toBe('__proto__');
    expect(conv.messages.map((m: any) => m.jobId)).toEqual([
      '__proto__',
      'constructor',
    ]);
    expect(conv.messages.every((m: any) => m.run)).toBe(true);
    expect((await query('constructor')).data?.agentConversation).toMatchObject({
      messages: [],
    });
  });

  it('skips index entries written before the conversation view (no c)', async () => {
    const { query, message, redis, collector, queue } = setup();
    await message('1', run(T0));
    const agents = collector!.agents;
    const legacy = agentRunIndexEntry(
      'old',
      'reply',
      run(T0 - 5000),
      T0 - 4000
    );
    delete legacy.c;
    await redis.zadd(agents.runsKey(queue.id), 'NX', T0 - 4000, 'old:1:0');
    await redis.hset(
      agents.runsDataKey(queue.id),
      'old:1:0',
      JSON.stringify(legacy)
    );
    await redis.hset(agents.runsDataKey(queue.id), 'junk', 'not json');
    await redis.zadd(agents.runsKey(queue.id), 'NX', T0 - 3000, 'junk');

    const { data, errors } = await query('c-7f21');

    expect(errors).toBeUndefined();
    expect(
      (data?.agentConversation as any).messages.map((m: any) => m.jobId)
    ).toEqual(['1']);
  });

  it('requires the collector, the queue, and an agent queue', async () => {
    const off = setup({ detail: 'full' }, { collector: false });
    expect((await off.query('c')).errors?.map((e) => e.message)).toEqual([
      'Metrics are not enabled',
    ]);

    const on = setup();
    const missing = await on.query('c', CONVERSATION, 'no-such-queue');
    expect(missing.errors?.map((e) => e.message)).toEqual(['Queue not found']);

    const plain = setup(false);
    const notAgent = await plain.query('c');
    expect(notAgent.errors).toBeUndefined();
    expect(notAgent.data?.agentConversation).toBeNull();
  });
});

describe('recent runs index entry: conversation id', () => {
  it('stores the clipped conversation id, and nothing without one', () => {
    const long = 'c'.repeat(500);
    const withId = agentRunIndexEntry(
      '1',
      'reply',
      run(T0, { input: { conversationId: long } }),
      T0
    );
    expect(withId.c).toBe(clipId(long));
    expect(withId.c?.length).toBe(AGENT_RUN_ID_CHARS);
    expect(
      'c' in agentRunIndexEntry('1', 'reply', run(T0, { input: {} }), T0)
    ).toBe(false);
    expect(
      'c' in
        agentRunIndexEntry(
          '1',
          'reply',
          run(T0, { input: { conversationId: '' } }),
          T0
        )
    ).toBe(false);
  });
});
