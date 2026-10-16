// The Flows screen's derivations, kept pure (relative imports, no React) so
// they are unit-testable from the root jest setup.
import {
  FlowEdgeKind,
  FlowStepKind,
  FlowTraceStatus,
  JobStatus,
} from '../../typings/gql';
import type {
  FlowTraceJobFieldsFragment,
  GetFlowSummaryQuery,
  GetFlowTraceQuery,
  GetFlowsQuery,
} from '../../typings/gql';
import { axisTicks } from '../agents/model';

export type TFlow = GetFlowsQuery['flows'][0];
export type TFlowStep = TFlow['steps'][0];
export type TFlowEdge = TFlow['edges'][0];
export type TFlowSummary = NonNullable<GetFlowSummaryQuery['flowSummary']>;
export type TStepStats = TFlowSummary['steps'][0];
export type TTraceResult = NonNullable<GetFlowTraceQuery['flowTrace']>;
export type TTrace = NonNullable<TTraceResult['trace']>;
export type TTraceJob = FlowTraceJobFieldsFragment;

/** "content:TranscriptionApi" -> "TranscriptionApi" when the flow's queues share the prefix. */
export const shortStepName = (id: string, prefix: string | null) =>
  prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id;

/** The `xxx:` prefix every step queue of the flow shares, if any. */
export const commonPrefix = (flow: TFlow): string | null => {
  const names = flow.steps
    .filter((s) => s.kind !== FlowStepKind.End)
    .map((s) => s.id);
  const prefixes = names.map((n) => {
    const idx = n.indexOf(':');
    return idx > 0 ? n.slice(0, idx + 1) : null;
  });
  const counts = new Map<string, number>();
  for (const p of prefixes) if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [p, c] of counts) {
    if (c > bestCount) {
      best = p;
      bestCount = c;
    }
  }
  // Only worth stripping when most steps share it.
  return best && bestCount * 2 > names.length ? best : null;
};

// ---------------------------------------------------------------------------
// Graph layout (option A of the Flow and Trace tabs).
// ---------------------------------------------------------------------------

export const FLOW_GRAPH = {
  nodeW: 188,
  nodeH: 74,
  endW: 150,
  endH: 56,
  colGap: 40,
  rowGap: 24,
  pad: 16,
};

export type TFlowNode = {
  id: string;
  kind: FlowStepKind;
  layer: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Only reached through a fallback edge (directly or downstream of one). */
  alt: boolean;
};

export type TFlowEdgeGeom = {
  from: string;
  to: string;
  kind: FlowEdgeKind;
  when: string | null;
  path: string;
  labelX: number;
  labelY: number;
  /** Closes a cycle (drawn, but ignored for the layering). */
  back: boolean;
};

export type TFlowLayout = {
  nodes: TFlowNode[];
  edges: TFlowEdgeGeom[];
  width: number;
  height: number;
};

const edgeKey = (from: string, to: string) => `${from}>${to}`;

/**
 * Layers by longest path from the entry (an `end` branch stays on its
 * source's row), columns by the parents' mean column, a fallback branch
 * shifted to the column beside its source, the error step in its own lane.
 * No graph library: same choice as the run graph of the Agents screen.
 */
