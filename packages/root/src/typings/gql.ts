export type Maybe<T> = T | null;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  JSON: any;
};

export type AgentConversation = {
  queue: Scalars['ID'];
  conversationId: Scalars['ID'];
  /**
   * One per job (its highest attempt), oldest first, at most the 100 most
   * recent.
   */
  messages: Array<AgentConversationMessage>;
  /**
   * Heuristic. True when the conversation has more than 100 messages (only the
   * newest are listed), or when the queue's recent runs index is at its cap
   * (recentRuns, so its oldest runs were evicted) and it reaches back from the
   * first message no further than the conversation's largest pause between
   * two messages (at least 30 minutes): an older message may have been
   * evicted. When the index reaches further back, an older message would most
   * likely still be in it, so false.
   */
  maybeIncomplete: Scalars['Boolean'];
  totals: AgentConversationTotals;
  /** Calls per tool over the listed messages, most used first. */
  tools: Array<AgentToolCount>;
};

export type AgentConversationMessage = {
  jobId: Scalars['ID'];
  attempt: Scalars['Int'];
  /** Epoch ms. finishedAt - durationMs; null when the run has no duration. */
  startedAt?: Maybe<Scalars['Float']>;
  /** Epoch ms. */
  finishedAt: Scalars['Float'];
  durationMs?: Maybe<Scalars['Float']>;
  model: Scalars['String'];
  inputTokens: Scalars['Int'];
  outputTokens: Scalars['Int'];
  /** Null = the model has no price in the setup. */
  cost?: Maybe<Scalars['Float']>;
  outcome: Scalars['String'];
  steps: Scalars['Int'];
  /**
   * The message's run, read from the job log and cut to the queue's detail
   * (user text and final answer only at full). Null when the job is gone or
   * its log no longer holds this attempt.
   */
  run?: Maybe<AgentRun>;
  /** True when the job was removed and only the index entry is left. */
  jobRemoved: Scalars['Boolean'];
};

export type AgentConversationTotals = {
  messages: Scalars['Int'];
  /**
   * First message's start to the last message's finish. Null when the first
   * start is unknown.
   */
  durationMs?: Maybe<Scalars['Float']>;
  /** Sum of the runs' durations. */
  aiMs: Scalars['Float'];
  inputTokens: Scalars['Float'];
  outputTokens: Scalars['Float'];
  /** Sum over the messages whose model has a price. Null if none has. */
  cost?: Maybe<Scalars['Float']>;
  /** Some message's model has no price. */
  hasUnpricedMessages: Scalars['Boolean'];
  steps: Scalars['Int'];
  toolCalls: Scalars['Int'];
};

export type AgentLatencyPoint = {
  timestamp: Scalars['Float'];
  windowMs: Scalars['Float'];
  runs: Scalars['Int'];
  failed: Scalars['Int'];
  /** Estimated from a fixed-band histogram (approximate). */
  p50?: Maybe<Scalars['Float']>;
  p95?: Maybe<Scalars['Float']>;
};

export type AgentModelStats = {
  model: Scalars['String'];
  runs: Scalars['Int'];
  inputTokens: Scalars['Float'];
  outputTokens: Scalars['Float'];
  /** Null = model without a price in the setup. */
  cost?: Maybe<Scalars['Float']>;
};

export type AgentOutcomeCount = {
  outcome: Scalars['String'];
  count: Scalars['Int'];
};

export type AgentQueueConfig = {
  /** Job names treated as agent runs. Null = every job of the queue. */
  jobs?: Maybe<Array<Scalars['String']>>;
  detail: AgentRunDetail;
  label: Scalars['String'];
};

