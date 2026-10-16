import React, { memo, useCallback } from 'react';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Collapse from '@mui/material/Collapse';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FlowIcon from '@mui/icons-material/AccountTree';
import { alpha } from '@mui/material/styles';
import { useFlowsQuery } from '@/hooks/use-flows-query';
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
  flowGroup: {
    backgroundColor: alpha(theme.palette.primary.main, 0.06),
  },
  flowBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    padding: '1px 6px',
    borderRadius: 3,
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: theme.palette.primary.main,
    backgroundColor: alpha(theme.palette.primary.main, 0.12),
    '& svg': {
      fontSize: 11,
    },
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
  // A group a flow is declared on wears its FLOW badge.
  const { data: flowsData } = useFlowsQuery();
  const flows = (flowsData?.flows ?? []).filter((f) => f.group === group.name);

  return (
    <>
      <ListItem
        onClick={onToggle}
        className={`${cls.listItem} ${flows.length ? cls.flowGroup : ''}`}
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
          {flows.length ? (
            <FlowIcon className={cls.folderIcon} />
          ) : (
            <FolderOutlinedIcon className={cls.folderIcon} />
          )}
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
            aggregatedCount.length > 0 || flows.length ? (
              <>
                {aggregatedCount.length > 0 && (
                  <JobsCount count={aggregatedCount} />
                )}
                {flows.map((flow) => (
                  <span className={cls.flowBadge} key={flow.id}>
                    <FlowIcon />
                    FLOW · {flow.id}
                  </span>
                ))}
              </>
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
