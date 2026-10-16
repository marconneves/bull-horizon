import React, { memo, useMemo } from 'react';
import * as Chart from 'recharts';
import Tooltip from '@mui/material/Tooltip';
import makeStyles from '@mui/styles/makeStyles';
import { alpha, useTheme } from '@mui/material/styles';
import { useQuery } from 'react-query';
import day from 'dayjs';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import { getPollingInterval } from '@/stores/network-settings';
import NetworkRequest from '@/components/NetworkRequest';
import type { GetAgentsSummaryQuery } from '@/typings/gql';
import { chartTooltipProps } from '../shared/chart-tooltip';
import type { TTimeRange } from '../shared/time-range';
import { Card, Kpis, Legend, MONO, UnrecordedNotice } from './shared';
import type { TKpi } from './shared';
import { outcomeColor, useAgentColors } from './colors';
import type { TAgentColors } from './colors';
import { fmtCompact, fmtCost, fmtInt, fmtMs, fmtPct, plural } from './format';

type TSummary = NonNullable<GetAgentsSummaryQuery['agentsSummary']>;

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
    gap: theme.spacing(1),
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  full: {
    gridColumn: '1 / -1',
  },
  chart: {
    height: 190,
    width: '100%',
  },
  hist: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: theme.spacing(1.25),
    height: 160,
  },
  histCol: {
    flex: 1,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  histBar: {
    width: '100%',
    borderRadius: '2px 2px 0 0',
    minHeight: 2,
  },
  mono: {
    fontFamily: MONO,
    fontSize: 10.5,
    color: theme.palette.text.secondary,
  },
  note: {
    fontSize: 11,
    color: theme.palette.text.secondary,
  },
  table: {
    margin: theme.spacing(0, -1.75),
  },
  toolRow: {
    display: 'grid',
    gridTemplateColumns:
      'minmax(120px, 1.3fr) 80px minmax(80px, 2fr) 70px 64px 100px',
    gap: theme.spacing(1.5),
    alignItems: 'center',
    padding: theme.spacing(0.9, 1.75),
    borderTop: `1px solid ${theme.palette.divider}`,
    fontSize: 12,
  },
  toolHead: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: '0.06em',
    color: theme.palette.text.secondary,
    borderTop: 'none',
    paddingTop: 0,
  },
  right: {
    textAlign: 'right',
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
  },
  name: {
    fontFamily: MONO,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  usage: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: theme.palette.action.hover,
    '& > span': {
      display: 'block',
      height: '100%',
    },
  },
  modelRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(110px, 150px) minmax(0, 1fr) 80px',
    gap: theme.spacing(1.5),
    alignItems: 'center',
    fontSize: 12,
  },
  modelBar: {
    display: 'flex',
    height: 16,
    gap: 1,
    minWidth: 0,
    '& > span': {
      borderRadius: 2,
      minWidth: 2,
    },
  },
  outcomes: {
    display: 'flex',
    height: 22,
    gap: 2,
  },
  outcomeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontSize: 12,
    '& > span:nth-child(2)': {
      fontFamily: MONO,
      flex: 1,
    },
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  empty: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(5, 2),
    textAlign: 'center',
    color: theme.palette.text.secondary,
    fontSize: 14,
  },
}));

const delta = (current: number, previous: number | undefined) => {
  if (!previous) return 'no data in the previous window';
  const change = (current - previous) / previous;
  const sign = change > 0 ? '+' : '';
  return `${sign}${(change * 100).toFixed(0)}% vs previous window`;
};

const summaryKpis = (
  summary: TSummary,
  previous: TSummary | null | undefined,
  colors: TAgentColors
): TKpi[] => {
  const runs = summary.runs;
  const perRun = (value: number) => (runs ? value / runs : 0);
  return [
    { label: 'Runs', value: fmtInt(runs), sub: delta(runs, previous?.runs) },
    {
      label: 'Latency p50 · p95',
      value: `${fmtMs(summary.p50)} · ${fmtMs(summary.p95)}`,
      title: 'Approximate: estimated from fixed latency bands',
      sub: `approx. · LLM ${fmtPct(summary.llmShare, 0)} of the time`,
    },
    {
      label: 'Tokens in · out',
      value: `${fmtCompact(summary.inputTokens)} · ${fmtCompact(
        summary.outputTokens
      )}`,
      sub: `avg ${fmtCompact(perRun(summary.inputTokens))} · ${fmtCompact(
        perRun(summary.outputTokens)
      )} per run`,
      color: colors.tokensIn,
    },
    {
      label: 'Cost estimate',
      value: fmtCost(summary.cost),
      sub: summary.hasUnpricedModels
        ? 'some models have no price'
        : summary.cost !== null && summary.cost !== undefined
        ? `avg ${fmtCost(perRun(summary.cost))} per run`
        : undefined,
    },
    {
      label: 'Failures',
      value: fmtPct(runs ? summary.failed / runs : 0),
      sub: `${plural(summary.failed, 'run')}${
        summary.lost ? ` · ${fmtInt(summary.lost)} lost` : ''
      }`,
      color: summary.failed ? colors.error : undefined,
    },
    {
      label: 'Steps per run',
      value: summary.avgSteps ? summary.avgSteps.toFixed(1) : '—',
      sub: `empty tool in ${fmtPct(
        runs ? summary.runsWithEmptyTool / runs : 0,
        0
      )} of runs`,
    },
  ];
};

