import React, { memo, useMemo } from 'react';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import makeStyles from '@mui/styles/makeStyles';
import shallow from 'zustand/shallow';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import { getPollingInterval } from '@/stores/network-settings';
import { useFlowsStore } from '@/stores/flows';
import NetworkRequest from '@/components/NetworkRequest';
import { Kpis } from '../agents/shared';
import type { TKpi } from '../agents/shared';
import { fmtInt, fmtMs, fmtPct } from '../agents/format';
import type { TTimeRange } from '../shared/time-range';
import { useFlowColors } from './colors';
import type { TFlowColors } from './colors';
import { layoutFlowGraph, shortStepName } from './model';
import type { TFlow, TFlowSummary, TStepStats } from './model';
import FlowGraph from './FlowGraph';
import FlowTable from './FlowTable';
import StepPanel from './StepPanel';

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 340px',
    gap: theme.spacing(1),
    alignItems: 'start',
    [theme.breakpoints.down('lg')]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  graph: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1),
    minWidth: 0,
  },
}));

const flowKpis = (
  flow: TFlow,
  summary: TFlowSummary,
  stats: Map<string, TStepStats>,
  prefix: string | null,
  range: TTimeRange,
  colors: TFlowColors
): TKpi[] => {
  const bottleneck = summary.bottleneck
    ? stats.get(summary.bottleneck) ?? null
    : null;
  const entry = flow.entry.map((id) => shortStepName(id, prefix)).join(', ');
  return [
    {
      label: `Entries · ${range.label}`,
      value: fmtInt(summary.entries),
      sub: entry,
    },
    {
      label: 'Completed end to end',
      value: fmtInt(summary.done),
      sub: summary.entries
        ? `${fmtPct(summary.done / summary.entries, 0)} of the entries`
        : undefined,
      color: colors.completed,
    },
    {
      label: 'End-to-end time',
      value: fmtMs(summary.e2eAvg),
      sub: `avg · p50 ${fmtMs(summary.e2eP50)} · p95 ${fmtMs(summary.e2eP95)}`,
    },
    {
      label: 'Bottleneck',
      value: summary.bottleneck
        ? shortStepName(summary.bottleneck, prefix)
        : 'none',
      sub: bottleneck
        ? `${fmtInt(bottleneck.waiting)} waiting · wait ${fmtMs(
            bottleneck.waitAvg
          )}`
        : 'no step waits 1s or more on average',
      color: summary.bottleneck ? colors.warning : undefined,
    },
    {
      label: `Failures · ${range.label}`,
      value: fmtInt(summary.failed),
      sub: [
        flow.onError
          ? `${fmtInt(summary.errors)} via ${shortStepName(
              flow.onError,
              prefix
            )}`
          : null,
        summary.entries ? fmtPct(summary.failed / summary.entries) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      color: summary.failed ? colors.failed : undefined,
    },
  ];
};

type TProps = {
  flow: TFlow;
  prefix: string | null;
  since: number;
  range: TTimeRange;
};

function FlowTab({ flow, prefix, since, range }: TProps) {
  const cls = useStyles();
  const colors = useFlowColors();
  const [layoutChoice, step, selectStep] = useFlowsStore(
    (state) => [state.flowLayout, state.step, state.selectStep],
    shallow
  );
  const {
    queries: { getFlowSummary },
  } = useNetwork();
  const args = { flow: flow.id, since };
  const { status, data, error, refetch } = useQuery(
    [QueryKeysConfig.flowSummary, args],
    () => getFlowSummary(args),
    { refetchInterval: getPollingInterval(), keepPreviousData: true }
  );
  const layout = useMemo(() => layoutFlowGraph(flow), [flow]);
  const summary = data?.flowSummary ?? null;
  const stats = useMemo(
    () => new Map((summary?.steps ?? []).map((s) => [s.stepId, s])),
    [summary]
  );
  // The bottleneck is what the panel opens on, else the entry.
  const selected =
    step ?? summary?.bottleneck ?? flow.entry[0] ?? flow.steps[0]?.id ?? null;

  return (
    <NetworkRequest status={status} error={error} refetch={refetch}>
      {!summary ? (
        <Alert severity="info" variant="outlined">
          No stats for this flow. They come from the metrics collector.
        </Alert>
      ) : (
        <div className={cls.root}>
          {summary.entries === 0 && (
            <Alert severity="info" variant="outlined">
              No job of this flow finished in this window. Stats are recorded
              while the monitor is running; earlier history is not backfilled.
            </Alert>
          )}
          <Kpis items={flowKpis(flow, summary, stats, prefix, range, colors)} />
          {layoutChoice === 'B' ? (
            <FlowTable
              flow={flow}
              prefix={prefix}
              stats={stats}
              open={step}
              onToggle={(id) => selectStep(step === id ? null : id)}
              rangeLabel={range.label}
            />
          ) : (
            <div className={cls.layout}>
              <Paper elevation={0} className={cls.graph}>
                <FlowGraph
                  flow={flow}
                  layout={layout}
                  prefix={prefix}
                  stats={stats}
                  selected={selected}
                  onSelect={selectStep}
                />
              </Paper>
              {selected && (
                <StepPanel
                  flow={flow}
                  stepId={selected}
                  stats={stats.get(selected) ?? null}
                  prefix={prefix}
                  rangeLabel={range.label}
                />
              )}
            </div>
          )}
        </div>
      )}
    </NetworkRequest>
  );
}

export default memo(FlowTab);
