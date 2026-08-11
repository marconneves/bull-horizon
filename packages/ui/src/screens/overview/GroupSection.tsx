import React, { memo } from 'react';
import Typography from '@mui/material/Typography';
import makeStyles from '@mui/styles/makeStyles';
import QueueCard from './QueueCard';
import type { TCounts } from './StatusBar';
import type { GetQueuesQuery, JobStatus } from '@/typings/gql';

type TQueue = NonNullable<GetQueuesQuery['queues']>[0];

const useStyles = makeStyles((theme) => ({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(1.5),
    paddingBottom: theme.spacing(0.75),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  name: {
    fontWeight: 600,
    fontSize: 15,
  },
  meta: {
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: 11,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: theme.palette.text.secondary,
    fontVariantNumeric: 'tabular-nums',
  },
  ungroupedName: {
    color: theme.palette.text.secondary,
    fontWeight: 500,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: theme.spacing(1.5),
  },
}));

type TProps = {
  name: string;
  queues: TQueue[];
  focusedStatus?: JobStatus | null;
  /** Queues with no `group` set — labelled, but visually quieter. */
  isUngrouped?: boolean;
};

function GroupSection({ name, queues, focusedStatus, isUngrouped }: TProps) {
  const cls = useStyles();
  // Under a status filter the header counts *that* status. Showing the all-status
  // total while the screen shows only failures reads as "33 jobs" next to a
  // handful of red bars, which is worse than showing nothing.
  const total = queues.reduce((acc, queue) => {
    const counts = queue.jobsCounts as TCounts;
    if (focusedStatus) return acc + (counts[focusedStatus] ?? 0);
    return (
      acc +
      Object.values(counts).reduce<number>(
        (sum, value) => sum + (typeof value === 'number' ? value : 0),
        0
      )
    );
  }, 0);
  const totalLabel = focusedStatus
    ? focusedStatus
    : total === 1
    ? 'job'
    : 'jobs';

  return (
    <section className={cls.section}>
      <div className={cls.header}>
        <Typography
          className={`${cls.name} ${isUngrouped ? cls.ungroupedName : ''}`}
        >
          {name}
        </Typography>
        <span className={cls.meta}>
          {queues.length} {queues.length === 1 ? 'queue' : 'queues'} ·{' '}
          {total.toLocaleString()} {totalLabel}
        </span>
      </div>
      <div className={cls.grid}>
        {queues.map((queue) => (
          <QueueCard
            key={queue.id}
            queue={queue}
            focusedStatus={focusedStatus}
            // The section header already says which group this is.
            hideGroup
          />
        ))}
      </div>
    </section>
  );
}

export default memo(GroupSection);
