# Flows and traces (contract v1)

A **flow** is a business pipeline that crosses several queues: one job
enqueues the next, sometimes in a fan-out, sometimes through a fallback,
sometimes into an error queue. The **Flows** screen shows that pipeline as the
code runs it, where it slows down, and the path of **one** item through it,
found by an id that travels from job to job (the **trace id**).

- You declare the flow in the monitor setup (steps = queues, who enqueues
  whom). The dashboard only reads it: there is no flow editor.
- Your workers copy the trace from parent job to child job with `withTrace`
  when they enqueue. The trace lives in the job payload (`data._trace`).
- The metrics collector aggregates every step and indexes traces, so the
  search can find an item by trace id, job id or business key.

Agent runs (see [agent-runs.md](./agent-runs.md)) open up what happens
**inside** one job. Flows open up what happens **between** jobs.

## What the Flows screen shows

The sidebar gets a **Flows** entry when at least one flow is declared. Each
flow has three tabs:

| Tab        | Needs the collector | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flow**   | yes                 | KPIs over the selected window (entries, completed end to end, end-to-end p50/p95, bottleneck, failures) and the flow as a **Graph** (nodes with live waiting/active/failed, throughput, edges with average wait, fallback and ON ERROR nodes, bottleneck tag) or a **Table** (indented tree with p50/p95, queue wait, failure rate). Clicking a step opens its panel: sparkline, recent errors grouped by message, next steps, link to the queue's jobs |
| **Trace**  | yes                 | The path of one execution: the **Graph** with the path highlighted (time and duration per node, wait per edge) or a **Timeline** (per job: queue wait hatched, processing as a bar, colored by result). Each job opens its `_trace`, timing and returnvalue or stacktrace, and links to the job                                                                                                                                                         |
| **Config** | no                  | The definition as the monitor understood it (rendered as YAML, read only), the `_trace` convention, and the validation: boot checks plus live ones (trace coverage, lost jobs, undeclared edges seen at runtime, declared edges never seen)                                                                                                                                                                                                             |

**Search** (header of the flow): type a **trace id**, a **job id** or the
exact value of the flow's **business key** (e.g. a video id) and press Enter.
The search is exact, never free text. Order: trace id in the index, then job
id in the flow's queues, then business key; a trace id with nothing indexed yet
(only pending jobs) falls back to the pending scan. The pending scan is
bounded per request, so a search never reads whole queues. When a key matches more
than one execution (an item processed twice), the screen lists the
candidates, newest first (up to 20).

## Setup

### 1. Declare the flow in the monitor

`flows` goes in the monitor config, next to `queues` and `metrics`. Keep the
definitions in a file the workers can import too (like `AgentQueueConfig`):
the flow id and the trace field must match on both sides.

```typescript
// flows.ts, shared by the monitor and the workers
import type { FlowConfig } from '@bull-horizon/root';

export const CONTENT_INGEST: FlowConfig = {
  id: 'content-ingest', // [a-z0-9_.:-], up to 64
  label: 'Content ingest',
  group: 'Content', // sidebar group that gets the FLOW badge
  entry: 'content:check', // one step id or a list
  onError: 'content:save-error', // error step (ON ERROR node)
  complete: ['content:index'], // steps whose completion closes the trace
  trace: {
    key: 'itemId', // dotted path in job.data: the business key
    keyLabel: 'itemId', // label in the search box
  },
  steps: {
    'content:check': {
      description: 'skip items already processed',
      next: [
        { to: 'content:fetch', when: 'new' },
        { end: 'only refreshes counters', when: 'exists' },
      ],
    },
    'content:fetch': { next: 'content:save' },
    'content:save': { next: 'content:captions' },
    'content:captions': {
      next: [
        { to: 'content:index', when: 'captions found' },
        { to: 'content:transcribe', when: 'no captions', kind: 'fallback' },
      ],
    },
    // Calls an external service that answers on a webhook (see continueTrace).
    'content:transcribe': {
      next: { to: 'content:save-transcript', kind: 'fallback' },
    },
    'content:save-transcript': { next: 'content:index' },
    'content:index': {},
    'content:save-error': {},
  },
};
```

```typescript
// NestJS monitor service (same shape for Express, Fastify, Koa, Hapi)
this.monitor = new BullMonitorExpress({
  queues: this.queues.map(
    (q) => new BullAdapter(q, { group: QUEUE_GROUPS[q.name] })
  ),
  metrics: {}, // required for the Flow and Trace tabs
  flows: [CONTENT_INGEST],
  flowsOptions: { recentTraces: 2000 }, // optional, see Limits
});
await this.monitor.init();
```

Definition reference:

