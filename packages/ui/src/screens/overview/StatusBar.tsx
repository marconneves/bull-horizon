import React, { memo } from 'react';
import Tooltip from '@mui/material/Tooltip';
import makeStyles from '@mui/styles/makeStyles';
import { useJobStatusesPalette } from '@/components/JobStatusChip/hooks';
import { JobStatus } from '@/typings/gql';

/** Order mirrors a job's lifecycle, so the bar reads left to right. */
export const BAR_STATUSES: JobStatus[] = [
  JobStatus.Active,
  JobStatus.Waiting,
  JobStatus.Prioritized,
  JobStatus.Completed,
  JobStatus.Failed,
  JobStatus.Delayed,
  JobStatus.Paused,
];

const useStyles = makeStyles((theme) => ({
  bar: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 2,
    height: 24,
    flex: 1,
    minWidth: 0,
  },
  segment: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 6,
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: theme.palette.getContrastText(theme.palette.background.paper),
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    cursor: 'default',
  },
  empty: {
    flex: 1,
    borderRadius: 3,
    backgroundColor: theme.palette.action.hover,
  },
}));

export type TCounts = Partial<Record<JobStatus, number | null | undefined>>;

type TProps = {
  counts: TCounts;
};

function StatusBar({ counts }: TProps) {
  const cls = useStyles();
  const palette = useJobStatusesPalette();
  const segments = BAR_STATUSES.map((status) => ({
    status,
    value: counts[status] ?? 0,
  })).filter((segment) => segment.value > 0);
  const total = segments.reduce((acc, segment) => acc + segment.value, 0);

  if (total === 0) {
    return (
      <div className={cls.bar}>
        <div className={cls.empty} />
      </div>
    );
  }

  return (
    <div className={cls.bar}>
      {segments.map(({ status, value }) => (
        <Tooltip key={status} title={`${value} ${status}`}>
          <div
            className={cls.segment}
            style={{
              // Weighted by share of the total, with a floor from `minWidth`
              // so a single job in a queue of 10k is still visible.
              flexGrow: value,
              flexBasis: 0,
              backgroundColor: palette[status],
              color: '#0b0b0f',
            }}
          >
            {value}
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

export default memo(StatusBar);