const formatTick = (timestamp: number) => day(timestamp).format('MMM D HH:mm');

function LatencyChart({ summary }: { summary: TSummary }) {
  const cls = useStyles();
  const theme = useTheme();
  const colors = useAgentColors();
  const data = useMemo(
    () =>
      summary.latency.map((point) => ({
        timestamp: point.timestamp,
        p50: point.p50 ?? 0,
        p95: point.p95 ?? 0,
        runs: point.runs,
      })),
    [summary.latency]
  );
  return (
    <div className={cls.chart}>
      <Chart.ResponsiveContainer width="100%" height="100%">
        <Chart.BarChart
          data={data}
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          barCategoryGap="12%"
        >
          <Chart.CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke={alpha(theme.palette.text.primary, 0.1)}
          />
          <Chart.XAxis
            dataKey="timestamp"
            tickFormatter={formatTick}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={48}
            xAxisId="p95"
          />
          {/* Second, hidden axis so the p50 bar sits on top of the p95 one. */}
          <Chart.XAxis dataKey="timestamp" xAxisId="p50" hide />
          <Chart.YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value: number) => fmtMs(value)}
          />
          <Chart.Tooltip
            {...chartTooltipProps(theme)}
            cursor={{ fill: alpha(theme.palette.text.primary, 0.06) }}
            labelFormatter={(label: number) =>
              day(label).format('YYYY-MM-DD HH:mm')
            }
            formatter={(value: number, name: string) => [
              `${fmtMs(value)} (approx.)`,
              name,
            ]}
          />
          <Chart.Bar
            dataKey="p95"
            name="p95"
            xAxisId="p95"
            fill={alpha(colors.llm, 0.35)}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
          <Chart.Bar
            dataKey="p50"
            name="p50"
            xAxisId="p50"
            fill={colors.llm}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        </Chart.BarChart>
      </Chart.ResponsiveContainer>
    </div>
  );
}

