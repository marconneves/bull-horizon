import { JsonService } from './services/json';
import {
  ToadScheduler as Scheduler,
  SimpleIntervalJob as SchedulerJob,
  AsyncTask as SchedulerTask,
} from 'toad-scheduler';
import sum from 'lodash/sum';
import isEmpty from 'lodash/isEmpty';
import round from 'lodash/round';
import { DEFAULT_METRICS_RETENTION } from './constants';
import type { Queue, JobCounts, JobId } from './queue';
import type {
  MetricsConfig,
  MetricsRetention,
  MetricsRollupTier,
} from './typings/config';

export type TMetrics = {
  queue: string;
  timestamp: number;
  counts: JobCounts;
  processingTime?: number;
  processingTimeMin?: number;
  processingTimeMax?: number;
  /**
   * Jobs that finished during the window that ends at `timestamp`. Unlike
   * `counts.completed` (the size of the `completed` set in Redis, which
   * shrinks with `removeOnComplete` and vanishes when the queue is cleaned)
   * these are event counters — they are the only honest source of throughput.
   *
   * Absent on points collected before this field existed, and on the first
   * point after a restart the window is shorter than `collectInterval`
   * (hence `windowMs`, which callers must use to derive a per-minute rate).
   */
  completed?: number;
  failed?: number;
  windowMs?: number;
};

export type TThroughputTotals = {
  completed: number;
  failed: number;
};

export type TThroughputPoint = {
  timestamp: number;
  completed: number;
  failed: number;
  /**
   * Width of the bucket these counters cover. Required by consumers: a point
   * from the 12-hourly tier and one from the raw minute tier are both "a
   * point", and comparing their raw counters is meaningless without this.
   */
  windowMs: number;
};

export type TQueueThroughputSummary = {
  queue: string;
  name: string;
  completed: number;
  failed: number;
};

export type TMetricsSummary = {
  points: TThroughputPoint[];
  totalCompleted: number;
  totalFailed: number;
  queues: TQueueThroughputSummary[];
};

export type TMetricsInfo = {
  collectIntervalMs: number;
  /** Widest window that has data, across every retention tier. */
  retentionMs: number;
};

const bucketOf = (timestamp: number, everyMs: number) =>
  Math.floor(timestamp / everyMs) * everyMs;

const minOf = (a?: number, b?: number) =>
  a == null ? b : b == null ? a : Math.min(a, b);
const maxOf = (a?: number, b?: number) =>
  a == null ? b : b == null ? a : Math.max(a, b);

export class MetricsCollector {
  private _processingTimeGauge: Map<string, number[]> = new Map();
  private _completedGauge: Map<string, number> = new Map();
  private _failedGauge: Map<string, number> = new Map();
  private _totalCompleted: Map<string, number> = new Map();
  private _totalFailed: Map<string, number> = new Map();
  private _windowStartedAt = Date.now();
  private _queues: Queue[];
  private _scheduler: Scheduler;
  private _schedulerJob: SchedulerJob;
  private _isActive = false;

