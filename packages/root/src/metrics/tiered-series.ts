import { JsonService } from '../services/json';
import { DEFAULT_METRICS_RETENTION } from '../constants';
import type { RedisClient } from '../queue';
import type {
  MetricsConfig,
  MetricsRetention,
  MetricsRollupTier,
} from '../typings/config';

export type TSeriesPoint = { timestamp: number };

export type TTieredSeriesOptions<TPoint extends TSeriesPoint> = {
  config: Required<MetricsConfig>;
  client: () => Promise<RedisClient>;
  /**
   * `base` is an open rollup bucket, `next` a fresh raw point landing in it.
   * The result keeps `base.timestamp` (the bucket start).
   */
  merge: (base: TPoint, next: TPoint) => TPoint;
  /**
   * Appended to `redisPrefix + queueId`. Empty for the throughput series,
   * which must keep the exact key it always had.
   */
  suffix?: string;
};

export const bucketOf = (timestamp: number, everyMs: number) =>
  Math.floor(timestamp / everyMs) * everyMs;

/**
 * Tiered retention for one kind of point, shared by every series the
 * collector writes. Points are appended to a raw list and folded into every
 * coarser tier as they are written, so detail decays with age instead of
 * history being truncated.
 *
 * Only the mechanics live here (keys, append, rollup, tail reads); what a
 * point is and how two of them merge is the caller's business.
 */
export class TieredSeries<TPoint extends TSeriesPoint> {
  constructor(private _options: TTieredSeriesOptions<TPoint>) {}

  /**
   * Rollup tiers live under a suffixed key so the raw series keeps the exact
   * key it always had — existing deployments keep their history untouched.
   */
  public key(queue: string, tier?: MetricsRollupTier): string {
    const base =
      this._options.config.redisPrefix + queue + (this._options.suffix ?? '');
    return tier ? `${base}::r${tier.everyMs}` : base;
  }
  public keys(queue: string): string[] {
    return [
      this.key(queue),
      ...this.rollups.map((tier) => this.key(queue, tier)),
    ];
  }
  public async range(queue: string, start = 0, end = -1): Promise<TPoint[]> {
    const client = await this._options.client();
    const raw = await client.lrange(this.key(queue), start, end);
    return raw.map(JsonService.maybeParse).filter(Boolean);
  }
  /**
   * Time-windowed read. Redis lists cannot be sliced by value, so the window
   * is translated into a tail slice using the known resolution and only then
   * filtered — otherwise every read would pull the whole series.
   */
  public async since(queue: string, since: number): Promise<TPoint[]> {
    // Finest tier whose span still reaches `since`. Reading raw for a 90-day
    // window would mean pulling three days of minutes and calling it 90 days.
    const tier = this.tierFor(since);
    const key = this.key(queue, tier);
    const client = await this._options.client();
    const cap = tier ? tier.keep : this.retention.raw;
    const resolutionMs = tier ? tier.everyMs : this.intervalMs;
    let tail = this._estimatePointsSince(since, resolutionMs, cap);
    let points: TPoint[] = [];
    // The estimate assumes the stored points are spaced by the *current*
    // resolution. That breaks when the interval was raised after the series
    // was written (the list is denser than we think), and a sparse series
    // makes it cover more time than needed. Silently truncating the window is
    // worse than one extra round-trip — so widen until the slice actually
    // reaches past `since` or the list runs out.
    for (;;) {
      const raw = await client.lrange(key, -tail, -1);
      points = raw.map(JsonService.maybeParse).filter(Boolean);
      const exhaustedList = raw.length < tail;
      const reachedWindow = points.length > 0 && points[0].timestamp <= since;
      if (exhaustedList || reachedWindow || tail >= cap) break;
      tail = Math.min(tail * 4, cap);
    }
    return points.filter((point) => point.timestamp >= since);
  }
  /**
   * Appends each point to its raw list (trimmed to `retention.raw`) and folds
   * it into every rollup tier.
   */
  public async append(
    entries: Array<{ queue: string; point: TPoint }>
  ): Promise<void> {
    const client = await this._options.client();
    const lpopPipeline = client.pipeline();
    await Promise.all(
      entries.map(async ({ queue, point }) => {
        const key = this.key(queue);
        const listLen = await client.rpush(key, JSON.stringify(point));
        if (listLen > this.retention.raw) {
          lpopPipeline.lpop(key);
        }
      })
    );
    await lpopPipeline.exec();
    await this._rollUp(entries);
  }
  public get retention(): Required<MetricsRetention> {
    const config = this._options.config;
    const configured = config.retention ?? {};
    return {
      // `maxMetrics` is the legacy name for the same number; honour it when
      // `retention.raw` wasn't given so old configs keep working verbatim.
      raw: configured.raw ?? config.maxMetrics ?? DEFAULT_METRICS_RETENTION.raw,
      rollups: configured.rollups ?? DEFAULT_METRICS_RETENTION.rollups,
    };
  }
  /** Ordered finest first, ignoring tiers configured to keep nothing. */
  public get rollups(): MetricsRollupTier[] {
    return this.retention.rollups
      .filter((tier) => tier.keep > 0 && tier.everyMs > 0)
      .sort((a, b) => a.everyMs - b.everyMs);
  }
  public tierFor(since: number): MetricsRollupTier | undefined {
    const needed = Math.max(Date.now() - since, 0);
    if (needed <= this.retention.raw * this.intervalMs) return undefined;
    const rollups = this.rollups;
    for (const tier of rollups) {
      if (needed <= tier.keep * tier.everyMs) return tier;
    }
    // Beyond every tier's span: the coarsest one is all the history there is.
    return rollups[rollups.length - 1];
  }
  /** Widest window that has data, across every retention tier. */
  public get retentionMs(): number {
    const spans = [
      this.retention.raw * this.intervalMs,
      ...this.rollups.map((tier) => tier.keep * tier.everyMs),
    ];
    return Math.max(...spans);
  }
  public get intervalMs(): number {
    const schedule = this._options.config.collectInterval as Record<
      string,
      number
    >;
    const ms =
      (schedule.days ?? 0) * 86400000 +
      (schedule.hours ?? 0) * 3600000 +
      (schedule.minutes ?? 0) * 60000 +
      (schedule.seconds ?? 0) * 1000 +
      (schedule.milliseconds ?? 0);
    // A misconfigured schedule must not turn into a division by zero below.
    return ms > 0 ? ms : 60000;
  }