| Field            | Default                                                     |                                                                                                                   |
| ---------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`             | required                                                    | `[a-z0-9_.:-]`, up to 64. Written in every `_trace`                                                               |
| `label`          | `id`                                                        | Name on the screen                                                                                                |
| `group`          | the single group shared by the flow's queues                | Sidebar group that gets the `FLOW` badge                                                                          |
| `entry`          | required                                                    | Step(s) where a trace starts                                                                                      |
| `onError`        |                                                             | Error step. An edge from any step to it counts as declared                                                        |
| `complete`       | steps without `next` (except `onError`) plus `end` branches | Completion of one of these closes the trace and feeds the end-to-end time                                         |
| `trace.field`    | `_trace`                                                    | Payload field carrying the trace (`[A-Za-z0-9_$-]`, up to 64)                                                     |
| `trace.key`      |                                                             | Dotted path in `job.data` of the business key (e.g. `item.id`, `ids.0`). An opaque internal id only, see Security |
| `trace.keyLabel` | last segment of `key`                                       | Label in the search box                                                                                           |
| `trace.aliases`  |                                                             | Extra dotted paths indexed as keys of the same trace (up to 8). See Limitations                                   |
| `steps`          | required                                                    | Map step id → step. The key is the queue name unless `queue` says otherwise                                       |

| Step field             | Default      |                                                                     |
| ---------------------- | ------------ | ------------------------------------------------------------------- |
| `queue`                | the step key | Queue name (`Queue.name`). The queue must be in `queues`            |
| `jobs`                 | every job    | Only these job names are this step (a queue may hold several steps) |
| `label`, `description` |              | Display only                                                        |
| `when`                 |              | Execution condition of the step (display only)                      |
| `next`                 |              | A step id, an edge, or a list of them                               |

An edge is `{ to, when?, kind? }` or a terminal branch `{ end: 'label', when? }`.
`kind` is `'next'` (default; an edge with `when` is drawn as conditional),
`'fallback'` (dashed, marks the trace "completed with fallback") or
`'sidecar'`. Cycles are allowed (a retry loop through a queue); the trace's
`hop` limit stops them.

**Validation never blocks the monitor.** Problems become checks on the Config
tab and one console warning per flow: a step whose queue is not in `queues`
(`unknown-queue`), `next`/`entry`/`onError`/`complete` pointing at a missing
step (`unknown-step`, edge dropped), no reachable completion step
(`no-completion`), a repeated flow id (`duplicate-flow`, the second is
ignored), invalid `trace.key`/`aliases`/`field`, and the caps (32 flows, 64
steps per flow, 8 `next` per step; the excess is dropped with a warning).
`setQueues()` re-runs the validation against the new queue list.

### 2. Propagate the trace in the workers

Three helpers, exported by `@bull-horizon/root`. They are pure and synchronous
(no Redis), work with Bull 3/4 and BullMQ 1+ (including sandboxed processors),
return a shallow copy of your data (never mutate it), and **never throw**: on
any problem they return your `data` untouched and call the optional
`onError`. A tracing problem must never become a job failure or a retry.

```typescript
import { startTrace, withTrace, encodeTrace, continueTrace } from '@bull-horizon/root';

// Entry (HTTP handler, cron, event, first queue): open a trace.
await checkQueue.add('check', startTrace({ itemId }, { flow: 'content-ingest', key: itemId }));

// Every link: enqueue the next step carrying the parent's trace.
async process(job: Job<{ itemId: string }>) {
  // ...
  await fetchQueue.add('fetch', withTrace(job, { itemId: job.data.itemId }));
}
```

| Helper                                                                        | Use                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startTrace(data, { flow, key?, traceId?, parent?, field?, now?, onError? })` | Opens a trace at an entry. `traceId` reuses an external id (request id); default `tr_` + 16 hex. `parent` links the new trace to the job of another flow that originated it (a planner page that fans out into one trace per item)                  |
| `withTrace(parentJob, data, { flow?, key?, field?, onError? })`               | Child data carrying the parent's trace (`hop + 1`, `parent` = the job). Copies only the trace fields, never the rest of the parent's payload. A parent without a trace opens a new one if `flow` is given, otherwise returns `data` without a trace |
| `readTrace(jobOrData, field?)`                                                | The trace of a job or payload, or `undefined`                                                                                                                                                                                                       |
| `encodeTrace(job, field?)`                                                    | The job's trace as base64url (at most 512 chars) to cross an external hop: a URL, a header, the payload of a third-party callback                                                                                                                   |
| `continueTrace(encoded, data, { parentQueue?, field?, onError? })`            | At the receiver (webhook): data of the next job continuing the trace. Validated as untrusted input; invalid = data without a trace                                                                                                                  |

**Call `withTrace` on every `queue.add` / `addBulk` of the flow.** A child
enqueued without it has no trace: it still counts in its step's aggregates
(as `untraced`), but it is not on the trace path and its edge is not counted.

