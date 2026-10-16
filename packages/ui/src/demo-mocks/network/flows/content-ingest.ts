// Demo flow `content-ingest`, the shape of the design's module 05 with
// neutral names: one item (a video) walking ~16 queues, a conditional entry,
// fan-out, a fallback branch and an error step. Pure data with a seeded RNG,
// no import of the shared mock store (which imports this module).
import {
  FlowCheckLevel,
  FlowEdgeKind,
  FlowStepKind,
  FlowTraceStatus,
  JobStatus,
} from '../../../typings/gql';
import type {
  FlowTraceJobFieldsFragment,
  GetFlowSummaryQuery,
  GetFlowsQuery,
} from '../../../typings/gql';

type TFlow = GetFlowsQuery['flows'][0];
type TSummary = NonNullable<GetFlowSummaryQuery['flowSummary']>;
type TTraceJob = FlowTraceJobFieldsFragment;

export const FLOW_ID = 'content-ingest';
export const FLOW_GROUP = 'Content';
export const FLOW_KEY_LABEL = 'videoId';
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Queue id as the monitor reports it (`keyPrefix:name`). */
export const flowQueueId = (queue: string) => `bull:${queue}`;

type TStepSpec = {
  key: string;
  queue: string;
  description: string;
  kind?: FlowStepKind;
  when?: string;
  /** Live counts. */
  waiting: number;
  active: number;
  failedNow: number;
  /** Per 24h. */
  done: number;
  failed: number;
  perMin: number;
  p50: number;
  p95: number;
  waitAvg: number;
  errors?: Array<[string, number]>;
};

