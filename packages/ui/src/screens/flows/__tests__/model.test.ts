import {
  FLOW_GRAPH,
  commonPrefix,
  flowTableRows,
  isTraceEdge,
  layoutFlowGraph,
  shortStepName,
  traceContract,
  traceGantt,
  traceHighlight,
  traceJobKind,
  traceJobsInOrder,
} from '../model';
import type { TFlow, TTrace, TTraceJob } from '../model';
import {
  CONTENT_FLOW,
  END_ID,
} from '../../../demo-mocks/network/flows/content-ingest';
import {
  FlowEdgeKind,
  FlowStepKind,
  FlowTraceStatus,
  JobStatus,
} from '../../../typings/gql';

const step = (id: string, kind = FlowStepKind.Step) => ({
  id,
  kind,
  label: id,
  description: null,
  when: null,
  queue: kind === FlowStepKind.End ? null : id,
  queueId: kind === FlowStepKind.End ? null : `bull:${id}`,
  jobs: null,
  sharedQueue: false,
});
const edge = (from: string, to: string, kind = FlowEdgeKind.Next) => ({
  from,
  to,
  kind,
  when: null,
  declared: true,
});
const flowOf = (extra: Partial<TFlow>): TFlow => ({
  id: 'f',
  label: 'f',
  group: null,
  keyLabel: null,
  entry: ['a'],
  complete: [],
  onError: null,
  definition: '',
  checks: [],
  steps: [],
  edges: [],
  ...extra,
});
const at = (layout: ReturnType<typeof layoutFlowGraph>, id: string) =>
  layout.nodes.find((n) => n.id === id) as (typeof layout.nodes)[0];

describe('layoutFlowGraph', () => {
  const layout = layoutFlowGraph(CONTENT_FLOW);

  it('layers by longest path, an end branch beside its source', () => {
    expect(at(layout, 'content:VerifyIfVideoExists').layer).toBe(0);
    expect(at(layout, END_ID)).toMatchObject({ layer: 0, col: 1 });
    expect(at(layout, 'content:ExtractVideoInfo').layer).toBe(1);
    // The merge sits below the longer (fallback) branch.
    expect(at(layout, 'content:TranslateTranscription').layer).toBe(
      at(layout, 'contentSaveTranscription').layer + 1
    );
  });

  it('fans out side by side and keeps the main path in its column', () => {
    const fan = [
      'content:IndexComments',
      'content:IndexVideoSearch',
      'content:SelectCategory',
    ].map((id) => at(layout, id));
    expect(new Set(fan.map((n) => n.layer)).size).toBe(1);
    expect(fan.map((n) => n.col)).toEqual([0, 1, 2]);
    expect(at(layout, 'content:TranslateTranscription').col).toBe(
      at(layout, 'content:TranscriptionApi').col
    );
  });

  it('shifts the fallback branch to the next column and marks it', () => {
    const main = at(layout, 'content:TranscriptionApi');
    const fallback = at(layout, 'content:DownloadVideo');
    expect(fallback).toMatchObject({
      layer: main.layer,
      col: main.col + 1,
      alt: true,
    });
    expect(at(layout, 'content:TranscribeAudio').alt).toBe(true);
    expect(at(layout, 'content:TranslateTranscription').alt).toBe(false);
  });

  it('puts the error step where the first column is free, no overlap', () => {
    const error = at(layout, 'content:SaveErrorState');
    const lastInCol0 = Math.max(
      ...layout.nodes
        .filter((n) => n !== error && n.col === 0)
        .map((n) => n.layer)
    );
    expect(error.col).toBe(0);
    expect(error.layer).toBeGreaterThan(lastInCol0);
    // Without a free first column it gets a lane of its own.
    const busy = layoutFlowGraph(
      flowOf({
        onError: 'e',
        steps: [step('a'), step('b'), step('e', FlowStepKind.Error)],
        edges: [edge('a', 'b')],
      })
    );
    expect(at(busy, 'e').col).toBe(1);
    const slots = layout.nodes.map((n) => `${n.layer}:${n.col}`);
    expect(new Set(slots).size).toBe(slots.length);
    for (const n of layout.nodes) {
      expect(n.x + n.w).toBeLessThanOrEqual(layout.width);
      expect(n.y + n.h).toBeLessThanOrEqual(layout.height);
    }
    expect(at(layout, END_ID).w).toBe(FLOW_GRAPH.endW);
  });

  it('draws every edge and survives a cycle', () => {
    expect(layout.edges).toHaveLength(CONTENT_FLOW.edges.length);
    const cyclic = flowOf({
      steps: ['a', 'b', 'c'].map((id) => step(id)),
      edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    });
    const l = layoutFlowGraph(cyclic);
    expect(l.nodes.map((n) => n.layer)).toEqual([0, 1, 2]);
    expect(l.edges.find((e) => e.from === 'c')?.back).toBe(true);
  });
});

