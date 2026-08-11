import { MetricsCollector } from '../metrics-collector';
import type { TMetrics } from '../metrics-collector';
import type {
  Queue,
  GlobalJobCompletionCb,
  GlobalJobFailureCb,
} from '../queue';
import type { MetricsConfig } from '../typings/config';

const HOUR_MS = 3600000;

const CONFIG: Required<MetricsConfig> = {
  redisPrefix: 'test::metrics::',
  collectInterval: { minutes: 1 },
  maxMetrics: 4320,
  retention: {
    raw: 4320,
    rollups: [
      { everyMs: HOUR_MS, keep: 720 },
      { everyMs: 12 * HOUR_MS, keep: 180 },
    ],
  },
  blacklist: [],
};

/**
 * Minimal stand-in for the redis surface the collector uses. `lrange` here
 * implements the real negative-index semantics, because the whole point of
 * `extractSince` is that it reads a *tail slice* rather than the full list.
 */
class FakeRedis {
  public lists: Map<string, string[]> = new Map();
  public lrangeCalls: Array<[string, number, number]> = [];

  async lrange(key: string, start: number, end: number): Promise<string[]> {
    this.lrangeCalls.push([key, start, end]);
    const list = this.lists.get(key) ?? [];
    const from = start < 0 ? Math.max(list.length + start, 0) : start;
    const to = end < 0 ? list.length + end : end;
    return list.slice(from, to + 1);
  }
  async rpush(key: string, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
    return list.length;
  }
  async lpop(key: string): Promise<string | undefined> {
    return (this.lists.get(key) ?? []).shift();
  }
  async lset(key: string, index: number, value: string): Promise<'OK'> {
    const list = this.lists.get(key) ?? [];
    list[index < 0 ? list.length + index : index] = value;
    this.lists.set(key, list);
    return 'OK';
  }
  async del(key: string): Promise<number> {
    return this.lists.delete(key) ? 1 : 0;
  }
  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    const chain = {
      del: (key: string) => {
        ops.push(() => this.del(key));
        return chain;
      },
      lpop: (key: string) => {
        ops.push(() => this.lpop(key));
        return chain;
      },
      exec: async () => {
        for (const op of ops) await op();
        return [];
      },
    };
    return chain;
  }
}

type FakeQueue = Queue & {
  emitCompleted: (jobId: string) => void;
  emitFailed: (jobId: string) => void;
};

const fakeQueue = (id: string, name = id): FakeQueue => {
  let onCompleted: GlobalJobCompletionCb | null = null;
  let onFailed: GlobalJobFailureCb | null = null;
  return {
    id,
    name,
    provider: 'bull',
    getJobCounts: async () => ({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    }),
    // The collector looks the job up to measure processing time; returning
    // nothing exercises the "no timing available" path without affecting the
    // event counters, which is exactly what these tests are about.
    getJob: async () => undefined,
    set onGlobalJobCompletion(cb: GlobalJobCompletionCb | null) {
      onCompleted = cb;
    },
    set onGlobalJobFailure(cb: GlobalJobFailureCb | null) {
      onFailed = cb;
    },
    emitCompleted: (jobId: string) => onCompleted?.(jobId),
    emitFailed: (jobId: string) => onFailed?.(jobId),
  } as unknown as FakeQueue;
};

const buildCollector = (
  queues: FakeQueue[],
  config: Partial<Required<MetricsConfig>> = {}
) => {
  const collector = new MetricsCollector(queues, { ...CONFIG, ...config });
  const redis = new FakeRedis();
  // `_redisClient` reads through the first queue; injecting here keeps the
  // test off the real ioredis surface.
  Object.defineProperty(queues[0], 'client', {
    get: () => Promise.resolve(redis),
  });
  return { collector, redis };
};

const seed = (
  redis: FakeRedis,
  queueId: string,
  points: Array<Partial<TMetrics> & { timestamp: number }>
) => {
  redis.lists.set(
    CONFIG.redisPrefix + queueId,
    points.map((point) => JSON.stringify({ queue: queueId, ...point }))
  );
};

