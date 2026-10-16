import React, { memo, useMemo } from 'react';
import Paper from '@mui/material/Paper';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import makeStyles from '@mui/styles/makeStyles';
import shallow from 'zustand/shallow';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { useQueuesQuery } from '@/hooks/use-queues-query';
import { QueryKeysConfig } from '@/config/query-keys';
import { useAgentsStore } from '@/stores/agents';
import TimeRangePicker from '../shared/TimeRangePicker';
import { useTimeRange } from '../shared/time-range';
import Spin from '@/components/Spin';
import { MONO } from './shared';
import MetricsTab from './MetricsTab';
import RunsTab from './RunsTab';
import AgentRunView from './run';
import AgentConversationView from './conversation';

const ALL = '__all__';

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  header: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1, 1.5, 0),
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: theme.spacing(2),
    rowGap: theme.spacing(1),
  },
  title: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingBottom: theme.spacing(1),
  },
  heading: {
    fontWeight: 600,
    fontSize: 15,
  },
  sub: {
    fontFamily: MONO,
    fontSize: 11,
    color: theme.palette.text.secondary,
  },
  select: {
    fontSize: 13,
    minWidth: 180,
    marginBottom: theme.spacing(1),
    '& .MuiSelect-select': {
      padding: theme.spacing(0.5, 1),
    },
  },
  spacer: {
    flex: 1,
  },
  tabs: {
    minHeight: 40,
    '& .MuiTab-root': {
      minHeight: 40,
      textTransform: 'none',
      fontSize: 13,
      minWidth: 72,
    },
  },
  range: {
    paddingBottom: theme.spacing(1),
  },
  notice: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(5, 2),
    textAlign: 'center',
    color: theme.palette.text.secondary,
    fontSize: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    alignItems: 'center',
  },
}));

/**
 * Agents screen. Metrics and Runs read the metrics collector; the run view
 * reads the job logs, so it keeps working with the collector off.
 */
function AgentsScreen() {
  const cls = useStyles();
  const [
    tab,
    run,
    queue,
    rangeLabel,
    changeTab,
    changeQueue,
    setRange,
    conversation,
  ] = useAgentsStore(
    (state) => [
      state.tab,
      state.run,
      state.queue,
      state.range,
      state.changeTab,
      state.changeQueue,
      state.changeRange,
      state.conversation,
    ],
    shallow
  );
  const { data: queuesData } = useQueuesQuery();
  const agentQueues = useMemo(
    () => (queuesData?.queues ?? []).filter((q) => !!q.agent),
    [queuesData]
  );
  const {
    queries: { getMetricsEnabled },
  } = useNetwork();
  const { data: metricsEnabledData, status: metricsEnabledStatus } = useQuery(
    QueryKeysConfig.metricsEnabled,
    getMetricsEnabled,
    { staleTime: Infinity }
  );
  // Unknown until the query answers: neither the tabs nor the notice yet. A
  // failed query counts as "off", so the screen does not spin forever.
  const collectorKnown =
    metricsEnabledData !== undefined || metricsEnabledStatus === 'error';
  const collector = metricsEnabledData?.metricsEnabled ?? false;
  const { range, ranges, changeRange, since } = useTimeRange({
    label: rangeLabel,
    setLabel: setRange,
  });

  if (run) {
    return <AgentRunView />;
  }
  if (conversation) {
    return <AgentConversationView />;
  }
  if (!collectorKnown) {
    return <Spin centered size={28} />;
  }
  // A queue that stopped being an agent queue falls back to all of them.
  const selectedQueue =
    queue && agentQueues.some((q) => q.id === queue) ? queue : null;
  const queues = selectedQueue ? [selectedQueue] : null;
  // The queue picker only exists next to the tabs.
  const selectedName =
    collector && selectedQueue
      ? agentQueues.find((q) => q.id === selectedQueue)?.name
      : null;

  return (
    <div className={cls.root}>
      <Paper elevation={0} className={cls.header}>
        <div className={cls.title}>
          <Typography className={cls.heading} component="h2">
            Agent runs
          </Typography>
          <span className={cls.sub}>
            {selectedName ??
              `${agentQueues.length} agent ${
                agentQueues.length === 1 ? 'queue' : 'queues'
              }`}
          </span>
        </div>
        {collector && agentQueues.length > 1 && (
          <Select
            className={cls.select}
            size="small"
            value={selectedQueue ?? ALL}
            onChange={(e) =>
              changeQueue(e.target.value === ALL ? null : e.target.value)
            }
            inputProps={{ 'aria-label': 'agent queue' }}
          >
            <MenuItem value={ALL}>All agent queues</MenuItem>
            {agentQueues.map((q) => (
              <MenuItem key={q.id} value={q.id}>
                {q.name}
              </MenuItem>
            ))}
          </Select>
        )}
        <span className={cls.spacer} />
        {collector && (
          <span className={cls.range}>
            <TimeRangePicker
              value={range}
              ranges={ranges}
              onChange={changeRange}
            />
          </span>
        )}
        {/* Without the collector there is nothing behind either tab. */}
        {collector && (
          <Tabs
            className={cls.tabs}
            value={tab}
            onChange={(_e, next) => changeTab(next)}
            textColor="primary"
            indicatorColor="primary"
          >
            <Tab value="metrics" label="Metrics" />
            <Tab value="runs" label="Runs" />
          </Tabs>
        )}
      </Paper>
      {!collector ? (
        <div className={cls.notice}>
          <span>
            Agent metrics and the runs list need the metrics collector, which is
            not running.
          </span>
          <span>
            Single runs still open from an agent job in Jobs (the Agent run
            action), since they are read from the job logs.
          </span>
        </div>
      ) : tab === 'metrics' ? (
        <MetricsTab queues={queues} since={since} range={range} />
      ) : (
        <RunsTab queues={queues} since={since} />
      )}
    </div>
  );
}

export default memo(AgentsScreen);
