import React, { memo, useMemo } from 'react';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import CloseIcon from '@mui/icons-material/Close';
import RouteIcon from '@mui/icons-material/Route';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import clsx from 'clsx';
import shallow from 'zustand/shallow';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import { getPollingInterval } from '@/stores/network-settings';
import { useFlowsStore } from '@/stores/flows';
import NetworkRequest from '@/components/NetworkRequest';
import { FlowTraceMatch, FlowTraceStatus, JobStatus } from '@/typings/gql';
import { MONO } from '../agents/shared';
import { fmtMs } from '../agents/format';
import { useFlowColors } from './colors';
import type { TFlowColors } from './colors';
import { clockMs } from './format';
import {
  TRACE_STATUS_LABEL,
  layoutFlowGraph,
  shortStepName,
  traceHighlight,
  traceJobByStep,
  traceJobKey,
  traceJobKind,
  traceJobsInOrder,
} from './model';
import type { TFlow, TTrace, TTraceJob } from './model';
import FlowGraph from './FlowGraph';
import TracePath from './TracePath';
import TraceGantt from './TraceGantt';

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  band: {
    border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
    backgroundColor: alpha(theme.palette.primary.main, 0.05),
    padding: theme.spacing(1.25, 1.5),
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(2.5),
    '& > svg': {
      color: theme.palette.primary.main,
    },
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  statLabel: {
    fontSize: 10,
    letterSpacing: '0.06em',
    color: theme.palette.text.secondary,
    textTransform: 'uppercase',
  },
  statValue: {
    fontFamily: MONO,
    fontSize: 12.5,
    whiteSpace: 'nowrap',
  },
  spacer: {
    flex: 1,
  },
  candidates: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    fontSize: 12,
    color: theme.palette.text.secondary,
  },
  candidate: {
    fontFamily: MONO,
    fontSize: 11.5,
    padding: theme.spacing(0.25, 1),
    borderRadius: 4,
    border: `1px solid ${theme.palette.divider}`,
    background: 'none',
    color: theme.palette.text.primary,
    cursor: 'pointer',
  },
  candidateOn: {
    borderColor: theme.palette.primary.main,
    backgroundColor: alpha(theme.palette.primary.main, 0.1),
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
  empty: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(5, 2),
    textAlign: 'center',
    color: theme.palette.text.secondary,
    fontSize: 14,
  },
}));

const statusColor = (status: FlowTraceStatus, colors: TFlowColors) => {
  switch (status) {
    case FlowTraceStatus.Completed:
      return colors.completed;
    case FlowTraceStatus.CompletedWithFallback:
      return colors.fallback;
    case FlowTraceStatus.Failed:
      return colors.failed;
    case FlowTraceStatus.Running:
      return colors.active;
    default:
      return colors.muted;
  }
};

function TraceBand({
  flow,
  trace,
  prefix,
  onClear,
}: {
  flow: TFlow;
  trace: TTrace;
  prefix: string | null;
  onClear: () => void;
}) {
  const cls = useStyles();
  const colors = useFlowColors();
  const longest = trace.longestWait;
  const stats: Array<{ k: string; v: string; color?: string }> = [
    ...(trace.key ? [{ k: flow.keyLabel ?? 'key', v: trace.key }] : []),
    {
      k: 'started',
      v: `${new Date(trace.startedAt).toLocaleDateString()} ${clockMs(
        trace.startedAt
      )}`,
    },
    {
      k: 'duration',
      v:
        trace.durationMs !== null && trace.durationMs !== undefined
          ? fmtMs(trace.durationMs)
          : `${fmtMs(Date.now() - trace.startedAt)} so far`,
    },
    { k: 'jobs', v: String(trace.jobs.length) },
    {
      k: 'status',
      v: TRACE_STATUS_LABEL[trace.status],
      color: statusColor(trace.status, colors),
    },
    ...(longest && longest.waitMs
      ? [
          {
            k: 'longest wait',
            v: `${shortStepName(longest.stepId, prefix)} · ${fmtMs(
              longest.waitMs
            )}`,
            color: longest.waitMs > 60_000 ? colors.warning : undefined,
          },
        ]
      : []),
  ];
  return (
    <Paper elevation={0} className={cls.band} aria-label="trace">
      <RouteIcon />
      <div className={cls.stat}>
        <span className={cls.statLabel}>Trace</span>
        <span className={cls.statValue}>{trace.traceId}</span>
      </div>
      {stats.map((s) => (
        <div className={cls.stat} key={s.k}>
          <span className={cls.statLabel}>{s.k}</span>
          <span className={cls.statValue} style={{ color: s.color }}>
            {s.v}
          </span>
        </div>
      ))}
      <span className={cls.spacer} />
      <Button size="small" startIcon={<CloseIcon />} onClick={onClear}>
        Clear trace
      </Button>
    </Paper>
  );
}

type TProps = {
  flow: TFlow;
  prefix: string | null;
};

