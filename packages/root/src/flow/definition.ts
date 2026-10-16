import {
  FLOW_ID_PATTERN,
  FLOW_TRACE_FIELD,
  clipText,
  hasOwn,
  isSafePath,
  isValidTraceField,
} from './contract';
import { renderFlowYaml } from './yaml';
import type { FlowConfig, FlowNext, FlowStepConfig } from './contract';

/*
 * Boot-time normalization of `Config.flows`. Never throws: every problem
 * becomes a `FlowCheck` (served on the Config tab) and a single console
 * warning per flow. Keys come from the config (trusted), but they are kept in
 * `Map`s and clipped: the `_trace` read from Redis references them.
 */

export const FLOW_MAX_FLOWS = 32;
export const FLOW_MAX_STEPS = 64;
export const FLOW_MAX_NEXT = 8;
export const FLOW_MAX_ALIASES = 8;
export const FLOW_STEP_ID_CHARS = 120;
const LABEL_CHARS = 240;
const DESCRIPTION_CHARS = 500;
const WHEN_CHARS = 120;

export type FlowCheckLevel = 'ok' | 'warn' | 'error';
export type FlowCheck = {
  level: FlowCheckLevel;
  code: string;
  message: string;
};

export type FlowStepKind = 'step' | 'end' | 'error';
export type FlowEdgeKind =
  | 'next'
  | 'conditional'
  | 'fallback'
  | 'sidecar'
  | 'end';

export type NormalizedFlowStep = {
  id: string;
  kind: FlowStepKind;
  label: string;
  description?: string;
  when?: string;
  /** Queue name. Absent on `end` nodes. */
  queue?: string;
  /** Resolved queue id; absent when the queue is not in `config.queues`. */
  queueId?: string;
  jobs?: string[];
  /** The queue holds more than one step of this flow. */
  sharedQueue: boolean;
};

export type NormalizedFlowEdge = {
  from: string;
  to: string;
  kind: FlowEdgeKind;
  when?: string;
};

export type NormalizedFlow = {
  id: string;
  label: string;
  group?: string;
  entry: string[];
  complete: string[];
  onError?: string;
  /** Insertion order: config order, `end` nodes after their source. */
  steps: Map<string, NormalizedFlowStep>;
  edges: NormalizedFlowEdge[];
  trace: {
    field: string;
    key?: string;
    keyLabel?: string;
    aliases: string[];
  };
  checks: FlowCheck[];
  /** YAML rendering of the accepted definition. */
  definition: string;
  /** Steps (not `end`) per queue id. */
  stepsByQueue: Map<string, NormalizedFlowStep[]>;
  /** Declared predecessors per step id. */
  predecessors: Map<string, string[]>;
};

export type FlowQueueLike = {
  id: string;
  name: string;
  group?: string | null;
};

export type NormalizedFlows = {
  flows: NormalizedFlow[];
  /** Problems that are not about one accepted flow (dropped flows). */
  checks: FlowCheck[];
};

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const clipped = clipText(value, max).trim();
  return clipped ? clipped : undefined;
};

const asList = <T>(value: T | T[] | undefined | null): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

/** Synthetic id of an `end` branch, unique within the flow. */
function endNodeId(
  from: string,
  index: number,
  taken: Map<string, unknown>
): string {
  let id = clipText(`${from}::end${index}`, FLOW_STEP_ID_CHARS + 16);
  let n = 0;
  while (taken.has(id)) id = `${id}~${++n}`;
  return id;
}

/**
 * Whether the step only covers some job names of its queue and `name` is one
 * of them (`jobs` omitted = every job).
 */
export function stepMatchesJob(
  step: NormalizedFlowStep,
  name: string
): boolean {
  return !step.jobs || step.jobs.includes(name);
}

/**
 * The step a job of `queueId` named `name` belongs to: an explicit `jobs`
 * match wins over a catch-all step on the same queue.
 */
export function resolveFlowStep(
  flow: NormalizedFlow,
  queueId: string,
  name: string
): NormalizedFlowStep | undefined {
  const candidates = flow.stepsByQueue.get(queueId);
  if (!candidates) return undefined;
  return (
    candidates.find((step) => !!step.jobs && step.jobs.includes(name)) ??
    candidates.find((step) => !step.jobs)
  );
}