function StepsHistogram({ summary }: { summary: TSummary }) {
  const cls = useStyles();
  const colors = useAgentColors();
  const total = summary.steps.reduce((acc, b) => acc + b.count, 0) || 1;
  const max = Math.max(1, ...summary.steps.map((b) => b.count));
  return (
    <div className={cls.hist}>
      {summary.steps.map((bucket) => (
        <Tooltip
          key={bucket.label}
          title={`${plural(bucket.count, 'run')} with ${bucket.label} ${
            bucket.label === '1' ? 'step' : 'steps'
          }`}
        >
          <div className={cls.histCol}>
            <span className={cls.mono}>{fmtPct(bucket.count / total, 0)}</span>
            <div
              className={cls.histBar}
              style={{
                height: `${(bucket.count / max) * 80}%`,
                backgroundColor: bucket.label.endsWith('+')
                  ? colors.warning
                  : colors.llm,
              }}
            />
            <span className={cls.mono}>{bucket.label}</span>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

function ToolsTable({ summary }: { summary: TSummary }) {
  const cls = useStyles();
  const colors = useAgentColors();
  const maxCalls = Math.max(1, ...summary.tools.map((t) => t.calls));
  if (!summary.tools.length) {
    return <span className={cls.note}>No tool was called in this window.</span>;
  }
  return (
    <div className={cls.table}>
      <div className={`${cls.toolRow} ${cls.toolHead}`}>
        <span>TOOL</span>
        <span className={cls.right}>CALLS</span>
        <span>USAGE</span>
        <span className={cls.right}>AVG</span>
        <span className={cls.right}>ERROR</span>
        <span className={cls.right}>NO RESULT</span>
      </div>
      {summary.tools.map((tool) => (
        <div className={cls.toolRow} key={tool.name}>
          <span className={cls.name} title={tool.name}>
            {tool.name}
          </span>
          <span className={cls.right}>{fmtInt(tool.calls)}</span>
          <span className={cls.usage}>
            <span
              style={{
                width: `${(tool.calls / maxCalls) * 100}%`,
                backgroundColor: colors.tool,
              }}
            />
          </span>
          <span className={cls.right}>{fmtMs(tool.avgDurationMs)}</span>
          <span
            className={cls.right}
            style={{ color: tool.errorRate ? colors.error : colors.muted }}
          >
            {fmtPct(tool.errorRate)}
          </span>
          <span
            className={cls.right}
            style={{
              color: tool.emptyRate > 0.2 ? colors.warning : colors.muted,
            }}
          >
            {fmtPct(tool.emptyRate)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ModelsCard({ summary }: { summary: TSummary }) {
  const cls = useStyles();
  const colors = useAgentColors();
  const max = Math.max(
    1,
    ...summary.models.map((m) => m.inputTokens + m.outputTokens)
  );
  return (
    <Card title="Tokens and cost by model">
      {summary.models.map((model) => (
        <div className={cls.modelRow} key={model.model}>
          <span className={cls.name} title={model.model}>
            {model.model}
          </span>
          <Tooltip
            title={`in ${fmtInt(model.inputTokens)} · out ${fmtInt(
              model.outputTokens
            )} · ${plural(model.runs, 'run')}`}
          >
            <span className={cls.modelBar}>
              <span
                style={{
                  width: `${(model.inputTokens / max) * 100}%`,
                  backgroundColor: colors.tokensIn,
                }}
              />
              <span
                style={{
                  width: `${(model.outputTokens / max) * 100}%`,
                  backgroundColor: colors.tokensOut,
                }}
              />
            </span>
          </Tooltip>
          <span
            className={cls.right}
            style={{ color: model.cost === null ? colors.muted : undefined }}
          >
            {fmtCost(model.cost)}
          </span>
        </div>
      ))}
      <Legend
        items={[
          { label: 'tokens in', color: colors.tokensIn },
          { label: 'tokens out', color: colors.tokensOut },
        ]}
      />
      <span className={cls.note}>
        Cost is an estimate from the price table in the monitor setup.
      </span>
    </Card>
  );
}

function OutcomesCard({ summary }: { summary: TSummary }) {
  const cls = useStyles();
  const colors = useAgentColors();
  const total = summary.outcomes.reduce((acc, o) => acc + o.count, 0) || 1;
  return (
    <Card title="How the runs ended">
      <div className={cls.outcomes}>
        {summary.outcomes.map((o) => (
          <Tooltip key={o.outcome} title={`${o.outcome} ${fmtInt(o.count)}`}>
            <span
              style={{
                flexGrow: o.count,
                minWidth: 4,
                borderRadius: 2,
                backgroundColor: outcomeColor(o.outcome, colors),
              }}
            />
          </Tooltip>
        ))}
      </div>
      {summary.outcomes.map((o) => (
        <div className={cls.outcomeRow} key={o.outcome}>
          <span
            className={cls.dot}
            style={{ backgroundColor: outcomeColor(o.outcome, colors) }}
          />
          <span>{o.outcome}</span>
          <span className={cls.right}>{fmtPct(o.count / total)}</span>
        </div>
      ))}
    </Card>
  );
}

type TProps = {
  queues: string[] | null;
  since: number;
  range: TTimeRange;
};

function MetricsTab({ queues, since, range }: TProps) {
  const cls = useStyles();
  const colors = useAgentColors();
  const {
    queries: { getAgentsSummary },
  } = useNetwork();
  const refetchInterval = getPollingInterval();
  const args = { queues, since, maxPoints: range.maxPoints };
  const { status, data, error, refetch } = useQuery(
    [QueryKeysConfig.agentsSummary, args],
    () => getAgentsSummary(args),
    { refetchInterval, keepPreviousData: true }
  );
  // The window before this one, same width, for the "vs previous" deltas.
  const previousArgs = {
    queues,
    since: since - range.ms,
    until: since,
    maxPoints: 1,
  };
  const { data: previous } = useQuery(
    [QueryKeysConfig.agentsSummary, previousArgs],
    () => getAgentsSummary(previousArgs),
    { staleTime: range.ms / range.maxPoints }
  );
  const summary = data?.agentsSummary;

  return (
    <NetworkRequest status={status} error={error} refetch={refetch}>
      {summary &&
      summary.runs + summary.lost === 0 &&
      summary.unrecorded > 0 ? (
        <UnrecordedNotice count={summary.unrecorded} />
      ) : !summary || summary.runs + summary.lost === 0 ? (
        <div className={cls.empty}>
          No agent runs finished in this window. Runs are recorded while the
          monitor process is running; history from before it started is not
          backfilled.
        </div>
      ) : (
        <div className={cls.root}>
          <UnrecordedNotice count={summary.unrecorded} />
          <Kpis items={summaryKpis(summary, previous?.agentsSummary, colors)} />
          <div className={cls.grid}>
            <Card
              title="Latency"
              aside={
                <Legend
                  items={[
                    { label: 'p50', color: colors.llm },
                    { label: 'p95', color: alpha(colors.llm, 0.35) },
                  ]}
                />
              }
            >
              <LatencyChart summary={summary} />
            </Card>
            <Card title="Steps per run">
              <StepsHistogram summary={summary} />
            </Card>
            <Card title="Tools" className={cls.full}>
              <ToolsTable summary={summary} />
            </Card>
            <ModelsCard summary={summary} />
            <OutcomesCard summary={summary} />
          </div>
        </div>
      )}
    </NetworkRequest>
  );
}

export default memo(MetricsTab);
