# Change Log

## 6.5.0

### Patch Changes

- Updated dependencies [64be374]
- Updated dependencies [cc8e14b]
- Updated dependencies [3cef839]
  - @bull-horizon/root@6.5.0
  - @bull-horizon/express@6.5.0

## 6.5.0-beta.2

### Patch Changes

- Updated dependencies [3cef839]
  - @bull-horizon/root@6.5.0-beta.2
  - @bull-horizon/express@6.5.0-beta.2

## 6.5.0-beta.1

### Patch Changes

- Updated dependencies [64be374]
  - @bull-horizon/root@6.5.0-beta.1
  - @bull-horizon/express@6.5.0-beta.1

## 6.5.0-beta.0

### Patch Changes

- Updated dependencies [cc8e14b]
  - @bull-horizon/root@6.5.0-beta.0
  - @bull-horizon/express@6.5.0-beta.0

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
  - @bull-horizon/express@6.4.0
  - @bull-horizon/root@6.4.0

## 6.3.1

### Patch Changes

- 8d48f39: fix: atualizar layout e filters
- Updated dependencies [8d48f39]
  - @bull-horizon/express@6.3.1
  - @bull-horizon/root@6.3.1

## 6.3.0

### Patch Changes

- @bull-horizon/express@6.3.0
- @bull-horizon/root@6.3.0

## 6.2.1

### Patch Changes

- 74e0498: fix: update layout base
- Updated dependencies [74e0498]
  - @bull-horizon/express@6.2.1
  - @bull-horizon/root@6.2.1

## [6.2.0](https://github.com/marconneves/bull-horizon/compare/v6.1.0...v6.2.0) (2026-08-08)

**Note:** Version bump only for package @bull-horizon/cli

## [6.1.0](https://github.com/marconneves/bull-horizon/compare/v6.0.2...v6.1.0) (2026-08-07)

**Note:** Version bump only for package @bull-horizon/cli

## [6.0.2](https://github.com/marconneves/bull-horizon/compare/v6.0.1...v6.0.2) (2026-08-07)

**Note:** Version bump only for package @bull-horizon/cli

## [6.0.1](https://github.com/marconneves/bull-horizon/compare/v6.0.0...v6.0.1) (2026-08-07)

**Note:** Version bump only for package @bull-horizon/cli

# [6.0.0](https://github.com/marconneves/bull-horizon/compare/v5.4.0...v6.0.0) (2026-08-07)

**Note:** Renamed npm scope `@bull-monitor/cli` → `@bull-horizon/cli` (first publish under the new scope) and renamed the CLI binary `bull-monitor` → `bull-horizon`.

# [5.4.0](https://github.com/s-r-x/bull-monitor/compare/v5.3.0...v5.4.0) (2023-08-27)

**Note:** Version bump only for package @bull-monitor/cli

# [5.3.0](https://github.com/s-r-x/bull-monitor/compare/v5.2.0...v5.3.0) (2023-08-27)

**Note:** Version bump only for package @bull-monitor/cli

# [5.2.0](https://github.com/s-r-x/bull-monitor/compare/v5.1.0...v5.2.0) (2023-08-01)

### Features