describe('MetricsCollector throughput counters', () => {
  it('counts completed and failed events per window', async () => {
    const queue = fakeQueue('q1');
    const { collector } = buildCollector([queue]);
    collector.startCollecting();

    queue.emitCompleted('1');
    queue.emitCompleted('2');
    queue.emitFailed('3');

    const [metric] = await (collector as any)._collect();
    expect(metric.completed).toBe(2);
    expect(metric.failed).toBe(1);

    collector.stopCollecting();
  });

  it('resets the per-window counters after each collection', async () => {
    const queue = fakeQueue('q1');
    const { collector } = buildCollector([queue]);
    collector.startCollecting();

    queue.emitCompleted('1');
    await (collector as any)._collect();
    const [second] = await (collector as any)._collect();

    expect(second.completed).toBe(0);

    collector.stopCollecting();
  });

  it('keeps cumulative totals across windows for the prometheus counters', async () => {
    const queue = fakeQueue('q1');
    const { collector } = buildCollector([queue]);
    collector.startCollecting();

    queue.emitCompleted('1');
    await (collector as any)._collect();
    queue.emitCompleted('2');
    queue.emitFailed('3');
    await (collector as any)._collect();

    expect(collector.getThroughputTotals('q1')).toEqual({
      completed: 2,
      failed: 1,
    });

    collector.stopCollecting();
  });

  it('detaches both event callbacks on stop', async () => {
    const queue = fakeQueue('q1');
    const { collector } = buildCollector([queue]);
    collector.startCollecting();
    collector.stopCollecting();

    queue.emitCompleted('1');
    queue.emitFailed('2');

    expect(collector.getThroughputTotals('q1')).toEqual({
      completed: 0,
      failed: 0,
    });
  });
});

describe('MetricsCollector.extractSince', () => {
  it('reads a bounded tail of the list instead of the whole series', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    const now = Date.now();
    seed(redis, 'q1', [
      { timestamp: now - 10 * 60000 },
      { timestamp: now - 60000 },
    ]);

    await collector.extractSince('q1', now - 5 * 60000);

    const [[, start, end]] = redis.lrangeCalls;
    // Negative start = tail slice. The old code always asked for `0, -1`.
    expect(start).toBeLessThan(0);
    expect(end).toBe(-1);
  });

  it('filters out points older than the requested window', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    const now = Date.now();
    seed(redis, 'q1', [
      { timestamp: now - 10 * 60000 },
      { timestamp: now - 60000 },
    ]);

    const metrics = await collector.extractSince('q1', now - 5 * 60000);

    expect(metrics).toHaveLength(1);
    expect(metrics[0].timestamp).toBe(now - 60000);
  });

  it('caps the tail read at the tier size for very wide windows', async () => {
    const queue = fakeQueue('q1');
    // No rollups, so a very wide window still resolves to the raw tier and the
    // clamp under test is the raw one.
    const { collector, redis } = buildCollector([queue], {
      retention: { raw: 10, rollups: [] },
    });
    seed(redis, 'q1', []);

    await collector.extractSince('q1', 1);

    const [[, start]] = redis.lrangeCalls;
    expect(start).toBe(-10);
  });

  it('still honours the legacy `maxMetrics` as the raw tier size', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue], {
      maxMetrics: 7,
      retention: { rollups: [] },
    });
    seed(redis, 'q1', []);

    await collector.extractSince('q1', 1);

    const [[, start]] = redis.lrangeCalls;
    expect(start).toBe(-7);
  });

  it('treats a falsy `since` as "the whole series", still honouring maxPoints', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    seed(redis, 'q1', [
      { timestamp: 1, completed: 1 },
      { timestamp: 2, completed: 2 },
    ]);

    const metrics = await collector.extractSince('q1', 0, 1);

    const [[, start, end]] = redis.lrangeCalls;
    expect([start, end]).toEqual([0, -1]);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].completed).toBe(3);
  });

  it('widens the read when the stored points are denser than the configured interval', async () => {
    const queue = fakeQueue('q1');
    // Interval says one point per hour, but the series was written every
    // second (i.e. the interval was raised after the fact). A single
    // interval-derived slice would miss almost the whole window.
    const { collector, redis } = buildCollector([queue], {
      collectInterval: { hours: 1 },
    });
    const now = Date.now();
    seed(
      redis,
      'q1',
      Array.from({ length: 60 }, (_, i) => ({
        timestamp: now - (60 - i) * 1000,
        completed: 1,
      }))
    );

    const metrics = await collector.extractSince('q1', now - 30 * 1000);

    expect(redis.lrangeCalls.length).toBeGreaterThan(1);
    expect(metrics).toHaveLength(30);
  });

  it('downsamples by summing counters and keeping the last gauge of a bucket', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    const now = Date.now();
    seed(
      redis,
      'q1',
      [1, 2, 3, 4].map((n) => ({
        timestamp: now - (5 - n) * 1000,
        completed: n,
        failed: 1,
        windowMs: 1000,
        counts: { waiting: n } as any,
      }))
    );

    const metrics = await collector.extractSince('q1', now - 60000, 2);

    expect(metrics).toHaveLength(2);
    // Buckets of 2: completed summed, counts taken from the bucket's last point.
    expect(metrics[0].completed).toBe(3);
    expect(metrics[0].failed).toBe(2);
    expect(metrics[0].windowMs).toBe(2000);
    expect(metrics[0].counts.waiting).toBe(2);
    expect(metrics[1].completed).toBe(7);
    expect(metrics[1].counts.waiting).toBe(4);
  });

  it('leaves the series untouched when it already fits maxPoints', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    const now = Date.now();
    seed(redis, 'q1', [
      { timestamp: now - 2000, completed: 1 },
      { timestamp: now - 1000, completed: 2 },
    ]);

    const metrics = await collector.extractSince('q1', now - 60000, 10);

    expect(metrics.map((m) => m.completed)).toEqual([1, 2]);
  });
});

