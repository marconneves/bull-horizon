import React from 'react';
import JobsCount from './charts/JobsCount';
import ProcessingTime from './charts/ProcessingTime';
import Actions from './Actions';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { useAtomValue } from 'jotai/utils';
import { activeQueueAtom } from '@/atoms/workspaces';
import NetworkRequest from '@/components/NetworkRequest';
import { getPollingInterval } from '@/stores/network-settings';
import { QueryKeysConfig } from '@/config/query-keys';
import isempty from 'lodash/isEmpty';
import Alert from '@mui/material/Alert';
import makeStyles from '@mui/styles/makeStyles';
import TimeRangePicker from '../shared/TimeRangePicker';
import { useTimeRange } from '../shared/time-range';

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    flexWrap: 'wrap',
  },
  range: {
    marginLeft: 'auto',
  },
  charts: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
    gap: theme.spacing(1.5),
  },
}));

const MetricsScreen = () => {
  const {
    queries: { getQueueMetrics },
  } = useNetwork();
  const cls = useStyles();
  const queue = useAtomValue(activeQueueAtom) as string;
  const { range, ranges, changeRange, since } = useTimeRange();
  const refetchInterval = getPollingInterval();
  const { status, refetch, data, error } = useQuery(
    [QueryKeysConfig.metrics, { queue, since, maxPoints: range.maxPoints }],
    // Windowed like every other metrics view. Without `since` this asked for
    // the entire series on every poll, which the tiered retention made much
    // more expensive than it used to be.
    () => getQueueMetrics({ queue, since, maxPoints: range.maxPoints }),
    {
      refetchInterval,
      keepPreviousData: true,
      select: (d) => d?.metrics ?? [],
    }
  );
  return (
    <NetworkRequest error={error} refetch={refetch} status={status}>
      <div className={cls.root}>
        <div className={cls.toolbar}>
          <Actions />
          <div className={cls.range}>
            <TimeRangePicker
              value={range}
              ranges={ranges}
              onChange={changeRange}
            />
          </div>
        </div>
        {isempty(data) ? (
          <Alert severity="info">
            No metrics in this window yet — they are collected while the monitor
            process is running.
          </Alert>
        ) : (
          <div className={cls.charts}>
            <JobsCount metrics={data!} />
            <ProcessingTime metrics={data!} />
          </div>
        )}
      </div>
    </NetworkRequest>
  );
};

export default MetricsScreen;
