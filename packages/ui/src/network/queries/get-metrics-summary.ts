import type {
  GetMetricsSummaryQuery,
  GetMetricsSummaryQueryVariables,
} from '@/typings/gql';
import { gqlClient } from '@/network/gql-client';
import { gql } from 'graphql-request';

export const getMetricsSummary = (
  args: GetMetricsSummaryQueryVariables
): Promise<GetMetricsSummaryQuery> =>
  gqlClient.request(
    gql`
      query GetMetricsSummary($since: Float, $maxPoints: Int) {
        metricsSummary(since: $since, maxPoints: $maxPoints) {
          totalCompleted
          totalFailed
          points {
            timestamp
            completed
            failed
            windowMs
          }
          queues {
            queue
            name
            completed
            failed
          }
        }
      }
    `,
    args
  );
