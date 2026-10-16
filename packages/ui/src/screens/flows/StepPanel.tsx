import React, { memo } from 'react';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import OpenIcon from '@mui/icons-material/OpenInNew';
import makeStyles from '@mui/styles/makeStyles';
import { FlowStepKind, JobStatus } from '@/typings/gql';
import { MONO } from '../agents/shared';
import { fmtInt, fmtMs, fmtPct } from '../agents/format';
import { useFlowColors } from './colors';
import { fmtPerMin } from './format';
import { shortStepName } from './model';
import type { TFlow, TStepStats } from './model';
import { RecentErrors, Sparkline, useFlowPartStyles } from './parts';
import { useOpenQueueJobs } from './use-open-jobs';

const useStyles = makeStyles((theme) => ({
  panel: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1.75),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.75),
    minWidth: 0,
    position: 'sticky',
    top: theme.spacing(1),
  },
  kicker: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    color: theme.palette.primary.main,
  },
  title: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 600,
    wordBreak: 'break-all',
  },
  desc: {
    fontSize: 12,
    color: theme.palette.text.secondary,
  },
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 1,
    backgroundColor: theme.palette.divider,
    border: `1px solid ${theme.palette.divider}`,
  },
  metric: {
    backgroundColor: theme.palette.background.paper,
    padding: theme.spacing(1, 1.25),
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  metricLabel: {
    fontSize: 10,
    color: theme.palette.text.secondary,
  },
  metricValue: {
    fontFamily: MONO,
    fontSize: 12.5,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  chip: {
    fontFamily: MONO,
    fontSize: 11,
    padding: '1px 6px',
    borderRadius: 3,
    border: `1px solid ${theme.palette.divider}`,
  },
}));

export type TStepMetric = { label: string; value: string; color?: string };

/** The six numbers of a step, shared by the panel (A) and the table row (B). */
export const useStepMetrics = (stats: TStepStats): TStepMetric[] => {
  const colors = useFlowColors();
  return [
    { label: 'Throughput', value: fmtPerMin(stats.throughputPerMin) },
    {
      label: 'Completed',
      value: fmtInt(stats.completed),
      color: colors.completed,
    },
    {
      label: 'p50 · p95',
      value: `${fmtMs(stats.procP50)} · ${fmtMs(stats.procP95)}`,
    },
    {
      label: 'Avg queue wait',
      value: fmtMs(stats.waitAvg),
      color: (stats.waitAvg ?? 0) > 60_000 ? colors.warning : undefined,
    },
    {
      label: 'Waiting · active',
      value: `${fmtInt(stats.waiting)} · ${fmtInt(stats.active)}`,
      color: colors.waiting,
    },
    {
      label: 'Failures',
      value: `${fmtInt(stats.failed)} · ${fmtPct(stats.failureRate)}`,
      color: stats.failed ? colors.failed : undefined,
    },
  ];
};

export function StepMetrics({ stats }: { stats: TStepStats }) {
  const cls = useStyles();
  const metrics = useStepMetrics(stats);
  return (
    <div className={cls.metrics}>
      {metrics.map((m) => (
        <div className={cls.metric} key={m.label}>
          <span className={cls.metricLabel}>{m.label}</span>
          <span className={cls.metricValue} style={{ color: m.color }}>
            {m.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Sparkline, recent errors and next steps: the body of a step's details. */
export function StepDetails({
  flow,
  stepId,
  stats,
  prefix,
  rangeLabel,
}: {
  flow: TFlow;
  stepId: string;
  stats: TStepStats;
  prefix: string | null;
  rangeLabel: string;
}) {
  const cls = useStyles();
  const parts = useFlowPartStyles();
  const openJobs = useOpenQueueJobs();
  const step = flow.steps.find((s) => s.id === stepId);
  const next = flow.edges.filter((e) => e.from === stepId);
  const stepOf = new Map(flow.steps.map((s) => [s.id, s]));
  return (
    <>
      <div className={cls.block}>
        <span className={parts.label}>Throughput · {rangeLabel}</span>
        <Sparkline values={stats.spark} alert={stats.bottleneck} />
      </div>
      <div className={cls.block}>
        <span className={parts.label}>Recent errors</span>
        <RecentErrors
          errors={stats.errors}
          onOpen={() =>
            step?.queueId &&
            openJobs(step.queueId, { status: JobStatus.Failed })
          }
        />
      </div>
      {next.length > 0 && (
        <div className={cls.block}>
          <span className={parts.label}>Next steps</span>
          <div className={cls.chips}>
            {next.map((e) => {
              const target = stepOf.get(e.to);
              const name =
                target?.kind === FlowStepKind.End
                  ? `end: ${target.label}`
                  : shortStepName(e.to, prefix);
              return (
                <span className={cls.chip} key={e.to}>
                  {e.when ? `${e.when} → ` : ''}
                  {name}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function StepPanel({
  flow,
  stepId,
  stats,
  prefix,
  rangeLabel,
}: {
  flow: TFlow;
  stepId: string;
  stats: TStepStats | null;
  prefix: string | null;
  rangeLabel: string;
}) {
  const cls = useStyles();
  const parts = useFlowPartStyles();
  const openJobs = useOpenQueueJobs();
  const step = flow.steps.find((s) => s.id === stepId);
  if (!step) return null;
  return (
    <Paper elevation={0} className={cls.panel} aria-label="step details">
      <div>
        <div className={cls.kicker}>STEP</div>
        <div className={cls.title}>{step.id}</div>
        {(step.description || step.when) && (
          <div className={cls.desc}>
            {[step.description, step.when && `when ${step.when}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
        {step.sharedQueue && (
          <div className={parts.muted}>
            The queue holds other steps too: live counts are the queue&apos;s.
          </div>
        )}
      </div>
      {stats ? (
        <>
          <StepMetrics stats={stats} />
          <StepDetails
            flow={flow}
            stepId={stepId}
            stats={stats}
            prefix={prefix}
            rangeLabel={rangeLabel}
          />
        </>
      ) : (
        <span className={parts.muted}>No stats for this step yet.</span>
      )}
      {step.queueId && (
        <Button
          size="small"
          startIcon={<OpenIcon />}
          onClick={() => openJobs(step.queueId as string)}
          style={{ alignSelf: 'flex-start' }}
        >
          View queue jobs
        </Button>
      )}
    </Paper>
  );
}

export default memo(StepPanel);
