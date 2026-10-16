/**
 * Flow trace contract, v1. A trace is one execution of a flow: its id is born
 * at the entry and copied from parent job to child job in `data._trace`,
 * written once at enqueue time and never rewritten.
 *
 * This module runs inside the consumer's worker: no imports from gql/,
 * the collector or third-party libraries, and nothing here throws.
 */

export const FLOW_TRACE_FIELD = '_trace';
export const FLOW_TRACE_VERSION = 1;
/** Depth cap: a re-enqueue loop does not become an endless trace. */
export const FLOW_MAX_HOP = 64;
/** Accepted trace ids (the default is `tr_` + 16 hex). */
export const FLOW_TRACE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Accepted flow ids. */
export const FLOW_ID_PATTERN = /^[a-z0-9_.:-]{1,64}$/;
/** Business key value, parent queue/job/name: chars kept. */
export const FLOW_KEY_MAX_CHARS = 128;
export const FLOW_REF_MAX_CHARS = 128;
/** `encodeTrace` output cap. */
export const FLOW_ENCODED_MAX_CHARS = 512;

export type FlowTraceParentRef = {
  /** Parent's queue name (absent in a sandbox without `queue`). */
  queue?: string;
  jobId: string;
  /** Parent's job name (resolves the step in a queue with several jobs). */
  name?: string;
  /** Parent attempt that enqueued this job (a parent retry = duplicate child). */
  attempt?: number;
};

export type FlowTraceV1 = {
  v: 1;
  /** One execution of the flow. Born at the entry, copied parent to child. */
  traceId: string;
  /** Flow id in the monitor config. */
  flow: string;
  /** Business key value (e.g. videoId), String(). Optional. */
  key?: string;
  /** ms epoch when the entry was enqueued. Base of the end-to-end time. */
  startedAt: number;
  /** Absent at the entry (unless it came from a job of another flow). */
  parent?: FlowTraceParentRef;
  /** Depth from the entry. Capped at `FLOW_MAX_HOP`. */
  hop: number;
};

/**
 * Structural: a Bull job, a BullMQ job or the object a sandboxed processor
 * receives. Only these members are read.
 */
export type FlowTraceParent = {
  id?: string | number | null;
  name?: string;
  data?: unknown;
  /** Bull. */
  queue?: { name?: string } | unknown;
  /** BullMQ. */
  queueName?: string;
  attemptsMade?: number;
  /** BullMQ 5. */
  attemptsStarted?: number;
  /** BullMQ marker (same heuristic as the agent helper). */
  updateProgress?: unknown;
  progress?: unknown;
};

/** Next step: a step id (unconditional) or an edge with its label/kind. */
export type FlowNext =
  | string
  | {
      /** Next step. */
      to?: string;
      /** Or: terminal branch with a label ("only updates numbers"). */
      end?: string;
      /** Condition label (display only). */
      when?: string;
      /** Default 'next'. */
      kind?: 'next' | 'fallback' | 'sidecar';
    };

export type FlowStepConfig = {
  /** Queue name (`Queue.name`). Default: the step key. */
  queue?: string;
  /** Only these job names are the step. Omitted = every job of the queue. */
  jobs?: string[];
  label?: string;
  description?: string;
  /** Execution condition of the step (display only). */
  when?: string;
  next?: FlowNext | FlowNext[];
};

export type FlowTraceConfig = {
  /** Payload field carrying the trace. Default `_trace`. */
  field?: string;
  /** Dotted path in `job.data` of the business key, e.g. 'videoId'. */
  key?: string;
  /** Key label in the UI. Default: last segment of `key`. */
  keyLabel?: string;
  /** Extra dotted paths in `job.data` indexed as keys of the same trace. Up to 8. */
  aliases?: string[];
};

export type FlowConfig = {
  /** `[a-z0-9-_.:]`, up to 64. */
  id: string;
  label?: string;
  /** Sidebar group that gets the FLOW badge. Default: the single group shared by the flow's queues. */
  group?: string;
  entry: string | string[];
  /** Error step (ON ERROR node). */
  onError?: string;
  /** Steps whose completion closes the trace. Default: steps without `next` (but `onError`) + `end` branches. */
  complete?: string[];
  trace?: FlowTraceConfig;
  steps: Record<string, FlowStepConfig>;
};

export type FlowsOptions = {
  /** Traces kept in the index per flow. Default 2000. */
  recentTraces?: number;
  /** Jobs kept per trace. Default 300. */
  jobsPerTrace?: number;
  /** Jobs read per queue when looking for pending steps. Default 500. */
  pendingScanLimit?: number;
};

export const DEFAULT_FLOWS_OPTIONS: Required<FlowsOptions> = {
  recentTraces: 2000,
  jobsPerTrace: 300,
  pendingScanLimit: 500,
};

