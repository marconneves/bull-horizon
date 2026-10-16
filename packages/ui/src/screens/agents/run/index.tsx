import React, { memo, useEffect, useMemo, useState } from 'react';
import Paper from '@mui/material/Paper';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import BackIcon from '@mui/icons-material/ArrowBack';
import GraphIcon from '@mui/icons-material/AccountTree';
import WaterfallIcon from '@mui/icons-material/ViewTimeline';
import makeStyles from '@mui/styles/makeStyles';
import shallow from 'zustand/shallow';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { useQueueData } from '@/hooks/use-queue-data';
import { QueryKeysConfig } from '@/config/query-keys';
import { getPollingInterval } from '@/stores/network-settings';
import { useAgentsStore } from '@/stores/agents';
import type { TAgentRunRef, TAgentsBackTo } from '@/stores/agents';
import NetworkRequest from '@/components/NetworkRequest';
import JobStatusChip from '@/components/JobStatusChip';
import { AgentRunDetail, AgentRunSource } from '@/typings/gql';
import type { GetAgentJobQuery } from '@/typings/gql';
import { Card, Kpis, MONO } from '../shared';
import type { TKpi } from '../shared';
import { outcomeColor, useAgentColors } from '../colors';
import type { TAgentColors } from '../colors';
import { fmtClock, fmtCost, fmtInt, fmtMs, plural } from '../format';
import { defaultNodeId, parseNodeId, runAttention, toolCalls } from '../model';
import type { TRun } from '../model';
import ToolChain from '../ToolChain';
import RunGraph from './Graph';
import RunSplits from './Splits';
import RunWaterfall from './Waterfall';
import ResponseCard from './ResponseCard';
import { NodeBlocks, NodeMetrics, useNodeDescription } from './NodeDetails';

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  header: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1.25, 1.5),
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(1.5),
  },
  ident: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    flex: 1,
  },
  identTop: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  },
  jobId: {
    fontFamily: MONO,
    fontSize: 14,
    maxWidth: 360,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  identSub: {
    fontFamily: MONO,
    fontSize: 11,
    color: theme.palette.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  },
  toggle: {
    '& .MuiToggleButton-root': {
      border: `1px solid ${theme.palette.divider}`,
      padding: theme.spacing(0.25, 1.25),
      fontSize: 12,
      lineHeight: 1.6,
      textTransform: 'none',
      color: theme.palette.text.secondary,
      gap: theme.spacing(0.5),
    },
    '& .MuiToggleButton-root.Mui-selected': {
      color: theme.palette.text.primary,
      backgroundColor: theme.palette.action.selected,
    },
    '& svg': {
      fontSize: 15,
    },
  },
  controlLabel: {
    fontSize: 11,
    color: theme.palette.text.secondary,
  },
  detailChip: {
    fontFamily: MONO,
    fontSize: 11,
    height: 22,
  },
  graphLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 360px',
    gap: theme.spacing(1),
    alignItems: 'start',
    [theme.breakpoints.down('lg')]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  waterfallLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 340px',
    gap: theme.spacing(1),
    alignItems: 'start',
    [theme.breakpoints.down('lg')]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    minWidth: 0,
  },
  panel: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1.75),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    position: 'sticky',
    top: theme.spacing(1),
    minWidth: 0,
  },
  panelKicker: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
  },
  panelTitle: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  empty: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(4, 2),
    textAlign: 'center',
    color: theme.palette.text.secondary,
    fontSize: 14,
  },
  entry: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
}));

type TJob = NonNullable<GetAgentJobQuery['job']>;

const BACK_LABEL: Record<TAgentsBackTo, string> = {
  jobs: 'Jobs',
  runs: 'Runs',
  conversation: 'Conversation',
};

const runKpis = (run: TRun, colors: TAgentColors): TKpi[] => {
  const attention = runAttention(run);
  const outShare = run.steps.length
    ? Math.max(...run.steps.map((s) => s.outputTokens ?? 0))
    : 0;
  const heaviest = run.steps.find((s) => (s.outputTokens ?? 0) === outShare);
  return [
    {
      label: 'Duration',
      value: fmtMs(run.durationMs),
      sub: `${fmtClock(run.startedAt, false)} → ${fmtClock(
        run.finishedAt,
        false
      )}`,
    },
    {
      label: 'Steps',
      value: String(run.steps.length),
      sub: plural(toolCalls(run), 'tool call'),
    },
    {
      label: 'Tokens in',
      value: fmtInt(run.inputTokens),
      sub: 'context grows every step',
      color: colors.tokensIn,
    },
    {
      label: 'Tokens out',
      value: fmtInt(run.outputTokens),
      sub:
        heaviest && run.outputTokens
          ? `${Math.round((outShare / run.outputTokens) * 100)}% in step ${
              heaviest.step
            }`
          : undefined,
      color: colors.tokensOut,
    },
    {
      label: 'Cost estimate',
      value: fmtCost(run.cost),
      sub: run.model,
    },
    {
      label: 'Attention',
      value: attention.value,
      sub: attention.sub,
      color:
        attention.tone === 'error'
          ? colors.error
          : attention.tone === 'warning'
          ? colors.warning
          : colors.ok,
    },
  ];
};

