import type { GetMetricsEnabledQuery } from '@/typings/gql';
import { gqlClient } from '@/network/gql-client';
import { gql } from 'graphql-request';

export const getMetricsEnabled = (): Promise<GetMetricsEnabledQuery> =>
  gqlClient.request(
    gql`
      query GetMetricsEnabled {
        metricsEnabled
      }
    `
  );
