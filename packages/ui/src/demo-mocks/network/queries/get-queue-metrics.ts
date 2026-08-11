import type {
  GetQueueMetricsQuery,
  GetQueueMetricsQueryVariables,
} from '@/typings/gql';
import type { Maybe } from '@/typings/utils';
import range from 'lodash/range';
import random from 'lodash/random';
import { downsample } from './downsample';

const genCount = () => random(0, 50);
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Mirrors the server's tiered retention so the demo can answer the same ranges
 * a real deployment does: 3 days minute-by-minute, then hourly out to 30 days,
 * then 12-hourly out to 90 days. Points end at "now" — the charts are windowed
 * with `since`, so a series generated into the future renders empty.
 */
const TIERS = [
  { everyMs: 12 * HOUR_MS, days: 90 },
  { everyMs: HOUR_MS, days: 30 },
  { everyMs: MINUTE_MS, days: 3 },
];
const DAY_MS = 24 * HOUR_MS;

/**
 * Emulates the server picking a single retention tier for the requested window.
 * Returning the concatenated tiers instead would hand the chart a series whose
 * bucket width changes mid-series — which is exactly the bug this mirrors away.
 */
const pickTier = (since?: number | null) => {
  const span = since ? Date.now() - since : Infinity;
  const RAW_SPAN = 3 * DAY_MS;
  if (span <= RAW_SPAN) return MINUTE_MS;
  if (span <= 30 * DAY_MS) return HOUR_MS;
  return 12 * HOUR_MS;
};

const genMetrics = (): GetQueueMetricsQuery => {
  const now = Date.now();
  const metrics: NonNullable<GetQueueMetricsQuery['metrics']> = [];
  for (const tier of TIERS) {
    // Each tier runs from its retention edge up to now — the server folds every
    // fresh point into every tier, so the coarse ones are not stale.
    const start = now - tier.days * DAY_MS;
    const count = Math.floor((now - start) / tier.everyMs);
    for (const n of range(count)) {
      // Throughput scales with the bucket width, like real rolled-up counters.
      const perMinute = random(20, 140);
      const minutes = tier.everyMs / MINUTE_MS;
      const completed = perMinute * minutes;
      metrics.push({
        timestamp: start + n * tier.everyMs,
        counts: {
          waiting: genCount(),
          completed: genCount(),
          failed: genCount(),
          paused: 0,
          active: genCount(),
          delayed: genCount(),
        },
        completed,
        failed: random(0, Math.max(1, Math.round(completed * 0.04))),
        windowMs: tier.everyMs,
        processingTime: random(150, 900),
        processingTimeMin: random(20, 140),
        processingTimeMax: random(1000, 4000),
      });
    }
  }
  return { metrics };
};
let metrics: Maybe<GetQueueMetricsQuery> = null;
export const getQueueMetricsMock = async (
  args?: GetQueueMetricsQueryVariables
): Promise<GetQueueMetricsQuery> => {
  if (!metrics) {
    metrics = genMetrics();
  }
  const since = args?.since;
  const everyMs = pickTier(since);
  const points = (metrics.metrics ?? []).filter(
    (m) => m.windowMs === everyMs && (!since || m.timestamp >= since)
  );
  return {
    metrics: downsample(points, args?.maxPoints, [
      'completed',
      'failed',
      'windowMs',
    ]),
  };
};
