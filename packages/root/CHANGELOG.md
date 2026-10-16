# Change Log

## 6.5.0

### Minor Changes

- cc8e14b: show AI agent jobs as runs: steps, tools, tokens and cost

  Queues that run AI agents can now be declared as **agent queues**, and their
  jobs open as an agent run instead of an opaque job with a wall of log lines:
  each LLM step and tool call as a graph or a waterfall, with tokens, timing and
  an estimated cost, one run per attempt so a failed attempt sits next to its
  retry. A new **Agents** screen (shown only when an agent queue exists) adds
  latency p50/p95, steps per run, tool stats (calls, duration, errors, empty
  results), tokens and cost per model, how runs ended, and a filterable list of
  recent runs. Runs that share an `input.conversationId` can be opened as a
  **conversation**: every message of the chat with its own run, as a chat
  transcript or as a list with the steps of the picked message.

  Setup is one option next to `group` on the queue adapter, plus a price table on
  the monitor:

  ```ts
  new BullAdapter(aiQueue, { group: 'AI', ai: { jobs: ['reply'], detail: 'basic' } });
  // monitor config
  ai: { pricing: { 'gemini-3.8-flash': { input: 0.75, output: 3.75 } } } // USD per 1M tokens
  ```

  Runs are recorded in your worker with the new `createAgentRun` helper exported
  by `@bull-horizon/root`, wired to the AI SDK `generateText` callbacks. It
  writes one structured line per attempt to `job.log`, has no dependencies, and
  never throws or rejects, so tracing cannot fail a job or trigger a paid retry.

  **Privacy by default.** The detail level is applied in your process, before
  anything reaches Redis. `basic` (the default, and what `ai: true` gives) keeps
  model, timing, tokens, tool names, durations and content-free summaries; tool
  inputs/outputs, step texts and the final answer are only stored at `full`,
  which is meant for test queues or dashboards behind authentication.

  Things to know:

  - Agent queues must keep finished jobs: `removeOnComplete`/`removeOnFail` set
    to `true` delete the run with the job (counted as _lost_). Use a number or an
    age.
  - The Metrics and Runs tabs need the metrics collector (`metrics: {}`); the run
    view of a single job does not.
  - Cost is an estimate computed at read time; a model without a price shows "no
    price", never `$0`.
  - Agent aggregates are not exported to the Prometheus endpoint.
  - The conversation view also needs the collector and is built from the
    recent-runs index (`ai.recentRuns`), so a long or old conversation can be
    incomplete (the screen says so). `conversationId` must be an opaque id, never
    an email, phone number or a hash of one.

  New in the public API: `QueueConfig.ai`, `Config.ai` (`pricing`, `recentRuns`),
  `createAgentRun`, the `AgentRunV1` contract types and helpers, and `Queue.agent`
  / `Queue.isAgentJob`. `Queue.getJobLogs` accepts optional `start`/`end`; custom
  `Queue` implementations should accept them too. GraphQL gains `Queue.agent`,
  `Job.agentRuns`, `Query.agentRun`, `Query.agentsSummary`, `Query.agentRuns` and
  `Query.agentConversation`.

  See `docs/agent-runs.md` for the full contract.

- 3cef839: follow a business item across queues: flows and traces

  A **flow** is a pipeline that crosses several queues: one job enqueues the
  next, sometimes in a fan-out, through a fallback or into an error queue. Flows
  are declared in the monitor setup and the dashboard only reads them. A new
  **Flows** screen shows each one in three tabs:

  - **Flow**: KPIs over the window (entries, completed end to end, end-to-end
    p50/p95, bottleneck, failures) and the flow as a graph or an indented table,
    with live counts, throughput, processing p50/p95, queue wait and failure
    rate per step, and a step panel with recent errors and a link to its jobs.
  - **Trace**: the path of one execution, found by trace id, job id or business
    key, as the highlighted graph or a timeline of queue wait and processing,
    including steps that are still pending.
  - **Config**: the definition as the monitor understood it (YAML, read only),
    the `_trace` convention and the validation checks.

  The sidebar group of a flow gets a `FLOW` badge.

  Setup is `flows` on the monitor config (a step is a queue, optionally
  restricted to some job names; `next` edges with `when`, fallback and `end`
  branches; `onError`; `complete`; `trace.key` and `trace.aliases`), plus
  optional `flowsOptions` (`recentTraces` 2000, `jobsPerTrace` 300,
  `pendingScanLimit` 500 by default). The definition is validated at boot and
  problems become warnings and checks on the Config tab, never an exception.

  ```ts
  new BullMonitorExpress({ queues, metrics: {}, flows: [CONTENT_INGEST] });
  // worker
  await nextQueue.add('fetch', withTrace(job, { itemId }));
  ```

  Workers carry the trace in `data._trace` with new helpers exported by
  `@bull-horizon/root`: `startTrace` at the entries, `withTrace` on every
  `queue.add`, `encodeTrace`/`continueTrace` across an HTTP or webhook hop, and
  `readTrace`. They have no dependencies and never throw: a tracing problem
  returns your data untouched.

  Things to know:

  - The Flow and Trace tabs need the metrics collector (`metrics: {}`); the
    Config tab does not.
  - Flow queues must keep finished jobs: `removeOnComplete`/`removeOnFail` set to
    `true` delete the job before the collector reads it (counted as _lost_). Use
    a number or an age.
  - The trace index keeps `recentTraces` per flow; an older trace is not found
    and the search says the index is full.
  - The business key must be an opaque internal id, never personal data nor a
    hash of it: the search runs on the dashboard route, which has no
    authentication, with per-request limits.
  - Flow metrics are not exported to the Prometheus endpoint.

  **Agent jobs that skip on purpose.** An agent job that ends without calling the
  model (content already fresh, message already answered) can now say so with
  `recorder.skip(reason?)`, or `markAgentRunSkipped(job, { agent, reason })` when
  no recorder exists. The attempt counts as _skipped_ instead of _unrecorded_.
  The reason is a short id-like label (up to 120 chars), stored at any detail
  level, so it must never carry content.

  New in the public API: `Config.flows`, `Config.flowsOptions`, `startTrace`,
  `withTrace`, `readTrace`, `encodeTrace`, `continueTrace`, the types
  `FlowTraceV1`, `FlowConfig`, `FlowStepConfig`, `FlowNext`, `FlowTraceConfig`,
  `FlowsOptions`, `FlowTraceParent` and `FlowTraceParentRef`, the constants
  `FLOW_TRACE_FIELD`, `FLOW_TRACE_VERSION`, `FLOW_MAX_HOP` and
  `DEFAULT_FLOWS_OPTIONS`; `recorder.skip`, `markAgentRunSkipped`,
  `formatAgentRunSkipLine`, `parseAgentRunSkipLine`, `AGENT_RUN_SKIP_LOG_PREFIX`,
  `AgentRunSkipV1` and `MarkAgentRunSkippedOptions`. GraphQL gains `Query.flows`,
  `Query.flowSummary`, `Query.flowTrace` and `AgentsSummary.skipped`.
  `defaultAgentRunAttempt` now delegates to a shared attempt helper, with no
  change in behavior.

  See `docs/flows.md` for the full contract.

