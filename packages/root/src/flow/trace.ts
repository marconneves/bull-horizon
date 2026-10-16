import { randomBytes } from 'crypto';
import { currentAttempt, finiteNumber } from '../shared/attempt';
import {
  FLOW_ENCODED_MAX_CHARS,
  FLOW_ID_PATTERN,
  FLOW_KEY_MAX_CHARS,
  FLOW_MAX_HOP,
  FLOW_TRACE_FIELD,
  FLOW_TRACE_ID_PATTERN,
  FLOW_TRACE_VERSION,
  clipRef,
  hasOwn,
  isValidTraceField,
  parseTrace,
} from './contract';
import type {
  FlowTraceParent,
  FlowTraceParentRef,
  FlowTraceV1,
} from './contract';

/*
 * Helpers the consumer calls inside its worker / producers. Pure and
 * synchronous: no Redis, no I/O. They never throw: any problem returns the
 * caller's `data` untouched and goes to the optional `onError` (itself
 * guarded). A tracing failure must never become a job failure or a retry.
 */

export type StartTraceOptions = {
  flow: string;
  /** Business key value. Omitted: the monitor reads `trace.key` from the data. */
  key?: string | number;
  /** Reuse an external id (request id, OTel). Must match `[A-Za-z0-9_.:-]{1,64}`. */
  traceId?: string;
  /** Job that originated this entry in another flow (planner page -> video). */
  parent?: FlowTraceParent;
  field?: string;
  now?: number;
  onError?: (err: unknown) => void;
};

export type WithTraceOptions = {
  /** Required only when the parent carries no trace (a new one is opened). */
  flow?: string;
  /** Overrides the inherited key. */
  key?: string | number;
  field?: string;
  onError?: (err: unknown) => void;
};

export type ContinueTraceOptions = {
  /** Queue name of the job that sent the trace, when the sender did not know it. */
  parentQueue?: string;
  field?: string;
  onError?: (err: unknown) => void;
};

/** `tr_` + 16 hex chars. */
export function newTraceId(): string {
  try {
    return `tr_${randomBytes(8).toString('hex')}`;
  } catch {
    // No crypto (exotic sandbox): still unique enough for observability.
    const rand = () =>
      Math.floor(Math.random() * 0x100000000)
        .toString(16)
        .padStart(8, '0');
    return `tr_${rand()}${rand()}`;
  }
}

function report(onError: unknown, message: string, cause?: unknown) {
  if (typeof onError !== 'function') return;
  try {
    const err = new Error(`[bull-horizon] ${message}`);
    if (cause !== undefined) {
      Object.defineProperty(err, 'cause', { value: cause, enumerable: false });
    }
    onError(err);
  } catch {
    // The diagnostic hook itself must not break the job either.
  }
}

const isDataObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function fieldOf(field: unknown, onError: unknown): string {
  if (field === undefined) return FLOW_TRACE_FIELD;
  if (isValidTraceField(field)) return field;
  report(onError, `invalid trace field, using "${FLOW_TRACE_FIELD}"`);
  return FLOW_TRACE_FIELD;
}

function keyOf(value: unknown): string | undefined {
  return clipRef(value, FLOW_KEY_MAX_CHARS);
}

