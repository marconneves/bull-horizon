import React, { memo } from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import makeStyles from '@mui/styles/makeStyles';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import { getPollingInterval } from '@/stores/network-settings';
import NetworkRequest from '@/components/NetworkRequest';
import { useJobStatusesPalette } from '@/components/JobStatusChip/hooks';
import { JobStatus } from '@/typings/gql';
import ThroughputChart from '../shared/ThroughputChart';
import TimeRangePicker from '../shared/TimeRangePicker';
import { useTimeRange } from '../shared/time-range';

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  },
  table: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(2),
  },
  title: {
    fontWeight: 600,
    marginBottom: theme.spacing(2),
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 1.4fr) 3fr auto auto',
    gap: theme.spacing(2),
    alignItems: 'center',
    padding: theme.spacing(1, 0),
    borderBottom: `1px solid ${theme.palette.divider}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  head: {
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: theme.palette.text.secondary,
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
  },
  bar: {
    display: 'flex',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: theme.palette.action.hover,
    minWidth: 0,
  },
  num: {
    fontVariantNumeric: 'tabular-nums',
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: 13,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  failedNum: {
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'flex-end',
  },
  rate: {
    color: theme.palette.text.secondary,
  },
}));

function HistoryScreen() {
  const cls = useStyles();
  const palette = useJobStatusesPalette();
  const {
    queries: { getMetricsSummary },
  } = useNetwork();
  const { range, changeRange, since } = useTimeRange();
  const refetchInterval = getPollingInterval();

  const { status, refetch, data, error } = useQuery(
    [QueryKeysConfig.metricsSummary, { since, maxPoints: range.maxPoints }],
    () => getMetricsSummary({ since, maxPoints: range.maxPoints }),
    {
      refetchInterval,
      keepPreviousData: true,
      select: (d) => d?.metricsSummary,
    }
  );

  const summary = data;
  // The widest queue sets the scale, so the bars compare against each other
  // rather than against an absolute that means nothing to the reader.
  const maxRuns = Math.max(
    1,
    ...(summary?.queues ?? []).map((q) => q.completed + q.failed)
  );

  return (
    <NetworkRequest error={error} refetch={refetch} status={status}>
      <div className={cls.root}>
        <ThroughputChart
          title="Metrics history"
          points={summary?.points ?? []}
          totalCompleted={summary?.totalCompleted ?? 0}
          totalFailed={summary?.totalFailed ?? 0}
          action={<TimeRangePicker value={range} onChange={changeRange} />}
          emptyLabel="No jobs finished in this window. Throughput is recorded while the monitor process is running — history from before it started is not backfilled."
        />
        {!!summary?.queues.length && (
          <Paper elevation={0} className={cls.table}>
            <Typography className={cls.title} variant="subtitle1">
              By queue
            </Typography>
            <div className={`${cls.row} ${cls.head}`}>
              <span>Queue</span>
              <span>Runs</span>
              <span className={cls.num}>Completed</span>
              <span className={cls.num}>Failed</span>
            </div>
            {summary.queues.map((queue) => {
              const runs = queue.completed + queue.failed;
              const failRate = runs ? (queue.failed / runs) * 100 : 0;
              return (
                <div className={cls.row} key={queue.queue}>
                  <span className={cls.name} title={queue.name}>
                    {queue.name}
                  </span>
                  <Tooltip title={`${runs} runs`}>
                    <div
                      className={cls.bar}
                      style={{ width: `${(runs / maxRuns) * 100}%` }}
                    >
                      <span
                        style={{
                          flexGrow: queue.completed || 1,
                          backgroundColor: palette[JobStatus.Completed],
                        }}
                      />
                      {queue.failed > 0 && (
                        <span
                          style={{
                            flexGrow: queue.failed,
                            backgroundColor: palette[JobStatus.Failed],
                          }}
                        />
                      )}
                    </div>
                  </Tooltip>
                  <span className={cls.num}>
                    {queue.completed.toLocaleString()}
                  </span>
                  <span className={`${cls.num} ${cls.failedNum}`}>
                    <span
                      style={{
                        color:
                          queue.failed > 0
                            ? palette[JobStatus.Failed]
                            : undefined,
                      }}
                    >
                      {queue.failed.toLocaleString()}
                    </span>
                    <span className={cls.rate}>{failRate.toFixed(1)}%</span>
                  </span>
                </div>
              );
            })}
          </Paper>
        )}
      </div>
    </NetworkRequest>
  );
}

export default memo(HistoryScreen);