  /**
   * Read-modify-write on the tail rather than accumulating in memory, so a
   * restart cannot lose a half-finished bucket.
   */
  private async _rollUp(entries: Array<{ queue: string; point: TPoint }>) {
    const client = await this._options.client();
    for (const tier of this.rollups) {
      await Promise.all(
        entries.map(async ({ queue, point }) => {
          const key = this.key(queue, tier);
          const bucketStart = bucketOf(point.timestamp, tier.everyMs);
          const [rawTail] = await client.lrange(key, -1, -1);
          const tail: TPoint | undefined = rawTail
            ? JsonService.maybeParse(rawTail)
            : undefined;
          if (tail && bucketOf(tail.timestamp, tier.everyMs) === bucketStart) {
            await client.lset(
              key,
              -1,
              JSON.stringify(this._options.merge(tail, point))
            );
            return;
          }
          const listLen = await client.rpush(
            key,
            JSON.stringify({ ...point, timestamp: bucketStart })
          );
          if (listLen > tier.keep) {
            await client.lpop(key);
          }
        })
      );
    }
  }
  /**
   * How many points from the tail of the list can possibly cover `since`.
   * Padded because the interval is nominal — a busy event loop stretches it —
   * and capped at the tier size because the list never grows past that.
   */
  private _estimatePointsSince(
    since: number,
    resolutionMs: number,
    cap: number
  ): number {
    const span = Math.max(Date.now() - since, 0);
    const estimate = Math.ceil(span / resolutionMs) + 2;
    return Math.min(estimate, cap);
  }
}
