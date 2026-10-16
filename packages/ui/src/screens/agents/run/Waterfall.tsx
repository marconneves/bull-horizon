import React, { memo, useMemo } from 'react';
import Paper from '@mui/material/Paper';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import clsx from 'clsx';
import RequestIcon from '@mui/icons-material/CallReceived';
import LlmIcon from '@mui/icons-material/Psychology';
import ToolIcon from '@mui/icons-material/Build';
import ResponseIcon from '@mui/icons-material/ChatBubbleOutline';
import ExpandIcon from '@mui/icons-material/ExpandMore';
import { MONO } from '../shared';
import { useAgentColors } from '../colors';
import type { TAgentColors } from '../colors';
import { fmtInt, fmtMs, plural } from '../format';
import { axisTicks, waterfallRows } from '../model';
import type { TRun, TWaterfallRow } from '../model';
import { NodeBlocks, useNodeDescription } from './NodeDetails';

const GRID = 'minmax(170px, 1.1fr) minmax(0, 3fr) 120px 64px';

const useStyles = makeStyles((theme) => ({
  root: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(0.75, 0, 1),
    minWidth: 0,
  },
  head: {
    display: 'grid',
    gridTemplateColumns: GRID,
    gap: theme.spacing(1.5),
    alignItems: 'end',
    padding: theme.spacing(0.75, 2, 1),
    borderBottom: `1px solid ${theme.palette.divider}`,
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: '0.06em',
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
  row: {
    borderBottom: `1px solid ${theme.palette.divider}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  rowOpen: {
    backgroundColor: alpha(theme.palette.primary.main, 0.04),
  },
  line: {
    display: 'grid',
    gridTemplateColumns: GRID,
    gap: theme.spacing(1.5),
    alignItems: 'center',
    padding: theme.spacing(0, 2),
    minHeight: 46,
    width: '100%',
    border: 'none',
    background: 'none',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: -2,
    },
  },
  name: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    minWidth: 0,
    '& > svg': {
      fontSize: 15,
      flexShrink: 0,
    },
  },
  chevron: {
    fontSize: '16px !important',
    color: theme.palette.text.secondary,
    transition: 'transform 120ms',
  },
  chevronOpen: {
    transform: 'rotate(180deg)',
  },
  nameText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  title: {
    fontFamily: MONO,
    fontSize: 12,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  sub: {
    fontSize: 10.5,
    color: theme.palette.text.secondary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  track: {
    position: 'relative',
    height: 46,
  },
  gridLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderLeft: `1px dashed ${theme.palette.divider}`,
  },
  bar: {
    position: 'absolute',
    top: '50%',
    height: 12,
    transform: 'translateY(-50%)',
    borderRadius: 3,
    minWidth: 3,
  },
  tokens: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  tokenBar: {
    display: 'flex',
    height: 5,
    gap: 1,
    '& > span': {
      borderRadius: 1,
    },
  },
  num: {
    fontFamily: MONO,
    fontSize: 10.5,
    color: theme.palette.text.secondary,
  },
  dur: {
    fontFamily: MONO,
    fontSize: 11,
    textAlign: 'right',
  },
  details: {
    padding: theme.spacing(0.5, 2, 1.75, 5),
  },
}));

type TRowView = {
  icon: React.ReactNode;
  color: string;
  title: string;
  sub: string;
};

const describeRow = (
  row: TWaterfallRow,
  run: TRun,
  jobLabel: string,
  colors: TAgentColors
): TRowView => {
  const ref = row.ref;
  if (ref.kind === 'request') {
    return {
      icon: <RequestIcon />,
      color: colors.request,
      title: 'request',
      sub: jobLabel,
    };
  }
  if (ref.kind === 'response') {
    const cards = run.final?.cards ?? [];
    return {
      icon: <ResponseIcon />,
      color: run.error ? colors.error : colors.response,
      title: 'response',
      sub: run.error
        ? run.error
        : cards.length
        ? `${plural(cards.length, 'card')} · ${cards[0].type}`
        : run.outcome,
    };
  }
  const step = run.steps[ref.step];
  if (ref.kind === 'step') {
    return {
      icon: <LlmIcon />,
      color: colors.llm,
      title: `LLM step ${step.step}`,
      sub: `${step.finishReason ?? '—'}${step.text ? ' · text' : ''}`,
    };
  }
  const tool = step.tools[ref.tool];
  return {
    icon: <ToolIcon />,
    color: tool.ok ? colors.tool : colors.error,
    title: tool.name,
    sub: `${tool.summary} · ${tool.ok ? 'ok' : 'error'}`,
  };
};

type TRowProps = {
  row: TWaterfallRow;
  run: TRun;
  jobData: string | null;
  jobLabel: string;
  spanMs: number;
  ticks: number[];
  maxTokens: number;
  open: boolean;
  onToggle: () => void;
};

const WaterfallRow = memo(function WaterfallRow({
  row,
  run,
  jobData,
  jobLabel,
  spanMs,
  ticks,
  maxTokens,
  open,
  onToggle,
}: TRowProps) {
  const cls = useStyles();
  const colors = useAgentColors();
  const view = describeRow(row, run, jobLabel, colors);
  const description = useNodeDescription(open ? row.ref : null, {
    run,
    jobData,
  });
  const left = (row.startMs / spanMs) * 100;
  const width = Math.min((row.durationMs / spanMs) * 100, 100 - left);
  const tokenWidth = (value: number | null) =>
    value ? `${(value / maxTokens) * 100}%` : '0%';

  return (
    <div className={clsx(cls.row, open && cls.rowOpen)}>
      <button
        type="button"
        className={cls.line}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={cls.name} style={{ paddingLeft: row.indent ? 20 : 0 }}>
          <ExpandIcon className={clsx(cls.chevron, open && cls.chevronOpen)} />
          <span style={{ color: view.color, display: 'flex' }}>
            {view.icon}
          </span>
          <span className={cls.nameText}>
            <span className={cls.title} title={view.title}>
              {view.title}
            </span>
            <span className={cls.sub} title={view.sub}>
              {view.sub}
            </span>
          </span>
        </span>
        <span className={cls.track}>
          {ticks.map((tick) => (
            <span
              key={tick}
              className={cls.gridLine}
              style={{ left: `${(tick / spanMs) * 100}%` }}
            />
          ))}
          <span
            className={cls.bar}
            style={{
              left: `${left}%`,
              width: `${Math.max(width, 0)}%`,
              backgroundColor: view.color,
            }}
          />
        </span>
        <span className={cls.tokens}>
          {row.inputTokens !== null && (
            <>
              <span className={cls.tokenBar}>
                <span
                  style={{
                    width: tokenWidth(row.inputTokens),
                    backgroundColor: colors.tokensIn,
                  }}
                />
                <span
                  style={{
                    width: tokenWidth(row.outputTokens),
                    backgroundColor: colors.tokensOut,
                  }}
                />
              </span>
              <span className={cls.num}>
                {fmtInt(row.inputTokens)} · {fmtInt(row.outputTokens)}
              </span>
            </>
          )}
        </span>
        <span className={cls.dur}>{fmtMs(row.durationMs)}</span>
      </button>
      {open && description && (
        <div className={cls.details}>
          <NodeBlocks blocks={description.blocks} grid />
        </div>
      )}
    </div>
  );
});

type TProps = {
  run: TRun;
  jobData: string | null;
  jobLabel: string;
  open: string | null;
  onToggle: (id: string) => void;
};

function RunWaterfall({ run, jobData, jobLabel, open, onToggle }: TProps) {
  const cls = useStyles();
  const { rows, spanMs } = useMemo(() => waterfallRows(run), [run]);
  const ticks = useMemo(() => axisTicks(spanMs), [spanMs]);
  const maxTokens = useMemo(
    () =>
      Math.max(
        1,
        ...run.steps.map(
          (step) => (step.inputTokens ?? 0) + (step.outputTokens ?? 0)
        )
      ),
    [run]
  );
  return (
    <Paper elevation={0} className={cls.root}>
      <div className={cls.head}>
        <span>STEP</span>
        <span className={cls.axis}>
          {ticks.map((tick) => (
            <span
              key={tick}
              className={cls.tick}
              style={{ left: `${(tick / spanMs) * 100}%` }}
            >
              {fmtMs(tick)}
            </span>
          ))}
        </span>
        <span>TOKENS IN · OUT</span>
        <span style={{ textAlign: 'right' }}>TIME</span>
      </div>
      {rows.map((row) => (
        <WaterfallRow
          key={row.id}
          row={row}
          run={run}
          jobData={jobData}
          jobLabel={jobLabel}
          spanMs={spanMs}
          ticks={ticks}
          maxTokens={maxTokens}
          open={open === row.id}
          onToggle={() => onToggle(row.id)}
        />
      ))}
    </Paper>
  );
}

export default memo(RunWaterfall);
