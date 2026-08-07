import type { GetMetricsEnabledQuery } from '@/typings/gql';

export const getMetricsEnabledMock = (): Promise<GetMetricsEnabledQuery> =>
  Promise.resolve({ metricsEnabled: true });
