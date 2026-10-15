// The run view's derivations, kept pure (relative, type-only imports) so they
// are unit-testable without the browser bundle.
import type { AgentRunFieldsFragment } from '../../typings/gql';
import { fmtCost, fmtInt, fmtMs } from './format';

export type TRun = AgentRunFieldsFragment;
export type TRunStep = TRun['steps'][0];
export type TRunTool = TRunStep['tools'][0];

// ---------------------------------------------------------------------------
// Node identity, shared by the graph, its side panel and the waterfall rows.
// ---------------------------------------------------------------------------

export type TNodeRef =
  | { kind: 'request' }
  | { kind: 'step'; step: number }
  | { kind: 'tool'; step: number; tool: number }
  | { kind: 'response' };

/** `step`/`tool` are array indexes, not the step numbers the run carries. */
export const nodeId = (ref: TNodeRef): string => {
  switch (ref.kind) {
    case 'request':
      return 'req';
    case 'response':
      return 'res';
    case 'step':
      return `s${ref.step}`;
    case 'tool':
      return `t${ref.step}-${ref.tool}`;
  }
};

export const parseNodeId = (id: string, run: TRun): TNodeRef | null => {
  if (id === 'req') return { kind: 'request' };
  if (id === 'res') return { kind: 'response' };
  const step = /^s(\d+)$/.exec(id);
  if (step) {
    const index = Number(step[1]);
    return run.steps[index] ? { kind: 'step', step: index } : null;
  }
  const tool = /^t(\d+)-(\d+)$/.exec(id);
  if (tool) {
    const s = Number(tool[1]);
    const t = Number(tool[2]);
    return run.steps[s]?.tools[t] ? { kind: 'tool', step: s, tool: t } : null;
  }
  return null;
};

/** What the panel opens on: the first tool that came back empty or failed. */
export const defaultNodeId = (run: TRun): string => {
  for (let s = 0; s < run.steps.length; s += 1) {
    const tools = run.steps[s].tools;
    for (let t = 0; t < tools.length; t += 1) {
      if (!tools[t].ok || tools[t].empty) {
        return nodeId({ kind: 'tool', step: s, tool: t });
      }
    }
  }
  return run.error ? 'res' : run.steps.length ? 's0' : 'req';
};

// ---------------------------------------------------------------------------
// Graph layout (Run A). Computed from the run: column 0 is the request, column
// i is step i with its tools stacked below it (a step can call several tools
// in parallel), the last column is the response.
// ---------------------------------------------------------------------------

export const GRAPH = {
  colWidth: 182,
  nodeWidth: 150,
  stepHeight: 118,
  toolHeight: 92,
  top: 10,
  toolTop: 190,
  toolGap: 14,
};

