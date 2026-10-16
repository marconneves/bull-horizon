import { EventEmitter } from 'events';
import { BullAdapter } from '../../bull-adapter';
import { BullMQAdapter } from '../../bullmq-adapter';
import type { FakeRedis } from './agent-fakes';
import type { Queue } from '../../queue';

export type Lib = 'bull' | 'bullmq';

/** A raw job as the lib would return it (only what the monitor reads). */
export type RawJob = {
  id: string;
  name: string;
  data?: unknown;
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
  attemptsMade?: number;
  attemptsStarted?: number;
  failedReason?: string;
  opts?: Record<string, unknown>;
  /** completed | failed | waiting | active | delayed | paused | prioritized */
  state?: string;
};

/** Raw jobs of one queue, with call counters. */
export class FlowJobStore {
  public jobs: Map<string, RawJob> = new Map();
  public getJobCalls = 0;
  public getJobsCalls = 0;
  /** Jobs returned by `getJobs`, summed. */
  public jobsRead = 0;
  constructor(private _lib: Lib) {}

  put(job: RawJob) {
    this.jobs.set(job.id, job);
    return job;
  }
  remove(id: string) {
    this.jobs.delete(id);
  }
  /** The lib's job object: markers that tell Bull and BullMQ apart. */
  materialize(job: RawJob) {
    const marker =
      this._lib === 'bull'
        ? { progress: () => 0 }
        : { progress: 0, updateProgress: async () => undefined };
    return {
      attemptsMade: 0,
      opts: {},
      ...job,
      ...marker,
      getState: async () => job.state ?? 'completed',
    };
  }
  async getJob(id: string) {
    this.getJobCalls += 1;
    const job = this.jobs.get(String(id));
    return job ? this.materialize(job) : null;
  }
  async getJobs(types: string | string[], start = 0, end = -1) {
    this.getJobsCalls += 1;
    const wanted = Array.isArray(types) ? types : [types];
    const list = Array.from(this.jobs.values())
      .filter((job) => wanted.includes(job.state ?? 'completed'))
      .sort(
        (a, b) =>
          (b.finishedOn ?? b.timestamp ?? 0) -
          (a.finishedOn ?? a.timestamp ?? 0)
      );
    const page = list.slice(start, end < 0 ? undefined : end + 1);
    this.jobsRead += page.length;
    return page.map((job) => this.materialize(job));
  }
  async getJobCounts() {
    const counts: Record<string, number> = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    };
    this.jobs.forEach((job) => {
      const state = job.state ?? 'completed';
      counts[state] = (counts[state] ?? 0) + 1;
    });
    return counts;
  }
}

export type FlowHarness = {
  lib: Lib;
  name: string;
  queue: Queue;
  store: FlowJobStore;
  emitCompleted: (jobId: string) => void;
  emitFailed: (jobId: string) => void;
};

/** The real Bull/BullMQ adapter around a raw queue double named `name`. */
export function flowQueue(
  redis: FakeRedis,
  name: string,
  lib: Lib
): FlowHarness {
  const store = new FlowJobStore(lib);
  const common = {
    name,
    getJob: (id: string) => store.getJob(id),
    getJobs: (types: string | string[], s?: number, e?: number) =>
      store.getJobs(types, s, e),
    getJobCounts: () => store.getJobCounts(),
    getJobLogs: async () => ({ logs: [], count: 0 }),
  };
  if (lib === 'bull') {
    const raw: any = Object.assign(new EventEmitter(), common, {
      client: redis,
      clientName: () => `bull:${name}`,
    });
    const queue = new BullAdapter(raw);
    return {
      lib,
      name,
      queue,
      store,
      emitCompleted: (jobId) => raw.emit('global:completed', jobId, '{}'),
      emitFailed: (jobId) => raw.emit('global:failed', jobId, 'boom'),
    };
  }
  const raw: any = {
    ...common,
    opts: { prefix: 'bull' },
    client: Promise.resolve(redis),
  };
  const queue = new BullMQAdapter(raw);
  const events = new EventEmitter();
  (queue as any)._queueEvents = events;
  return {
    lib,
    name,
    queue,
    store,
    emitCompleted: (jobId) => events.emit('completed', { jobId }),
    emitFailed: (jobId) => events.emit('failed', { jobId }),
  };
}

/** A parent job as a processor sees it (Bull: `queue.name`; BullMQ: `queueName`). */
export function processorJob(lib: Lib, queueName: string, job: RawJob) {
  const base = {
    id: job.id,
    name: job.name,
    data: job.data,
    attemptsMade: job.attemptsMade ?? (lib === 'bull' ? 0 : 1),
  };
  return lib === 'bull'
    ? { ...base, queue: { name: queueName }, progress: () => 0 }
    : {
        ...base,
        queueName,
        progress: 0,
        updateProgress: async () => undefined,
      };
}

/** Lets voided async ingestion settle. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
