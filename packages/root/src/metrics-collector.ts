import { JsonService } from './services/json';
import {
  ToadScheduler as Scheduler,
  SimpleIntervalJob as SchedulerJob,
  AsyncTask as SchedulerTask,
} from 'toad-scheduler';
import sum from 'lodash/sum';
import isEmpty from 'lodash/isEmpty';
import round from 'lodash/round';
import type { Queue, JobCounts, JobId } from './queue';
import type { MetricsConfig } from './typings/config';

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
    const key = this._buildPersistKey(queue);
    const client = await this._redisClient;
    const cap = this._config.maxMetrics;
    let tail = this._estimatePointsSince(since);
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
        } else {
          byTimestamp.set(metric.timestamp, {
            timestamp: metric.timestamp,
            completed: metric.completed ?? 0,
            failed: metric.failed ?? 0,
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
    await client.del(this._buildPersistKey(queue));
  }
  public async clearAll(): Promise<void> {
    const client = await this._redisClient;
    const pipeline = client.pipeline();
    this._queues.forEach((queue) => {
      pipeline.del(this._buildPersistKey(queue.id));
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
        if (listLen > this._config.maxMetrics) {
          lpopPipeline.lpop(key);
        }
      })
    );
    await lpopPipeline.exec();
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
  private _buildPersistKey(queue: string) {
    return this._config.redisPrefix + queue;
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
  private _estimatePointsSince(since: number): number {
    const span = Math.max(Date.now() - since, 0);
    const estimate = Math.ceil(span / this._intervalMs) + 2;
    return Math.min(estimate, this._config.maxMetrics);
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
