import {
  AGENT_MAX_TOOLS,
  AGENT_OTHER_KEY,
  AgentMetrics,
  accumulateAgentRun,
  agentRunIndexEntry,
  emptyAgentPoint,
  mergeAgentPoints,
  resetAgentDetailMismatchWarnings,
} from '../metrics/agent-metrics';
import {
  AGENT_RUN_ID_CHARS,
  AGENT_RUN_LOG_PREFIX,
  applyAgentRunDetail,
  createAgentRun,
  defaultSummarize,
} from '../agent';
import { AgentsDataSource } from '../gql/data-sources';
import { FakeRedis, bullHarness } from './helpers/agent-fakes';
import type { AgentRunV1 } from '../agent';
import type { MetricsConfig } from '../typings/config';

/**
 * Security review 004 (docs/todo/004-agentes-ia/security-review.md).
 *
 * Each block pins a finding. F1 and F3 started as reproductions of the
 * vulnerable behavior; the expectations were inverted when the fix landed.
 */

const METRICS: Required<MetricsConfig> = {
  redisPrefix: 'test::metrics::',
  collectInterval: { minutes: 1 },
  maxMetrics: 4320,
  retention: { raw: 4320, rollups: [] },
  blacklist: [],
};

const run = (overrides: Partial<AgentRunV1> = {}): AgentRunV1 => ({
  v: 1,
  detail: 'basic',
  model: 'gemini-3.8-flash',
  attempt: 1,
  startedAt: '2026-10-14T19:05:28.514Z',
  finishedAt: '2026-10-14T19:05:43.328Z',
  durationMs: 14814,
  inputTokens: 100,
  outputTokens: 10,
  steps: [
    {
      step: 1,
      startedAt: '2026-10-14T19:05:28.564Z',
      durationMs: 4086,
      finishReason: 'stop',
      inputTokens: 100,
      outputTokens: 10,
      tools: [{ name: 'listRecipes', ok: true, durationMs: 55, summary: 'x' }],
    },
  ],
  final: { cards: [] },
  error: null,
  ...overrides,
});

const withTool = (name: string) =>
  run({
    steps: [
      {
        ...run().steps[0],
        tools: [{ name, ok: true, durationMs: 55, summary: 'x' }],
      },
    ],
  });

// JSON round trip = what the collector persists and reads back from Redis.
const persisted = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const PROTOTYPE_KEYS = [
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  '__proto__',
  '__defineGetter__',
];

describe('SEC-004-F1: inherited Object.prototype keys in rollup records', () => {
  it.each(PROTOTYPE_KEYS)(
    'a tool named %p counts as a plain tool, before and after a read-side merge',
    (name) => {
      const point = emptyAgentPoint(1000, 60000);
      accumulateAgentRun(point, withTool(name));
      accumulateAgentRun(point, withTool(name));
      expect(point.tools[name]).toEqual({ c: 2, e: 0, z: 0, ms: 110 });
      // getSummary merges every persisted point into an empty one.
      const total = mergeAgentPoints(emptyAgentPoint(), persisted(point));
      expect(total.tools[name]).toEqual({ c: 2, e: 0, z: 0, ms: 110 });
      expect(Object.keys(total.tools)).toEqual([name]);
    }
  );

  it.each(PROTOTYPE_KEYS)('a model named %p keeps numeric stats', (model) => {
    const point = emptyAgentPoint(1000, 60000);
    accumulateAgentRun(point, run({ model }));
    const total = mergeAgentPoints(
      mergeAgentPoints(emptyAgentPoint(), persisted(point)),
      persisted(point)
    );
    expect(total.models[model]).toEqual({ r: 2, i: 200, o: 20 });
  });

  it.each(PROTOTYPE_KEYS)('a finishReason named %p counts as 1', (reason) => {
    const point = emptyAgentPoint(1000, 60000);
    accumulateAgentRun(
      point,
      run({ steps: [{ ...run().steps[0], finishReason: reason }] })
    );
    expect(point.outcomes[reason]).toBe(1);
    const total = mergeAgentPoints(emptyAgentPoint(), persisted(point));
    expect(total.outcomes[reason]).toBe(1);
  });

  it('a model named "__proto__" does not pollute any prototype', () => {
    const point = emptyAgentPoint(1000, 60000);
    accumulateAgentRun(point, run({ model: '__proto__' }));
    const total = mergeAgentPoints(emptyAgentPoint(), persisted(point));
    expect(({} as Record<string, unknown>).r).toBeUndefined();
    expect(({} as Record<string, unknown>).i).toBeUndefined();
    expect(Object.getPrototypeOf(total.models)).toBeNull();
    expect(Object.keys(total.models)).toEqual(['__proto__']);
  });

  it('the cardinality cap still folds into (other) with prototype names', () => {
    const point = emptyAgentPoint(1000, 60000);
    for (let i = 0; i < AGENT_MAX_TOOLS; i++) {
      accumulateAgentRun(point, withTool(`tool${i}`));
    }
    accumulateAgentRun(point, withTool('constructor'));
    expect(Object.keys(point.tools)).toHaveLength(AGENT_MAX_TOOLS + 1);
    expect(point.tools[AGENT_OTHER_KEY].c).toBe(1);
    expect(
      Object.prototype.hasOwnProperty.call(point.tools, 'constructor')
    ).toBe(false);
  });
});