/** Copy of `data` with the trace in `field`. Never mutates `data`. */
// eslint-disable-next-line @typescript-eslint/ban-types -- any payload object (interfaces included)
function attach<T extends object>(
  data: T,
  field: string,
  trace: FlowTraceV1
): T {
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  // defineProperty: an own data property whatever the field name.
  Object.defineProperty(out, field, {
    value: trace,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return out as T;
}

/**
 * The parent reference of a job: queue name (Bull `queue.name`, BullMQ
 * `queueName`), id, name and the attempt running now (Bull and BullMQ count
 * differently, see `shared/attempt.ts`). Undefined without a usable id.
 */
export function parentRefOf(
  job: FlowTraceParent | null | undefined
): FlowTraceParentRef | undefined {
  if (!job || typeof job !== 'object') return undefined;
  const jobId = clipRef(job.id);
  if (!jobId) return undefined;
  const ref: FlowTraceParentRef = { jobId };
  const bullQueue = job.queue as { name?: unknown } | undefined;
  const queueName =
    bullQueue &&
    typeof bullQueue === 'object' &&
    typeof bullQueue.name === 'string'
      ? bullQueue.name
      : typeof job.queueName === 'string'
      ? job.queueName
      : undefined;
  const queue = clipRef(queueName);
  if (queue) ref.queue = queue;
  const name = typeof job.name === 'string' ? clipRef(job.name) : undefined;
  if (name) ref.name = name;
  if (finiteNumber(job.attemptsMade) || finiteNumber(job.attemptsStarted)) {
    ref.attempt = currentAttempt(job);
  }
  return ref;
}

/**
 * The trace of a job or of a payload. Undefined when absent or invalid.
 * A job is recognized by an own `data` object without the field itself.
 */
export function readTrace(
  jobOrData: unknown,
  field: string = FLOW_TRACE_FIELD
): FlowTraceV1 | undefined {
  try {
    if (!isDataObject(jobOrData)) return undefined;
    const name = isValidTraceField(field) ? field : FLOW_TRACE_FIELD;
    if (hasOwn(jobOrData, name)) return parseTrace(jobOrData[name]);
    const data = hasOwn(jobOrData, 'data') ? jobOrData.data : undefined;
    if (isDataObject(data) && hasOwn(data, name)) {
      return parseTrace(data[name]);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opens a trace at the entry of a flow (HTTP, cron, event, first queue).
 * `parent` links it to the job of another flow that originated it: a new
 * trace (hop 0) that remembers where it came from.
 */
// eslint-disable-next-line @typescript-eslint/ban-types -- any payload object (interfaces included)
export function startTrace<T extends object>(
  data: T,
  options: StartTraceOptions
): T {
  const onError = options?.onError;
  try {
    if (!isDataObject(data)) {
      report(onError, 'startTrace: data is not an object');
      return data;
    }
    const field = fieldOf(options?.field, onError);
    const flow = options?.flow;
    if (typeof flow !== 'string' || !FLOW_ID_PATTERN.test(flow)) {
      report(onError, 'startTrace: invalid flow id');
      return data;
    }
    let traceId = options.traceId;
    if (
      traceId !== undefined &&
      (typeof traceId !== 'string' || !FLOW_TRACE_ID_PATTERN.test(traceId))
    ) {
      report(onError, 'startTrace: invalid traceId, generating one');
      traceId = undefined;
    }
    const trace: FlowTraceV1 = {
      v: FLOW_TRACE_VERSION,
      traceId: traceId ?? newTraceId(),
      flow,
      startedAt: finiteNumber(options.now)
        ? Math.floor(options.now)
        : Date.now(),
      hop: 0,
    };
    const key = keyOf(options.key);
    if (key) trace.key = key;
    const parent = parentRefOf(options.parent);
    if (parent) trace.parent = parent;
    return attach(data, field, trace);
  } catch (e) {
    report(onError, 'startTrace failed', e);
    return data;
  }
}

/**
 * Child data carrying the parent's trace:
 * `queue.add(name, withTrace(job, { videoId }))`.
 * Copies only the known trace fields (never the rest of the parent payload).
 * A parent without a trace opens a new one when `options.flow` is given.
 */
// eslint-disable-next-line @typescript-eslint/ban-types -- any payload object (interfaces included)
export function withTrace<T extends object>(
  parent: FlowTraceParent,
  data: T,
  options?: WithTraceOptions
): T {
  const onError = options?.onError;
  try {
    if (!isDataObject(data)) {
      report(onError, 'withTrace: data is not an object');
      return data;
    }
    const field = fieldOf(options?.field, onError);
    const parentTrace = readTrace(parent, field);
    const ref = parentRefOf(parent);
    const override = keyOf(options?.key);
    if (parentTrace) {
      if (parentTrace.hop >= FLOW_MAX_HOP) {
        report(onError, `withTrace: hop limit (${FLOW_MAX_HOP}) reached`);
        return data;
      }
      const trace: FlowTraceV1 = {
        v: FLOW_TRACE_VERSION,
        traceId: parentTrace.traceId,
        flow: parentTrace.flow,
        startedAt: parentTrace.startedAt,
        hop: parentTrace.hop + 1,
      };
      const key = override ?? parentTrace.key;
      if (key) trace.key = key;
      if (ref) trace.parent = ref;
      return attach(data, field, trace);
    }
    const flow = options?.flow;
    if (typeof flow !== 'string' || !FLOW_ID_PATTERN.test(flow)) {
      report(
        onError,
        'withTrace: parent has no trace and no valid flow was given'
      );
      return data;
    }
    // The trace starts here; `parent` still shows the edge it came through.
    const trace: FlowTraceV1 = {
      v: FLOW_TRACE_VERSION,
      traceId: newTraceId(),
      flow,
      startedAt: Date.now(),
      hop: 0,
    };
    if (override) trace.key = override;
    if (ref) trace.parent = ref;
    return attach(data, field, trace);
  } catch (e) {
    report(onError, 'withTrace failed', e);
    return data;
  }
}

const toBase64Url = (text: string) =>
  Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * The job's trace serialized to cross an external hop (URL, header, payload
 * of a third-party callback). base64url, at most 512 chars. Carries the
 * trace plus the job itself as the parent. Undefined without a trace.
 */
export function encodeTrace(
  job: FlowTraceParent,
  field?: string
): string | undefined {
  try {
    const trace = readTrace(job, field ?? FLOW_TRACE_FIELD);
    if (!trace) return undefined;
    const payload: FlowTraceV1 = {
      v: FLOW_TRACE_VERSION,
      traceId: trace.traceId,
      flow: trace.flow,
      startedAt: trace.startedAt,
      hop: trace.hop,
    };
    if (trace.key) payload.key = trace.key;
    const ref = parentRefOf(job);
    if (ref) payload.parent = ref;
    const encoded = toBase64Url(JSON.stringify(payload));
    return encoded.length <= FLOW_ENCODED_MAX_CHARS ? encoded : undefined;
  } catch {
    return undefined;
  }
}

/**
 * At the receiver (webhook): data of the next job continuing the trace that
 * came from outside. Validated as untrusted input; invalid = data without a
 * trace (and `onError`). Not signed on purpose: observability, not auth.
 */
// eslint-disable-next-line @typescript-eslint/ban-types -- any payload object (interfaces included)
export function continueTrace<T extends object>(
  encoded: unknown,
  data: T,
  options?: ContinueTraceOptions
): T {
  const onError = options?.onError;
  try {
    if (!isDataObject(data)) {
      report(onError, 'continueTrace: data is not an object');
      return data;
    }
    const field = fieldOf(options?.field, onError);
    if (
      typeof encoded !== 'string' ||
      !encoded ||
      encoded.length > FLOW_ENCODED_MAX_CHARS ||
      !/^[A-Za-z0-9_-]+$/.test(encoded)
    ) {
      report(onError, 'continueTrace: invalid encoded trace');
      return data;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    } catch {
      decoded = undefined;
    }
    const received = parseTrace(decoded);
    if (!received) {
      report(onError, 'continueTrace: invalid encoded trace');
      return data;
    }
    if (received.hop >= FLOW_MAX_HOP) {
      report(onError, `continueTrace: hop limit (${FLOW_MAX_HOP}) reached`);
      return data;
    }
    const trace: FlowTraceV1 = {
      v: FLOW_TRACE_VERSION,
      traceId: received.traceId,
      flow: received.flow,
      startedAt: received.startedAt,
      hop: received.hop + 1,
    };
    if (received.key) trace.key = received.key;
    const parent = received.parent ? { ...received.parent } : undefined;
    const parentQueue = clipRef(options?.parentQueue);
    if (parent && parentQueue && !parent.queue) parent.queue = parentQueue;
    if (parent) trace.parent = parent;
    return attach(data, field, trace);
  } catch (e) {
    report(onError, 'continueTrace failed', e);
    return data;
  }
}