const STEPS: TStepSpec[] = [
  {
    key: 'verify',
    queue: 'content:VerifyIfVideoExists',
    description: 'known item? refresh its stats, new ones go on',
    waiting: 2,
    active: 1,
    failedNow: 6,
    done: 18420,
    failed: 6,
    perMin: 12.8,
    p50: 84,
    p95: 310,
    waitAvg: 400,
  },
  {
    key: 'extract',
    queue: 'content:ExtractVideoInfo',
    description: 'cover, url, duration, author',
    waiting: 5,
    active: 3,
    failedNow: 41,
    done: 9210,
    failed: 41,
    perMin: 6.4,
    p50: 1900,
    p95: 6200,
    waitAvg: 1100,
    errors: [['Video unavailable (410)', 41]],
  },
  {
    key: 'setup',
    queue: 'content:SetupVideoContent',
    description: 'stores the video and a stats snapshot',
    waiting: 0,
    active: 1,
    failedNow: 3,
    done: 9170,
    failed: 3,
    perMin: 6.4,
    p50: 220,
    p95: 780,
    waitAvg: 300,
  },
  {
    key: 'comments',
    queue: 'content:IndexComments',
    description: 'comments (comments API + LLM summary)',
    waiting: 18,
    active: 4,
    failedNow: 112,
    done: 8890,
    failed: 112,
    perMin: 6.1,
    p50: 7400,
    p95: 21000,
    waitAvg: 4200,
    errors: [
      ['Comments API 429 Too Many Requests', 84],
      ['LLM timeout 30000ms', 28],
    ],
  },
  {
    key: 'idxVideo',
    queue: 'content:IndexVideoSearch',
    description: 'indexes the video for search',
    waiting: 0,
    active: 0,
    failedNow: 2,
    done: 9168,
    failed: 2,
    perMin: 6.4,
    p50: 140,
    p95: 400,
    waitAvg: 200,
  },
  {
    key: 'clean',
    queue: 'content:CleanTempImportItem',
    description: 'removes the temporary import item',
    waiting: 0,
    active: 0,
    failedNow: 0,
    done: 9166,
    failed: 0,
    perMin: 6.4,
    p50: 60,
    p95: 190,
    waitAvg: 200,
  },
  {
    key: 'category',
    queue: 'content:SelectCategory',
    description: 'category',
    waiting: 1,
    active: 1,
    failedNow: 8,
    done: 9160,
    failed: 8,
    perMin: 6.4,
    p50: 2100,
    p95: 5800,
    waitAvg: 600,
  },
  {
    key: 'product',
    queue: 'content:SetupProduct',
    description: 'product and its search index',
    waiting: 0,
    active: 1,
    failedNow: 14,
    done: 9140,
    failed: 14,
    perMin: 6.3,
    p50: 640,
    p95: 2400,
    waitAvg: 400,
    errors: [['Missing lock for job', 14]],
  },
  {
    key: 'author',
    queue: 'content:SetupAuthor',
    description: 'author and its search index',
    waiting: 0,
    active: 0,
    failedNow: 9,
    done: 9122,
    failed: 9,
    perMin: 6.3,
    p50: 410,
    p95: 1600,
    waitAvg: 300,
  },
  {
    key: 'transcr',
    queue: 'content:TranscriptionApi',
    description: 'transcription',
    waiting: 412,
    active: 8,
    failedNow: 96,
    done: 8410,
    failed: 96,
    perMin: 5.1,
    p50: 38000,
    p95: 130000,
    waitAvg: 580000,
    errors: [
      ['Transcription API 429 rate limit', 71],
      ['audio longer than 600s', 25],
    ],
  },
  {
    key: 'download',
    queue: 'content:DownloadVideo',
    description: 'fallback: downloads the video',
    waiting: 3,
    active: 2,
    failedNow: 21,
    done: 690,
    failed: 21,
    perMin: 0.5,
    p50: 12000,
    p95: 41000,
    waitAvg: 2000,
    errors: [['403 Forbidden from the media CDN', 21]],
  },
  {
    key: 'speech',
    queue: 'content:TranscribeAudio',
    description: 'transcribes the downloaded audio',
    waiting: 6,
    active: 2,
    failedNow: 37,
    done: 651,
    failed: 37,
    perMin: 0.5,
    p50: 54000,
    p95: 182000,
    waitAvg: 3100,
    errors: [['ECONNRESET while uploading audio', 37]],
  },
  {
    key: 'saveTr',
    queue: 'contentSaveTranscription',
    description: 'stores the transcription',
    waiting: 0,
    active: 0,
    failedNow: 0,
    done: 648,
    failed: 0,
    perMin: 0.5,
    p50: 90,
    p95: 300,
    waitAvg: 200,
  },
  {
    key: 'translate',
    queue: 'content:TranslateTranscription',
    description: 'translation, when not in the target language',
    when: 'language != target',
    waiting: 2,
    active: 1,
    failedNow: 18,
    done: 6120,
    failed: 18,
    perMin: 4.6,
    p50: 3200,
    p95: 9100,
    waitAvg: 800,
    errors: [['LLM 503 Service Unavailable', 18]],
  },
  {
    key: 'reindex',
    queue: 'content:ReindexSearch',
    description: 'reindexes video, product and author',
    waiting: 0,
    active: 0,
    failedNow: 5,
    done: 9020,
    failed: 5,
    perMin: 6.2,
    p50: 180,
    p95: 520,
    waitAvg: 300,
  },
  {
    key: 'error',
    queue: 'content:SaveErrorState',
    description: 'error in any step',
    kind: FlowStepKind.Error,
    waiting: 0,
    active: 0,
    failedNow: 0,
    done: 347,
    failed: 0,
    perMin: 0.2,
    p50: 40,
    p95: 120,
    waitAvg: 100,
  },
];

const stepByKey = new Map(STEPS.map((s) => [s.key, s]));
const idOf = (key: string) => (stepByKey.get(key) as TStepSpec).queue;

export const END_ID = `${idOf('verify')}::end0`;

/** [from, to, kind, when] by step key. */
const EDGES: Array<[string, string, FlowEdgeKind, string?]> = [
  ['verify', 'extract', FlowEdgeKind.Conditional, 'new'],
  ['verify', 'END', FlowEdgeKind.End, 'already known'],
  ['extract', 'setup', FlowEdgeKind.Next],
  ['setup', 'comments', FlowEdgeKind.Next],
  ['setup', 'idxVideo', FlowEdgeKind.Next],
  ['setup', 'category', FlowEdgeKind.Next],
  ['idxVideo', 'clean', FlowEdgeKind.Next],
  ['category', 'product', FlowEdgeKind.Next],
  ['product', 'author', FlowEdgeKind.Next],
  ['author', 'transcr', FlowEdgeKind.Next],
  ['author', 'download', FlowEdgeKind.Fallback, 'fallback'],
  ['transcr', 'translate', FlowEdgeKind.Next],
  ['download', 'speech', FlowEdgeKind.Next],
  ['speech', 'saveTr', FlowEdgeKind.Next],
  ['saveTr', 'translate', FlowEdgeKind.Next],
  ['translate', 'reindex', FlowEdgeKind.Next],
];
const edgeId = (key: string) => (key === 'END' ? END_ID : idOf(key));

