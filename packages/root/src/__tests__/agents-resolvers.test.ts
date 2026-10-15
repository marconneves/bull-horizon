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
import { AGENT_RUN_LOG_PREFIX } from '../agent';
import { FakeRedis, bullHarness } from './helpers/agent-fakes';
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
// Key spelled differently from the model on purpose: matching is
// case-insensitive.
const PRICING: AgentsConfig = {
  pricing: { 'Gemini-3.8-Flash': { input: 0.3, output: 2.5 } },
};

const T0 = Date.parse('2026-10-14T19:05:28.514Z');
const iso = (ms: number) => new Date(ms).toISOString();

const run = (overrides: Partial<AgentRunV1> = {}): AgentRunV1 => ({
  v: 1,
  detail: 'full',
  model: 'gemini-3.8-flash',
  attempt: 1,
  startedAt: iso(T0),
  finishedAt: iso(T0 + 14814),
  durationMs: 14814,
  inputTokens: 9534,
  outputTokens: 1057,
  steps: [
    {
      step: 1,
      startedAt: iso(T0 + 53),
      durationMs: 4086,
      finishReason: 'tool-calls',
      inputTokens: 2788,
      outputTokens: 154,
      text: 'thinking',
      tools: [
        {
          name: 'listRecipes',
          ok: true,
          durationMs: 55,
          summary: '0 results',
          empty: true,
          input: { meal: 'BREAKFAST' },
          output: { recipes: [] },
        },
      ],
    },
    {
      step: 2,
      startedAt: iso(T0 + 4140),
      durationMs: 3431,
      finishReason: 'stop',
      inputTokens: 6746,
      outputTokens: 903,
      text: 'answer',
      tools: [],
    },
  ],
  final: { text: 'answer', cards: [{ type: 'RECIPE', title: 'Crepioca' }] },
  error: null,
  input: { conversationId: 'c-1', text: 'hi' },
  ...overrides,
});
const line = (r: AgentRunV1) => AGENT_RUN_LOG_PREFIX + JSON.stringify(r);

function setup(
  ai: AgentQueueConfig | boolean = { detail: 'full' },
  options: { collector?: boolean; agents?: AgentsConfig } = {}
) {
  const redis = new FakeRedis();
  const harness = bullHarness(redis, ai);
  const queue = harness.queue;
  Object.defineProperty(queue, 'client', {
    get: () => Promise.resolve(redis),
  });
  const map = new Map([[queue.id, queue]]);
  const agentsConfig = options.agents ?? PRICING;
  const collector = options.collector
    ? new MetricsCollector([queue], METRICS, agentsConfig)
    : undefined;
  const contextValue = {
    dataSources: {
      bull: new BullDataSource([queue], map, {}),
      metrics: new MetricsDataSource(collector),
      policies: new PoliciesDataSource(map),
      agents: new AgentsDataSource([queue], map, collector, agentsConfig),
    },
  };
  const query = async (source: string, variableValues = {}) => {
    const result = await graphql({
      schema,
      source,
      contextValue,
      variableValues: { queue: queue.id, ...variableValues },
    });
    return result;
  };
  return { harness, queue, collector, query, store: harness.store };
}

const RUN_FIELDS = `
  attempt detail detailMismatch model cost outcome finishReason
  overheadStartMs overheadEndMs truncated
  steps { step cost text tools { name input output error empty } }
  final { text cards { type title } }
  input { conversationId text }
`;

