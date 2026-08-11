import {
  Config,
  MetricsConfig,
  MetricsRetention,
  PrometheusConfig,
} from './typings/config';

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
const HOUR_MS = 3600000;

/**
 * Detail decays with age: full minute resolution for the last 3 days, hourly
 * out to 30 days, then 12-hourly out to 90 days — roughly 5.2k points and
 * ~1.5MB of Redis per queue, against ~36MB for the same 90 days stored raw.
 */
export const DEFAULT_METRICS_RETENTION: Required<MetricsRetention> = {
  raw: 4320, // 3 days at one minute
  rollups: [
    { everyMs: HOUR_MS, keep: 720 }, // 30 days hourly
    { everyMs: 12 * HOUR_MS, keep: 180 }, // 90 days, 12h buckets
  ],
};

export const DEFAULT_METRICS_CONFIG: Required<MetricsConfig> = {
  redisPrefix: 'bull_monitor::metrics::',
  // A one-hour interval can only ever draw a step chart of queue sizes. The
  // throughput series (completed/failed per window) is only meaningful at a
  // resolution people actually reason about, so the default is per-minute.
  collectInterval: { minutes: 1 },
  maxMetrics: DEFAULT_METRICS_RETENTION.raw,
  retention: DEFAULT_METRICS_RETENTION,
  blacklist: [],
};
export const DEFAULT_PROMETHEUS_CONFIG: Required<PrometheusConfig> = {
  enabled: false,
  path: '/metrics',
};
