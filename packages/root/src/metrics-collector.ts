import {
  ToadScheduler as Scheduler,
  SimpleIntervalJob as SchedulerJob,
  AsyncTask as SchedulerTask,
} from 'toad-scheduler';
import sum from 'lodash/sum';
import isEmpty from 'lodash/isEmpty';
import round from 'lodash/round';
import { TieredSeries } from './metrics/tiered-series';
import { AgentMetrics } from './metrics/agent-metrics';
import { DEFAULT_AGENTS_CONFIG } from './constants';
import type { Queue, JobCounts, JobId } from './queue';
import type { AgentsConfig, MetricsConfig } from './typings/config';

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

  private _series: TieredSeries<TMetrics>;
  private _agents: AgentMetrics;

  constructor(
    queues: Queue[],
    private _config: Required<MetricsConfig>,
    agentsConfig: AgentsConfig = {}
  ) {
    this._scheduler = new Scheduler();
    this._series = new TieredSeries<TMetrics>({
      config: _config,
      client: () => this._redisClient,
      merge: (base, next) => this._mergePoints(base, next),
    });
    this._agents = new AgentMetrics({
      config: _config,
      agents: { ...DEFAULT_AGENTS_CONFIG, ...agentsConfig },
      client: () => this._redisClient,
    });
    this._queues = queues.filter((q) => !_config.blacklist.includes(q.name));
  }
  public startCollecting(): void {
    this._maybeCreateSchedulerJob();
    this._scheduler.addSimpleIntervalJob(this._schedulerJob);
    this._attachEventCbs();
    this._windowStartedAt = Date.now();
    this._agents.start();
    this._isActive = true;
  }
  public stopCollecting(): void {
    this._scheduler.stop();
    this._detachEventCbs();
    this._agents.stop();
    this._isActive = false;
  }
  public async extract(
    queue: string,
    start = 0,
    end = -1
  ): Promise<TMetrics[]> {
    return await this._series.range(queue, start, end);
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
    return this._maybeDownsample(
      await this._series.since(queue, since),
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
    for (const key of this._allKeys(queue)) {
      pipeline.del(key);
    }
    await pipeline.exec();
  }
  public async clearAll(): Promise<void> {
    const client = await this._redisClient;
    const pipeline = client.pipeline();
    this._queues.forEach((queue) => {
      for (const key of this._allKeys(queue.id)) {
        pipeline.del(key);
      }
    });
    await pipeline.exec();
  }
  /** Agent run aggregates and the recent runs index (agent queues only). */
  public get agents(): AgentMetrics {
    return this._agents;
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
      await this._agents.persist(this._agents.drain(this._queues));
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
  /**
   * Each fresh point is folded into its hourly and daily bucket as it is
   * written. This is what makes long windows affordable: 90 days of raw
   * one-minute points is ~36MB of Redis per queue, while the rolled-up tiers
   * cover a year in ~1.5MB.
   */
  private async _persist(metrics: TMetrics[]) {
    await this._series.append(
      metrics.map((metric) => ({ queue: metric.queue, point: metric }))
    );
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
      queue.onGlobalJobFailure = (jobId) => this._onJobFail(queue, jobId);
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
    if (queue.agent) void this._agents.onJobFinished(queue, jobId);
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
  private _onJobFail(queue: Queue, jobId?: JobId) {
    this._bump(this._failedGauge, queue.id);
    this._bump(this._totalFailed, queue.id);
    if (queue.agent && jobId != null) {
      void this._agents.onJobFinished(queue, String(jobId));
    }
  }
  /** Every key the collector owns for a queue: throughput tiers + agents. */
  private _allKeys(queue: string): string[] {
    return [...this._series.keys(queue), ...this._agents.keys(queue)];
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
  public get info(): TMetricsInfo {
    return {
      collectIntervalMs: this._intervalMs,
      retentionMs: this._series.retentionMs,
    };
  }
  private get _intervalMs(): number {
    return this._series.intervalMs;
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