### Patch Changes

- 64be374: read agent runs from the job's return value, and say when jobs finish without a run

  Agent queues whose worker returns the run as the job's return value (an
  `AgentRunV1`) now show up in the Agents screen even without the
  `createAgentRun` log line, cut to the queue's declared detail when served
  (`AgentRun.source` tells which path was used; failed attempts are only captured
  by `createAgentRun`). Finished agent jobs with no run at all are counted as
  `unrecorded` (`AgentsSummary.unrecorded`), and Metrics and Runs warn about them
  instead of showing an empty screen.

## 6.5.0-beta.2

### Minor Changes

- 3cef839: follow a business item across queues: flows and traces

  A **flow** is a pipeline that crosses several queues: one job enqueues the
  next, sometimes in a fan-out, through a fallback or into an error queue. Flows
  are declared in the monitor setup and the dashboard only reads them. A new
  **Flows** screen shows each one in three tabs:

  - **Flow**: KPIs over the window (entries, completed end to end, end-to-end
    p50/p95, bottleneck, failures) and the flow as a graph or an indented table,
    with live counts, throughput, processing p50/p95, queue wait and failure
    rate per step, and a step panel with recent errors and a link to its jobs.
  - **Trace**: the path of one execution, found by trace id, job id or business
    key, as the highlighted graph or a timeline of queue wait and processing,
    including steps that are still pending.
  - **Config**: the definition as the monitor understood it (YAML, read only),
    the `_trace` convention and the validation checks.

  The sidebar group of a flow gets a `FLOW` badge.

  Setup is `flows` on the monitor config (a step is a queue, optionally
  restricted to some job names; `next` edges with `when`, fallback and `end`
  branches; `onError`; `complete`; `trace.key` and `trace.aliases`), plus
  optional `flowsOptions` (`recentTraces` 2000, `jobsPerTrace` 300,
  `pendingScanLimit` 500 by default). The definition is validated at boot and
  problems become warnings and checks on the Config tab, never an exception.

  ```ts
  new BullMonitorExpress({ queues, metrics: {}, flows: [CONTENT_INGEST] });
  // worker
  await nextQueue.add('fetch', withTrace(job, { itemId }));
  ```

  Workers carry the trace in `data._trace` with new helpers exported by
  `@bull-horizon/root`: `startTrace` at the entries, `withTrace` on every
  `queue.add`, `encodeTrace`/`continueTrace` across an HTTP or webhook hop, and
  `readTrace`. They have no dependencies and never throw: a tracing problem
  returns your data untouched.

  Things to know:

  - The Flow and Trace tabs need the metrics collector (`metrics: {}`); the
    Config tab does not.
  - Flow queues must keep finished jobs: `removeOnComplete`/`removeOnFail` set to
    `true` delete the job before the collector reads it (counted as _lost_). Use
    a number or an age.
  - The trace index keeps `recentTraces` per flow; an older trace is not found
    and the search says the index is full.
  - The business key must be an opaque internal id, never personal data nor a
    hash of it: the search runs on the dashboard route, which has no
    authentication, with per-request limits.
  - Flow metrics are not exported to the Prometheus endpoint.

  **Agent jobs that skip on purpose.** An agent job that ends without calling the
  model (content already fresh, message already answered) can now say so with
  `recorder.skip(reason?)`, or `markAgentRunSkipped(job, { agent, reason })` when
  no recorder exists. The attempt counts as _skipped_ instead of _unrecorded_.
  The reason is a short id-like label (up to 120 chars), stored at any detail
  level, so it must never carry content.

  New in the public API: `Config.flows`, `Config.flowsOptions`, `startTrace`,
  `withTrace`, `readTrace`, `encodeTrace`, `continueTrace`, the types
  `FlowTraceV1`, `FlowConfig`, `FlowStepConfig`, `FlowNext`, `FlowTraceConfig`,
  `FlowsOptions`, `FlowTraceParent` and `FlowTraceParentRef`, the constants
  `FLOW_TRACE_FIELD`, `FLOW_TRACE_VERSION`, `FLOW_MAX_HOP` and
  `DEFAULT_FLOWS_OPTIONS`; `recorder.skip`, `markAgentRunSkipped`,
  `formatAgentRunSkipLine`, `parseAgentRunSkipLine`, `AGENT_RUN_SKIP_LOG_PREFIX`,
  `AgentRunSkipV1` and `MarkAgentRunSkippedOptions`. GraphQL gains `Query.flows`,
  `Query.flowSummary`, `Query.flowTrace` and `AgentsSummary.skipped`.
  `defaultAgentRunAttempt` now delegates to a shared attempt helper, with no
  change in behavior.

  See `docs/flows.md` for the full contract.

