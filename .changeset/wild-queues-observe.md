---
'@bull-horizon/root': minor
'@bull-horizon/express': minor
'@bull-horizon/koa': minor
'@bull-horizon/fastify': minor
'@bull-horizon/hapi': minor
'@bull-horizon/cli': minor
'@bull-horizon/ui': minor
---

record real job throughput, with tiered retention and a Prometheus endpoint

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
