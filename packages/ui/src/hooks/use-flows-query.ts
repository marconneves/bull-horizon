import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';

/**
 * The declared flows. Static for the life of the monitor (they come from its
 * setup), so they are read once; answers without the metrics collector.
 */
export const useFlowsQuery = () => {
  const {
    queries: { getFlows },
  } = useNetwork();
  return useQuery(QueryKeysConfig.flows, getFlows, {
    staleTime: Infinity,
  });
};