  constructor(queues: Queue[], private _config: Required<MetricsConfig>) {
    this._scheduler = new Scheduler();
    this._queues = queues.filter((q) => !_config.blacklist.includes(q.name));
  }
  public startCollecting(): void {
    this._maybeCreateSchedulerJob();
    this._scheduler.addSimpleIntervalJob(this._schedulerJob);
    this._attachEventCbs();
    this._windowStartedAt = Date.now();
    this._isActive = true;
  }
  public stopCollecting(): void {
    this._scheduler.stop();
    this._detachEventCbs();
    this._isActive = false;
  }
  public async extract(
    queue: string,
    start = 0,
    end = -1
  ): Promise<TMetrics[]> {
    const key = this._buildPersistKey(queue);
    const client = await this._redisClient;
    const metrics = await client.lrange(key, start, end);
    return metrics.map(JsonService.maybeParse).filter(Boolean);
  }
  /**
   * Time-windowed read. Redis lists cannot be sliced by value, so the window
   * is translated into a tail slice using the known collect interval and only
   * then filtered — otherwise every read would pull the whole series
   * (`lrange key 0 -1`), which is exactly what made the old `extract` a
   * liability once the interval dropped to the minute range.
   *
   * `maxPoints` downsamples server-side: counts are taken from the last point
   * of each bucket (they are gauges) while completed/failed are summed (they
   * are event counters over the bucket).
   */
  public async extractSince(
    queue: string,
    since?: number,
    maxPoints?: number
  ): Promise<TMetrics[]> {
    if (!since) {
      return this._maybeDownsample(await this.extract(queue), maxPoints);
    }
    // Finest tier whose span still reaches `since`. Reading raw for a 90-day
    // window would mean pulling three days of minutes and calling it 90 days.
    const tier = this._tierFor(since);
    const key = this._buildPersistKey(queue, tier);
    const client = await this._redisClient;
    const cap = tier ? tier.keep : this._retention.raw;
    const resolutionMs = tier ? tier.everyMs : this._intervalMs;
    let tail = this._estimatePointsSince(since, resolutionMs, cap);
    let metrics: TMetrics[] = [];
    // The estimate assumes the stored points are spaced by the *current*
    // collect interval. That breaks when the interval was raised after the
    // series was written (the list is denser than we think), and silently
    // truncating the window is worse than one extra round-trip — so widen
    // until the slice actually reaches past `since` or the list runs out.
    for (;;) {
      const raw = await client.lrange(key, -tail, -1);
      metrics = raw.map(JsonService.maybeParse).filter(Boolean);
      const exhaustedList = raw.length < tail;
      const reachedWindow = metrics.length > 0 && metrics[0].timestamp <= since;
      if (exhaustedList || reachedWindow || tail >= cap) break;
      tail = Math.min(tail * 4, cap);
    }
    return this._maybeDownsample(
      metrics.filter((metric) => metric.timestamp >= since),
      maxPoints
    );
  }
  /**
   * Cross-queue aggregate for the global metrics screen. Aggregating on the
   * server is the whole point: the alternative is the dashboard pulling one
   * full series per queue on every poll and summing them in the browser.
   */
  public async getSummary(
    since?: number,
    maxPoints?: number
  ): Promise<TMetricsSummary> {
    const perQueue = await Promise.all(
      this._queues.map(async (queue) => {
        const metrics = await this.extractSince(queue.id, since);
        return { queue, metrics };
      })
    );
    const byTimestamp: Map<number, TThroughputPoint> = new Map();
    const queues: TQueueThroughputSummary[] = [];
    for (const { queue, metrics } of perQueue) {
      let completed = 0;
      let failed = 0;
      for (const metric of metrics) {
        completed += metric.completed ?? 0;
        failed += metric.failed ?? 0;
        const bucket = byTimestamp.get(metric.timestamp);
        if (bucket) {
          bucket.completed += metric.completed ?? 0;
          bucket.failed += metric.failed ?? 0;
          // Same instant across queues, so the widths agree — take the larger
          // rather than adding, which would multiply by the queue count.
          bucket.windowMs = Math.max(
            bucket.windowMs,
            metric.windowMs ?? this._intervalMs
          );
        } else {
          byTimestamp.set(metric.timestamp, {
            timestamp: metric.timestamp,
            completed: metric.completed ?? 0,
            failed: metric.failed ?? 0,
            windowMs: metric.windowMs ?? this._intervalMs,
          });
        }
      }
      queues.push({
        queue: queue.id,
        name: queue.name,
        completed,
        failed,
      });
    }
    const points = Array.from(byTimestamp.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );
    return {
      points: this._downsamplePoints(points, maxPoints),
      totalCompleted: sum(queues.map((q) => q.completed)),
      totalFailed: sum(queues.map((q) => q.failed)),
      queues: queues.sort(
        (a, b) => b.completed + b.failed - (a.completed + a.failed)
      ),
    };
  }
  /**
   * Cumulative counters since this process started — the shape Prometheus
   * expects for a `_total`. They reset on restart, which is why the exporter
   * must publish them as counters and let the scraper handle the reset.
   */
  public getThroughputTotals(queue: string): TThroughputTotals {
    return {
      completed: this._totalCompleted.get(queue) ?? 0,
      failed: this._totalFailed.get(queue) ?? 0,
    };
  }
  public async clear(queue: string): Promise<void> {
    const client = await this._redisClient;
    const pipeline = client.pipeline();
    // Every tier, otherwise "clear metrics" leaves months of rollups behind.
    for (const key of this._allPersistKeys(queue)) {
      pipeline.del(key);
    }
    await pipeline.exec();
  }
  public async clearAll(): Promise<void> {
    const client = await this._redisClient;
    const pipeline = client.pipeline();
    this._queues.forEach((queue) => {
      for (const key of this._allPersistKeys(queue.id)) {
        pipeline.del(key);
      }
    });
    await pipeline.exec();
  }
  public get queues(): Queue[] {
    return this._queues;
  }
  public set queues(queues: Queue[]) {
    this._queues = queues.filter(
      (q) => !this._config.blacklist.includes(q.name)
    );
    const queuesSet = new Set(this._queues.map(({ id }) => id));
    const gauges: Map<string, any>[] = [
      this._processingTimeGauge,
      this._completedGauge,
      this._failedGauge,
      this._totalCompleted,
      this._totalFailed,
    ];
    gauges.forEach((gauge) => {
      gauge.forEach((_: unknown, queueId: string) => {
        if (!queuesSet.has(queueId)) {
          gauge.delete(queueId);
        }
      });
    });
    if (this._isActive) {
      this._attachEventCbs();
    }
  }