const positiveInt = (value: unknown, fallback: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.min(Math.floor(value), max)
    : fallback;

/** Defaults applied; anything that is not a positive number is ignored. */
export function normalizeFlowsOptions(
  options: unknown
): Required<FlowsOptions> {
  const raw = (
    options && typeof options === 'object' ? options : {}
  ) as FlowsOptions;
  return {
    recentTraces: positiveInt(
      raw.recentTraces,
      DEFAULT_FLOWS_OPTIONS.recentTraces,
      1000000
    ),
    jobsPerTrace: positiveInt(
      raw.jobsPerTrace,
      DEFAULT_FLOWS_OPTIONS.jobsPerTrace,
      10000
    ),
    pendingScanLimit: positiveInt(
      raw.pendingScanLimit,
      DEFAULT_FLOWS_OPTIONS.pendingScanLimit,
      10000
    ),
  };
}

export const hasOwn = (value: unknown, key: string): boolean =>
  !!value &&
  typeof value === 'object' &&
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Cuts a text to `max` chars, idempotent. NUL is removed: it is the index
 * separator. Non-strings become `String(value)`; never throws.
 */
export function clipText(value: unknown, max: number): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : String(value ?? '');
  } catch {
    text = '';
  }
  // eslint-disable-next-line no-control-regex
  if (text.includes('\u0000')) text = text.replace(/\u0000/g, '');
  return text.length > max ? text.slice(0, max) : text;
}

/** String or finite number -> clipped string; anything else -> undefined. */
export function clipRef(
  value: unknown,
  max = FLOW_REF_MAX_CHARS
): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clipText(String(value), max);
  }
  if (typeof value !== 'string') return undefined;
  const text = clipText(value, max);
  return text ? text : undefined;
}

const finiteInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.floor(value)
    : undefined;

/** Path segments that never resolve, wherever they come from. */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
export const MAX_PATH_SEGMENTS = 8;

/** Whether a dotted path is safe to follow (no prototype segments, 1..8 parts). */
export function isSafePath(path: unknown): path is string {
  if (typeof path !== 'string' || !path || path.length > 128) return false;
  const parts = path.split('.');
  return (
    parts.length <= MAX_PATH_SEGMENTS &&
    parts.every((part) => part.length > 0 && !UNSAFE_SEGMENTS.has(part))
  );
}

/**
 * Value at a dotted path, own properties only (arrays by index: `ids.0`).
 * Rejects `__proto__`/`prototype`/`constructor` segments. Never throws.
 */
export function readPath(value: unknown, path: string): unknown {
  try {
    if (!isSafePath(path)) return undefined;
    let current: unknown = value;
    for (const part of path.split('.')) {
      if (!current || typeof current !== 'object') return undefined;
      if (!Object.prototype.hasOwnProperty.call(current, part)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  } catch {
    return undefined;
  }
}

/** Accepted payload field name for the trace. */
export function isValidTraceField(field: unknown): field is string {
  return (
    typeof field === 'string' &&
    /^[A-Za-z0-9_$-]{1,64}$/.test(field) &&
    !UNSAFE_SEGMENTS.has(field)
  );
}

function parseParent(value: unknown): FlowTraceParentRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const jobId = hasOwn(raw, 'jobId') ? clipRef(raw.jobId) : undefined;
  if (!jobId) return undefined;
  const parent: FlowTraceParentRef = { jobId };
  const queue = hasOwn(raw, 'queue') ? clipRef(raw.queue) : undefined;
  if (queue && typeof raw.queue === 'string') parent.queue = queue;
  const name = hasOwn(raw, 'name') ? clipRef(raw.name) : undefined;
  if (name && typeof raw.name === 'string') parent.name = name;
  const attempt = hasOwn(raw, 'attempt') ? finiteInt(raw.attempt) : undefined;
  if (attempt !== undefined && attempt >= 1) parent.attempt = attempt;
  return parent;
}

/**
 * Defensive read of a trace written by someone else (a worker, or a string
 * that crossed an HTTP hop). Own properties only, every field type-checked,
 * strings clipped, invalid trace id or `hop > FLOW_MAX_HOP` = no trace.
 * Returns a fresh object with the known fields only. Never throws.
 */
export function parseTrace(value: unknown): FlowTraceV1 | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const raw = value as Record<string, unknown>;
    if (!hasOwn(raw, 'v') || raw.v !== FLOW_TRACE_VERSION) return undefined;
    const traceId = hasOwn(raw, 'traceId') ? raw.traceId : undefined;
    if (typeof traceId !== 'string' || !FLOW_TRACE_ID_PATTERN.test(traceId)) {
      return undefined;
    }
    const flow = hasOwn(raw, 'flow') ? raw.flow : undefined;
    if (typeof flow !== 'string' || !FLOW_ID_PATTERN.test(flow)) {
      return undefined;
    }
    const startedAt = hasOwn(raw, 'startedAt')
      ? finiteInt(raw.startedAt)
      : undefined;
    if (startedAt === undefined || startedAt < 0) return undefined;
    const hop = hasOwn(raw, 'hop') ? finiteInt(raw.hop) : undefined;
    if (hop === undefined || hop < 0 || hop > FLOW_MAX_HOP) return undefined;
    const trace: FlowTraceV1 = {
      v: FLOW_TRACE_VERSION,
      traceId,
      flow,
      startedAt,
      hop,
    };
    const key = hasOwn(raw, 'key')
      ? clipRef(raw.key, FLOW_KEY_MAX_CHARS)
      : undefined;
    if (key) trace.key = key;
    const parent = hasOwn(raw, 'parent') ? parseParent(raw.parent) : undefined;
    if (parent) trace.parent = parent;
    return trace;
  } catch {
    return undefined;
  }
}