export type AgentRun = {
  v: Scalars['Int'];
  detail: AgentRunDetail;
  /**
   * The recorded run carried more detail than the queue declares; the server
   * cut it before serving.
   */
  detailMismatch: Scalars['Boolean'];
  model: Scalars['String'];
  attempt: Scalars['Int'];
  startedAt: Scalars['String'];
  finishedAt?: Maybe<Scalars['String']>;
  durationMs?: Maybe<Scalars['Float']>;
  inputTokens: Scalars['Int'];
  outputTokens: Scalars['Int'];
  finishReason?: Maybe<Scalars['String']>;
  outcome: Scalars['String'];
  cost?: Maybe<Scalars['Float']>;
  /**
   * Time between the job starting and the run starting. Only when this run is
   * the job's current attempt (processedOn is overwritten on every attempt);
   * null for earlier attempts, while a newer attempt has no line yet, or when
   * the gap would be negative. Never negative.
   */
  overheadStartMs?: Maybe<Scalars['Float']>;
  /**
   * Time between the run finishing and the job finishing. Same rule as
   * overheadStartMs, and null while the job has not finished.
   */
  overheadEndMs?: Maybe<Scalars['Float']>;
  steps: Array<AgentRunStep>;
  final?: Maybe<AgentRunFinal>;
  error?: Maybe<Scalars['String']>;
  input?: Maybe<AgentRunInput>;
  truncated: Scalars['Boolean'];
};

export type AgentRunCard = {
  type: Scalars['String'];
  title: Scalars['String'];
};

export enum AgentRunDetail {
  Full = 'full',
  Basic = 'basic',
}

export type AgentRunFinal = {
  text?: Maybe<Scalars['String']>;
  cards: Array<AgentRunCard>;
};

export type AgentRunInput = {
  conversationId?: Maybe<Scalars['String']>;
  text?: Maybe<Scalars['String']>;
};

export type AgentRunListItem = {
  queue: Scalars['ID'];
  jobId: Scalars['ID'];
  jobName: Scalars['String'];
  attempt: Scalars['Int'];
  finishedAt: Scalars['Float'];
  durationMs?: Maybe<Scalars['Float']>;
  model: Scalars['String'];
  steps: Scalars['Int'];
  inputTokens: Scalars['Int'];
  outputTokens: Scalars['Int'];
  cost?: Maybe<Scalars['Float']>;
  outcome: Scalars['String'];
  tools: Array<AgentRunToolLink>;
  error?: Maybe<Scalars['String']>;
};

export type AgentRunStep = {
  step: Scalars['Int'];
  startedAt: Scalars['String'];
  durationMs?: Maybe<Scalars['Float']>;
  finishReason?: Maybe<Scalars['String']>;
  inputTokens?: Maybe<Scalars['Int']>;
  outputTokens?: Maybe<Scalars['Int']>;
  /** Null = the model has no price in the setup. */
  cost?: Maybe<Scalars['Float']>;
  /** Only at full detail. */
  text?: Maybe<Scalars['String']>;
  tools: Array<AgentRunTool>;
};

export type AgentRunTool = {
  name: Scalars['String'];
  ok: Scalars['Boolean'];
  durationMs: Scalars['Float'];
  /**
   * Short, content-free summary of the output. A failed tool gets
   * "failed: <ErrorClassName>" (class name only, never the message).
   */
  summary: Scalars['String'];
  empty?: Maybe<Scalars['Boolean']>;
  startedAt?: Maybe<Scalars['String']>;
  outputChars?: Maybe<Scalars['Int']>;
  /** JSON. Only at full detail. */
  input?: Maybe<Scalars['String']>;
  /** JSON. Only at full detail. */
  output?: Maybe<Scalars['String']>;
  /** Only at full detail. */
  error?: Maybe<Scalars['String']>;
};

export type AgentRunToolLink = {
  name: Scalars['String'];
  ok: Scalars['Boolean'];
  empty: Scalars['Boolean'];
};

export type AgentRunsCounts = {
  all: Scalars['Int'];
  failed: Scalars['Int'];
  emptyTool: Scalars['Int'];
  slow: Scalars['Int'];
};

export enum AgentRunsFilter {
  All = 'all',
  Failed = 'failed',
  EmptyTool = 'emptyTool',
  Slow = 'slow',
}

export type AgentRunsPage = {
  total: Scalars['Int'];
  /** Count per filter over the same window, for the chips. */
  counts: AgentRunsCounts;
  items: Array<AgentRunListItem>;
};

