import {
  AGENT_RUN_LOG_PREFIX,
  applyAgentRunDetail,
  createAgentRun,
  defaultIsEmpty,
  defaultSummarize,
  isAgentRunV1,
  parseAgentRunLine,
  recordedAgentRunDetail,
} from '../agent';
import type {
  AgentRunJobLike,
  AgentRunV1,
  CreateAgentRunOptions,
} from '../agent';

/**
 * `AiTrace` exactly as the brand pilot stores it today (the `RUN` of the
 * design file): no `detail`, `text` on every step, tool input/output inline.
 */
const BRAND_TRACE = {
  v: 1,
  model: 'gemini-3.8-flash',
  attempt: 1,
  startedAt: '2026-10-14T19:05:28.514Z',
  finishedAt: '2026-10-14T19:05:43.328Z',
  durationMs: 14814,
  inputTokens: 9534,
  outputTokens: 1057,
  steps: [
    {
      step: 1,
      startedAt: '2026-10-14T19:05:28.567Z',
      durationMs: 4086,
      finishReason: 'tool-calls',
      inputTokens: 2788,
      outputTokens: 154,
      text: '',
      tools: [
        {
          name: 'listRecipes',
          input: { meal: 'BREAKFAST' },
          output: { recipes: [] },
          summary: '0 resultados',
          ok: true,
          durationMs: 55,
        },
      ],
    },
    {
      step: 2,
      startedAt: '2026-10-14T19:05:32.657Z',
      durationMs: 7219,
      finishReason: 'tool-calls',
      inputTokens: 2962,
      outputTokens: 774,
      text: '',
      tools: [
        {
          name: 'proposeRecipe',
          input: {
            title: 'Crepioca recheada',
            meal: 'BREAKFAST',
            kcal: 220,
            ingredients: ['1 ovo inteiro', '2 colheres de sopa de tapioca'],
          },
          output: { ok: true, message: 'Sugestão pronta.' },
          summary: 'objeto (ok, message)',
          ok: true,
          durationMs: 0,
        },
      ],
    },
    {
      step: 3,
      startedAt: '2026-10-14T19:05:39.879Z',
      durationMs: 3431,
      finishReason: 'stop',
      inputTokens: 3784,
      outputTokens: 129,
      text: 'Emanuelli, separei uma opção de **crepioca recheada**.',
      tools: [],
    },
  ],
  final: {
    text: 'Emanuelli, separei uma opção de **crepioca recheada**.',
    cards: [{ type: 'RECIPE', title: 'Crepioca recheada' }],
  },
  error: null,
};

/** Architecture § 1.5: the same run, written by the helper at `basic`. */
const BASIC_LINE =
  AGENT_RUN_LOG_PREFIX +
  '{"v":1,"detail":"basic","model":"gemini-3.8-flash","attempt":1,' +
  '"startedAt":"2026-10-14T19:05:28.514Z","finishedAt":"2026-10-14T19:05:43.328Z","durationMs":14814,' +
  '"inputTokens":9534,"outputTokens":1057,"input":{"conversationId":"c-7f21"},' +
  '"steps":[' +
  '{"step":1,"startedAt":"2026-10-14T19:05:28.567Z","durationMs":4086,"finishReason":"tool-calls","inputTokens":2788,"outputTokens":154,' +
  '"tools":[{"name":"listRecipes","ok":true,"durationMs":55,"summary":"0 resultados","empty":true,"startedAt":"2026-10-14T19:05:32.594Z","outputChars":14}]},' +
  '{"step":2,"startedAt":"2026-10-14T19:05:32.657Z","durationMs":7219,"finishReason":"tool-calls","inputTokens":2962,"outputTokens":774,' +
  '"tools":[{"name":"proposeRecipe","ok":true,"durationMs":0,"summary":"objeto (ok, message)","empty":false,"startedAt":"2026-10-14T19:05:39.876Z","outputChars":79}]},' +
  '{"step":3,"startedAt":"2026-10-14T19:05:39.879Z","durationMs":3431,"finishReason":"stop","inputTokens":3784,"outputTokens":129,"tools":[]}],' +
  '"final":{"cards":[{"type":"RECIPE","title":"Crepioca recheada"}]},"error":null}';

