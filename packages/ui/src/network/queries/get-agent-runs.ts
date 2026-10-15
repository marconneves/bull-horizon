import type {
  GetAgentRunsQuery,
  GetAgentRunsQueryVariables,
} from '@/typings/gql';
import { gqlClient } from '@/network/gql-client';
import { gql } from 'graphql-request';

export const getAgentRuns = (
  args: GetAgentRunsQueryVariables
): Promise<GetAgentRunsQuery> =>
  gqlClient.request(
    gql`
      query GetAgentRuns(
        $queues: [ID!]
        $since: Float!
        $filter: AgentRunsFilter
        $slowMs: Float
        $sort: AgentRunsSort
        $offset: Int
        $limit: Int
      ) {
        agentRuns(
          queues: $queues
          since: $since
          filter: $filter
          slowMs: $slowMs
          sort: $sort
          offset: $offset
          limit: $limit
        ) {
          total
          counts {
            all
            failed
            emptyTool
            slow
          }
          items {
            queue
            jobId
            jobName
            attempt
            finishedAt
            durationMs
            model
            steps
            inputTokens
            outputTokens
            cost
            outcome
            tools {
              name
              ok
              empty
            }
            error
          }
        }
      }
    `,
    args
  );