const DEFINITION = `id: content-ingest
label: Content ingest
group: Content
entry: [content:VerifyIfVideoExists]
onError: content:SaveErrorState
complete: [content:ReindexSearch]
trace:
  field: _trace
  key: videoId
steps:
  content:VerifyIfVideoExists:
    next:
      - to: content:ExtractVideoInfo
        when: new
      - end: only refreshes stats
        when: already known
  content:ExtractVideoInfo:
    next:
      - to: content:SetupVideoContent
  content:SetupVideoContent:
    next:
      - to: content:IndexComments
      - to: content:IndexVideoSearch
      - to: content:SelectCategory
  content:IndexComments: {}
  content:IndexVideoSearch:
    next:
      - to: content:CleanTempImportItem
  content:CleanTempImportItem: {}
  content:SelectCategory:
    next:
      - to: content:SetupProduct
  content:SetupProduct:
    next:
      - to: content:SetupAuthor
  content:SetupAuthor:
    next:
      - to: content:TranscriptionApi
      - to: content:DownloadVideo
        kind: fallback
        when: fallback
  content:TranscriptionApi:
    next:
      - to: content:TranslateTranscription
  content:DownloadVideo:
    next:
      - to: content:TranscribeAudio
  content:TranscribeAudio:
    next:
      - to: contentSaveTranscription
  contentSaveTranscription:
    next:
      - to: content:TranslateTranscription
  content:TranslateTranscription:
    when: language != target
    next:
      - to: content:ReindexSearch
  content:ReindexSearch: {}
  content:SaveErrorState: {}
`;

export const CONTENT_FLOW: TFlow = {
  id: FLOW_ID,
  label: 'Content ingest',
  group: FLOW_GROUP,
  keyLabel: FLOW_KEY_LABEL,
  entry: [idOf('verify')],
  complete: [END_ID, idOf('reindex')],
  onError: idOf('error'),
  definition: DEFINITION,
  steps: [
    ...STEPS.slice(0, 1),
    // The `end` branch sits right after its source, like the server orders it.
    null,
    ...STEPS.slice(1),
  ].map((spec) =>
    spec
      ? {
          id: spec.queue,
          kind: spec.kind ?? FlowStepKind.Step,
          label: spec.queue,
          description: spec.description,
          when: spec.when ?? null,
          queue: spec.queue,
          queueId: flowQueueId(spec.queue),
          jobs: null,
          sharedQueue: false,
        }
      : {
          id: END_ID,
          kind: FlowStepKind.End,
          label: 'only refreshes stats',
          description: null,
          when: null,
          queue: null,
          queueId: null,
          jobs: null,
          sharedQueue: false,
        }
  ),
  edges: EDGES.map(([from, to, kind, when]) => ({
    from: edgeId(from),
    to: edgeId(to),
    kind,
    when: when ?? null,
    declared: true,
  })),
  checks: [
    {
      level: FlowCheckLevel.Ok,
      code: 'queues-found',
      message: '16 declared queues are registered in the monitor',
    },
    {
      level: FlowCheckLevel.Warn,
      code: 'queue-prefix',
      message:
        'contentSaveTranscription does not use the content: prefix of the Content group',
    },
  ],
};

/** The steps whose queues the demo registers (every non-`end` step). */
export const FLOW_QUEUES = STEPS.map((s) => ({
  queue: s.queue,
  waiting: s.waiting,
  active: s.active,
  failedNow: s.failedNow,
  errors: s.errors ?? [],
}));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const seeded = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

