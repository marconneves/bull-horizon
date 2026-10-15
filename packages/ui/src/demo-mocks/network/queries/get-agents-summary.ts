import type {
  GetAgentsSummaryQuery,
  GetAgentsSummaryQueryVariables,
} from '@/typings/gql';
import type { Maybe } from '@/typings/utils';
import range from 'lodash/range';
import { downsample } from './downsample';
import { AGENT_QUEUE_ID, agentMock } from '../agents/runs';
import { demoCost } from '../agents/design-run';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Same tiers as the throughput mock (and the server defaults). */
const TIERS = [
  { everyMs: 12 * HOUR_MS, days: 90 },
  { everyMs: HOUR_MS, days: 30 },
  { everyMs: MINUTE_MS, days: 3 },
];
const pickTier = (since: number) => {
  const span = Date.now() - since;
  if (span <= 3 * DAY_MS) return MINUTE_MS;
  if (span <= 30 * DAY_MS) return HOUR_MS;
  return 12 * HOUR_MS;
};

/** calls share, avg ms, error rate, empty rate — the design's tools table. */
const TOOLS: Array<[string, number, number, number, number]> = [
  ['getUserProfile', 0.97, 32, 0, 0],
  ['listRecipes', 0.86, 48, 0, 0.31],
  ['proposeRecipe', 0.66, 1, 0, 0],
  ['searchFoods', 0.4, 210, 0.021, 0.12],
  ['logMeal', 0.3, 95, 0.005, 0],
];
const MODELS: Array<[string, number, number, number]> = [
  // share of runs, avg tokens in, avg tokens out
  ['gemini-3.8-flash', 0.9, 8700, 1000],
  ['gemini-3.8-pro', 0.07, 9400, 1400],
  // No price in the setup: shows tokens and "no price", never $0.
  ['gemma-local', 0.03, 6100, 700],
];
const STEPS_SHARE = [0.18, 0.24, 0.41, 0.12, 0.05];

type TPoint = {
  timestamp: number;
  windowMs: number;
  runs: number;
  failed: number;
  lost: number;
  emptyRuns: number;
  durSum: number;
  /** p50/p95 weighted by runs, so summing then dividing keeps them sane. */
  p50w: number;
  p95w: number;
  llmMs: number;
  toolMs: number;
  steps: number[];
  outcomes: Record<string, number>;
  tools: Record<string, { c: number; e: number; z: number; ms: number }>;
  models: Record<string, { r: number; i: number; o: number }>;
};

type TMinute = { runs: number; failed: number; empty: number; lost: number };

/**
 * One count per minute over the longest tier, newest first (index 0 = the
 * minute that just ended). Every tier sums these, so a wider window never
 * shows fewer runs (or lost runs) than a narrower one. Where the runs index
 * reaches, the minutes are counted from it, so Metrics and the Runs tab agree
 * on the same window; older minutes are synthetic at the same rate.
 */
const genMinutes = (now: number, rnd: () => number): TMinute[] => {
  const total = TIERS[0].days * (DAY_MS / MINUTE_MS);
  const minutes: TMinute[] = Array.from({ length: total }, () => ({
    runs: 0,
    failed: 0,
    empty: 0,
    lost: 0,
  }));
  const minuteOf = (at: number) => Math.floor((now - at) / MINUTE_MS);
  const { index } = agentMock();
  let covered = 0;
  for (const item of index) {
    const m = minuteOf(item.finishedAt);
    if (m < 0 || m >= total) continue;
    minutes[m].runs += 1;
    if (item.outcome === 'error') minutes[m].failed += 1;
    if (item.tools.some((t) => t.empty)) minutes[m].empty += 1;
    covered = Math.max(covered, m + 1);
  }
  // Stochastic rounding: a minute holds well under one run, so plain rounding
  // of `rate * share` would zero every small share.
  const sr = (value: number) => {
    const floor = Math.floor(value);
    return floor + (rnd() < value - floor ? 1 : 0);
  };
  for (let m = 0; m < total; m += 1) {
    if (m >= covered) {
      const hour = new Date(now - (m + 1) * MINUTE_MS).getHours();
      // Fewer runs at night, like a consumer app. Same density as the index.
      const daily = hour >= 7 && hour <= 23 ? 1.2 : 0.35;
      const runs = sr(0.4 * daily * (0.4 + rnd() * 1.2));
      minutes[m].runs = runs;
      minutes[m].failed = sr(runs * 0.012);
      minutes[m].empty = sr(runs * 0.31);
    }
    // Runs that started but never wrote a record (not in the index).
    minutes[m].lost = rnd() < 0.0015 ? 1 : 0;
  }
  return minutes;
};

