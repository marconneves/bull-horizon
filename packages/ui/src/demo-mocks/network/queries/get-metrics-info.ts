import type { GetMetricsInfoQuery } from '@/typings/gql';

const DAY_MS = 86400000;

export const getMetricsInfoMock = (): Promise<GetMetricsInfoQuery> =>
  Promise.resolve({
    metricsEnabled: true,
    metricsInfo: {
      collectIntervalMs: 60000,
      // Mirrors the default retention tiers: the coarsest reaches 90 days.
      retentionMs: 90 * DAY_MS,
    },
  });
