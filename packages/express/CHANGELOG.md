# Change Log

## 6.5.0-beta.1

### Patch Changes

- Updated dependencies [64be374]
  - @bull-horizon/root@6.5.0-beta.1

## 6.5.0-beta.0

### Patch Changes

- Updated dependencies [cc8e14b]
  - @bull-horizon/root@6.5.0-beta.0

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
- Updated dependencies
- Updated dependencies [c0c10c4]
  - @bull-horizon/root@6.4.0

## 6.3.1

### Patch Changes

- 8d48f39: fix: atualizar layout e filters
- Updated dependencies [8d48f39]
  - @bull-horizon/root@6.3.1

## 6.3.0

### Patch Changes

- @bull-horizon/root@6.3.0

## 6.2.1

### Patch Changes

- 74e0498: fix: update layout base
- Updated dependencies [74e0498]
  - @bull-horizon/root@6.2.1

## [6.2.0](https://github.com/marconneves/bull-horizon/compare/v6.1.0...v6.2.0) (2026-08-08)

**Note:** Version bump only for package @bull-horizon/express

## [6.1.0](https://github.com/marconneves/bull-horizon/compare/v6.0.2...v6.1.0) (2026-08-07)

**Note:** Version bump only for package @bull-horizon/express

## [6.0.2](https://github.com/marconneves/bull-horizon/compare/v6.0.1...v6.0.2) (2026-08-07)

**Note:** Version bump only for package @bull-horizon/express

## [6.0.1](https://github.com/marconneves/bull-horizon/compare/v6.0.0...v6.0.1) (2026-08-07)

**Note:** Version bump only for package @bull-horizon/express

# [6.0.0](https://github.com/marconneves/bull-horizon/compare/v5.4.0...v6.0.0) (2026-08-07)

### Features

- replace apollo-server-express (EOL) with @apollo/server v4 + @as-integrations/express4; wire cors/express.json explicitly to preserve previous defaults

### BREAKING CHANGES

- now depends on @apollo/server instead of apollo-server-express; requires typescript >=4.7 and Node >=14.16 in consuming projects that type-check against this package
- npm scope renamed: `@bull-monitor/express` → `@bull-horizon/express` (first publish under the new scope)

# [5.4.0](https://github.com/s-r-x/bull-monitor/compare/v5.3.0...v5.4.0) (2023-08-27)

**Note:** Version bump only for package @bull-monitor/express

# [5.3.0](https://github.com/s-r-x/bull-monitor/compare/v5.2.0...v5.3.0) (2023-08-27)

**Note:** Version bump only for package @bull-monitor/express

# [5.2.0](https://github.com/s-r-x/bull-monitor/compare/v5.1.0...v5.2.0) (2023-08-01)

### Features

