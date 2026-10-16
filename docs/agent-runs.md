# AI agent runs (contract v1)

Bull Horizon can show the jobs of an AI agent queue as **agent runs**: every
LLM step, every tool call, tokens, timing and an estimated cost, instead of an
opaque job with a wall of log lines. You declare which queue is an agent queue,
record each attempt with the `createAgentRun` helper inside your worker, and the
dashboard does the rest. No custom UI per app.

What you get:

- **Run view** (per job): the attempt as a graph (request, LLM steps, tools,
  response) with a side panel for the selected node, or as a waterfall over
  time with tokens per step. One run per attempt, so a failed attempt and its
  retry sit side by side.
- **Agents screen** in the sidebar (only shown when at least one queue is an
  agent queue):
  - **Metrics**: latency p50/p95 over time, steps per run, tool stats (calls,
    average duration, error rate, empty results), tokens and cost per model, and
    how runs ended (`stop`, `max-steps`, `error`...).
  - **Runs**: recent runs with their tool chain, filters (failed, empty tool,
    slower than 15 s) and sorting (recent, slowest, costliest).

## How it works

```text
worker (your app)                               Redis                 monitor
generateText callbacks -> createAgentRun --finish/fail--> <job>:logs <-- reads the line
                                                     (one line per attempt)
                                                                     collector: completed/failed
                                                                     -> rollups + recent runs index
```

1. The helper accumulates the attempt in memory while the AI SDK callbacks fire.
2. On `finish()` or `fail()` it cuts the run to the configured **detail level**,
   applies size caps, and appends **one** line to `job.log`.
3. The dashboard reads that line on demand (Run view). The metrics collector
   reads it when the job emits `completed`/`failed` and folds it into the
   Metrics and Runs aggregates.

The level is applied **in your process, before Redis**. The dashboard never
receives what the level does not allow.

## Setup

### 1. Declare the agent queue in the monitor

`ai` goes on the queue adapter, next to `group`. Pricing is global, on the
monitor config.

```typescript
import { BullMonitorExpress } from '@bull-horizon/express';
import { BullAdapter } from '@bull-horizon/root/dist/bull-adapter';
import type { AgentQueueConfig } from '@bull-horizon/root';

// Shared with the worker (see below).
export const AI_AGENT: AgentQueueConfig = {
  jobs: ['reply'],      // job names that are agent runs; omit = every job
  detail: 'basic',      // 'basic' (default) or 'full'
  label: 'Assistants',  // name on the Agents screen; default = queue name
};

const monitor = new BullMonitorExpress({
  queues: [
    new BullAdapter(aiQueue, { group: 'AI', ai: AI_AGENT }),
    new BullAdapter(pushQueue, { group: 'App' }),
  ],
  metrics: {}, // required for the Metrics and Runs tabs
  ai: {
    pricing: {
      // USD per 1M tokens. Key = model name as recorded in the run.
      'gemini-3.8-flash': { input: 0.75, output: 3.75 },
    },
    recentRuns: 2000, // size of the recent runs index per queue (default)
  },
});
```

Options:

| Where | Field | Default | Meaning |
|---|---|---|---|
| queue | `ai: true` | | Every job is a run, `basic` level, label = queue name |
| queue | `ai.jobs` | all jobs | Job names treated as runs. Others in the same queue stay plain jobs |
| queue | `ai.detail` | `'basic'` | Level the server serves (see below). Anything other than `'full'` is `basic` |
| queue | `ai.label` | queue name | Agent name on the Agents screen |
| monitor | `ai.pricing` | `{}` | `{ [model]: { input, output } }`, USD per 1M tokens |
| monitor | `ai.recentRuns` | `2000` | Entries kept in the per-queue recent runs index |

`BullMQAdapter` takes the same options.

### 2. Record the run in the worker

`createAgentRun` is exported by `@bull-horizon/root`. It has no dependencies
(no `ai` import, no Redis client): it only needs the job's `log()` and
`attemptsMade`, which both Bull and BullMQ jobs have, including Bull sandboxed
processors.

The attempt number comes from the job, and the libraries count differently
inside the processor: Bull v3 bumps `attemptsMade` only when an attempt fails
(attempt N sees `N - 1`), BullMQ 1.x to 4.x bumps it when the job becomes
active (attempt N sees `N`), and BullMQ 5+ counts activations in
`attemptsStarted`. The helper handles all three (`defaultAgentRunAttempt`):
`attemptsStarted` when present, `attemptsMade` as is on a BullMQ job (it has
`updateProgress()`), `attemptsMade + 1` otherwise. If you pass a plain object
instead of the real job (e.g. a wrapper in a sandboxed processor), pass
`attempt` explicitly.

