import React, { memo, useMemo } from 'react';
import * as Chart from 'recharts';
import Alert from '@mui/material/Alert';
import { useTheme } from '@mui/material/styles';
import isempty from 'lodash/isEmpty';
import ChartCard from '../../shared/ChartCard';
import { chartTooltipProps } from '../../shared/chart-tooltip';
import { processingTimePalette as palette } from './styles';
import type { TChartProps } from '../typings';
import {
  tickXFormatter,
  tooltipLabelFormatter,
  tooltipValueFormatter,
} from './utils';

const SERIES = [
  { key: 'processingTimeMin', name: 'Min', color: palette.min },
  { key: 'processingTime', name: 'Avg', color: palette.avg },
  { key: 'processingTimeMax', name: 'Max', color: palette.max },
];

const ProcessingTimeChart = ({ metrics: rawMetrics }: TChartProps) => {
  const theme = useTheme();
  const metrics = useMemo(
    () => rawMetrics.filter((metric) => !!metric.processingTime),
    [rawMetrics]
  );
  return (
    <ChartCard
      title="Processing time"
      hint="Duration of the jobs that finished in each window"
    >
      {isempty(metrics) ? (
        <Alert severity="info">
          No processing time recorded yet — it is measured when jobs complete.
        </Alert>
      ) : (
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
              width={56}
              tickFormatter={tooltipValueFormatter}
            />
            <Chart.Tooltip
              {...chartTooltipProps(theme)}
              labelFormatter={tooltipLabelFormatter}
              formatter={tooltipValueFormatter}
            />
            <Chart.Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            />
            {SERIES.map((series) => (
              <Chart.Line
                key={series.key}
                strokeWidth={2}
                isAnimationActive={false}
                name={series.name}
                type="monotone"
                dot={false}
                dataKey={series.key}
                stroke={series.color}
              />
            ))}
          </Chart.LineChart>
        </Chart.ResponsiveContainer>
      )}
    </ChartCard>
  );
};

export default memo(ProcessingTimeChart);