describe('SEC-004-F2: identifiers are capped on write and on read', () => {
  const long = 'm'.repeat(5000);

  it('the helper caps model, tool name, finishReason, card type and conversationId', async () => {
    const rows: string[] = [];
    const recorder = createAgentRun({
      job: { attemptsMade: 0, log: async (row: string) => rows.push(row) },
      model: long,
      input: { conversationId: long },
    });
    recorder.stepFinish({ stepNumber: 0, finishReason: long });
    recorder.tool({
      stepNumber: 0,
      name: long,
      input: {},
      durationMs: 1,
      success: true,
      output: [],
    });
    await recorder.finish('ok', [{ type: long, title: long }]);
    const stored = JSON.parse(rows[0].slice(AGENT_RUN_LOG_PREFIX.length));
    for (const value of [
      stored.model,
      stored.input.conversationId,
      stored.steps[0].finishReason,
      stored.steps[0].tools[0].name,
      stored.final.cards[0].type,
    ]) {
      expect(value.length).toBe(AGENT_RUN_ID_CHARS);
    }
    expect(stored.final.cards[0].title.length).toBeLessThan(200);
  });

  it('a forged line is capped on read and the cap is idempotent', () => {
    const forged = run({
      model: long,
      input: { conversationId: long },
      steps: [{ ...withTool(long).steps[0], finishReason: long }],
      final: { cards: [{ type: long, title: long }] },
    });
    const cut = applyAgentRunDetail(forged, 'basic');
    expect(cut.model.length).toBe(AGENT_RUN_ID_CHARS);
    expect(cut.steps[0].tools[0].name.length).toBe(AGENT_RUN_ID_CHARS);
    expect(cut.steps[0].finishReason?.length).toBe(AGENT_RUN_ID_CHARS);
    expect(cut.final?.cards[0].type.length).toBe(AGENT_RUN_ID_CHARS);
    expect(cut.final?.cards[0].title.length).toBeLessThanOrEqual(240);
    expect(cut.input?.conversationId?.length).toBe(AGENT_RUN_ID_CHARS);
    expect(applyAgentRunDetail(cut, 'basic')).toEqual(cut);
  });

  it('rollup keys from a persisted point and index entries are capped', () => {
    const forged = { ...emptyAgentPoint(1000, 60000), runs: 1 };
    forged.tools = { [long]: { c: 1, e: 0, z: 0, ms: 1 } };
    forged.models = { [long]: { r: 1, i: 1, o: 1 } };
    forged.outcomes = { [long]: 1 };
    const total = mergeAgentPoints(emptyAgentPoint(), forged);
    for (const record of [total.tools, total.models, total.outcomes]) {
      expect(Object.keys(record)[0].length).toBe(AGENT_RUN_ID_CHARS);
    }
    const entry = agentRunIndexEntry('1', long, withTool(long), 0);
    expect(entry.n.length).toBe(AGENT_RUN_ID_CHARS);
    expect(entry.tc[0][0].length).toBe(AGENT_RUN_ID_CHARS);
  });

  it('index entries read back from Redis are capped by the data source', async () => {
    const queue: any = { id: 'q', name: 'q', agent: { detail: 'basic' } };
    const collector: any = {
      agents: {
        getRecentRuns: async () => [
          {
            j: '1',
            a: 1,
            n: long,
            t: 1,
            d: 1,
            m: long,
            s: 1,
            i: 1,
            o: 1,
            oc: long,
            tc: [[long, 1, 0]],
          },
        ],
      },
    };
    const ds = new AgentsDataSource(
      [queue],
      new Map([['q', queue]]),
      collector
    );
    const page = await ds.getRuns({ since: 0 });
    const item = page.items[0];
    for (const value of [item.jobName, item.model, item.outcome]) {
      expect(value.length).toBe(AGENT_RUN_ID_CHARS);
    }
    expect(item.tools[0].name.length).toBe(AGENT_RUN_ID_CHARS);
  });
});

