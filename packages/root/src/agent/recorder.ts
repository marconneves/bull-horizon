import { AGENT_RUN_LOG_PREFIX, AGENT_RUN_VERSION } from './contract';
import { applyAgentRunDetail, normalizeAgentRunDetail } from './detail';
import {
  DEFAULT_AGENT_RUN_LIMITS,
  clip,
  clipId,
  safeJson,
  truncateValue,
  utf8Bytes,
} from './limits';
import { defaultIsEmpty, defaultSummarize } from './summarize';
import type {
  AgentQueueConfig,
  AgentRunCard,
  AgentRunDetail,
  AgentRunStep,
  AgentRunTool,
  AgentRunV1,
} from './contract';
import type { AgentRunLimits } from './limits';

/**
 * The bit of a job the helper uses. Bull and BullMQ jobs both satisfy it.
 * The optional members are only read to number the attempt (see
 * `defaultAgentRunAttempt`).
 */
export interface AgentRunJobLike {
  attemptsMade: number;
  log(row: string): Promise<unknown>;
  /** BullMQ 5+: attempts moved to active, this one included. */
  attemptsStarted?: number;
  /** BullMQ only (Bull v3 has `progress()` instead). */
  updateProgress?: unknown;
  /** A method on Bull v3, a number on BullMQ. */
  progress?: unknown;
}

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * 1-based number of the attempt running now, from the job alone.
 *
 * The libraries disagree on `attemptsMade` inside the processor:
 * - Bull v3 bumps it only when an attempt fails, so attempt N sees N - 1.
 * - BullMQ 1.x to 4.x bumps it when the job becomes active
 *   (`moveJobFromWaitToActive`), so attempt N already sees N.
 * - BullMQ 5+ only bumps it on failure again, and counts activations in
 *   `attemptsStarted`, so attempt N sees `attemptsStarted = N`.
 *
 * `attemptsStarted` wins when present; otherwise a BullMQ job (it has
 * `updateProgress()`, and `progress` is a number, not Bull's method) uses
 * `attemptsMade` as is, and anything else is treated as Bull.
 */
export function defaultAgentRunAttempt(job: AgentRunJobLike): number {
  const started = job?.attemptsStarted;
  if (finiteNumber(started) && started >= 1) return Math.floor(started);
  const made = job?.attemptsMade;
  if (!finiteNumber(made)) return 1;
  const bullmq =
    typeof job.updateProgress === 'function' &&
    typeof job.progress !== 'function';
  return Math.max(Math.floor(bullmq ? made : made + 1), 1);
}

/** Only finite, positive numbers override a default limit. */
function mergeLimits(overrides: unknown): AgentRunLimits {
  const limits: AgentRunLimits = { ...DEFAULT_AGENT_RUN_LIMITS };
  if (!overrides || typeof overrides !== 'object') return limits;
  for (const key of Object.keys(limits) as Array<keyof AgentRunLimits>) {
    const value = (overrides as Partial<AgentRunLimits>)[key];
    if (finiteNumber(value) && value > 0) limits[key] = value;
  }
  return limits;
}

export type AgentRunEvent =
  | { type: 'start'; run: AgentRunV1 }
  | { type: 'step-finish'; step: AgentRunStep; run: AgentRunV1 }
  | { type: 'tool'; step: number; tool: AgentRunTool; run: AgentRunV1 }
  | { type: 'finish'; run: AgentRunV1 }
  | { type: 'fail'; run: AgentRunV1 };

export interface CreateAgentRunOptions {
  job: AgentRunJobLike;
  model: string;
  /** Source of the level. An explicit `detail` wins. Default 'basic'. */
  agent?: AgentQueueConfig;
  detail?: AgentRunDetail;
  /**
   * Default: the attempt running now, from the job (Bull and BullMQ count
   * differently; see `defaultAgentRunAttempt`).
   */
  attempt?: number;
  input?: { conversationId?: string; text?: string };
  /** Summary of a tool output. Default is generic and content-free. */
  summarize?: (tool: string, output: unknown) => string;
  /** Tool answered with no result. */
  isEmpty?: (tool: string, output: unknown) => boolean;
  /** Synchronous hook per event. Errors are swallowed. */
  onEvent?: (event: AgentRunEvent) => void;
  /** Diagnostics for the helper's own failures. Never rethrown. */
  onError?: (err: unknown) => void;
  limits?: Partial<AgentRunLimits>;
  now?: () => Date;
}

export interface AgentRunRecorder {
  /**
   * Whole run (capped, NOT cut by level) for the app to keep wherever it
   * wants. Only the level cut ever reaches Redis.
   */
  readonly run: AgentRunV1;
  /** experimental_onStepStart. `stepNumber` is the SDK's 0-based index. */
  stepStart(stepNumber?: number): void;
  /** onStepFinish. */
  stepFinish(event: {
    stepNumber?: number;
    finishReason?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    text?: string;
  }): void;
  /** experimental_onToolCallFinish (already normalized). */
  tool(event: {
    stepNumber?: number;
    name: string;
    input: unknown;
    durationMs: number;
    success: boolean;
    output?: unknown;
    error?: unknown;
  }): void;
  /** Closes the run as a success and writes the line. Never rejects. */
  finish(text: string, cards?: AgentRunCard[]): Promise<void>;
  /** Closes the run as a failure and writes the line. Never rejects. */
  fail(err: unknown): Promise<void>;
  /**
   * Free-form line in the job log (plain text, fire-and-forget). NOT cut by
   * the detail level: written as-is in any level, clipped to `textChars`.
   * Never put sensitive content in a note.
   */
  note(line: string): void;
}

const tokens = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const errorText = (err: unknown): string => {
  try {
    if (err instanceof Error) return err.message;
    return String(err ?? 'error');
  } catch {
    return 'error';
  }
};

/**
 * Summary of a failed tool, safe at basic: the error class name from the
 * code (`failed: TypeError`), never the message nor a custom `name`, which
 * can carry content.
 */
const failedSummary = (err: unknown): string => {
  try {
    const name =
      err instanceof Error ? (err.constructor as { name?: unknown })?.name : '';
    return typeof name === 'string' && /^[A-Za-z_$][\w$]{0,59}$/.test(name)
      ? `failed: ${name}`
      : 'failed';
  } catch {
    return 'failed';
  }
};

/** Reads a value the app handed over; a throwing getter becomes `fallback`. */
const read = <T>(get: () => T, fallback: T): T => {
  try {
    return get();
  } catch {
    return fallback;
  }
};

/**
 * Last-resort line, built field by field from primitives only: the basic
 * skeleton without tools nor card titles. Used when the regular build throws
 * (e.g. the app mutated `recorder.run` into something unserializable), so a
 * finished attempt never ends up without a line.
 */
function skeletonAgentRunLine(run: AgentRunV1): string {
  const num = (get: () => unknown) => {
    const value = read(get, null);
    return finiteNumber(value) ? value : null;
  };
  const str = (get: () => unknown) => {
    const value = read(get, null);
    return typeof value === 'string' ? value : null;
  };
  const steps = read(() => (Array.isArray(run.steps) ? run.steps : []), []);
  const skeleton: AgentRunV1 = {
    v: AGENT_RUN_VERSION,
    detail: 'basic',
    model: str(() => run.model) ?? '',
    attempt: num(() => run.attempt) ?? 1,
    startedAt: str(() => run.startedAt) ?? new Date(0).toISOString(),
    finishedAt: str(() => run.finishedAt),
    durationMs: num(() => run.durationMs),
    inputTokens: num(() => run.inputTokens) ?? 0,
    outputTokens: num(() => run.outputTokens) ?? 0,
    steps: steps.map((s, i) => ({
      step: num(() => s.step) ?? i + 1,
      startedAt: str(() => s.startedAt) ?? new Date(0).toISOString(),
      durationMs: num(() => s.durationMs),
      finishReason: str(() => s.finishReason),
      inputTokens: num(() => s.inputTokens),
      outputTokens: num(() => s.outputTokens),
      tools: [],
    })),
    final: read(() => !!run.final, false) ? { cards: [] } : null,
    error: str(() => run.error),
    truncated: true,
  };
  return AGENT_RUN_LOG_PREFIX + JSON.stringify(skeleton);
}

/**
 * Line written to `job.log`: the run cut to `detail`, degraded until it fits
 * `limits.lineBytes`. Degradation order: tool outputs, tool inputs, texts,
 * then the basic skeleton (and, as a last resort, the skeleton without tools).
 */
export function formatAgentRunLine(
  run: AgentRunV1,
  detail: AgentRunDetail,
  limits: AgentRunLimits = DEFAULT_AGENT_RUN_LIMITS
): string {
  const toLine = (r: AgentRunV1) => AGENT_RUN_LOG_PREFIX + JSON.stringify(r);
  const fits = (line: string) => utf8Bytes(line) <= limits.lineBytes;

  const cut = applyAgentRunDetail(run, detail);
  let line = toLine(cut);
  if (fits(line)) return line;

  const tools = () => cut.steps.flatMap((s) => s.tools);
  const degradations: Array<() => void> = [
    () => tools().forEach((t) => delete t.output),
    () => tools().forEach((t) => delete t.input),
    () => {
      cut.steps.forEach((s) => delete s.text);
      tools().forEach((t) => delete t.error);
      if (cut.final) delete cut.final.text;
      if (cut.input) delete cut.input.text;
    },
  ];
  cut.truncated = true;
  for (const degrade of degradations) {
    degrade();
    line = toLine(cut);
    if (fits(line)) return line;
  }
  const skeleton: AgentRunV1 = {
    ...applyAgentRunDetail(run, 'basic'),
    truncated: true,
  };
  line = toLine(skeleton);
  if (fits(line)) return line;
  skeleton.steps.forEach((s) => (s.tools = []));
  return toLine(skeleton);
}

class Recorder implements AgentRunRecorder {
  public readonly run: AgentRunV1;
  private readonly _limits: AgentRunLimits;
  private readonly _detail: AgentRunDetail;
  private readonly _t0: number;
  private _closed = false;
  private _closing = false;

  constructor(private readonly _options: CreateAgentRunOptions) {
    this._limits = mergeLimits(_options.limits);
    this._detail = normalizeAgentRunDetail(
      _options.detail ?? _options.agent?.detail
    );
    const start = this._now();
    this._t0 = start.getTime();
    this.run = {
      v: AGENT_RUN_VERSION,
      // The in-memory run is never cut; the line written to Redis is.
      detail: 'full',
      model: clipId(_options.model),
      attempt: this._attempt(),
      startedAt: start.toISOString(),
      finishedAt: null,
      durationMs: null,
      inputTokens: 0,
      outputTokens: 0,
      steps: [],
      final: null,
      error: null,
    };
    const input = _options.input;
    if (input && typeof input === 'object') {
      const runInput: NonNullable<AgentRunV1['input']> = {};
      if (typeof input.conversationId === 'string') {
        runInput.conversationId = clipId(input.conversationId);
      }
      if (typeof input.text === 'string') {
        runInput.text = clip(input.text, this._limits.textChars);
      }
      this.run.input = runInput;
    }
    this._emit({ type: 'start', run: this.run });
  }

  public stepStart(stepNumber?: number): void {
    this._guard(() => this._ensureStep(stepNumber));
  }

  public stepFinish(event: {
    stepNumber?: number;
    finishReason?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    text?: string;
  }): void {
    this._guard(() => {
      const inputTokens = tokens(event?.usage?.inputTokens);
      const outputTokens = tokens(event?.usage?.outputTokens);
      // Totals stay right even when the step itself is over the cap.
      this.run.inputTokens += inputTokens ?? 0;
      this.run.outputTokens += outputTokens ?? 0;
      const step = this._ensureStep(event?.stepNumber);
      if (!step) return;
      step.durationMs =
        this._now().getTime() - new Date(step.startedAt).getTime();
      step.finishReason =
        typeof event?.finishReason === 'string'
          ? clipId(event.finishReason)
          : null;
      step.inputTokens = inputTokens;
      step.outputTokens = outputTokens;
      // No text = key omitted, not "" (contract: omitted, not blanked).
      if (typeof event?.text === 'string' && event.text !== '') {
        step.text = clip(event.text, this._limits.textChars);
      } else {
        delete step.text;
      }
      this._emit({ type: 'step-finish', step, run: this.run });
    });
  }

  public tool(event: {
    stepNumber?: number;
    name: string;
    input: unknown;
    durationMs: number;
    success: boolean;
    output?: unknown;
    error?: unknown;
  }): void {
    this._guard(() => {
      const step = this._ensureStep(event.stepNumber);
      if (!step || step.tools.length >= this._limits.toolsPerStep) return;
      const name = clipId(event.name);
      const success = event.success === true;
      const durationMs = Number.isFinite(event.durationMs)
        ? Math.max(Math.round(event.durationMs), 0)
        : 0;
      const entry: AgentRunTool = {
        name,
        ok: success,
        durationMs,
        summary: clip(
          success
            ? this._summarize(name, event.output)
            : failedSummary(event.error),
          this._limits.summaryChars
        ),
        startedAt: new Date(this._now().getTime() - durationMs).toISOString(),
        input: truncateValue(event.input ?? null, this._limits.toolInputChars),
      };
      if (success) {
        const empty = this._isEmpty(name, event.output);
        if (empty !== undefined) entry.empty = empty;
        entry.outputChars = safeJson(event.output ?? null).text.length;
        entry.output = truncateValue(
          event.output ?? null,
          this._limits.toolOutputChars
        );
      } else {
        entry.output = null;
        entry.error = clip(errorText(event.error), this._limits.toolErrorChars);
      }
      step.tools.push(entry);
      this._emit({ type: 'tool', step: step.step, tool: entry, run: this.run });
    });
  }

  public finish(text: string, cards: AgentRunCard[] = []): Promise<void> {
    return this._close(() => {
      const list = read(
        () => (Array.isArray(cards) ? cards.slice(0, this._limits.cards) : []),
        [] as AgentRunCard[]
      );
      this.run.final = {
        text: clip(
          typeof text === 'string' ? text : '',
          this._limits.textChars
        ),
        // Each field read on its own: one bad card (a throwing getter) costs
        // that field, not the run.
        cards: list.map((c) => ({
          type: read(() => clipId(c?.type), ''),
          title: clip(
            read(() => String(c?.title ?? ''), ''),
            this._limits.summaryChars
          ),
        })),
      };
      return { type: 'finish', run: this.run };
    });
  }

  public fail(err: unknown): Promise<void> {
    return this._close(() => {
      this.run.error = clip(errorText(err), this._limits.errorChars);
      return { type: 'fail', run: this.run };
    });
  }

  /**
   * Free text, written as-is at any detail level (the app owns its content),
   * only clipped to `textChars`.
   */
  public note(line: string): void {
    this._guard(() => {
      const row = clip(String(line), this._limits.textChars);
      // A note must never be mistaken for the run line.
      if (row.startsWith(AGENT_RUN_LOG_PREFIX)) return;
      void this._write(row);
    });
  }

  /**
   * Idempotent: the first finish/fail that produces a line closes and writes.
   * A failing step degrades the line instead of losing it: a throwing `build`
   * still writes what the run holds, and a throwing format falls back to the
   * skeleton. Only if no line at all can be built does the recorder stay
   * open, so a later finish/fail can still write.
   */
  private _close(build: () => AgentRunEvent): Promise<void> {
    if (this._closed || this._closing) return Promise.resolve();
    this._closing = true;
    try {
      const end = this._now();
      this.run.finishedAt = end.toISOString();
      this.run.durationMs = end.getTime() - this._t0;
      let event: AgentRunEvent | null = null;
      try {
        event = build();
      } catch (err) {
        this._report(err);
      }
      if (event) this._emit(event);
      const row = this._line();
      if (row === null) return Promise.resolve();
      this._closed = true;
      return this._write(row);
    } catch (err) {
      this._report(err);
      return Promise.resolve();
    } finally {
      this._closing = false;
    }
  }

  private _line(): string | null {
    try {
      return formatAgentRunLine(this.run, this._detail, this._limits);
    } catch (err) {
      this._report(err);
    }
    try {
      return skeletonAgentRunLine(this.run);
    } catch (err) {
      this._report(err);
      return null;
    }
  }

  /**
   * Resolves once `job.log` settles or `writeTimeoutMs` elapses, whichever
   * comes first. Never rejects: a Redis hiccup must not become a job failure
   * (for an agent, a retry is another paid LLM call).
   */
  private _write(row: string): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      try {
        timer = setTimeout(() => {
          this._report(new Error('agent run: job.log timed out'));
          resolve();
        }, this._limits.writeTimeoutMs);
        (timer as { unref?: () => void }).unref?.();
        Promise.resolve(this._options.job.log(row)).then(done, (err) => {
          this._report(err);
          done();
        });
      } catch (err) {
        this._report(err);
        done();
      }
    });
  }

  private _ensureStep(stepNumber?: number): AgentRunStep | null {
    const n = typeof stepNumber === 'number' ? stepNumber + 1 : null;
    const steps = this.run.steps;
    const last = steps[steps.length - 1];
    if (last && (n === null || last.step === n)) return last;
    if (n !== null) {
      const found = steps.find((s) => s.step === n);
      if (found) return found;
    }
    if (steps.length >= this._limits.steps) return null;
    const step: AgentRunStep = {
      step: n ?? steps.length + 1,
      startedAt: this._now().toISOString(),
      durationMs: null,
      finishReason: null,
      inputTokens: null,
      outputTokens: null,
      tools: [],
    };
    steps.push(step);
    return step;
  }

  private _attempt(): number {
    try {
      if (finiteNumber(this._options.attempt)) return this._options.attempt;
      return defaultAgentRunAttempt(this._options.job);
    } catch {
      return 1;
    }
  }

  private _summarize(name: string, output: unknown): string {
    try {
      const summarize = this._options.summarize ?? defaultSummarize;
      return String(summarize(name, output));
    } catch (err) {
      this._report(err);
      return '?';
    }
  }

  private _isEmpty(name: string, output: unknown): boolean | undefined {
    try {
      const isEmpty = this._options.isEmpty ?? defaultIsEmpty;
      const result = isEmpty(name, output);
      return typeof result === 'boolean' ? result : undefined;
    } catch (err) {
      this._report(err);
      return undefined;
    }
  }

  private _now(): Date {
    try {
      const now = this._options.now?.();
      if (now instanceof Date && !isNaN(now.getTime())) return now;
    } catch (err) {
      this._report(err);
    }
    return new Date();
  }

  private _emit(event: AgentRunEvent) {
    if (!this._options.onEvent) return;
    this._guard(() => this._options.onEvent?.(event));
  }

  private _guard(fn: () => void) {
    try {
      fn();
    } catch (err) {
      this._report(err);
    }
  }

  private _report(err: unknown) {
    try {
      this._options.onError?.(err);
    } catch {
      // Diagnostics must not throw either.
    }
  }
}

/** Fallback when even building the recorder fails: same surface, no effect. */
function noopRecorder(options: CreateAgentRunOptions): AgentRunRecorder {
  const run: AgentRunV1 = {
    v: AGENT_RUN_VERSION,
    detail: 'full',
    model: '',
    attempt: 1,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    inputTokens: 0,
    outputTokens: 0,
    steps: [],
    final: null,
    error: null,
  };
  try {
    run.model = clipId(options?.model);
  } catch {
    // keep the empty model
  }
  return {
    run,
    stepStart: () => undefined,
    stepFinish: () => undefined,
    tool: () => undefined,
    finish: () => Promise.resolve(),
    fail: () => Promise.resolve(),
    note: () => undefined,
  };
}

/**
 * Records one attempt of an agent job and writes it as a single structured
 * line to `job.log` on `finish`/`fail`. Never throws nor rejects, whatever
 * the job, the callbacks or Redis do.
 */
export function createAgentRun(
  options: CreateAgentRunOptions
): AgentRunRecorder {
  try {
    return new Recorder(options);
  } catch (err) {
    try {
      options?.onError?.(err);
    } catch {
      // ignore
    }
    return noopRecorder(options);
  }
}
