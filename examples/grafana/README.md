# Grafana / Prometheus

Bull Horizon exposes a Prometheus/OpenMetrics scrape endpoint. It is **disabled
by default** — it is an unauthenticated route on the same threat model as the
GraphQL endpoint, and it publishes queue names as label values.

## Enabling it

```ts
const monitor = new BullMonitorExpress({
  queues: [...],
  metrics: { collectInterval: { minutes: 1 } }, // needed for the counters
  prometheus: true,                             // or { enabled: true, path: '/metrics' }
});
```

Or with the CLI:

```sh
bull-horizon -q my-queue --metrics --prometheus
```

The endpoint mounts relative to `baseUrl`, exactly like the GraphQL endpoint.

Without `metrics`, only the gauges are exported (`..._queue_jobs`,
`..._queue_paused`) — the throughput counters and processing time come from the
metrics collector.

## Exported metrics

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `bull_horizon_queue_jobs` | gauge | `queue`, `provider`, `status` | Jobs currently in the queue, per status |
| `bull_horizon_queue_paused` | gauge | `queue`, `provider` | 1 when paused, 0 when running |
| `bull_horizon_jobs_completed_total` | counter | `queue`, `provider` | Jobs completed since the monitor process started |
| `bull_horizon_jobs_failed_total` | counter | `queue`, `provider` | Jobs failed since the monitor process started |
| `bull_horizon_job_processing_time_ms` | gauge | `queue`, `provider`, `stat` | Processing time over the last collected window (`avg`/`min`/`max`) |

The `_total` counters reset when the monitor process restarts. That is normal
for a counter — `rate()` and `increase()` handle resets. It does mean these are
throughput metrics, not accounting: a job completed while the monitor was down
is never counted.

## Scraping

### Prometheus

```yaml
scrape_configs:
  - job_name: bull-horizon
    metrics_path: /metrics
    static_configs:
      - targets: ['my-app:3000']
```

### Grafana Alloy

```alloy
prometheus.scrape "bull_horizon" {
  targets    = [{ __address__ = "my-app:3000" }]
  forward_to = [prometheus.remote_write.default.receiver]
}
```

### Grafana Cloud

Point a hosted or agent-side scrape at the same endpoint — there is nothing
Bull-Horizon-specific to configure. Any collector that speaks the Prometheus
exposition format works, which is why there is no separate "Alloy mode".

## Dashboard

`dashboard.json` in this folder is an importable Grafana dashboard covering
queue depth, throughput and failure rate. Import it and pick your Prometheus
data source when prompted.