export enum AgentRunsSort {
  Recent = 'recent',
  Slowest = 'slowest',
  Costliest = 'costliest',
}

export type AgentStepsBucket = {
  label: Scalars['String'];
  count: Scalars['Int'];
};

export type AgentToolCount = {
  name: Scalars['String'];
  count: Scalars['Int'];
};

export type AgentToolStats = {
  name: Scalars['String'];
  calls: Scalars['Int'];
  avgDurationMs: Scalars['Float'];
  errorRate: Scalars['Float'];
  emptyRate: Scalars['Float'];
};

export type AgentsSummary = {
  runs: Scalars['Int'];
  failed: Scalars['Int'];
  /**
   * Terminal events whose job was already removed when read (e.g.
   * removeOnComplete: true), so its runs could not be counted. The job name
   * is gone too: in a queue that mixes agent and non-agent jobs (ai.jobs),
   * removed non-agent jobs are counted as well.
   */
  lost: Scalars['Int'];
  p50?: Maybe<Scalars['Float']>;
  p95?: Maybe<Scalars['Float']>;
  avgDurationMs?: Maybe<Scalars['Float']>;
  /** Share of the time spent in LLM steps (llmMs / (llmMs + toolMs)). */
  llmShare?: Maybe<Scalars['Float']>;
  inputTokens: Scalars['Float'];
  outputTokens: Scalars['Float'];
  /** Sum over the models that have a price. Null if none has. */
  cost?: Maybe<Scalars['Float']>;
  /** Some model in the window has no price. */
  hasUnpricedModels: Scalars['Boolean'];
  avgSteps?: Maybe<Scalars['Float']>;
  runsWithEmptyTool: Scalars['Int'];
  latency: Array<AgentLatencyPoint>;
  steps: Array<AgentStepsBucket>;
  tools: Array<AgentToolStats>;
  models: Array<AgentModelStats>;
  outcomes: Array<AgentOutcomeCount>;
};

export type CreateJobInput = {
  queue: Scalars['String'];
  name?: Maybe<Scalars['String']>;
  data?: Maybe<Scalars['JSON']>;
  options?: Maybe<Scalars['JSON']>;
};

export type Job = {
  /**
   * One per attempt, in order. Empty outside agent queues/jobs. Resolved on
   * demand from the job logs.
   */
  agentRuns: Array<AgentRun>;
  attemptsMade: Scalars['Int'];
  data?: Maybe<Scalars['String']>;
  delay?: Maybe<Scalars['Float']>;
  failedReason?: Maybe<Scalars['String']>;
  finishedOn?: Maybe<Scalars['Float']>;
  id: Scalars['ID'];
  logs?: Maybe<JobLogs>;
  name: Scalars['String'];
  opts: Scalars['String'];
  processedOn?: Maybe<Scalars['Float']>;
  processingTime?: Maybe<Scalars['Float']>;
  progress: Scalars['String'];
  returnValue?: Maybe<Scalars['String']>;
  stacktrace: Array<Maybe<Scalars['String']>>;
  status: JobStatus;
  timestamp?: Maybe<Scalars['Float']>;
};

export type JobLogs = {
  count: Scalars['Int'];
  logs: Array<Maybe<Scalars['String']>>;
};

export enum JobStatus {
  Completed = 'completed',
  Waiting = 'waiting',
  Active = 'active',
  Delayed = 'delayed',
  Failed = 'failed',
  Paused = 'paused',
  Stuck = 'stuck',
  Unknown = 'unknown',
  Prioritized = 'prioritized',
}

export enum JobStatusClean {
  Completed = 'completed',
  Wait = 'wait',
  Active = 'active',
  Delayed = 'delayed',
  Failed = 'failed',
  Paused = 'paused',
}

export type MetricsInfo = {
  /** Resolution of the freshest tier, in milliseconds. */
  collectIntervalMs: Scalars['Float'];
  /**
   * Widest window that has data, across every retention tier. Older points are
   * rolled up into coarser buckets rather than dropped, so this is much larger
   * than the raw tier alone.
   */
  retentionMs: Scalars['Float'];
};

