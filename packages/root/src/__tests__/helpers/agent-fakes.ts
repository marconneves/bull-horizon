import { EventEmitter } from 'events';
import { BullAdapter } from '../../bull-adapter';
import { BullMQAdapter } from '../../bullmq-adapter';
import type { AgentQueueConfig } from '../../agent';
import type { Queue } from '../../queue';

/**
 * In-memory stand-in for the slice of ioredis the collector touches: lists
 * (series), a sorted set and a hash (recent runs index), MULTI and pipelines.
 */
export class FakeRedis {
  public lists: Map<string, string[]> = new Map();
  public zsets: Map<string, Map<string, number>> = new Map();
  public hashes: Map<string, Map<string, string>> = new Map();

  async lrange(key: string, start: number, end: number) {
    const list = this.lists.get(key) ?? [];
    const from = start < 0 ? Math.max(list.length + start, 0) : start;
    const to = end < 0 ? list.length + end : end;
    return list.slice(from, to + 1);
  }
  async rpush(key: string, value: string) {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
    return list.length;
  }
  async lpop(key: string) {
    return (this.lists.get(key) ?? []).shift();
  }
  async lset(key: string, index: number, value: string) {
    const list = this.lists.get(key) ?? [];
    list[index < 0 ? list.length + index : index] = value;
    return 'OK';
  }
  async del(key: string) {
    const had =
      this.lists.delete(key) ||
      this.zsets.delete(key) ||
      this.hashes.delete(key);
    return had ? 1 : 0;
  }
  /** `zadd(key, score, member)` or `zadd(key, 'NX', score, member)`. */
  async zadd(key: string, ...args: Array<string | number>) {
    const nx = args[0] === 'NX';
    const [score, member] = (nx ? args.slice(1) : args) as [number, string];
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    this.zsets.set(key, zset);
    if (nx && zset.has(member)) return 0;
    const added = zset.has(member) ? 0 : 1;
    zset.set(member, Number(score));
    return added;
  }
  /** Like Redis: by score, ties by member (byte order). */
  private _sorted(key: string) {
    return Array.from(this.zsets.get(key) ?? new Map<string, number>())
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([member]) => member);
  }
  async zscore(key: string, member: string) {
    const score = this.zsets.get(key)?.get(member);
    return score === undefined ? null : String(score);
  }
  async zcard(key: string) {
    return this.zsets.get(key)?.size ?? 0;
  }
  /** Lex bounds: '-', '+', '[x' (inclusive) or '(x' (exclusive). */
  private _inLex(member: string, min: string, max: string) {
    const above =
      min === '-' ||
      (min[0] === '[' ? member >= min.slice(1) : member > min.slice(1));
    const below =
      max === '+' ||
      (max[0] === '[' ? member <= max.slice(1) : member < max.slice(1));
    return above && below;
  }
  async zrangebylex(
    key: string,
    min: string,
    max: string,
    ...limit: Array<string | number>
  ) {
    const found = this._sorted(key).filter((m) => this._inLex(m, min, max));
    if (limit[0] === 'LIMIT') {
      const offset = Number(limit[1]);
      const count = Number(limit[2]);
      return found.slice(offset, count < 0 ? undefined : offset + count);
    }
    return found;
  }
  async zlexcount(key: string, min: string, max: string) {
    return (await this.zrangebylex(key, min, max)).length;
  }
  async zremrangebylex(key: string, min: string, max: string) {
    const found = await this.zrangebylex(key, min, max);
    found.forEach((m) => this.zsets.get(key)?.delete(m));
    return found.length;
  }
  async zrange(key: string, start: number, stop: number) {
    const sorted = this._sorted(key);
    const from = start < 0 ? Math.max(sorted.length + start, 0) : start;
    const to = stop < 0 ? sorted.length + stop : stop;
    // Like Redis: a stop before the first element is an empty range.
    if (to < 0) return [];
    return sorted.slice(from, to + 1);
  }
  async zrevrangebyscore(key: string, _max: string, min: number) {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    return this._sorted(key)
      .filter((member) => (zset.get(member) as number) >= min)
      .reverse();
  }
  async zrem(key: string, ...members: string[]) {
    members.forEach((m) => this.zsets.get(key)?.delete(m));
  }
  async hset(key: string, field: string, value: string) {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    hash.set(field, value);
    this.hashes.set(key, hash);
  }
  async hsetnx(key: string, field: string, value: string) {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    this.hashes.set(key, hash);
    if (hash.has(field)) return 0;
    hash.set(field, value);
    return 1;
  }
  async hget(key: string, field: string) {
    return this.hashes.get(key)?.get(field) ?? null;
  }
  async hmget(key: string, ...fields: string[]) {
    return fields.map((f) => this.hashes.get(key)?.get(f) ?? null);
  }
  async hdel(key: string, ...fields: string[]) {
    fields.forEach((f) => this.hashes.get(key)?.delete(f));
  }
  private _batch() {
    const ops: Array<() => Promise<unknown>> = [];
    const chain: any = {
      exec: async () => {
        for (const op of ops) await op();
        return [];
      },
    };
    for (const name of [
      'del',
      'lpop',
      'hset',
      'hsetnx',
      'zadd',
      'zrem',
      'zremrangebylex',
      'hdel',
    ]) {
      chain[name] = (...args: any[]) => {
        ops.push(() => (this as any)[name](...args));
        return chain;
      };
    }
    return chain;
  }
  pipeline() {
    return this._batch();
  }
  multi() {
    return this._batch();
  }
}

