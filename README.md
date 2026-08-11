<p align="center">
  <img src="./assets/logo.png" alt="Bull Horizon" width="80" />
</p>

<h1 align="center">Bull Horizon</h1>

<p align="center">
  Standard UI for <a href="https://github.com/OptimalBits/bull">Bull</a> and <a href="https://github.com/taskforcesh/bullmq">BullMQ</a>.
</p>

<p align="center">
  <a href="https://marconneves.github.io/bull-horizon">Demo</a>
</p>

## What is it?

Bull Horizon is a GraphQL-backed dashboard and set of middleware adapters for monitoring [Bull](https://github.com/OptimalBits/bull) and [BullMQ](https://github.com/taskforcesh/bullmq) job queues — inspect jobs, retry/remove them, search/filter with `jsonata` expressions, and optionally collect historical metrics per queue. It ships as a library you mount inside your own Node.js app (Express, Koa, Hapi or Fastify), or run standalone via the CLI.

> This project is a continuation of the original [`bull-monitor`](https://github.com/s-r-x/bull-monitor) by Ilya Strus, archived by its author in 2023. Bull Horizon picks up from there, republished under a new npm scope (`@bull-horizon/*`), starting with a migration off the discontinued Apollo Server v2/v3.

## Packages

| Package | Description |
|---|---|
| [`@bull-horizon/express`](https://github.com/marconneves/bull-horizon/tree/main/packages/express#usage) | Express middleware adapter |
| [`@bull-horizon/koa`](https://github.com/marconneves/bull-horizon/tree/main/packages/koa#usage) | Koa middleware adapter |
| [`@bull-horizon/hapi`](https://github.com/marconneves/bull-horizon/tree/main/packages/hapi#usage) | Hapi plugin adapter |
| [`@bull-horizon/fastify`](https://github.com/marconneves/bull-horizon/tree/main/packages/fastify#usage) | Fastify plugin adapter |
| [`@bull-horizon/cli`](https://github.com/marconneves/bull-horizon/tree/main/packages/cli#usage) | Standalone CLI, no app integration required |
| [Nest example](https://github.com/marconneves/bull-horizon/tree/main/examples/nest) | Usage example inside a NestJS app |

Each adapter's README has framework-specific install/usage instructions.

## Quick start (Express)

```sh
npm i @bull-horizon/express
```

```typescript
import { BullMonitorExpress } from '@bull-horizon/express';
import { BullAdapter } from '@bull-horizon/root/dist/bull-adapter';
import Express from 'express';
import Queue from 'bull';

(async () => {
  const app = Express();
  const monitor = new BullMonitorExpress({
    queues: [new BullAdapter(new Queue('my-queue', 'REDIS_URI'))],
  });
  await monitor.init();
  app.use('/bull-horizon', monitor.router);
  app.listen(3000);
})();
```

See the [Express package README](https://github.com/marconneves/bull-horizon/tree/main/packages/express#usage) for the full set of options (readonly queues, metrics collection, GraphQL introspection toggle, and more).

## Metrics and throughput

With `metrics` enabled, Bull Horizon records how many jobs completed and failed
in each collection window, per queue. This is counted from queue events, so it
works identically on Bull and BullMQ and does not depend on `removeOnComplete`
leaving jobs behind:

```typescript
const monitor = new BullMonitorExpress({
  queues: [...],
  metrics: {
    collectInterval: { minutes: 1 }, // default
    maxMetrics: 4320,                // default — 3 days at the interval above
  },
});
```

That feeds three views in the dashboard: a throughput chart above each queue's
job list, an **Overview** grid of every queue's status breakdown, and a
**Metrics history** screen aggregating all queues.

Throughput is only recorded while the monitor process is running — history is
not backfilled, and a restart leaves a gap.

## Prometheus / Grafana

An optional Prometheus/OpenMetrics endpoint can be exposed for scraping by
Prometheus, Grafana Alloy or Grafana Cloud:

```typescript
const monitor = new BullMonitorExpress({
  queues: [...],
  metrics: { collectInterval: { minutes: 1 } },
  prometheus: true, // or { enabled: true, path: '/metrics' }
});
```

```sh
bull-horizon -q my-queue --metrics --prometheus
```

It is **off by default**: the route has no authentication of its own (like the
rest of the dashboard) and publishes queue names as label values. See
[`examples/grafana`](./examples/grafana) for the exported metrics, scrape
configuration and an importable dashboard.

## Contributing

All `@bull-horizon/*` packages share a single version and are released together with
[Changesets](https://github.com/changesets/changesets). If your change should ship to npm, run
`make changeset` and commit the generated `.changeset/*.md` file alongside your code.

See [docs/RELEASING.md](./docs/RELEASING.md) for the full versioning and publishing guide.

## License

MIT