const genSeries = (): TPoint[] => {
  const now = Date.now();
  const points: TPoint[] = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sr = (value: number) => {
    const floor = Math.floor(value);
    return floor + (rnd() < value - floor ? 1 : 0);
  };
  const minutes = genMinutes(now, rnd);
  for (const tier of TIERS) {
    const start = now - tier.days * DAY_MS;
    const count = Math.floor((now - start) / tier.everyMs);
    const span = tier.everyMs / MINUTE_MS;
    for (const n of range(count)) {
      const timestamp = start + n * tier.everyMs;
      // The bucket [timestamp, timestamp + everyMs) is minutes `first` (the
      // newest) to `first + span - 1`.
      const first = Math.round((now - timestamp) / MINUTE_MS) - span;
      let runs = 0;
      let failed = 0;
      let emptyRuns = 0;
      let lost = 0;
      for (let m = first; m < first + span; m += 1) {
        const minute = minutes[m];
        if (!minute) continue;
        runs += minute.runs;
        failed += minute.failed;
        emptyRuns += minute.empty;
        lost += minute.lost;
      }
      if (runs === 0 && lost === 0) continue;
      const hour = new Date(timestamp).getHours();
      const p50 = 7000 + rnd() * 5000 + (hour >= 18 && hour <= 21 ? 3000 : 0);
      const p95 = p50 + 7000 + rnd() * 10000;
      const durSum = runs * (p50 * 1.05);
      const tools: TPoint['tools'] = {};
      for (const [name, share, ms, err, empty] of TOOLS) {
        const c = sr(runs * share * (0.85 + rnd() * 0.3));
        tools[name] = {
          c,
          e: sr(c * err),
          z: sr(c * empty),
          ms: c * ms,
        };
      }
      const models: TPoint['models'] = {};
      for (const [name, share, i, o] of MODELS) {
        const r = sr(runs * share);
        if (r) models[name] = { r, i: r * i, o: r * o };
      }
      const maxSteps = Math.min(sr(runs * 0.007), runs - failed);
      const length = Math.min(sr(runs * 0.007), runs - failed - maxSteps);
      points.push({
        timestamp,
        windowMs: tier.everyMs,
        runs,
        failed,
        lost,
        emptyRuns,
        durSum,
        p50w: p50 * runs,
        p95w: p95 * runs,
        llmMs: durSum * 0.94,
        toolMs: durSum * 0.06,
        steps: STEPS_SHARE.map((share) => sr(runs * share)),
        outcomes: {
          stop: runs - failed - maxSteps - length,
          'max-steps': maxSteps,
          length,
          error: failed,
        },
        tools,
        models,
      });
    }
  }
  return points;
};

let series: Maybe<TPoint[]> = null;

const sumRecord = <T extends Record<string, number>>(
  target: Record<string, T>,
  source: Record<string, T>
) => {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key] ?? ({} as T);
    const merged = { ...current };
    for (const [k, v] of Object.entries(value)) {
      (merged as Record<string, number>)[k] = (current[k] ?? 0) + v;
    }
    target[key] = merged;
  }
};