export const layoutFlowGraph = (flow: TFlow): TFlowLayout => {
  const G = FLOW_GRAPH;
  const order = new Map(flow.steps.map((s, i) => [s.id, i]));
  const stepOf = new Map(flow.steps.map((s) => [s.id, s]));
  const isError = (id: string) =>
    stepOf.get(id)?.kind === FlowStepKind.Error || id === flow.onError;
  const main = flow.steps.filter((s) => !isError(s.id));
  const edges = flow.edges.filter(
    (e) =>
      stepOf.has(e.from) &&
      stepOf.has(e.to) &&
      !isError(e.from) &&
      !isError(e.to)
  );
  const out = new Map<string, TFlowEdge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);

  // Back edges: DFS from the entries, then from anything left.
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.to);
      if (s === 1) back.add(edgeKey(e.from, e.to));
      else if (!s) visit(e.to);
    }
    state.set(id, 2);
  };
  for (const id of flow.entry) if (stepOf.has(id) && !state.has(id)) visit(id);
  for (const s of main) if (!state.has(s.id)) visit(s.id);
  const forward = edges.filter((e) => !back.has(edgeKey(e.from, e.to)));
  const incoming = new Map<string, TFlowEdge[]>();
  for (const e of forward)
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), e]);

  // Topological order (Kahn), stable on config order.
  const indeg = new Map(main.map((s) => [s.id, 0]));
  for (const e of forward) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const ready = main.filter((s) => !indeg.get(s.id)).map((s) => s.id);
  const topo: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const id = ready.shift() as string;
    topo.push(id);
    for (const e of forward.filter((x) => x.from === id)) {
      const left = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, left);
      if (left === 0) ready.push(e.to);
    }
  }

  const layer = new Map<string, number>();
  const alt = new Map<string, boolean>();
  for (const id of topo) {
    const ins = incoming.get(id) ?? [];
    let l = 0;
    for (const e of ins) {
      const step = e.kind === FlowEdgeKind.End ? 0 : 1;
      l = Math.max(l, (layer.get(e.from) ?? 0) + step);
    }
    layer.set(id, l);
    alt.set(
      id,
      ins.length > 0 &&
        ins.every((e) => e.kind === FlowEdgeKind.Fallback || alt.get(e.from))
    );
  }

  // Columns, layer by layer: the target is the mean column of the parents
  // that are on the same kind of path; then the first free column from it.
  const col = new Map<string, number>();
  const used = new Map<number, Set<number>>();
  const take = (l: number, target: number) => {
    const set = used.get(l) ?? new Set<number>();
    let c = Math.max(0, Math.round(target));
    while (set.has(c)) c += 1;
    set.add(c);
    used.set(l, set);
    return c;
  };
  const maxLayer = Math.max(0, ...Array.from(layer.values()));
  const entries = flow.entry.filter((id) => layer.has(id));
  for (let l = 0; l <= maxLayer; l += 1) {
    const here = topo.filter((id) => layer.get(id) === l);
    const target = (id: string): number => {
      const entryIdx = entries.indexOf(id);
      if (entryIdx >= 0 && !(incoming.get(id) ?? []).length) return entryIdx;
      const ins = (incoming.get(id) ?? []).filter((e) => col.has(e.from));
      if (!ins.length) return 0;
      if (ins.some((e) => e.kind === FlowEdgeKind.End)) {
        const src = ins.find((e) => e.kind === FlowEdgeKind.End) as TFlowEdge;
        return (col.get(src.from) ?? 0) + 1;
      }
      const primary = alt.get(id)
        ? ins
        : ins.filter(
            (e) => !alt.get(e.from) && e.kind !== FlowEdgeKind.Fallback
          );
      const pick = primary.length ? primary : ins;
      const mean =
        pick.reduce(
          (sum, e) =>
            sum +
            (col.get(e.from) ?? 0) +
            (e.kind === FlowEdgeKind.Fallback ? 1 : 0),
          0
        ) / pick.length;
      return mean;
    };
    // Steps first (an end branch needs its source's column), main path
    // before fallback, then by target and config order.
    const isEnd = (id: string) => stepOf.get(id)?.kind === FlowStepKind.End;
    const sorted = [...here].sort(
      (a, b) =>
        Number(isEnd(a)) - Number(isEnd(b)) ||
        Number(!!alt.get(a)) - Number(!!alt.get(b)) ||
        (order.get(a) ?? 0) - (order.get(b) ?? 0)
    );
    for (const id of sorted) col.set(id, take(l, target(id)));
  }
  const maxCol = Math.max(0, ...Array.from(col.values()));

  const slotX = (c: number) => G.pad + c * (G.nodeW + G.colGap);
  const slotY = (l: number) => G.pad + l * (G.nodeH + G.rowGap);
  const nodes: TFlowNode[] = [];
  for (const id of topo) {
    const step = stepOf.get(id) as TFlowStep;
    const end = step.kind === FlowStepKind.End;
    const l = layer.get(id) ?? 0;
    const c = col.get(id) ?? 0;
    nodes.push({
      id,
      kind: step.kind,
      layer: l,
      col: c,
      x: slotX(c),
      y: slotY(l) + (end ? (G.nodeH - G.endH) / 2 : 0),
      w: end ? G.endW : G.nodeW,
      h: end ? G.endH : G.nodeH,
      alt: !!alt.get(id),
    });
  }
  // The error step sits outside the main path: in the first column once
  // nothing else uses it any more (so no edge runs under it), from mid
  // height down; else in a lane of its own on the right.
  const errors = flow.steps.filter((s) => isError(s.id));
  const lastInCol0 = Math.max(
    -1,
    ...nodes.filter((n) => n.col === 0).map((n) => n.layer)
  );
  const freeFrom = Math.max(lastInCol0 + 1, Math.ceil(maxLayer / 2));
  const inCol0 = freeFrom + errors.length - 1 <= maxLayer;
  errors.forEach((step, i) => {
    const l = inCol0 ? freeFrom + i : Math.floor(maxLayer / 2) + i;
    const c = inCol0 ? 0 : maxCol + 1;
    nodes.push({
      id: step.id,
      kind: FlowStepKind.Error,
      layer: l,
      col: c,
      x: slotX(c),
      y: slotY(l),
      w: G.nodeW,
      h: G.nodeH,
      alt: false,
    });
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const geoms: TFlowEdgeGeom[] = [];
  for (const e of flow.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    let path: string;
    let labelX: number;
    let labelY: number;
    if (a.layer === b.layer) {
      const right = b.x > a.x;
      const x1 = right ? a.x + a.w : a.x;
      const x2 = right ? b.x : b.x + b.w;
      const y1 = a.y + a.h / 2;
      const y2 = b.y + b.h / 2;
      const mx = (x1 + x2) / 2;
      path = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      labelX = mx;
      labelY = (y1 + y2) / 2 - 10;
    } else if (b.layer > a.layer) {
      const x1 = a.x + a.w / 2;
      const y1 = a.y + a.h;
      const x2 = b.x + b.w / 2;
      const y2 = b.y;
      const my = (y1 + y2) / 2;
      path = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
      labelX = (x1 + x2) / 2;
      labelY = my;
    } else {
      // A cycle back up: out of the right side, around, into the right side.
      const x1 = a.x + a.w;
      const y1 = a.y + a.h / 2;
      const x2 = b.x + b.w;
      const y2 = b.y + b.h / 2;
      const bulge = Math.max(x1, x2) + G.colGap / 2;
      path = `M${x1},${y1} C${bulge},${y1} ${bulge},${y2} ${x2},${y2}`;
      labelX = bulge - 8;
      labelY = (y1 + y2) / 2;
    }
    geoms.push({
      from: e.from,
      to: e.to,
      kind: e.kind,
      when: e.when ?? null,
      path,
      labelX,
      labelY,
      back: back.has(edgeKey(e.from, e.to)),
    });
  }

  const width = Math.max(...nodes.map((n) => n.x + n.w), G.nodeW) + G.pad;
  const height = Math.max(...nodes.map((n) => n.y + n.h), G.nodeH) + G.pad;
  return { nodes, edges: geoms, width, height };
};

// ---------------------------------------------------------------------------
// Indented table (option B): one row per step, in walking order.
// ---------------------------------------------------------------------------

export type TTableRow = { id: string; depth: number; kind: FlowStepKind };

/**
 * Pre-order walk from the entries. A step with one main child keeps its
 * depth on that child (a chain reads as a column); fan-out, fallback and
 * `end` children go one level in. A step with several parents waits for all
 * of them, so a merge comes after both branches, at the shallowest depth.
 */
export const flowTableRows = (flow: TFlow): TTableRow[] => {
  const stepOf = new Map(flow.steps.map((s) => [s.id, s]));
  const isError = (id: string) =>
    stepOf.get(id)?.kind === FlowStepKind.Error || id === flow.onError;
  const layout = layoutFlowGraph(flow);
  const backSet = new Set(
    layout.edges.filter((e) => e.back).map((e) => edgeKey(e.from, e.to))
  );
  const edges = flow.edges.filter(
    (e) =>
      stepOf.has(e.to) &&
      !isError(e.to) &&
      !isError(e.from) &&
      !backSet.has(edgeKey(e.from, e.to))
  );
  const parentsLeft = new Map<string, number>();
  for (const e of edges)
    parentsLeft.set(e.to, (parentsLeft.get(e.to) ?? 0) + 1);
  const depthSeen = new Map<string, number>();
  const rows: TTableRow[] = [];
  const done = new Set<string>();

  const visit = (id: string, depth: number) => {
    if (done.has(id)) return;
    done.add(id);
    rows.push({ id, depth, kind: (stepOf.get(id) as TFlowStep).kind });
    const children = edges.filter((e) => e.from === id);
    const main = children.filter(
      (e) => e.kind !== FlowEdgeKind.End && e.kind !== FlowEdgeKind.Fallback
    );
    // End branches right under their source.
    const sorted = [
      ...children.filter((e) => e.kind === FlowEdgeKind.End),
      ...children.filter((e) => e.kind !== FlowEdgeKind.End),
    ];
    for (const e of sorted) {
      const childDepth = main.length === 1 && main[0] === e ? depth : depth + 1;
      depthSeen.set(
        e.to,
        Math.min(depthSeen.get(e.to) ?? Infinity, childDepth)
      );
      const left = (parentsLeft.get(e.to) ?? 1) - 1;
      parentsLeft.set(e.to, left);
      if (left <= 0) visit(e.to, depthSeen.get(e.to) as number);
    }
  };
  for (const id of flow.entry) if (stepOf.has(id)) visit(id, 0);
  for (const s of flow.steps) {
    if (!done.has(s.id) && !isError(s.id)) visit(s.id, 0);
  }
  for (const s of flow.steps) if (!done.has(s.id)) visit(s.id, 0);
  return rows;
};

// ---------------------------------------------------------------------------
// Trace.
// ---------------------------------------------------------------------------

export type TTraceJobKind = 'ok' | 'failed' | 'fallback' | 'error' | 'pending';

/** How a job of the trace reads: pending, failed, the error step, fallback or ok. */
export const traceJobKind = (
  job: TTraceJob,
  flow: TFlow,
  altSteps: Set<string>
): TTraceJobKind => {
  if (job.pending) return 'pending';
  if (job.status === JobStatus.Failed) return 'failed';
  if (job.stepId === flow.onError) return 'error';
  if (job.fallback || altSteps.has(job.stepId)) return 'fallback';
  return 'ok';
};

export const TRACE_STATUS_LABEL: Record<FlowTraceStatus, string> = {
  [FlowTraceStatus.Running]: 'running',
  [FlowTraceStatus.Completed]: 'completed',
  [FlowTraceStatus.CompletedWithFallback]: 'completed via fallback',
  [FlowTraceStatus.Failed]: 'failed',
  [FlowTraceStatus.Unknown]: 'unknown',
};

/** Jobs in the order they were enqueued (stable on the server's order). */
export const traceJobsInOrder = (trace: TTrace): TTraceJob[] =>
  trace.jobs
    .map((job, i) => ({ job, i }))
    .sort((a, b) => a.job.enqueuedAt - b.job.enqueuedAt || a.i - b.i)
    .map(({ job }) => job);

export const traceJobKey = (job: Pick<TTraceJob, 'queueId' | 'jobId'>) =>
  `${job.queueId}/${job.jobId}`;

/** Steps and edges the trace went through, for the highlighted graph. */
export const traceHighlight = (trace: TTrace) => {
  const steps = new Set(trace.jobs.map((j) => j.stepId));
  const edges = new Set(
    trace.jobs
      .filter((j) => j.parentStepId)
      .map((j) => edgeKey(j.parentStepId as string, j.stepId))
  );
  return { steps, edges };
};
export const isTraceEdge = (
  highlight: ReturnType<typeof traceHighlight>,
  from: string,
  to: string
) => highlight.edges.has(edgeKey(from, to));

/** The last job of each step in the trace (a step can run more than once). */
export const traceJobByStep = (trace: TTrace): Map<string, TTraceJob> => {
  const map = new Map<string, TTraceJob>();
  for (const job of traceJobsInOrder(trace)) map.set(job.stepId, job);
  return map;
};

/**
 * The job's `_trace` (contract v1) as the worker wrote it, rebuilt from the
 * index: the trace does not carry job payloads.
 */
export const traceContract = (
  job: TTraceJob,
  trace: TTrace,
  flowId: string
): Record<string, unknown> => {
  const byKey = new Map(trace.jobs.map((j) => [traceJobKey(j), j]));
  let hop = 0;
  let cursor: TTraceJob | undefined = job;
  const seen = new Set<string>();
  while (cursor?.parentJobId && cursor.parentQueueId && hop < 64) {
    const key = traceJobKey({
      queueId: cursor.parentQueueId,
      jobId: cursor.parentJobId,
    });
    if (seen.has(key)) break;
    seen.add(key);
    hop += 1;
    cursor = byKey.get(key);
  }
  return {
    v: 1,
    traceId: trace.traceId,
    flow: flowId,
    ...(trace.key ? { key: trace.key } : {}),
    startedAt: trace.startedAt,
    ...(job.parentJobId
      ? {
          parent: {
            ...(job.parentStepId ? { queue: job.parentStepId } : {}),
            jobId: job.parentJobId,
          },
        }
      : {}),
    hop,
  };
};

export type TGanttBar = { left: number; width: number };
export type TGanttRow = {
  job: TTraceJob;
  wait: TGanttBar | null;
  proc: TGanttBar | null;
};
export type TGantt = {
  start: number;
  spanMs: number;
  rows: TGanttRow[];
  /** Ms offsets from `start`, with their percent position. */
  ticks: Array<{ ms: number; left: number }>;
};

const pct = (value: number, span: number) =>
  Math.max(0, Math.min(100, (value / span) * 100));

/**
 * Gantt geometry in percent of the trace span: queue wait from enqueue to
 * start, processing from start to finish. Pending jobs run to `now`.
 */
export const traceGantt = (trace: TTrace, now: number): TGantt => {
  const jobs = traceJobsInOrder(trace);
  const start = Math.min(trace.startedAt, ...jobs.map((j) => j.enqueuedAt));
  const ends = jobs.map(
    (j) => j.finishedAt ?? (j.pending ? now : j.startedAt ?? j.enqueuedAt)
  );
  const end = Math.max(trace.finishedAt ?? 0, ...ends, start + 1);
  const span = end - start;
  const rows = jobs.map((job, i) => {
    const enq = job.enqueuedAt - start;
    const begin =
      job.startedAt !== null && job.startedAt !== undefined
        ? job.startedAt - start
        : null;
    const finish = (ends[i] as number) - start;
    const waitEnd = begin ?? finish;
    return {
      job,
      wait:
        waitEnd > enq
          ? { left: pct(enq, span), width: pct(waitEnd - enq, span) }
          : null,
      proc:
        begin !== null
          ? {
              left: pct(begin, span),
              width: pct(Math.max(finish - begin, 0), span),
            }
          : null,
    };
  });
  const ticks = axisTicks(span, 5).map((ms) => ({ ms, left: pct(ms, span) }));
  return { start, spanMs: span, rows, ticks };
};

// ---------------------------------------------------------------------------
// Edge labels: never on top of a node.
// ---------------------------------------------------------------------------

/** Mono 10.5px: about 6.4px per char, plus the label's padding. */
export const LABEL_CHAR_W = 6.4;
export const LABEL_H = 15;
export const labelWidth = (text: string) => text.length * LABEL_CHAR_W + 8;

export type TLabelBox = { x: number; y: number; w: number; h: number };
export type TPlacedLabel = { key: string; text: string; x: number; y: number };

const overlaps = (a: TLabelBox, b: TLabelBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Moves each label (centered at x, y) off the nodes and the labels already
 * placed: first where the edge wants it, then into the row gap above or
 * below the edge's rows, then to either side. A gap narrower than the text
 * (an `end` branch right beside its source) pushes it above the row.
 */
export const placeEdgeLabels = (
  layout: Pick<TFlowLayout, 'nodes' | 'edges'>,
  labels: Array<{ key: string; from: string; to: string; text: string }>
): TPlacedLabel[] => {
  const nodeBox = new Map(
    layout.nodes.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }])
  );
  const edgeOf = new Map(layout.edges.map((e) => [edgeKey(e.from, e.to), e]));
  const taken: TLabelBox[] = [];
  const placed: TPlacedLabel[] = [];
  for (const label of labels) {
    const edge = edgeOf.get(edgeKey(label.from, label.to));
    const a = nodeBox.get(label.from);
    const b = nodeBox.get(label.to);
    if (!edge || !a || !b) continue;
    const w = labelWidth(label.text);
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y + a.h, b.y + b.h);
    const candidates: Array<[number, number]> = [
      [edge.labelX, edge.labelY],
      [edge.labelX, top - LABEL_H / 2 - 2],
      [edge.labelX, bottom + LABEL_H / 2 + 2],
      [edge.labelX + w / 2 + 6, edge.labelY],
      [edge.labelX - w / 2 - 6, edge.labelY],
    ];
    const box = ([x, y]: [number, number]): TLabelBox => ({
      x: x - w / 2,
      y: y - LABEL_H / 2,
      w,
      h: LABEL_H,
    });
    const free = (c: [number, number]) => {
      const bx = box(c);
      return (
        !Array.from(nodeBox.values()).some((n) => overlaps(bx, n)) &&
        !taken.some((t) => overlaps(bx, t))
      );
    };
    const [x, y] = candidates.find(free) ?? candidates[0];
    taken.push(box([x, y]));
    placed.push({ key: label.key, text: label.text, x, y });
  }
  return placed;
};

