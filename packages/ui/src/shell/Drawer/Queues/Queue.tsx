import React, { memo, useCallback } from 'react';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import JobsCount from './JobsCount';
import PauseIcon from '@mui/icons-material/Pause';
import BlockIcon from '@mui/icons-material/Block';
import AgentIcon from '@mui/icons-material/SmartToy';
import { alpha } from '@mui/material/styles';
import makeStyles from '@mui/styles/makeStyles';
import Typography from '@mui/material/Typography';
import { useJobsCountArray, useQueueWorkspaceLabel } from './hooks';
import type { GetQueuesQuery, JobStatus } from '@/typings/gql';
import type { Maybe } from '@/typings/utils';

const useStyles = makeStyles((theme) => ({
  listItem: {
    position: 'relative',
    paddingRight: theme.spacing(1),
    '& .MuiListItemIcon-root': {
      minWidth: 32,
    },
  },
  name: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    minWidth: 0,
  },
  nameText: {
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
  agentIcon: {
    flex: 'none',
    fontSize: '15px !important',
    color: alpha(theme.palette.text.primary, 0.6),
  },
}));

type TProps = {
  queue: NonNullable<GetQueuesQuery['queues']>[0];
  isSelected: boolean;
  /** Marks AI agent queues (not on Agents, where every queue is one). */
  showAgentIcon?: boolean;

  onSelect: (queue: string, label: string, status?: Maybe<JobStatus>) => void;
};
const DrawerQueue = (props: TProps) => {
  const cls = useStyles();
  const workspaceLabel = useQueueWorkspaceLabel(props.queue);
  const { id, isPaused, readonly } = props.queue;
  const onSelect: React.MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      const tar = e.target as HTMLElement;
      const $statusChip = tar?.closest<HTMLElement>('[data-status]');
      let status: Maybe<JobStatus> = null;
      if ($statusChip) {
        status = $statusChip.dataset.status as JobStatus;
      }
      props.onSelect(id, workspaceLabel, status);
    },
    // `props.onSelect` belongs here: without it this memo pins whichever
    // parent callback existed on first render, silently ignoring later ones.
    [id, workspaceLabel, props.onSelect]
  );
  const countArray = useJobsCountArray(props.queue.jobsCounts);
  return (
    <ListItem
      onClick={onSelect}
      selected={props.isSelected}
      className={cls.listItem}
      dense
      button
    >
      {(readonly || isPaused) && (
        <ListItemIcon>
          <ListItemIcon title={isPaused ? 'Paused' : 'Readonly'}>
            {isPaused ? <PauseIcon /> : <BlockIcon />}
          </ListItemIcon>
        </ListItemIcon>
      )}
      <ListItemText
        disableTypography
        primary={
          <span className={cls.name}>
            <Typography className={cls.nameText}>{props.queue.name}</Typography>
            {props.showAgentIcon && props.queue.agent && (
              <AgentIcon
                className={cls.agentIcon}
                titleAccess="AI agent queue"
              />
            )}
          </span>
        }
        secondary={<JobsCount count={countArray} />}
      />
    </ListItem>
  );
};

export default memo(DrawerQueue);
