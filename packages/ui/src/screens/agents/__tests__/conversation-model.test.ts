import {
  conversationTimeline,
  messageFlow,
  messageMeta,
  messageToolLinks,
  pickMessage,
  replyText,
  userText,
} from '../conversation-model';
import type { TMessage } from '../conversation-model';
import type { TRun } from '../model';
import { DESIGN_RUN } from '../../../demo-mocks/network/agents/design-run';
import { AgentRunDetail } from '../../../typings/gql';

const message = (extra: Partial<TMessage> = {}): TMessage => ({
  jobId: 'fa1809e7',
  attempt: 1,
  startedAt: 10_000,
  finishedAt: 24_814,
  durationMs: 14_814,
  model: 'gemini-3.8-flash',
  inputTokens: 9534,
  outputTokens: 1057,
  cost: 0.0055,
  outcome: 'stop',
  steps: 3,
  run: DESIGN_RUN,
  jobRemoved: false,
  ...extra,
});

const basicRun: TRun = {
  ...DESIGN_RUN,
  detail: AgentRunDetail.Basic,
  input: { conversationId: 'c-7f21', text: null },
  final: { text: null, cards: DESIGN_RUN.final?.cards ?? [] },
};

describe('userText / replyText', () => {
  it('shows the recorded texts at full detail', () => {
    expect(userText(message())).toEqual({
      kind: 'text',
      text: 'Pode sugerir uma receita?',
    });
    expect(replyText(message()).kind).toBe('text');
  });

  it('says "not recorded at basic detail" at basic', () => {
    const basic = message({ run: basicRun });
    expect(userText(basic)).toEqual({
      kind: 'missing',
      reason: 'Not recorded at basic detail.',
    });
    expect(replyText(basic)).toEqual({
      kind: 'missing',
      reason: 'Not recorded at basic detail.',
    });
  });

  it('shows the error instead of the reply', () => {
    const failed = message({ run: { ...DESIGN_RUN, error: 'boom' } });
    expect(replyText(failed)).toEqual({ kind: 'error', text: 'boom' });
  });

  it('explains a removed job and a run gone from the logs', () => {
    expect(userText(message({ run: null, jobRemoved: true }))).toEqual({
      kind: 'missing',
      reason: 'Job removed: only the runs index entry is left.',
    });
    expect(replyText(message({ run: null }))).toEqual({
      kind: 'missing',
      reason: 'The run is no longer in the job logs.',
    });
  });
});

describe('messageToolLinks / messageMeta', () => {
  it('chains the tools of every step, or null without a run', () => {
    const links = messageToolLinks(message()) ?? [];
    expect(links.length).toBe(
      DESIGN_RUN.steps.reduce((n, s) => n + s.tools.length, 0)
    );
    expect(links.every((l) => typeof l.empty === 'boolean')).toBe(true);
    expect(messageToolLinks(message({ run: null }))).toBeNull();
  });

  it('pluralizes and never shows a missing price as $0', () => {
    expect(messageMeta(message({ steps: 1, cost: null }))).toBe(
      '1 step · 9,534/1,057 tok · 14.8s · no price'
    );
  });
});

describe('pickMessage', () => {
  const list = [message({ jobId: 'a' }), message({ jobId: 'b' })];
  it('picks the given job, else the newest', () => {
    expect(pickMessage(list, 'a')?.jobId).toBe('a');
    expect(pickMessage(list, 'gone')?.jobId).toBe('b');
    expect(pickMessage(list, null)?.jobId).toBe('b');
    expect(pickMessage([], null)).toBeNull();
  });
});

describe('conversationTimeline', () => {
  it('places bars on the conversation span, gaps included', () => {
    const timeline = conversationTimeline([
      message({ jobId: 'a', startedAt: 0, finishedAt: 10_000 }),
      message({ jobId: 'b', startedAt: 30_000, finishedAt: 40_000 }),
    ]);
    expect(timeline?.start).toBe(0);
    expect(timeline?.end).toBe(40_000);
    expect(timeline?.bars).toEqual([
      { jobId: 'a', left: 0, width: 25 },
      { jobId: 'b', left: 75, width: 25 },
    ]);
    expect(timeline?.ticks).toHaveLength(4);
  });

  it('falls back to the finish when the start is unknown', () => {
    const timeline = conversationTimeline([
      message({ jobId: 'a', startedAt: null, finishedAt: 5_000 }),
    ]);
    expect(timeline?.bars[0]).toEqual({ jobId: 'a', left: 0, width: 0 });
  });

  it('is null without messages', () => {
    expect(conversationTimeline([])).toBeNull();
  });
});

describe('messageFlow', () => {
  it('goes request, steps with their tools, response', () => {
    const rows = messageFlow(DESIGN_RUN);
    expect(rows[0].kind).toBe('request');
    expect(rows[rows.length - 1].kind).toBe('response');
    expect(rows.filter((r) => r.kind === 'step')).toHaveLength(
      DESIGN_RUN.steps.length
    );
    expect(rows.filter((r) => r.kind === 'tool')).toHaveLength(
      DESIGN_RUN.steps.reduce((n, s) => n + s.tools.length, 0)
    );
    // The slowest step fills its bar; tools keep a visible sliver.
    expect(Math.max(...rows.map((r) => r.share ?? 0))).toBe(1);
    expect(
      rows.filter((r) => r.kind === 'tool').every((r) => (r.share ?? 0) > 0)
    ).toBe(true);
    expect(rows[rows.length - 1].sub).toBe('1 card · RECIPE');
  });
});
