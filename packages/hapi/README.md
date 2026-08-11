# @bull-horizon/hapi

[Hapi](https://github.com/hapijs/hapi) adapter for [bull-horizon](https://github.com/marconneves/bull-horizon)

## Usage

```sh
npm i @bull-horizon/hapi
```

```typescript
import { BullMonitorHapi } from '@bull-horizon/hapi';
import Hapi from '@hapi/hapi';
import { BullAdapter } from '@bull-horizon/root/dist/bull-adapter';
// for BullMQ users
// import { BullMQAdapter } from "@bull-horizon/root/dist/bullmq-adapter";
import Queue from 'bull';

(async () => {
  const server = new Hapi.server({
    port: 3000,
    host: 'localhost',
  });
  const monitor = new BullMonitorHapi({
    queues: [
      new BullAdapter(new Queue('1', 'REDIS_URI')),
      // readonly queue
      new BullAdapter(new Queue('2', 'REDIS_URI'), { readonly: true }),
    ],
    baseUrl: '/my/url',
    // enables graphql introspection query. false by default if NODE_ENV == production, true otherwise
    gqlIntrospection: true,
    // Metrics collection is OFF by default. Without it the dashboard still
    // shows live job counts (sidebar, Overview), but there is no throughput
    // chart and no "Metrics history" screen, and /metrics exports gauges only.
    metrics: {
      // collect metrics every X
      // where X is any value supported by https://github.com/kibertoad/toad-scheduler
      collectInterval: { minutes: 1 },
      // Detail decays with age instead of history being truncated. Defaults
      // below cover 90 days in ~1.5MB of redis per queue; storing the same
      // window raw at one-minute resolution would take ~36MB.
      retention: {
        raw: 4320, // 3 days at the interval above
        rollups: [
          { everyMs: 3_600_000, keep: 720 }, // 30 days hourly
          { everyMs: 43_200_000, keep: 180 }, // 90 days, 12h buckets
        ],
      },
      // disable metrics for specific queues
      blacklist: ['1'],
    },
    // Prometheus/OpenMetrics scrape endpoint, mounted relative to baseUrl.
    // OFF by default: it has no authentication of its own and publishes queue
    // names as label values. See examples/grafana.
    prometheus: { enabled: true, path: '/metrics' },
  });
  await monitor.init();
  await server.register(monitor.plugin);
  await server.start();

  // replace queues
  monitor.setQueues([new BullAdapter(new Queue('3', 'REDIS_URI'))]);
})();
```