function TraceTab({ flow, prefix }: TProps) {
  const cls = useStyles();
  const [
    layoutChoice,
    query,
    traceId,
    traceJob,
    pickCandidate,
    selectJob,
    clearTrace,
  ] = useFlowsStore(
    (state) => [
      state.traceLayout,
      state.query,
      state.traceId,
      state.traceJob,
      state.pickCandidate,
      state.selectTraceJob,
      state.clearTrace,
    ],
    shallow
  );
  const {
    queries: { getFlowTrace },
  } = useNetwork();
  const args = { flow: flow.id, query: query ?? '', traceId };
  const { status, data, error, refetch } = useQuery(
    [QueryKeysConfig.flowTrace, args],
    () => getFlowTrace(args),
    {
      enabled: !!query,
      refetchInterval: getPollingInterval(),
      keepPreviousData: true,
    }
  );
  const layout = useMemo(() => layoutFlowGraph(flow), [flow]);
  const altSteps = useMemo(
    () => new Set(layout.nodes.filter((n) => n.alt).map((n) => n.id)),
    [layout]
  );
  const result = data?.flowTrace ?? null;
  const trace = result?.trace ?? null;
  const kindOf = (job: TTraceJob) => traceJobKind(job, flow, altSteps);
  const graphTrace = useMemo(() => {
    if (!trace) return null;
    const jobByStep = traceJobByStep(trace);
    return {
      highlight: traceHighlight(trace),
      jobByStep,
      kindByStep: new Map(
        Array.from(jobByStep, ([step, job]) => [
          step,
          traceJobKind(job, flow, altSteps),
        ])
      ),
    };
  }, [trace, flow, altSteps]);

  if (!query) {
    return (
      <div className={cls.empty}>
        Search a trace id, a job id or an exact{' '}
        {flow.keyLabel ?? 'business key'} to see the path of that event through
        the flow.
      </div>
    );
  }

  const jobs = trace ? traceJobsInOrder(trace) : [];
  // Default pick: the job that failed, else the longest wait, else the first.
  const selected =
    jobs.find((j) => traceJobKey(j) === traceJob) ??
    jobs.find((j) => j.status === JobStatus.Failed) ??
    (trace?.longestWait
      ? jobs.find(
          (j) => traceJobKey(j) === traceJobKey(trace.longestWait as TTraceJob)
        )
      : undefined) ??
    jobs[0] ??
    null;

  return (
    <NetworkRequest status={status} error={error} refetch={refetch}>
      {!result ? (
        <Alert severity="info" variant="outlined">
          Traces come from the metrics collector.
        </Alert>
      ) : !trace ? (
        <div className={cls.root}>
          <Alert severity="info" variant="outlined">
            No trace matches “{query}”. The search takes a trace id, a job id or
            the exact {flow.keyLabel ?? 'business key'}; the index keeps only
            the most recent traces of the flow
            {result.indexFull
              ? ' and it is full, so this one may be older than the index.'
              : '.'}
          </Alert>
        </div>
      ) : (
        <div className={cls.root}>
          <TraceBand
            flow={flow}
            trace={trace}
            prefix={prefix}
            onClear={clearTrace}
          />
          {result.candidates.length > 1 && (
            <div className={cls.candidates} aria-label="executions">
              <span>
                This {flow.keyLabel ?? 'key'} ran {result.candidates.length}{' '}
                times, newest first:
              </span>
              {result.candidates.map((c) => (
                <button
                  type="button"
                  key={c.traceId}
                  className={clsx(
                    cls.candidate,
                    c.traceId === trace.traceId && cls.candidateOn
                  )}
                  aria-pressed={c.traceId === trace.traceId}
                  onClick={() => pickCandidate(c.traceId)}
                >
                  {c.traceId} · {new Date(c.startedAt).toLocaleDateString()}{' '}
                  {clockMs(c.startedAt)} · {TRACE_STATUS_LABEL[c.status]}
                </button>
              ))}
            </div>
          )}
          {result.matchedBy === FlowTraceMatch.JobId && (
            <Alert severity="info" variant="outlined">
              Found by job id: this is the trace that job belongs to.
            </Alert>
          )}
          {trace.partial && (
            <Alert severity="warning" variant="outlined">
              Pending steps are partial: the scan of a queue hit its limit, so
              some waiting or active jobs of this trace may be missing.
            </Alert>
          )}
          {trace.truncated && (
            <Alert severity="warning" variant="outlined">
              This trace hit the jobs-per-trace cap: later jobs were not
              indexed.
            </Alert>
          )}
          {layoutChoice === 'B' ? (
            <TraceGantt
              flow={flow}
              trace={trace}
              prefix={prefix}
              kindOf={kindOf}
              open={traceJob}
              onToggle={(key) => selectJob(traceJob === key ? null : key)}
            />
          ) : (
            <div className={cls.layout}>
              <Paper elevation={0} className={cls.graph}>
                {graphTrace && (
                  <FlowGraph
                    flow={flow}
                    layout={layout}
                    prefix={prefix}
                    trace={graphTrace}
                    selected={selected?.stepId ?? null}
                    onSelect={(stepId) => {
                      const job = graphTrace.jobByStep.get(stepId);
                      if (job) selectJob(traceJobKey(job));
                    }}
                  />
                )}
              </Paper>
              <TracePath
                trace={trace}
                flowId={flow.id}
                prefix={prefix}
                kindOf={kindOf}
                selected={selected}
                onSelect={selectJob}
              />
            </div>
          )}
        </div>
      )}
    </NetworkRequest>
  );
}

export default memo(TraceTab);