const spark = (spec: TStepSpec, scale: number): number[] => {
  const rnd = seeded(spec.queue.length * 977 + 13);
  const perBucket = (spec.done * scale) / 32;
  return Array.from({ length: 32 }, (_v, i) =>
    Math.round(
      perBucket *
        (0.55 + rnd() * 0.6) *
        // The bottleneck drains slower lately.
        (spec.key === 'transcr' && i > 22 ? 0.6 : 1)
    )
  );
};

export const flowSummaryMock = (since: number | null | undefined): TSummary => {
  const span = Math.max(Date.now() - (since ?? Date.now() - DAY_MS), MINUTE_MS);
  const scale = span / DAY_MS;
  const n = (value: number) => Math.round(value * scale);
  const steps = STEPS.map((spec) => {
    const completed = n(spec.done);
    const failed = n(spec.failed);
    return {
      stepId: spec.queue,
      waiting: spec.waiting,
      active: spec.active,
      delayed: 0,
      failedNow: spec.failedNow,
      completed,
      failed,
      lost: spec.key === 'transcr' ? n(3) : 0,
      untraced: spec.key === 'verify' ? n(240) : 0,
      retried: n(spec.failed / 2),
      throughputPerMin: spec.perMin,
      procP50: spec.p50,
      procP95: spec.p95,
      waitAvg: spec.waitAvg,
      waitP95: spec.waitAvg * 2.4,
      failureRate: completed + failed ? failed / (completed + failed) : 0,
      bottleneck: spec.key === 'transcr',
      spark: spark(spec, scale),
      errors: (spec.errors ?? []).map(([message, count], idx) => ({
        message,
        count: Math.max(1, n(count)),
        lastJobId: `${88100 + idx * 7 + spec.queue.length}`,
      })),
    };
  });
  const entries = n(18426);
  return {
    flowId: FLOW_ID,
    since: Date.now() - span,
    entries,
    done: n(9020),
    errors: n(347),
    failed: n(347),
    e2eAvg: 662_000,
    e2eP50: 540_000,
    e2eP95: 1_458_000,
    bottleneck: idOf('transcr'),
    coverage: 0.987,
    steps,
    edges: CONTENT_FLOW.edges.map((edge) => {
      const target = STEPS.find((s) => s.queue === edge.to);
      return {
        from: edge.from,
        to: edge.to,
        count: target ? n(target.done + target.failed) : n(9400),
        declared: true,
        waitAvg: target ? target.waitAvg : null,
      };
    }),
    checks: [
      {
        level: FlowCheckLevel.Ok,
        code: 'coverage',
        message: 'data._trace present on 98.7% of the flow jobs in the window',
      },
      {
        level: FlowCheckLevel.Warn,
        code: 'lost',
        message: `${n(
          3
        )} jobs of content:TranscriptionApi were removed before the collector read them (lost)`,
      },
    ],
  };
};

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

/** [step key, enqueued at (s from start), wait (s), processing (s), outcome] */
type TOutcome = 'ok' | 'fail' | 'waiting' | 'active';
type TTraceSpec = {
  traceId: string;
  key: string;
  /** Minutes ago the trace started. */
  startedMinAgo: number;
  /** Jobs whose Redis job is gone (retention): only the index entry is left. */
  removed?: string[];
  status: FlowTraceStatus;
  steps: Array<[string, number, number, number, TOutcome, string?]>;
  /** Parent step key per step key when not the previous row. */
  parents: Record<string, string | null>;
};

const PARENTS_DESIGN: Record<string, string | null> = {
  verify: null,
  extract: 'verify',
  setup: 'extract',
  comments: 'setup',
  idxVideo: 'setup',
  clean: 'idxVideo',
  category: 'setup',
  product: 'category',
  author: 'product',
  transcr: 'author',
  error: 'transcr',
  download: 'author',
  speech: 'download',
  saveTr: 'speech',
  translate: 'saveTr',
  reindex: 'translate',
};

