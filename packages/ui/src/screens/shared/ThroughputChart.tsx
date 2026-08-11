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
  /** Width of the bucket the counters cover. */
  windowMs?: number | null;
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

/** 1200 -> "1.2k". A raw count is wider than the axis gutter. */
const formatCompact = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${+(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${+(value / 1e3).toFixed(1)}k`;
  return String(+value.toFixed(abs < 10 ? 1 : 0));
};

const MINUTE_MS = 60000;

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

  /**
   * Plotted as a rate, not a raw counter. Points come from whichever retention
   * tier covers the window, so a 12-hour bucket and a one-minute bucket both
   * arrive as "a point" — charting their raw counts would make the coarse end
   * tower over the fine end and the Y axis would silently change meaning with
   * the selected range. Dividing by the bucket width fixes both.
   */
  const series = React.useMemo(
    () =>
      points.map((point) => {
        const minutes = Math.max((point.windowMs ?? MINUTE_MS) / MINUTE_MS, 1);
        return {
          timestamp: point.timestamp,
          completedRate: point.completed / minutes,
          failedRate: point.failed / minutes,
        };
      }),
    [points]
  );

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
              data={series}
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
                width={48}
                tickFormatter={formatCompact}
              />
              <Chart.Tooltip
                labelFormatter={(label: number) =>
                  day(label).format('YYYY-MM-DD HH:mm')
                }
                formatter={(value: number) => `${formatCompact(value)}/min`}
                contentStyle={{ fontSize: 13 }}
              />
              <Chart.Area
                type="monotone"
                dataKey="completedRate"
                name="Completed"
                stroke={completedColor}
                strokeWidth={2}
                fill={`url(#completed-${gradientId})`}
                isAnimationActive={false}
              />
              <Chart.Line
                type="monotone"
                dataKey="failedRate"
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