describe('MetricsCollector.getSummary', () => {
  it('aggregates throughput across queues and ranks them by total runs', async () => {
    const q1 = fakeQueue('q1', 'emails');
    const q2 = fakeQueue('q2', 'billing');
    const { collector, redis } = buildCollector([q1, q2]);
    const now = Date.now();
    seed(redis, 'q1', [
      { timestamp: now - 2000, completed: 5, failed: 1 },
      { timestamp: now - 1000, completed: 5, failed: 0 },
    ]);
    seed(redis, 'q2', [{ timestamp: now - 2000, completed: 2, failed: 3 }]);

    const summary = await collector.getSummary(now - 60000);

    expect(summary.totalCompleted).toBe(12);
    expect(summary.totalFailed).toBe(4);
    expect(summary.queues.map((q) => q.name)).toEqual(['emails', 'billing']);
    expect(summary.queues[0]).toMatchObject({ completed: 10, failed: 1 });
  });

  it('merges points collected in the same window into one', async () => {
    const q1 = fakeQueue('q1');
    const q2 = fakeQueue('q2');
    const { collector, redis } = buildCollector([q1, q2]);
    const now = Date.now();
    // Both queues are collected in a single tick, so they share a timestamp.
    seed(redis, 'q1', [{ timestamp: now - 1000, completed: 4, failed: 0 }]);
    seed(redis, 'q2', [{ timestamp: now - 1000, completed: 6, failed: 2 }]);

    const summary = await collector.getSummary(now - 60000);

    expect(summary.points).toHaveLength(1);
    expect(summary.points[0]).toMatchObject({ completed: 10, failed: 2 });
  });
});

