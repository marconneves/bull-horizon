import React from 'react';
import BaseDrawer from '@mui/material/Drawer';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import IconButton from '@mui/material/IconButton';
import { useTheme } from '@mui/material/styles';
import makeStyles from '@mui/styles/makeStyles';
import { useDrawerState } from '@/stores/drawer';
import shallow from 'zustand/shallow';
import NetworkRequest from '@/components/NetworkRequest';
import {
  useFilteredQueues,
  useSortedQueues,
  useDraggerEventHandlers,
} from './hooks';
import QueuesList from './Queues';
import QueuesFilter from './Filter';
import QueuesSorter from './Sorter';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useQueuesQuery } from '@/hooks/use-queues-query';
import isempty from 'lodash/isEmpty';
import Alert from '@mui/material/Alert';
import { LayoutConfig } from '@/config/layouts';
import ScreenNav from './ScreenNav';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';

const useStyles = makeStyles((theme) => ({
  drawer: {
    width: 'auto',
    position: 'relative',
    [theme.breakpoints.up('md')]: {
      width: 'var(--drawer-width)',
      flexShrink: 0,
    },
  },
  toolbar: {
    ...theme.mixins.toolbar,
    display: 'flex',
    alignItems: 'center',
  },
  utils: {
    display: 'flex',
    marginTop: theme.spacing(1),
    marginLeft: theme.spacing(0.5),
    marginRight: theme.spacing(0.5),
    alignItems: 'center',
  },
  filter: {
    flex: 1,
  },
  dragger: {
    width: 4,
    cursor: 'ew-resize',
    position: 'absolute',
    top: 0,
    right: -4,
    bottom: 0,
    zIndex: 1201,
  },
}));

export default function Drawer() {
  const { data, status, refetch, error } = useQueuesQuery();
  const {
    queries: { getMetricsEnabled },
  } = useNetwork();
  const { data: metricsEnabledData } = useQuery(
    QueryKeysConfig.metricsEnabled,
    getMetricsEnabled,
    { staleTime: Infinity }
  );
  const cls = useStyles();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [isOpen, closeDrawer] = useDrawerState(
    (state) => [state.isOpen, state.close],
    shallow
  );
  const { onMouseDown: onDraggerMouseDown } = useDraggerEventHandlers();
  const queues = data?.queues;
  const filteredQueues = useFilteredQueues(queues);
  const sortedQueues = useSortedQueues(filteredQueues);

  return (
    <nav className={cls.drawer}>
      <div onMouseDown={onDraggerMouseDown} className={cls.dragger} />
      <BaseDrawer
        open={isDesktop || isOpen}
        container={isDesktop ? undefined : document.querySelector('main')}
        variant={isDesktop ? 'permanent' : 'temporary'}
        onClose={closeDrawer}
        anchor={theme.direction === 'rtl' ? 'right' : 'left'}
        PaperProps={{
          style: {
            width: isDesktop
              ? 'var(--drawer-width)'
              : LayoutConfig.drawerWidth + 'px',
          },
        }}
      >
        <div className={cls.toolbar}>
          <IconButton onClick={closeDrawer} size="large">
            {theme.direction === 'ltr' ? (
              <ChevronLeftIcon />
            ) : (
              <ChevronRightIcon />
            )}
          </IconButton>
        </div>
        <ScreenNav
          metricsEnabled={metricsEnabledData?.metricsEnabled ?? false}
        />
        <NetworkRequest error={error} status={status} refetch={refetch}>
          {isempty(queues) ? (
            <Alert severity="error">No queues</Alert>
          ) : (
            <>
              <div className={cls.utils}>
                <QueuesFilter className={cls.filter} />
                <QueuesSorter />
              </div>
              {sortedQueues && <QueuesList queues={sortedQueues} />}
            </>
          )}
        </NetworkRequest>
      </BaseDrawer>
    </nav>
  );
}
