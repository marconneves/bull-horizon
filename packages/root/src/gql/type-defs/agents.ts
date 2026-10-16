import gql from 'graphql-tag';

export const agentsTypeDef = gql`
  enum AgentRunDetail {
    full
    basic
  }
  type AgentQueueConfig {
    """
    Job names treated as agent runs. Null = every job of the queue.
    """
    jobs: [String!]
    detail: AgentRunDetail!
    label: String!
  }
  extend type Queue {
    """
    Null when the queue is not an AI agent queue.
    """
    agent: AgentQueueConfig
  }
  type AgentRunTool {
    name: String!
    ok: Boolean!
    durationMs: Float!
    """
    Short, content-free summary of the output. A failed tool gets
    "failed: <ErrorClassName>" (class name only, never the message).
    """
    summary: String!
    empty: Boolean
    startedAt: String
    outputChars: Int
    """
    JSON. Only at full detail.
    """
    input: String
    """
    JSON. Only at full detail.
    """
    output: String
    """
    Only at full detail.
    """
    error: String
  }
  type AgentRunStep {
    step: Int!
    startedAt: String!
    durationMs: Float
    finishReason: String
    inputTokens: Int
    outputTokens: Int
    """
    Null = the model has no price in the setup.
    """
    cost: Float
    """
    Only at full detail.
    """
    text: String
    tools: [AgentRunTool!]!
  }
  type AgentRunCard {
    type: String!
    title: String!
  }
  type AgentRunFinal {
    text: String
    cards: [AgentRunCard!]!
  }
  type AgentRunInput {
    conversationId: String
    text: String
  }
  """
  Where the monitor found the run. Server-side only, not part of the written
  contract.
  """
  enum AgentRunSource {
    """
    A bull-horizon:agent-run line in the job log (createAgentRun).
    """
    log
    """
    Compatibility path: the job's returnvalue carried the run (a worker
    without createAgentRun). Only the completed attempt; failed attempts are
    missing.
    """
    returnvalue
  }
  type AgentRun {
    v: Int!
    source: AgentRunSource!
    detail: AgentRunDetail!
    """
    The recorded run carried more detail than the queue declares; the server
    cut it before serving.
    """
    detailMismatch: Boolean!
    model: String!
    attempt: Int!
    startedAt: String!
    finishedAt: String
    durationMs: Float
    inputTokens: Int!
    outputTokens: Int!
    finishReason: String
    outcome: String!
    cost: Float
    """
    Time between the job starting and the run starting. Only when this run is
    the job's current attempt (processedOn is overwritten on every attempt);
    null for earlier attempts, while a newer attempt has no line yet, or when
    the gap would be negative. Never negative.
    """
    overheadStartMs: Float
    """
    Time between the run finishing and the job finishing. Same rule as
    overheadStartMs, and null while the job has not finished.
    """
    overheadEndMs: Float
    steps: [AgentRunStep!]!
    final: AgentRunFinal
    error: String
    input: AgentRunInput
    truncated: Boolean!
  }
  extend type Job {
    """
    One per attempt, in order. Empty outside agent queues/jobs. Resolved on
    demand from the job logs.
    """
    agentRuns: [AgentRun!]!
  }
  type AgentLatencyPoint {
    timestamp: Float!
    windowMs: Float!
    runs: Int!
    failed: Int!
    """
    Estimated from a fixed-band histogram (approximate).
    """
    p50: Float
    p95: Float
  }
  type AgentStepsBucket {
    label: String!
    count: Int!
  }
  type AgentToolStats {
    name: String!
    calls: Int!
    avgDurationMs: Float!
    errorRate: Float!
    emptyRate: Float!
  }
  type AgentModelStats {
    model: String!
    runs: Int!
    inputTokens: Float!
    outputTokens: Float!
    """
    Null = model without a price in the setup.
    """
    cost: Float
  }
  type AgentOutcomeCount {
    outcome: String!
    count: Int!
  }
  type AgentsSummary {
    runs: Int!
    failed: Int!
    """
    Terminal events whose job was already removed when read (e.g.
    removeOnComplete: true), so its runs could not be counted. The job name
    is gone too: in a queue that mixes agent and non-agent jobs (ai.jobs),
    removed non-agent jobs are counted as well.
    """
    lost: Int!
    """
    Finished agent jobs with no run at all: no run line in the log and no run
    in the returnvalue. Usually a worker not instrumented with createAgentRun
    (e.g. old code still consuming the queue). Distinct from lost.
    """
    unrecorded: Int!
    p50: Float
    p95: Float
    avgDurationMs: Float
    """
    Share of the time spent in LLM steps (llmMs / (llmMs + toolMs)).
    """
    llmShare: Float
    inputTokens: Float!
    outputTokens: Float!
    """
    Sum over the models that have a price. Null if none has.
    """
    cost: Float
    """
    Some model in the window has no price.
    """
    hasUnpricedModels: Boolean!
    avgSteps: Float
    runsWithEmptyTool: Int!
    latency: [AgentLatencyPoint!]!
    steps: [AgentStepsBucket!]!
    tools: [AgentToolStats!]!
    models: [AgentModelStats!]!
    outcomes: [AgentOutcomeCount!]!
  }
  enum AgentRunsFilter {
    all
    failed
    emptyTool
    slow
  }
  enum AgentRunsSort {
    recent
    slowest
    costliest
  }
  type AgentRunToolLink {
    name: String!
    ok: Boolean!
    empty: Boolean!
  }
  type AgentRunListItem {
    queue: ID!
    jobId: ID!
    jobName: String!
    attempt: Int!
    finishedAt: Float!
    durationMs: Float
    model: String!
    steps: Int!
    inputTokens: Int!
    outputTokens: Int!
    cost: Float
    outcome: String!
    tools: [AgentRunToolLink!]!
    error: String
  }
  type AgentRunsCounts {
    all: Int!
    failed: Int!
    emptyTool: Int!
    slow: Int!
  }
  type AgentRunsPage {
    total: Int!
    """
    Count per filter over the same window, for the chips.
    """
    counts: AgentRunsCounts!
    items: [AgentRunListItem!]!
  }
  type AgentConversationMessage {
    jobId: ID!
    attempt: Int!
    """
    Epoch ms. finishedAt - durationMs; null when the run has no duration.
    """
    startedAt: Float
    """
    Epoch ms.
    """
    finishedAt: Float!
    durationMs: Float
    model: String!
    inputTokens: Int!
    outputTokens: Int!
    """
    Null = the model has no price in the setup.
    """
    cost: Float
    outcome: String!
    steps: Int!
    """
    The message's run, read from the job log and cut to the queue's detail
    (user text and final answer only at full). Null when the job is gone or
    its log no longer holds this attempt.
    """
    run: AgentRun
    """
    True when the job was removed and only the index entry is left.
    """
    jobRemoved: Boolean!
  }
  type AgentConversationTotals {
    messages: Int!
    """
    First message's start to the last message's finish. Null when the first
    start is unknown.
    """
    durationMs: Float
    """
    Sum of the runs' durations.
    """
    aiMs: Float!
    inputTokens: Float!
    outputTokens: Float!
    """
    Sum over the messages whose model has a price. Null if none has.
    """
    cost: Float
    """
    Some message's model has no price.
    """
    hasUnpricedMessages: Boolean!
    steps: Int!
    toolCalls: Int!
  }
  type AgentToolCount {
    name: String!
    count: Int!
  }
  type AgentConversation {
    queue: ID!
    conversationId: ID!
    """
    One per job (its highest attempt), oldest first, at most the 100 most
    recent.
    """
    messages: [AgentConversationMessage!]!
    """
    Heuristic. True when the conversation has more than 100 messages (only the
    newest are listed), or when the queue's recent runs index is at its cap
    (recentRuns, so its oldest runs were evicted) and it reaches back from the
    first message no further than the conversation's largest pause between
    two messages (at least 30 minutes): an older message may have been
    evicted. When the index reaches further back, an older message would most
    likely still be in it, so false.
    """
    maybeIncomplete: Boolean!
    totals: AgentConversationTotals!
    """
    Calls per tool over the listed messages, most used first.
    """
    tools: [AgentToolCount!]!
  }
  extend type Query {
    """
    Run of one attempt. Without attempt = the last one.
    """
    agentRun(queue: ID!, jobId: ID!, attempt: Int): AgentRun
    """
    Empty/omitted queues = every agent queue. \`until\` allows the previous
    window (comparison).
    """
    agentsSummary(
      queues: [ID!]
      since: Float!
      until: Float
      maxPoints: Int
    ): AgentsSummary
    agentRuns(
      queues: [ID!]
      since: Float!
      filter: AgentRunsFilter = all
      """
      Threshold of the slow filter. Default 15000.
      """
      slowMs: Float = 15000
      sort: AgentRunsSort = recent
      offset: Int = 0
      limit: Int = 50
    ): AgentRunsPage
    """
    Every run of the queue's recent runs index sharing input.conversationId.
    Needs the metrics collector. Null outside agent queues.
    """
    agentConversation(queue: ID!, conversationId: ID!): AgentConversation
  }
`;