describe('MetricsCollector tiered retention', () => {
  const tierKey = (queueId: string, everyMs: number) =>
    `${CONFIG.redisPrefix}${queueId}::r${everyMs}`;
  const readTier = (redis: FakeRedis, queueId: string, everyMs: number) =>
    (redis.lists.get(tierKey(queueId, everyMs)) ?? []).map(
      (raw) => JSON.parse(raw) as TMetrics
    );

  it('writes each fresh point into the raw list and every rollup tier', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    collector.startCollecting();

    queue.emitCompleted('1');
    await (collector as any)._persist(await (collector as any)._collect());

    expect(redis.lists.get(CONFIG.redisPrefix + 'q1')).toHaveLength(1);
    expect(readTier(redis, 'q1', HOUR_MS)).toHaveLength(1);
    expect(readTier(redis, 'q1', 12 * HOUR_MS)).toHaveLength(1);

    collector.stopCollecting();
  });

  it('merges consecutive points into the open bucket instead of appending', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    collector.startCollecting();

    for (const _ of [1, 2, 3]) {
      queue.emitCompleted('c');
      queue.emitFailed('f');
      await (collector as any)._persist(await (collector as any)._collect());
    }

    const hourly = readTier(redis, 'q1', HOUR_MS);
    // Three ticks inside the same hour = one bucket carrying all three.
    expect(hourly).toHaveLength(1);
    expect(hourly[0].completed).toBe(3);
    expect(hourly[0].failed).toBe(3);

    collector.stopCollecting();
  });

  it('stamps rollup buckets with the bucket start, not the point timestamp', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    collector.startCollecting();

    await (collector as any)._persist(await (collector as any)._collect());

    const [bucket] = readTier(redis, 'q1', HOUR_MS);
    expect(bucket.timestamp % HOUR_MS).toBe(0);

    collector.stopCollecting();
  });

  it('weights processing time by job count when merging, not by bucket count', async () => {
    const queue = fakeQueue('q1');
    const { collector } = buildCollector([queue]);
    const merged = (collector as any)._mergePoints(
      {
        timestamp: 0,
        queue: 'q1',
        counts: {},
        completed: 1000,
        processingTime: 100,
      },
      {
        timestamp: 0,
        queue: 'q1',
        counts: {},
        completed: 1,
        processingTime: 10000,
      }
    );
    // A plain average of averages would give 5050; weighting by the 1000 vs 1
    // jobs behind each figure keeps it near 100.
    expect(merged.processingTime).toBeCloseTo(109.89, 1);
  });

  it('keeps min/max across a merge rather than the newest point', async () => {
    const queue = fakeQueue('q1');
    const { collector } = buildCollector([queue]);
    const merged = (collector as any)._mergePoints(
      {
        timestamp: 0,
        queue: 'q1',
        counts: {},
        processingTimeMin: 5,
        processingTimeMax: 900,
      },
      {
        timestamp: 0,
        queue: 'q1',
        counts: {},
        processingTimeMin: 40,
        processingTimeMax: 120,
      }
    );
    expect(merged.processingTimeMin).toBe(5);
    expect(merged.processingTimeMax).toBe(900);
  });

  it('trims a rollup tier to its configured size', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue], {
      // One-millisecond buckets so every tick lands in its own.
      retention: { raw: 4320, rollups: [{ everyMs: 1, keep: 2 }] },
    });
    collector.startCollecting();

    for (const _ of [1, 2, 3, 4]) {
      await (collector as any)._persist(await (collector as any)._collect());
    }

    expect(readTier(redis, 'q1', 1).length).toBeLessThanOrEqual(2);

    collector.stopCollecting();
  });

  it('reads the raw tier for a window the raw tier covers', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    const now = Date.now();
    seed(redis, 'q1', [{ timestamp: now - 60000 }]);

    await collector.extractSince('q1', now - 60 * 60000);

    expect(redis.lrangeCalls[0][0]).toBe(CONFIG.redisPrefix + 'q1');
  });

  it('reads the hourly tier for a window past the raw span', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    const now = Date.now();

    // 10 days: beyond the 3-day raw span, inside the 30-day hourly span.
    await collector.extractSince('q1', now - 10 * 24 * HOUR_MS);

    expect(redis.lrangeCalls[0][0]).toBe(tierKey('q1', HOUR_MS));
  });

  it('reads the coarsest tier for a window past every tier', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    const now = Date.now();

    // A year, against 90 days of retention: answer with what exists rather
    // than an empty series.
    await collector.extractSince('q1', now - 365 * 24 * HOUR_MS);

    expect(redis.lrangeCalls[0][0]).toBe(tierKey('q1', 12 * HOUR_MS));
  });

  it('reports the widest tier span as the retention', async () => {
    const queue = fakeQueue('q1');
    const { collector } = buildCollector([queue]);

    expect(collector.info).toEqual({
      collectIntervalMs: 60000,
      retentionMs: 180 * 12 * HOUR_MS, // 90 days
    });
  });

  it('clears every tier, not just the raw list', async () => {
    const queue = fakeQueue('q1');
    const { collector, redis } = buildCollector([queue]);
    collector.startCollecting();
    await (collector as any)._persist(await (collector as any)._collect());
    collector.stopCollecting();

    await collector.clear('q1');

    expect(redis.lists.get(CONFIG.redisPrefix + 'q1')).toBeUndefined();
    expect(redis.lists.get(tierKey('q1', HOUR_MS))).toBeUndefined();
    expect(redis.lists.get(tierKey('q1', 12 * HOUR_MS))).toBeUndefined();
  });
});
