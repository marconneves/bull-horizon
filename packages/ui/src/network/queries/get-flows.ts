import type { GetFlowsQuery } from '@/typings/gql';
import { gqlClient } from '@/network/gql-client';
import { gql } from 'graphql-request';

/** Every declared flow. Answers without the metrics collector (Config tab). */
export const getFlows = (): Promise<GetFlowsQuery> =>
  gqlClient.request(gql`
    query GetFlows {
      flows {
        id
        label
        group
        keyLabel
        entry
        complete
        onError
        definition
        steps {
          id
          kind
          label
          description
          when
          queue
          queueId
          jobs
          sharedQueue
        }
        edges {
          from
          to
          kind
          when
          declared
        }
        checks {
          level
          code
          message
        }
      }
    }
  `);