export type TGraphNode = {
  id: string;
  ref: TNodeRef;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TGraphEdge = {
  id: string;
  /** `h` same row, `down` step to tool, `back` tool result to next step. */
  kind: 'h' | 'down' | 'back';
  d: string;
  label?: { x: number; y: number; text: string };
};

export type TGraphLayout = {
  nodes: TGraphNode[];
  edges: TGraphEdge[];
  width: number;
  height: number;
};

export const layoutRunGraph = (run: TRun): TGraphLayout => {
  const nodes: TGraphNode[] = [];
  const byId = new Map<string, TGraphNode>();
  const add = (ref: TNodeRef, col: number, row: number) => {
    const isTool = ref.kind === 'tool';
    const node: TGraphNode = {
      id: nodeId(ref),
      ref,
      x: col * GRAPH.colWidth,
      y: isTool
        ? GRAPH.toolTop + (row - 1) * (GRAPH.toolHeight + GRAPH.toolGap)
        : GRAPH.top,
      w: GRAPH.nodeWidth,
      h: isTool ? GRAPH.toolHeight : GRAPH.stepHeight,
    };
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };

  add({ kind: 'request' }, 0, 0);
  run.steps.forEach((step, s) => {
    add({ kind: 'step', step: s }, s + 1, 0);
    step.tools.forEach((_tool, t) =>
      add({ kind: 'tool', step: s, tool: t }, s + 1, t + 1)
    );
  });
  add({ kind: 'response' }, run.steps.length + 1, 0);

  const edges: TGraphEdge[] = [];
  const link = (
    fromId: string,
    toId: string,
    kind: TGraphEdge['kind'],
    text?: string
  ) => {
    const a = byId.get(fromId) as TGraphNode;
    const b = byId.get(toId) as TGraphNode;
    let d: string;
    let label: TGraphEdge['label'];
    if (kind === 'h') {
      const x1 = a.x + a.w;
      const y = a.y + 40;
      const x2 = b.x;
      d = `M${x1},${y} L${x2},${y}`;
      if (text) label = { x: (x1 + x2) / 2, y: y - 12, text };
    } else if (kind === 'down') {
      const x = a.x + a.w / 2 - 20;
      d = `M${x},${a.y + a.h} L${x},${b.y}`;
    } else {
      const x1 = a.x + a.w;
      const y1 = a.y + a.h / 2;
      const x2 = b.x + b.w / 2;
      const y2 = b.y + b.h;
      d = `M${x1},${y1} C${x2},${y1} ${x2},${y1} ${x2},${y2}`;
      if (text) label = { x: x2 + 30, y: (y1 + y2) / 2, text };
    }
    edges.push({ id: `${fromId}>${toId}`, kind, d, label });
  };

  const last = run.steps.length - 1;
  link('req', last >= 0 ? 's0' : 'res', 'h');
  run.steps.forEach((step, s) => {
    const stepId = nodeId({ kind: 'step', step: s });
    const toolIds = step.tools.map((_t, t) =>
      nodeId({ kind: 'tool', step: s, tool: t })
    );
    // The tools hang off one vertical spine under their step.
    toolIds.forEach((toolId, t) =>
      link(t === 0 ? stepId : toolIds[t - 1], toolId, 'down')
    );
    if (s === last) {
      link(stepId, 'res', 'h', run.outcome);
      return;
    }
    const nextId = nodeId({ kind: 'step', step: s + 1 });
    if (!toolIds.length) {
      link(stepId, nextId, 'h');
      return;
    }
    // Every tool's result feeds the next step; label the bundle once.
    toolIds.forEach((toolId, t) =>
      link(toolId, nextId, 'back', t === 0 ? 'result' : undefined)
    );
  });

  const width =
    Math.max(...nodes.map((node) => node.x + node.w)) + GRAPH.top * 2;
  const height = Math.max(...nodes.map((node) => node.y + node.h)) + 10;
  return { nodes, edges, width, height };
};

// ---------------------------------------------------------------------------
// Aggregates over the run.
// ---------------------------------------------------------------------------

export const toolMs = (step: TRunStep) =>
  step.tools.reduce((acc, tool) => acc + (tool.durationMs || 0), 0);

/** Time the model itself took in the step (the step minus its tools). */
export const llmMs = (step: TRunStep) =>
  Math.max((step.durationMs ?? 0) - toolMs(step), 0);

export const toolCalls = (run: TRun) =>
  run.steps.reduce((acc, step) => acc + step.tools.length, 0);

export const runSpanMs = (run: TRun): number => {
  if (run.durationMs) return run.durationMs;
  const start = Date.parse(run.startedAt);
  let end = run.finishedAt ? Date.parse(run.finishedAt) : start;
  for (const step of run.steps) {
    end = Math.max(end, Date.parse(step.startedAt) + (step.durationMs ?? 0));
  }
  return Math.max(end - start, 1);
};

export type TSplitKind = 'llm' | 'tool' | 'overhead' | 'in' | 'out' | 'cost';
export type TSplitSegment = {
  key: string;
  kind: TSplitKind;
  value: number;
  label: string;
  title: string;
};

export type TRunSplits = {
  time: TSplitSegment[];
  tokens: TSplitSegment[];
  /** Null when the run has no price: the bar is replaced by "no price". */
  cost: TSplitSegment[] | null;
};

/** "Where the time and the tokens went" bars under the graph. */
export const runSplits = (run: TRun): TRunSplits => {
  const time: TSplitSegment[] = [];
  if (run.overheadStartMs) {
    time.push({
      key: 'oh-start',
      kind: 'overhead',
      value: run.overheadStartMs,
      label: '',
      title: `overhead ${fmtMs(run.overheadStartMs)}`,
    });
  }
  run.steps.forEach((step, s) => {
    time.push({
      key: `s${s}`,
      kind: 'llm',
      value: llmMs(step),
      label: `step ${step.step} · ${fmtMs(step.durationMs)}`,
      title: `LLM step ${step.step} ${fmtMs(llmMs(step))}`,
    });
    step.tools.forEach((tool, t) => {
      if (!tool.durationMs) return;
      time.push({
        key: `t${s}-${t}`,
        kind: 'tool',
        value: tool.durationMs,
        label: '',
        title: `${tool.name} ${fmtMs(tool.durationMs)}`,
      });
    });
  });
  if (run.overheadEndMs) {
    time.push({
      key: 'oh-end',
      kind: 'overhead',
      value: run.overheadEndMs,
      label: '',
      title: `overhead ${fmtMs(run.overheadEndMs)}`,
    });
  }

  const tokens: TSplitSegment[] = [];
  run.steps.forEach((step, s) => {
    tokens.push({
      key: `in${s}`,
      kind: 'in',
      value: step.inputTokens ?? 0,
      label: `s${step.step} in ${fmtInt(step.inputTokens)}`,
      title: `step ${step.step} in ${fmtInt(step.inputTokens)}`,
    });
    tokens.push({
      key: `out${s}`,
      kind: 'out',
      value: step.outputTokens ?? 0,
      label: `out ${fmtInt(step.outputTokens)}`,
      title: `step ${step.step} out ${fmtInt(step.outputTokens)}`,
    });
  });

  const cost =
    run.cost === null || run.cost === undefined
      ? null
      : run.steps.map((step, s) => ({
          key: `c${s}`,
          kind: 'cost' as const,
          value: step.cost ?? 0,
          label: `s${step.step} ${fmtCost(step.cost)}`,
          title: `step ${step.step} ${fmtCost(step.cost)}`,
        }));

  return { time, tokens, cost };
};

// ---------------------------------------------------------------------------
// Waterfall (Run B).
// ---------------------------------------------------------------------------

export type TWaterfallRow = {
  id: string;
  ref: TNodeRef;
  startMs: number;
  durationMs: number;
  /** Tools are indented under their step. */
  indent: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
};

export const waterfallRows = (
  run: TRun
): { rows: TWaterfallRow[]; spanMs: number } => {
  const spanMs = runSpanMs(run);
  const t0 = Date.parse(run.startedAt);
  const rows: TWaterfallRow[] = [];
  const clamp = (ms: number) => Math.min(Math.max(ms, 0), spanMs);

  rows.push({
    id: 'req',
    ref: { kind: 'request' },
    startMs: 0,
    durationMs: run.overheadStartMs ?? 0,
    indent: false,
    inputTokens: null,
    outputTokens: null,
  });
  run.steps.forEach((step, s) => {
    const stepStart = clamp(Date.parse(step.startedAt) - t0);
    const stepDuration = step.durationMs ?? 0;
    rows.push({
      id: nodeId({ kind: 'step', step: s }),
      ref: { kind: 'step', step: s },
      startMs: stepStart,
      durationMs: stepDuration,
      indent: false,
      inputTokens: step.inputTokens ?? null,
      outputTokens: step.outputTokens ?? null,
    });
    step.tools.forEach((tool, t) => {
      // Older payloads carry no `startedAt`; the tool ran at the end of its
      // step, so place it there.
      const start = tool.startedAt
        ? Date.parse(tool.startedAt) - t0
        : stepStart + stepDuration - tool.durationMs;
      rows.push({
        id: nodeId({ kind: 'tool', step: s, tool: t }),
        ref: { kind: 'tool', step: s, tool: t },
        startMs: clamp(start),
        durationMs: tool.durationMs,
        indent: true,
        inputTokens: null,
        outputTokens: null,
      });
    });
  });
  const endOverhead = run.overheadEndMs ?? 0;
  rows.push({
    id: 'res',
    ref: { kind: 'response' },
    startMs: clamp(spanMs - endOverhead),
    durationMs: endOverhead,
    indent: false,
    inputTokens: null,
    outputTokens: null,
  });
  return { rows, spanMs };
};

/** Nice tick positions for an axis of `spanMs`. */
export const axisTicks = (spanMs: number, target = 5): number[] => {
  const raw = spanMs / target;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => m >= raw) ??
    10 * magnitude;
  const ticks: number[] = [];
  for (let v = 0; v <= spanMs; v += step) ticks.push(v);
  return ticks;
};