describe('SEC-004-F3: default summarize lists key names only when they are identifiers', () => {
  it('a dictionary keyed by data shows counts, never the keys', () => {
    const output = {
      'maria.silva@example.com': { a1c: 7.9 },
      'joao@example.com': { a1c: 6.1 },
    };
    const summary = defaultSummarize('lookup', output);
    expect(summary).toBe('object (2 keys)');
    expect(summary).not.toContain('@');
    expect(summary).not.toContain('7.9');
  });

  it('a single data key falls back too', () => {
    expect(defaultSummarize('t', { 'Diabetes tipo 2': [] })).toBe('0 results');
    expect(defaultSummarize('t', { 'Diabetes tipo 2': { x: 1 } })).toBe(
      'object (1 key)'
    );
  });

  it('lists keyed by data show only their sizes', () => {
    const summary = defaultSummarize('t', {
      'maria@x.com': [1, 2],
      'joao@x.com': [],
    });
    expect(summary).toBe('2 lists: 2, 0');
  });

  it('identifier keys are still listed (schema, not data)', () => {
    expect(defaultSummarize('t', { recipe: {}, total_kcal: 1 })).toBe(
      'object (recipe, total_kcal)'
    );
    expect(defaultSummarize('t', { recipes: [1], drinks: [] })).toBe(
      'recipes: 1, drinks: 0'
    );
    expect(defaultSummarize('t', { [`k${'x'.repeat(41)}`]: 1 })).toBe(
      'object (1 key)'
    );
  });
});

describe('SEC-004-F4: the queues argument is deduplicated', () => {
  it('repeated and unknown ids read each agent queue once', async () => {
    const agentQueue: any = { id: 'q', name: 'q', agent: { detail: 'basic' } };
    const plain: any = { id: 'p', name: 'p', agent: null };
    const getRecentRuns = jest.fn(async () => []);
    const extractSince = jest.fn(async () => []);
    const ds = new AgentsDataSource(
      [agentQueue, plain],
      new Map([
        ['q', agentQueue],
        ['p', plain],
      ]),
      { agents: { getRecentRuns, extractSince } } as any
    );
    const queues = [...new Array(10000).fill('q'), 'p', 'nope'];

    await ds.getRuns({ queues, since: 0 });
    await ds.getSummary(queues, 0);

    expect(getRecentRuns).toHaveBeenCalledTimes(1);
    expect(extractSince).toHaveBeenCalledTimes(1);
  });
});

describe('SEC-004-F5: detail mismatch warns once per queue, without content', () => {
  const SECRET = 'paciente com diabetes tipo 2';
  const fullRun = run({
    detail: 'full',
    final: { text: SECRET, cards: [] },
    input: { conversationId: 'c-1', text: SECRET },
  });
  const line = AGENT_RUN_LOG_PREFIX + JSON.stringify(fullRun);
  let warn: jest.SpyInstance;

  beforeEach(() => {
    resetAgentDetailMismatchWarnings();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('on read (data source), once per queue', async () => {
    const harness = bullHarness(new FakeRedis(), { detail: 'basic' });
    harness.store.add('1', 'reply', [line, line]);
    harness.store.add('2', 'reply', [line]);
    const ds = new AgentsDataSource(
      [harness.queue],
      new Map([[harness.queue.id, harness.queue]])
    );

    const first = await ds.getRun(harness.queue.id, '1');
    await ds.getRun(harness.queue.id, '2');

    expect(first?.detailMismatch).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain(harness.queue.name);
    expect(message).toContain('"basic"');
    expect(message).toContain('"full"');
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain('c-1');
  });

  it('on ingest (collector), once per queue', async () => {
    const redis = new FakeRedis();
    const harness = bullHarness(redis, { detail: 'basic' });
    harness.store.add('1', 'reply', [line]);
    const agents = new AgentMetrics({
      config: METRICS,
      agents: { pricing: {}, recentRuns: 10 },
      client: async () => redis as any,
    });

    await agents.onJobFinished(harness.queue, '1');
    await agents.onJobFinished(harness.queue, '1');
    agents.stop();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(SECRET);
  });

  it('stays quiet when the levels agree', async () => {
    const harness = bullHarness(new FakeRedis(), { detail: 'full' });
    harness.store.add('1', 'reply', [line]);
    const ds = new AgentsDataSource(
      [harness.queue],
      new Map([[harness.queue.id, harness.queue]])
    );
    await ds.getRun(harness.queue.id, '1');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('SEC-004-F6: note() is clipped to the text cap', () => {
  it('a long note is cut, a run-prefixed note is still dropped', async () => {
    const rows: string[] = [];
    const recorder = createAgentRun({
      job: { attemptsMade: 0, log: async (row: string) => rows.push(row) },
      model: 'm',
      limits: { textChars: 100 },
    });
    recorder.note('x'.repeat(10000));
    recorder.note(`${AGENT_RUN_LOG_PREFIX}{}`);
    await Promise.resolve();
    expect(rows).toHaveLength(1);
    expect(rows[0].startsWith('x'.repeat(100))).toBe(true);
    expect(rows[0].length).toBeLessThan(120);
  });
});
