import React, { memo } from 'react';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import OpenIcon from '@mui/icons-material/OpenInNew';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import clsx from 'clsx';
import { MONO } from '../agents/shared';
import { fmtMs } from '../agents/format';
import { traceKindColor, useFlowColors } from './colors';
import { clockMs } from './format';
import { shortStepName, traceJobKey, traceJobsInOrder } from './model';
import type { TTrace, TTraceJob, TTraceJobKind } from './model';
import { useFlowPartStyles } from './parts';
import TraceBlock from './TraceBlock';
import { useOpenQueueJobs } from './use-open-jobs';

const useStyles = makeStyles((theme) => ({
  panel: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1.75),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
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
  path: {
    display: 'flex',
    flexDirection: 'column',
  },
  step: {
    display: 'flex',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 0.75),
    borderRadius: 4,
    background: 'none',
    border: 'none',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    '&:hover, &:focus-visible': {
      backgroundColor: alpha(theme.palette.text.primary, 0.04),
    },
  },
  stepOn: {
    backgroundColor: alpha(theme.palette.primary.main, 0.1),
  },
  rail: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: 10,
    flex: 'none',
    paddingTop: 4,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: '50%',
    flex: 'none',
  },
  line: {
    width: 1.5,
    flex: 1,
    minHeight: 14,
    backgroundColor: theme.palette.divider,
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  name: {
    fontFamily: MONO,
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  time: {
    fontFamily: MONO,
    fontSize: 10.5,
    color: theme.palette.text.secondary,
  },
  job: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  },
  jobHead: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontFamily: MONO,
    fontSize: 11.5,
  },
  reason: {
    fontFamily: MONO,
    fontSize: 11.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
}));

type TProps = {
  trace: TTrace;
  flowId: string;
  prefix: string | null;
  kindOf: (job: TTraceJob) => TTraceJobKind;
  selected: TTraceJob | null;
  onSelect: (key: string) => void;
};

/** Option A of the Trace tab: the event's path and the chosen job's `_trace`. */
function TracePath({
  trace,
  flowId,
  prefix,
  kindOf,
  selected,
  onSelect,
}: TProps) {
  const cls = useStyles();
  const parts = useFlowPartStyles();
  const colors = useFlowColors();
  const openJobs = useOpenQueueJobs();
  const jobs = traceJobsInOrder(trace);
  return (
    <Paper elevation={0} className={cls.panel} aria-label="event path">
      <div>
        <div className={cls.kicker}>EVENT PATH</div>
        <span className={parts.muted}>Pick a step to see its job.</span>
      </div>
      <div className={cls.path}>
        {jobs.map((job, i) => {
          const key = traceJobKey(job);
          const color = traceKindColor(kindOf(job), colors);
          return (
            <button
              type="button"
              key={key}
              className={clsx(cls.step, selected === job && cls.stepOn)}
              aria-pressed={selected === job}
              onClick={() => onSelect(key)}
            >
              <span className={cls.rail}>
                <span className={cls.dot} style={{ backgroundColor: color }} />
                {i < jobs.length - 1 && <span className={cls.line} />}
              </span>
              <span className={cls.text}>
                <span className={cls.name} title={job.stepId}>
                  {shortStepName(job.stepId, prefix)}
                </span>
                <span className={cls.time}>
                  {job.pending
                    ? `${job.startedAt ? 'active' : 'waiting'} since ${clockMs(
                        job.startedAt ?? job.enqueuedAt
                      )}`
                    : `${clockMs(job.startedAt ?? job.enqueuedAt)} · ${fmtMs(
                        job.processMs
                      )}`}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {selected && (
        <div className={cls.job}>
          <div className={cls.jobHead}>
            <span>job {selected.jobId}</span>
            <span className={parts.muted}>attempt {selected.attempt}</span>
          </div>
          <TraceBlock job={selected} trace={trace} flowId={flowId} />
          {selected.failedReason && (
            <span className={cls.reason} style={{ color: colors.failed }}>
              {selected.failedReason}
            </span>
          )}
          <Button
            size="small"
            startIcon={<OpenIcon />}
            style={{ alignSelf: 'flex-start' }}
            onClick={() =>
              openJobs(selected.queueId, {
                status: selected.status,
                jobId: selected.jobId,
              })
            }
          >
            Open job
          </Button>
        </div>
      )}
    </Paper>
  );
}

export default memo(TracePath);
