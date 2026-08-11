# @bull-horizon/cli

Command line interface for [bull-horizon](https://github.com/marconneves/bull-horizon)

## Installation

```sh
npm i -g @bull-horizon/cli
```

## Usage

```sh
Usage: bull-horizon -q queue1 queue2

Options:
  --redis-uri <uri>            redis uri (default: "redis://localhost:6379")
  -q, --queue <queues...>      queue names
  --bullmq                     use bullmq instead of bull
  -p, --port <number>          server's port (default: "3000")
  --host <string>              server's host (default: "localhost")
  --prefix <string>            redis key prefix (bull/bullmq)
  -m, --metrics                enable metrics collector (off by default)
  --max-metrics <number>       points kept at collect resolution (default: "4320")
  --metrics-interval <number>  metrics collection interval in seconds (default: "60")
  --prometheus                 expose a prometheus/openmetrics scrape endpoint
  --prometheus-path <string>   path of the scrape endpoint (default: "/metrics")
  -h, --help                   display help for command
```

## Metrics

Collection is off by default. Without `--metrics` the dashboard still shows live
job counts, but there is no throughput chart and no "Metrics history" screen:

```sh
bull-horizon -q my-queue --metrics
```

`--max-metrics` sizes only the finest tier (per-minute points). The hourly and
12-hourly rollups that carry history out to 90 days use their defaults and are
configurable through the library API, not the CLI.

Add `--prometheus` to expose a scrape endpoint at `/metrics`. It is
unauthenticated, like the rest of the dashboard, and publishes queue names as
label values — see [examples/grafana](../../examples/grafana) for scrape configs
and an importable Grafana dashboard.
