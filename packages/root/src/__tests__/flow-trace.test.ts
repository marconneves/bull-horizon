import {
  FLOW_MAX_HOP,
  FLOW_TRACE_FIELD,
  continueTrace,
  encodeTrace,
  readTrace,
  startTrace,
  withTrace,
} from '../flow';
import { parseTrace, readPath, isSafePath } from '../flow/contract';
import {
  FLOW_MAX_FLOWS,
  FLOW_MAX_NEXT,
  FLOW_MAX_STEPS,
  normalizeFlows,
  resolveFlowStep,
} from '../flow/definition';
import { yamlScalar } from '../flow/yaml';
import { currentAttempt, terminalAttempts } from '../shared/attempt';
import { defaultAgentRunAttempt } from '../agent';
import type { FlowConfig, FlowTraceV1 } from '../flow';

const T0 = Date.parse('2026-10-16T10:00:00.000Z');

const QUEUES = [
  { id: 'qV', name: 'content:Verify', group: 'Content' },
  { id: 'qE', name: 'content:Extract', group: 'Content' },
  { id: 'qT', name: 'content:Transcribe', group: 'Content' },
  { id: 'qF', name: 'content:Fallback', group: 'Content' },
  { id: 'qS', name: 'content:Save', group: 'Content' },
  { id: 'qX', name: 'content:Error', group: 'Content' },
  { id: 'qM', name: 'content:Misc', group: 'Other' },
];

const FLOW: FlowConfig = {
  id: 'content-ingest',
  label: 'Ingestão de conteúdo',
  entry: 'content:Verify',
  onError: 'content:Error',
  trace: { key: 'videoId', aliases: ['tiktokId'] },
  steps: {
    'content:Verify': {
      next: [
        { to: 'content:Extract', when: 'novo' },
        { end: 'só atualiza números', when: 'já existe' },
      ],
    },
    'content:Extract': { next: 'content:Transcribe' },
    'content:Transcribe': {
      next: ['content:Save', { to: 'content:Fallback', kind: 'fallback' }],
    },
    'content:Fallback': { next: 'content:Save' },
    'content:Save': {},
    'content:Error': {},
  },
};

const silent = () => undefined;