/** Raw jobs + logs shared by the fake Bull and BullMQ queues. */
export class JobStore {
  public jobs: Map<string, Record<string, unknown>> = new Map();
  public logs: Map<string, string[]> = new Map();
  add(
    id: string,
    name: string,
    lines: string[] = [],
    extra: Record<string, unknown> = {}
  ) {
    this.jobs.set(id, { id, name, ...extra });
    this.logs.set(id, lines);
  }
  async getJob(id: string) {
    const job = this.jobs.get(id);
    return job ? { attemptsMade: 1, opts: {}, ...job } : null;
  }
  async getJobLogs(id: string, start = 0, end = -1) {
    const logs = this.logs.get(id) ?? [];
    const from = start < 0 ? Math.max(logs.length + start, 0) : start;
    const to = end < 0 ? logs.length + end : end;
    return { logs: logs.slice(from, to + 1), count: logs.length };
  }
}

export type Harness = {
  queue: Queue;
  store: JobStore;
  emitCompleted: (jobId: string) => void;
  emitFailed: (jobId: string) => void;
};

const COUNTS = async () => ({
  waiting: 0,
  active: 0,
  completed: 0,
  failed: 0,
  delayed: 0,
  paused: 0,
});

/** The real BullAdapter around a raw queue double that emits global events. */
export function bullHarness(
  redis: FakeRedis,
  ai: AgentQueueConfig | boolean
): Harness {
  const store = new JobStore();
  const raw: any = Object.assign(new EventEmitter(), {
    name: 'brand-app:ai',
    client: redis,
    clientName: () => 'bull:brand-app:ai',
    getJob: (id: string) => store.getJob(id),
    getJobLogs: (id: string, s?: number, e?: number) =>
      store.getJobLogs(id, s, e),
    getJobCounts: COUNTS,
  });
  const queue = new BullAdapter(raw, { ai });
  return {
    queue,
    store,
    emitCompleted: (jobId) => raw.emit('global:completed', jobId, '{}'),
    emitFailed: (jobId) => raw.emit('global:failed', jobId, 'boom'),
  };
}

/** The real BullMQAdapter, its QueueEvents swapped for a local emitter. */
export function bullmqHarness(
  redis: FakeRedis,
  ai: AgentQueueConfig | boolean
): Harness {
  const store = new JobStore();
  const raw: any = {
    name: 'brand-app:ai',
    opts: { prefix: 'bull' },
    client: Promise.resolve(redis),
    getJob: (id: string) => store.getJob(id),
    getJobLogs: (id: string, s?: number, e?: number) =>
      store.getJobLogs(id, s, e),
    getJobCounts: COUNTS,
  };
  const queue = new BullMQAdapter(raw, { ai });
  const events = new EventEmitter();
  (queue as any)._queueEvents = events;
  return {
    queue,
    store,
    emitCompleted: (jobId) => events.emit('completed', { jobId }),
    emitFailed: (jobId) => events.emit('failed', { jobId }),
  };
}
