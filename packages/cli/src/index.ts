#!/usr/bin/env node
import BullQueue from 'bull';
import { Queue as BullMqQueue } from 'bullmq';
import Redis from 'ioredis';
import Express from 'express';
import { BullMonitorExpress } from '@bull-horizon/express';
import { createCommand, Option } from 'commander';

const program = createCommand();

program
  .addOption(
    new Option('--redis-uri <uri>', 'redis uri').default(
      'redis://localhost:6379'
    )
  )
  .requiredOption('-q, --queue <queues...>', 'queue names')
  .option('--bullmq', 'use bullmq instead of bull')
  .option('-p, --port <number>', "server's port", '3000')
  .option('--host <string>', "server's host", 'localhost')
  .option('--prefix <string>', 'redis key prefix', undefined)
  .option('-m, --metrics', 'enable metrics collector')
  .option('--max-metrics <number>', 'max metrics', '4320')
  .option(
    '--metrics-interval <number>',
    'metrics collection interval in seconds',
    '60'
  )
  .option(
    '--prometheus',
    'expose a prometheus/openmetrics scrape endpoint (unauthenticated, like the dashboard itself)'
  )
  .option(
    '--prometheus-path <string>',
    'path of the scrape endpoint',
    '/metrics'
  );

program.parse();

const options = program.opts();

(async () => {
  const connection = options.bullmq
    ? new Redis(options.redisUri, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      })
    : undefined;
  const monitor = new BullMonitorExpress({
    queues: options.queue.map((name: string) => {
      if (options.bullmq) {
        const Adapter =
          require('@bull-horizon/root/dist/bullmq-adapter').BullMQAdapter;
        return new Adapter(
          new BullMqQueue(name, {
            ...(options.prefix ? { prefix: options.prefix } : {}),
            connection,
          })
        );
      } else {
        const Adapter =
          require('@bull-horizon/root/dist/bull-adapter').BullAdapter;
        return new Adapter(
          new BullQueue(name, options.redisUri, {
            ...(options.prefix ? { prefix: options.prefix } : {}),
          })
        );
      }
    }),
    metrics: options.metrics && {
      collectInterval: { seconds: +options.metricsInterval },
      maxMetrics: +options.maxMetrics,
    },
    prometheus: options.prometheus
      ? { enabled: true, path: options.prometheusPath }
      : false,
  });

  await monitor.init();

  const app = Express();
  app.use(monitor.router);
  app.listen(options.port, options.host, () => {
    console.log(`Ready on http://${options.host}:${options.port}/`);
    if (options.prometheus) {
      console.log(
        `Prometheus metrics on http://${options.host}:${options.port}${options.prometheusPath}`
      );
    }
  });
})();
