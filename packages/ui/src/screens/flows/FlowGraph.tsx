import React, { memo } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import clsx from 'clsx';
import FlagIcon from '@mui/icons-material/FlagOutlined';
import ReportIcon from '@mui/icons-material/ReportOutlined';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import { FlowEdgeKind, FlowStepKind } from '@/typings/gql';
import { MONO } from '../agents/shared';
import { fmtMs } from '../agents/format';
import { useFlowColors, traceKindColor } from './colors';
import type { TFlowColors } from './colors';
import { isTraceEdge, placeEdgeLabels, shortStepName } from './model';
import type {
  TFlow,
  TFlowLayout,
  TFlowNode,
  TStepStats,
  TTraceJob,
  TTraceJobKind,
  traceHighlight,
} from './model';
import { StepTag } from './parts';
import { clockMs, fmtPerMin } from './format';

const useStyles = makeStyles((theme) => ({
  scroll: {
    overflow: 'auto',
    minWidth: 0,
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
    fontSize: 10.5,
    padding: '0 4px',
    borderRadius: 3,
    whiteSpace: 'nowrap',
    backgroundColor: theme.palette.background.paper,
    pointerEvents: 'none',
  },
  node: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: theme.spacing(0.875, 1.125),
    borderRadius: 6,
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
    textAlign: 'left',
    font: 'inherit',
    color: 'inherit',
    cursor: 'pointer',
    transition: theme.transitions.create(['box-shadow', 'opacity'], {
      duration: 120,
    }),
    '&:hover, &:focus-visible': {
      borderColor: alpha(theme.palette.primary.main, 0.6),
    },
  },
  nodeEnd: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    cursor: 'default',
    justifyContent: 'center',
  },
  nodeTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    '& svg': {
      fontSize: 15,
      flex: 'none',
    },
  },
  nodeName: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nodeSub: {
    fontSize: 11,
    color: theme.palette.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nodeSubMono: {
    fontFamily: MONO,
    fontSize: 10.5,
  },
  stats: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontFamily: MONO,
    fontSize: 10.5,
  },
  stat: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
  },
  spacer: {
    flex: 1,
  },
}));

export type TGraphTrace = {
  highlight: ReturnType<typeof traceHighlight>;
  jobByStep: Map<string, TTraceJob>;
  kindByStep: Map<string, TTraceJobKind>;
};

type TProps = {
  flow: TFlow;
  layout: TFlowLayout;
  prefix: string | null;
  /** Flow tab: live stats per step and the wait of each edge's target. */
  stats?: Map<string, TStepStats>;
  /** Trace tab: the path to light up. */
  trace?: TGraphTrace;
  selected: string | null;
  onSelect: (stepId: string) => void;
};

const edgeStroke = (kind: FlowEdgeKind, colors: TFlowColors) =>
  kind === FlowEdgeKind.Fallback ? colors.fallback : colors.edge;

