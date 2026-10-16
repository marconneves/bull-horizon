import type {
  GetFlowSummaryQuery,
  GetFlowSummaryQueryVariables,
} from '@/typings/gql';
import { gqlClient } from '@/network/gql-client';
import { gql } from 'graphql-request';

/** KPIs and per-step stats of one flow in the window. Null without collector. */
export const getFlowSummary = (
  args: GetFlowSummaryQueryVariables
): Promise<GetFlowSummaryQuery> =>
  gqlClient.request(
    gql`
      query GetFlowSummary($flow: ID!, $since: Float) {
        flowSummary(flow: $flow, since: $since) {
          flowId
          since
          entries
          done
          errors
          failed
          e2eAvg
          e2eP50
          e2eP95
          bottleneck
          coverage
          steps {
            stepId
            waiting
            active
            delayed
            failedNow
            completed
            failed
            lost
            untraced
            retried
            throughputPerMin
            procP50
            procP95
            waitAvg
            waitP95
            failureRate
            bottleneck
            spark
            errors {
              message
              count
              lastJobId
            }
          }
          edges {
            from
            to
            count
            declared
            waitAvg
          }
          checks {
            level
            code
            message
          }
        }
      }
    `,
    args
  );
