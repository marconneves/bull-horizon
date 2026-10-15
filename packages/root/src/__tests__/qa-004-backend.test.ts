/**
 * QA 004 (backend): proofs for the findings of qa-report-backend.md plus a few
 * extra edge checks. Tests marked `QA-FINDING` are expected to fail until the
 * finding is fixed; they are written as the desired behavior and are
 * skipped so the suite stays green. Un-skip each one when fixing it.
 */
import {
  AGENT_LATENCY_BOUNDS_MS,
  AgentMetrics,
  latencyBand,
  latencyPercentile,
} from '../metrics/agent-metrics';
import {
  AGENT_RUN_LOG_PREFIX,
  createAgentRun,
  parseAgentRunLine,
} from '../agent';
import type { AgentRunV1 } from '../agent';
import { FakeRedis, bullHarness, bullmqHarness } from './helpers/agent-fakes';
import type { MetricsConfig } from '../typings/config';

const CONFIG: Required<MetricsConfig> = {
  redisPrefix: 'qa::metrics::',
  collectInterval: { minutes: 1 },
  maxMetrics: 4320,
  retention: { raw: 4320, rollups: [{ everyMs: 3600000, keep: 720 }] },
  blacklist: [],
};
const T0 = Date.parse('2026-10-14T19:05:28.514Z');

const run = (overrides: Partial<AgentRunV1> = {}): AgentRunV1 => ({
  v: 1,
  detail: 'basic',
  model: 'm',
  attempt: 1,
  startedAt: new Date(T0).toISOString(),
  finishedAt: new Date(T0 + 1000).toISOString(),
  durationMs: 1000,
  inputTokens: 10,
  outputTokens: 5,
  steps: [],
  final: null,
  error: null,
  ...overrides,
});
const line = (r: AgentRunV1) => AGENT_RUN_LOG_PREFIX + JSON.stringify(r);
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe.each([
  ['bull', bullHarness],
  ['bullmq', bullmqHarness],
] as const)('QA collector on %s', (_p, makeHarness) => {
  const agentsOn = (redis: FakeRedis) =>
    new AgentMetrics({
      config: CONFIG,
      agents: { pricing: {}, recentRuns: 2000 },
      client: async () => redis as any,
      rereadDelayMs: 5,
    });

  it('QA-FINDING: re-reads when the LAST attempt line is missing even if earlier attempts were new', async () => {
    const redis = new FakeRedis();
    const harness = makeHarness(redis, true);
    const agents = agentsOn(redis);
    // Attempt 1 failed (line written), attempt 2 succeeded with an
    // un-awaited finish(): its line lands after the terminal event.
    harness.store.add('j', 'reply', [line(run({ attempt: 1, error: 'boom' }))]);
    await agents.onJobFinished(harness.queue, 'j');
    harness.store.logs.get('j')?.push(
      line(
        run({
          attempt: 2,
          startedAt: new Date(T0 + 5000).toISOString(),
          finishedAt: new Date(T0 + 6000).toISOString(),
        })
      )
    );
    await flush();
    const [{ point }] = agents.drain([harness.queue]);
    agents.stop();
    expect(point.runs).toBe(2);
  });

  it('dedupes across two monitor instances sharing Redis (concurrent events)', async () => {
    const redis = new FakeRedis();
    const h1 = makeHarness(redis, true);
    const h2 = makeHarness(redis, true);
    h1.store.add('x', 'reply', [
      line(run()),
      line(run({ attempt: 2, startedAt: new Date(T0 + 9).toISOString() })),
    ]);
    h2.store.logs = h1.store.logs;
    h2.store.jobs = h1.store.jobs;
    const a = agentsOn(redis);
    const b = agentsOn(redis);
    await Promise.all([
      a.onJobFinished(h1.queue, 'x'),
      b.onJobFinished(h2.queue, 'x'),
      a.onJobFinished(h1.queue, 'x'),
    ]);
    const total = [...a.drain([h1.queue]), ...b.drain([h2.queue])].reduce(
      (s, e) => s + e.point.runs,
      0
    );
    a.stop();
    b.stop();
    expect(total).toBe(2);
  });
});