function GraphBody({
  run,
  job,
  queueName,
}: {
  run: TRun;
  job: TJob;
  queueName: string;
}) {
  const cls = useStyles();
  const [selected, setSelected] = useState(() => defaultNodeId(run));
  const ref = useMemo(() => parseNodeId(selected, run), [selected, run]);
  const description = useNodeDescription(ref, {
    run,
    jobData: job.data ?? null,
  });
  return (
    <div className={cls.graphLayout}>
      <div className={cls.column}>
        <Card title="Agent steps" aside="click a node for details">
          <RunGraph
            run={run}
            queueName={queueName}
            jobLabel={`${job.name} · ${job.id}`}
            selected={selected}
            onSelect={setSelected}
          />
        </Card>
        <RunSplits run={run} />
        <ResponseCard run={run} />
      </div>
      {description && (
        <Paper elevation={0} className={cls.panel}>
          <div>
            <div
              className={cls.panelKicker}
              style={{ color: description.kickerColor }}
            >
              {description.kicker}
            </div>
            <div className={cls.panelTitle} title={description.title}>
              {description.title}
            </div>
          </div>
          <NodeMetrics metrics={description.metrics} />
          <NodeBlocks blocks={description.blocks} />
        </Paper>
      )}
    </div>
  );
}

function WaterfallBody({ run, job }: { run: TRun; job: TJob }) {
  const cls = useStyles();
  const [open, setOpen] = useState<string | null>(() => defaultNodeId(run));
  return (
    <div className={cls.waterfallLayout}>
      <RunWaterfall
        run={run}
        jobData={job.data ?? null}
        jobLabel={`${job.name} · ${job.id}`}
        open={open}
        onToggle={(id) => setOpen((cur) => (cur === id ? null : id))}
      />
      <ResponseCard run={run} />
    </div>
  );
}

/** What the runs index still knows about a run whose job is gone. */
function RemovedJob({ entry }: { entry?: TAgentRunRef['entry'] }) {
  const cls = useStyles();
  const colors = useAgentColors();
  if (!entry) {
    return (
      <div className={cls.empty}>
        Job removed. Its logs, and the run recorded in them, are no longer in
        Redis.
      </div>
    );
  }
  return (
    <div className={cls.entry}>
      <Alert severity="info">
        Job removed. Its logs, and the full run, are no longer in Redis; this is
        what the runs index kept.
      </Alert>
      <Kpis
        items={[
          {
            label: 'Finished',
            value: new Date(entry.finishedAt).toLocaleString(),
          },
          { label: 'Duration', value: fmtMs(entry.durationMs) },
          { label: 'Steps', value: String(entry.steps), sub: entry.model },
          {
            label: 'Tokens in · out',
            value: `${fmtInt(entry.inputTokens)} · ${fmtInt(
              entry.outputTokens
            )}`,
            color: colors.tokensIn,
          },
          { label: 'Cost estimate', value: fmtCost(entry.cost) },
          {
            label: 'Outcome',
            value: entry.outcome,
            sub: entry.error ?? undefined,
            color: outcomeColor(entry.outcome, colors),
          },
        ]}
      />
      <Card title="Tool chain">
        <ToolChain tools={entry.tools} outcome={entry.outcome} />
      </Card>
    </div>
  );
}

