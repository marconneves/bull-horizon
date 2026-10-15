// The conversation view's derivations, kept pure (relative, type-only
// imports) so they are unit-testable without the browser bundle.
import type {
  AgentRunToolLink,
  GetAgentConversationQuery,
} from '../../typings/gql';
import { fmtCost, fmtInt, fmtMs, plural } from './format';
import type { TRun } from './model';

export type TConversation = NonNullable<
  GetAgentConversationQuery['agentConversation']
>;
export type TMessage = TConversation['messages'][0];

/** `AgentRunDetail.Basic`, without importing the enum's runtime value. */
const isBasic = (run: TRun) => (run.detail as string) === 'basic';

/** When the message started: its own start, else its finish. */
export const messageStart = (message: TMessage): number =>
  message.startedAt ?? message.finishedAt;

/** The message picked in the List layout: the given job, else the newest. */
export const pickMessage = (
  messages: TMessage[],
  jobId: string | null
): TMessage | null =>
  (jobId ? messages.find((m) => m.jobId === jobId) : undefined) ??
  messages[messages.length - 1] ??
  null;

/** "2 steps · 8,120/640 tok · 9.2s · $0.0040" */
export const messageMeta = (message: TMessage): string =>
  `${plural(message.steps, 'step')} · ${fmtInt(message.inputTokens)}/${fmtInt(
    message.outputTokens
  )} tok · ${fmtMs(message.durationMs)} · ${fmtCost(message.cost)}`;

/** The tool chain of the message's run; null when the run is not there. */
export const messageToolLinks = (
  message: TMessage
): AgentRunToolLink[] | null =>
  message.run
    ? message.run.steps.flatMap((step) =>
        step.tools.map((tool) => ({
          name: tool.name,
          ok: tool.ok,
          empty: !!tool.empty,
        }))
      )
    : null;

export type TMessageText =
  | { kind: 'text'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'missing'; reason: string };

const missing = (reason: string): TMessageText => ({ kind: 'missing', reason });

const runMissing = (message: TMessage): TMessageText | null => {
  if (message.jobRemoved) {
    return missing('Job removed: only the runs index entry is left.');
  }
  if (!message.run) return missing('The run is no longer in the job logs.');
  return null;
};

/** What the user bubble shows: `input.text` is only recorded at full. */
export const userText = (message: TMessage): TMessageText => {
  const absent = runMissing(message);
  if (absent) return absent;
  const run = message.run as TRun;
  if (run.input?.text) return { kind: 'text', text: run.input.text };
  if (isBasic(run)) return missing('Not recorded at basic detail.');
  return missing('The input text is not in the run.');
};

/** What the assistant bubble shows: the error, else `final.text`. */
export const replyText = (message: TMessage): TMessageText => {
  const absent = runMissing(message);
  if (absent) return absent;
  const run = message.run as TRun;
  if (run.error) return { kind: 'error', text: run.error };
  if (run.final?.text) return { kind: 'text', text: run.final.text };
  if (isBasic(run)) return missing('Not recorded at basic detail.');
  return missing('No final text.');
};

// ---------------------------------------------------------------------------
// "Messages over time": one bar per message, the gaps are the user's turn.
// ---------------------------------------------------------------------------

export type TTimelineBar = {
  jobId: string;
  /** Percent of the axis. */
  left: number;
  width: number;
};

export type TTimeline = {
  start: number;
  end: number;
  bars: TTimelineBar[];
  /** Epoch ms of the axis labels, first and last included. */
  ticks: number[];
};

export const conversationTimeline = (
  messages: TMessage[],
  tickCount = 4
): TTimeline | null => {
  if (!messages.length) return null;
  const start = Math.min(...messages.map(messageStart));
  const end = Math.max(...messages.map((m) => m.finishedAt));
  const span = Math.max(end - start, 1);
  const bars = messages.map((message) => {
    const from = messageStart(message);
    const left = ((from - start) / span) * 100;
    return {
      jobId: message.jobId,
      left,
      width: Math.min(((message.finishedAt - from) / span) * 100, 100 - left),
    };
  });
  const ticks =
    tickCount < 2 || span <= 1
      ? [start]
      : Array.from(
          { length: tickCount },
          (_v, i) => start + (span * i) / (tickCount - 1)
        );
  return { start, end, bars, ticks };
};

// ---------------------------------------------------------------------------
// List layout: the selected message's flow, request to response.
// ---------------------------------------------------------------------------

export type TFlowRow = {
  key: string;
  kind: 'request' | 'step' | 'tool' | 'response';
  title: string;
  sub: string;
  tokens: string | null;
  /** 0..1 of the slowest step; null = no bar. */
  share: number | null;
  duration: string | null;
};

export const messageFlow = (run: TRun): TFlowRow[] => {
  const slowest = Math.max(1, ...run.steps.map((step) => step.durationMs ?? 0));
  const rows: TFlowRow[] = [
    {
      key: 'req',
      kind: 'request',
      title: 'request',
      sub: run.input?.conversationId
        ? `conversation ${run.input.conversationId}`
        : run.model,
      tokens: null,
      share: null,
      duration: null,
    },
  ];
  run.steps.forEach((step, s) => {
    rows.push({
      key: `s${s}`,
      kind: 'step',
      title: `LLM step ${step.step}`,
      sub: step.finishReason ?? '—',
      tokens: `${fmtInt(step.inputTokens)} · ${fmtInt(step.outputTokens)}`,
      share: (step.durationMs ?? 0) / slowest,
      duration: fmtMs(step.durationMs),
    });
    step.tools.forEach((tool, t) => {
      rows.push({
        key: `t${s}-${t}`,
        kind: 'tool',
        title: tool.name,
        sub: tool.summary,
        tokens: null,
        // Tools are short next to LLM steps: keep a sliver visible.
        share: Math.max(0.02, tool.durationMs / slowest),
        duration: fmtMs(tool.durationMs),
      });
    });
  });
  const cards = run.final?.cards ?? [];
  rows.push({
    key: 'res',
    kind: 'response',
    title: 'response',
    sub: run.error
      ? 'error'
      : cards.length
      ? `${plural(cards.length, 'card')} · ${cards[0].type}`
      : run.outcome,
    tokens: null,
    share: null,
    duration: null,
  });
  return rows;
};