## 6.5.0-beta.1

### Patch Changes

- 64be374: read agent runs from the job's return value, and say when jobs finish without a run

  Agent queues whose worker returns the run as the job's return value (an
  `AgentRunV1`) now show up in the Agents screen even without the
  `createAgentRun` log line, cut to the queue's declared detail when served
  (`AgentRun.source` tells which path was used; failed attempts are only captured
  by `createAgentRun`). Finished agent jobs with no run at all are counted as
  `unrecorded` (`AgentsSummary.unrecorded`), and Metrics and Runs warn about them
  instead of showing an empty screen.

## 6.5.0-beta.0

### Minor Changes

- cc8e14b: show AI agent jobs as runs: steps, tools, tokens and cost

  Queues that run AI agents can now be declared as **agent queues**, and their
  jobs open as an agent run instead of an opaque job with a wall of log lines:
  each LLM step and tool call as a graph or a waterfall, with tokens, timing and
  an estimated cost, one run per attempt so a failed attempt sits next to its
  retry. A new **Agents** screen (shown only when an agent queue exists) adds
  latency p50/p95, steps per run, tool stats (calls, duration, errors, empty
  results), tokens and cost per model, how runs ended, and a filterable list of
  recent runs. Runs that share an `input.conversationId` can be opened as a
  **conversation**: every message of the chat with its own run, as a chat
  transcript or as a list with the steps of the picked message.

  Setup is one option next to `group` on the queue adapter, plus a price table on
  the monitor:

  ```ts
  new BullAdapter(aiQueue, { group: 'AI', ai: { jobs: ['reply'], detail: 'basic' } });
  // monitor config
  ai: { pricing: { 'gemini-3.8-flash': { input: 0.75, output: 3.75 } } } // USD per 1M tokens
  ```

  Runs are recorded in your worker with the new `createAgentRun` helper exported
  by `@bull-horizon/root`, wired to the AI SDK `generateText` callbacks. It
  writes one structured line per attempt to `job.log`, has no dependencies, and
  never throws or rejects, so tracing cannot fail a job or trigger a paid retry.

  **Privacy by default.** The detail level is applied in your process, before
  anything reaches Redis. `basic` (the default, and what `ai: true` gives) keeps
  model, timing, tokens, tool names, durations and content-free summaries; tool
  inputs/outputs, step texts and the final answer are only stored at `full`,
  which is meant for test queues or dashboards behind authentication.

  Things to know:

  - Agent queues must keep finished jobs: `removeOnComplete`/`removeOnFail` set
    to `true` delete the run with the job (counted as _lost_). Use a number or an
    age.
  - The Metrics and Runs tabs need the metrics collector (`metrics: {}`); the run
    view of a single job does not.
  - Cost is an estimate computed at read time; a model without a price shows "no
    price", never `$0`.
  - Agent aggregates are not exported to the Prometheus endpoint.
  - The conversation view also needs the collector and is built from the
    recent-runs index (`ai.recentRuns`), so a long or old conversation can be
    incomplete (the screen says so). `conversationId` must be an opaque id, never
    an email, phone number or a hash of one.

  New in the public API: `QueueConfig.ai`, `Config.ai` (`pricing`, `recentRuns`),
  `createAgentRun`, the `AgentRunV1` contract types and helpers, and `Queue.agent`
  / `Queue.isAgentJob`. `Queue.getJobLogs` accepts optional `start`/`end`; custom
  `Queue` implementations should accept them too. GraphQL gains `Queue.agent`,
  `Job.agentRuns`, `Query.agentRun`, `Query.agentsSummary`, `Query.agentRuns` and
  `Query.agentConversation`.

  See `docs/agent-runs.md` for the full contract.

## 6.4.0

