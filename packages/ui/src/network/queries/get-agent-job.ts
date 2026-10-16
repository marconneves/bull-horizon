import type {
  GetAgentJobQuery,
  GetAgentJobQueryVariables,
} from '@/typings/gql';
import { gqlClient } from '@/network/gql-client';
import { gql } from 'graphql-request';
import { AGENT_RUN_FIELDS_FRAG } from '../fragments/agent-run-fields';

/**
 * The job plus every attempt's run in one request. `Job.agentRuns` reads the
 * job logs once, so the attempt selector switches without another round trip,
 * and `data` feeds the request node.
 */
export const getAgentJob = (
  args: GetAgentJobQueryVariables
): Promise<GetAgentJobQuery> =>
  gqlClient.request(
    gql`
      ${AGENT_RUN_FIELDS_FRAG}
      query GetAgentJob($queue: ID!, $id: ID!) {
        job(queue: $queue, id: $id) {
          id
          name
          status
          data
          attemptsMade
          timestamp
          processedOn
          finishedOn
          agentRuns {
            ...AgentRunFields
          }
        }
      }
    `,
    args
  );
