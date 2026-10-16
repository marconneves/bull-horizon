import {
  axisTicks,
  defaultNodeId,
  layoutRunGraph,
  parseNodeId,
  runAttention,
  runSplits,
  waterfallRows,
  GRAPH,
} from '../model';
import type { TRun } from '../model';
import { DESIGN_RUN } from '../../../demo-mocks/network/agents/design-run';

const withSteps = (steps: TRun['steps'], extra: Partial<TRun> = {}): TRun => ({
  ...DESIGN_RUN,
  steps,
  ...extra,
});

describe('layoutRunGraph', () => {
  it('lays out the design run: request, 3 steps with their tools, response', () => {
    const { nodes, edges } = layoutRunGraph(DESIGN_RUN);
    expect(nodes.map((n) => n.id)).toEqual([
      'req',
      's0',
      't0-0',
      's1',
      't1-0',
      's2',
      'res',
    ]);
    expect(edges.map((e) => `${e.id}:${e.kind}`)).toEqual([
      'req>s0:h',
      's0>t0-0:down',
      't0-0>s1:back',
      's1>t1-0:down',
      't1-0>s2:back',
      's2>res:h',
    ]);
    // Outcome on the last edge, "result" on tool -> next step.
    expect(edges[5].label?.text).toBe('stop');
    expect(edges[2].label?.text).toBe('result');
    const res = nodes.find((n) => n.id === 'res');
    expect(res?.x).toBe(4 * GRAPH.colWidth);
  });

  it('stacks parallel tools under their step and labels the bundle once', () => {
    const [s0, s1] = DESIGN_RUN.steps;
    const tools = [s0.tools[0], { ...s0.tools[0], name: 'b' }, s1.tools[0]];
    const { nodes, edges } = layoutRunGraph(
      withSteps([{ ...s0, tools }, DESIGN_RUN.steps[2]])
    );
    const stacked = nodes.filter((n) => n.ref.kind === 'tool');
    expect(stacked.map((n) => n.x)).toEqual([
      GRAPH.colWidth,
      GRAPH.colWidth,
      GRAPH.colWidth,
    ]);
    expect(stacked[1].y).toBeGreaterThan(stacked[0].y + stacked[0].h);
    const back = edges.filter((e) => e.kind === 'back');
    expect(back).toHaveLength(3);
    expect(back.filter((e) => e.label)).toHaveLength(1);
  });

  it('links steps directly when a step called no tool, and handles no steps', () => {
    const s = DESIGN_RUN.steps[2];
    const { edges } = layoutRunGraph(withSteps([s, { ...s, step: 2 }]));
    expect(edges.map((e) => e.id)).toEqual(['req>s0', 's0>s1', 's1>res']);
    const empty = layoutRunGraph(withSteps([]));
    expect(empty.nodes.map((n) => n.id)).toEqual(['req', 'res']);
    expect(empty.edges.map((e) => e.id)).toEqual(['req>res']);
  });
});

describe('node ids', () => {
  it('round-trips and rejects ids that are not in the run', () => {
    expect(parseNodeId('t1-0', DESIGN_RUN)).toEqual({
      kind: 'tool',
      step: 1,
      tool: 0,
    });
    expect(parseNodeId('t9-0', DESIGN_RUN)).toBeNull();
    expect(parseNodeId('<script>', DESIGN_RUN)).toBeNull();
  });

  it('opens the panel on the first empty or failed tool', () => {
    expect(defaultNodeId(DESIGN_RUN)).toBe('t0-0');
  });
});

describe('runSplits', () => {
  it('splits time into overhead, LLM and tool, and hides cost without price', () => {
    const splits = runSplits(DESIGN_RUN);
    expect(splits.time.map((s) => s.kind)).toEqual([
      'overhead',
      'llm',
      'tool',
      'llm',
      'llm',
      'overhead',
    ]);
    // Step 1 is 4086ms of which 55ms was the tool.
    expect(splits.time[1].value).toBe(4031);
    expect(splits.tokens).toHaveLength(6);
    expect(splits.cost).toHaveLength(3);
    expect(runSplits({ ...DESIGN_RUN, cost: null }).cost).toBeNull();
  });
});

describe('waterfallRows', () => {
  it('places tools by startedAt and falls back to the end of the step', () => {
    const { rows, spanMs } = waterfallRows(DESIGN_RUN);
    expect(spanMs).toBe(14814);
    const tool = rows.find((r) => r.id === 't0-0');
    expect(tool?.startMs).toBe(4080);
    expect(tool?.indent).toBe(true);

    const [s0] = DESIGN_RUN.steps;
    const legacy = withSteps([
      { ...s0, tools: [{ ...s0.tools[0], startedAt: null }] },
    ]);
    const fallback = waterfallRows(legacy).rows.find((r) => r.id === 't0-0');
    expect(fallback?.startMs).toBe(53 + 4086 - 55);
  });

  it('builds round axis ticks', () => {
    expect(axisTicks(14814)).toEqual([0, 5000, 10000]);
    expect(axisTicks(900)).toEqual([0, 200, 400, 600, 800]);
  });
});

describe('runAttention', () => {
  it('points at the empty tool of the design run', () => {
    expect(runAttention(DESIGN_RUN)).toMatchObject({
      value: 'listRecipes empty',
      tone: 'warning',
    });
    expect(runAttention({ ...DESIGN_RUN, error: 'boom' }).tone).toBe('error');
  });
});