export const getAgentsSummaryMock = async (
  args: GetAgentsSummaryQueryVariables
): Promise<GetAgentsSummaryQuery> => {
  if (args.queues?.length && !args.queues.includes(AGENT_QUEUE_ID)) {
    return { agentsSummary: null };
  }
  if (!series) series = genSeries();
  const everyMs = pickTier(args.since);
  const until = args.until ?? Infinity;
  const visible = series.filter(
    (p) =>
      p.windowMs === everyMs && p.timestamp >= args.since && p.timestamp < until
  );

  const total = {
    runs: 0,
    failed: 0,
    lost: 0,
    emptyRuns: 0,
    durSum: 0,
    p50w: 0,
    p95w: 0,
    llmMs: 0,
    toolMs: 0,
    steps: [0, 0, 0, 0, 0],
    outcomes: {} as Record<string, number>,
    tools: {} as TPoint['tools'],
    models: {} as TPoint['models'],
  };
  for (const p of visible) {
    total.runs += p.runs;
    total.failed += p.failed;
    total.lost += p.lost;
    total.emptyRuns += p.emptyRuns;
    total.durSum += p.durSum;
    total.p50w += p.p50w;
    total.p95w += p.p95w;
    total.llmMs += p.llmMs;
    total.toolMs += p.toolMs;
    p.steps.forEach((c, i) => (total.steps[i] += c));
    for (const [k, v] of Object.entries(p.outcomes)) {
      total.outcomes[k] = (total.outcomes[k] ?? 0) + v;
    }
    sumRecord(total.tools, p.tools);
    sumRecord(total.models, p.models);
  }

  const runs = total.runs;
  const ratio = (a: number, b: number) => (b ? a / b : null);
  const models = Object.entries(total.models)
    .map(([model, m]) => ({
      model,
      runs: m.r,
      inputTokens: m.i,
      outputTokens: m.o,
      cost: demoCost(model, m.i, m.o),
    }))
    .sort((a, b) => b.runs - a.runs);
  const priced = models.filter((m) => m.cost !== null);
  const stepsWeight = total.steps.reduce((a, c) => a + c, 0);

  // Downsampled with the shared helper, like the throughput mock: counters
  // summed per bucket, then the weighted percentiles divided back.
  const latency = downsample(
    visible.map((p) => ({
      timestamp: p.timestamp,
      windowMs: p.windowMs,
      runs: p.runs,
      failed: p.failed,
      p50w: p.p50w,
      p95w: p.p95w,
    })),
    args.maxPoints,
    ['runs', 'failed', 'windowMs', 'p50w', 'p95w']
  ).map((p) => ({
    timestamp: p.timestamp,
    windowMs: p.windowMs,
    runs: p.runs,
    failed: p.failed,
    p50: ratio(p.p50w, p.runs),
    p95: ratio(p.p95w, p.runs),
  }));

  return {
    agentsSummary: {
      runs,
      failed: total.failed,
      lost: total.lost,
      p50: ratio(total.p50w, runs),
      p95: ratio(total.p95w, runs),
      avgDurationMs: ratio(total.durSum, runs),
      llmShare: ratio(total.llmMs, total.llmMs + total.toolMs),
      inputTokens: models.reduce((a, m) => a + m.inputTokens, 0),
      outputTokens: models.reduce((a, m) => a + m.outputTokens, 0),
      cost: priced.length
        ? priced.reduce((a, m) => a + (m.cost as number), 0)
        : null,
      hasUnpricedModels: models.some((m) => m.cost === null && m.runs > 0),
      avgSteps: ratio(
        total.steps.reduce((a, c, i) => a + c * (i + 1), 0),
        stepsWeight
      ),
      runsWithEmptyTool: total.emptyRuns,
      latency,
      steps: ['1', '2', '3', '4', '5+'].map((label, i) => ({
        label,
        count: total.steps[i],
      })),
      tools: Object.entries(total.tools)
        .map(([name, t]) => ({
          name,
          calls: t.c,
          avgDurationMs: ratio(t.ms, t.c) ?? 0,
          errorRate: ratio(t.e, t.c) ?? 0,
          emptyRate: ratio(t.z, t.c) ?? 0,
        }))
        .sort((a, b) => b.calls - a.calls),
      models,
      outcomes: Object.entries(total.outcomes)
        .filter(([, count]) => count > 0)
        .map(([outcome, count]) => ({ outcome, count }))
        .sort((a, b) => b.count - a.count),
    },
  };
};