const SECRET = 'S3CRET';

/** Job double that records every line written to its log. */
const fakeJob = (
  log: (row: string) => Promise<unknown> = async () => undefined
): AgentRunJobLike & { rows: string[] } => {
  const rows: string[] = [];
  return {
    attemptsMade: 0,
    rows,
    log(row: string) {
      rows.push(row);
      return log(row);
    },
  };
};

const runLine = (rows: string[]) =>
  rows.find((row) => row.startsWith(AGENT_RUN_LOG_PREFIX));

/**
 * Paths a `basic` run must never carry, found by walking the whole object.
 * Anything under a tool other than the content-free keys, `text` on a step,
 * `final.text` and `input.text`.
 */
function forbiddenAtBasic(run: unknown): string[] {
  const hits: string[] = [];
  const walk = (value: unknown, path: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, [...path, String(i)]));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      const at = [...path, key];
      const parent = path.filter((p) => !/^\d+$/.test(p)).join('.');
      const isTool = parent === 'steps.tools';
      const isStep = parent === 'steps';
      if (isTool && ['input', 'output', 'error'].includes(key)) {
        hits.push(at.join('.'));
      }
      if (isStep && key === 'text') hits.push(at.join('.'));
      if ((parent === 'final' || parent === 'input') && key === 'text') {
        hits.push(at.join('.'));
      }
      walk(child, at);
    }
  };
  walk(run, []);
  return hits;
}

/** A run that touches every content field, each carrying the SECRET marker. */
async function recordRichRun(
  options: Partial<CreateAgentRunOptions> = {},
  close: 'finish' | 'fail' = 'finish',
  steps = 2
) {
  const job = fakeJob();
  const recorder = createAgentRun({
    job,
    model: 'gemini-3.8-flash',
    input: { conversationId: 'c-1', text: `user says ${SECRET}` },
    ...options,
  });
  for (let i = 0; i < steps; i++) {
    recorder.stepStart(i);
    recorder.tool({
      stepNumber: i,
      name: 'getHealthSummary',
      input: { query: `${SECRET} input` },
      durationMs: 12,
      success: true,
      output: { summary: `${SECRET} diabetes`, items: [`${SECRET}`] },
    });
    recorder.tool({
      stepNumber: i,
      name: 'saveCard',
      input: { card: SECRET },
      durationMs: 3,
      success: false,
      error: new Error(`${SECRET} tool error`),
    });
    recorder.stepFinish({
      stepNumber: i,
      finishReason: i === steps - 1 ? 'stop' : 'tool-calls',
      usage: { inputTokens: 100, outputTokens: 10 },
      text: `step text ${SECRET}`,
    });
  }
  if (close === 'finish') {
    await recorder.finish(`final ${SECRET}`, [
      { type: 'RECIPE', title: 'Crepioca' },
    ]);
  } else {
    await recorder.fail(new Error('LLM quota exceeded'));
  }
  const line = runLine(job.rows) as string;
  return { recorder, job, line, run: parseAgentRunLine(line) as AgentRunV1 };
}

