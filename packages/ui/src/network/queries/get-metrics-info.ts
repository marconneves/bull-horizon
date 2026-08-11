import { gqlClient } from '@/network/gql-client';
import { gql } from 'graphql-request';
import type { GetMetricsInfoQuery } from '@/typings/gql';

export const getMetricsInfo = (): Promise<GetMetricsInfoQuery> =>
  gqlClient.request(
    gql`
      query GetMetricsInfo {
        metricsEnabled
        metricsInfo {
          collectIntervalMs
          retentionMs
        }
      }
    `
  );
