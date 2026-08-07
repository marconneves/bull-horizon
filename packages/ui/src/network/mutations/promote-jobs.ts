import { gqlClient } from '@/network/gql-client';
import type {
  PromoteJobsMutation,
  PromoteJobsMutationVariables,
} from '@/typings/gql';
import { gql } from 'graphql-request';

export const promoteJobs = (
  args: PromoteJobsMutationVariables
): Promise<PromoteJobsMutation> =>
  gqlClient.request(
    gql`
      mutation PromoteJobs($queue: ID!, $jobs: [ID!]!) {
        promoteJobs(queue: $queue, jobs: $jobs) {
          id
        }
      }
    `,
    args
  );
