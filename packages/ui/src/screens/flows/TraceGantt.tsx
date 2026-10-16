import React, { memo, useMemo } from 'react';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import OpenIcon from '@mui/icons-material/OpenInNew';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import clsx from 'clsx';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import Spin from '@/components/Spin';
import { MONO } from '../agents/shared';
import { fmtMs } from '../agents/format';
import { traceKindColor, useFlowColors } from './colors';
import { clockMs } from './format';
import { flowTableRows, shortStepName, traceGantt, traceJobKey } from './model';
import type { TFlow, TTrace, TTraceJob, TTraceJobKind } from './model';
import { JsonBlock, useFlowPartStyles } from './parts';
import TraceBlock from './TraceBlock';
import { useOpenQueueJobs } from './use-open-jobs';

const COLS = 'minmax(220px, 280px) minmax(0, 1fr) 76px';

const useStyles = makeStyles((theme) => ({
  root: {
    border: `1px solid ${theme.palette.divider}`,
    minWidth: 0,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: COLS,
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(0.75, 1.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
    fontFamily: MONO,
    fontSize: 12,
  },
  head: {
    fontSize: 10,
    letterSpacing: '0.06em',
    color: theme.palette.text.secondary,
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
  name: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flex: 'none',
  },
  step: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  time: {
    fontSize: 10.5,
    color: theme.palette.text.secondary,
  },
  axis: {
    position: 'relative',
    height: 14,
  },
  tick: {
    position: 'absolute',
    transform: 'translateX(-50%)',
    whiteSpace: 'nowrap',
  },
  lane: {
    position: 'relative',
    height: 16,
  },
  grid: {
    position: 'absolute',
    top: -6,
    bottom: -6,
    width: 1,
    backgroundColor: theme.palette.divider,
  },
  bar: {
    position: 'absolute',
    top: 3,
    height: 10,
    minWidth: 2,
    borderRadius: 2,
  },
  dur: {
    textAlign: 'right',
  },
  details: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: theme.spacing(2),
    padding: theme.spacing(1.25, 1.5, 1.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
    backgroundColor: alpha(theme.palette.text.primary, 0.02),
    '& > *': {
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.75),
    },
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 1.5),
    fontSize: 11,
    color: theme.palette.text.secondary,
    '& > span': {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    },
  },
  swatch: {
    width: 14,
    height: 8,
    borderRadius: 2,
  },
}));

/** Queue wait, hatched: reads as "time spent in line", not work. */
const hatch = (color: string) =>
  `repeating-linear-gradient(135deg, ${color} 0 3px, transparent 3px 6px)`;

/** Returnvalue or stacktrace of one job, read on demand (`Query.job`). */
function JobOutcome({ job }: { job: TTraceJob }) {
  const parts = useFlowPartStyles();
  const openJobs = useOpenQueueJobs();
  const {
    queries: { getJobById },
  } = useNetwork();
  const { status, data } = useQuery(
    [QueryKeysConfig.jobById, job.queueId, job.jobId],
    () => getJobById({ queue: job.queueId, id: job.jobId }),
    { staleTime: 30_000 }
  );
  const record = data?.job ?? null;
  const failed = !!record?.failedReason || !!record?.stacktrace?.length;
  return (
    <div>
      <span className={parts.label}>
        {record && failed ? 'stacktrace' : 'returnvalue'}
      </span>
      {status === 'loading' ? (
        <Spin size={16} centered={false} />
      ) : !record ? (
        <span className={parts.muted}>
          Job removed from Redis (retention): only the trace index entry is
          left.
        </span>
      ) : failed ? (
        <JsonBlock
          value={
            record.stacktrace?.filter(Boolean).join('\n') ||
            record.failedReason ||
            ''
          }
          label="stacktrace"
        />
      ) : (
        <JsonBlock value={record.returnValue ?? 'null'} label="returnvalue" />
      )}
      {record && (
        <Button
          size="small"
          startIcon={<OpenIcon />}
          style={{ alignSelf: 'flex-start' }}
          onClick={() =>
            openJobs(job.queueId, { status: job.status, jobId: job.jobId })
          }
        >
          Open job
        </Button>
      )}
    </div>
  );
}

type TProps = {
  flow: TFlow;
  trace: TTrace;
  prefix: string | null;
  kindOf: (job: TTraceJob) => TTraceJobKind;
  open: string | null;
  onToggle: (key: string) => void;
};