function FlowGraph({
  flow,
  layout,
  prefix,
  stats,
  trace,
  selected,
  onSelect,
}: TProps) {
  const cls = useStyles();
  const colors = useFlowColors();
  const stepOf = new Map(flow.steps.map((s) => [s.id, s]));
  const markerId = `flow-arrow-${flow.id.replace(/[^a-z0-9]/gi, '')}`;
  const markerOn = `${markerId}-on`;

  const nodeView = (node: TFlowNode) => {
    const step = stepOf.get(node.id);
    const end = node.kind === FlowStepKind.End;
    const error = node.kind === FlowStepKind.Error;
    const s = stats?.get(node.id);
    const job = trace?.jobByStep.get(node.id);
    const kind = trace?.kindByStep.get(node.id);
    let border: string | undefined;
    let background: string | undefined;
    let opacity = 1;
    let tag: React.ComponentProps<typeof StepTag>['tag'] | null = null;
    if (s?.bottleneck) {
      border = colors.warning;
      tag = 'bottleneck';
    }
    if (node.alt) {
      border = border ?? alpha(colors.fallback, 0.6);
      tag = tag ?? 'fallback';
    }
    if (error) {
      border = alpha(colors.failed, 0.6);
      tag = 'onError';
    }
    let sub: React.ReactNode = end
      ? null
      : step?.description || step?.when || null;
    let subMono = false;
    if (trace) {
      if (job && kind) {
        const color = traceKindColor(kind, colors);
        border = color;
        background = alpha(color, 0.07);
        tag =
          kind === 'failed' ? 'failed' : kind === 'pending' ? 'pending' : tag;
        sub = job.pending
          ? `${job.startedAt ? 'active since' : 'waiting since'} ${clockMs(
              job.startedAt ?? job.enqueuedAt
            )}`
          : `${clockMs(job.startedAt ?? job.enqueuedAt)} · ${fmtMs(
              job.processMs
            )}${kind === 'failed' ? ' · failed' : ''}`;
        subMono = true;
      } else {
        opacity = 0.3;
      }
    }
    const Icon = end
      ? FlagIcon
      : error
      ? ReportIcon
      : node.alt
      ? AltRouteIcon
      : InboxIcon;
    const iconColor = error
      ? colors.failed
      : node.alt
      ? colors.fallback
      : colors.muted;
    const isSelected = selected === node.id;
    const style: React.CSSProperties = {
      left: node.x,
      top: node.y,
      width: node.w,
      height: node.h,
      opacity,
      borderColor: border,
      backgroundColor: end ? undefined : background,
      borderStyle: error ? 'dashed' : undefined,
      boxShadow: isSelected
        ? `0 0 0 2px ${colors.accent}`
        : s?.bottleneck && !trace
        ? `0 0 0 3px ${alpha(colors.warning, 0.14)}`
        : undefined,
    };
    const name = end ? step?.label ?? 'end' : shortStepName(node.id, prefix);
    const content = (
      <>
        <span className={cls.nodeTop}>
          <Icon style={{ color: iconColor }} />
          <span className={cls.nodeName}>{name}</span>
          {tag && <StepTag tag={tag} />}
        </span>
        {sub && (
          <span className={clsx(cls.nodeSub, subMono && cls.nodeSubMono)}>
            {sub}
          </span>
        )}
        {!trace && s && !end && (
          <span className={cls.stats}>
            <span className={cls.stat} title="waiting">
              <span
                className={cls.dot}
                style={{ background: colors.waiting }}
              />
              {s.waiting}
            </span>
            <span className={cls.stat} title="active">
              <span className={cls.dot} style={{ background: colors.active }} />
              {s.active}
            </span>
            <span className={cls.stat} title="failed">
              <span className={cls.dot} style={{ background: colors.failed }} />
              {s.failedNow}
            </span>
            <span className={cls.spacer} />
            <span>{fmtPerMin(s.throughputPerMin)}</span>
          </span>
        )}
      </>
    );
    if (end) {
      return (
        <div
          key={node.id}
          className={clsx(cls.node, cls.nodeEnd)}
          style={style}
          title={step?.label}
        >
          {content}
        </div>
      );
    }
    return (
      <button
        type="button"
        key={node.id}
        className={cls.node}
        style={style}
        title={node.id}
        aria-pressed={isSelected}
        aria-label={`step ${node.id}`}
        onClick={() => onSelect(node.id)}
      >
        {content}
      </button>
    );
  };

  const labelSpecs: Array<{
    key: string;
    from: string;
    to: string;
    text: string;
    color: string;
    opacity: number;
  }> = [];
  const paths = layout.edges.map((edge) => {
    const dashed =
      edge.kind === FlowEdgeKind.Fallback ||
      edge.kind === FlowEdgeKind.Conditional ||
      edge.kind === FlowEdgeKind.Sidecar ||
      edge.kind === FlowEdgeKind.End;
    const on = trace ? isTraceEdge(trace.highlight, edge.from, edge.to) : false;
    const stroke = on
      ? edge.kind === FlowEdgeKind.Fallback
        ? colors.fallback
        : colors.accent
      : edgeStroke(edge.kind, colors);
    const opacity = trace && !on ? 0.25 : 1;
    let text: string | null = null;
    let warn = false;
    if (trace) {
      const job = on ? trace.jobByStep.get(edge.to) : undefined;
      if (job && job.waitMs !== null && job.waitMs !== undefined) {
        text = `+${fmtMs(job.waitMs)}`;
        warn = job.waitMs > 60_000;
      }
    } else {
      const wait = stats?.get(edge.to)?.waitAvg ?? null;
      const showWait = wait !== null && wait >= 1000;
      warn = !!wait && wait > 60_000;
      const parts = [edge.when, showWait ? `avg ${fmtMs(wait)}` : null].filter(
        Boolean
      );
      text = parts.length ? parts.join(' · ') : null;
    }
    if (text) {
      labelSpecs.push({
        key: `${edge.from}>${edge.to}`,
        from: edge.from,
        to: edge.to,
        text,
        color: warn ? colors.warning : colors.muted,
        opacity,
      });
    }
    return (
      <path
        key={`${edge.from}>${edge.to}`}
        d={edge.path}
        fill="none"
        stroke={stroke}
        strokeWidth={on ? 2 : 1.5}
        opacity={opacity}
        strokeDasharray={dashed ? '5 4' : undefined}
        markerEnd={`url(#${on ? markerOn : markerId})`}
      />
    );
  });

  // Placed off the nodes (a narrow gap would hide part of the text).
  const specOf = new Map(labelSpecs.map((l) => [l.key, l]));
  const labels = placeEdgeLabels(layout, labelSpecs).map((l) => {
    const spec = specOf.get(l.key);
    return (
      <span
        key={l.key}
        className={cls.edgeLabel}
        style={{
          left: l.x,
          top: l.y,
          color: spec?.color,
          opacity: spec?.opacity,
        }}
      >
        {l.text}
      </span>
    );
  });

  return (
    <div className={cls.scroll}>
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
            {[
              [markerId, colors.edge],
              [markerOn, colors.accent],
            ].map(([id, fill]) => (
              <marker
                key={id}
                id={id}
                viewBox="0 0 8 8"
                refX={7}
                refY={4}
                markerWidth={7}
                markerHeight={7}
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" fill={fill} />
              </marker>
            ))}
          </defs>
          {paths}
        </svg>
        {labels}
        {layout.nodes.map(nodeView)}
      </div>
    </div>
  );
}

export default memo(FlowGraph);
