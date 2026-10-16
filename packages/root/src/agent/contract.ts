/**
 * Contract v1 of an agent run: one structured line per attempt, appended to
 * `job.log` by the helper running inside the app's worker and read back by the
 * monitor. Superset of the `AiTrace` v1 the brand pilot already stores, so a
 * trace recorded today is a valid `AgentRunV1`.
 *
 * This module must stay dependency-free (no `gql/`, collector, main or
 * third-party imports): it runs in the consumer's process.
 */

export const AGENT_RUN_VERSION = 1;
/** Prefix of the log line that carries the run. Everything after it is JSON. */
export const AGENT_RUN_LOG_PREFIX = 'bull-horizon:agent-run ';
/**
 * Read-side ceiling, independent of the write-side one: a line above this is
 * ignored by the parser rather than parsed.
 */
export const AGENT_RUN_MAX_READ_CHARS = 512 * 1024;
/**
 * Prefix of the line that marks an attempt as deliberately skipped (the job
 * ended without calling the model). Not a run: the monitor counts it apart.
 */
export const AGENT_RUN_SKIP_LOG_PREFIX = 'bull-horizon:agent-run-skip ';
/** Read-side ceiling of a skip line (it only carries a short reason). */
const AGENT_RUN_SKIP_MAX_READ_CHARS = 4 * 1024;

/** Payload of a skip line. `reason` is a short id-like label, never content. */
export type AgentRunSkipV1 = {
  v: 1;
  attempt: number;
  reason?: string;
  /** ISO time the skip was recorded. */
  at: string;
};

export type AgentRunDetail = 'full' | 'basic';

export type AgentQueueConfig = {
  /**
   * Job names treated as runs. Omitted = every job of the queue.
   * E.g. a queue may carry `reply` (agent) and `translate` (not an agent).
   */
  jobs?: string[];
  /** Level recorded by the helper. Default 'basic'. */
  detail?: AgentRunDetail;
  /** Agent name on the Agents screen. Default: the queue name. */
  label?: string;
};

export interface AgentRunTool {
  name: string;
  ok: boolean;
  durationMs: number;
  /** Short, content-free summary (e.g. "8 results"). Always present. */
  summary: string;
  /** The tool answered without a useful result (empty list, null, {}). */
  empty?: boolean;
  /** ISO; computed by the helper as end - durationMs. */
  startedAt?: string;
  /** Length of the output JSON, in characters. Safe at basic. */
  outputChars?: number;
  /** full only. Tool input, truncated. */
  input?: unknown;
  /** full only. Tool output, or `{ truncated, chars, preview }` above the cap. */
  output?: unknown;
  /** full only. Tool error message, truncated. */
  error?: string;
}

export interface AgentRunStep {
  /** 1, 2, 3... */
  step: number;
  startedAt: string;
  durationMs: number | null;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** full only. Text the model wrote in the step, truncated. */
  text?: string;
  tools: AgentRunTool[];
}

export interface AgentRunCard {
  type: string;
  title: string;
}

