import type { GetFlowsQuery } from '@/typings/gql';
import { CONTENT_FLOW } from '../flows/content-ingest';

export const getFlowsMock = async (): Promise<GetFlowsQuery> => ({
  flows: [CONTENT_FLOW],
});
