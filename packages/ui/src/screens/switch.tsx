import { useActiveScreenStore, METRICS_SCREENS } from '@/stores/active-screen';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import React from 'react';
import { useQuery } from 'react-query';
import JobsScreen from './jobs';
import OverviewScreen from './overview';
import HistoryScreen from './history';

const ScreensSwitch = () => {
  const screen = useActiveScreenStore((state) => state.screen);
  const {
    queries: { getMetricsEnabled },
  } = useNetwork();
  const { data: metricsEnabledData } = useQuery(
    QueryKeysConfig.metricsEnabled,
    getMetricsEnabled,
    { staleTime: Infinity }
  );
  // Guards against a persisted metrics-only screen (from before metrics was
  // disabled server-side, or from a different bull-horizon instance
  // sharing the same localStorage namespace) rendering a broken screen.
  if (
    METRICS_SCREENS.includes(screen) &&
    metricsEnabledData?.metricsEnabled === false
  ) {
    return <JobsScreen />;
  }
  switch (screen) {
    case 'jobs':
      return <JobsScreen />;
    case 'overview':
      return <OverviewScreen />;
    case 'history':
      return <HistoryScreen />;
    default:
      // Covers a screen persisted by an older build that no longer exists
      // (the per-queue metrics screen) — otherwise it renders blank forever.
      return <JobsScreen />;
  }
};

export default ScreensSwitch;
