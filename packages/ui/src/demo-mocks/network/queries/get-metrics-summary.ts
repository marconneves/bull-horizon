import type {
  GetMetricsSummaryQuery,
  GetMetricsSummaryQueryVariables,
} from '@/typings/gql';
import type { Maybe } from '@/typings/utils';
import { networkMockData } from '../data';
import range from 'lodash/range';
import random from 'lodash/random';
import { downsample } from './downsample';

const WINDOW_MS = 60_000;
const POINTS = 24 * 60;

type Series = {
  points: Array<{ timestamp: number; completed: number; failed: number }>;
  perQueue: Map<string, { completed: number; failed: number }>;
};

/**
 * One shared series so the global chart and the per-queue table can never
 * disagree — the totals in the table are the same numbers the chart sums.
 */
const genSeries = (): Series => {
  const now = Date.now();
  const queues = networkMockData.queues;
  const points: Series['points'] = [];
  const perQueue = new Map<string, { completed: number; failed: number }>();

  for (const queue of queues) {
    perQueue.set(queue.id, { completed: 0, failed: 0 });
  }
  for (const n of range(POINTS)) {
    const timestamp = now - (POINTS - 1 - n) * WINDOW_MS;
    let completed = 0;
    let failed = 0;
    for (const queue of queues) {
      const queueCompleted = random(2, 30);
      const queueFailed = random(0, 1);
      completed += queueCompleted;
      failed += queueFailed;
      const totals = perQueue.get(queue.id)!;
      totals.completed += queueCompleted;
      totals.failed += queueFailed;
    }
    points.push({ timestamp, completed, failed });
  }
  return { points, perQueue };
};

let series: Maybe<Series> = null;

export const getMetricsSummaryMock = async (
  args?: GetMetricsSummaryQueryVariables
): Promise<GetMetricsSummaryQuery> => {
  if (!series) {
    series = genSeries();
  }
  const since = args?.since;
  const windowed = since
    ? series.points.filter((p) => p.timestamp >= since)
    : series.points;
  const points = downsample(windowed, args?.maxPoints, ['completed', 'failed']);

  // Recompute the per-queue split from the visible window so the table
  // reacts to the range selector the same way the real aggregate does.
  const visibleRatio = series.points.length
    ? windowed.length / series.points.length
    : 0;
  const queues = networkMockData.queues
    .map((queue) => {
      const totals = series!.perQueue.get(queue.id) ?? {
        completed: 0,
        failed: 0,
      };
      return {
        queue: queue.id,
        name: queue.name,
        completed: Math.round(totals.completed * visibleRatio),
        failed: Math.round(totals.failed * visibleRatio),
      };
    })
    .sort((a, b) => b.completed + b.failed - (a.completed + a.failed));

  return {
    metricsSummary: {
      points,
      queues,
      totalCompleted: points.reduce((acc, p) => acc + p.completed, 0),
      totalFailed: points.reduce((acc, p) => acc + p.failed, 0),
    },
  };
};