const TRACES: TTraceSpec[] = [
  {
    // The design's trace: the transcription fails, the fallback carries it.
    traceId: 'tr_9f2c41e7b0',
    key: '7428801239912',
    startedMinAgo: 24,
    removed: ['verify'],
    status: FlowTraceStatus.CompletedWithFallback,
    parents: PARENTS_DESIGN,
    steps: [
      ['verify', 0, 0.3, 0.08, 'ok'],
      ['extract', 0.4, 1.0, 2.1, 'ok'],
      ['setup', 3.5, 0.3, 0.2, 'ok'],
      ['comments', 4.0, 4.4, 8.2, 'ok'],
      ['idxVideo', 4.0, 0.2, 0.14, 'ok'],
      ['clean', 4.35, 0.2, 0.06, 'ok'],
      ['category', 4.0, 0.5, 2.3, 'ok'],
      ['product', 6.8, 0.4, 0.7, 'ok'],
      ['author', 7.9, 0.3, 0.4, 'ok'],
      ['transcr', 8.6, 540, 31, 'fail', 'Transcription API 429 rate limit'],
      ['error', 579.7, 0.1, 0.05, 'ok'],
      ['download', 579.8, 2, 11, 'ok'],
      ['speech', 592.8, 3, 49, 'ok'],
      ['saveTr', 644.8, 0.2, 0.09, 'ok'],
      ['translate', 645.1, 0.7, 3.4, 'ok'],
      ['reindex', 649.2, 0.3, 0.2, 'ok'],
    ],
  },
  {
    // Same video two days earlier: its jobs are long gone from Redis.
    traceId: 'tr_51d0a8c3e2',
    key: '7428801239912',
    startedMinAgo: 2 * 24 * 60 + 37,
    removed: [
      'verify',
      'extract',
      'setup',
      'comments',
      'idxVideo',
      'clean',
      'category',
      'product',
      'author',
      'transcr',
      'translate',
      'reindex',
    ],
    status: FlowTraceStatus.Completed,
    parents: { ...PARENTS_DESIGN, translate: 'transcr' },
    steps: [
      ['verify', 0, 0.2, 0.07, 'ok'],
      ['extract', 0.3, 0.8, 1.7, 'ok'],
      ['setup', 2.9, 0.3, 0.2, 'ok'],
      ['comments', 3.4, 3.1, 6.9, 'ok'],
      ['idxVideo', 3.4, 0.2, 0.1, 'ok'],
      ['clean', 3.7, 0.2, 0.05, 'ok'],
      ['category', 3.4, 0.4, 2.0, 'ok'],
      ['product', 5.9, 0.3, 0.6, 'ok'],
      ['author', 6.8, 0.3, 0.4, 'ok'],
      ['transcr', 7.5, 61, 35, 'ok'],
      ['translate', 103.6, 0.6, 3.1, 'ok'],
      ['reindex', 107.4, 0.3, 0.2, 'ok'],
    ],
  },
  {
    // Still running: stuck behind the transcription backlog.
    traceId: 'tr_c07e5a9134',
    key: '7430019284411',
    startedMinAgo: 6,
    status: FlowTraceStatus.Running,
    parents: PARENTS_DESIGN,
    steps: [
      ['verify', 0, 0.4, 0.09, 'ok'],
      ['extract', 0.5, 1.2, 2.4, 'ok'],
      ['setup', 4.2, 0.3, 0.2, 'ok'],
      ['comments', 4.7, 5.1, 0, 'active'],
      ['idxVideo', 4.7, 0.2, 0.13, 'ok'],
      ['clean', 5.1, 0.2, 0.05, 'ok'],
      ['category', 4.7, 0.6, 2.2, 'ok'],
      ['product', 7.6, 0.4, 0.8, 'ok'],
      ['author', 8.9, 0.3, 0.4, 'ok'],
      ['transcr', 9.7, 0, 0, 'waiting'],
    ],
  },
  {
    // Fails for good at the second step and goes to the error step.
    traceId: 'tr_e3b6f2d0a8',
    key: '7429550012873',
    startedMinAgo: 14,
    status: FlowTraceStatus.Failed,
    parents: { ...PARENTS_DESIGN, error: 'extract' },
    steps: [
      ['verify', 0, 0.3, 0.08, 'ok'],
      ['extract', 0.4, 0.9, 3.1, 'fail', 'Video unavailable (410)'],
      ['error', 4.5, 0.1, 0.04, 'ok'],
    ],
  },
];