- add support for prioritized jobs ([1092d9a](https://github.com/s-r-x/bull-monitor/commit/1092d9a60c55d356f9afbc9a870185710a79444b))

# [5.1.0](https://github.com/s-r-x/bull-monitor/compare/v5.0.3...v5.1.0) (2023-01-13)

### Features

- **cli:** add optional redis prefix option for bull/bullmq ([a5cf3b4](https://github.com/s-r-x/bull-monitor/commit/a5cf3b4dcf85b1d14d95a56e9c77401a3ead7a39))

## [5.0.3](https://github.com/s-r-x/bull-monitor/compare/v5.0.2...v5.0.3) (2023-01-10)

**Note:** Version bump only for package @bull-monitor/cli

## [5.0.2](https://github.com/s-r-x/bull-monitor/compare/v5.0.1...v5.0.2) (2023-01-10)

**Note:** Version bump only for package @bull-monitor/cli

## [5.0.1](https://github.com/s-r-x/bull-monitor/compare/v5.0.0...v5.0.1) (2022-05-11)

**Note:** Version bump only for package @bull-monitor/cli

# [5.0.0](https://github.com/s-r-x/bull-monitor/compare/v4.1.1...v5.0.0) (2022-04-08)

**Note:** Version bump only for package @bull-monitor/cli

## [4.1.1](https://github.com/s-r-x/bull-monitor/compare/v4.1.0...v4.1.1) (2022-04-01)

**Note:** Version bump only for package @bull-monitor/cli

# [4.1.0](https://github.com/s-r-x/bull-monitor/compare/v4.0.0...v4.1.0) (2022-03-02)

### Features

- **cli:** bullmq support ([8bff4b9](https://github.com/s-r-x/bull-monitor/commit/8bff4b9f6e2f42df5443fb07fe05f188e18dc554))

# [4.0.0](https://github.com/s-r-x/bull-monitor/compare/v3.5.0...v4.0.0) (2022-03-02)

### Features

- bump apollo server to the latest version ([21e39e7](https://github.com/s-r-x/bull-monitor/commit/21e39e7b464f2f41006565ee282fb4fe23298a4e))

### BREAKING CHANGES

- app should be passed to monitor.init method when using
  fastify adapter

# [3.5.0](https://github.com/s-r-x/bull-monitor/compare/v3.4.1...v3.5.0) (2022-03-02)

**Note:** Version bump only for package @bull-monitor/cli

## [3.4.1](https://github.com/s-r-x/bull-monitor/compare/v3.4.0...v3.4.1) (2022-03-01)

**Note:** Version bump only for package @bull-monitor/cli

# [3.4.0](https://github.com/s-r-x/bull-monitor/compare/v3.3.1...v3.4.0) (2022-03-01)

**Note:** Version bump only for package @bull-monitor/cli

## [3.3.1](https://github.com/s-r-x/bull-monitor/compare/v3.3.0...v3.3.1) (2022-01-21)

**Note:** Version bump only for package @bull-monitor/cli

# [3.3.0](https://github.com/s-r-x/bull-monitor/compare/v3.2.0...v3.3.0) (2022-01-12)

**Note:** Version bump only for package @bull-monitor/cli

# [3.2.0](https://github.com/s-r-x/bull-monitor/compare/v3.1.0...v3.2.0) (2022-01-11)

**Note:** Version bump only for package @bull-monitor/cli

# [3.1.0](https://github.com/s-r-x/bull-monitor/compare/v3.0.0...v3.1.0) (2022-01-11)

**Note:** Version bump only for package @bull-monitor/cli

# [3.0.0](https://github.com/s-r-x/bull-monitor/compare/v3.0.0-alpha.3...v3.0.0) (2022-01-11)

**Note:** Version bump only for package @bull-monitor/cli

# [3.0.0-alpha.3](https://github.com/s-r-x/bull-monitor/compare/v3.0.0-alpha.2...v3.0.0-alpha.3) (2022-01-11)

### Features

- pass readonly param in queue adapter constructor instead ([46ea2cc](https://github.com/s-r-x/bull-monitor/commit/46ea2cc26b63e138088e919755e8bbe17576ecb4))

### BREAKING CHANGES

- replace "[new BullAdapter(queue), { readonly: true }]"
  with "new BullAdapter(queue, { readonly: true })"

# [3.0.0-alpha.2](https://github.com/s-r-x/bull-monitor/compare/v3.0.0-alpha.1...v3.0.0-alpha.2) (2022-01-11)

**Note:** Version bump only for package @bull-monitor/cli

# [3.0.0-alpha.1](https://github.com/s-r-x/bull-monitor/compare/v3.0.0-alpha.0...v3.0.0-alpha.1) (2022-01-10)

**Note:** Version bump only for package @bull-monitor/cli

# [3.0.0-alpha.0](https://github.com/s-r-x/bull-monitor/compare/v2.16.0...v3.0.0-alpha.0) (2022-01-10)

**Note:** Version bump only for package @bull-monitor/cli

# [2.16.0](https://github.com/s-r-x/bull-monitor/compare/v2.15.1...v2.16.0) (2021-12-16)

**Note:** Version bump only for package @bull-monitor/cli

## [2.15.1](https://github.com/s-r-x/bull-monitor/compare/v2.15.0...v2.15.1) (2021-12-13)

**Note:** Version bump only for package @bull-monitor/cli

# [2.15.0](https://github.com/s-r-x/bull-monitor/compare/v2.14.1...v2.15.0) (2021-12-06)

**Note:** Version bump only for package @bull-monitor/cli

## [2.14.1](https://github.com/s-r-x/bull-monitor/compare/v2.14.0...v2.14.1) (2021-11-29)

### Bug Fixes

- table viewport overflow on medium size devices ([5a3b327](https://github.com/s-r-x/bull-monitor/commit/5a3b32755c24f0e7a1e31324b6869fca81c3913a))

# [2.14.0](https://github.com/s-r-x/bull-monitor/compare/v2.13.0...v2.14.0) (2021-11-27)

**Note:** Version bump only for package @bull-monitor/cli

# [2.13.0](https://github.com/s-r-x/bull-monitor/compare/v2.12.1...v2.13.0) (2021-11-08)

### Features

- cli ([49f7f28](https://github.com/s-r-x/bull-monitor/commit/49f7f2843be79dccbb99faf5944105c006a28428))