describe('agent run contract', () => {
  it('accepts the brand AiTrace as a valid AgentRunV1', () => {
    expect(isAgentRunV1(BRAND_TRACE)).toBe(true);
    const parsed = parseAgentRunLine(
      AGENT_RUN_LOG_PREFIX + JSON.stringify(BRAND_TRACE)
    );
    expect(parsed).toEqual(BRAND_TRACE);
    // No `detail` = legacy payload, treated as full.
    expect(recordedAgentRunDetail(parsed as AgentRunV1)).toBe('full');
  });

  it('parses the documented basic example', () => {
    const run = parseAgentRunLine(BASIC_LINE) as AgentRunV1;
    expect(run).not.toBeNull();
    expect(run.detail).toBe('basic');
    expect(run.steps).toHaveLength(3);
    expect(run.steps[0].tools[0]).toMatchObject({
      empty: true,
      outputChars: 14,
    });
    expect(forbiddenAtBasic(run)).toEqual([]);
  });

  it('cuts a legacy brand trace down to basic', () => {
    const cut = applyAgentRunDetail(BRAND_TRACE as AgentRunV1, 'basic');
    expect(cut.detail).toBe('basic');
    expect(forbiddenAtBasic(cut)).toEqual([]);
    expect(cut.final).toEqual({
      cards: [{ type: 'RECIPE', title: 'Crepioca recheada' }],
    });
    expect(cut.inputTokens).toBe(9534);
    // The source is not mutated.
    expect(BRAND_TRACE.steps[2].text).toContain('crepioca');
  });

  it('ignores anything that is not a well-formed run line', () => {
    expect(parseAgentRunLine('[início] modelo x')).toBeNull();
    expect(parseAgentRunLine(AGENT_RUN_LOG_PREFIX + '{not json')).toBeNull();
    expect(
      parseAgentRunLine(AGENT_RUN_LOG_PREFIX + JSON.stringify({ v: 2 }))
    ).toBeNull();
    expect(
      parseAgentRunLine(
        AGENT_RUN_LOG_PREFIX +
          JSON.stringify({ ...BRAND_TRACE, inputTokens: '9534' })
      )
    ).toBeNull();
    expect(
      parseAgentRunLine(
        AGENT_RUN_LOG_PREFIX +
          JSON.stringify({ ...BRAND_TRACE, model: 'x'.repeat(600 * 1024) })
      )
    ).toBeNull();
    expect(parseAgentRunLine(undefined)).toBeNull();
  });
});

describe('createAgentRun detail cut', () => {
  it('defaults to basic', async () => {
    const { run, line } = await recordRichRun();
    expect(run.detail).toBe('basic');
    expect(forbiddenAtBasic(run)).toEqual([]);
    expect(line).not.toContain(SECRET);
  });

  it('treats `ai: true`-style configs and unknown levels as basic', async () => {
    for (const agent of [{}, { detail: 'FULL' as any }, { jobs: ['reply'] }]) {
      const { run, line } = await recordRichRun({ agent });
      expect(run.detail).toBe('basic');
      expect(line).not.toContain(SECRET);
    }
  });

  it('never writes content at basic on the fail() path', async () => {
    const { run, line } = await recordRichRun({}, 'fail');
    expect(forbiddenAtBasic(run)).toEqual([]);
    expect(line).not.toContain(SECRET);
    expect(run.error).toBe('LLM quota exceeded');
  });

  it('never writes content at basic on the 64 KB degradation path', async () => {
    const { run, line } = await recordRichRun(
      { limits: { lineBytes: 4000 } },
      'finish',
      20
    );
    expect(run.truncated).toBe(true);
    expect(forbiddenAtBasic(run)).toEqual([]);
    expect(line).not.toContain(SECRET);
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(4000);
  });

  it('fits the default 64 KB line even at the step and tool caps', async () => {
    const job = fakeJob();
    const recorder = createAgentRun({
      job,
      model: 'm',
      summarize: () => 's'.repeat(200),
    });
    for (let i = 0; i < 50; i++) {
      recorder.stepStart(i);
      for (let j = 0; j < 50; j++) {
        recorder.tool({
          stepNumber: i,
          name: `tool-${j}`,
          input: SECRET,
          durationMs: 1,
          success: true,
          output: SECRET,
        });
      }
      recorder.stepFinish({ stepNumber: i, text: SECRET });
    }
    await recorder.finish(SECRET);
    const line = runLine(job.rows) as string;
    const run = parseAgentRunLine(line) as AgentRunV1;
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(64 * 1024);
    expect(run.truncated).toBe(true);
    expect(run.steps).toHaveLength(50);
    expect(line).not.toContain(SECRET);
  });

  it('keeps the content at full, while recorder.run stays uncut', async () => {
    const { run, recorder } = await recordRichRun({ detail: 'full' });
    expect(run.detail).toBe('full');
    expect(run.steps[0].text).toContain(SECRET);
    expect(run.steps[0].tools[1].error).toContain(SECRET);
    expect(run.final?.text).toContain(SECRET);
    expect(run.input?.text).toContain(SECRET);
    expect(recorder.run.steps[0].tools[0].output).toBeDefined();
  });

  it('an explicit detail beats the queue config', async () => {
    const { run } = await recordRichRun({
      agent: { detail: 'full' },
      detail: 'basic',
    });
    expect(run.detail).toBe('basic');
  });

  it('degrades a full run in order: outputs, inputs, texts', async () => {
    const big = 'x'.repeat(1800);
    const job = fakeJob();
    const recorder = createAgentRun({
      job,
      model: 'm',
      detail: 'full',
      limits: { lineBytes: 5000 },
    });
    recorder.stepStart(0);
    for (let i = 0; i < 3; i++) {
      recorder.tool({
        stepNumber: 0,
        name: 't',
        input: { q: 'small' },
        durationMs: 1,
        success: true,
        output: { big },
      });
    }
    recorder.stepFinish({ stepNumber: 0, text: 'kept' });
    await recorder.finish('done');
    const run = parseAgentRunLine(runLine(job.rows) as string) as AgentRunV1;
    expect(run.truncated).toBe(true);
    expect(run.steps[0].tools.every((t) => t.output === undefined)).toBe(true);
    // Inputs and texts were small enough to survive the first degradation.
    expect(run.steps[0].tools[0].input).toEqual({ q: 'small' });
    expect(run.steps[0].text).toBe('kept');
  });
});

