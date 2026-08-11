import React, { memo } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Divider from '@mui/material/Divider';
import OverviewIcon from '@mui/icons-material/GridView';
import HistoryIcon from '@mui/icons-material/ShowChart';
import JobsIcon from '@mui/icons-material/ViewList';
import makeStyles from '@mui/styles/makeStyles';
import { useActiveScreenStore } from '@/stores/active-screen';
import { useDrawerState } from '@/stores/drawer';
import type { TScreen } from '@/stores/active-screen';

const useStyles = makeStyles((theme) => ({
  item: {
    paddingTop: theme.spacing(0.5),
    paddingBottom: theme.spacing(0.5),
  },
  icon: {
    minWidth: 34,
  },
  text: {
    '& .MuiTypography-root': {
      fontSize: 14,
    },
  },
  subheader: {
    lineHeight: '28px',
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    backgroundColor: 'transparent',
  },
}));

type TEntry = {
  screen: TScreen;
  label: string;
  icon: React.ReactNode;
  /** Only meaningful while the metrics collector is running. */
  needsMetrics?: boolean;
};

/**
 * Split by scope because the two halves behave differently when a queue is
 * picked from the list below: a per-queue screen just swaps queue, while the
 * all-queue ones hand off to the job list. "Jobs" is listed rather than being
 * implicit so returning to it is always one click, from any screen.
 */
const QUEUE_ENTRIES: TEntry[] = [
  { screen: 'jobs', label: 'Jobs', icon: <JobsIcon /> },
];

const GLOBAL_ENTRIES: TEntry[] = [
  { screen: 'overview', label: 'Overview', icon: <OverviewIcon /> },
  {
    screen: 'history',
    label: 'Metrics history',
    icon: <HistoryIcon />,
    needsMetrics: true,
  },
];

type TProps = {
  metricsEnabled: boolean;
};

function ScreenNav({ metricsEnabled }: TProps) {
  const cls = useStyles();
  const { screen, changeScreen } = useActiveScreenStore();
  const closeDrawer = useDrawerState((state) => state.close);
  const visible = (entries: TEntry[]) =>
    entries.filter((entry) => !entry.needsMetrics || metricsEnabled);

  const renderGroup = (label: string, entries: TEntry[]) => {
    const items = visible(entries);
    if (!items.length) return null;
    return (
      <>
        <ListSubheader className={cls.subheader} disableSticky>
          {label}
        </ListSubheader>
        {items.map((entry) => (
          <ListItem
            button
            dense
            key={entry.screen}
            className={cls.item}
            selected={screen === entry.screen}
            onClick={() => {
              changeScreen(entry.screen);
              closeDrawer();
            }}
          >
            <ListItemIcon className={cls.icon}>{entry.icon}</ListItemIcon>
            <ListItemText className={cls.text} primary={entry.label} />
          </ListItem>
        ))}
      </>
    );
  };

  return (
    <>
      <List disablePadding>
        {renderGroup('Active queue', QUEUE_ENTRIES)}
        {renderGroup('All queues', GLOBAL_ENTRIES)}
      </List>
      <Divider />
    </>
  );
}

export default memo(ScreenNav);
