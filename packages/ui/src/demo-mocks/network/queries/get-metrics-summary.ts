import type {
  GetMetricsSummaryQuery,
  GetMetricsSummaryQueryVariables,
} from '@/typings/gql';
import type { Maybe } from '@/typings/utils';
import { networkMockData } from '../data';
import range from 'lodash/range';
import random from 'lodash/random';
import { downsample } from './downsample';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Mirrors the server's tiered retention: 3 days minute-by-minute, hourly out to
 * 30 days, 12-hourly out to 90 days. Every tier runs up to now, because each
 * collect tick folds the fresh point into all of them.
 */
const TIERS = [
  { everyMs: 12 * HOUR_MS, days: 90 },
  { everyMs: HOUR_MS, days: 30 },
  { everyMs: MINUTE_MS, days: 3 },
];

/**
 * Emulates the server picking a single tier for the requested window. Returning
 * the concatenated tiers would hand the chart a series whose bucket width
 * changes mid-series.
 */
const pickTier = (since?: number | null) => {
  const span = since ? Date.now() - since : Infinity;
  if (span <= 3 * DAY_MS) return MINUTE_MS;
  if (span <= 30 * DAY_MS) return HOUR_MS;
  return 12 * HOUR_MS;
};

type Point = {
  timestamp: number;
  windowMs: number;
  /** Per-queue split, keyed by queue id. */
  byQueue: Record<string, { completed: number; failed: number }>;
};

/**
 * One series carrying the per-queue split on every point, so the aggregate and
 * the per-queue table are always derived from the same filtered set — exactly
 * how `MetricsCollector.getSummary` does it. Deriving the table from a separate
 * running total is how the two end up disagreeing.
 */
const genSeries = (): Point[] => {
  const now = Date.now();
  const queues = networkMockData.queues;
  const points: Point[] = [];
  for (const tier of TIERS) {
    const start = now - tier.days * DAY_MS;
    const count = Math.floor((now - start) / tier.everyMs);
    const minutes = tier.everyMs / MINUTE_MS;
    for (const n of range(count)) {
      const byQueue: Point['byQueue'] = {};
      for (const queue of queues) {
        // Scaled by bucket width, like real rolled-up counters.
        byQueue[queue.id] = {
          completed: random(2, 30) * minutes,
          failed: random(0, 1) * minutes,
        };
      }
      points.push({
        timestamp: start + n * tier.everyMs,
        windowMs: tier.everyMs,
        byQueue,
      });
    }
  }
  return points;
};

let series: Maybe<Point[]> = null;

export const getMetricsSummaryMock = async (
  args?: GetMetricsSummaryQueryVariables
): Promise<GetMetricsSummaryQuery> => {
  if (!series) {
    series = genSeries();
  }
  const since = args?.since;
  const everyMs = pickTier(since);
  const visible = series.filter(
    (point) =>
      point.windowMs === everyMs && (!since || point.timestamp >= since)
  );

  const perQueue = new Map<string, { completed: number; failed: number }>();
  const points = visible.map((point) => {
    let completed = 0;
    let failed = 0;
    for (const [queueId, counts] of Object.entries(point.byQueue)) {
      completed += counts.completed;
      failed += counts.failed;
      const totals = perQueue.get(queueId) ?? { completed: 0, failed: 0 };
      totals.completed += counts.completed;
      totals.failed += counts.failed;
      perQueue.set(queueId, totals);
    }
    return {
      timestamp: point.timestamp,
      windowMs: point.windowMs,
      completed,
      failed,
    };
  });

  const queues = networkMockData.queues
    .map((queue) => {
      const totals = perQueue.get(queue.id) ?? { completed: 0, failed: 0 };
      return {
        queue: queue.id,
        name: queue.name,
        completed: totals.completed,
        failed: totals.failed,
      };
    })
    .sort((a, b) => b.completed + b.failed - (a.completed + a.failed));

  return {
    metricsSummary: {
      // Downsampled for the chart only — the totals below are the real sums
      // over the window, not the sum of the downsampled points.
      points: downsample(points, args?.maxPoints, ['completed', 'failed']),
      queues,
      totalCompleted: points.reduce((acc, p) => acc + p.completed, 0),
      totalFailed: points.reduce((acc, p) => acc + p.failed, 0),
    },
  };
};