Pass **the same `AgentQueueConfig` object** to the monitor and to the helper.
The level is enforced where the helper runs; the monitor uses its copy to cut
again when serving and to flag a mismatch.

```typescript
import { generateText, stepCountIs } from 'ai';
import { createAgentRun } from '@bull-horizon/root';
import { AI_AGENT } from './ai-queue.constants';

async function runAgent(job: Job<{ messageId: string }>) {
  const recorder = createAgentRun({
    job,
    model: 'gemini-3.8-flash',      // the key used in ai.pricing
    agent: AI_AGENT,                // source of the detail level
    input: { conversationId },      // optional; input.text is full-only
    onError: (err) => logger.warn(`agent run trace: ${String(err)}`),
  });

  try {
    const result = await generateText({
      model,
      system,
      messages,
      tools,
      stopWhen: stepCountIs(6),
      experimental_onStepStart: ({ stepNumber }) => recorder.stepStart(stepNumber),
      experimental_onToolCallFinish: (event) =>
        recorder.tool({
          stepNumber: event.stepNumber,
          name: event.toolCall.toolName,
          input: event.toolCall.input,
          durationMs: event.durationMs,
          success: event.success,
          output: event.success ? event.output : undefined,
          error: event.success ? undefined : event.error,
        }),
      onStepFinish: (event) => recorder.stepFinish(event),
    });

    await recorder.finish(result.text, cards); // cards: [{ type, title }]
    return result.text;
  } catch (err) {
    // If the error can echo the prompt, sanitize it first (see "Which level
    // to use"): pass the same safe error to fail() and rethrow it.
    await recorder.fail(err);
    throw err; // keep Bull's retry semantics
  }
}
```

The callback names above are the AI SDK v6 ones used by the pilot app
(`experimental_onStepStart`, `experimental_onToolCallFinish`, `onStepFinish`).
`stepFinish` reads `stepNumber`, `finishReason`, `usage.inputTokens`,
`usage.outputTokens` and `text` from the event, so the step result can be passed
as is. `stepNumber` is the SDK's 0-based index; the run stores steps 1-based.

#### In a NestJS processor (`@nestjs/bull`)

```typescript
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { createAgentRun } from '@bull-horizon/root';
import { AI_AGENT, AI_QUEUE } from './ai-queue.constants';

@Processor(AI_QUEUE)
export class AiProcessor {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(private readonly replies: AiReplyService) {}

  @Process({ name: 'reply', concurrency: 4 })
  async reply(job: Job<{ messageId: string }>) {
    const recorder = createAgentRun({
      job,
      model: this.replies.modelName(),
      agent: AI_AGENT,
      onError: (err) => this.logger.warn(`trace ${job.id}: ${String(err)}`),
    });
    // The service wires recorder.* into generateText and awaits finish/fail
    // before returning or rethrowing.
    await this.replies.run(job.data.messageId, recorder);
  }
}
```

Register the monitor itself as a Nest provider that extends the adapter and
receives the injected queues:

```typescript
@Injectable()
export class BullMonitorService extends BullMonitorExpress {
  constructor(@InjectQueue(AI_QUEUE) ai: Queue, @InjectQueue(PUSH_QUEUE) push: Queue) {
    super({
      queues: [
        new BullAdapter(ai, { group: 'AI', ai: AI_AGENT }),
        new BullAdapter(push, { group: 'App' }),
      ],
      metrics: {},
      ai: { pricing: { 'gemini-3.8-flash': { input: 0.75, output: 3.75 } } },
    });
  }
}
```

### 3. Keep the job (retention requirement)

**An agent queue must not use `removeOnComplete: true` or `removeOnFail: true`.**
`true` removes the job, and its logs, in the same Redis script that emits the
terminal event. By the time the collector reads it, the run is gone: it is
counted as **lost** and the dashboard shows a warning.

Use a number (keep the last N) or, on Bull 4+ and BullMQ, an age:

```typescript
await aiQueue.add('reply', data, {
  attempts: 2,
  removeOnComplete: 500,          // or { age: 24 * 3600, count: 1000 }
  removeOnFail: 500,
});
```

The run lives exactly as long as the job: lowering N (or the age) also lowers
how long recorded content stays readable in Redis.

