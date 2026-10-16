import gql from 'graphql-tag';

export const flowsTypeDef = gql`
  enum FlowEdgeKind {
    NEXT
    CONDITIONAL
    FALLBACK
    SIDECAR
    END
  }
  enum FlowStepKind {
    STEP
    END
    ERROR
  }
  enum FlowCheckLevel {
    OK
    WARN
    ERROR
  }
  enum FlowTraceMatch {
    TRACE_ID
    JOB_ID
    KEY
    NONE
  }
  enum FlowTraceStatus {
    RUNNING
    COMPLETED
    COMPLETED_WITH_FALLBACK
    FAILED
    UNKNOWN
  }
  type FlowStep {
    id: ID!
    kind: FlowStepKind!
    label: String!
    description: String
    """
    Execution condition of the step (display only).
    """
    when: String
    """
    Null on END nodes.
    """
    queue: String
    """
    Null on END nodes and when the queue is not registered in the monitor.
    """
    queueId: ID
    """
    Job names of the step. Null = every job of the queue.
    """
    jobs: [String!]
    """
    The queue holds more than one step: live counts are the queue's.
    """
    sharedQueue: Boolean!
  }
  type FlowEdge {
    from: ID!
    to: ID!
    kind: FlowEdgeKind!
    when: String
    declared: Boolean!
  }
  type FlowCheck {
    level: FlowCheckLevel!
    code: String!
    message: String!
  }
  type Flow {
    id: ID!
    label: String!
    group: String
    keyLabel: String
    entry: [ID!]!
    complete: [ID!]!
    onError: ID
    steps: [FlowStep!]!
    edges: [FlowEdge!]!
    """
    The accepted definition rendered as YAML (read only).
    """
    definition: String!
    """
    Static checks from the boot validation.
    """
    checks: [FlowCheck!]!
  }
  type FlowStepError {
    """
    First line of the failure reason, 120 chars.
    """
    message: String!
    count: Int!
    lastJobId: ID
  }
  type FlowStepStats {
    stepId: ID!
    """
    Live counts of the step's queue (getJobCounts).
    """
    waiting: Int!
    active: Int!
    delayed: Int!
    failedNow: Int!
    """
    Terminal events in the window.
    """
    completed: Int!
    failed: Int!
    lost: Int!
    untraced: Int!
    retried: Int!
    throughputPerMin: Float!
    procP50: Float
    procP95: Float
    waitAvg: Float
    waitP95: Float
    failureRate: Float!
    bottleneck: Boolean!
    """
    32 buckets of completed jobs across the window.
    """
    spark: [Int!]!
    """
    Top 5, read from the failed set (up to 200 jobs) within the window.
    """
    errors: [FlowStepError!]!
  }
  type FlowEdgeStats {
    from: ID!
    to: ID!
    count: Int!
    declared: Boolean!
    """
    Average queue wait of the target step.
    """
    waitAvg: Float
  }
  type FlowSummary {
    flowId: ID!
    since: Float!
    entries: Int!
    done: Int!
    errors: Int!
    failed: Int!
    e2eAvg: Float
    e2eP50: Float
    e2eP95: Float
    bottleneck: ID
    """
    1 - untraced / total; null without events.
    """
    coverage: Float
    steps: [FlowStepStats!]!
    """
    Declared edges plus observed edges that are not declared.
    """
    edges: [FlowEdgeStats!]!
    """
    Dynamic checks: coverage, lost jobs, undeclared and never seen edges.
    """
    checks: [FlowCheck!]!
  }
  type FlowTraceJob {
    stepId: ID!
    queueId: ID!
    jobId: ID!
    attempt: Int!
    status: JobStatus!
    parentQueueId: ID
    parentJobId: ID
    parentStepId: ID
    enqueuedAt: Float!
    startedAt: Float
    finishedAt: Float
    waitMs: Float
    processMs: Float
    failedReason: String
    """
    Entered through a FALLBACK edge.
    """
    fallback: Boolean!
    """
    Found by the pending-step scan (not finished yet).
    """
    pending: Boolean!
  }
  type FlowTrace {
    traceId: ID!
    key: String
    startedAt: Float!
    finishedAt: Float
    durationMs: Float
    status: FlowTraceStatus!
    jobs: [FlowTraceJob!]!
    longestWait: FlowTraceJob
    """
    Hit jobsPerTrace: later jobs were not indexed.
    """
    truncated: Boolean!
    """
    The pending-step scan hit pendingScanLimit without covering the queue.
    """
    partial: Boolean!
  }
  type FlowTraceCandidate {
    traceId: ID!
    startedAt: Float!
    status: FlowTraceStatus!
  }
  type FlowTraceResult {
    matchedBy: FlowTraceMatch!
    trace: FlowTrace
    """
    Key search with more than one execution, newest first, up to 20.
    """
    candidates: [FlowTraceCandidate!]!
    """
    The index is at its cap: older traces may have been evicted.
    """
    indexFull: Boolean!
  }
  extend type Query {
    flows: [Flow!]!
    """
    Null without the metrics collector or for an unknown flow. \`since\`
    (unix ms) defaults to the last 24 hours.
    """
    flowSummary(flow: ID!, since: Float): FlowSummary
    """
    Exact search by trace id, job id or business key value (1 to 256 chars).
    \`traceId\` picks one of the candidates. Null without the metrics
    collector or for an unknown flow.
    """
    flowTrace(flow: ID!, query: String!, traceId: ID): FlowTraceResult
  }
`;
