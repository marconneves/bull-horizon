import React, { memo, useMemo } from 'react';
import Paper from '@mui/material/Paper';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import clsx from 'clsx';
import FlagIcon from '@mui/icons-material/FlagOutlined';
import ReportIcon from '@mui/icons-material/ReportOutlined';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import { FlowStepKind, JobStatus } from '@/typings/gql';
import { MONO } from '../agents/shared';
import { fmtInt, fmtMs, fmtPct } from '../agents/format';
import { useFlowColors } from './colors';
import { fmtPerMin } from './format';
import { flowTableRows, layoutFlowGraph, shortStepName } from './model';
import type { TFlow, TStepStats } from './model';
import { StepTag } from './parts';
import { StepDetails } from './StepPanel';
import { useOpenQueueJobs } from './use-open-jobs';

const COLS =
  'minmax(260px, 2.6fr) 70px 64px 64px minmax(110px, 1.1fr) 120px minmax(120px, 1.2fr) 64px';

const useStyles = makeStyles((theme) => ({
  root: {
    border: `1px solid ${theme.palette.divider}`,
    overflowX: 'auto',
  },
  inner: {
    minWidth: 980,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: COLS,
    alignItems: 'center',
    gap: theme.spacing(1.25),
    padding: theme.spacing(0.875, 1.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
    fontFamily: MONO,
    fontSize: 12,
  },
  head: {
    fontSize: 10,
    letterSpacing: '0.06em',
    color: theme.palette.text.secondary,
    padding: theme.spacing(1, 1.5),
  },
  clickable: {
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: alpha(theme.palette.text.primary, 0.03),
    },
  },
  open: {
    backgroundColor: alpha(theme.palette.primary.main, 0.05),
  },
  stepCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    '& svg': {
      fontSize: 15,
      flex: 'none',
    },
  },
  elbow: {
    width: 12,
    height: 14,
    borderLeft: `1.5px solid ${theme.palette.divider}`,
    borderBottom: `1.5px solid ${theme.palette.divider}`,
    marginTop: -10,
    flex: 'none',
  },
  stepText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flex: 1,
  },
  stepName: {
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  stepDesc: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    color: theme.palette.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  right: {
    textAlign: 'right',
  },
  failed: {
    textAlign: 'right',
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    cursor: 'pointer',
    textDecoration: 'underline dotted',
  },
  barCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: alpha(theme.palette.text.primary, 0.06),
    overflow: 'hidden',
  },
  bar: {
    display: 'block',
    height: '100%',
    borderRadius: 3,
  },
  num: {
    minWidth: 52,
    textAlign: 'right',
  },
  details: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: theme.spacing(2),
    padding: theme.spacing(1.5, 1.5, 1.75, 5),
    borderBottom: `1px solid ${theme.palette.divider}`,
    backgroundColor: alpha(theme.palette.text.primary, 0.02),
    '& > *': {
      minWidth: 0,
    },
  },
  muted: {
    color: theme.palette.text.secondary,
  },
}));

type TProps = {
  flow: TFlow;
  prefix: string | null;
  stats: Map<string, TStepStats>;
  open: string | null;
  onToggle: (stepId: string) => void;
  rangeLabel: string;
};