In a queue that mixes agent and non-agent jobs (`ai.jobs`), a removed job is
counted as lost before its name can be checked, so give the non-agent jobs a
numeric retention too, or keep them in another queue.

## Helper API

```typescript
createAgentRun(options: CreateAgentRunOptions): AgentRunRecorder
```

| Option | Default | |
|---|---|---|
| `job` | required | Anything with `attemptsMade: number` and `log(row): Promise` (Bull and BullMQ jobs as they are) |
| `model` | required | Model name; used for pricing (case-insensitive exact match) |
| `agent` | | `AgentQueueConfig`; its `detail` is the level |
| `detail` | `agent.detail`, else `'basic'` | Explicit level; wins over `agent` |
| `attempt` | from the job (see above) | 1-based; pass it when `job` is not a real Bull/BullMQ job |
| `input` | | `{ conversationId?, text? }`; `text` is kept at `full` only |
| `summarize` | content-free default | `(tool, output) => string`, the tool summary (see below) |
| `isEmpty` | default | `(tool, output) => boolean`, marks "tool answered nothing" |
| `onEvent` | | Sync hook per event (`start`, `step-finish`, `tool`, `finish`, `fail`); errors swallowed |
| `onError` | | Diagnostics for the helper's own failures; never rethrown |
| `limits` | see Limits | `Partial<AgentRunLimits>`; a key that is `undefined`, not a number or not positive keeps the default |
| `now` | `() => new Date()` | Clock, for tests |

| Recorder member | |
|---|---|
| `stepStart(stepNumber?)` | `experimental_onStepStart` |
| `stepFinish({ stepNumber?, finishReason?, usage?, text? })` | `onStepFinish` |
| `tool({ stepNumber?, name, input, durationMs, success, output?, error? })` | `experimental_onToolCallFinish`, normalized |
| `finish(text, cards?)` | Closes as success and writes the line. Resolves after `job.log` settles or `writeTimeoutMs` (5 s). Never rejects |
| `fail(err)` | Closes as failure (`error` = message, 500 chars) and writes the line. Never rejects |
| `skip(reason?)` | Closes the attempt as deliberately skipped (it ends without calling the model) and writes a skip line instead of a run. Never rejects. See "Skipped attempts" |
| `note(line)` | Plain-text line in the job log, fire-and-forget, clipped to `textChars` (4000). **Not cut by the detail level**: written as-is at `basic` too, so never put sensitive content in a note. A note that starts with the run prefix is dropped |
| `run` | The whole run (capped, **not** cut by level), for your app to keep elsewhere (e.g. your database). Only the cut reaches Redis |

Rules:

- **It never throws nor rejects**, whatever the job, your callbacks or Redis
  do. A Redis hiccup must not become a job failure: for an agent, a retry is
  another paid LLM call. If even constructing the recorder fails, you get a
  no-op recorder with the same surface.
- `finish`/`fail`/`skip` are idempotent: only the first call writes.
- A bad value never costs the whole line: tool inputs/outputs are copied when
  `tool()` is called (mutating your object afterwards changes nothing), a card
  whose field throws is stored with that field empty, and if the line still
  cannot be built (e.g. you mutated `recorder.run` into something
  unserializable) the helper writes the `basic` skeleton without tools,
  flagged `truncated`, and reports the cause to `onError`. Since a line is
  always written, a later `fail()` after such a `finish()` is ignored.
