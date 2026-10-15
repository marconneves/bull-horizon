import type { SimpleIntervalSchedule } from 'toad-scheduler';
import type { Queue } from '../queue';

/** One rollup tier: keep `keep` buckets of `everyMs` each. */
export type MetricsRollupTier = {
  /** Bucket resolution in milliseconds. */
  everyMs: number;
  /** How many buckets to keep. Its span is `keep x everyMs`. */
  keep: number;
};

/**
 * Tiered retention — long windows without storing everything at collect
 * resolution. Points are folded into coarser buckets as they are written, so
 * detail decays with age instead of history being truncated.
 *
 * The cost difference is the whole point: 90 days of raw one-minute points is
 * ~130k points (~36MB of Redis) *per queue*. The default tiers below cover the
 * same 90 days in ~5.2k points (~1.5MB), with full minute detail where it is
 * actually read.
 */
export type MetricsRetention = {
  /** Points at `collectInterval`. Default 4320 — 3 days at one minute. */
  raw?: number;
  /**
   * Coarser tiers, ordered finest first. Default: hourly for 30 days, then
   * 12-hourly for 90 days. Pass `[]` to keep only the raw tier.
   */
  rollups?: MetricsRollupTier[];
};
export type MetricsConfig = {
  redisPrefix?: string;
  collectInterval?: SimpleIntervalSchedule;
  /**
   * @deprecated Alias for `retention.raw`, kept for compatibility. When both
   * are set, `retention.raw` wins.
   */
  maxMetrics?: number;
  retention?: MetricsRetention;
  blacklist?: string[];
};
export type { QueueConfig } from '../queue';
/** USD per 1 million tokens. */
export type AgentModelPrice = { input: number; output: number };
export type AgentsConfig = {
  /**
   * Key = model name as recorded in the run (exact match, case-insensitive).
   * A model without a price shows no cost, never a cost of 0.
   */
  pricing?: Record<string, AgentModelPrice>;
  /** Size of the per-queue recent runs index. Default 2000. */
  recentRuns?: number;
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
  /** AI agent queues: model pricing and the recent runs index. */
  ai?: AgentsConfig;
};
