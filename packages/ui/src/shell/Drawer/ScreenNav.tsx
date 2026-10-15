import React, { memo } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import OverviewIcon from '@mui/icons-material/GridView';
import HistoryIcon from '@mui/icons-material/ShowChart';
import JobsIcon from '@mui/icons-material/ViewList';
import AgentsIcon from '@mui/icons-material/SmartToy';
import makeStyles from '@mui/styles/makeStyles';
import { useActiveScreenStore } from '@/stores/active-screen';
import { useDrawerState } from '@/stores/drawer';
import { useAgentsStore } from '@/stores/agents';
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
}));

type TEntry = {
  screen: TScreen;
  label: string;
  icon: React.ReactNode;
  /** Only meaningful while the metrics collector is running. */
  needsMetrics?: boolean;
  /**
   * Only meaningful when some queue is an AI agent queue. Not tied to the
   * collector: without it the screen still opens single runs.
   */
  needsAgents?: boolean;
};

/**
 * `Jobs` is listed rather than being implicit so returning to it is always one
 * click: while it lived behind an AppBar toggle, the other screens were a dead
 * end. Flat on purpose — a handful of entries do not need grouping.
 */
const ENTRIES: TEntry[] = [
  { screen: 'jobs', label: 'Jobs', icon: <JobsIcon /> },
  { screen: 'overview', label: 'Overview', icon: <OverviewIcon /> },
  {
    screen: 'history',
    label: 'Metrics history',
    icon: <HistoryIcon />,
    needsMetrics: true,
  },
  {
    screen: 'agents',
    label: 'Agents',
    icon: <AgentsIcon />,
    needsAgents: true,
  },
];

type TProps = {
  metricsEnabled: boolean;
  hasAgents: boolean;
};

function ScreenNav({ metricsEnabled, hasAgents }: TProps) {
  const cls = useStyles();
  const { screen, changeScreen } = useActiveScreenStore();
  const closeDrawer = useDrawerState((state) => state.close);
  const entries = ENTRIES.filter(
    (entry) =>
      (!entry.needsMetrics || metricsEnabled) &&
      (!entry.needsAgents || hasAgents)
  );

  return (
    <>
      <List disablePadding>
        {entries.map((entry) => (
          <ListItem
            button
            dense
            key={entry.screen}
            className={cls.item}
            selected={screen === entry.screen}
            onClick={() => {
              // The sidebar entry is the way into the Agents tabs; an open
              // run is left through its own back button.
              if (entry.screen === 'agents') {
                useAgentsStore.getState().leaveRun();
              }
              changeScreen(entry.screen);
              closeDrawer();
            }}
          >
            <ListItemIcon className={cls.icon}>{entry.icon}</ListItemIcon>
            <ListItemText className={cls.text} primary={entry.label} />
          </ListItem>
        ))}
      </List>
      <Divider />
    </>
  );
}

export default memo(ScreenNav);