describe('normalizeFlows (T001)', () => {
  it('normalizes steps, edges, end nodes, completion and group', () => {
    const { flows, checks } = normalizeFlows([FLOW], QUEUES, silent);
    expect(checks).toEqual([]);
    const [flow] = flows;
    expect(flow.checks).toEqual([]);
    expect(flow.group).toBe('Content');
    expect(flow.entry).toEqual(['content:Verify']);
    expect(flow.onError).toBe('content:Error');
    expect(flow.steps.get('content:Error')?.kind).toBe('error');
    expect(flow.steps.get('content:Verify')?.queueId).toBe('qV');
    const end = flow.edges.find((edge) => edge.kind === 'end');
    expect(end).toMatchObject({ from: 'content:Verify', when: 'já existe' });
    expect(flow.steps.get(end!.to)).toMatchObject({
      kind: 'end',
      label: 'só atualiza números',
    });
    expect(flow.edges.find((edge) => edge.to === 'content:Extract')?.kind).toBe(
      'conditional'
    );
    expect(
      flow.edges.find((edge) => edge.to === 'content:Fallback')?.kind
    ).toBe('fallback');
    // Default completion: steps without next (not onError) + end branches.
    expect(flow.complete).toEqual(['content:Save', end!.to]);
    expect(flow.trace).toEqual({
      field: FLOW_TRACE_FIELD,
      key: 'videoId',
      keyLabel: 'videoId',
      aliases: ['tiktokId'],
    });
    expect(flow.predecessors.get('content:Save')).toEqual([
      'content:Transcribe',
      'content:Fallback',
    ]);
  });

  it('renders the definition as YAML', () => {
    const [flow] = normalizeFlows([FLOW], QUEUES, silent).flows;
    expect(flow.definition).toContain('id: content-ingest');
    expect(flow.definition).toContain('label: Ingestão de conteúdo');
    expect(flow.definition).toContain('  content:Verify:');
    expect(flow.definition).toContain('      - end: só atualiza números');
    expect(flow.definition).toContain('        when: já existe');
    expect(flow.definition).toContain('        kind: fallback');
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar('true')).toBe('"true"');
    expect(yamlScalar('x\ny')).toBe('"x\\ny"');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'flows'],
    ['a number', 42],
    ['an object', { id: 'x' }],
    ['garbage items', [null, 1, 'x', [], { id: 'BAD ID' }, { id: 'ok' }]],
    ['steps as a list', [{ id: 'a', entry: 'x', steps: ['x'] }]],
    [
      'bad nexts',
      [
        {
          id: 'a',
          entry: ['s', 'nope'],
          onError: 7,
          complete: 'ghost',
          trace: { field: '__proto__', key: 'a.__proto__.b', aliases: 'x' },
          steps: {
            s: {
              queue: 'content:Verify',
              jobs: 'oops',
              next: [null, 3, {}, { to: 'ghost' }, { kind: 'weird', to: 's' }],
            },
          },
        },
      ],
    ],
  ])('never throws on %s', (_label, value) => {
    const warn = jest.fn();
    expect(() => normalizeFlows(value, QUEUES, warn)).not.toThrow();
  });

  it('reports problems as checks with one warning per flow', () => {
    const warn = jest.fn();
    const { flows, checks } = normalizeFlows(
      [
        {
          id: 'a',
          entry: ['s', 'ghost'],
          onError: 'nope',
          steps: {
            s: { next: ['ghost', { to: 's2' }, { when: 'x' }] },
            s2: { queue: 'content:Save' },
          },
        },
        { id: 'a', entry: 's', steps: {} },
        { id: 'Not Valid', entry: 's', steps: {} },
      ],
      QUEUES,
      warn
    );
    expect(flows).toHaveLength(1);
    const codes = flows[0].checks.map((c) => c.code);
    expect(codes).toEqual(
      expect.arrayContaining(['unknown-queue', 'unknown-step', 'invalid-next'])
    );
    expect(flows[0].steps.get('s')?.queueId).toBeUndefined();
    expect(flows[0].entry).toEqual(['s']);
    expect(flows[0].onError).toBeUndefined();
    expect(checks.map((c) => c.code)).toEqual(['duplicate-flow', 'invalid-id']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('warns about a flow without a reachable completion (cycles allowed)', () => {
    const { flows } = normalizeFlows(
      [
        {
          id: 'loop',
          entry: 'content:Verify',
          steps: {
            'content:Verify': { next: 'content:Extract' },
            'content:Extract': { next: 'content:Verify' },
          },
        },
      ],
      QUEUES,
      silent
    );
    expect(flows[0].checks.map((c) => c.code)).toEqual(['no-completion']);
  });

  it('caps flows, steps and next entries', () => {
    const many = Array.from({ length: FLOW_MAX_FLOWS + 3 }, (_, i) => ({
      id: `f${i}`,
      entry: 's',
      steps: { s: { queue: 'content:Verify' } },
    }));
    const result = normalizeFlows(many, QUEUES, silent);
    expect(result.flows).toHaveLength(FLOW_MAX_FLOWS);
    expect(result.checks.map((c) => c.code)).toContain('too-many-flows');

    const steps: Record<string, unknown> = {};
    for (let i = 0; i < FLOW_MAX_STEPS + 5; i++) {
      steps[`s${i}`] = { queue: 'content:Verify' };
    }
    (steps.s0 as any).next = Array.from(
      { length: FLOW_MAX_NEXT + 4 },
      (_, i) => `s${i + 1}`
    );
    const [flow] = normalizeFlows(
      [{ id: 'big', entry: 's0', steps }],
      QUEUES,
      silent
    ).flows;
    expect(Array.from(flow.steps.keys())).toHaveLength(FLOW_MAX_STEPS);
    expect(flow.edges).toHaveLength(FLOW_MAX_NEXT);
    expect(flow.checks.map((c) => c.code)).toEqual(
      expect.arrayContaining(['too-many-steps', 'too-many-next'])
    );
  });

  it('keeps prototype-named step keys as plain own entries', () => {
    const steps = JSON.parse(
      '{"__proto__": {"queue": "content:Verify", "next": "constructor"},' +
        ' "constructor": {"queue": "content:Save", "next": "toString"},' +
        ' "toString": {"queue": "content:Misc"}}'
    );
    const { flows } = normalizeFlows(
      [{ id: 'proto', entry: '__proto__', steps }],
      QUEUES,
      silent
    );
    const [flow] = flows;
    expect(Array.from(flow.steps.keys())).toEqual([
      '__proto__',
      'constructor',
      'toString',
    ]);
    expect(flow.edges.map((e) => `${e.from}>${e.to}`)).toEqual([
      '__proto__>constructor',
      'constructor>toString',
    ]);
    expect(flow.complete).toEqual(['toString']);
    expect(({} as any).queue).toBeUndefined();
  });

  it('resolves the step of a job (explicit jobs win over a catch-all)', () => {
    const [flow] = normalizeFlows(
      [
        {
          id: 'shared',
          entry: 'all',
          steps: {
            all: { queue: 'content:Misc', next: 'only-b' },
            'only-b': { queue: 'content:Misc', jobs: ['b'] },
          },
        },
      ],
      QUEUES,
      silent
    ).flows;
    expect(flow.steps.get('all')?.sharedQueue).toBe(true);
    expect(resolveFlowStep(flow, 'qM', 'b')?.id).toBe('only-b');
    expect(resolveFlowStep(flow, 'qM', 'a')?.id).toBe('all');
    expect(resolveFlowStep(flow, 'qV', 'a')).toBeUndefined();
  });
});

describe('safe path getter', () => {
  it('follows own properties only and rejects prototype segments', () => {
    const data = JSON.parse('{"a": {"b": [10, 20]}, "__proto__": {"x": 1}}');
    expect(readPath(data, 'a.b.1')).toBe(20);
    expect(readPath(data, '__proto__.x')).toBeUndefined();
    expect(readPath(data, 'constructor')).toBeUndefined();
    expect(readPath(data, 'a.toString')).toBeUndefined();
    expect(readPath({}, 'hasOwnProperty')).toBeUndefined();
    expect(isSafePath('a..b')).toBe(false);
    expect(isSafePath('a.prototype')).toBe(false);
  });
});

// Processor-side job shapes of each lib.
const bull3 = (over: Record<string, unknown> = {}) => ({
  id: 41,
  name: 'verify',
  data: {},
  queue: { name: 'content:Verify' },
  attemptsMade: 0, // Bull: attempt N sees N - 1
  progress: () => 0,
  ...over,
});
const bullmq1 = (over: Record<string, unknown> = {}) => ({
  id: '41',
  name: 'verify',
  data: {},
  queueName: 'content:Verify',
  attemptsMade: 1, // BullMQ 1..4: bumped on activation
  progress: 0,
  updateProgress: () => undefined,
  ...over,
});
const bullmq5 = (over: Record<string, unknown> = {}) => ({
  ...bullmq1(over),
  attemptsMade: 0,
  attemptsStarted: 1,
  ...over,
});
/** Bull sandboxed processor: no `queue`. */
const sandbox = (over: Record<string, unknown> = {}) => ({
  id: '41',
  name: 'verify',
  data: {},
  attemptsMade: 0,
  progress: () => 0,
  ...over,
});

describe('trace helpers (T002)', () => {
  it('startTrace opens a trace without mutating the data', () => {
    const data = { videoId: 7 };
    const out = startTrace(data, { flow: 'content-ingest', key: 7, now: T0 });
    expect(data).toEqual({ videoId: 7 });
    expect(out).not.toBe(data);
    const trace = (out as Record<string, unknown>)[
      FLOW_TRACE_FIELD
    ] as FlowTraceV1;
    expect(trace).toEqual({
      v: 1,
      traceId: expect.stringMatching(/^tr_[0-9a-f]{16}$/),
      flow: 'content-ingest',
      key: '7',
      startedAt: T0,
      hop: 0,
    });
    expect(readTrace(out)).toEqual(trace);
  });

  it('startTrace links to a job of another flow (hop 0, parent kept)', () => {
    const page = bullmq1({ id: 'p9', name: 'page', queueName: 'ingest:page' });
    const out = startTrace(
      {},
      { flow: 'content-ingest', parent: page, now: T0 }
    );
    expect(readTrace(out)).toMatchObject({
      hop: 0,
      parent: { queue: 'ingest:page', jobId: 'p9', name: 'page', attempt: 1 },
    });
  });

  it('startTrace reuses a valid external id and replaces an invalid one', () => {
    const onError = jest.fn();
    expect(
      readTrace(startTrace({}, { flow: 'f', traceId: 'req-123' }))?.traceId
    ).toBe('req-123');
    const out = startTrace({}, { flow: 'f', traceId: 'bad id!', onError });
    expect(readTrace(out)?.traceId).toMatch(/^tr_/);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Bull 3', bull3, 1, 'content:Verify'],
    ['BullMQ 1', bullmq1, 1, 'content:Verify'],
    ['BullMQ 5', bullmq5, 1, 'content:Verify'],
    ['Bull sandbox (no queue)', sandbox, 1, undefined],
  ])(
    'withTrace copies the trace from a %s parent',
    (_l, make, attempt, queue) => {
      const entry = startTrace(
        { videoId: 'v1' },
        { flow: 'content-ingest', key: 'v1', now: T0 }
      );
      const parent = make({ data: { ...entry, secret: 'do-not-copy' } });
      const child = withTrace(parent, { tiktokId: 't1' });
      expect(child).not.toHaveProperty('secret');
      expect(child.tiktokId).toBe('t1');
      const trace = readTrace(child);
      const parentRef: Record<string, unknown> = {
        jobId: '41',
        name: 'verify',
        attempt,
      };
      if (queue) parentRef.queue = queue;
      expect(trace).toEqual({
        v: 1,
        traceId: readTrace(entry)!.traceId,
        flow: 'content-ingest',
        key: 'v1',
        startedAt: T0,
        hop: 1,
        parent: parentRef,
      });
      // The parent's own data is untouched.
      expect(readTrace(parent)?.hop).toBe(0);
    }
  );

  it('numbers the parent attempt on retries like the agent helper', () => {
    const entry = startTrace({}, { flow: 'f', now: T0 });
    // Third attempt in each lib.
    const cases = [
      bull3({ data: entry, attemptsMade: 2 }),
      bullmq1({ data: entry, attemptsMade: 3 }),
      bullmq5({ data: entry, attemptsMade: 2, attemptsStarted: 3 }),
    ];
    for (const job of cases) {
      expect(readTrace(withTrace(job, {}))?.parent?.attempt).toBe(3);
      expect(currentAttempt(job)).toBe(defaultAgentRunAttempt(job as any));
    }
  });

  it('withTrace key option overrides the inherited key', () => {
    const entry = startTrace({}, { flow: 'f', key: 'a', now: T0 });
    expect(
      readTrace(withTrace(bull3({ data: entry }), {}, { key: 99 }))?.key
    ).toBe('99');
  });

  it('a parent without a trace opens a new one with flow, else data as is', () => {
    const onError = jest.fn();
    const orphan = bullmq1({ data: { videoId: 1 } });
    const opened = withTrace(orphan, { a: 1 }, { flow: 'content-ingest' });
    expect(readTrace(opened)).toMatchObject({
      hop: 0,
      flow: 'content-ingest',
      parent: { jobId: '41', queue: 'content:Verify' },
    });
    const data = { a: 1 };
    expect(withTrace(orphan, data, { onError })).toBe(data);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it(`stops at hop ${FLOW_MAX_HOP}`, () => {
    const onError = jest.fn();
    const deep: FlowTraceV1 = {
      v: 1,
      traceId: 'tr_deadbeefdeadbeef',
      flow: 'f',
      startedAt: T0,
      hop: FLOW_MAX_HOP,
    };
    const data = { a: 1 };
    expect(
      withTrace(bull3({ data: { _trace: deep } }), data, { onError })
    ).toBe(data);
    expect(onError).toHaveBeenCalledTimes(1);
    const almost = { ...deep, hop: FLOW_MAX_HOP - 1 };
    expect(
      readTrace(withTrace(bull3({ data: { _trace: almost } }), {}))?.hop
    ).toBe(FLOW_MAX_HOP);
    // Beyond the cap the reader refuses it.
    expect(parseTrace({ ...deep, hop: FLOW_MAX_HOP + 1 })).toBeUndefined();
  });

  it.each([
    ['a string', 'payload'],
    ['an array', [1, 2]],
    ['null', null],
    ['a number', 3],
  ])('returns %s data untouched and reports', (_l, data) => {
    const onError = jest.fn();
    const parent = bull3({ data: startTrace({}, { flow: 'f' }) });
    expect(startTrace(data as any, { flow: 'f', onError })).toBe(data);
    expect(withTrace(parent, data as any, { onError })).toBe(data);
    expect(continueTrace(encodeTrace(parent), data as any, { onError })).toBe(
      data
    );
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it('never throws, even when onError throws or getters explode', () => {
    const throwing = () => {
      throw new Error('hook');
    };
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('getter');
        },
        ownKeys() {
          throw new Error('keys');
        },
      }
    );
    const data = { a: 1 };
    expect(() =>
      startTrace(data, { flow: 'BAD', onError: throwing })
    ).not.toThrow();
    expect(() =>
      withTrace(hostile as any, data, { onError: throwing })
    ).not.toThrow();
    expect(withTrace(hostile as any, data, { onError: throwing })).toBe(data);
    expect(() =>
      startTrace(hostile as any, { flow: 'f', onError: throwing })
    ).not.toThrow();
    expect(() => readTrace(hostile)).not.toThrow();
    expect(() => encodeTrace(hostile as any)).not.toThrow();
    expect(() =>
      continueTrace('%%%', data, { onError: throwing })
    ).not.toThrow();
    expect(() => startTrace(data, undefined as any)).not.toThrow();
  });

  it('reads defensively: wrong types, foreign fields, prototype keys', () => {
    const good = readTrace(
      startTrace({}, { flow: 'f', now: T0 })
    ) as FlowTraceV1;
    expect(parseTrace({ ...good, v: 2 })).toBeUndefined();
    expect(parseTrace({ ...good, traceId: 'has space' })).toBeUndefined();
    expect(parseTrace({ ...good, startedAt: 'yesterday' })).toBeUndefined();
    expect(parseTrace({ ...good, hop: -1 })).toBeUndefined();
    expect(parseTrace({ ...good, key: { nested: true } })).toEqual(good);
    expect(parseTrace({ ...good, key: 'k'.repeat(500) })?.key).toHaveLength(
      128
    );
    expect(
      parseTrace({ ...good, extra: 'x', parent: { jobId: 5, queue: 7 } })
    ).toEqual({
      ...good,
      parent: { jobId: '5' },
    });
    const polluted = JSON.parse(
      `{"_trace": ${JSON.stringify(good)}, "__proto__": {"polluted": true}}`
    );
    const child = withTrace(bull3({ data: polluted }), {});
    expect((child as any).polluted).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
    // Inherited `_trace` does not count.
    const inherited = Object.create({ _trace: good });
    expect(readTrace(inherited)).toBeUndefined();
  });

  it('honours a custom field', () => {
    const out = startTrace({}, { flow: 'f', field: 'trace$' });
    expect(readTrace(out)).toBeUndefined();
    expect(readTrace(out, 'trace$')?.flow).toBe('f');
    const onError = jest.fn();
    const fallback = startTrace({}, { flow: 'f', field: '__proto__', onError });
    expect(readTrace(fallback)?.flow).toBe('f');
    expect(onError).toHaveBeenCalled();
  });
});

describe('encodeTrace / continueTrace (external hop)', () => {
  it('carries the trace across a string and increments hop', () => {
    const entry = startTrace(
      {},
      { flow: 'content-ingest', key: 'v1', now: T0 }
    );
    const job = bullmq1({ id: 'job-7', name: 'transcribe', data: entry });
    const encoded = encodeTrace(job) as string;
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded.length).toBeLessThanOrEqual(512);
    const next = continueTrace(encoded, { videoId: 'v1' });
    expect(readTrace(next)).toEqual({
      v: 1,
      traceId: readTrace(entry)!.traceId,
      flow: 'content-ingest',
      key: 'v1',
      startedAt: T0,
      hop: 1,
      parent: {
        queue: 'content:Verify',
        jobId: 'job-7',
        name: 'transcribe',
        attempt: 1,
      },
    });
  });

  it('fills the parent queue when the sender did not know it', () => {
    const job = sandbox({ data: startTrace({}, { flow: 'f' }) });
    const next = continueTrace(encodeTrace(job), {}, { parentQueue: 'q:send' });
    expect(readTrace(next)?.parent?.queue).toBe('q:send');
  });

  it('treats the encoded value as untrusted input', () => {
    const onError = jest.fn();
    const forged = Buffer.from(
      JSON.stringify({ v: 1, traceId: 'x y', flow: 'f', startedAt: 1, hop: 0 })
    ).toString('base64');
    const data = { a: 1 };
    for (const value of [
      undefined,
      12,
      '',
      'a'.repeat(600),
      'not base64!',
      forged,
    ]) {
      expect(continueTrace(value, data, { onError })).toBe(data);
    }
    expect(onError).toHaveBeenCalledTimes(6);
    expect(encodeTrace(bull3({ data: {} }))).toBeUndefined();
  });
});

describe('terminal attempt (shared with the collector)', () => {
  it.each([
    // [label, job, status, expected]
    [
      'Bull completed 1st',
      { attemptsMade: 0, progress: () => 0 },
      'completed',
      1,
    ],
    [
      'Bull completed 3rd',
      { attemptsMade: 2, progress: () => 0 },
      'completed',
      3,
    ],
    ['Bull failed 1st', { attemptsMade: 1, progress: () => 0 }, 'failed', 1],
    ['Bull failed 3rd', { attemptsMade: 3, progress: () => 0 }, 'failed', 3],
    [
      'BullMQ 1 completed 2nd',
      { attemptsMade: 2, updateProgress: () => 0, progress: 0 },
      'completed',
      2,
    ],
    [
      'BullMQ 1 failed 2nd',
      { attemptsMade: 2, updateProgress: () => 0, progress: 0 },
      'failed',
      2,
    ],
    [
      'BullMQ 5 completed 2nd',
      {
        attemptsMade: 1,
        attemptsStarted: 2,
        updateProgress: () => 0,
        progress: 0,
      },
      'completed',
      2,
    ],
    [
      'BullMQ 5 failed 2nd',
      {
        attemptsMade: 2,
        attemptsStarted: 2,
        updateProgress: () => 0,
        progress: 0,
      },
      'failed',
      2,
    ],
  ])('%s', (_label, job, status, expected) => {
    expect(terminalAttempts(job, status as 'completed' | 'failed')).toBe(
      expected
    );
  });

  it('takes the provider hint over the job shape (adapters hide the marker)', () => {
    expect(terminalAttempts({ attemptsMade: 2 }, 'completed', true)).toBe(2);
    expect(terminalAttempts({ attemptsMade: 2 }, 'completed', false)).toBe(3);
    expect(terminalAttempts(null, 'failed')).toBe(1);
  });
});