export type MetricsSummary = {
  /** Throughput of every monitored queue, summed per collection window. */
  points: Array<ThroughputPoint>;
  totalCompleted: Scalars['Int'];
  totalFailed: Scalars['Int'];
  /** Per-queue totals over the same window, ordered by total runs descending. */
  queues: Array<QueueThroughputSummary>;
};

export type Mutation = {
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queuepause */
  pauseQueue?: Maybe<Queue>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueresume */
  resumeQueue?: Maybe<Queue>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueclose */
  closeQueue?: Maybe<Queue>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueclean */
  cleanQueue: Array<Maybe<Scalars['ID']>>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueempty */
  emptyQueue?: Maybe<Queue>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#jobremove */
  removeJob?: Maybe<Job>;
  /** calls https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#jobremove on every passed job */
  removeJobs: Array<Maybe<Job>>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#jobmovetocompleted */
  moveJobToCompleted?: Maybe<Job>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#jobmovetofailed */
  moveJobToFailed?: Maybe<Job>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#jobdiscard */
  discardJob?: Maybe<Job>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#jobpromote */
  promoteJob?: Maybe<Job>;
  /** calls https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#jobpromote on every passed job */
  promoteJobs: Array<Maybe<Job>>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#jobupdate */
  updateJobData?: Maybe<Job>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#jobretry */
  retryJob?: Maybe<Job>;
  /** calls https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#jobretry on every passed job */
  retryJobs: Array<Maybe<Job>>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#joblog */
  log?: Maybe<Job>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueadd */
  createJob?: Maybe<Job>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueremovejobs */
  removeJobsByPattern?: Maybe<Scalars['Boolean']>;
  clearMetrics?: Maybe<Scalars['Boolean']>;
  clearAllMetrics?: Maybe<Scalars['Boolean']>;
};

export type MutationPauseQueueArgs = {
  queue: Scalars['ID'];
};

export type MutationResumeQueueArgs = {
  queue: Scalars['ID'];
};

export type MutationCloseQueueArgs = {
  queue: Scalars['ID'];
};

export type MutationCleanQueueArgs = {
  queue: Scalars['ID'];
  grace?: Maybe<Scalars['Int']>;
  status: JobStatusClean;
  limit?: Maybe<Scalars['Int']>;
};

export type MutationEmptyQueueArgs = {
  queue: Scalars['ID'];
};

export type MutationRemoveJobArgs = {
  queue: Scalars['ID'];
  id: Scalars['ID'];
};

export type MutationRemoveJobsArgs = {
  queue: Scalars['ID'];
  jobs: Array<Scalars['ID']>;
};

export type MutationMoveJobToCompletedArgs = {
  queue: Scalars['ID'];
  id: Scalars['ID'];
};

export type MutationMoveJobToFailedArgs = {
  queue: Scalars['ID'];
  id: Scalars['ID'];
};

export type MutationDiscardJobArgs = {
  queue: Scalars['ID'];
  id: Scalars['ID'];
};

export type MutationPromoteJobArgs = {
  queue: Scalars['ID'];
  id: Scalars['ID'];
};

export type MutationPromoteJobsArgs = {
  queue: Scalars['ID'];
  jobs: Array<Scalars['ID']>;
};

export type MutationUpdateJobDataArgs = {
  queue: Scalars['ID'];
  id: Scalars['ID'];
  data?: Maybe<Scalars['JSON']>;
};

export type MutationRetryJobArgs = {
  queue: Scalars['ID'];
  id: Scalars['ID'];
};

export type MutationRetryJobsArgs = {
  queue: Scalars['ID'];
  jobs: Array<Scalars['ID']>;
};

export type MutationLogArgs = {
  queue: Scalars['ID'];
  id: Scalars['ID'];
  row: Scalars['String'];
};

export type MutationCreateJobArgs = {
  input: CreateJobInput;
};

export type MutationRemoveJobsByPatternArgs = {
  queue: Scalars['ID'];
  pattern: Scalars['String'];
};