**External hops.** When a link goes out of Redis and comes back (a worker
calls an external API that answers on your webhook, which enqueues the next
step), carry the trace as text:

```typescript
// Worker that calls the external service.
const trace = encodeTrace(job);
await transcriber.start({
  url,
  callbackUrl: `${API}/webhooks/transcript?trace=${trace ?? ''}`,
});

// Webhook handler.
await saveTranscriptQueue.add(
  'save',
  continueTrace(
    req.query.trace,
    { itemId, transcript },
    { parentQueue: 'content:transcribe' }
  )
);
```

The encoded trace is **not signed**: it is observability, not authorization.
Someone who forges one only pollutes the dashboard. Never use it for access
decisions.

**Entries you do not control** (a repeatable cron, a producer in another app)
may enqueue without `startTrace`. A job of an `entry` step without `_trace`
gets an implicit trace `"<queue>:<jobId>"` in the index (never written to the
job), so it is still searchable. Its children only join a trace if they are
enqueued with `withTrace(job, data, { flow })`, which opens a new trace whose
`parent` points at that job.

**Retries** of a parent enqueue its children again (with a different
`parent.attempt`): both show on the trace. Deduplicating children (a
deterministic `jobId`) is up to the app.

### 3. Keep the jobs (retention requirement)

The collector reads each job on its terminal event (`completed` / `failed`).
A flow queue must not use `removeOnComplete: true` / `removeOnFail: true`:
the job is gone before it is read and counts as **lost** on its step (or on
`(queue)` when the queue holds several steps, since the event carries no job
name). Use a number or an age:

```typescript
await queue.add(name, withTrace(job, data), {
  removeOnComplete: { age: 1800 }, // 30 min is enough for the collector
  removeOnFail: { age: 172800 },
});
```

The trace index keeps only metadata (step, job id, attempt, times, parent,
first line of the failure reason). A trace older than its jobs still shows its
path; opening one of its jobs says **"Job removed from Redis (retention)"**.
Keep jobs longer if operators need to open old jobs from a trace.

### 4. Turn on the collector

The **Flow** and **Trace** tabs need the metrics collector (`metrics: {}` or
any `metrics` config). Without it they are not shown, and the `flowSummary` /
`flowTrace` queries return `null`; the **Config** tab still works. Like
throughput, flows are only counted while the monitor runs: nothing is
backfilled, and a restart leaves a gap.

## The `_trace` contract (v1)

```typescript
type FlowTraceV1 = {
  v: 1;
  traceId: string; // one execution of the flow, [A-Za-z0-9_.:-]{1,64}
  flow: string; // flow id
  key?: string; // business key value, up to 128 chars
  startedAt: number; // ms epoch when the entry was enqueued (base of the end-to-end time)
  parent?: {
    // the job that enqueued this one
    queue?: string;
    jobId: string;
    name?: string;
    attempt?: number; // parent's attempt (a parent retry = duplicate child)
  };
  hop: number; // depth from the entry, 0..64
};
```

```json
{
  "itemId": "7428801239912",
  "_trace": {
    "v": 1,
    "traceId": "tr_9f2c41e7b05d3a18",
    "flow": "content-ingest",
    "key": "7428801239912",
    "startedAt": 1792004728514,
    "parent": {
      "queue": "content:save",
      "jobId": "8812",
      "name": "save",
      "attempt": 1
    },
    "hop": 3
  }
}
```

- Written **once**, when the job is enqueued. Never updated (no
  `job.update`). No Redis key is written by the worker.
- A payload without a valid trace is "untraced": it counts in its step's
  aggregates (`untraced`), not in the index nor in edges.
- The monitor reads it defensively: own properties only, every field
  type-checked, strings clipped, an invalid `traceId` or `flow`, or `hop`
  above 64, means no trace.
- If your DTOs validate the payload strictly, allow the `_trace` field (or set
  `trace.field` to a name your app accepts).

## How it is computed

On each terminal event of a flow queue the collector resolves the step (queue

- job name; an explicit `jobs` match wins over a catch-all step) and records,
  **with or without `_trace`**: completed / failed / lost / untraced / retried,
  processing time (`finishedOn - processedOn`) and queue wait (`processedOn -
enqueue time - delay`, only for jobs that finished on their first attempt;
  retried jobs count in `retried`). With a valid `_trace` it also records the
  observed edge (parent step → step), the end-to-end time when the step is in
  `complete`, and the job in the trace index.

Every failure event is final: neither Bull nor BullMQ emits `failed` for an
attempt that will be retried, so `discard()`, unrecoverable errors and stalled
jobs count as definitive failures.

**Bottleneck**: the step with the highest average queue wait in the window
(ties broken by live `waiting`), only if that wait is at least 1 s.

