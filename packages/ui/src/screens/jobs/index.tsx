import React, { memo } from 'react';
import Filters from './Filters';
import List from './List';
import Throughput from './Throughput';
import CreateJobModal from './CreateJobModal';
import RemoveJobsModal from './RemoveJobsModal';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';

const JobsScreen = () => {
  const {
    queries: { getMetricsEnabled },
  } = useNetwork();
  const { data } = useQuery(
    QueryKeysConfig.metricsEnabled,
    getMetricsEnabled,
    // Server capability, not live state — refetching it every 5s alongside
    // everything else buys nothing.
    { staleTime: Infinity }
  );

  return (
    <>
      <Throughput enabled={data?.metricsEnabled ?? false} />
      <Filters />
      <List />
      <CreateJobModal />
      <RemoveJobsModal />
    </>
  );
};

export default memo(JobsScreen);
