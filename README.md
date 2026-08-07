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

## License

MIT