function normalizeOne(
  raw: Record<string, unknown>,
  id: string,
  queues: FlowQueueLike[]
): NormalizedFlow {
  const checks: FlowCheck[] = [];
  const add = (level: FlowCheckLevel, code: string, message: string) =>
    checks.push({ level, code, message: clipText(message, 500) });

  const queueByName = new Map<string, FlowQueueLike>();
  for (const queue of queues) {
    if (!queueByName.has(queue.name)) queueByName.set(queue.name, queue);
  }

  // Steps.
  const steps = new Map<string, NormalizedFlowStep>();
  const rawSteps = new Map<string, FlowStepConfig>();
  const stepsValue = hasOwn(raw, 'steps') ? raw.steps : undefined;
  if (
    !stepsValue ||
    typeof stepsValue !== 'object' ||
    Array.isArray(stepsValue)
  ) {
    add('error', 'no-steps', `flow "${id}" declares no steps`);
  } else {
    const keys = Object.keys(stepsValue as Record<string, unknown>);
    if (keys.length > FLOW_MAX_STEPS) {
      add(
        'warn',
        'too-many-steps',
        `flow "${id}" has ${keys.length} steps; only the first ${FLOW_MAX_STEPS} are kept`
      );
    }
    for (const rawKey of keys.slice(0, FLOW_MAX_STEPS)) {
      const stepId = clipText(rawKey, FLOW_STEP_ID_CHARS);
      const value = (stepsValue as Record<string, unknown>)[rawKey];
      if (!stepId || steps.has(stepId)) {
        add('error', 'invalid-step', `step "${stepId}" is empty or repeated`);
        continue;
      }
      const config = (
        value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      ) as FlowStepConfig;
      const queueName =
        text(hasOwn(config, 'queue') ? config.queue : undefined, 256) ?? stepId;
      const queue = queueByName.get(queueName);
      if (!queue) {
        add(
          'error',
          'unknown-queue',
          `step "${stepId}": queue "${queueName}" is not registered in the monitor`
        );
      }
      let jobs: string[] | undefined;
      const rawJobs = hasOwn(config, 'jobs') ? config.jobs : undefined;
      if (rawJobs !== undefined) {
        if (
          Array.isArray(rawJobs) &&
          rawJobs.every((name) => typeof name === 'string' && name)
        ) {
          jobs = Array.from(
            new Set(rawJobs.map((name) => clipText(name, 256)))
          ).slice(0, 64);
        } else {
          add(
            'warn',
            'invalid-jobs',
            `step "${stepId}": "jobs" must be a list of job names; ignored`
          );
        }
      }
      steps.set(stepId, {
        id: stepId,
        kind: 'step',
        label:
          text(
            hasOwn(config, 'label') ? config.label : undefined,
            LABEL_CHARS
          ) ?? stepId,
        description: text(
          hasOwn(config, 'description') ? config.description : undefined,
          DESCRIPTION_CHARS
        ),
        when: text(
          hasOwn(config, 'when') ? config.when : undefined,
          WHEN_CHARS
        ),
        queue: queueName,
        queueId: queue?.id,
        jobs,
        sharedQueue: false,
      });
      rawSteps.set(stepId, config);
    }
  }

  const stepRef = (value: unknown, what: string): string | undefined => {
    if (typeof value !== 'string') {
      add('error', 'unknown-step', `${what}: not a step id`);
      return undefined;
    }
    const ref = clipText(value, FLOW_STEP_ID_CHARS);
    if (!steps.has(ref) || steps.get(ref)?.kind === 'end') {
      add('error', 'unknown-step', `${what} points to unknown step "${ref}"`);
      return undefined;
    }
    return ref;
  };

  // onError.
  const onError =
    hasOwn(raw, 'onError') && raw.onError !== undefined
      ? stepRef(raw.onError, 'onError')
      : undefined;
  if (onError) {
    const step = steps.get(onError) as NormalizedFlowStep;
    step.kind = 'error';
  }

  // Edges (and synthetic end nodes).
  const edges: NormalizedFlowEdge[] = [];
  const endNodes: NormalizedFlowStep[] = [];
  for (const [stepId, config] of rawSteps) {
    const nexts = asList(
      hasOwn(config, 'next')
        ? (config.next as FlowNext | FlowNext[])
        : undefined
    );
    if (nexts.length > FLOW_MAX_NEXT) {
      add(
        'warn',
        'too-many-next',
        `step "${stepId}" has ${nexts.length} next entries; only the first ${FLOW_MAX_NEXT} are kept`
      );
    }
    nexts.slice(0, FLOW_MAX_NEXT).forEach((next, index) => {
      if (typeof next === 'string') {
        const to = stepRef(next, `step "${stepId}" next`);
        if (to) edges.push({ from: stepId, to, kind: 'next' });
        return;
      }
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        add('error', 'invalid-next', `step "${stepId}": invalid next entry`);
        return;
      }
      const when = text(
        hasOwn(next, 'when') ? next.when : undefined,
        WHEN_CHARS
      );
      const rawKind = hasOwn(next, 'kind') ? next.kind : undefined;
      if (
        rawKind !== undefined &&
        rawKind !== 'next' &&
        rawKind !== 'fallback' &&
        rawKind !== 'sidecar'
      ) {
        add(
          'warn',
          'invalid-kind',
          `step "${stepId}": unknown next kind, using "next"`
        );
      }
      const to = hasOwn(next, 'to') ? next.to : undefined;
      const end = hasOwn(next, 'end') ? next.end : undefined;
      if (to !== undefined) {
        const target = stepRef(to, `step "${stepId}" next`);
        if (!target) return;
        const kind: FlowEdgeKind =
          rawKind === 'fallback'
            ? 'fallback'
            : rawKind === 'sidecar'
            ? 'sidecar'
            : when
            ? 'conditional'
            : 'next';
        edges.push({ from: stepId, to: target, kind, when });
        return;
      }
      if (end !== undefined) {
        const label = text(end, LABEL_CHARS) ?? 'end';
        const nodeId = endNodeId(stepId, index, steps);
        const node: NormalizedFlowStep = {
          id: nodeId,
          kind: 'end',
          label,
          sharedQueue: false,
        };
        endNodes.push(node);
        steps.set(nodeId, node);
        edges.push({ from: stepId, to: nodeId, kind: 'end', when });
        return;
      }
      add(
        'error',
        'invalid-next',
        `step "${stepId}": next entry needs "to" or "end"`
      );
    });
  }

  // Entry.
  const entry = Array.from(
    new Set(
      asList(hasOwn(raw, 'entry') ? (raw.entry as unknown) : undefined)
        .map((value) => stepRef(value, 'entry'))
        .filter((value): value is string => !!value)
    )
  );
  if (!entry.length)
    add('error', 'no-entry', `flow "${id}" has no valid entry`);

  // Complete.
  let complete: string[];
  if (hasOwn(raw, 'complete') && raw.complete !== undefined) {
    complete = Array.from(
      new Set(
        asList(raw.complete as unknown)
          .map((value) => stepRef(value, 'complete'))
          .filter((value): value is string => !!value)
      )
    );
  } else {
    const withNext = new Set(edges.map((edge) => edge.from));
    complete = [
      ...Array.from(steps.values())
        .filter((step) => step.kind === 'step' && !withNext.has(step.id))
        .map((step) => step.id),
      ...endNodes.map((node) => node.id),
    ];
  }

  // Reachability of a completion from the entry (cycles are allowed).
  const successors = new Map<string, string[]>();
  for (const edge of edges) {
    successors.set(edge.from, [...(successors.get(edge.from) ?? []), edge.to]);
  }
  const reached = new Set<string>(entry);
  const stack = [...entry];
  while (stack.length) {
    const current = stack.pop() as string;
    for (const next of successors.get(current) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        stack.push(next);
      }
    }
  }
  if (entry.length && !complete.some((stepId) => reached.has(stepId))) {
    add(
      'warn',
      'no-completion',
      `flow "${id}" has no completion step reachable from the entry`
    );
  }

  // Shared queues and lookups.
  const stepsByQueue = new Map<string, NormalizedFlowStep[]>();
  for (const step of steps.values()) {
    if (step.kind === 'end' || !step.queueId) continue;
    stepsByQueue.set(step.queueId, [
      ...(stepsByQueue.get(step.queueId) ?? []),
      step,
    ]);
  }
  stepsByQueue.forEach((list) => {
    if (list.length > 1) list.forEach((step) => (step.sharedQueue = true));
  });
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind === 'end') continue;
    const list = predecessors.get(edge.to) ?? [];
    if (!list.includes(edge.from)) list.push(edge.from);
    predecessors.set(edge.to, list);
  }

  // Trace config.
  const traceRaw = (
    hasOwn(raw, 'trace') && raw.trace && typeof raw.trace === 'object'
      ? raw.trace
      : {}
  ) as Record<string, unknown>;
  let field = FLOW_TRACE_FIELD;
  if (hasOwn(traceRaw, 'field') && traceRaw.field !== undefined) {
    if (isValidTraceField(traceRaw.field)) field = traceRaw.field;
    else
      add(
        'error',
        'invalid-trace-field',
        `flow "${id}": invalid trace.field, using "${FLOW_TRACE_FIELD}"`
      );
  }
  let key: string | undefined;
  if (hasOwn(traceRaw, 'key') && traceRaw.key !== undefined) {
    if (isSafePath(traceRaw.key)) key = traceRaw.key;
    else
      add('error', 'invalid-trace-key', `flow "${id}": invalid trace.key path`);
  }
  const aliases: string[] = [];
  if (hasOwn(traceRaw, 'aliases') && traceRaw.aliases !== undefined) {
    const list = Array.isArray(traceRaw.aliases) ? traceRaw.aliases : [];
    if (!Array.isArray(traceRaw.aliases)) {
      add(
        'error',
        'invalid-trace-alias',
        `flow "${id}": trace.aliases must be a list`
      );
    }
    for (const alias of list) {
      if (!isSafePath(alias)) {
        add('error', 'invalid-trace-alias', `flow "${id}": invalid alias path`);
      } else if (!aliases.includes(alias)) {
        aliases.push(alias);
      }
    }
    if (aliases.length > FLOW_MAX_ALIASES) {
      add(
        'warn',
        'too-many-aliases',
        `flow "${id}": only the first ${FLOW_MAX_ALIASES} aliases are kept`
      );
      aliases.length = FLOW_MAX_ALIASES;
    }
  }
  const keyLabel =
    text(hasOwn(traceRaw, 'keyLabel') ? traceRaw.keyLabel : undefined, 64) ??
    (key ? key.split('.').pop() : undefined);

  // Group: declared, or the single group shared by the flow's queues.
  let group = text(hasOwn(raw, 'group') ? raw.group : undefined, 256);
  if (!group) {
    const groups = new Set<string | null | undefined>();
    for (const step of steps.values()) {
      if (step.kind === 'end' || !step.queue) continue;
      groups.add(queueByName.get(step.queue)?.group ?? undefined);
    }
    const [only] = Array.from(groups);
    if (groups.size === 1 && typeof only === 'string' && only) group = only;
  }

  const label =
    text(hasOwn(raw, 'label') ? raw.label : undefined, LABEL_CHARS) ?? id;
  const flow: NormalizedFlow = {
    id,
    label,
    group,
    entry,
    complete,
    onError,
    steps,
    edges,
    trace: { field, key, keyLabel, aliases },
    checks,
    definition: '',
    stepsByQueue,
    predecessors,
  };
  flow.definition = renderFlowYaml(flow);
  return flow;
}

