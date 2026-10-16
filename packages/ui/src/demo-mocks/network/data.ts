import { JobStatus } from '@/typings/gql';
import range from 'lodash/range';
import sample from 'lodash/sample';
import random from 'lodash/random';
import { EnvConfig } from '@/config/env';
import without from 'lodash/without';
import { v4 as uuidv4 } from 'uuid';
import {
  agentMock,
  AGENT_QUEUE_CONFIG,
  AGENT_QUEUE_ID,
  AGENT_QUEUE_NAME,
} from './agents/runs';
import {
  FLOW_GROUP,
  FLOW_QUEUES,
  flowQueueId,
  flowTracesMock,
  traceJobData,
} from './flows/content-ingest';

type TAgentConfig = typeof AGENT_QUEUE_CONFIG;

const QUEUES_AMOUNT = 10;
const JOBS_AMOUNT = 100;

const jobStatuses = without(
  Object.values(JobStatus),
  JobStatus.Stuck
) as JobStatus[];

// Demo-only: shows off queue grouping without needing real business flows.
const DEMO_GROUPS: Record<number, string> = {
  0: 'Ingest & Processing',
  1: 'Ingest & Processing',
  2: 'Ingest & Processing',
  3: 'Typesense Indexing',
  4: 'Typesense Indexing',
};

// Deliberately varied payloads: the demo has to exercise the jsonata search for
// real — nested paths (`data.order.customer.email`), arrays
// (`data.items[0].sku`), wildcards (`data.*.email`, `data.**.code`) and keys
// that only work backticked (`data.`weird*key``). A single flat key shows none
// of that.
const DEMO_PAYLOADS: Array<(n: number) => Record<string, unknown>> = [
  (n) => ({
    source: 'checkout',
    order: {
      id: `ord_${1000 + n}`,
      total: 100 + n,
      customer: {
        email: `user${n}@acme.com`,
        plan: n % 2 ? 'pro' : 'free',
      },
    },
    items: [
      { sku: `SKU-${n}`, qty: (n % 3) + 1 },
      { sku: `SKU-${n}-B`, qty: 1 },
    ],
  }),
  (n) => ({
    source: 'webhook',
    user: {
      id: n,
      profile: {
        email: `user${n}@example.dev`,
        country: n % 2 ? 'BR' : 'PT',
      },
    },
    'weird*key': `escapa-${n}`,
    'com-traco': n,
  }),
  (n) => ({ key: `value-${n}` }),
];

// Alternates object and plain text: the Return Value pane must exercise both
// the click-to-filter on the tree (`returnvalue.status = "ok"`) and the equality
// filter over the whole block (`returnvalue = "some return value"`).
const buildReturnValue = (n: number, status: JobStatus) => {
  if (status !== JobStatus.Completed) return null;
  return n % 2 === 0
    ? JSON.stringify(
        {
          status: 'ok',
          processed: 10 + n,
          warehouse: { code: `WH-${n % 5}` },
        },
        null,
        2
      )
    : 'some return value';
};

