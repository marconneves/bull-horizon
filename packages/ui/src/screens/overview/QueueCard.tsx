import React, { memo, useCallback } from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import makeStyles from '@mui/styles/makeStyles';
import { useUpdateAtom } from 'jotai/utils';
import {
  activeQueueAtom,
  activeQueueLabelAtom,
  activeStatusAtom,
} from '@/atoms/workspaces';
import { useActiveScreenStore } from '@/stores/active-screen';
import StatusBar from './StatusBar';
import type { TCounts } from './StatusBar';
import type { GetQueuesQuery } from '@/typings/gql';
import type { JobStatus } from '@/typings/gql';

type TQueue = NonNullable<GetQueuesQuery['queues']>[0];

const useStyles = makeStyles((theme) => ({
  card: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    cursor: 'pointer',
    transition: theme.transitions.create('border-color'),
    '&:hover': {
      borderColor: theme.palette.text.secondary,
    },
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    minWidth: 0,
  },
  name: {
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  group: {
    color: theme.palette.text.secondary,
    fontWeight: 400,
  },
  body: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
  },
  total: {
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    color: theme.palette.text.secondary,
    fontSize: 13,
  },
  paused: {
    height: 20,
    fontSize: 11,
  },
}));

type TProps = {
  queue: TQueue;
  /** When set, clicking the card lands on this status tab. */
  focusedStatus?: JobStatus | null;
};

function QueueCard({ queue, focusedStatus }: TProps) {
  const cls = useStyles();
  const changeActiveQueue = useUpdateAtom(activeQueueAtom);
  const changeActiveQueueLabel = useUpdateAtom(activeQueueLabelAtom);
  const changeActiveStatus = useUpdateAtom(activeStatusAtom);
  const changeScreen = useActiveScreenStore((state) => state.changeScreen);

  const counts = queue.jobsCounts as TCounts;
  const total = Object.values(counts).reduce<number>(
    (acc, value) => acc + (typeof value === 'number' ? value : 0),
    0
  );

  const onClick = useCallback(() => {
    changeActiveQueue(queue.id);
    changeActiveQueueLabel(queue.name);
    if (focusedStatus) {
      changeActiveStatus(focusedStatus);
    }
    changeScreen('jobs');
  }, [queue.id, queue.name, focusedStatus]);

  return (
    <Paper
      elevation={0}
      className={cls.card}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className={cls.head}>
        <Typography className={cls.name} variant="subtitle1" title={queue.name}>
          {queue.group && <span className={cls.group}>{queue.group} / </span>}
          {queue.name}
        </Typography>
        {queue.isPaused && (
          <Chip className={cls.paused} label="Paused" size="small" />
        )}
      </div>
      <div className={cls.body}>
        <StatusBar counts={counts} />
        <span className={cls.total}>
          {total.toLocaleString()} {total === 1 ? 'job' : 'jobs'}
        </span>
      </div>
    </Paper>
  );
}

export default memo(QueueCard);
