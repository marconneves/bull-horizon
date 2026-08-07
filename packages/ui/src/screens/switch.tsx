import { useActiveScreenStore } from '@/stores/active-screen';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import React from 'react';
import { useQuery } from 'react-query';
import JobsScreen from './jobs';
import MetricsScreen from './metrics';

const ScreensSwitch = () => {
  const screen = useActiveScreenStore((state) => state.screen);
  const {
    queries: { getMetricsEnabled },
  } = useNetwork();
  const { data: metricsEnabledData } = useQuery(
    QueryKeysConfig.metricsEnabled,
    getMetricsEnabled
  );
  // Guards against a persisted 'metrics' screen (from before metrics was
  // disabled server-side, or from a different bull-horizon instance
  // sharing the same localStorage namespace) rendering a broken screen.
  if (screen === 'metrics' && metricsEnabledData?.metricsEnabled === false) {
    return <JobsScreen />;
  }
  switch (screen) {
    case 'jobs':
      return <JobsScreen />;
    case 'metrics':
      return <MetricsScreen />;
    default:
      return null;
  }
};

export default ScreensSwitch;
