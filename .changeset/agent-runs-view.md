---
'@bull-horizon/root': minor
'@bull-horizon/ui': minor
---

show AI agent jobs as runs: steps, tools, tokens and cost

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