export type TDemoTraceJob = TTraceJob & {
  queue: string;
  traceId: string;
  key: string;
  traceStartedAt: number;
  hop: number;
  removed: boolean;
  returnValue: string | null;
};

type TDemoTrace = {
  traceId: string;
  key: string;
  startedAt: number;
  finishedAt: number | null;
  status: FlowTraceStatus;
  jobs: TDemoTraceJob[];
};

let cache: TDemoTrace[] | null = null;

const RETURN_VALUES: Record<string, unknown> = {
  verify: { exists: false },
  translate: { from: 'en', to: 'target', chars: 1840 },
  error: { step: 'content:TranscriptionApi', reason: '429', recovered: true },
};

/** Every demo trace, with job ids and absolute times, built once. */
export const flowTracesMock = (): TDemoTrace[] => {
  if (cache) return cache;
  const now = Date.now();
  let nextJobId = 88200;
  cache = TRACES.map((spec) => {
    const start = now - spec.startedMinAgo * MINUTE_MS;
    const at = (s: number) => Math.round(start + s * 1000);
    const byKey = new Map<string, TDemoTraceJob>();
    const hops = new Map<string, number>();
    const jobs = spec.steps.map(([key, enq, wait, proc, outcome, reason]) => {
      const step = stepByKey.get(key) as TStepSpec;
      const parentKey = spec.parents[key] ?? null;
      const parent = parentKey ? byKey.get(parentKey) ?? null : null;
      const hop = parent ? (hops.get(parentKey as string) ?? 0) + 1 : 0;
      hops.set(key, hop);
      const pending = outcome === 'waiting' || outcome === 'active';
      const startedAt = outcome === 'waiting' ? null : at(enq + wait);
      const finishedAt = pending ? null : at(enq + wait + proc);
      const job: TDemoTraceJob = {
        stepId: step.queue,
        queueId: flowQueueId(step.queue),
        queue: step.queue,
        jobId: String((nextJobId += 1)),
        attempt: outcome === 'fail' ? 2 : 1,
        status:
          outcome === 'fail'
            ? JobStatus.Failed
            : outcome === 'waiting'
            ? JobStatus.Waiting
            : outcome === 'active'
            ? JobStatus.Active
            : JobStatus.Completed,
        parentQueueId: parent?.queueId ?? null,
        parentJobId: parent?.jobId ?? null,
        parentStepId: parent?.stepId ?? null,
        enqueuedAt: at(enq),
        startedAt,
        finishedAt,
        waitMs: outcome === 'waiting' ? null : Math.round(wait * 1000),
        processMs: pending ? null : Math.round(proc * 1000),
        failedReason: reason ?? null,
        fallback: key === 'download',
        pending,
        traceId: spec.traceId,
        key: spec.key,
        traceStartedAt: start,
        hop,
        removed: !!spec.removed?.includes(key),
        returnValue:
          outcome === 'ok'
            ? JSON.stringify(RETURN_VALUES[key] ?? { ok: true }, null, 2)
            : null,
      };
      byKey.set(key, job);
      return job;
    });
    const ends = jobs
      .map((j) => j.finishedAt)
      .filter((v): v is number => v !== null);
    const running = spec.status === FlowTraceStatus.Running;
    return {
      traceId: spec.traceId,
      key: spec.key,
      startedAt: start,
      finishedAt: running ? null : Math.max(...ends),
      status: spec.status,
      jobs,
    };
  });
  return cache;
};

/** The payload a traced job carries: its own data plus `_trace` (v1). */
export const traceJobData = (job: TDemoTraceJob): string =>
  JSON.stringify(
    {
      videoId: job.key,
      _trace: {
        v: 1,
        traceId: job.traceId,
        flow: FLOW_ID,
        key: job.key,
        startedAt: job.traceStartedAt,
        ...(job.parentJobId
          ? {
              parent: {
                queue: (job.parentQueueId ?? '').replace(/^bull:/, ''),
                jobId: job.parentJobId,
              },
            }
          : {}),
        hop: job.hop,
      },
    },
    null,
    2
  );