const generateData = () => {
  const queues = range(QUEUES_AMOUNT).map((n) => ({
    id: uuidv4(),
    name: `queue:${n}`,
    isPaused: false,
    keyPrefix: 'bull',
    group: DEMO_GROUPS[n] ?? null,
    agent: null as TAgentConfig | null,
  }));
  const jobs = range(JOBS_AMOUNT).map((n) => {
    const status = sample(jobStatuses) as JobStatus;
    const delay = status === JobStatus.Delayed ? 100000 : 0;
    const timestamp = new Date().getTime();
    const isFailedOrCompleted =
      status === JobStatus.Completed || status === JobStatus.Failed;
    const isFailedOrCompletedOrActive =
      isFailedOrCompleted || status === JobStatus.Active;
    // Bull allows a custom (often long, UUID-like) jobId — mix a few in so
    // the demo also exercises the ID column's truncation/tooltip, not just
    // short auto-incremented ids.
    return {
      id: n % 11 === 0 ? uuidv4() : String(random(0, 1000000)),
      queue: sample(queues)?.id,
      status,
      progress: '0',
      attemptsMade: 0,
      returnValue: buildReturnValue(n, status),
      failedReason: status === JobStatus.Failed ? 'some failed reason' : null,
      processedOn: isFailedOrCompletedOrActive ? timestamp : null,
      finishedOn: isFailedOrCompleted ? timestamp : null,
      delay,
      timestamp,
      name: '__default__',
      opts: JSON.stringify(
        {
          timestamp,
          delay,
        },
        null,
        2
      ),
      stacktrace: [] as string[],
      data: JSON.stringify(DEMO_PAYLOADS[n % DEMO_PAYLOADS.length](n), null, 2),
      logs: {
        count: 0,
        logs: ['some log'] as string[],
      },
    };
  });
  // An AI agent queue (task 004), added after the random jobs so none of
  // them lands in it: its `reply` jobs carry one recorded run per
  // attempt in their logs, which is what the Agents screen reads.
  queues.push({
    id: AGENT_QUEUE_ID,
    name: AGENT_QUEUE_NAME,
    isPaused: false,
    keyPrefix: 'bull',
    group: 'AI agents',
    agent: AGENT_QUEUE_CONFIG,
  });
  for (const agentJob of agentMock().jobs) {
    jobs.push({
      id: agentJob.id,
      queue: AGENT_QUEUE_ID,
      status: agentJob.status,
      progress: '100',
      attemptsMade: agentJob.attemptsMade,
      returnValue: null,
      failedReason: agentJob.failedReason,
      processedOn: agentJob.processedOn,
      finishedOn: agentJob.finishedOn,
      delay: 0,
      timestamp: agentJob.timestamp,
      name: 'reply',
      opts: JSON.stringify({ attempts: 2, removeOnComplete: 500 }, null, 2),
      stacktrace: [],
      data: agentJob.data,
      logs: { count: agentJob.logs.length, logs: agentJob.logs },
    });
  }
  // Not listed in the queue's `ai.jobs`: shown without the Agent run action.
  const now = Date.now();
  jobs.push({
    id: 'cleanup-1',
    queue: AGENT_QUEUE_ID,
    status: JobStatus.Completed,
    progress: '100',
    attemptsMade: 1,
    returnValue: null,
    failedReason: null,
    processedOn: now - 30 * 60000,
    finishedOn: now - 30 * 60000 + 120,
    delay: 0,
    timestamp: now - 30 * 60000 - 50,
    name: 'cleanup',
    opts: JSON.stringify({}, null, 2),
    stacktrace: [],
    data: JSON.stringify({ olderThanDays: 30 }, null, 2),
    logs: { count: 1, logs: ['removed 12 expired drafts'] },
  });
  // The `content-ingest` flow (task 005): one queue per step in the Content
  // group, its live backlog and failures, and the jobs of the demo traces
  // (minus the ones retention already removed).
  const flowNow = Date.now();
  for (const step of FLOW_QUEUES) {
    const queueId = flowQueueId(step.queue);
    queues.push({
      id: queueId,
      name: step.queue,
      isPaused: false,
      keyPrefix: 'bull',
      group: FLOW_GROUP,
      agent: null,
    });
    const reasons = step.errors.flatMap(([message, count]) =>
      range(count).map(() => message)
    );
    const backlog: Array<[JobStatus, number]> = [
      [JobStatus.Waiting, step.waiting],
      [JobStatus.Active, step.active],
      [JobStatus.Failed, step.failedNow],
    ];
    let k = 0;
    for (const [status, count] of backlog) {
      for (const i of range(count)) {
        k += 1;
        const failed = status === JobStatus.Failed;
        const at = flowNow - (k % 90) * 20000;
        jobs.push({
          id: String(70000 + k + step.queue.length * 1000),
          queue: queueId,
          status,
          progress: '0',
          attemptsMade: failed ? 3 : 0,
          returnValue: null,
          failedReason: failed ? reasons[i] ?? 'Error: step failed' : null,
          processedOn: status === JobStatus.Waiting ? null : at + 400,
          finishedOn: failed ? at + 2400 : null,
          delay: 0,
          timestamp: at,
          name: '__default__',
          opts: JSON.stringify(
            { attempts: 3, removeOnComplete: { age: 1800 } },
            null,
            2
          ),
          stacktrace: [],
          data: JSON.stringify({ videoId: String(7428000000000 + k) }, null, 2),
          logs: { count: 0, logs: [] as string[] },
        });
      }
    }
  }
  for (const trace of flowTracesMock()) {
    for (const job of trace.jobs) {
      if (job.removed) continue;
      jobs.push({
        id: job.jobId,
        queue: job.queueId,
        status: job.status,
        progress: '0',
        attemptsMade: job.attempt,
        returnValue: job.returnValue,
        failedReason: job.failedReason ?? null,
        processedOn: job.startedAt ?? null,
        finishedOn: job.finishedAt ?? null,
        delay: 0,
        timestamp: job.enqueuedAt,
        name: '__default__',
        opts: JSON.stringify(
          { attempts: 3, removeOnComplete: { age: 1800 } },
          null,
          2
        ),
        stacktrace: job.failedReason
          ? [`Error: ${job.failedReason}\n    at processor (worker.ts:42:11)`]
          : [],
        data: traceJobData(job),
        logs: { count: 0, logs: [] as string[] },
      });
    }
  }
  return { jobs, queues };
};

type TReturnValue = ReturnType<typeof generateData>;
class NetworkMockData {
  public queues: TReturnValue['queues'] = [];
  public jobs: TReturnValue['jobs'] = [];
  constructor() {
    if (EnvConfig.useMocks) {
      const { queues, jobs } = generateData();
      this.queues = queues;
      this.jobs = jobs;
    }
  }
  public findJob(queue: string, id: string) {
    return this.jobs.find((job) => job.id == id && job.queue === queue);
  }
  public findQueue(queue: string) {
    return this.queues.find(({ id }) => queue === id);
  }
}

export const networkMockData = new NetworkMockData();