describe('createAgentRun limits', () => {
  it('caps tool output/input, texts, errors and summaries', async () => {
    const job = fakeJob();
    const recorder = createAgentRun({
      job,
      model: 'm',
      detail: 'full',
      summarize: () => 's'.repeat(500),
    });
    recorder.tool({
      stepNumber: 0,
      name: 'big',
      input: 'i'.repeat(5000),
      durationMs: 1,
      success: true,
      output: 'o'.repeat(5000),
    });
    recorder.tool({
      stepNumber: 0,
      name: 'broken',
      input: null,
      durationMs: 1,
      success: false,
      error: 'e'.repeat(1000),
    });
    recorder.stepFinish({ stepNumber: 0, text: 't'.repeat(9000) });
    await recorder.fail('r'.repeat(2000));

    const [ok, broken] = recorder.run.steps[0].tools;
    expect(ok.output).toMatchObject({ truncated: true, chars: 5002 });
    expect((ok.output as any).preview).toHaveLength(2048);
    expect(ok.input).toMatchObject({ truncated: true, chars: 5002 });
    expect(ok.outputChars).toBe(5002);
    expect(ok.summary.startsWith('s'.repeat(120) + '…')).toBe(true);
    expect(broken.error?.startsWith('e'.repeat(200) + '…')).toBe(true);
    expect(recorder.run.steps[0].text?.startsWith('t'.repeat(4000) + '…')).toBe(
      true
    );
    expect(recorder.run.error?.startsWith('r'.repeat(500) + '…')).toBe(true);
  });

  it('caps steps, tools per step and cards, keeping the token totals', async () => {
    const job = fakeJob();
    const recorder = createAgentRun({ job, model: 'm' });
    for (let i = 0; i < 60; i++) {
      recorder.stepStart(i);
      recorder.stepFinish({
        stepNumber: i,
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    }
    for (let i = 0; i < 60; i++) {
      recorder.tool({
        stepNumber: 0,
        name: 't',
        input: null,
        durationMs: 1,
        success: true,
      });
    }
    await recorder.finish(
      '',
      Array.from({ length: 30 }, (_, i) => ({ type: 'C', title: String(i) }))
    );
    expect(recorder.run.steps).toHaveLength(50);
    expect(recorder.run.steps[0].tools).toHaveLength(50);
    expect(recorder.run.final?.cards).toHaveLength(20);
    expect(recorder.run.inputTokens).toBe(60);
  });

  it('positions tools by end - duration and maps the 0-based SDK step', async () => {
    let t = Date.parse('2026-10-14T19:05:28.000Z');
    const job = fakeJob();
    const recorder = createAgentRun({
      job,
      model: 'm',
      now: () => new Date(t),
    });
    recorder.stepStart(0);
    t += 1000;
    recorder.tool({
      stepNumber: 0,
      name: 'x',
      input: {},
      durationMs: 400,
      success: true,
      output: [],
    });
    expect(recorder.run.steps[0].step).toBe(1);
    expect(recorder.run.steps[0].tools[0]).toMatchObject({
      startedAt: '2026-10-14T19:05:28.600Z',
      empty: true,
      summary: '0 results',
    });
  });

  it('defaults the attempt to attemptsMade + 1', () => {
    const job = { ...fakeJob(), attemptsMade: 2 };
    expect(createAgentRun({ job, model: 'm' }).run.attempt).toBe(3);
  });
});

describe('createAgentRun never throws', () => {
  // The processor below is what an app would write: awaiting the recorder
  // must never change what the processor returns.
  const processor = async (job: AgentRunJobLike, onError = jest.fn()) => {
    const recorder = createAgentRun({
      job,
      model: 'm',
      onError,
      limits: { writeTimeoutMs: 20 },
    });
    recorder.stepStart(0);
    recorder.note('context line');
    recorder.stepFinish({ stepNumber: 0 });
    await recorder.finish('ok');
    await recorder.fail('late'); // ignored: already closed
    return 'processor result';
  };

  it('survives a log that throws synchronously', async () => {
    const onError = jest.fn();
    const job = {
      attemptsMade: 0,
      log: () => {
        throw new Error('sync boom');
      },
    };
    await expect(processor(job, onError)).resolves.toBe('processor result');
    expect(onError).toHaveBeenCalled();
  });

  it('survives a log that rejects', async () => {
    const onError = jest.fn();
    const job = fakeJob(() => Promise.reject(new Error('redis down')));
    await expect(processor(job, onError)).resolves.toBe('processor result');
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('survives a log that never resolves', async () => {
    const onError = jest.fn();
    const job = fakeJob(() => new Promise(() => undefined));
    await expect(processor(job, onError)).resolves.toBe('processor result');
    expect(onError).toHaveBeenCalled();
  });

  it('survives throwing callbacks and unserializable values', async () => {
    const job = fakeJob();
    const circular: any = { a: 1 };
    circular.self = circular;
    const recorder = createAgentRun({
      job,
      model: 'm',
      detail: 'full',
      summarize: () => {
        throw new Error('summary');
      },
      isEmpty: () => {
        throw new Error('empty');
      },
      onEvent: () => {
        throw new Error('event');
      },
      onError: () => {
        throw new Error('even onError');
      },
      now: () => {
        throw new Error('clock');
      },
    });
    recorder.tool({
      stepNumber: 0,
      name: 'c',
      input: circular,
      durationMs: 1,
      success: true,
      output: { n: BigInt(1) },
    });
    await expect(recorder.finish('ok')).resolves.toBeUndefined();
    const run = parseAgentRunLine(runLine(job.rows) as string) as AgentRunV1;
    expect(run.steps[0].tools[0].summary).toBe('?');
    expect(run.steps[0].tools[0].empty).toBeUndefined();
    expect(typeof run.steps[0].tools[0].input).toBe('string');
  });

  it('writes exactly one run line per attempt', async () => {
    const job = fakeJob();
    const recorder = createAgentRun({ job, model: 'm' });
    recorder.note(AGENT_RUN_LOG_PREFIX + '{"spoof":true}');
    await recorder.finish('a');
    await recorder.finish('b');
    await recorder.fail('c');
    expect(
      job.rows.filter((r) => r.startsWith(AGENT_RUN_LOG_PREFIX))
    ).toHaveLength(1);
  });

  it('returns a working no-op recorder for nonsense options', async () => {
    const recorder = createAgentRun(undefined as any);
    recorder.stepStart();
    await expect(recorder.finish('x')).resolves.toBeUndefined();
  });
});

describe('default summarize / isEmpty', () => {
  it('describes the shape, never the value', () => {
    expect(defaultSummarize('t', null)).toBe('no output');
    expect(defaultSummarize('t', [1, 2])).toBe('2 results');
    expect(defaultSummarize('t', { recipes: [1] })).toBe('1 result');
    expect(defaultSummarize('t', { a: [1], b: [] })).toBe('a: 1, b: 0');
    expect(defaultSummarize('t', { ok: false, error: SECRET })).toBe('refused');
    expect(defaultSummarize('t', { a: SECRET, b: 2 })).toBe('object (a, b)');
    expect(defaultSummarize('t', SECRET)).toBe('string (6 chars)');
    expect(defaultSummarize('t', 42)).toBe('number');
    expect(defaultSummarize('t', true)).toBe('boolean');
  });

  it('flags results with nothing useful', () => {
    expect(defaultIsEmpty('t', null)).toBe(true);
    expect(defaultIsEmpty('t', [])).toBe(true);
    expect(defaultIsEmpty('t', {})).toBe(true);
    expect(defaultIsEmpty('t', { a: [], b: [] })).toBe(true);
    expect(defaultIsEmpty('t', { a: [], b: [1] })).toBe(false);
    expect(defaultIsEmpty('t', { ok: true })).toBe(false);
    expect(defaultIsEmpty('t', 0)).toBe(false);
  });
});

describe('createAgentRun: QA 004 fixes', () => {
  // Real job classes of the two libs, no Redis: only their shape matters.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BullJob = require('bull/lib/job');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Job: BullMQJob } = require('bullmq');
  const bullJob = (attemptsMade: number, rows: string[]) => {
    const job = new BullJob({ toKey: () => 'k' }, 'reply', {}, {});
    job.attemptsMade = attemptsMade;
    job.log = async (row: string) => rows.push(row);
    return job;
  };
  const bullmqJob = (attemptsMade: number, rows: string[]) => {
    const job = new BullMQJob({ toKey: () => 'k' }, 'reply', {}, {});
    job.attemptsMade = attemptsMade;
    job.log = async (row: string) => rows.push(row);
    return job;
  };
  const attemptOf = async (job: AgentRunJobLike, rows: string[]) => {
    await createAgentRun({ job, model: 'm' }).finish('ok');
    return parseAgentRunLine(rows[rows.length - 1])?.attempt;
  };

  it('numbers the attempt right on Bull v3 (attemptsMade bumps on failure)', async () => {
    const rows: string[] = [];
    // Inside the processor: attempt 1 sees 0, attempt 2 sees 1.
    expect(await attemptOf(bullJob(0, rows), rows)).toBe(1);
    expect(await attemptOf(bullJob(1, rows), rows)).toBe(2);
  });

  it('numbers the attempt right on BullMQ 1.x (attemptsMade bumps on activation)', async () => {
    const rows: string[] = [];
    // moveJobFromWaitToActive does HINCRBY attemptsMade 1: attempt 1 sees 1.
    expect(await attemptOf(bullmqJob(1, rows), rows)).toBe(1);
    expect(await attemptOf(bullmqJob(2, rows), rows)).toBe(2);
  });

  it('prefers attemptsStarted (BullMQ 5+) and keeps an explicit attempt', async () => {
    const rows: string[] = [];
    const job = Object.assign(bullmqJob(1, rows), { attemptsStarted: 2 });
    expect(await attemptOf(job, rows)).toBe(2);
    await createAgentRun({ job, model: 'm', attempt: 7 }).finish('ok');
    expect(parseAgentRunLine(rows[rows.length - 1])?.attempt).toBe(7);
  });

  it('writes the skeleton when the app breaks recorder.run before finish', async () => {
    const rows: string[] = [];
    const errors: unknown[] = [];
    const rec = createAgentRun({
      job: { attemptsMade: 0, log: async (r) => rows.push(r) },
      model: 'm',
      detail: 'full',
      onError: (e) => errors.push(e),
    });
    rec.stepFinish({ usage: { inputTokens: 3, outputTokens: 2 } });
    rec.tool({ name: 't', input: 1, durationMs: 1, success: true, output: 1 });
    const cyclic: any = {};
    cyclic.self = cyclic;
    (rec.run.steps[0].tools[0] as any).output = cyclic;
    await rec.finish('ok');
    await rec.fail(new Error('late'));
    expect(rows).toHaveLength(1);
    const parsed = parseAgentRunLine(rows[0]);
    expect(parsed).toMatchObject({
      detail: 'basic',
      truncated: true,
      inputTokens: 3,
      outputTokens: 2,
      error: null,
    });
    expect(parsed?.steps[0].tools).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('keeps one bad card from costing the others', async () => {
    const rows: string[] = [];
    const rec = createAgentRun({
      job: { attemptsMade: 0, log: async (r) => rows.push(r) },
      model: 'm',
    });
    const bad = {
      type: 'X',
      get title(): string {
        throw new Error('getter');
      },
    };
    await rec.finish('ok', [bad as any, { type: 'Y', title: 'fine' }]);
    expect(parseAgentRunLine(rows[0])?.final?.cards).toEqual([
      { type: 'X', title: '' },
      { type: 'Y', title: 'fine' },
    ]);
  });

  it('ignores every non-numeric limit, not only lineBytes', async () => {
    const rows: string[] = [];
    const rec = createAgentRun({
      job: { attemptsMade: 0, log: async (r) => rows.push(r) },
      model: 'm',
      detail: 'full',
      limits: {
        textChars: undefined,
        writeTimeoutMs: undefined,
        steps: -1,
        toolsPerStep: NaN,
      },
    });
    rec.stepFinish({ text: 'x'.repeat(5000) });
    rec.tool({ name: 't', input: 1, durationMs: 1, success: true, output: 1 });
    await rec.finish('ok');
    const parsed = parseAgentRunLine(rows[0]);
    expect(parsed?.steps).toHaveLength(1);
    expect(parsed?.steps[0].tools).toHaveLength(1);
    expect(parsed?.steps[0].text).toMatch(/… \(\+1000\)$/);
  });

  it('keeps a content-free summary for a failed tool: the error class only', async () => {
    const rows: string[] = [];
    const rec = createAgentRun({
      job: { attemptsMade: 0, log: async (r) => rows.push(r) },
      model: 'm',
    });
    const named = new Error('SECRET message');
    named.name = 'SECRET name';
    rec.tool({
      name: 'a',
      input: 1,
      durationMs: 1,
      success: false,
      error: new TypeError('SECRET'),
    });
    rec.tool({
      name: 'b',
      input: 1,
      durationMs: 1,
      success: false,
      error: named,
    });
    rec.tool({
      name: 'c',
      input: 1,
      durationMs: 1,
      success: false,
      error: 'SECRET string',
    });
    await rec.finish('ok');
    expect(rows[0]).not.toContain('SECRET');
    const tools = parseAgentRunLine(rows[0])?.steps[0].tools;
    expect(tools?.map((t) => t.summary)).toEqual([
      'failed: TypeError',
      'failed: Error',
      'failed',
    ]);
  });

  it('omits steps[].text when the step wrote nothing (full)', async () => {
    const rows: string[] = [];
    const rec = createAgentRun({
      job: { attemptsMade: 0, log: async (r) => rows.push(r) },
      model: 'm',
      detail: 'full',
    });
    rec.stepStart(0);
    rec.stepFinish({ stepNumber: 0, finishReason: 'tool-calls' });
    rec.stepFinish({ stepNumber: 1, finishReason: 'stop', text: 'done' });
    await rec.finish('ok');
    const steps = parseAgentRunLine(rows[0])?.steps ?? [];
    expect('text' in steps[0]).toBe(false);
    expect(steps[1].text).toBe('done');
    // A legacy line with "" is served without the key too.
    const legacy = applyAgentRunDetail(
      {
        ...(parseAgentRunLine(rows[0]) as AgentRunV1),
        steps: [{ ...steps[0], text: '' }],
      },
      'full'
    );
    expect('text' in legacy.steps[0]).toBe(false);
  });
});
