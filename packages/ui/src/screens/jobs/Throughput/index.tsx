import React, { memo, useMemo } from 'react';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import makeStyles from '@mui/styles/makeStyles';
import { useQuery } from 'react-query';
import { useAtomValue } from 'jotai/utils';
import { activeQueueAtom } from '@/atoms/workspaces';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import { getPollingInterval } from '@/stores/network-settings';
import { useThroughputPanelStore } from '@/stores/throughput-panel';
import ThroughputChart from '../../shared/ThroughputChart';
import TimeRangePicker from '../../shared/TimeRangePicker';
import { useTimeRange } from '../../shared/time-range';

const useStyles = makeStyles((theme) => ({
  root: {
    marginBottom: theme.spacing(1.5),
    position: 'relative',
  },
  toggle: {
    position: 'absolute',
    top: theme.spacing(1.25),
    left: theme.spacing(1.25),
    zIndex: 1,
  },
  toggleIcon: {
    transition: theme.transitions.create('transform'),
  },
  collapsed: {
    transform: 'rotate(-90deg)',
  },
  padded: {
    paddingLeft: theme.spacing(4),
  },
  collapsedBar: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1, 1, 1, 5),
    fontSize: 14,
    color: theme.palette.text.secondary,
    backgroundColor: theme.palette.background.paper,
  },
}));

type TProps = {
  /** Hidden entirely when the collector is off — there is nothing to plot. */
  enabled: boolean;
};

function Throughput({ enabled }: TProps) {
  const cls = useStyles();
  const queue = useAtomValue(activeQueueAtom) as string;
  const {
    queries: { getQueueMetrics },
  } = useNetwork();
  const { range, changeRange, since } = useTimeRange();
  const refetchInterval = getPollingInterval();
  const { isOpen, toggle } = useThroughputPanelStore();

  const { data } = useQuery(
    [QueryKeysConfig.throughput, { queue, since, maxPoints: range.maxPoints }],
    () => getQueueMetrics({ queue, since, maxPoints: range.maxPoints }),
    {
      // Collapsed panel keeps no polling running behind the fold.
      enabled: enabled && !!queue && isOpen,
      refetchInterval,
      keepPreviousData: true,
      select: (d) => d?.metrics ?? [],
    }
  );

  const points = useMemo(
    () =>
      (data ?? []).map((metric) => ({
        timestamp: metric.timestamp,
        completed: metric.completed ?? 0,
        failed: metric.failed ?? 0,
      })),
    [data]
  );
  const totals = useMemo(
    () =>
      points.reduce(
        (acc, point) => ({
          completed: acc.completed + point.completed,
          failed: acc.failed + point.failed,
        }),
        { completed: 0, failed: 0 }
      ),
    [points]
  );

  if (!enabled) return null;

  return (
    <div className={cls.root}>
      <IconButton
        className={cls.toggle}
        size="small"
        onClick={toggle}
        aria-label={isOpen ? 'collapse throughput' : 'expand throughput'}
        aria-expanded={isOpen}
      >
        <ExpandMoreIcon
          fontSize="small"
          className={`${cls.toggleIcon} ${isOpen ? '' : cls.collapsed}`}
        />
      </IconButton>
      <Collapse in={isOpen} unmountOnExit>
        <div className={cls.padded}>
          <ThroughputChart
            title="Throughput (jobs / window)"
            points={points}
            totalCompleted={totals.completed}
            totalFailed={totals.failed}
            action={<TimeRangePicker value={range} onChange={changeRange} />}
          />
        </div>
      </Collapse>
      {!isOpen && <div className={cls.collapsedBar}>Throughput</div>}
    </div>
  );
}

export default memo(Throughput);
