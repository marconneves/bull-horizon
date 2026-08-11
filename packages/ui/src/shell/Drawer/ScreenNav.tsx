import React, { memo } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import OverviewIcon from '@mui/icons-material/GridView';
import HistoryIcon from '@mui/icons-material/ShowChart';
import QueueMetricsIcon from '@mui/icons-material/Timeline';
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
}));

type TEntry = {
  screen: TScreen;
  label: string;
  icon: React.ReactNode;
  /** Only meaningful while the metrics collector is running. */
  needsMetrics?: boolean;
};

const ENTRIES: TEntry[] = [
  { screen: 'overview', label: 'Overview', icon: <OverviewIcon /> },
  {
    screen: 'history',
    label: 'Metrics history',
    icon: <HistoryIcon />,
    needsMetrics: true,
  },
  // Depth-over-time and processing time for the queue that is currently open.
  // Used to hide behind an AppBar toggle, which left navigation split between
  // the sidebar and an icon most people never found.
  {
    screen: 'metrics',
    label: 'Queue metrics',
    icon: <QueueMetricsIcon />,
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
  const entries = ENTRIES.filter(
    (entry) => !entry.needsMetrics || metricsEnabled
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
