import type {
  GetFlowTraceQuery,
  GetFlowTraceQueryVariables,
} from '@/typings/gql';
import { gqlClient } from '@/network/gql-client';
import { gql } from 'graphql-request';

const FLOW_TRACE_JOB_FRAG = gql`
  fragment FlowTraceJobFields on FlowTraceJob {
    stepId
    queueId
    jobId
    attempt
    status
    parentQueueId
    parentJobId
    parentStepId
    enqueuedAt
    startedAt
    finishedAt
    waitMs
    processMs
    failedReason
    fallback
    pending
  }
`;
/**
 * One event's path through the flow, found by trace id, job id or business
 * key (exact match). Null without the collector.
 */
export const getFlowTrace = (
  args: GetFlowTraceQueryVariables
): Promise<GetFlowTraceQuery> =>
  gqlClient.request(
    gql`
      ${FLOW_TRACE_JOB_FRAG}
      query GetFlowTrace($flow: ID!, $query: String!, $traceId: ID) {
        flowTrace(flow: $flow, query: $query, traceId: $traceId) {
          matchedBy
          indexFull
          candidates {
            traceId
            startedAt
            status
          }
          trace {
            traceId
            key
            startedAt
            finishedAt
            durationMs
            status
            truncated
            partial
            jobs {
              ...FlowTraceJobFields
            }
            longestWait {
              ...FlowTraceJobFields
            }
          }
        }
      }
    `,
    args
  );