### Minor Changes

- c0c10c4: record real job throughput, with tiered retention and a Prometheus endpoint

  The metrics collector now counts `completed`/`failed` queue events per collection
  window instead of only snapshotting job counts. `counts.completed` is the size of
  the `completed` set in Redis — it shrinks with `removeOnComplete` and disappears
  when a queue is cleaned, so it was never a usable throughput signal. The new
  counters come from queue events and behave identically on Bull and BullMQ, which
  BullMQ's own `getMetrics()` API could not do (it does not exist on Bull at all,
  nor on the BullMQ v1 range this project supports).

  Collection stays **opt-in**: nothing is recorded until you pass a `metrics`
  config. `metrics: {}` is enough to enable it with the defaults below.

  **Retention is tiered**, so detail decays with age instead of history being
  truncated: 3 days minute-by-minute, 30 days hourly, 90 days in 12-hour buckets.
  Points are folded into the coarser tiers as they are written, which is what makes
  the long window affordable — 90 days stored raw at one-minute resolution would be
  ~36MB of Redis per queue, against ~1.5MB for all three tiers. Every tier is
  configurable in both resolution and depth via `metrics.retention`, and reads pick
  the finest tier that covers the requested window.

  **Changed defaults:** `metrics.collectInterval` is now `{ minutes: 1 }` (was
  `{ hours: 1 }`) and the raw tier keeps 4320 points (was `maxMetrics: 100`). An
  hourly interval cannot express throughput. If you were relying on the old
  interval, set it explicitly — otherwise upgrading increases how often the
  collector writes to Redis. `maxMetrics` still works as an alias for
  `retention.raw`. Existing series are kept and simply carry no throughput data for
  points collected before this release.

  An optional Prometheus/OpenMetrics endpoint (`prometheus: true`, or
  `--prometheus` on the CLI) exposes queue depth, paused state, throughput counters
  and processing time. It is **disabled by default**: it is an unauthenticated
  route on the same threat model as the GraphQL endpoint, and it publishes queue
  names as label values. One endpoint covers Prometheus, Grafana Alloy and Grafana
  Cloud, since all three scrape the same format — see `examples/grafana` for scrape
  configs and an importable dashboard.

  New in the GraphQL schema: `Query.metricsSummary` (cross-queue throughput
  aggregated server-side), `Query.metricsInfo` (collect interval and how far back
  the tiers reach), `since`/`maxPoints` arguments on `Query.metrics`, and
  `completed`/`failed`/`windowMs` on `QueueMetrics`.

  Performance, along the way: `Query.metrics` reads a bounded tail of the series
  instead of the whole list on every poll, and the `Queue` type's seven per-status
  count fields now resolve from a single `getJobCounts()` call memoized per
  request, instead of one Redis round-trip per field per queue.

### Patch Changes

- fix: add new metrics

## 6.3.1

### Patch Changes

- 8d48f39: fix: atualizar layout e filters

## 6.3.0

## 6.2.1

### Patch Changes

- 74e0498: fix: update layout base

## [6.2.0](https://github.com/marconneves/bull-horizon/compare/v6.1.0...v6.2.0) (2026-08-08)

**Note:** Version bump only for package @bull-horizon/root

## [6.1.0](https://github.com/marconneves/bull-horizon/compare/v6.0.2...v6.1.0) (2026-08-07)

### Features

- add `Queue.group` and `QueueConfig.group` — a cosmetic label consumers set on `BullAdapter`/`BullMQAdapter` to group related queues in the dashboard UI; purely a display label, doesn't affect any queue behavior

## [6.0.2](https://github.com/marconneves/bull-horizon/compare/v6.0.1...v6.0.2) (2026-08-07)

### Bug Fixes

- fix `<title>` and add favicon to the production dashboard HTML template (`src/ui.ts`) — it still said "Bull monitor" with no favicon after the 6.0.1 rename, since that release only touched the Vite dev/demo `index.html`, not this CDN-loaded template

### Features

- add `Query.metricsEnabled` and `MetricsDataSource.isEnabled()` so consumers (the dashboard UI) can check whether the metrics collector is configured before querying `metrics`
- add `Mutation.promoteJobs(queue, jobs: [ID!]!)` to promote a batch of delayed jobs in one call, mirroring the existing `retryJobs`/`removeJobs` bulk mutations

## [6.0.1](https://github.com/marconneves/bull-horizon/compare/v6.0.0...v6.0.1) (2026-08-07)

**Note:** Version bump only for package @bull-horizon/root

# [6.0.0](https://github.com/marconneves/bull-horizon/compare/v5.4.0...v6.0.0) (2026-08-07)

### Features

- replace apollo-server-core (EOL) with @apollo/server v4; export typeDefs/resolvers and a createContext() helper for framework adapters to build their own ApolloServer instance
- bump graphql to ^16, engines.node to >=14.16

### BREAKING CHANGES

- BullMonitor is no longer generic and no longer owns an ApolloServer instance (createServer()/startServer()/the `server` field were removed) — framework adapters now instantiate and own @apollo/server themselves, using the new createContext() method
- npm scope renamed: `@bull-monitor/root` → `@bull-horizon/root` (first publish under the new scope). The Redis key prefix (`bull_monitor::metrics::`) is intentionally kept unchanged for metrics continuity.

