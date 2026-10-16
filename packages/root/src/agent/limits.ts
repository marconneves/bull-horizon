export interface AgentRunLimits {
  /** `tools[].output`, in JSON chars. Above it becomes `{ truncated, chars, preview }`. */
  toolOutputChars: number;
  /** `tools[].input`, same format as the output. */
  toolInputChars: number;
  /** `steps[].text`, `final.text`, `input.text`. */
  textChars: number;
  /** Run `error`. */
  errorChars: number;
  /** `tools[].error`. */
  toolErrorChars: number;
  /** `tools[].summary` and card titles. */
  summaryChars: number;
  steps: number;
  toolsPerStep: number;
  cards: number;
  /** Whole log line, in UTF-8 bytes. Above it the helper degrades the run. */
  lineBytes: number;
  /**
   * `finish`/`fail` resolve after this even if `job.log` never settles, so an
   * awaited recorder cannot hang the processor.
   */
  writeTimeoutMs: number;
}

export const DEFAULT_AGENT_RUN_LIMITS: AgentRunLimits = {
  toolOutputChars: 2048,
  toolInputChars: 2048,
  textChars: 4000,
  errorChars: 500,
  toolErrorChars: 200,
  summaryChars: 120,
  steps: 50,
  toolsPerStep: 50,
  cards: 20,
  lineBytes: 64 * 1024,
  writeTimeoutMs: 5000,
};

/**
 * Cap of identifiers that become keys and index fields: model, tool name,
 * finish reason, card type, conversation id, job name. Applied by the helper
 * on write and again by the monitor on read (the reader does not trust the
 * writer). Not configurable: the read side must agree with it.
 */
export const AGENT_RUN_ID_CHARS = 120;
/** Read-side cap of the app's short free texts (tool summary, card title). */
export const AGENT_RUN_LABEL_READ_CHARS = 240;

/**
 * Cuts an identifier to `max` chars, idempotent (a cut value is never cut
 * again into a different key). Non-strings become `String(value)`.
 */
export function clipId(value: unknown, max = AGENT_RUN_ID_CHARS): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : String(value ?? '');
  } catch {
    text = '';
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Cuts a text at the cap, marking the cut. */
export function clip(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}… (+${text.length - max})`
    : text;
}

/**
 * `JSON.stringify` that never throws. Circular references, BigInt and friends
 * fall back to `String(value)`, flagged so callers never store the original.
 */
export function safeJson(value: unknown): { text: string; ok: boolean } {
  try {
    const text = JSON.stringify(value);
    return { text: text ?? 'undefined', ok: text !== undefined };
  } catch {
    try {
      return { text: String(value), ok: false };
    } catch {
      return { text: '?', ok: false };
    }
  }
}

/**
 * A JSON copy of the value if it fits, else a truncated preview. Always a
 * copy, never the app's own object: the app keeps using it after handing it
 * over, and a later mutation (e.g. into a cycle) must not break the line.
 */
export function truncateValue(value: unknown, max: number): unknown {
  const { text, ok } = safeJson(value);
  if (!ok) {
    // Not serializable as-is: keep only the string form, never the object
    // (it would break the line's JSON.stringify later).
    return value === undefined ? null : clip(text, max);
  }
  if (text.length <= max) return JSON.parse(text);
  return { truncated: true, chars: text.length, preview: text.slice(0, max) };
}

export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