export interface AgentRunV1 {
  v: 1;
  /** Level applied when recording. Absent = legacy payload, treated as 'full'. */
  detail?: AgentRunDetail;
  model: string;
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  steps: AgentRunStep[];
  /** Final answer. `text` only at full; `cards` (type + title) at both levels. */
  final: { text?: string; cards: AgentRunCard[] } | null;
  /** Attempt error, truncated to 500. Present at both levels. */
  error: string | null;
  /** Reserved for a conversation view. `text` only at full. */
  input?: { conversationId?: string; text?: string };
  /** The helper degraded the run to fit the line byte cap. */
  truncated?: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isNumberOrNull = (value: unknown) => value === null || isNumber(value);
const isStringOrNull = (value: unknown) =>
  value === null || typeof value === 'string';
const isOptional = (value: unknown, check: (v: unknown) => boolean) =>
  value === undefined || check(value);

const isTool = (value: unknown): boolean =>
  isObject(value) &&
  typeof value.name === 'string' &&
  typeof value.ok === 'boolean' &&
  isNumber(value.durationMs) &&
  typeof value.summary === 'string' &&
  isOptional(value.empty, (v) => typeof v === 'boolean') &&
  isOptional(value.startedAt, (v) => typeof v === 'string') &&
  isOptional(value.outputChars, isNumber) &&
  isOptional(value.error, (v) => typeof v === 'string');

const isStep = (value: unknown): boolean =>
  isObject(value) &&
  isNumber(value.step) &&
  typeof value.startedAt === 'string' &&
  isNumberOrNull(value.durationMs) &&
  isStringOrNull(value.finishReason) &&
  isNumberOrNull(value.inputTokens) &&
  isNumberOrNull(value.outputTokens) &&
  isOptional(value.text, (v) => typeof v === 'string') &&
  Array.isArray(value.tools) &&
  value.tools.every(isTool);

const isCard = (value: unknown): boolean =>
  isObject(value) &&
  typeof value.type === 'string' &&
  typeof value.title === 'string';

const isFinal = (value: unknown): boolean =>
  value === null ||
  (isObject(value) &&
    isOptional(value.text, (v) => typeof v === 'string') &&
    Array.isArray(value.cards) &&
    value.cards.every(isCard));

const isInput = (value: unknown): boolean =>
  isObject(value) &&
  isOptional(value.conversationId, (v) => typeof v === 'string') &&
  isOptional(value.text, (v) => typeof v === 'string');

/**
 * Shape guard. Every field the monitor reads is type-checked, so a malformed
 * (or spoofed) line is dropped instead of breaking a query downstream.
 */
export function isAgentRunV1(value: unknown): value is AgentRunV1 {
  return (
    isObject(value) &&
    value.v === AGENT_RUN_VERSION &&
    isOptional(value.detail, (v) => v === 'full' || v === 'basic') &&
    typeof value.model === 'string' &&
    isNumber(value.attempt) &&
    typeof value.startedAt === 'string' &&
    isStringOrNull(value.finishedAt) &&
    isNumberOrNull(value.durationMs) &&
    isNumber(value.inputTokens) &&
    isNumber(value.outputTokens) &&
    Array.isArray(value.steps) &&
    value.steps.every(isStep) &&
    isFinal(value.final) &&
    isStringOrNull(value.error) &&
    isOptional(value.input, isInput) &&
    isOptional(value.truncated, (v) => typeof v === 'boolean')
  );
}

/** Skip marker carried by a log line, or `null` for any other line. Never throws. */
export function parseAgentRunSkipLine(line: unknown): AgentRunSkipV1 | null {
  if (typeof line !== 'string') return null;
  if (!line.startsWith(AGENT_RUN_SKIP_LOG_PREFIX)) return null;
  if (line.length > AGENT_RUN_SKIP_MAX_READ_CHARS) return null;
  try {
    const value: unknown = JSON.parse(
      line.slice(AGENT_RUN_SKIP_LOG_PREFIX.length)
    );
    if (
      isObject(value) &&
      value.v === AGENT_RUN_VERSION &&
      isNumber(value.attempt) &&
      typeof value.at === 'string' &&
      isOptional(value.reason, (v) => typeof v === 'string')
    ) {
      return value as AgentRunSkipV1;
    }
    return null;
  } catch {
    return null;
  }
}

/** Run carried by a log line, or `null` for any other line. Never throws. */
export function parseAgentRunLine(line: unknown): AgentRunV1 | null {
  if (typeof line !== 'string') return null;
  if (!line.startsWith(AGENT_RUN_LOG_PREFIX)) return null;
  if (line.length > AGENT_RUN_MAX_READ_CHARS) return null;
  try {
    const value: unknown = JSON.parse(line.slice(AGENT_RUN_LOG_PREFIX.length));
    return isAgentRunV1(value) ? value : null;
  } catch {
    return null;
  }
}