function AgentRunView() {
  const cls = useStyles();
  const colors = useAgentColors();
  const [ref, backTo, layout, closeRun, changeAttempt, changeLayout] =
    useAgentsStore(
      (state) => [
        state.run as TAgentRunRef,
        state.backTo,
        state.runLayout,
        state.closeRun,
        state.changeAttempt,
        state.changeRunLayout,
      ],
      shallow
    );
  // Opened from a scrolled list (or job row), the page would keep its offset
  // and hide the header with the back button: start at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [ref.queue, ref.jobId]);
  const {
    queries: { getAgentJob },
  } = useNetwork();
  const queue = useQueueData(ref.queue);
  const queueName = queue?.agent?.label || queue?.name || ref.queue;
  const { status, data, error, refetch } = useQuery(
    [QueryKeysConfig.agentJob, ref.queue, ref.jobId],
    () => getAgentJob({ queue: ref.queue, id: ref.jobId }),
    {
      refetchInterval: getPollingInterval(),
      keepPreviousData: true,
    }
  );
  const job = data?.job ?? null;
  const runs = job?.agentRuns ?? [];
  const run =
    runs.find((r) => r.attempt === ref.attempt) ?? runs[runs.length - 1];

  const header = (
    <Paper elevation={0} className={cls.header}>
      <Button
        size="small"
        color="inherit"
        startIcon={<BackIcon />}
        onClick={closeRun}
      >
        {BACK_LABEL[backTo]}
      </Button>
      <div className={cls.ident}>
        <div className={cls.identTop}>
          <Tooltip title={ref.jobId}>
            <span className={cls.jobId}>{ref.jobId}</span>
          </Tooltip>
          {job && <JobStatusChip status={job.status} />}
          {run && (
            <Tooltip title="Detail level the run was recorded at">
              <Chip
                size="small"
                variant="outlined"
                className={cls.detailChip}
                label={`${run.detail} detail`}
              />
            </Tooltip>
          )}
          {run?.source === AgentRunSource.Returnvalue && (
            <Tooltip title="Recorded from the job's return value (compatibility path; failed attempts are not captured)">
              <Chip
                size="small"
                variant="outlined"
                color="warning"
                className={cls.detailChip}
                label="from return value"
              />
            </Tooltip>
          )}
        </div>
        <span className={cls.identSub}>
          {queueName}
          {job ? ` · ${job.name}` : ''}
          {run ? ` · outcome ` : ''}
          {run && (
            <span style={{ color: outcomeColor(run.outcome, colors) }}>
              {run.outcome}
            </span>
          )}
        </span>
      </div>
      <div className={cls.controls}>
        {runs.length > 1 && run && (
          <>
            <span className={cls.controlLabel}>Attempt</span>
            <ToggleButtonGroup
              className={cls.toggle}
              size="small"
              exclusive
              value={run.attempt}
              onChange={(_e, attempt) => {
                if (attempt) changeAttempt(attempt);
              }}
            >
              {runs.map((r) => (
                <ToggleButton
                  key={r.attempt}
                  value={r.attempt}
                  aria-label={`attempt ${r.attempt}`}
                  style={r.error ? { color: colors.error } : undefined}
                >
                  {r.attempt}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </>
        )}
        {run && (
          <ToggleButtonGroup
            className={cls.toggle}
            size="small"
            exclusive
            value={layout}
            onChange={(_e, next) => {
              if (next) changeLayout(next);
            }}
          >
            <ToggleButton value="graph" aria-label="graph">
              <GraphIcon /> Graph
            </ToggleButton>
            <ToggleButton value="waterfall" aria-label="waterfall">
              <WaterfallIcon /> Waterfall
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </div>
    </Paper>
  );

  return (
    <div className={cls.root}>
      {header}
      <NetworkRequest status={status} error={error} refetch={refetch}>
        {!job ? (
          <RemovedJob entry={ref.entry} />
        ) : !run ? (
          <div className={cls.empty}>
            No agent run recorded for this job yet. Runs are read from the job
            logs; a job that is still active, or that was not instrumented, has
            none.
          </div>
        ) : (
          <>
            {run.detailMismatch && (
              <Alert severity="warning">
                This run was recorded with more detail than the queue declares (
                {run.detail}). The server hid the extra fields; they are still
                in the job logs in Redis.
              </Alert>
            )}
            {run.truncated && (
              <Alert severity="info">
                This run was too large and was trimmed when it was recorded.
                Some tool inputs, outputs or texts are missing.
              </Alert>
            )}
            {run.detail === AgentRunDetail.Basic && (
              <Alert severity="info" variant="outlined">
                Recorded at basic detail: tool inputs and outputs and the texts
                were not stored.
              </Alert>
            )}
            <Kpis items={runKpis(run, colors)} />
            {layout === 'waterfall' ? (
              <WaterfallBody
                key={`${run.attempt}-${run.startedAt}`}
                run={run}
                job={job}
              />
            ) : (
              <GraphBody
                key={`${run.attempt}-${run.startedAt}`}
                run={run}
                job={job}
                queueName={queueName}
              />
            )}
          </>
        )}
      </NetworkRequest>
    </div>
  );
}

export default memo(AgentRunView);