describe('flowTableRows', () => {
  it('walks in order with chain, fan-out and merge depths', () => {
    const rows = flowTableRows(CONTENT_FLOW);
    const depth = (id: string) => rows.find((r) => r.id === id)?.depth;
    const index = (id: string) => rows.findIndex((r) => r.id === id);
    expect(rows).toHaveLength(CONTENT_FLOW.steps.length);
    expect(depth('content:VerifyIfVideoExists')).toBe(0);
    expect(depth(END_ID)).toBe(1);
    expect(depth('content:ExtractVideoInfo')).toBe(0);
    expect(depth('content:IndexComments')).toBe(1);
    expect(depth('content:DownloadVideo')).toBe(2);
    // The merge comes after both branches, at the shallowest depth.
    expect(index('content:TranslateTranscription')).toBeGreaterThan(
      index('contentSaveTranscription')
    );
    expect(depth('content:TranslateTranscription')).toBe(1);
    expect(rows[rows.length - 1].id).toBe('content:SaveErrorState');
  });
});

describe('names', () => {
  it('strips the shared prefix only', () => {
    expect(commonPrefix(CONTENT_FLOW)).toBe('content:');
    expect(shortStepName('content:SetupAuthor', 'content:')).toBe(
      'SetupAuthor'
    );
    expect(shortStepName('contentSaveTranscription', 'content:')).toBe(
      'contentSaveTranscription'
    );
    expect(commonPrefix(flowOf({ steps: [step('a'), step('b')] }))).toBeNull();
  });
});

const job = (extra: Partial<TTraceJob>): TTraceJob => ({
  stepId: 'a',
  queueId: 'bull:a',
  jobId: '1',
  attempt: 1,
  status: JobStatus.Completed,
  parentQueueId: null,
  parentJobId: null,
  parentStepId: null,
  enqueuedAt: 1000,
  startedAt: 2000,
  finishedAt: 3000,
  waitMs: 1000,
  processMs: 1000,
  failedReason: null,
  fallback: false,
  pending: false,
  ...extra,
});
const traceOf = (jobs: TTraceJob[], extra: Partial<TTrace> = {}): TTrace => ({
  traceId: 'tr_1',
  key: 'k1',
  startedAt: 1000,
  finishedAt: 5000,
  durationMs: 4000,
  status: FlowTraceStatus.Completed,
  jobs,
  longestWait: null,
  truncated: false,
  partial: false,
  ...extra,
});

describe('trace', () => {
  const a = job({ stepId: 'a', jobId: '1' });
  const b = job({
    stepId: 'b',
    queueId: 'bull:b',
    jobId: '2',
    parentStepId: 'a',
    parentQueueId: 'bull:a',
    parentJobId: '1',
    enqueuedAt: 3000,
    startedAt: 4000,
    finishedAt: 5000,
  });

  it('orders jobs by enqueue time', () => {
    expect(traceJobsInOrder(traceOf([b, a])).map((j) => j.jobId)).toEqual([
      '1',
      '2',
    ]);
  });

  it('classifies jobs', () => {
    const flow = flowOf({ onError: 'err' });
    const alt = new Set(['alt']);
    expect(traceJobKind(a, flow, alt)).toBe('ok');
    expect(traceJobKind(job({ pending: true }), flow, alt)).toBe('pending');
    expect(traceJobKind(job({ status: JobStatus.Failed }), flow, alt)).toBe(
      'failed'
    );
    expect(traceJobKind(job({ stepId: 'err' }), flow, alt)).toBe('error');
    expect(traceJobKind(job({ stepId: 'alt' }), flow, alt)).toBe('fallback');
    expect(traceJobKind(job({ fallback: true }), flow, alt)).toBe('fallback');
  });

  it('lights the edges the trace went through', () => {
    const h = traceHighlight(traceOf([a, b]));
    expect(isTraceEdge(h, 'a', 'b')).toBe(true);
    expect(isTraceEdge(h, 'b', 'a')).toBe(false);
    expect(h.steps.has('b')).toBe(true);
  });

  it('rebuilds the _trace v1 of a job with its hop', () => {
    const t = traceOf([a, b]);
    expect(traceContract(b, t, 'f')).toEqual({
      v: 1,
      traceId: 'tr_1',
      flow: 'f',
      key: 'k1',
      startedAt: 1000,
      parent: { queue: 'a', jobId: '1' },
      hop: 1,
    });
    expect(traceContract(a, t, 'f')).not.toHaveProperty('parent');
  });

  it('places wait and processing on the trace span', () => {
    const g = traceGantt(traceOf([a, b]), 10_000);
    expect(g.start).toBe(1000);
    expect(g.spanMs).toBe(4000);
    expect(g.rows[0].wait).toEqual({ left: 0, width: 25 });
    expect(g.rows[0].proc).toEqual({ left: 25, width: 25 });
    expect(g.rows[1].wait).toEqual({ left: 50, width: 25 });
    expect(g.rows[1].proc).toEqual({ left: 75, width: 25 });
    expect(g.ticks[0]).toEqual({ ms: 0, left: 0 });
  });

  it('runs pending jobs to now', () => {
    const waiting = job({
      jobId: '3',
      pending: true,
      startedAt: null,
      finishedAt: null,
      waitMs: null,
      processMs: null,
      enqueuedAt: 3000,
    });
    const g = traceGantt(traceOf([a, waiting], { finishedAt: null }), 5000);
    expect(g.spanMs).toBe(4000);
    expect(g.rows[1].wait).toEqual({ left: 50, width: 50 });
    expect(g.rows[1].proc).toBeNull();
  });
});
