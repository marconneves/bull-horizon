---
'@bull-horizon/root': minor
'@bull-horizon/ui': minor
---

follow a business item across queues: flows and traces

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