# [5.4.0](https://github.com/s-r-x/bull-monitor/compare/v5.3.0...v5.4.0) (2023-08-27)

### Features

- stopMetricsCollector and startMetricsCollector public methods ([8bd48e7](https://github.com/s-r-x/bull-monitor/commit/8bd48e75355d0aa28642709948305a314b0a19f2))

# [5.3.0](https://github.com/s-r-x/bull-monitor/compare/v5.2.0...v5.3.0) (2023-08-27)

**Note:** Version bump only for package @bull-monitor/root

# [5.2.0](https://github.com/s-r-x/bull-monitor/compare/v5.1.0...v5.2.0) (2023-08-01)

### Features

- add support for prioritized jobs ([1092d9a](https://github.com/s-r-x/bull-monitor/commit/1092d9a60c55d356f9afbc9a870185710a79444b))

# [5.1.0](https://github.com/s-r-x/bull-monitor/compare/v5.0.3...v5.1.0) (2023-01-13)

**Note:** Version bump only for package @bull-monitor/root

## [5.0.3](https://github.com/s-r-x/bull-monitor/compare/v5.0.2...v5.0.3) (2023-01-10)

### Bug Fixes

- set persistedQueries to false in the apollo server constructor to suppress cache related apollo warning in production ([acf9ba0](https://github.com/s-r-x/bull-monitor/commit/acf9ba0108595213cb913fe3df15a8100fec91ed))

## [5.0.2](https://github.com/s-r-x/bull-monitor/compare/v5.0.1...v5.0.2) (2023-01-10)

### Bug Fixes

- add "unknown" to JobStatus enum ([b381ad1](https://github.com/s-r-x/bull-monitor/commit/b381ad1c468508c18af2c57e5082930cff782512))

## [5.0.1](https://github.com/s-r-x/bull-monitor/compare/v5.0.0...v5.0.1) (2022-05-11)

### Bug Fixes

- handle metrics collector errors ([cee357b](https://github.com/s-r-x/bull-monitor/commit/cee357bbbae0478006368fa434267d6098baf844))

# [5.0.0](https://github.com/s-r-x/bull-monitor/compare/v4.1.1...v5.0.0) (2022-04-08)

### Features

- search by any field ([f5d9960](https://github.com/s-r-x/bull-monitor/commit/f5d99607b987161428700bb8a29b8326486cd6d5))

## [4.1.1](https://github.com/s-r-x/bull-monitor/compare/v4.1.0...v4.1.1) (2022-04-01)

### Bug Fixes

- make all RedisInfo fields nullable in order to support the redis environments with no support for any of them ([377381a](https://github.com/s-r-x/bull-monitor/commit/377381aed578e49b40b5f912a58e0051e17d25e4))

# [4.1.0](https://github.com/s-r-x/bull-monitor/compare/v4.0.0...v4.1.0) (2022-03-02)

**Note:** Version bump only for package @bull-monitor/root

# [4.0.0](https://github.com/s-r-x/bull-monitor/compare/v3.5.0...v4.0.0) (2022-03-02)

### Features

- bump apollo server to the latest version ([21e39e7](https://github.com/s-r-x/bull-monitor/commit/21e39e7b464f2f41006565ee282fb4fe23298a4e))

### BREAKING CHANGES

- app should be passed to monitor.init method when using
  fastify adapter

# [3.5.0](https://github.com/s-r-x/bull-monitor/compare/v3.4.1...v3.5.0) (2022-03-02)

### Features

- **bullmq:** support object progress ([4d47b08](https://github.com/s-r-x/bull-monitor/commit/4d47b08cd0dc03a0e8546e0e2985369aa4f44de3))

## [3.4.1](https://github.com/s-r-x/bull-monitor/compare/v3.4.0...v3.4.1) (2022-03-01)

**Note:** Version bump only for package @bull-monitor/root

# [3.4.0](https://github.com/s-r-x/bull-monitor/compare/v3.3.1...v3.4.0) (2022-03-01)

**Note:** Version bump only for package @bull-monitor/root

## [3.3.1](https://github.com/s-r-x/bull-monitor/compare/v3.3.0...v3.3.1) (2022-01-21)

### Bug Fixes

- handle jobs with nil timestamp ([efc78d7](https://github.com/s-r-x/bull-monitor/commit/efc78d7ed8cfe4c09e6bb4acf69581ae4e387c92))

# [3.3.0](https://github.com/s-r-x/bull-monitor/compare/v3.2.0...v3.3.0) (2022-01-12)

**Note:** Version bump only for package @bull-monitor/root

# [3.2.0](https://github.com/s-r-x/bull-monitor/compare/v3.1.0...v3.2.0) (2022-01-11)

**Note:** Version bump only for package @bull-monitor/root

# [3.1.0](https://github.com/s-r-x/bull-monitor/compare/v3.0.0...v3.1.0) (2022-01-11)

**Note:** Version bump only for package @bull-monitor/root

# [3.0.0](https://github.com/s-r-x/bull-monitor/compare/v3.0.0-alpha.3...v3.0.0) (2022-01-11)

**Note:** Version bump only for package @bull-monitor/root

# [3.0.0-alpha.3](https://github.com/s-r-x/bull-monitor/compare/v3.0.0-alpha.2...v3.0.0-alpha.3) (2022-01-11)

### Features

- pass readonly param in queue adapter constructor instead ([46ea2cc](https://github.com/s-r-x/bull-monitor/commit/46ea2cc26b63e138088e919755e8bbe17576ecb4))

### BREAKING CHANGES

- replace "[new BullAdapter(queue), { readonly: true }]"
  with "new BullAdapter(queue, { readonly: true })"

# [3.0.0-alpha.2](https://github.com/s-r-x/bull-monitor/compare/v3.0.0-alpha.1...v3.0.0-alpha.2) (2022-01-11)

### chore

- replace queues setter with setQueues method ([81aca44](https://github.com/s-r-x/bull-monitor/commit/81aca44b20d11574b8462e8eff3324b70745a37e))

### BREAKING CHANGES

- replace "monitor.queues = queues" with
  "monitor.setQueues(queues)"

# [3.0.0-alpha.1](https://github.com/s-r-x/bull-monitor/compare/v3.0.0-alpha.0...v3.0.0-alpha.1) (2022-01-10)

- feat!: compile to es2018 ([ac96e15](https://github.com/s-r-x/bull-monitor/commit/ac96e152967f8ff2c7f28030c92ea5ecaaa46cd3))

### BREAKING CHANGES

- drop support for node<10

# [3.0.0-alpha.0](https://github.com/s-r-x/bull-monitor/compare/v2.16.0...v3.0.0-alpha.0) (2022-01-10)

### Features

- bullmq support ([86fc69e](https://github.com/s-r-x/bull-monitor/commit/86fc69eddd08c129cf8a9154e2233e456413c43c))

# [2.16.0](https://github.com/s-r-x/bull-monitor/compare/v2.15.1...v2.16.0) (2021-12-16)

**Note:** Version bump only for package @bull-monitor/root

## [2.15.1](https://github.com/s-r-x/bull-monitor/compare/v2.15.0...v2.15.1) (2021-12-13)

**Note:** Version bump only for package @bull-monitor/root

# [2.15.0](https://github.com/s-r-x/bull-monitor/compare/v2.14.1...v2.15.0) (2021-12-06)

### Features

- min/max processing time metrics ([a22c234](https://github.com/s-r-x/bull-monitor/commit/a22c234709d175963ba0f545f6364ed12ce0743b))

## [2.14.1](https://github.com/s-r-x/bull-monitor/compare/v2.14.0...v2.14.1) (2021-11-29)

### Bug Fixes

- table viewport overflow on medium size devices ([5a3b327](https://github.com/s-r-x/bull-monitor/commit/5a3b32755c24f0e7a1e31324b6869fca81c3913a))

# [2.14.0](https://github.com/s-r-x/bull-monitor/compare/v2.13.0...v2.14.0) (2021-11-27)

**Note:** Version bump only for package @bull-monitor/root

# [2.13.0](https://github.com/s-r-x/bull-monitor/compare/v2.12.1...v2.13.0) (2021-11-08)

**Note:** Version bump only for package @bull-monitor/root

## [2.12.1](https://github.com/s-r-x/bull-monitor/compare/v2.12.0...v2.12.1) (2021-11-01)

**Note:** Version bump only for package @bull-monitor/root

# [2.12.0](https://github.com/s-r-x/bull-monitor/compare/v2.11.0...v2.12.0) (2021-10-26)

### Features

- **gql:** readonly queues ([2905375](https://github.com/s-r-x/bull-monitor/commit/2905375eccdc62512585cd522220f5d255657a3e))

# [2.11.0](https://github.com/s-r-x/bull-monitor/compare/v2.10.0...v2.11.0) (2021-10-07)

**Note:** Version bump only for package @bull-monitor/root

# [2.10.0](https://github.com/s-r-x/bull-monitor/compare/v2.9.0...v2.10.0) (2021-10-07)

### Features

- "processing time" metric ([0f6d9e7](https://github.com/s-r-x/bull-monitor/commit/0f6d9e70ed871c2cbf7cb1e8cf660e069912f003))

# [2.9.0](https://github.com/s-r-x/bull-monitor/compare/v2.8.0...v2.9.0) (2021-10-06)

**Note:** Version bump only for package @bull-monitor/root

# [2.8.0](https://github.com/s-r-x/bull-monitor/compare/v2.7.1...v2.8.0) (2021-10-06)

### Bug Fixes

- **root:** disable gqlPlayground and gqlIntrospection in production by default ([131f71d](https://github.com/s-r-x/bull-monitor/commit/131f71d9a62909297e9da512c8832135be5839fd))

### Performance Improvements

- **root:** convert queues to map when initializing the base class ([fd7f94f](https://github.com/s-r-x/bull-monitor/commit/fd7f94fd9fb9a1ce3b7204f7224448e41d5fc374))

## [2.7.1](https://github.com/s-r-x/bull-monitor/compare/v2.7.0...v2.7.1) (2021-09-24)

**Note:** Version bump only for package @bull-monitor/root

# [2.7.0](https://github.com/s-r-x/bull-monitor/compare/v2.6.3...v2.7.0) (2021-09-24)

**Note:** Version bump only for package @bull-monitor/root

## [2.6.3](https://github.com/s-r-x/bull-monitor/compare/v2.6.2...v2.6.3) (2021-09-24)

**Note:** Version bump only for package @bull-monitor/root

## [2.6.2](https://github.com/s-r-x/bull-monitor/compare/v2.6.0...v2.6.2) (2021-09-24)

**Note:** Version bump only for package @bull-monitor/root

# [2.6.0](https://github.com/s-r-x/bull-monitor/compare/v2.5.1...v2.6.0) (2021-09-22)

### Features

- add ability to update queues list after bull-monitor has been instantiated ([0d0c6a2](https://github.com/s-r-x/bull-monitor/commit/0d0c6a2046662172d610712002d0c317df7a3973))

## [2.5.1](https://github.com/s-r-x/bull-monitor/compare/v2.5.0...v2.5.1) (2021-09-21)

**Note:** Version bump only for package @bull-monitor/root

# [2.5.0](https://github.com/s-r-x/bull-monitor/compare/v2.4.0...v2.5.0) (2021-09-17)

**Note:** Version bump only for package @bull-monitor/root

# [2.4.0](https://github.com/s-r-x/bull-monitor/compare/v2.3.0...v2.4.0) (2021-09-16)

**Note:** Version bump only for package @bull-monitor/root

# [2.3.0](https://github.com/s-r-x/bull-monitor/compare/v2.2.0...v2.3.0) (2021-09-16)

**Note:** Version bump only for package @bull-monitor/root

# [2.2.0](https://github.com/s-r-x/bull-monitor/compare/v2.1.0...v2.2.0) (2021-09-16)

**Note:** Version bump only for package @bull-monitor/root

# [2.1.0](https://github.com/s-r-x/bull-monitor/compare/v2.0.1...v2.1.0) (2021-09-11)

**Note:** Version bump only for package @bull-monitor/root

## [2.0.1](https://github.com/s-r-x/bull-monitor/compare/v2.0.0...v2.0.1) (2021-09-11)

**Note:** Version bump only for package @bull-monitor/root

# [2.0.0](https://github.com/s-r-x/bull-monitor/compare/v1.31.0...v2.0.0) (2021-09-11)

### Features

- data search powered by jsonata ([eb61186](https://github.com/s-r-x/bull-monitor/commit/eb61186ec699fc625e4407c8d5ddd83a0aa3c92a))

# [1.31.0](https://github.com/s-r-x/bull-monitor/compare/v1.3.0...v1.31.0) (2021-08-30)

**Note:** Version bump only for package @bull-monitor/root

# [1.3.0](https://github.com/s-r-x/bull-monitor/compare/v1.2.0...v1.3.0) (2021-08-26)

**Note:** Version bump only for package @bull-monitor/root

# [1.2.0](https://github.com/s-r-x/bull-monitor/compare/v1.1.0...v1.2.0) (2021-08-23)

**Note:** Version bump only for package @bull-monitor/root

# [1.1.0](https://github.com/s-r-x/bull-monitor/compare/v1.0.0...v1.1.0) (2021-08-11)

**Note:** Version bump only for package @bull-monitor/root

# [1.0.0](https://github.com/s-r-x/bull-monitor/compare/v0.31.0...v1.0.0) (2021-08-03)

### Features

- **gql:** id field inside Queue(concatenated prefix and name then converted ([18bc332](https://github.com/s-r-x/bull-monitor/commit/18bc332d4a3e9a942d2a0ba65d8ec573a1c884eb))

### BREAKING CHANGES

- **gql:** all mutations and queries that have the "queue"
  argument now should use queue's id instead of name as a unique queue
  identifier
  BREAKING_CHANGE: since this version all the existing old metrics will be removed. they have been stored in redis assuming that queue names are unique, so queues with the same name did override metrics of each other

# [0.31.0](https://github.com/s-r-x/bull-monitor/compare/v0.30.0...v0.31.0) (2021-07-29)

**Note:** Version bump only for package @bull-monitor/root

# [0.30.0](https://github.com/s-r-x/bull-monitor/compare/v0.29.0...v0.30.0) (2021-07-27)

### Features

- **gql:** processingTime Job field ([841fb7e](https://github.com/s-r-x/bull-monitor/commit/841fb7eb29857cedff06455554ca262697b1b3a4))

# [0.29.0](https://github.com/s-r-x/bull-monitor/compare/v0.28.1...v0.29.0) (2021-07-21)

### Features

- **gql:** add keyPrefix field in Queue ([7fd7bce](https://github.com/s-r-x/bull-monitor/commit/7fd7bceb267bc080c042795f142421de3cb2ed09))

## [0.28.1](https://github.com/s-r-x/bull-monitor/compare/v0.28.0...v0.28.1) (2021-07-19)

**Note:** Version bump only for package @bull-monitor/root

# [0.28.0](https://github.com/s-r-x/bull-monitor/compare/v0.27.3...v0.28.0) (2021-07-07)

### Features

- metrics ([16af366](https://github.com/s-r-x/bull-monitor/commit/16af36690d03fdaed45ce351f3e0bf773492aac6))

## [0.27.3](https://github.com/s-r-x/bull-monitor/compare/v0.27.2...v0.27.3) (2021-07-01)

### Bug Fixes

- **gql:** Cannot return null for non-nullable field Query.jobs ([e349291](https://github.com/s-r-x/bull-monitor/commit/e3492916085c83530fb38c57942f7b84d8b379f8))
- "stuck" job status ([aa7d2f8](https://github.com/s-r-x/bull-monitor/commit/aa7d2f8006358e1346f5cc97974d3aad2a328706))

## [0.27.2](https://github.com/s-r-x/bull-monitor/compare/v0.27.1...v0.27.2) (2021-06-13)

**Note:** Version bump only for package @bull-monitor/root

## [0.27.1](https://github.com/s-r-x/bull-monitor/compare/v0.27.0...v0.27.1) (2021-06-11)

**Note:** Version bump only for package @bull-monitor/root

# [0.27.0](https://github.com/s-r-x/bull-monitor/compare/v0.26.0...v0.27.0) (2021-06-11)

### Bug Fixes

- **gql:** jobs query. validate limit and offset args ([1a43a06](https://github.com/s-r-x/bull-monitor/commit/1a43a0654c461bad00ede1de917be73cd399dce7))

# [0.26.0](https://github.com/s-r-x/bull-monitor/compare/v0.25.2...v0.26.0) (2021-06-10)

**Note:** Version bump only for package @bull-monitor/root

## [0.25.2](https://github.com/s-r-x/bull-monitor/compare/v0.25.1...v0.25.2) (2021-06-09)

**Note:** Version bump only for package @bull-monitor/root

## [0.25.1](https://github.com/s-r-x/bull-monitor/compare/v0.25.0...v0.25.1) (2021-06-09)

**Note:** Version bump only for package @bull-monitor/root

# [0.25.0](https://github.com/s-r-x/bull-monitor/compare/v0.24.0...v0.25.0) (2021-06-09)

**Note:** Version bump only for package @bull-monitor/root

# [0.24.0](https://github.com/s-r-x/bull-monitor/compare/v0.23.0...v0.24.0) (2021-06-07)

**Note:** Version bump only for package @bull-monitor/root

# [0.23.0](https://github.com/s-r-x/bull-monitor/compare/v0.22.0...v0.23.0) (2021-06-07)

**Note:** Version bump only for package @bull-monitor/root

# [0.22.0](https://github.com/s-r-x/bull-monitor/compare/v0.21.1...v0.22.0) (2021-06-07)

**Note:** Version bump only for package @bull-monitor/root

## [0.21.1](https://github.com/s-r-x/bull-monitor/compare/v0.21.0...v0.21.1) (2021-05-25)

**Note:** Version bump only for package @bull-monitor/root

# [0.21.0](https://github.com/s-r-x/bull-monitor/compare/v0.20.0...v0.21.0) (2021-05-25)

### Features

- **gql:** data text search ([6b64103](https://github.com/s-r-x/bull-monitor/commit/6b64103fadfb5492a6ce0e4d27f84dcc8b56b9fc))

# [0.20.0](https://github.com/s-r-x/bull-monitor/compare/v0.19.0...v0.20.0) (2021-05-20)

**Note:** Version bump only for package @bull-monitor/root

# [0.19.0](https://github.com/s-r-x/bull-monitor/compare/v0.18.0...v0.19.0) (2021-05-19)

**Note:** Version bump only for package @bull-monitor/root

# [0.18.0](https://github.com/s-r-x/bull-monitor/compare/v0.17.0...v0.18.0) (2021-05-18)

**Note:** Version bump only for package @bull-monitor/root

# [0.17.0](https://github.com/s-r-x/bull-monitor/compare/v0.16.0...v0.17.0) (2021-05-18)

### Features

- **gql:** add ids arg in jobs query. When specified query will return jobs with every matched id. It has priority overother args(id, order, limit, offset, status) ([88985b2](https://github.com/s-r-x/bull-monitor/commit/88985b201e127105dfcf26ffaddc4825457189a0))
- **ui:** save jobs as json ([1d8f3a2](https://github.com/s-r-x/bull-monitor/commit/1d8f3a2999fdcc7c4544cf9b9baab11785eb28fc))

# [0.16.0](https://github.com/s-r-x/bull-monitor/compare/v0.15.0...v0.16.0) (2021-05-17)

**Note:** Version bump only for package @bull-monitor/root

# [0.15.0](https://github.com/s-r-x/bull-monitor/compare/v0.14.0...v0.15.0) (2021-05-16)

**Note:** Version bump only for package @bull-monitor/root

# [0.14.0](https://github.com/s-r-x/bull-monitor/compare/v0.13.0...v0.14.0) (2021-05-16)

**Note:** Version bump only for package @bull-monitor/root

# 0.13.0 (2021-05-14)

### Features

- **gql:** removeJobs mutation ([3d0def5](https://github.com/s-r-x/bull-monitor/commit/3d0def54ce8d3c318b98d130ecf78c0352d17210))
- **gql:** retryJobs mutation ([854f19d](https://github.com/s-r-x/bull-monitor/commit/854f19db3f8dada096ab17bd81e98b99b5e49236))