/**
 * `config.flows` -> normalized flows. Never throws. `warn` receives one
 * message per flow with problems (default `console.warn`).
 */
export function normalizeFlows(
  flows: unknown,
  queues: FlowQueueLike[],
  warn: (message: string) => void = console.warn
): NormalizedFlows {
  const result: NormalizedFlows = { flows: [], checks: [] };
  try {
    if (flows == null) return result;
    if (!Array.isArray(flows)) {
      result.checks.push({
        level: 'error',
        code: 'invalid-flows',
        message: '"flows" must be a list of flow definitions',
      });
    }
    const list: unknown[] = Array.isArray(flows) ? flows : [];
    if (list.length > FLOW_MAX_FLOWS) {
      result.checks.push({
        level: 'warn',
        code: 'too-many-flows',
        message: `${list.length} flows declared; only the first ${FLOW_MAX_FLOWS} are kept`,
      });
    }
    const seen = new Set<string>();
    list.slice(0, FLOW_MAX_FLOWS).forEach((raw, index) => {
      try {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          result.checks.push({
            level: 'error',
            code: 'invalid-flow',
            message: `flow #${index + 1} is not an object; ignored`,
          });
          return;
        }
        const id = hasOwn(raw, 'id')
          ? (raw as Record<string, unknown>).id
          : undefined;
        if (typeof id !== 'string' || !FLOW_ID_PATTERN.test(id)) {
          result.checks.push({
            level: 'error',
            code: 'invalid-id',
            message: `flow #${
              index + 1
            } has an invalid id (expected [a-z0-9-_.:], up to 64); ignored`,
          });
          return;
        }
        if (seen.has(id)) {
          result.checks.push({
            level: 'error',
            code: 'duplicate-flow',
            message: `flow "${id}" is declared twice; the second one is ignored`,
          });
          return;
        }
        seen.add(id);
        result.flows.push(
          normalizeOne(raw as Record<string, unknown>, id, queues ?? [])
        );
      } catch {
        result.checks.push({
          level: 'error',
          code: 'invalid-flow',
          message: `flow #${index + 1} could not be read; ignored`,
        });
      }
    });
  } catch {
    // Never let a bad config take the monitor down.
  }
  try {
    const problems = [
      ...result.checks,
      ...result.flows.flatMap((flow) =>
        flow.checks.filter((check) => check.level !== 'ok')
      ),
    ];
    if (problems.length) {
      const byFlow = new Map<string, FlowCheck[]>();
      byFlow.set('', result.checks);
      result.flows.forEach((flow) =>
        byFlow.set(
          flow.id,
          flow.checks.filter((check) => check.level !== 'ok')
        )
      );
      byFlow.forEach((checks, id) => {
        if (!checks.length) return;
        warn(
          `[bull-horizon] flow${id ? ` "${id}"` : 's'} config: ` +
            checks.map((check) => check.message).join('; ')
        );
      });
    }
  } catch {
    // Logging is best effort.
  }
  return result;
}

/** Flows shaped for config typing: re-exported for `Config.flows`. */
export type { FlowConfig };