/** Option B of the Trace tab: queue wait and processing per job, on one axis. */
function TraceGantt({ flow, trace, prefix, kindOf, open, onToggle }: TProps) {
  const cls = useStyles();
  const parts = useFlowPartStyles();
  const colors = useFlowColors();
  const gantt = useMemo(() => traceGantt(trace, Date.now()), [trace]);
  const depth = useMemo(
    () => new Map(flowTableRows(flow).map((r) => [r.id, r.depth])),
    [flow]
  );
  return (
    <Paper elevation={0} className={cls.root}>
      <div className={clsx(cls.row, cls.head)}>
        <span>STEP · START</span>
        <div className={cls.axis}>
          {gantt.ticks.map((t) => (
            <span
              key={t.ms}
              className={cls.tick}
              style={{ left: `${t.left}%` }}
            >
              {t.ms ? fmtMs(t.ms) : '0'}
            </span>
          ))}
        </div>
        <span className={cls.dur}>TOTAL</span>
      </div>
      {gantt.rows.map(({ job, wait, proc }) => {
        const key = traceJobKey(job);
        const kind = kindOf(job);
        const color = traceKindColor(kind, colors);
        const isOpen = open === key;
        const waitMs = job.waitMs ?? 0;
        const longWait = waitMs > 60_000;
        const total =
          job.pending || job.processMs === null || job.processMs === undefined
            ? null
            : waitMs + job.processMs;
        return (
          <React.Fragment key={key}>
            <div
              className={clsx(cls.row, cls.clickable, isOpen && cls.open)}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => onToggle(key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggle(key);
                }
              }}
              style={
                kind === 'failed'
                  ? { backgroundColor: alpha(colors.failed, 0.06) }
                  : undefined
              }
            >
              <span
                className={cls.name}
                style={{ paddingLeft: (depth.get(job.stepId) ?? 0) * 14 }}
              >
                <span className={cls.dot} style={{ backgroundColor: color }} />
                <span className={cls.step} title={job.stepId}>
                  {shortStepName(job.stepId, prefix)}
                </span>
                <span className={cls.time}>{clockMs(job.enqueuedAt)}</span>
              </span>
              <div className={cls.lane}>
                {gantt.ticks.map((t) => (
                  <span
                    key={t.ms}
                    className={cls.grid}
                    style={{ left: `${t.left}%` }}
                  />
                ))}
                {wait && (
                  <span
                    className={cls.bar}
                    title={`queue wait ${fmtMs(job.waitMs)}`}
                    style={{
                      left: `${wait.left}%`,
                      width: `${wait.width}%`,
                      background: hatch(
                        longWait ? alpha(colors.warning, 0.7) : colors.waitBar
                      ),
                    }}
                  />
                )}
                {proc && (
                  <span
                    className={cls.bar}
                    title={`processing ${fmtMs(job.processMs)}`}
                    style={{
                      left: `${proc.left}%`,
                      width: `${proc.width}%`,
                      backgroundColor: job.pending ? alpha(color, 0.5) : color,
                    }}
                  />
                )}
              </div>
              <span
                className={cls.dur}
                style={{ color: longWait ? colors.warning : undefined }}
              >
                {total === null
                  ? job.pending
                    ? 'pending'
                    : '—'
                  : fmtMs(total)}
              </span>
            </div>
            {isOpen && (
              <div className={cls.details}>
                <div>
                  <TraceBlock job={job} trace={trace} flowId={flow.id} />
                </div>
                <div>
                  <span className={parts.label}>timing</span>
                  <JsonBlock
                    value={[
                      `enqueued    ${clockMs(job.enqueuedAt)}`,
                      `queue wait  ${fmtMs(job.waitMs)}`,
                      `started     ${clockMs(job.startedAt)}`,
                      `processing  ${fmtMs(job.processMs)}`,
                      `attempt     ${job.attempt}`,
                      `status      ${job.status}`,
                    ].join('\n')}
                    label="timing"
                  />
                </div>
                <JobOutcome job={job} />
              </div>
            )}
          </React.Fragment>
        );
      })}
      <div className={cls.legend}>
        <span>
          <span
            className={cls.swatch}
            style={{ background: hatch(colors.waitBar) }}
          />
          queue wait
        </span>
        <span>
          <span
            className={cls.swatch}
            style={{ backgroundColor: colors.completed }}
          />
          processing
        </span>
        <span>
          <span
            className={cls.swatch}
            style={{ backgroundColor: colors.failed }}
          />
          failed
        </span>
        <span>
          <span
            className={cls.swatch}
            style={{ backgroundColor: colors.fallback }}
          />
          fallback
        </span>
        <span>
          <span
            className={cls.swatch}
            style={{ backgroundColor: alpha(colors.active, 0.5) }}
          />
          pending
        </span>
      </div>
    </Paper>
  );
}

export default memo(TraceGantt);
