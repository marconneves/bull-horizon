---
'@bull-horizon/root': minor
'@bull-horizon/express': minor
'@bull-horizon/koa': minor
'@bull-horizon/fastify': minor
'@bull-horizon/hapi': minor
'@bull-horizon/cli': minor
'@bull-horizon/ui': minor
---

record real job throughput and expose it in the dashboard and to Prometheus

The metrics collector now counts `completed`/`failed` queue events per collection
window instead of only snapshotting job counts. `counts.completed` is the size of
the `completed` set in Redis — it shrinks with `removeOnComplete` and disappears
when a queue is cleaned, so it was never a usable throughput signal. The new
counters come from queue events and behave identically on Bull and BullMQ, which
BullMQ's own `getMetrics()` API could not do (it does not exist on Bull at all,
nor on the BullMQ v1 range this project supports).

Three dashboard views build on it: a collapsible throughput chart above each
queue's job list, an **Overview** grid showing every queue's status breakdown at
a glance, and a **Metrics history** screen aggregating all queues with a
per-queue table. Navigation moved into the sidebar to fit the extra screens.

An optional Prometheus/OpenMetrics endpoint (`prometheus: true`, or
`--prometheus` on the CLI) exposes queue depth, paused state, throughput
counters and processing time. It is **disabled by default**: it is an
unauthenticated route on the same threat model as the GraphQL endpoint and
publishes queue names as label values. One endpoint covers Prometheus, Grafana
Alloy and Grafana Cloud, since all three scrape the same format — see
`examples/grafana` for scrape configs and an importable dashboard.

**Retention is now tiered**, so detail decays with age instead of history being
truncated: 3 days minute-by-minute, 30 days hourly, 90 days in 12-hour buckets.
Points are folded into the coarser tiers as they are written, which is what makes
the long window affordable — 90 days stored raw at one-minute resolution would be
~36MB of Redis per queue, against ~1.5MB for all three tiers. Every tier is
configurable in both resolution and depth via `metrics.retention`, and reads pick
the finest tier that covers the requested window.

The dashboard's range selector is derived from what the server reports
(`Query.metricsInfo`) rather than hardcoded, so changing retention changes the
available windows. Charts plot a rate per minute rather than a raw counter —
without that, a 12-hour bucket and a one-minute bucket on the same axis make the
older end of the series tower over the recent one.

**Changed defaults:** `metrics.collectInterval` is now `{ minutes: 1 }` (was
`{ hours: 1 }`) and the raw tier keeps 4320 points (was `maxMetrics: 100`). An
hourly interval cannot express throughput. `maxMetrics` still works as an alias
for `retention.raw`. Existing series are kept and simply carry no throughput data
for points collected before this release.

Also: `Query.metrics` accepts `since`/`maxPoints` and reads a bounded tail of the
series instead of the whole list on every poll; the `Queue` type's per-status
count fields now resolve from a single `getJobCounts()` call memoized per
request, instead of one Redis round-trip per field per queue.
