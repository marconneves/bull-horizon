import {
  LABEL_H,
  labelWidth,
  layoutFlowGraph,
  placeEdgeLabels,
  readJobTrace,
  traceBlock,
} from '../model';
import type { TTrace, TTraceJob } from '../model';
import {
  CONTENT_FLOW,
  END_ID,
} from '../../../demo-mocks/network/flows/content-ingest';
import { FlowTraceStatus, JobStatus } from '../../../typings/gql';

const box = (l: { x: number; y: number; text: string }) => ({
  x: l.x - labelWidth(l.text) / 2,
  y: l.y - LABEL_H / 2,
  w: labelWidth(l.text),
  h: LABEL_H,
});
const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('placeEdgeLabels (m1)', () => {
  const layout = layoutFlowGraph(CONTENT_FLOW);
  const verify = 'content:VerifyIfVideoExists';
  const labels = CONTENT_FLOW.edges.map((e) => ({
    key: `${e.from}>${e.to}`,
    from: e.from,
    to: e.to,
    text: e.when ? `${e.when} · avg 9m40s` : 'avg 9m40s',
  }));
  const placed = placeEdgeLabels(layout, labels);

  it('never puts a label on a node, nor on another label', () => {
    expect(placed).toHaveLength(labels.length);
    placed.forEach((l, i) => {
      for (const n of layout.nodes) expect(overlaps(box(l), n)).toBe(false);
      placed
        .slice(0, i)
        .forEach((o) => expect(overlaps(box(l), box(o))).toBe(false));
    });
  });

  it('lifts the label of the end branch above the row when the gap is narrow', () => {
    const end = placed.find((l) => l.key === `${verify}>${END_ID}`);
    const src = layout.nodes.find((n) => n.id === verify);
    expect(end).toBeDefined();
    expect((end?.y ?? 0) + LABEL_H / 2).toBeLessThanOrEqual(src?.y ?? 0);
  });

  it('keeps a label that fits where the edge wants it', () => {
    const edge = layout.edges.find(
      (e) => e.from === verify && e.to === 'content:ExtractVideoInfo'
    );
    const l = placed.find(
      (p) => p.key === `${verify}>content:ExtractVideoInfo`
    );
    expect(l).toMatchObject({ x: edge?.labelX, y: edge?.labelY });
  });
});

const job: TTraceJob = {
  stepId: 'b',
  queueId: 'bull:b',
  jobId: '2',
  attempt: 1,
  status: JobStatus.Completed,
  parentQueueId: 'bull:a',
  parentJobId: '1',
  parentStepId: 'a',
  enqueuedAt: 1,
  startedAt: 2,
  finishedAt: 3,
  waitMs: 1,
  processMs: 1,
  failedReason: null,
  fallback: false,
  pending: false,
};
const trace: TTrace = {
  traceId: 'tr_1',
  key: null,
  startedAt: 1,
  finishedAt: 3,
  durationMs: 2,
  status: FlowTraceStatus.Completed,
  jobs: [job],
  longestWait: null,
  truncated: false,
  partial: false,
};
const real = {
  v: 1,
  traceId: 'tr_1',
  flow: 'f',
  startedAt: 1,
  parent: { queue: 'queue-a', jobId: '1', name: 'step-a', attempt: 2 },
  hop: 3,
};

describe('traceBlock (m2)', () => {
  it('shows the job’s own _trace when the job exists', () => {
    const block = traceBlock(job, trace, 'f', {
      loading: false,
      record: { data: JSON.stringify({ videoId: 'x', _trace: real }) },
    });
    expect(block).toEqual({ source: 'job', value: real });
  });

  it('reconstructs from the index only when the job was removed', () => {
    const block = traceBlock(job, trace, 'f', { loading: false, record: null });
    expect(block.source).toBe('index');
    expect(block).toMatchObject({
      reason: 'removed',
      value: { traceId: 'tr_1', hop: 1 },
    });
  });

  it('says when the job is there but carries no readable _trace', () => {
    const block = traceBlock(job, trace, 'f', {
      loading: false,
      record: { data: '{"videoId":"x"}' },
    });
    expect(block).toMatchObject({ source: 'index', reason: 'missing' });
  });

  it('waits while the job is loading', () => {
    expect(traceBlock(job, trace, 'f', { loading: true })).toEqual({
      source: 'loading',
    });
  });

  it('reads _trace defensively', () => {
    expect(readJobTrace('not json')).toBeNull();
    expect(readJobTrace('[1]')).toBeNull();
    expect(readJobTrace('{"_trace":"str"}')).toBeNull();
    expect(readJobTrace('{"__proto__":{"_trace":{"v":1}}}')).toBeNull();
    expect(readJobTrace(null)).toBeNull();
    expect(readJobTrace('{"_trace":{"v":1}}')).toEqual({ v: 1 });
  });
});
