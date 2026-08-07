import React, { memo, useCallback } from 'react';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Collapse from '@mui/material/Collapse';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import Typography from '@mui/material/Typography';
import makeStyles from '@mui/styles/makeStyles';
import { useExpandedQueueGroupsStore } from '@/stores/expanded-queue-groups';
import { useAggregatedJobsCount } from './hooks';
import JobsCount from './JobsCount';
import type { TQueueGroup } from './hooks';

const useStyles = makeStyles((theme) => ({
  listItem: {
    position: 'relative',
    paddingRight: theme.spacing(1),
    '& .MuiListItemIcon-root': {
      minWidth: 32,
    },
  },
  chevron: {
    minWidth: 20,
    transition: theme.transitions.create('transform', { duration: 120 }),
  },
  chevronOpen: {
    transform: 'rotate(90deg)',
  },
  folderIcon: {
    fontSize: 18,
    color: theme.palette.primary.light,
  },
  count: {
    marginLeft: theme.spacing(0.75),
  },
  children: {
    marginLeft: theme.spacing(3.25),
    borderLeft: `1.5px solid ${theme.palette.divider}`,
  },
}));

type TProps = {
  group: TQueueGroup;
  renderQueue: (queue: TQueueGroup['queues'][0]) => React.ReactNode;
};
const QueueGroup = ({ group, renderQueue }: TProps) => {
  const cls = useStyles();
  const isExpanded = useExpandedQueueGroupsStore(
    (state) => !!state.expanded[group.name]
  );
  const toggle = useExpandedQueueGroupsStore((state) => state.toggle);
  const onToggle = useCallback(() => toggle(group.name), [group.name]);
  const aggregatedCount = useAggregatedJobsCount(group.queues);

  return (
    <>
      <ListItem
        onClick={onToggle}
        className={cls.listItem}
        dense
        button
        aria-expanded={isExpanded}
      >
        <ListItemIcon
          className={`${cls.chevron} ${isExpanded ? cls.chevronOpen : ''}`}
        >
          <ChevronRightIcon fontSize="small" />
        </ListItemIcon>
        <ListItemIcon>
          <FolderOutlinedIcon className={cls.folderIcon} />
        </ListItemIcon>
        <ListItemText
          disableTypography
          primary={
            <Typography
              style={{
                display: 'flex',
                alignItems: 'baseline',
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {group.name}
              </span>
              <Typography
                component="span"
                variant="caption"
                color="textSecondary"
                className={cls.count}
                style={{
                  flexShrink: 0,
                  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
                }}
              >
                {group.queues.length}
              </Typography>
            </Typography>
          }
          secondary={
            aggregatedCount.length > 0 ? (
              <JobsCount count={aggregatedCount} />
            ) : undefined
          }
        />
      </ListItem>
      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
        <div className={cls.children}>{group.queues.map(renderQueue)}</div>
      </Collapse>
    </>
  );
};

export default memo(QueueGroup);