- **`await` `finish`/`fail` before the processor returns or rethrows.** That
  puts the line in Redis before the `completed`/`failed` event. Without
  `await` it still works most of the time: the collector re-reads once, 2 s
  later, if the line of the attempt that just ended is not there yet (told by
  time: no line finished after the job's `processedOn`), even when lines of
  earlier attempts were new on that event.
- If the process dies before `finish`/`fail`, that attempt has no line and
  shows as a plain job attempt.

### Skipped attempts

An agent job may legitimately end without calling the model (content already
fresh, message already answered). Without a line it would count as
`unrecorded`, the signal for "worker not instrumented". Mark it instead:

```typescript
const recorder = createAgentRun({ job, model, agent: AI_AGENT });
if (alreadyAnswered) {
  await recorder.skip('already-answered');
  return;
}

// A code path that never created a recorder:
import { markAgentRunSkipped } from '@bull-horizon/root';
await markAgentRunSkipped(job, { agent: AI_AGENT, reason: 'content-fresh' });
```

Both write one line,
`bull-horizon:agent-run-skip {"v":1,"attempt":N,"reason":"...","at":"ISO"}`,
with the attempt taken from the job like `createAgentRun` does (or
`attempt` in the options). The first of `finish`/`fail`/`skip` wins, so a
`skip()` after `finish()` is ignored. They never throw nor reject.

**`reason` is a short id-like label** (`already-answered`,
`content-fresh`), clipped to 120 chars and written at any detail level:
never put content (user text, names, ids of people) in it.

The collector counts a finished agent job whose attempt has a skip line and no
run line as **skipped** (`skipped` on `agentsSummary`), never `unrecorded`. A
skipped attempt is not a run: it is not in the Runs list, the conversation, the
latency or `Job.agentRuns`. A run line for the same attempt wins over a skip.

### Tool summaries

At `basic`, the `summary` is the only thing about a tool's output that reaches
Redis. The default describes the **shape**, never the value:

| Output | Default summary |
|---|---|
| `null` / `undefined` | `no output` |
| array | `N results` |
| object with one array | `N results` |
| object with several arrays | `a: N, b: M`, or `K lists: N, M` when a key is not an identifier |
| object with `ok === false` | `refused` |
| other object | `object (k1, k2, ...)` (first 5 keys), or `object (N keys)` when a shown key is not an identifier |
| string | `string (N chars)` |
| number / boolean | `number` / `boolean` |
| failed tool | `failed: <ErrorClass>` (e.g. `failed: TypeError`), or `failed` when the error is not an `Error` |

Key names are listed only when every listed key looks like a code identifier
(`/^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/`): that is schema. An output keyed by data
(`{ "maria@x.com": {...} }`, `{ "Diabetes tipo 2": [...] }`) has keys that
**are** values, so the default falls back to counts. A key that looks like an
identifier and still is data (e.g. a username such as `jdoe`) is not detected:
if your tools return such dictionaries, write your own `summarize`.

A failed tool always gets this summary, whatever your `summarize` does. It
carries the error's class name only (from its constructor), never the message
nor a custom `name`: the message is kept in `tools[].error`, at `full` only.

Default `isEmpty`: `null`/`undefined`, `[]`, `{}`, or an object whose arrays are
all empty.

A custom `summarize` is **your responsibility**: never echo values from the
output (a name, a diagnosis, a free-text field). Counts and key names are fine:

```typescript
summarize: (tool, output) => {
  if (tool === 'getHealthSummary') return 'health summary';
  const o = output as { items?: unknown[] };
  return Array.isArray(o?.items) ? `${o.items.length} items` : 'ok';
},
```

## Detail levels

| Field | `basic` | `full` |
|---|---|---|
| `v`, `detail`, `model`, `attempt`, times, tokens (run and step), `finishReason` | yes | yes |
| `steps[].text` | **no** | yes |
| `tools[].name / ok / durationMs / summary / empty / startedAt / outputChars` | yes | yes |
| `tools[].input`, `tools[].output` | **no** | yes |
| `tools[].error` | **no** (`ok: false`, summary `failed: <ErrorClass>`) | yes |
| `final.cards` (type + title) | yes | yes |
| `final.text` | **no** | yes |
| `error` (run, 500 chars) | yes | yes |
| `input.conversationId` | yes | yes |
| `input.text` | **no** | yes |

Cut fields are **omitted** (key absent), never blanked. The same goes for a
step that wrote no text at `full`: `text` is omitted, not `""`. The cut is a
whitelist: a field the contract does not know about never survives `basic`.

The server cuts again when serving, to the level declared on the queue. If a
stored run carries more than that (the worker recorded `full`, the queue says
`basic`), the run is served cut and flagged `detailMismatch`. That does **not**
remove the content from Redis: fix the worker. The monitor logs one
`console.warn` per queue per process when it first sees such a run (on read or
on ingest), with the queue name and both levels only, never content.

### Which level to use

The dashboard has no authentication of its own. Whoever reaches its route
reads everything in the queue, including the job logs, through the Logs modal
and `Job.logs` in GraphQL, not only the Agents screen.

- **Use `basic` for any queue that handles sensitive data** (health, finance,
  personal data, user messages). This is the default and what `ai: true` gives.
- **Use `full` only for test or investigation queues, or with the dashboard
  behind your own authentication.** At `full`, tool inputs/outputs, step texts,
  the final answer and the user's message are stored in `<job>:logs`.
- Content at `full` lives as long as the job (`removeOnComplete: N`) **and in
  every Redis backup** (RDB/AOF snapshots) taken meanwhile.
- `basic` still stores free text you control: tool `summary`, card titles,
  `note()` lines and the run `error` message. Keep summaries content-free.
- **Card titles are stored at `basic`** (they are what makes a run readable
  there). If a title can carry personal data (a patient's name, a diagnosis),
  pass a generic title or none:
  `recorder.finish(text, cards.map(({ type }) => ({ type, title: '' })))`, or
  `title: 'Recipe'`. For health data, use generic titles.
- **Sanitize errors before `fail()` and before rethrowing.** If an error can
  echo the prompt or the answer (e.g. the AI SDK's `TypeValidationError` and
  `InvalidToolInputError` carry the value in their message), throw a sanitized
  error and pass that same error to `fail()`. Shortening the run `error` would
  not help: Bull/BullMQ store the rethrown message, uncapped, in the job's
  `failedReason` and `stacktrace`, readable in the dashboard.

  ```typescript
  } catch (err) {
    const safe = new Error(
      err instanceof Error ? `agent failed: ${err.constructor.name}` : 'agent failed'
    );
    await recorder.fail(safe);
    throw safe; // the job's failedReason gets the same, content-free message
  }
  ```

## Limits and degradation

Applied by the helper (override with `limits`):

| Item | Cap | Above it |
|---|---|---|
| `tools[].output` | 2048 chars of JSON | `{ truncated: true, chars, preview }` |
| `tools[].input` | 2048 chars of JSON | same |
| `steps[].text`, `final.text`, `input.text` | 4000 chars | cut, marked `… (+N)` |
| run `error` / `tools[].error` | 500 / 200 chars | cut |
| `summary`, card titles | 120 chars | cut |
| `model`, tool name, `finishReason`, card type, `input.conversationId` | 120 chars (fixed, `AGENT_RUN_ID_CHARS`) | cut, ending in `…` |
| `note(line)` | 4000 chars (`textChars`) | cut, marked `… (+N)` |
| steps / tools per step / cards | 50 / 50 / 20 | ignored |
| whole line | 64 KB (UTF-8) | degraded, see below |
| `finish`/`fail` write | 5000 ms | resolves anyway, reports to `onError` |

Above 64 KB the helper degrades until the line fits, setting `truncated: true`:
drop tool outputs, then tool inputs, then texts (step texts, tool errors, final
text, input text), then fall back to the `basic` skeleton, and as a last resort
the skeleton without tools. Run and step token totals stay correct throughout.

Values that cannot be serialized (circular references, BigInt) are stored as
their string form, cut to the cap.

On the read side, independently: only the last 200 log lines of a job are
read, a run line above 512 KB is ignored, and each line is validated by shape;
a malformed line is skipped without failing the query. The monitor also
re-caps what it reads, without trusting the writer: identifiers (model, tool
name, `finishReason`, card type, `conversationId`, job name, outcome) to 120
chars, tool summaries and card titles to 240 chars, in served runs, in the
recent runs index and in the metric rollup keys. Names equal to
`Object.prototype` members (`constructor`, `toString`, `__proto__`...) are
plain names in every rollup.

The 200-line tail counts **every** line of the job log, not only run lines.
Many `note()` lines (or your own `job.log()` calls) after an earlier attempt
push that attempt's run line out of the window: it no longer shows in the Run
view nor in `Job.agentRuns`, and the collector cannot ingest it (it reads the
same tail on the terminal event). Keep notes to a few per attempt. Redis has
no server-side filter for a list, so scanning the whole log by prefix would
cost a full read of every agent job on every event.

## Log line format

```text
bull-horizon:agent-run {"v":1,"detail":"basic","model":"gemini-3.8-flash",...}
```

- Prefix `bull-horizon:agent-run ` (with the trailing space), then one JSON
  object (`AgentRunV1`), on a single line.
- One line per attempt, written last in that attempt. Retries append their own
  line, so success, failure and retry coexist in order.
- Any other line in the job log is left alone (your human-readable lines,
  `note()`). In the Logs modal the run line is collapsed.
- Only read for queues and job names declared as agent. Any code that can
  write to the queue could forge a line; at worst it skews that queue's
  metrics.

Exported for consumers: `AGENT_RUN_LOG_PREFIX`, `AGENT_RUN_VERSION`,
`parseAgentRunLine`, `isAgentRunV1`, `applyAgentRunDetail`, `formatAgentRunLine`,
`DEFAULT_AGENT_RUN_LIMITS`, `AGENT_RUN_ID_CHARS`, `defaultSummarize`, `defaultIsEmpty` and the types
`AgentRunV1`, `AgentRunStep`, `AgentRunTool`, `AgentRunCard`, `AgentRunDetail`,
`AgentQueueConfig`, `AgentRunLimits`, `CreateAgentRunOptions`,
`AgentRunRecorder`, `AgentRunEvent`, `AgentRunJobLike`, `AgentsConfig`,
`AgentModelPrice`.

### Example: `basic`

Pretty-printed here; the real line is a single JSON object. Generated by
`createAgentRun` for a three-step run.

```json
{
  "v": 1,
  "detail": "basic",
  "model": "gemini-3.8-flash",
  "attempt": 1,
  "startedAt": "2026-10-14T19:05:28.514Z",
  "finishedAt": "2026-10-14T19:05:43.328Z",
  "durationMs": 14814,
  "inputTokens": 9534,
  "outputTokens": 1057,
  "steps": [
    {
      "step": 1,
      "startedAt": "2026-10-14T19:05:28.567Z",
      "durationMs": 4033,
      "finishReason": "tool-calls",
      "inputTokens": 2788,
      "outputTokens": 154,
      "tools": [
        {
          "name": "listRecipes",
          "ok": true,
          "durationMs": 55,
          "summary": "0 results",
          "empty": true,
          "startedAt": "2026-10-14T19:05:32.543Z",
          "outputChars": 14
        }
      ]
    },
    {
      "step": 2,
      "startedAt": "2026-10-14T19:05:32.661Z",
      "durationMs": 7219,
      "finishReason": "tool-calls",
      "inputTokens": 2962,
      "outputTokens": 774,
      "tools": [
        {
          "name": "proposeRecipe",
          "ok": true,
          "durationMs": 0,
          "summary": "object (ok, message)",
          "empty": false,
          "startedAt": "2026-10-14T19:05:39.880Z",
          "outputChars": 34
        }
      ]
    },
    {
      "step": 3,
      "startedAt": "2026-10-14T19:05:39.883Z",
      "durationMs": 3431,
      "finishReason": "stop",
      "inputTokens": 3784,
      "outputTokens": 129,
      "tools": []
    }
  ],
  "final": { "cards": [{ "type": "RECIPE", "title": "Crepioca recheada" }] },
  "error": null,
  "input": { "conversationId": "c-7f21" }
}
```

### Example: `full`

Same run at `full`. It adds `steps[].text`, `tools[].input/output`,
`final.text` and `input.text`:

```json
{
  "v": 1,
  "detail": "full",
  "model": "gemini-3.8-flash",
  "attempt": 1,
  "startedAt": "2026-10-14T19:05:28.514Z",
  "finishedAt": "2026-10-14T19:05:43.328Z",
  "durationMs": 14814,
  "inputTokens": 9534,
  "outputTokens": 1057,
  "steps": [
    {
      "step": 1,
      "startedAt": "2026-10-14T19:05:28.567Z",
      "durationMs": 4033,
      "finishReason": "tool-calls",
      "inputTokens": 2788,
      "outputTokens": 154,
      "tools": [
        {
          "name": "listRecipes",
          "ok": true,
          "durationMs": 55,
          "summary": "0 results",
          "empty": true,
          "startedAt": "2026-10-14T19:05:32.543Z",
          "outputChars": 14,
          "input": { "query": "proteína", "meal": "breakfast" },
          "output": { "recipes": [] }
        }
      ]
    },
    {
      "step": 2,
      "startedAt": "2026-10-14T19:05:32.661Z",
      "durationMs": 7219,
      "finishReason": "tool-calls",
      "inputTokens": 2962,
      "outputTokens": 774,
      "tools": [
        {
          "name": "proposeRecipe",
          "ok": true,
          "durationMs": 0,
          "summary": "object (ok, message)",
          "empty": false,
          "startedAt": "2026-10-14T19:05:39.880Z",
          "outputChars": 34,
          "input": { "title": "Crepioca recheada" },
          "output": { "ok": true, "message": "card saved" }
        }
      ],
      "text": "Vou sugerir uma crepioca."
    },
    {
      "step": 3,
      "startedAt": "2026-10-14T19:05:39.883Z",
      "durationMs": 3431,
      "finishReason": "stop",
      "inputTokens": 3784,
      "outputTokens": 129,
      "tools": [],
      "text": "Que tal uma **crepioca recheada**?"
    }
  ],
  "final": {
    "text": "Que tal uma **crepioca recheada**?",
    "cards": [{ "type": "RECIPE", "title": "Crepioca recheada" }]
  },
  "error": null,
  "input": {
    "conversationId": "c-7f21",
    "text": "Ideia de café da manhã com proteína?"
  }
}
```

A failed attempt has `"final": null` and `"error": "<message>"`. A run with no
`detail` key (recorded before the field existed) is treated as `full`.

Step text and the final answer are rendered as a safe Markdown subset (bold,
italic, inline code, line breaks, lists). Links, images and raw HTML show as
literal text.

## Metrics and Runs need the collector

The Run view only needs the job: it reads the log line on demand. The
**Metrics** and **Runs** tabs need the metrics collector (`metrics: {}` or any
`metrics` config). Without it, those tabs are not shown and the
`agentsSummary`/`agentRuns` queries return `NO_COLLECTOR`.

The collector listens to the `completed`/`failed` events it already uses for
throughput. For an agent job it reads all run lines of the job (so earlier
failed attempts are included), deduplicates each run, and adds it to:

- a per-queue series with the same tiered retention as throughput
  (`metrics.retention`), written only in windows that had runs;
- a recent runs index (`ai.recentRuns`, default 2000 per queue), always at
  `basic` level whatever the queue's detail.

Deduplication (`ZADD NX` on `jobId:attempt:startedAt`) makes ingestion
idempotent: duplicated events, a manual retry from the dashboard and several
monitor replicas do not double count.

A queue in `metrics.blacklist` gets no agent aggregates either.

A finished agent job with no run at all (no run line in its log and no run in
its returnvalue, see below) is counted as **unrecorded** (`unrecorded` on
`agentsSummary`). It usually means the worker consuming the queue is not
instrumented with `createAgentRun` (old code still deployed). It is distinct
from `lost` (job already removed). An attempt that ends on purpose without
calling the model should be marked with `recorder.skip()` /
`markAgentRunSkipped`: it is then counted as `skipped`, not `unrecorded` (see
Skipped attempts).

### Compatibility: run in the job's returnvalue

Workers written before `createAgentRun` may return the whole trace (AiTrace
v1) as the job's return value instead of logging it. When a finished job has
no run line for an attempt, and its returnvalue (an object or a JSON string)
passes the same shape check and the same 512 KB read cap as a log line, the
monitor uses it as the run of that attempt (`attempt` from the run, or the
job's attempt count). It is never used for an attempt a log line already
covers. In GraphQL these runs have `source: returnvalue` (log runs have
`source: log`); the field is the server's, not part of the written contract.

This is a compatibility path, not the recommended one:

- **Failed attempts are missing.** A job only has a returnvalue when an
  attempt completes; `createAgentRun` records every attempt.
- **The detail cut only applies when serving.** Bull stores the returnvalue
  as is, so full content returned by the job (user text, answers, tool
  input/output) is in Redis whatever the queue's `detail`. The monitor cuts
  it to the declared level when serving and in the recent runs index, and
  flags `detailMismatch` when a run without `detail` lands on a `basic` queue.
  The cut does not reach the job itself: the job's "Return value" in the
  dashboard (and `Job.returnvalue` in GraphQL) still shows the raw value. To
  keep content out of Redis, record with `createAgentRun` and stop returning
  the trace.

## Conversation view

Runs that share an `input.conversationId` in the same queue form a
conversation: one message per job, in order. The Run view links to it ("View
whole conversation") when the run has a `conversationId` and the collector is
on. A run without `conversationId` has no conversation.

Record it by passing the id to the helper, plus the user's message if you want
it shown at `full`:

```typescript
const recorder = createAgentRun({
  job,
  model: 'gemini-3.8-flash',
  agent: AI_AGENT,
  input: { conversationId: chat.id, text: userMessage }, // text: full only
});
```

**`conversationId` must be an opaque id** (a UUID or a database key). Never an email, phone number, document number or name, and never a hash of one: an unsalted hash of an email or phone number is reversible. It is kept at `basic`, stored in the recent runs index and shown in
the dashboard.

What each message shows:

| | `basic` | `full` |
|---|---|---|
| User message (`input.text`) | "not recorded at basic detail" | shown |
| Final answer (`final.text`) | "not recorded at basic detail" | shown |
| Tool chain, steps, tokens, time, cost, outcome | shown | shown |
| Card types and titles | shown | shown |

How it is built (`agentConversation(queue, conversationId)` query):

- **Source: the recent runs index** (the one behind the Runs tab, capped by
  `ai.recentRuns`, default 2000 per queue). No extra Redis key. It needs the
  collector (`NO_COLLECTOR` otherwise) and only covers runs ingested while the
  monitor was running.
- **One message per job**: its highest attempt (earlier attempts stay
  reachable from the message's run). Ordered by finish time.
- **At most the 100 most recent messages** are shown.
- Each message's run is read from its job log (last 200 lines, same cut as
  the Run view). If the job was removed, the message keeps the index data
  (tokens, time, steps, tool chain) and is flagged `jobRemoved`.
- **Old conversations may be incomplete.** Once a queue's index is full, its
  oldest runs are evicted, and they may belong to the conversation. The view
  says the conversation may be incomplete (`maybeIncomplete`) when the index
  is full **and** its oldest entry is no further back from the first message
  than the conversation's largest pause between two messages (at least 30
  minutes): an earlier message could have been evicted. If the index reaches
  further back than that, an earlier message would most likely still be in
  it, so no notice. It is a heuristic. The view also says so when the
  conversation has more than 100 messages. Raise `ai.recentRuns` if you need
  longer history.
- Totals: messages, conversation duration (first message start to last
  message finish, so it includes the user's time to reply), AI time (sum of
  run durations), tokens, estimated cost (priced models only; `null`, never
  `$0`, when none is priced), steps, tool calls, and calls per tool.

Runs ingested before this version have no conversation id in the index, so
they do not show up in a conversation.

## Cost estimation

- `cost = (inputTokens × price.input + outputTokens × price.output) / 1,000,000`,
  in USD, per step, per run and per model.
- The price is looked up by the model name **as recorded in the run**: exact
  match, case-insensitive. `gemini-3.8-flash` does not match
  `models/gemini-3.8-flash`.
- A model without a price shows its tokens and **no price**, never `$0`. Totals
  sum the priced models only and flag that unpriced models exist in the window.
- Cost is computed **at read time** from stored tokens, so editing
  `ai.pricing` changes the cost shown for past runs too. It is an estimate:
  it ignores cached-token discounts, tiers and anything not in the token counts.

## Derived values (not part of the contract)

Computed by the server when serving:

- Run `finishReason` = the last step's.
- `outcome`: `error` if `error` is set; `max-steps` if the last step ended in
  `tool-calls` (the loop stopped while the model still wanted a tool);
  otherwise the last `finishReason` (`stop`, `length`, `content-filter`...), or
  `unknown`.
- `overheadStartMs` / `overheadEndMs`: time between the job starting and the
  run starting, and between the run ending and the job ending. Only for the
  job's current attempt (both libs overwrite `processedOn` on every attempt):
  `null` for earlier attempts, while a newer attempt runs without a line yet
  (e.g. after a manual retry), before the job finishes (`overheadEndMs`), and
  whenever the gap would be negative. Never negative.
- Latency p50/p95 are estimated from a fixed-band histogram (bands from 500 ms
  to 300 s), so they are approximate: the error is at most the width of the
  band.

## Limitations

- **Aggregates are only counted while the monitor is running.** Like
  throughput, nothing is backfilled; a monitor restart leaves a gap. The Run
  view of an existing job still works, since it reads the log.
- Earlier attempts are counted in the window of the job's **terminal** event,
  not when they ran (the difference is the retry backoff).
- **Agent metrics are not exported to Prometheus.** The `/metrics` endpoint is
  unauthenticated, and tool and model names would become label values.
- Runs recovered from a job's returnvalue (compatibility path) only cover the
  completed attempt, and their full content is stored in Redis by Bull.
- Jobs removed by `removeOnComplete: true` / `removeOnFail: true` are counted
  as `lost`, with no run data. `lost` means "terminal event whose job was
  already gone": neither Bull nor BullMQ put the job name in the event, so in
  a queue that mixes agent and non-agent jobs (`ai.jobs`), a removed
  non-agent job counts as `lost` too.
- Only the last 200 lines of a job log are read (see Limits): runs of earlier
  attempts followed by many other lines are not shown nor counted.
- The agent series of a queue is stored under `<metrics prefix><queue>::ai`.
  A queue literally named `X::ai` would share that key with the agent series
  of queue `X`. Queue names come from your config; avoid `::ai` at the end of
  one.
- The Conversation view only sees the recent runs index: a conversation older
  than the index is incomplete (see Conversation view).
