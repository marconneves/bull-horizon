import React, { memo, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import isempty from 'lodash/isEmpty';
import NetworkRequest from '@/components/NetworkRequest';
import { useQueuesQuery } from '@/hooks/use-queues-query';
import { useJobStatusesPalette } from '@/components/JobStatusChip/hooks';
import type { JobStatus } from '@/typings/gql';
import QueueCard from './QueueCard';
import GroupSection from './GroupSection';
import { BAR_STATUSES } from './StatusBar';
import type { TCounts } from './StatusBar';
import { useGroupedQueues } from '@/shell/Drawer/Queues/hooks';

const useStyles = makeStyles((theme) => ({
  filters: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'nowrap',
    overflowX: 'auto',
    padding: theme.spacing(1.5),
    marginBottom: theme.spacing(1.5),
    border: `1px solid ${theme.palette.divider}`,
    scrollbarWidth: 'thin',
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    flexShrink: 0,
    padding: theme.spacing(0.5, 1.25),
    borderRadius: 999,
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    userSelect: 'none',
    textTransform: 'capitalize',
    transition: 'background-color 120ms, border-color 120ms, color 120ms',
    backgroundColor: alpha(theme.palette.text.secondary, 0.08),
    border: `1px solid ${theme.palette.divider}`,
    color: theme.palette.text.secondary,
    '&:hover': {
      borderColor: theme.palette.text.disabled,
    },
  },
  pillActive: {
    backgroundColor: alpha(theme.palette.primary.main, 0.16),
    borderColor: theme.palette.primary.main,
    color: theme.palette.primary.main,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  },
  count: {
    fontVariantNumeric: 'tabular-nums',
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    borderRadius: 999,
    padding: theme.spacing(0, 0.75),
    backgroundColor: alpha(theme.palette.text.secondary, 0.14),
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: theme.spacing(1.5),
  },
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(3),
  },
}));

const ALL = 'all' as const;
type TFilter = JobStatus | typeof ALL;

function OverviewScreen() {
  const cls = useStyles();
  const palette = useJobStatusesPalette();
  const { data, status, refetch, error } = useQueuesQuery();
  const [filter, setFilter] = useState<TFilter>(ALL);
  const queues = data?.queues;

  const totals = useMemo(() => {
    const acc: Partial<Record<JobStatus, number>> = {};
    for (const queue of queues ?? []) {
      const counts = queue.jobsCounts as TCounts;
      for (const jobStatus of BAR_STATUSES) {
        const value = counts[jobStatus];
        if (typeof value === 'number') {
          acc[jobStatus] = (acc[jobStatus] ?? 0) + value;
        }
      }
    }
    return acc;
  }, [queues]);

  const visibleQueues = useMemo(() => {
    if (!queues) return [];
    if (filter === ALL) return queues;
    // Filtering rather than only sorting: on a status tab, a queue with zero
    // jobs in that status is noise, not information.
    return queues
      .filter((queue) => ((queue.jobsCounts as TCounts)[filter] ?? 0) > 0)
      .sort(
        (a, b) =>
          ((b.jobsCounts as TCounts)[filter] ?? 0) -
          ((a.jobsCounts as TCounts)[filter] ?? 0)
      );
  }, [queues, filter]);

  const statusesWithJobs = BAR_STATUSES.filter(
    (jobStatus) => (totals[jobStatus] ?? 0) > 0
  );

  // Same grouping the sidebar uses, so the two views can never disagree about
  // what belongs where. Groups are built from the *visible* queues, so a status
  // filter empties a section out of existence instead of leaving a bare header.
  const { groups, ungrouped } = useGroupedQueues(visibleQueues);
  const focusedStatus = filter === ALL ? null : filter;

  return (
    <NetworkRequest error={error} refetch={refetch} status={status}>
      {isempty(queues) ? (
        <Alert severity="error">No queues</Alert>
      ) : (
        <>
          <Paper elevation={0} className={cls.filters}>
            <span
              className={`${cls.pill} ${filter === ALL ? cls.pillActive : ''}`}
              onClick={() => setFilter(ALL)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setFilter(ALL)}
            >
              All queues
              <span className={cls.count}>{queues!.length}</span>
            </span>
            {statusesWithJobs.map((jobStatus) => (
              <span
                key={jobStatus}
                className={`${cls.pill} ${
                  filter === jobStatus ? cls.pillActive : ''
                }`}
                onClick={() => setFilter(jobStatus)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setFilter(jobStatus)}
              >
                <span
                  className={cls.dot}
                  style={{ backgroundColor: palette[jobStatus] }}
                />
                {jobStatus}
                <span className={cls.count}>{totals[jobStatus]}</span>
              </span>
            ))}
          </Paper>
          {visibleQueues.length === 0 ? (
            <Alert severity="info">
              No queue currently has jobs in this status.
            </Alert>
          ) : groups.length === 0 ? (
            // Nothing is grouped: a single "No group" header would be a label
            // for the entire screen, which says nothing.
            <div className={cls.grid}>
              {visibleQueues.map((queue) => (
                <QueueCard
                  key={queue.id}
                  queue={queue}
                  focusedStatus={focusedStatus}
                />
              ))}
            </div>
          ) : (
            <div className={cls.sections}>
              {groups.map((group) => (
                <GroupSection
                  key={group.name}
                  name={group.name}
                  queues={group.queues}
                  focusedStatus={focusedStatus}
                />
              ))}
              {ungrouped.length > 0 && (
                <GroupSection
                  name="No group"
                  queues={ungrouped}
                  focusedStatus={focusedStatus}
                  isUngrouped
                />
              )}
            </div>
          )}
        </>
      )}
    </NetworkRequest>
  );
}

export default memo(OverviewScreen);