describe('agentRun / Job.agentRuns (no collector needed)', () => {
  it('serves the last attempt with cost computed on read', async () => {
    const { query, store } = setup();
    store.add(
      '1',
      'reply',
      [line(run({ attempt: 1, error: 'quota' })), line(run({ attempt: 2 }))],
      {
        processedOn: T0 - 53,
        finishedOn: T0 + 14814 + 18,
      }
    );

    const { data, errors } = await query(
      `query($queue: ID!) { agentRun(queue: $queue, jobId: "1") { ${RUN_FIELDS} } }`
    );

    expect(errors).toBeUndefined();
    const served = data?.agentRun as any;
    expect(served).toMatchObject({
      attempt: 2,
      detail: 'full',
      detailMismatch: false,
      outcome: 'stop',
      finishReason: 'stop',
      overheadStartMs: 53,
      overheadEndMs: 18,
      truncated: false,
    });
    expect(served.cost).toBeCloseTo((9534 * 0.3 + 1057 * 2.5) / 1e6, 10);
    expect(served.steps[0].cost).toBeCloseTo(
      (2788 * 0.3 + 154 * 2.5) / 1e6,
      10
    );
    expect(JSON.parse(served.steps[0].tools[0].input)).toEqual({
      meal: 'BREAKFAST',
    });
  });

  it('picks an attempt, without overheads before the last one', async () => {
    const { query, store } = setup();
    store.add(
      '1',
      'reply',
      [line(run({ attempt: 1, error: 'quota' })), line(run({ attempt: 2 }))],
      {
        processedOn: T0 - 53,
        finishedOn: T0 + 14832,
      }
    );

    const { data } = await query(
      `query($queue: ID!) { agentRun(queue: $queue, jobId: "1", attempt: 1) { attempt outcome overheadStartMs overheadEndMs } }`
    );

    expect(data?.agentRun).toEqual({
      attempt: 1,
      outcome: 'error',
      overheadStartMs: null,
      overheadEndMs: null,
    });
  });

  it('returns null cost (never 0) for a model without a price', async () => {
    const { query, store } = setup();
    store.add('1', 'reply', [line(run({ model: 'unpriced-model' }))]);

    const { data } = await query(
      `query($queue: ID!) { agentRun(queue: $queue, jobId: "1") { cost steps { cost } } }`
    );

    expect(data?.agentRun).toEqual({
      cost: null,
      steps: [{ cost: null }, { cost: null }],
    });
  });

  it('cuts a full line on a basic queue and flags the mismatch', async () => {
    const { query, store } = setup({ detail: 'basic' });
    store.add('1', 'reply', [line(run())]);

    const { data } = await query(
      `query($queue: ID!) { agentRun(queue: $queue, jobId: "1") { ${RUN_FIELDS} } }`
    );

    const served = data?.agentRun as any;
    expect(served.detail).toBe('basic');
    expect(served.detailMismatch).toBe(true);
    expect(served.steps.map((s: any) => s.text)).toEqual([null, null]);
    expect(served.steps[0].tools[0]).toMatchObject({
      input: null,
      output: null,
      error: null,
      empty: true,
    });
    expect(served.final).toEqual({
      text: null,
      cards: [{ type: 'RECIPE', title: 'Crepioca' }],
    });
    expect(served.input).toEqual({ conversationId: 'c-1', text: null });
  });

  it('treats a legacy line (no detail) as full', async () => {
    const { query, store } = setup({ detail: 'basic' });
    const legacy = run();
    delete legacy.detail;
    store.add('1', 'reply', [line(legacy)]);

    const { data } = await query(
      `query($queue: ID!) { agentRun(queue: $queue, jobId: "1") { detail detailMismatch } }`
    );

    expect(data?.agentRun).toEqual({ detail: 'basic', detailMismatch: true });
  });

  it('lists every attempt on Job.agentRuns, empty outside agent jobs', async () => {
    const { query, store } = setup({ jobs: ['reply'] });
    store.add('1', 'reply', [
      'plain line',
      line(run({ attempt: 1, error: 'x' })),
      line(run({ attempt: 2 })),
    ]);
    store.add('2', 'translate', [line(run())]);

    const { data, errors } = await query(
      `query($queue: ID!) {
        a: job(queue: $queue, id: "1") { agentRuns { attempt } }
        b: job(queue: $queue, id: "2") { agentRuns { attempt } }
        queue(id: $queue) { agent { jobs detail label } }
      }`
    );

    expect(errors).toBeUndefined();
    expect(data?.a).toEqual({ agentRuns: [{ attempt: 1 }, { attempt: 2 }] });
    expect(data?.b).toEqual({ agentRuns: [] });
    expect(data?.queue).toEqual({
      agent: { jobs: ['reply'], detail: 'basic', label: 'brand-app:ai' },
    });
  });

  it('answers null for a removed job and Queue.agent null outside agent queues', async () => {
    const { query } = setup(false);

    const { data } = await query(
      `query($queue: ID!) { agentRun(queue: $queue, jobId: "nope") { attempt } queue(id: $queue) { agent { label } } }`
    );

    expect(data).toEqual({ agentRun: null, queue: { agent: null } });
  });
});