// ---------------------------------------------------------------------------
// Headline KPI that points at what deserves a look.
// ---------------------------------------------------------------------------

export type TAttention = {
  value: string;
  sub: string;
  tone: 'error' | 'warning' | 'ok';
};

export const runAttention = (run: TRun): TAttention => {
  if (run.error) {
    return { value: 'run failed', sub: run.error, tone: 'error' };
  }
  for (const step of run.steps) {
    const failed = step.tools.find((tool) => !tool.ok);
    if (failed) {
      return {
        value: `${failed.name} failed`,
        sub: `step ${step.step} · ${failed.summary}`,
        tone: 'error',
      };
    }
  }
  if (run.outcome === 'max-steps') {
    return {
      value: 'hit the step limit',
      sub: 'the model was still calling tools',
      tone: 'warning',
    };
  }
  for (const step of run.steps) {
    const empty = step.tools.find((tool) => tool.empty);
    if (empty) {
      return {
        value: `${empty.name} empty`,
        sub: `step ${step.step} · ${empty.summary}`,
        tone: 'warning',
      };
    }
  }
  if (run.truncated) {
    return {
      value: 'trimmed',
      sub: 'too large when recorded',
      tone: 'warning',
    };
  }
  return { value: 'nothing odd', sub: run.outcome, tone: 'ok' };
};