/** Option B of the Flow tab: the tree as an indented table. */
function FlowTable({
  flow,
  prefix,
  stats,
  open,
  onToggle,
  rangeLabel,
}: TProps) {
  const cls = useStyles();
  const colors = useFlowColors();
  const openJobs = useOpenQueueJobs();
  const rows = useMemo(() => flowTableRows(flow), [flow]);
  const alt = useMemo(
    () =>
      new Set(
        layoutFlowGraph(flow)
          .nodes.filter((n) => n.alt)
          .map((n) => n.id)
      ),
    [flow]
  );
  const stepOf = new Map(flow.steps.map((s) => [s.id, s]));
  const all = Array.from(stats.values());
  const maxTput = Math.max(0.1, ...all.map((s) => s.throughputPerMin));
  // Queue wait spans ms to hours: a log scale keeps the short ones visible.
  const maxWait = Math.log10(
    Math.max(10, ...all.map((s) => (s.waitAvg ?? 0) + 1))
  );
  const waitShare = (ms: number) =>
    Math.max(0.02, Math.log10(ms + 1) / maxWait);

  return (
    <Paper elevation={0} className={cls.root}>
      <div className={cls.inner} role="table" aria-label="flow steps">
        <div className={clsx(cls.row, cls.head)} role="row">
          <span>STEP</span>
          <span className={cls.right}>WAITING</span>
          <span className={cls.right}>ACTIVE</span>
          <span className={cls.right}>FAILED</span>
          <span>THROUGHPUT /MIN</span>
          <span>P50 · P95</span>
          <span>QUEUE WAIT</span>
          <span className={cls.right}>FAILURE</span>
        </div>
        {rows.map((row) => {
          const step = stepOf.get(row.id);
          if (!step) return null;
          const s = stats.get(row.id);
          const end = row.kind === FlowStepKind.End;
          const error = row.kind === FlowStepKind.Error;
          const isAlt = alt.has(row.id);
          const isOpen = open === row.id && !end;
          const Icon = end
            ? FlagIcon
            : error
            ? ReportIcon
            : isAlt
            ? AltRouteIcon
            : InboxIcon;
          const wait = s?.waitAvg ?? null;
          return (
            <React.Fragment key={row.id}>
              <div
                role="row"
                aria-expanded={end ? undefined : isOpen}
                className={clsx(
                  cls.row,
                  !end && cls.clickable,
                  isOpen && cls.open
                )}
                style={
                  s?.bottleneck
                    ? { backgroundColor: alpha(colors.warning, 0.07) }
                    : undefined
                }
                onClick={() => !end && onToggle(row.id)}
              >
                <span
                  className={cls.stepCell}
                  style={{ paddingLeft: row.depth * 22 }}
                >
                  {row.depth > 0 && <span className={cls.elbow} />}
                  <Icon
                    style={{
                      color: error
                        ? colors.failed
                        : isAlt
                        ? colors.fallback
                        : colors.muted,
                    }}
                  />
                  <span className={cls.stepText}>
                    <span className={cls.stepName} title={row.id}>
                      {end
                        ? `end: ${step.label}`
                        : shortStepName(row.id, prefix)}
                    </span>
                    {(step.description || step.when) && (
                      <span className={cls.stepDesc}>
                        {step.description ?? `when ${step.when}`}
                      </span>
                    )}
                  </span>
                  {s?.bottleneck && <StepTag tag="bottleneck" />}
                  {isAlt && <StepTag tag="fallback" />}
                  {error && <StepTag tag="onError" />}
                </span>
                {s ? (
                  <>
                    <span
                      className={cls.right}
                      style={{
                        color: s.waiting > 50 ? colors.warning : colors.waiting,
                      }}
                    >
                      {fmtInt(s.waiting)}
                    </span>
                    <span className={cls.right}>{fmtInt(s.active)}</span>
                    <button
                      type="button"
                      className={cls.failed}
                      style={{
                        color: s.failedNow ? colors.failed : colors.muted,
                      }}
                      title="Open the failed jobs of the queue"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (step.queueId) {
                          openJobs(step.queueId, { status: JobStatus.Failed });
                        }
                      }}
                    >
                      {fmtInt(s.failedNow)}
                    </button>
                    <span className={cls.barCell}>
                      <span className={cls.track}>
                        <span
                          className={cls.bar}
                          style={{
                            width: `${(s.throughputPerMin / maxTput) * 100}%`,
                            backgroundColor: colors.completed,
                          }}
                        />
                      </span>
                      <span className={cls.num}>
                        {fmtPerMin(s.throughputPerMin).replace('/min', '')}
                      </span>
                    </span>
                    <span>
                      {fmtMs(s.procP50)} · {fmtMs(s.procP95)}
                    </span>
                    <span className={cls.barCell}>
                      <span className={cls.track}>
                        {wait !== null && (
                          <span
                            className={cls.bar}
                            style={{
                              width: `${waitShare(wait) * 100}%`,
                              backgroundColor:
                                wait > 60_000 ? colors.warning : colors.edge,
                            }}
                          />
                        )}
                      </span>
                      <span
                        className={cls.num}
                        style={{
                          color:
                            (wait ?? 0) > 60_000 ? colors.warning : undefined,
                        }}
                      >
                        {fmtMs(wait)}
                      </span>
                    </span>
                    <span
                      className={cls.right}
                      style={{
                        color:
                          s.failureRate > 0.01 ? colors.failed : colors.muted,
                      }}
                    >
                      {fmtPct(s.failureRate)}
                    </span>
                  </>
                ) : (
                  <span className={cls.muted} style={{ gridColumn: '2 / -1' }}>
                    {end ? 'ends the flow' : 'no stats yet'}
                  </span>
                )}
              </div>
              {isOpen && s && (
                <div className={cls.details}>
                  <StepDetails
                    flow={flow}
                    stepId={row.id}
                    stats={s}
                    prefix={prefix}
                    rangeLabel={rangeLabel}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </Paper>
  );
}

export default memo(FlowTable);
