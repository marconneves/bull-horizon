import React, { memo } from 'react';
import * as Chart from 'recharts';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import { useJobStatusesPalette } from '@/components/JobStatusChip/hooks';
import { JobStatus } from '@/typings/gql';
import day from 'dayjs';

export type TThroughputPoint = {
  timestamp: number;
  completed: number;
  failed: number;
};

const useStyles = makeStyles((theme) => ({
  root: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
    flexWrap: 'wrap',
  },
  title: {
    fontWeight: 600,
  },
  action: {
    marginLeft: 'auto',
  },
  totals: {
    display: 'flex',
    gap: theme.spacing(4),
    marginTop: theme.spacing(1.5),
    width: '100%',
  },
  total: {
    display: 'flex',
    flexDirection: 'column',
  },
  totalValue: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontSize: 26,
    fontWeight: 600,
    lineHeight: 1.2,
    fontVariantNumeric: 'tabular-nums',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  chart: {
    height: 240,
    width: '100%',
  },
  empty: {
    height: 240,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.palette.text.secondary,
    fontSize: 14,
    textAlign: 'center',
    padding: theme.spacing(0, 2),
  },
}));

const formatTick = (timestamp: number) => day(timestamp).format('MMM D HH:mm');

let gradientSeq = 0;

type TProps = {
  title: string;
  points: TThroughputPoint[];
  totalCompleted: number;
  totalFailed: number;
  action?: React.ReactNode;
  /** Rendered instead of the chart when there is nothing to plot. */
  emptyLabel?: string;
};

function ThroughputChart({
  title,
  points,
  totalCompleted,
  totalFailed,
  action,
  emptyLabel = 'No throughput recorded in this window.',
}: TProps) {
  const cls = useStyles();
  const palette = useJobStatusesPalette();
  const completedColor = palette[JobStatus.Completed];
  const failedColor = palette[JobStatus.Failed];
  // React 17 has no `useId`; the gradient just needs to be unique per mounted
  // chart so two charts on the same screen don't share one <defs> entry.
  const gradientId = React.useMemo(() => `t${++gradientSeq}`, []);

  return (
    <Paper className={cls.root} elevation={0}>
      <div className={cls.header}>
        <Typography className={cls.title} variant="subtitle1">
          {title}
        </Typography>
        {action && <div className={cls.action}>{action}</div>}
        <div className={cls.totals}>
          <div className={cls.total}>
            <span className={cls.totalValue}>
              <span
                className={cls.dot}
                style={{ backgroundColor: completedColor }}
              />
              {totalCompleted.toLocaleString()}
            </span>
            <Typography variant="caption" color="textSecondary">
              Completed
            </Typography>
          </div>
          <div className={cls.total}>
            <span className={cls.totalValue}>
              <span
                className={cls.dot}
                style={{ backgroundColor: failedColor }}
              />
              {totalFailed.toLocaleString()}
            </span>
            <Typography variant="caption" color="textSecondary">
              Failed
            </Typography>
          </div>
        </div>
      </div>
      {points.length === 0 ? (
        <div className={cls.empty}>{emptyLabel}</div>
      ) : (
        <div className={cls.chart}>
          <Chart.ResponsiveContainer width="100%" height="100%">
            <Chart.AreaChart
              data={points}
              margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient
                  id={`completed-${gradientId}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={completedColor}
                    stopOpacity={0.32}
                  />
                  <stop
                    offset="100%"
                    stopColor={completedColor}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <Chart.CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke={alpha(completedColor, 0.12)}
              />
              <Chart.XAxis
                dataKey="timestamp"
                tickFormatter={formatTick}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={48}
                dy={6}
              />
              <Chart.YAxis
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={44}
                allowDecimals={false}
              />
              <Chart.Tooltip
                labelFormatter={(label: number) =>
                  day(label).format('YYYY-MM-DD HH:mm')
                }
                contentStyle={{ fontSize: 13 }}
              />
              <Chart.Area
                type="monotone"
                dataKey="completed"
                name="Completed"
                stroke={completedColor}
                strokeWidth={2}
                fill={`url(#completed-${gradientId})`}
                isAnimationActive={false}
              />
              <Chart.Line
                type="monotone"
                dataKey="failed"
                name="Failed"
                stroke={failedColor}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </Chart.AreaChart>
          </Chart.ResponsiveContainer>
        </div>
      )}
    </Paper>
  );
}

export default memo(ThroughputChart);
