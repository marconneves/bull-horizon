import type {
  GetAgentsSummaryQuery,
  GetAgentsSummaryQueryVariables,
} from '@/typings/gql';
import { gqlClient } from '@/network/gql-client';
import { gql } from 'graphql-request';

export const getAgentsSummary = (
  args: GetAgentsSummaryQueryVariables
): Promise<GetAgentsSummaryQuery> =>
  gqlClient.request(
    gql`
      query GetAgentsSummary(
        $queues: [ID!]
        $since: Float!
        $until: Float
        $maxPoints: Int
      ) {
        agentsSummary(
          queues: $queues
          since: $since
          until: $until
          maxPoints: $maxPoints
        ) {
          runs
          failed
          lost
          p50
          p95
          avgDurationMs
          llmShare
          inputTokens
          outputTokens
          cost
          hasUnpricedModels
          avgSteps
          runsWithEmptyTool
          latency {
            timestamp
            windowMs
            runs
            failed
            p50
            p95
          }
          steps {
            label
            count
          }
          tools {
            name
            calls
            avgDurationMs
            errorRate
            emptyRate
          }
          models {
            model
            runs
            inputTokens
            outputTokens
            cost
          }
          outcomes {
            outcome
            count
          }
        }
      }
    `,
    args
  );