export type MutationClearMetricsArgs = {
  queue: Scalars['ID'];
};

export enum OrderEnum {
  Asc = 'ASC',
  Desc = 'DESC',
}

export type Query = {
  /**
   * Every run of the queue's recent runs index sharing input.conversationId.
   * Needs the metrics collector. Null outside agent queues.
   */
  agentConversation?: Maybe<AgentConversation>;
  /** Run of one attempt. Without attempt = the last one. */
  agentRun?: Maybe<AgentRun>;
  agentRuns?: Maybe<AgentRunsPage>;
  /**
   * Empty/omitted queues = every agent queue. `until` allows the previous
   * window (comparison).
   */
  agentsSummary?: Maybe<AgentsSummary>;
  job?: Maybe<Job>;
  jobs: Array<Job>;
  /**
   * `since` (unix ms) selects a time window and takes precedence over the
   * index-based `start`/`end`. `maxPoints` downsamples server-side.
   */
  metrics?: Maybe<Array<QueueMetrics>>;
  metricsEnabled: Scalars['Boolean'];
  metricsInfo?: Maybe<MetricsInfo>;
  /**
   * Cross-queue throughput aggregate, computed on the server so the dashboard
   * does not have to pull one full series per queue on every poll.
   */
  metricsSummary: MetricsSummary;
  queue?: Maybe<Queue>;
  queues?: Maybe<Array<Queue>>;
  redisInfo?: Maybe<RedisInfo>;
};

export type QueryAgentConversationArgs = {
  queue: Scalars['ID'];
  conversationId: Scalars['ID'];
};

export type QueryAgentRunArgs = {
  queue: Scalars['ID'];
  jobId: Scalars['ID'];
  attempt?: Maybe<Scalars['Int']>;
};

export type QueryAgentRunsArgs = {
  queues?: Maybe<Array<Scalars['ID']>>;
  since: Scalars['Float'];
  filter?: Maybe<AgentRunsFilter>;
  slowMs?: Maybe<Scalars['Float']>;
  sort?: Maybe<AgentRunsSort>;
  offset?: Maybe<Scalars['Int']>;
  limit?: Maybe<Scalars['Int']>;
};

export type QueryAgentsSummaryArgs = {
  queues?: Maybe<Array<Scalars['ID']>>;
  since: Scalars['Float'];
  until?: Maybe<Scalars['Float']>;
  maxPoints?: Maybe<Scalars['Int']>;
};

export type QueryJobArgs = {
  queue: Scalars['ID'];
  id: Scalars['ID'];
};

export type QueryJobsArgs = {
  queue: Scalars['ID'];
  offset?: Maybe<Scalars['Int']>;
  limit?: Maybe<Scalars['Int']>;
  status?: Maybe<JobStatus>;
  order?: Maybe<OrderEnum>;
  id?: Maybe<Scalars['ID']>;
  ids?: Maybe<Array<Maybe<Scalars['ID']>>>;
  dataSearch?: Maybe<Scalars['String']>;
};

export type QueryMetricsArgs = {
  queue: Scalars['ID'];
  start?: Maybe<Scalars['Int']>;
  end?: Maybe<Scalars['Int']>;
  since?: Maybe<Scalars['Float']>;
  maxPoints?: Maybe<Scalars['Int']>;
};

export type QueryMetricsSummaryArgs = {
  since?: Maybe<Scalars['Float']>;
  maxPoints?: Maybe<Scalars['Int']>;
};

export type QueryQueueArgs = {
  id: Scalars['ID'];
};