### Trace status

Computed when a trace is read, in this order:

1. **RUNNING**: some job of the trace is still waiting, active, delayed or
   paused (found by the pending scan).
2. **FAILED**: a finished job failed and enqueued no child (a dead end).
3. **COMPLETED**: a job of a `complete` step completed, or a job of a step
   with an `end` branch completed with no child. **COMPLETED_WITH_FALLBACK**
   when, on top of that, some job entered through a `fallback` edge.
4. **UNKNOWN**: none of the above (e.g. the trace's jobs were evicted from the
   index, or the path stopped at a step that is not a completion).

Pending jobs decide first, so a dead-end failure in one branch does not show
FAILED and then flip to COMPLETED when a sibling branch finishes.

## Limits

| Limit                           | Default                                                   |                                                                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flowsOptions.recentTraces`     | 2000 per flow                                             | Traces kept in the search index. Older ones are evicted with all their entries (no orphan keys); the search then says "may be older than the index" (`indexFull`). Size it from your volume: about 180 bytes per job per trace |
| `flowsOptions.jobsPerTrace`     | 300                                                       | Jobs indexed per trace; later ones are dropped and the trace is flagged `truncated`. Use one trace per item, linked with `startTrace({ parent })`, instead of one trace for a whole batch                                      |
| `flowsOptions.pendingScanLimit` | 500 per queue                                             | Jobs read per queue (waiting, active, delayed, paused, prioritized) when looking for pending steps of a trace. Beyond it the answer is flagged `partial`. The scan as a whole is also bounded per request                      |
| `hop`                           | 64                                                        | `withTrace` / `continueTrace` stop propagating past it (a re-enqueue loop does not become an endless trace)                                                                                                                    |
| Encoded trace                   | 512 chars                                                 | `encodeTrace` returns `undefined` above it                                                                                                                                                                                     |
| Keys per trace                  | 4                                                         | Distinct business key values indexed per trace (key + aliases), 128 chars each                                                                                                                                                 |
| Search                          | 1 to 256 chars                                            | Exact match; up to 20 candidates for a key                                                                                                                                                                                     |
| Definition                      | 32 flows, 64 steps per flow, 8 `next` per step, 8 aliases | The excess is dropped with a check                                                                                                                                                                                             |
| Recent errors                   | top 5 per step                                            | Read from the queue's failed set (up to 200 jobs), grouped by the first line of the reason                                                                                                                                     |

## Agent runs and flows together

An agent queue can be a step of a flow. The two views answer different
questions and use different channels:

|                       | Agent run                                            | Flow trace                                                 |
| --------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| Scope                 | Inside one job (LLM steps, tool calls, tokens, cost) | Between jobs (which queue enqueued which, waits, failures) |
| Written by            | `createAgentRun` → `job.log`                         | `startTrace` / `withTrace` → `data._trace`                 |
| Read by the collector | Agents tab (Metrics, Runs, Conversation)             | Flows tab (Flow, Trace)                                    |

Instrument both: enqueue the agent job with `withTrace(job, data)` and record
its attempt with `createAgentRun`. From the trace you open the agent job, and
from the job its agent run.

## Security

- The dashboard has no authentication of its own. The flow search runs on the
  same unauthenticated route as the rest of the GraphQL API: protect the route
  before mounting it.
- **The business key must be an opaque internal id**: a UUID, a database
  key, or a platform id that is not personal data. Never an email, a phone
  number, a document number or a name, and never a hash of one (a hash of
  personal data is reversible by dictionary). The key is stored in the trace
  index, shown on screen, and searchable on the unauthenticated route: an
  exact search tells whether that value went through the flow, so a personal
  value would turn the search into an existence oracle.
- Text coming from jobs (failure reasons, ids, returnvalues) is rendered as
  plain text.
- Flow metrics are not exported to Prometheus (step names and keys would
  become label values on an unauthenticated route).

## Limitations

- **`trace.aliases` only covers traced jobs.** Alias values are read from
  `job.data` of jobs that carry a trace (or entry jobs with an implicit trace)
  and indexed as extra keys of that trace. A job that arrives **without**
  `_trace` (e.g. enqueued by an external system you cannot instrument) is not
  linked to any trace by its alias values: it only counts as `untraced` on its
  step. Carry the trace across the hop with `encodeTrace` / `continueTrace`.
- Aggregate counters are not idempotent across monitor replicas (same as
  throughput): two monitors on the same Redis count each event twice. The
  trace index is idempotent.
- Flow aggregates are only counted while the monitor runs; nothing is
  backfilled.
- The trace screen shows metadata only. The job's data, returnvalue and
  stacktrace are read on demand from the job, so they are gone once the job
  is removed.