// ---------------------------------------------------------------------------
// The `_trace` block of a trace job: the real one when the job is there.
// ---------------------------------------------------------------------------

export const TRACE_FIELD = '_trace';

export type TTraceBlock =
  | { source: 'loading' }
  | { source: 'job'; value: unknown }
  | {
      source: 'index';
      reason: 'removed' | 'missing';
      value: Record<string, unknown>;
    };

/** `data._trace` of a job payload (JSON text), own property only; else null. */
export const readJobTrace = (
  data: string | null | undefined,
  field = TRACE_FIELD
): unknown => {
  if (!data) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.prototype.hasOwnProperty.call(parsed, field)
    ) {
      const value = (parsed as Record<string, unknown>)[field];
      return value && typeof value === 'object' ? value : null;
    }
  } catch (_e) {
    // Not JSON: no trace to show from the job.
  }
  return null;
};

/**
 * What the `_trace` block shows: the job's own `data._trace` when the job
 * still exists and carries it; the reconstruction from the trace index only
 * when the job was removed (or its payload has no readable trace).
 */
export const traceBlock = (
  job: TTraceJob,
  trace: TTrace,
  flowId: string,
  fetched:
    | { loading: true }
    | { loading: false; record: { data?: string | null } | null }
): TTraceBlock => {
  if (fetched.loading) return { source: 'loading' };
  if (fetched.record) {
    const value = readJobTrace(fetched.record.data);
    if (value) return { source: 'job', value };
  }
  return {
    source: 'index',
    reason: fetched.record ? 'missing' : 'removed',
    value: traceContract(job, trace, flowId),
  };
};
