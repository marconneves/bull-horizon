import { JobStatus } from '@/typings/gql';
import range from 'lodash/range';
import sample from 'lodash/sample';
import random from 'lodash/random';
import { EnvConfig } from '@/config/env';
import without from 'lodash/without';
import { v4 as uuidv4 } from 'uuid';

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
      stacktrace: [],
      data: JSON.stringify(DEMO_PAYLOADS[n % DEMO_PAYLOADS.length](n), null, 2),
      logs: {
        count: 0,
        logs: ['some log'] as string[],
      },
    };
  });
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
