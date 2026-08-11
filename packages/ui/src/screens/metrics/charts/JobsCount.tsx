import React, { memo } from 'react';
import * as Chart from 'recharts';
import { useTheme } from '@mui/material/styles';
import { JobStatus } from '@/typings/gql';
import { useJobStatusesPalette } from '@/components/JobStatusChip/hooks';
import ChartCard from '../../shared/ChartCard';
import { chartTooltipProps } from '../../shared/chart-tooltip';
import type { TChartProps } from '../typings';
import { tickXFormatter, tooltipLabelFormatter } from './utils';

const statuses = Object.values(JobStatus).filter(
  (status) => status !== JobStatus.Stuck
);

const JobsCountChart = ({ metrics }: TChartProps) => {
  const theme = useTheme();
  const palette = useJobStatusesPalette();
  return (
    <ChartCard
      title="Jobs by status"
      hint="How deep the queue was, not how fast it ran"
    >
      <Chart.ResponsiveContainer width="100%" height="100%">
        <Chart.LineChart
          data={metrics}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <Chart.CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke={theme.palette.divider}
          />
          <Chart.XAxis
            interval="preserveStartEnd"
            tick={{ fontSize: 12 }}
            dataKey="timestamp"
            tickLine={false}
            axisLine={false}
            minTickGap={48}
            dy={6}
            tickFormatter={tickXFormatter}
          />
          <Chart.YAxis
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={48}
            allowDecimals={false}
          />
          <Chart.Tooltip
            {...chartTooltipProps(theme)}
            labelFormatter={tooltipLabelFormatter}
          />
          <Chart.Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          />
          {statuses.map((status) => (
            <Chart.Line
              key={status}
              strokeWidth={2}
              isAnimationActive={false}
              name={status}
              type="monotone"
              dot={false}
              stroke={palette[status]}
              dataKey={`counts.${status}`}
            />
          ))}
        </Chart.LineChart>
      </Chart.ResponsiveContainer>
    </ChartCard>
  );
};

export default memo(JobsCountChart);