  private _maybeCreateSchedulerJob() {
    if (!this._schedulerJob) {
      const task = new SchedulerTask('collect-metrics', this._taskFn);
      this._schedulerJob = new SchedulerJob(this._config.collectInterval, task);
    }
  }
  private _taskFn = async () => {
    try {
      const metrics = await this._collect();
      await this._persist(metrics);
    } catch (e) {
      console.error('[bull-horizon] metrics collector error: ', e);
    }
  };
  private async _collect(): Promise<TMetrics[]> {
    const timestamp = Date.now();
    const windowMs = timestamp - this._windowStartedAt;
    this._windowStartedAt = timestamp;
    return await Promise.all(
      this._queues.map(async (queue) => {
        const processingTime = this._extractProcessingTime(queue.id);
        this._processingTimeGauge.set(queue.id, []);
        const completed = this._completedGauge.get(queue.id) ?? 0;
        const failed = this._failedGauge.get(queue.id) ?? 0;
        this._completedGauge.set(queue.id, 0);
        this._failedGauge.set(queue.id, 0);
        return {
          timestamp,
          queue: queue.id,
          counts: await queue.getJobCounts(),
          completed,
          failed,
          windowMs,
          ...processingTime,
        };
      })
    );
  }
  private async _persist(metrics: TMetrics[]) {
    const client = await this._redisClient;
    const lpopPipeline = client.pipeline();
    await Promise.all(
      metrics.map(async (metric) => {
        const key = this._buildPersistKey(metric.queue);
        const listLen = await client.rpush(key, JSON.stringify(metric));
        if (listLen > this._retention.raw) {
          lpopPipeline.lpop(key);
        }
      })
    );
    await lpopPipeline.exec();
    await this._rollUp(metrics);
  }
  /**
   * Folds each fresh point into its hourly and daily bucket as it is written.
   * This is what makes long windows affordable: 90 days of raw one-minute
   * points is ~36MB of Redis per queue, while the rolled-up tiers cover a year
   * in ~1.5MB.
   *
   * Read-modify-write on the tail rather than accumulating in memory, so a
   * restart cannot lose a half-finished bucket.
   */
  private async _rollUp(metrics: TMetrics[]) {
    const client = await this._redisClient;
    for (const tier of this._rollups) {
      await Promise.all(
        metrics.map(async (metric) => {
          const key = this._buildPersistKey(metric.queue, tier);
          const bucketStart = bucketOf(metric.timestamp, tier.everyMs);
          const [rawTail] = await client.lrange(key, -1, -1);
          const tail: TMetrics | undefined = rawTail
            ? JsonService.maybeParse(rawTail)
            : undefined;
          if (tail && bucketOf(tail.timestamp, tier.everyMs) === bucketStart) {
            await client.lset(
              key,
              -1,
              JSON.stringify(this._mergePoints(tail, metric))
            );
            return;
          }
          const listLen = await client.rpush(
            key,
            JSON.stringify({ ...metric, timestamp: bucketStart })
          );
          if (listLen > tier.keep) {
            await client.lpop(key);
          }
        })
      );
    }
  }
  /**
   * `base` is an open bucket, `next` a fresh raw point landing in it. Counters
   * add up; `counts` are gauges, so the newest wins. Processing time is
   * weighted by how many jobs each side represents — a plain average of
   * averages would let a window with two jobs outweigh one with two thousand.
   */
  private _mergePoints(base: TMetrics, next: TMetrics): TMetrics {
    const baseCompleted = base.completed ?? 0;
    const nextCompleted = next.completed ?? 0;
    const totalCompleted = baseCompleted + nextCompleted;
    const weightedProcessingTime = () => {
      if (base.processingTime == null) return next.processingTime;
      if (next.processingTime == null) return base.processingTime;
      if (!totalCompleted) return next.processingTime;
      return this._normalizeProcessingTime(
        (base.processingTime * baseCompleted +
          next.processingTime * nextCompleted) /
          totalCompleted
      );
    };
    return {
      ...next,
      timestamp: base.timestamp,
      counts: next.counts,
      completed: totalCompleted,
      failed: (base.failed ?? 0) + (next.failed ?? 0),
      windowMs: (base.windowMs ?? 0) + (next.windowMs ?? 0),
      processingTime: weightedProcessingTime(),
      processingTimeMin: minOf(base.processingTimeMin, next.processingTimeMin),
      processingTimeMax: maxOf(base.processingTimeMax, next.processingTimeMax),
    };
  }
  private _attachEventCbs() {
    this._detachEventCbs();
    for (const queue of this._queues) {
      queue.onGlobalJobCompletion = this._onJobComplete.bind(this, queue);
      queue.onGlobalJobFailure = () => this._onJobFail(queue);
    }
  }
  private _detachEventCbs() {
    for (const queue of this._queues) {
      queue.onGlobalJobCompletion = null;
      queue.onGlobalJobFailure = null;
    }
  }
  private async _onJobComplete(queue: Queue, jobId: JobId) {
    this._bump(this._completedGauge, queue.id);
    this._bump(this._totalCompleted, queue.id);
    const job = await queue.getJob(jobId);
    if (!job?.finishedOn || !job.processedOn) {
      return;
    }
    const dur = job.finishedOn - job.processedOn;
    const gauge = this._processingTimeGauge;
    const stats = gauge.get(queue.id);
    if (!stats) {
      gauge.set(queue.id, [dur]);
    } else {
      stats.push(dur);
    }
  }
  private _onJobFail(queue: Queue) {
    this._bump(this._failedGauge, queue.id);
    this._bump(this._totalFailed, queue.id);
  }
  private _bump(gauge: Map<string, number>, queueId: string) {
    gauge.set(queueId, (gauge.get(queueId) ?? 0) + 1);
  }
  private _extractProcessingTime(
    queue: string
  ): Pick<
    TMetrics,
    'processingTime' | 'processingTimeMax' | 'processingTimeMin'
  > {
    const stats = this._processingTimeGauge.get(queue);
    if (isEmpty(stats)) return {};
    return {
      processingTime: this._normalizeProcessingTime(sum(stats) / stats!.length),
      processingTimeMin: this._normalizeProcessingTime(Math.min(...stats!)),
      processingTimeMax: this._normalizeProcessingTime(Math.max(...stats!)),
    };
  }
  private _normalizeProcessingTime(time: number) {
    return round(time, 2);
  }
  /**
   * Rollup tiers live under a suffixed key so the raw series keeps the exact
   * key it always had — existing deployments keep their history untouched.
   */
  private _buildPersistKey(queue: string, tier?: MetricsRollupTier) {
    const base = this._config.redisPrefix + queue;
    return tier ? `${base}::r${tier.everyMs}` : base;
  }
  private _allPersistKeys(queue: string): string[] {
    return [
      this._buildPersistKey(queue),
      ...this._rollups.map((tier) => this._buildPersistKey(queue, tier)),
    ];
  }
  private get _retention(): Required<MetricsRetention> {
    const configured = this._config.retention ?? {};
    return {
      // `maxMetrics` is the legacy name for the same number; honour it when
      // `retention.raw` wasn't given so old configs keep working verbatim.
      raw:
        configured.raw ??
        this._config.maxMetrics ??
        DEFAULT_METRICS_RETENTION.raw,
      rollups: configured.rollups ?? DEFAULT_METRICS_RETENTION.rollups,
    };
  }
  /** Ordered finest first, ignoring tiers configured to keep nothing. */
  private get _rollups(): MetricsRollupTier[] {
    return this._retention.rollups
      .filter((tier) => tier.keep > 0 && tier.everyMs > 0)
      .sort((a, b) => a.everyMs - b.everyMs);
  }
  private _tierFor(since: number): MetricsRollupTier | undefined {
    const needed = Math.max(Date.now() - since, 0);
    if (needed <= this._retention.raw * this._intervalMs) return undefined;
    const rollups = this._rollups;
    for (const tier of rollups) {
      if (needed <= tier.keep * tier.everyMs) return tier;
    }
    // Beyond every tier's span: the coarsest one is all the history there is.
    return rollups[rollups.length - 1];
  }
  public get info(): TMetricsInfo {
    const rollups = this._rollups;
    const spans = [
      this._retention.raw * this._intervalMs,
      ...rollups.map((tier) => tier.keep * tier.everyMs),
    ];
    return {
      collectIntervalMs: this._intervalMs,
      retentionMs: Math.max(...spans),
    };
  }
  private get _intervalMs(): number {
    const schedule = this._config.collectInterval as Record<string, number>;
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
   * How many points from the tail of the list can possibly cover `since`.
   * Padded because the interval is nominal — a busy event loop stretches it —
   * and capped at `maxMetrics` because the list never grows past that.
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
  private _downsamplePoints(
    points: TThroughputPoint[],
    maxPoints?: number
  ): TThroughputPoint[] {
    if (!maxPoints || maxPoints < 1 || points.length <= maxPoints) {
      return points;
    }
    const bucketSize = Math.ceil(points.length / maxPoints);
    const buckets: TThroughputPoint[] = [];
    for (let i = 0; i < points.length; i += bucketSize) {
      const bucket = points.slice(i, i + bucketSize);
      buckets.push({
        timestamp: bucket[bucket.length - 1].timestamp,
        completed: sum(bucket.map((p) => p.completed)),
        failed: sum(bucket.map((p) => p.failed)),
        windowMs: sum(bucket.map((p) => p.windowMs)),
      });
    }
    return buckets;
  }
  private _maybeDownsample(
    metrics: TMetrics[],
    maxPoints?: number
  ): TMetrics[] {
    if (!maxPoints || maxPoints < 1 || metrics.length <= maxPoints) {
      return metrics;
    }
    const bucketSize = Math.ceil(metrics.length / maxPoints);
    const buckets: TMetrics[] = [];
    for (let i = 0; i < metrics.length; i += bucketSize) {
      const bucket = metrics.slice(i, i + bucketSize);
      // Gauges (counts, timestamp) come from the last point of the bucket;
      // event counters are summed over it. Averaging counts would invent
      // values that never existed at any instant.
      const last = bucket[bucket.length - 1];
      buckets.push({
        ...last,
        completed: sum(bucket.map((m) => m.completed ?? 0)),
        failed: sum(bucket.map((m) => m.failed ?? 0)),
        windowMs: sum(bucket.map((m) => m.windowMs ?? this._intervalMs)),
      });
    }
    return buckets;
  }
  private get _redisClient() {
    return this._queues[0].client;
  }
}