describe('QA percentile edges', () => {
  it('bands are inclusive on the upper bound', () => {
    expect(latencyBand(0)).toBe(0);
    expect(latencyBand(500)).toBe(0);
    expect(latencyBand(501)).toBe(1);
    expect(latencyBand(300000)).toBe(AGENT_LATENCY_BOUNDS_MS.length - 1);
    expect(latencyBand(300001)).toBe(AGENT_LATENCY_BOUNDS_MS.length);
  });
  it('interpolates to the exact band edge and caps by durMax', () => {
    const lat = new Array(AGENT_LATENCY_BOUNDS_MS.length + 1).fill(0);
    lat[0] = 2;
    lat[1] = 2;
    expect(latencyPercentile(lat, 0.5, 900)).toBe(500);
    expect(latencyPercentile(lat, 1, 900)).toBe(900); // capped, not 1000
    const over = new Array(AGENT_LATENCY_BOUNDS_MS.length + 1).fill(0);
    over[0] = 1;
    over[AGENT_LATENCY_BOUNDS_MS.length] = 1;
    expect(latencyPercentile(over, 0.95, 420000)).toBe(420000);
    expect(latencyPercentile(over, 0.5, 420000)).toBe(500);
  });
});

describe('QA recorder robustness', () => {
  it('QA-FINDING: a throwing card getter must not cost the run line', async () => {
    const rows: string[] = [];
    const rec = createAgentRun({
      job: { attemptsMade: 0, log: async (r) => rows.push(r) },
      model: 'm',
    });
    const card = {
      type: 'X',
      get title(): string {
        throw new Error('getter');
      },
    };
    await rec.finish('ok', [card as any]);
    expect(rows.filter((r) => parseAgentRunLine(r))).toHaveLength(1);
  });

  it('QA-FINDING: a tool input mutated into a cycle after tool() must not cost the run line (full)', async () => {
    const rows: string[] = [];
    const rec = createAgentRun({
      job: { attemptsMade: 0, log: async (r) => rows.push(r) },
      model: 'm',
      detail: 'full',
    });
    const input: any = { q: 1 };
    rec.tool({ name: 't', input, durationMs: 1, success: true, output: [] });
    input.self = input; // the app keeps using its object
    await rec.finish('ok');
    expect(rows.filter((r) => parseAgentRunLine(r))).toHaveLength(1);
  });

  it('QA-FINDING: an explicit undefined limit falls back to the default', async () => {
    const rows: string[] = [];
    const rec = createAgentRun({
      job: { attemptsMade: 0, log: async (r) => rows.push(r) },
      model: 'm',
      limits: { lineBytes: undefined },
    });
    rec.tool({ name: 't', input: 1, durationMs: 1, success: true, output: [] });
    await rec.finish('ok');
    const parsed = parseAgentRunLine(rows[0]);
    expect(parsed?.truncated).toBeUndefined();
    expect(parsed?.steps[0].tools).toHaveLength(1);
  });

  it('finish then fail: one line, first wins; onEvent/onError throwing are swallowed', async () => {
    const rows: string[] = [];
    const rec = createAgentRun({
      job: { attemptsMade: 2, log: async (r) => rows.push(r) },
      model: 'm',
      onEvent: () => {
        throw new Error('e');
      },
      onError: () => {
        throw new Error('e2');
      },
    });
    await expect(rec.finish('ok')).resolves.toBeUndefined();
    await expect(rec.fail(new Error('late'))).resolves.toBeUndefined();
    expect(rows).toHaveLength(1);
    const parsed = parseAgentRunLine(rows[0]);
    expect(parsed?.error).toBeNull();
    expect(parsed?.attempt).toBe(3);
    expect(parsed?.detail).toBe('basic');
  });
});
