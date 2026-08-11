import type {
  GetQueueMetricsQuery,
  GetQueueMetricsQueryVariables,
} from '@/typings/gql';
import type { Maybe } from '@/typings/utils';
import range from 'lodash/range';
import random from 'lodash/random';
import { downsample } from './downsample';

const genCount = () => random(0, 50);
const WINDOW_MS = 60_000;
const POINTS = 24 * 60;

/**
 * Points are spaced by `WINDOW_MS` and end at "now", matching what the real
 * collector writes — the demo charts are windowed with `since`, so a series
 * generated into the future (as the previous mock did) would render empty.
 */
const genMetrics = (): GetQueueMetricsQuery => {
  const now = Date.now();
  const metrics: GetQueueMetricsQuery['metrics'] = range(POINTS).map((n) => {
    const completed = random(20, 140);
    return {
      timestamp: now - (POINTS - 1 - n) * WINDOW_MS,
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
      windowMs: WINDOW_MS,
      processingTime: random(150, 900),
      processingTimeMin: random(20, 140),
      processingTimeMax: random(1000, 4000),
    };
  });
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
  const points = since
    ? (metrics.metrics ?? []).filter((m) => m.timestamp >= since)
    : metrics.metrics ?? [];
  return {
    metrics: downsample(points, args?.maxPoints, [
      'completed',
      'failed',
      'windowMs',
    ]),
  };
};
