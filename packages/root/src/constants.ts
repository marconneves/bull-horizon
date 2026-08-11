import { Config, MetricsConfig, PrometheusConfig } from './typings/config';

export const PROD = process.env.NODE_ENV === 'production';
export const DEV = !PROD;
export const DEFAULT_DATA_SEARCH_SCAN_COUNT = 500;

export const DEFAULT_ROOT_CONFIG: Required<Config> = {
  queues: [],
  baseUrl: '',
  gqlIntrospection: DEV,
  textSearchScanCount: DEFAULT_DATA_SEARCH_SCAN_COUNT,
  metrics: false,
  prometheus: false,
};
export const DEFAULT_METRICS_CONFIG: Required<MetricsConfig> = {
  redisPrefix: 'bull_monitor::metrics::',
  // A one-hour interval can only ever draw a step chart of queue sizes. The
  // throughput series (completed/failed per window) is only meaningful at a
  // resolution people actually reason about, so the default is per-minute.
  collectInterval: { minutes: 1 },
  // 4320 points = 3 days at the default interval, ~1MB of Redis per queue.
  // Raise it for longer retention, at a linear memory cost per queue.
  maxMetrics: 4320,
  blacklist: [],
};
export const DEFAULT_PROMETHEUS_CONFIG: Required<PrometheusConfig> = {
  enabled: false,
  path: '/metrics',
};
