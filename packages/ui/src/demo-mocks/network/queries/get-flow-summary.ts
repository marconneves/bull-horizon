import type {
  GetFlowSummaryQuery,
  GetFlowSummaryQueryVariables,
} from '@/typings/gql';
import { FLOW_ID, flowSummaryMock } from '../flows/content-ingest';

export const getFlowSummaryMock = async ({
  flow,
  since,
}: GetFlowSummaryQueryVariables): Promise<GetFlowSummaryQuery> => ({
  flowSummary: flow === FLOW_ID ? flowSummaryMock(since) : null,
});