- add support for prioritized jobs ([1092d9a](https://github.com/s-r-x/bull-monitor/commit/1092d9a60c55d356f9afbc9a870185710a79444b))

# [5.1.0](https://github.com/s-r-x/bull-monitor/compare/v5.0.3...v5.1.0) (2023-01-13)

**Note:** Version bump only for package @bull-monitor/express

## [5.0.3](https://github.com/s-r-x/bull-monitor/compare/v5.0.2...v5.0.3) (2023-01-10)

**Note:** Version bump only for package @bull-monitor/express

## [5.0.2](https://github.com/s-r-x/bull-monitor/compare/v5.0.1...v5.0.2) (2023-01-10)

**Note:** Version bump only for package @bull-monitor/express

## [5.0.1](https://github.com/s-r-x/bull-monitor/compare/v5.0.0...v5.0.1) (2022-05-11)

**Note:** Version bump only for package @bull-monitor/express

# [5.0.0](https://github.com/s-r-x/bull-monitor/compare/v4.1.1...v5.0.0) (2022-04-08)

**Note:** Version bump only for package @bull-monitor/express

## [4.1.1](https://github.com/s-r-x/bull-monitor/compare/v4.1.0...v4.1.1) (2022-04-01)

**Note:** Version bump only for package @bull-monitor/express

# [4.1.0](https://github.com/s-r-x/bull-monitor/compare/v4.0.0...v4.1.0) (2022-03-02)

**Note:** Version bump only for package @bull-monitor/express

# [4.0.0](https://github.com/s-r-x/bull-monitor/compare/v3.5.0...v4.0.0) (2022-03-02)

### Features

- bump apollo server to the latest version ([21e39e7](https://github.com/s-r-x/bull-monitor/commit/21e39e7b464f2f41006565ee282fb4fe23298a4e))

### BREAKING CHANGES

- app should be passed to monitor.init method when using
  fastify adapter

# [3.5.0](https://github.com/s-r-x/bull-monitor/compare/v3.4.1...v3.5.0) (2022-03-02)

**Note:** Version bump only for package @bull-monitor/express

## [3.4.1](https://github.com/s-r-x/bull-monitor/compare/v3.4.0...v3.4.1) (2022-03-01)

**Note:** Version bump only for package @bull-monitor/express

# [3.4.0](https://github.com/s-r-x/bull-monitor/compare/v3.3.1...v3.4.0) (2022-03-01)

### Features

- **express:** init params to disable body parser, express5 specific configuration ([5069323](https://github.com/s-r-x/bull-monitor/commit/5069323bfdf17dbf9206a484e2d176bca18108e2))

## [3.3.1](https://github.com/s-r-x/bull-monitor/compare/v3.3.0...v3.3.1) (2022-01-21)

**Note:** Version bump only for package @bull-monitor/express

# [3.3.0](https://github.com/s-r-x/bull-monitor/compare/v3.2.0...v3.3.0) (2022-01-12)

**Note:** Version bump only for package @bull-monitor/express

# [3.2.0](https://github.com/s-r-x/bull-monitor/compare/v3.1.0...v3.2.0) (2022-01-11)

**Note:** Version bump only for package @bull-monitor/express

# [3.1.0](https://github.com/s-r-x/bull-monitor/compare/v3.0.0...v3.1.0) (2022-01-11)

**Note:** Version bump only for package @bull-monitor/express

# [3.0.0](https://github.com/s-r-x/bull-monitor/compare/v3.0.0-alpha.3...v3.0.0) (2022-01-11)

**Note:** Version bump only for package @bull-monitor/express

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

**Note:** Version bump only for package @bull-monitor/express

# [3.0.0-alpha.0](https://github.com/s-r-x/bull-monitor/compare/v2.16.0...v3.0.0-alpha.0) (2022-01-10)

**Note:** Version bump only for package @bull-monitor/express

# [2.16.0](https://github.com/s-r-x/bull-monitor/compare/v2.15.1...v2.16.0) (2021-12-16)

**Note:** Version bump only for package @bull-monitor/express

## [2.15.1](https://github.com/s-r-x/bull-monitor/compare/v2.15.0...v2.15.1) (2021-12-13)

**Note:** Version bump only for package @bull-monitor/express

# [2.15.0](https://github.com/s-r-x/bull-monitor/compare/v2.14.1...v2.15.0) (2021-12-06)

**Note:** Version bump only for package @bull-monitor/express

## [2.14.1](https://github.com/s-r-x/bull-monitor/compare/v2.14.0...v2.14.1) (2021-11-29)

### Bug Fixes

- table viewport overflow on medium size devices ([5a3b327](https://github.com/s-r-x/bull-monitor/commit/5a3b32755c24f0e7a1e31324b6869fca81c3913a))

# [2.14.0](https://github.com/s-r-x/bull-monitor/compare/v2.13.0...v2.14.0) (2021-11-27)

**Note:** Version bump only for package @bull-monitor/express

# [2.13.0](https://github.com/s-r-x/bull-monitor/compare/v2.12.1...v2.13.0) (2021-11-08)

**Note:** Version bump only for package @bull-monitor/express

## [2.12.1](https://github.com/s-r-x/bull-monitor/compare/v2.12.0...v2.12.1) (2021-11-01)

**Note:** Version bump only for package @bull-monitor/express

# [2.12.0](https://github.com/s-r-x/bull-monitor/compare/v2.11.0...v2.12.0) (2021-10-26)

**Note:** Version bump only for package @bull-monitor/express

# [2.11.0](https://github.com/s-r-x/bull-monitor/compare/v2.10.0...v2.11.0) (2021-10-07)

**Note:** Version bump only for package @bull-monitor/express

# [2.10.0](https://github.com/s-r-x/bull-monitor/compare/v2.9.0...v2.10.0) (2021-10-07)

**Note:** Version bump only for package @bull-monitor/express

# [2.9.0](https://github.com/s-r-x/bull-monitor/compare/v2.8.0...v2.9.0) (2021-10-06)

**Note:** Version bump only for package @bull-monitor/express

# [2.8.0](https://github.com/s-r-x/bull-monitor/compare/v2.7.1...v2.8.0) (2021-10-06)

**Note:** Version bump only for package @bull-monitor/express

## [2.7.1](https://github.com/s-r-x/bull-monitor/compare/v2.7.0...v2.7.1) (2021-09-24)

**Note:** Version bump only for package @bull-monitor/express

# [2.7.0](https://github.com/s-r-x/bull-monitor/compare/v2.6.3...v2.7.0) (2021-09-24)

**Note:** Version bump only for package @bull-monitor/express

## [2.6.3](https://github.com/s-r-x/bull-monitor/compare/v2.6.2...v2.6.3) (2021-09-24)

**Note:** Version bump only for package @bull-monitor/express

## [2.6.2](https://github.com/s-r-x/bull-monitor/compare/v2.6.0...v2.6.2) (2021-09-24)

**Note:** Version bump only for package @bull-monitor/express

# [2.6.0](https://github.com/s-r-x/bull-monitor/compare/v2.5.1...v2.6.0) (2021-09-22)

**Note:** Version bump only for package @bull-monitor/express

## [2.5.1](https://github.com/s-r-x/bull-monitor/compare/v2.5.0...v2.5.1) (2021-09-21)

**Note:** Version bump only for package @bull-monitor/express

# [2.5.0](https://github.com/s-r-x/bull-monitor/compare/v2.4.0...v2.5.0) (2021-09-17)

**Note:** Version bump only for package @bull-monitor/express

# [2.4.0](https://github.com/s-r-x/bull-monitor/compare/v2.3.0...v2.4.0) (2021-09-16)

**Note:** Version bump only for package @bull-monitor/express

# [2.3.0](https://github.com/s-r-x/bull-monitor/compare/v2.2.0...v2.3.0) (2021-09-16)

**Note:** Version bump only for package @bull-monitor/express

# [2.2.0](https://github.com/s-r-x/bull-monitor/compare/v2.1.0...v2.2.0) (2021-09-16)

**Note:** Version bump only for package @bull-monitor/express

# [2.1.0](https://github.com/s-r-x/bull-monitor/compare/v2.0.1...v2.1.0) (2021-09-11)

**Note:** Version bump only for package @bull-monitor/express

## [2.0.1](https://github.com/s-r-x/bull-monitor/compare/v2.0.0...v2.0.1) (2021-09-11)

**Note:** Version bump only for package @bull-monitor/express

# [2.0.0](https://github.com/s-r-x/bull-monitor/compare/v1.31.0...v2.0.0) (2021-09-11)

**Note:** Version bump only for package @bull-monitor/express

# [1.31.0](https://github.com/s-r-x/bull-monitor/compare/v1.3.0...v1.31.0) (2021-08-30)

**Note:** Version bump only for package @bull-monitor/express

# [1.3.0](https://github.com/s-r-x/bull-monitor/compare/v1.2.0...v1.3.0) (2021-08-26)

**Note:** Version bump only for package @bull-monitor/express

# [1.2.0](https://github.com/s-r-x/bull-monitor/compare/v1.1.0...v1.2.0) (2021-08-23)

**Note:** Version bump only for package @bull-monitor/express

# [1.1.0](https://github.com/s-r-x/bull-monitor/compare/v1.0.0...v1.1.0) (2021-08-11)

**Note:** Version bump only for package @bull-monitor/express

# [1.0.0](https://github.com/s-r-x/bull-monitor/compare/v0.31.0...v1.0.0) (2021-08-03)

**Note:** Version bump only for package @bull-monitor/express

# [0.31.0](https://github.com/s-r-x/bull-monitor/compare/v0.30.0...v0.31.0) (2021-07-29)

**Note:** Version bump only for package @bull-monitor/express

# [0.30.0](https://github.com/s-r-x/bull-monitor/compare/v0.29.0...v0.30.0) (2021-07-27)

**Note:** Version bump only for package @bull-monitor/express

# [0.29.0](https://github.com/s-r-x/bull-monitor/compare/v0.28.1...v0.29.0) (2021-07-21)

**Note:** Version bump only for package @bull-monitor/express

## [0.28.1](https://github.com/s-r-x/bull-monitor/compare/v0.28.0...v0.28.1) (2021-07-19)

**Note:** Version bump only for package @bull-monitor/express

# [0.28.0](https://github.com/s-r-x/bull-monitor/compare/v0.27.3...v0.28.0) (2021-07-07)

### Features

- metrics ([16af366](https://github.com/s-r-x/bull-monitor/commit/16af36690d03fdaed45ce351f3e0bf773492aac6))

## [0.27.3](https://github.com/s-r-x/bull-monitor/compare/v0.27.2...v0.27.3) (2021-07-01)

**Note:** Version bump only for package @bull-monitor/express

## [0.27.2](https://github.com/s-r-x/bull-monitor/compare/v0.27.1...v0.27.2) (2021-06-13)

**Note:** Version bump only for package @bull-monitor/express

## [0.27.1](https://github.com/s-r-x/bull-monitor/compare/v0.27.0...v0.27.1) (2021-06-11)

**Note:** Version bump only for package @bull-monitor/express

# [0.27.0](https://github.com/s-r-x/bull-monitor/compare/v0.26.0...v0.27.0) (2021-06-11)

**Note:** Version bump only for package @bull-monitor/express

# [0.26.0](https://github.com/s-r-x/bull-monitor/compare/v0.25.2...v0.26.0) (2021-06-10)

**Note:** Version bump only for package @bull-monitor/express

## [0.25.2](https://github.com/s-r-x/bull-monitor/compare/v0.25.1...v0.25.2) (2021-06-09)

**Note:** Version bump only for package @bull-monitor/express

## [0.25.1](https://github.com/s-r-x/bull-monitor/compare/v0.25.0...v0.25.1) (2021-06-09)

**Note:** Version bump only for package @bull-monitor/express

# [0.25.0](https://github.com/s-r-x/bull-monitor/compare/v0.24.0...v0.25.0) (2021-06-09)

**Note:** Version bump only for package @bull-monitor/express

# [0.24.0](https://github.com/s-r-x/bull-monitor/compare/v0.23.0...v0.24.0) (2021-06-07)

**Note:** Version bump only for package @bull-monitor/express

# [0.23.0](https://github.com/s-r-x/bull-monitor/compare/v0.22.0...v0.23.0) (2021-06-07)

**Note:** Version bump only for package @bull-monitor/express

# [0.22.0](https://github.com/s-r-x/bull-monitor/compare/v0.21.1...v0.22.0) (2021-06-07)

**Note:** Version bump only for package @bull-monitor/express

## [0.21.1](https://github.com/s-r-x/bull-monitor/compare/v0.21.0...v0.21.1) (2021-05-25)

**Note:** Version bump only for package @bull-monitor/express

# [0.21.0](https://github.com/s-r-x/bull-monitor/compare/v0.20.0...v0.21.0) (2021-05-25)

**Note:** Version bump only for package @bull-monitor/express

# [0.20.0](https://github.com/s-r-x/bull-monitor/compare/v0.19.0...v0.20.0) (2021-05-20)

**Note:** Version bump only for package @bull-monitor/express

# [0.19.0](https://github.com/s-r-x/bull-monitor/compare/v0.18.0...v0.19.0) (2021-05-19)

**Note:** Version bump only for package @bull-monitor/express

# [0.18.0](https://github.com/s-r-x/bull-monitor/compare/v0.17.0...v0.18.0) (2021-05-18)

**Note:** Version bump only for package @bull-monitor/express

# [0.17.0](https://github.com/s-r-x/bull-monitor/compare/v0.16.0...v0.17.0) (2021-05-18)

**Note:** Version bump only for package @bull-monitor/express

# [0.16.0](https://github.com/s-r-x/bull-monitor/compare/v0.15.0...v0.16.0) (2021-05-17)

**Note:** Version bump only for package @bull-monitor/express

# [0.15.0](https://github.com/s-r-x/bull-monitor/compare/v0.14.0...v0.15.0) (2021-05-16)

**Note:** Version bump only for package @bull-monitor/express

# [0.14.0](https://github.com/s-r-x/bull-monitor/compare/v0.13.0...v0.14.0) (2021-05-16)

**Note:** Version bump only for package @bull-monitor/express

# 0.13.0 (2021-05-14)

**Note:** Version bump only for package @bull-monitor/express