describe('agentsSummary / agentRuns', () => {
  it('require the collector', async () => {
    const { query } = setup();

    const { errors } = await query(
      `{ agentsSummary(since: 0) { runs } agentRuns(since: 0) { total } }`
    );

    expect(errors?.map((e) => e.message)).toEqual([
      'Metrics are not enabled',
      'Metrics are not enabled',
    ]);
  });

  const seeded = async () => {
    const ctx = setup({ detail: 'basic' }, { collector: true });
    const { store, queue, collector } = ctx;
    const runs = [
      run({ startedAt: iso(T0), finishedAt: iso(T0 + 1000), durationMs: 1000 }),
      run({
        startedAt: iso(T0 + 2000),
        finishedAt: iso(T0 + 32000),
        durationMs: 30000,
        error: 'quota',
      }),
      run({
        model: 'unpriced-model',
        startedAt: iso(T0 + 3000),
        finishedAt: iso(T0 + 8000),
        durationMs: 5000,
      }),
    ];
    runs.forEach((r, i) => store.add(String(i), 'reply', [line(r)]));
    for (const id of ['0', '1', '2']) {
      await collector!.agents.onJobFinished(queue, id);
    }
    await collector!.agents.persist(
      collector!.agents.drain([queue], Date.now())
    );
    return ctx;
  };

  it('aggregates the window with cost per model and the unpriced flag', async () => {
    const { query } = await seeded();

    const { data, errors } = await query(
      `{ agentsSummary(since: 1, maxPoints: 10) {
          runs failed lost p50 p95 cost hasUnpricedModels runsWithEmptyTool avgSteps
          inputTokens
          latency { runs p50 }
          models { model runs cost }
          tools { name calls emptyRate }
          outcomes { outcome count }
          steps { label count }
        } }`
    );

    expect(errors).toBeUndefined();
    const summary = data?.agentsSummary as any;
    expect(summary).toMatchObject({
      runs: 3,
      failed: 1,
      lost: 0,
      hasUnpricedModels: true,
      runsWithEmptyTool: 3,
      avgSteps: 2,
      inputTokens: 3 * 9534,
    });
    expect(summary.p50).toBeGreaterThan(4000);
    expect(summary.p50).toBeLessThanOrEqual(5000);
    expect(summary.p95).toBeLessThanOrEqual(30000);
    // Only the priced model contributes; the unpriced one stays null.
    const priced = (2 * (9534 * 0.3 + 1057 * 2.5)) / 1e6;
    expect(summary.cost).toBeCloseTo(priced, 10);
    expect(summary.models).toMatchObject([
      { model: 'gemini-3.8-flash', runs: 2 },
      { model: 'unpriced-model', runs: 1, cost: null },
    ]);
    expect(summary.models[0].cost).toBeCloseTo(priced, 10);
    expect(summary.tools).toEqual([
      { name: 'listRecipes', calls: 3, emptyRate: 1 },
    ]);
    expect(summary.latency).toHaveLength(1);
    expect(summary.latency[0].runs).toBe(3);
  });

  it('filters, counts and sorts the recent runs, unpriced last on costliest', async () => {
    const { query } = await seeded();

    const { data, errors } = await query(
      `{
        all: agentRuns(since: 0, sort: costliest) {
          total counts { all failed emptyTool slow }
          items { jobId cost outcome tools { name ok empty } }
        }
        slow: agentRuns(since: 0, filter: slow, slowMs: 10000) { total items { jobId } }
        page: agentRuns(since: 0, sort: slowest, offset: 1, limit: 1) { total items { jobId durationMs } }
      }`
    );

    expect(errors).toBeUndefined();
    expect(data?.all).toMatchObject({
      total: 3,
      counts: { all: 3, failed: 1, emptyTool: 3, slow: 1 },
    });
    expect((data?.all as any).items.map((i: any) => i.cost === null)).toEqual([
      false,
      false,
      true,
    ]);
    expect((data?.all as any).items[0].tools).toEqual([
      { name: 'listRecipes', ok: true, empty: true },
    ]);
    expect(data?.slow).toEqual({ total: 1, items: [{ jobId: '1' }] });
    expect(data?.page).toEqual({
      total: 3,
      items: [{ jobId: '2', durationMs: 5000 }],
    });
  });
});

describe('agentRun overheads (QA 004 F5)', () => {
  const OVERHEADS = `query($queue: ID!) { agentRun(queue: $queue, jobId: "1") { attempt overheadStartMs overheadEndMs } }`;

  it('is null while a newer attempt runs without a line yet', async () => {
    const { query, store } = setup();
    // Attempt 2 started after attempt 1's line; the job has not finished.
    store.add('1', 'reply', [line(run({ attempt: 1, error: 'quota' }))], {
      processedOn: T0 + 60000,
    });
    const { data } = await query(OVERHEADS);
    expect(data?.agentRun).toEqual({
      attempt: 1,
      overheadStartMs: null,
      overheadEndMs: null,
    });
  });

  it('ignores a finishedOn left over from before a manual retry', async () => {
    const { query, store } = setup();
    store.add('1', 'reply', [line(run())], {
      processedOn: T0 - 53,
      finishedOn: T0 - 1000,
    });
    const { data } = await query(OVERHEADS);
    expect(data?.agentRun).toEqual({
      attempt: 1,
      overheadStartMs: 53,
      overheadEndMs: null,
    });
  });

  it('is never negative', async () => {
    const { query, store } = setup();
    // Job finished before the run's own end: mismatched attempts.
    store.add('1', 'reply', [line(run())], {
      processedOn: T0 - 53,
      finishedOn: T0 + 100,
    });
    const { data } = await query(OVERHEADS);
    const served = data?.agentRun as any;
    expect(served.overheadStartMs).toBe(53);
    expect(served.overheadEndMs).toBeNull();
  });
});
