import gql from 'graphql-tag';

export const metricsTypeDef = gql`
  type QueueMetrics {
    timestamp: Float!
    counts: QueueJobsCounts!
    processingTime: Float
    processingTimeMin: Float
    processingTimeMax: Float
    """
    Jobs that finished during the window ending at \`timestamp\`. These are
    event counters, unlike \`counts.completed\` — which is the size of the
    \`completed\` set in redis and therefore shrinks with \`removeOnComplete\`.
    Null on points collected before this field existed.
    """
    completed: Int
    failed: Int
    """
    Length of the window the counters above cover, in milliseconds. Needed to
    derive a per-minute rate: the first window after a restart is shorter than
    the configured collect interval, and downsampled points merge windows.
    """
    windowMs: Float
  }
  type ThroughputPoint {
    timestamp: Float!
    completed: Int!
    failed: Int!
  }
  type QueueThroughputSummary {
    queue: ID!
    name: String!
    completed: Int!
    failed: Int!
  }
  type MetricsSummary {
    """
    Throughput of every monitored queue, summed per collection window.
    """
    points: [ThroughputPoint!]!
    totalCompleted: Int!
    totalFailed: Int!
    """
    Per-queue totals over the same window, ordered by total runs descending.
    """
    queues: [QueueThroughputSummary!]!
  }
`;
