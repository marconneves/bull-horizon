---
'@bull-horizon/root': patch
'@bull-horizon/ui': patch
---

read agent runs from the job's return value, and say when jobs finish without a run

Agent queues whose worker returns the run as the job's return value (an
`AgentRunV1`) now show up in the Agents screen even without the
`createAgentRun` log line, cut to the queue's declared detail when served
(`AgentRun.source` tells which path was used; failed attempts are only captured
by `createAgentRun`). Finished agent jobs with no run at all are counted as
`unrecorded` (`AgentsSummary.unrecorded`), and Metrics and Runs warn about them
instead of showing an empty screen.