export type Queue = {
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queuegetactivecount */
  activeCount: Scalars['Int'];
  /** Null when the queue is not an AI agent queue. */
  agent?: Maybe<AgentQueueConfig>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queuegetcompletedcount */
  completedCount: Scalars['Int'];
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queuecount */
  count: Scalars['Int'];
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queuegetdelayedcount */
  delayedCount: Scalars['Int'];
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queuegetfailedcount */
  failedCount: Scalars['Int'];
  /**
   * Cosmetic label used by the dashboard to group related queues under a
   * single collapsible entry in the sidebar. Set via QueueConfig.group when
   * wrapping the queue in a BullAdapter/BullMQAdapter.
   */
  group?: Maybe<Scalars['String']>;
  id: Scalars['String'];
  isPaused: Scalars['Boolean'];
  jobs: Array<Maybe<Job>>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queuegetjobcounts */
  jobsCounts: QueueJobsCounts;
  keyPrefix?: Maybe<Scalars['String']>;
  metrics?: Maybe<Array<QueueMetrics>>;
  name: Scalars['String'];
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queuegetpausedcount */
  pausedCount: Scalars['Int'];
  provider: QueueProvider;
  readonly?: Maybe<Scalars['Boolean']>;
  /** https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queuegetwaitingcount */
  waitingCount: Scalars['Int'];
};

export type QueueJobsCounts = {
  waiting: Scalars['Int'];
  active: Scalars['Int'];
  completed: Scalars['Int'];
  failed: Scalars['Int'];
  delayed: Scalars['Int'];
  paused: Scalars['Int'];
  prioritized?: Maybe<Scalars['Int']>;
};

export type QueueMetrics = {
  timestamp: Scalars['Float'];
  counts: QueueJobsCounts;
  processingTime?: Maybe<Scalars['Float']>;
  processingTimeMin?: Maybe<Scalars['Float']>;
  processingTimeMax?: Maybe<Scalars['Float']>;
  /**
   * Jobs that finished during the window ending at `timestamp`. These are
   * event counters, unlike `counts.completed` — which is the size of the
   * `completed` set in redis and therefore shrinks with `removeOnComplete`.
   * Null on points collected before this field existed.
   */
  completed?: Maybe<Scalars['Int']>;
  failed?: Maybe<Scalars['Int']>;
  /**
   * Length of the window the counters above cover, in milliseconds. Needed to
   * derive a per-minute rate: the first window after a restart is shorter than
   * the configured collect interval, and downsampled points merge windows.
   */
  windowMs?: Maybe<Scalars['Float']>;
};

export enum QueueProvider {
  Bull = 'bull',
  Bullmq = 'bullmq',
}

export type QueueThroughputSummary = {
  queue: Scalars['ID'];
  name: Scalars['String'];
  completed: Scalars['Int'];
  failed: Scalars['Int'];
};

export type RedisInfo = {
  redis_version?: Maybe<Scalars['String']>;
  used_memory?: Maybe<Scalars['String']>;
  used_memory_human?: Maybe<Scalars['String']>;
  used_memory_peak?: Maybe<Scalars['String']>;
  used_memory_peak_human?: Maybe<Scalars['String']>;
  used_memory_peak_perc?: Maybe<Scalars['String']>;
  used_memory_overhead?: Maybe<Scalars['String']>;
  used_memory_startup?: Maybe<Scalars['String']>;
  total_system_memory?: Maybe<Scalars['String']>;
  total_system_memory_human?: Maybe<Scalars['String']>;
  maxmemory?: Maybe<Scalars['String']>;
  maxmemory_human?: Maybe<Scalars['String']>;
  mem_fragmentation_ratio?: Maybe<Scalars['String']>;
  mem_fragmentation_bytes?: Maybe<Scalars['String']>;
  connected_clients?: Maybe<Scalars['String']>;
  blocked_clients?: Maybe<Scalars['String']>;
  redis_mode?: Maybe<Scalars['String']>;
  os?: Maybe<Scalars['String']>;
  arch_bits?: Maybe<Scalars['String']>;
  uptime_in_seconds?: Maybe<Scalars['String']>;
  uptime_in_days?: Maybe<Scalars['String']>;
  used_cpu_sys?: Maybe<Scalars['String']>;
  tcp_port?: Maybe<Scalars['String']>;
};

export type ThroughputPoint = {
  timestamp: Scalars['Float'];
  completed: Scalars['Int'];
  failed: Scalars['Int'];
  /**
   * Width of the bucket the counters cover. Older points come from coarser
   * retention tiers, so consumers must divide by this to compare them.
   */
  windowMs: Scalars['Float'];
};
