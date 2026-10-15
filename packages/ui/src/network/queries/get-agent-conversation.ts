import type {
  GetAgentConversationQuery,
  GetAgentConversationQueryVariables,
} from '@/typings/gql';
import { gqlClient } from '@/network/gql-client';
import { gql } from 'graphql-request';
import { AGENT_RUN_FIELDS_FRAG } from '../fragments/agent-run-fields';

/**
 * Every message of one `input.conversationId` in the queue's recent runs
 * index, oldest first, each with its run (null when the job is gone).
 */
export const getAgentConversation = (
  args: GetAgentConversationQueryVariables
): Promise<GetAgentConversationQuery> =>
  gqlClient.request(
    gql`
      ${AGENT_RUN_FIELDS_FRAG}
      query GetAgentConversation($queue: ID!, $conversationId: ID!) {
        agentConversation(queue: $queue, conversationId: $conversationId) {
          queue
          conversationId
          maybeIncomplete
          messages {
            jobId
            attempt
            startedAt
            finishedAt
            durationMs
            model
            inputTokens
            outputTokens
            cost
            outcome
            steps
            jobRemoved
            run {
              ...AgentRunFields
            }
          }
          totals {
            messages
            durationMs
            aiMs
            inputTokens
            outputTokens
            cost
            hasUnpricedMessages
            steps
            toolCalls
          }
          tools {
            name
            count
          }
        }
      }
    `,
    args
  );
