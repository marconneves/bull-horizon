import { QueryKeysConfig } from '@/config/query-keys';
import { useNetwork } from '@/hooks/use-network';
import type { GetQueuesQuery } from '@/typings/gql';
import React from 'react';
import { useQuery } from 'react-query';
import type { UseQueryResult } from 'react-query';
import { getPollingInterval } from '@/stores/network-settings';

type TValue = UseQueryResult<GetQueuesQuery, unknown>;
export const QueuesQueryContext = React.createContext<TValue>(null as any);
export const QueuesQueryProvider: React.FC = (props) => {
  const { queries } = useNetwork();
  const refetchInterval = getPollingInterval();
  const value = useQuery(QueryKeysConfig.queues, queries.getQueues, {
    refetchInterval,
    // Every queue in this response costs at least one redis round-trip on the
    // server (job counts + paused flag), so polling it while nobody is
    // looking is pure load on the user's redis.
    refetchIntervalInBackground: false,
    // The list is on screen continuously; without this the drawer and the
    // overview grid blank out into their loading state on every refetch.
    keepPreviousData: true,
  });
  return (
    <QueuesQueryContext.Provider value={value}>
      {props.children}
    </QueuesQueryContext.Provider>
  );
};
