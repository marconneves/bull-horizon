import type { SimpleIntervalSchedule } from 'toad-scheduler';
import type { Queue } from '../queue';

export type MetricsConfig = {
  redisPrefix?: string;
  collectInterval?: SimpleIntervalSchedule;
  maxMetrics?: number;
  blacklist?: string[];
};
export type QueueConfig = {
  readonly?: boolean;
};
/**
 * Prometheus/OpenMetrics scrape endpoint. Off by default on purpose: it is an
 * unauthenticated route on the same threat model as the GraphQL endpoint, and
 * it publishes queue names as label values (i.e. internal topology). Opt in
 * explicitly, and put it behind the same access control as the dashboard.
 */
export type PrometheusConfig = {
  enabled?: boolean;
  /** Mounted relative to `baseUrl`, like the GraphQL endpoint. */
  path?: string;
};
export type Config = {
  queues: Queue[];
  gqlIntrospection?: boolean;
  baseUrl?: string;
  textSearchScanCount?: number;
  metrics?: MetricsConfig | false;
  prometheus?: PrometheusConfig | boolean;
};
