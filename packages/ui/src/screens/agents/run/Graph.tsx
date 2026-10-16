import React, { memo, useMemo } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import { alpha, useTheme } from '@mui/material/styles';
import clsx from 'clsx';
import RequestIcon from '@mui/icons-material/CallReceived';
import LlmIcon from '@mui/icons-material/Psychology';
import ToolIcon from '@mui/icons-material/Build';
import ResponseIcon from '@mui/icons-material/ChatBubbleOutline';
import { AgentRunDetail } from '@/typings/gql';
import { MONO } from '../shared';
import { useAgentColors } from '../colors';
import type { TAgentColors } from '../colors';
import { fmtCost, fmtInt, fmtMs, plural } from '../format';
import { layoutRunGraph } from '../model';
import type { TGraphNode, TRun } from '../model';

const useStyles = makeStyles((theme) => ({
  scroller: {
    overflowX: 'auto',
    overflowY: 'hidden',
    paddingBottom: theme.spacing(0.5),
  },
  canvas: {
    position: 'relative',
  },
  svg: {
    position: 'absolute',
    inset: 0,
    overflow: 'visible',
    pointerEvents: 'none',
  },
  edgeLabel: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    fontFamily: MONO,
    fontSize: 10,
    padding: '0 4px',
    color: theme.palette.text.secondary,
    backgroundColor: theme.palette.background.paper,
    whiteSpace: 'nowrap',
  },
  node: {
    position: 'absolute',
    boxSizing: 'border-box',
    padding: theme.spacing(1, 1.25),
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    borderRadius: 6,
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
    cursor: 'pointer',
    textAlign: 'left',
    font: 'inherit',
    color: theme.palette.text.primary,
    transition: 'border-color 120ms, box-shadow 120ms',
    '&:hover': {
      borderColor: theme.palette.text.disabled,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
  },
  nodeSelected: {
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.25)}`,
    backgroundColor: alpha(theme.palette.primary.main, 0.06),
    '&:hover': {
      borderColor: theme.palette.primary.main,
    },
  },
  nodeHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    '& svg': {
      fontSize: 14,
    },
  },
  kind: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  dur: {
    fontFamily: MONO,
    fontSize: 10,
    color: theme.palette.text.secondary,
  },
  title: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  line: {
    fontFamily: MONO,
    fontSize: 10.5,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: theme.palette.text.secondary,
  },
}));

type TLine = { text: string; color?: string };
type TNodeView = {
  icon: React.ReactNode;
  color: string;
  kind: string;
  dur: string;
  title: string;
  lines: TLine[];
};

const preview = (text: string, size = 22) =>
  text.length > size ? `${text.slice(0, size).trim()}…` : text;

const describe = (
  node: TGraphNode,
  run: TRun,
  queueName: string,
  jobLabel: string,
  colors: TAgentColors
): TNodeView => {
  const basic = run.detail === AgentRunDetail.Basic;
  const ref = node.ref;
  if (ref.kind === 'request') {
    return {
      icon: <RequestIcon />,
      color: colors.request,
      kind: 'REQUEST',
      dur: fmtMs(run.overheadStartMs),
      title: queueName,
      lines: [
        { text: jobLabel },
        { text: run.model },
        { text: `attempt ${run.attempt}` },
      ],
    };
  }
  if (ref.kind === 'response') {
    const cards = run.final?.cards ?? [];
    const title = run.error
      ? 'error'
      : cards.length
      ? `${plural(cards.length, 'card')} · ${cards[0].type}`
      : run.outcome;
    const lines: TLine[] = [];
    if (cards.length) lines.push({ text: cards[0].title });
    if (run.final?.text) {
      lines.push({ text: plural(run.final.text.length, 'char') });
    } else if (basic) {
      lines.push({ text: 'text not recorded' });
    }
    lines.push(
      run.error
        ? { text: run.error, color: colors.error }
        : { text: 'error: null' }
    );
    return {
      icon: <ResponseIcon />,
      color: run.error ? colors.error : colors.response,
      kind: 'RESPONSE',
      dur: fmtMs(run.overheadEndMs),
      title,
      lines: lines.slice(0, 3),
    };
  }
  const step = run.steps[ref.step];
  if (ref.kind === 'step') {
    let text: string;
    if (step.text) text = `text: ${preview(step.text)}`;
    else if (basic) text = 'text not recorded';
    else text = step.tools.length ? 'no text, tool calls only' : 'no text';
    return {
      icon: <LlmIcon />,
      color: colors.llm,
      kind: `LLM · STEP ${step.step}`,
      dur: fmtMs(step.durationMs),
      title: step.finishReason ?? '—',
      lines: [
        {
          text: `in ${fmtInt(step.inputTokens)} · out ${fmtInt(
            step.outputTokens
          )}`,
        },
        { text: fmtCost(step.cost) },
        { text },
      ],
    };
  }
  const tool = step.tools[ref.tool];
  return {
    icon: <ToolIcon />,
    color: tool.ok ? colors.tool : colors.error,
    kind: 'TOOL',
    dur: fmtMs(tool.durationMs),
    title: tool.name,
    lines: [
      {
        text: tool.summary,
        color: tool.empty ? colors.warning : undefined,
      },
      tool.ok
        ? { text: 'ok', color: colors.ok }
        : { text: 'error', color: colors.error },
    ],
  };
};

type TProps = {
  run: TRun;
  queueName: string;
  jobLabel: string;
  selected: string;
  onSelect: (id: string) => void;
};

function RunGraph({ run, queueName, jobLabel, selected, onSelect }: TProps) {
  const cls = useStyles();
  const theme = useTheme();
  const colors = useAgentColors();
  const layout = useMemo(() => layoutRunGraph(run), [run]);
  // Unique per mounted graph: two runs on screen must not share a marker id.
  const markerId = useMemo(
    () => `agent-arrow-${Math.random().toString(36).slice(2, 8)}`,
    []
  );
  const edgeColor = alpha(theme.palette.text.primary, 0.35);

  return (
    <div className={cls.scroller}>
      <div
        className={cls.canvas}
        style={{ width: layout.width, height: layout.height }}
      >
        <svg
          className={cls.svg}
          width={layout.width}
          height={layout.height}
          aria-hidden
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 8 8"
              refX={7}
              refY={4}
              markerWidth={7}
              markerHeight={7}
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 z" fill={edgeColor} />
            </marker>
          </defs>
          {layout.edges.map((edge) => (
            <path
              key={edge.id}
              d={edge.d}
              fill="none"
              stroke={edge.kind === 'h' ? edgeColor : alpha(colors.tool, 0.7)}
              strokeWidth={1.5}
              strokeDasharray={edge.kind === 'back' ? '4 4' : undefined}
              markerEnd={`url(#${markerId})`}
            />
          ))}
        </svg>
        {layout.edges.map(
          (edge) =>
            edge.label && (
              <span
                key={`${edge.id}-label`}
                className={cls.edgeLabel}
                style={{ left: edge.label.x, top: edge.label.y }}
              >
                {edge.label.text}
              </span>
            )
        )}
        {layout.nodes.map((node) => {
          const view = describe(node, run, queueName, jobLabel, colors);
          const isSelected = node.id === selected;
          return (
            <button
              type="button"
              key={node.id}
              className={clsx(cls.node, isSelected && cls.nodeSelected)}
              style={{
                left: node.x,
                top: node.y,
                width: node.w,
                height: node.h,
              }}
              aria-pressed={isSelected}
              onClick={() => onSelect(node.id)}
            >
              <span className={cls.nodeHead} style={{ color: view.color }}>
                {view.icon}
                <span className={cls.kind}>{view.kind}</span>
                <span className={cls.dur}>{view.dur}</span>
              </span>
              <span className={cls.title} title={view.title}>
                {view.title}
              </span>
              {view.lines.map((line, idx) => (
                <span
                  key={idx}
                  className={cls.line}
                  style={{ color: line.color }}
                  title={line.text}
                >
                  {line.text}
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default memo(RunGraph);
