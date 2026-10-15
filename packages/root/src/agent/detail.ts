import type {
  AgentRunCard,
  AgentRunDetail,
  AgentRunStep,
  AgentRunTool,
  AgentRunV1,
} from './contract';
import { AGENT_RUN_LABEL_READ_CHARS, clipId } from './limits';

/** Anything other than an explicit 'full' is 'basic': no default lands on full. */
export function normalizeAgentRunDetail(detail: unknown): AgentRunDetail {
  return detail === 'full' ? 'full' : 'basic';
}

/** Level a stored run carries. Absent = legacy payload, treated as 'full'. */
export function recordedAgentRunDetail(run: AgentRunV1): AgentRunDetail {
  return run.detail === 'basic' ? 'basic' : 'full';
}

// Identifiers and short labels are re-capped here, the whitelist every write
// and every read goes through: a forged or buggy line cannot blow up rollup
// keys, index entries or the API response.
const label = (text: string) => clipId(text, AGENT_RUN_LABEL_READ_CHARS);

const card = ({ type, title }: AgentRunCard): AgentRunCard => ({
  type: clipId(type),
  title: label(title),
});

function tool(source: AgentRunTool, full: boolean): AgentRunTool {
  const out: AgentRunTool = {
    name: clipId(source.name),
    ok: source.ok,
    durationMs: source.durationMs,
    summary: label(source.summary),
  };
  if (source.empty !== undefined) out.empty = source.empty;
  if (source.startedAt !== undefined) out.startedAt = source.startedAt;
  if (source.outputChars !== undefined) out.outputChars = source.outputChars;
  if (full) {
    if (source.input !== undefined) out.input = source.input;
    if (source.output !== undefined) out.output = source.output;
    if (source.error !== undefined) out.error = source.error;
  }
  return out;
}

function step(source: AgentRunStep, full: boolean): AgentRunStep {
  const out: AgentRunStep = {
    step: source.step,
    startedAt: source.startedAt,
    durationMs: source.durationMs,
    finishReason:
      source.finishReason == null ? null : clipId(source.finishReason),
    inputTokens: source.inputTokens,
    outputTokens: source.outputTokens,
    tools: (source.tools ?? []).map((t) => tool(t, full)),
  };
  // An empty text is omitted like a cut one (older lines carried `""`).
  if (full && typeof source.text === 'string' && source.text !== '') {
    out.text = source.text;
  }
  return out;
}

/**
 * Copy of the run holding only what `detail` allows. Built by whitelisting,
 * not by deleting: a field the contract does not know about never survives a
 * `basic` cut. Fields cut by the level are omitted (key absent), not blanked.
 */
export function applyAgentRunDetail(
  run: AgentRunV1,
  detail: AgentRunDetail
): AgentRunV1 {
  const full = normalizeAgentRunDetail(detail) === 'full';
  const out: AgentRunV1 = {
    v: 1,
    detail: full ? 'full' : 'basic',
    model: clipId(run.model),
    attempt: run.attempt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    steps: (run.steps ?? []).map((s) => step(s, full)),
    final: run.final
      ? {
          ...(full && run.final.text !== undefined
            ? { text: run.final.text }
            : {}),
          cards: (run.final.cards ?? []).map(card),
        }
      : null,
    error: run.error,
  };
  if (run.input) {
    const input: NonNullable<AgentRunV1['input']> = {};
    if (run.input.conversationId !== undefined) {
      input.conversationId = clipId(run.input.conversationId);
    }
    if (full && run.input.text !== undefined) input.text = run.input.text;
    if (Object.keys(input).length) out.input = input;
  }
  if (run.truncated) out.truncated = true;
  return out;
}
