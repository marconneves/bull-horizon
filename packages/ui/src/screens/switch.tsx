import { useActiveScreenStore, METRICS_SCREENS } from '@/stores/active-screen';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import React from 'react';
import { useQuery } from 'react-query';
import { useQueuesQuery } from '@/hooks/use-queues-query';
import JobsScreen from './jobs';
import OverviewScreen from './overview';
import HistoryScreen from './history';
import AgentsScreen from './agents';

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
  const { data: queuesData } = useQueuesQuery();
  // Same guard for the agents screen once the queues say none is an agent
  // queue (the sidebar entry is hidden then, so it would be a dead end).
  if (
    screen === 'agents' &&
    queuesData?.queues &&
    !queuesData.queues.some((queue) => !!queue.agent)
  ) {
    return <JobsScreen />;
  }
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
    case 'agents':
      return <AgentsScreen />;
    default:
      // Covers a screen persisted by an older build that no longer exists
      // (the per-queue metrics screen) — otherwise it renders blank forever.
      return <JobsScreen />;
  }
};

export default ScreensSwitch;
