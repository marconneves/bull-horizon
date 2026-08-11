import gql from 'graphql-tag';

export const rootQueryTypeDef = gql`
  type Query {
    queues: [Queue!]
    queue(id: ID!): Queue
    """
    \`since\` (unix ms) selects a time window and takes precedence over the
    index-based \`start\`/\`end\`. \`maxPoints\` downsamples server-side.
    """
    metrics(
      queue: ID!
      start: Int = 0
      end: Int = -1
      since: Float
      maxPoints: Int
    ): [QueueMetrics!]
    """
    Cross-queue throughput aggregate, computed on the server so the dashboard
    does not have to pull one full series per queue on every poll.
    """
    metricsSummary(since: Float, maxPoints: Int): MetricsSummary!
    jobs(
      queue: ID!
      offset: Int
      limit: Int
      status: JobStatus
      order: OrderEnum
      id: ID
      ids: [ID]
      dataSearch: String
    ): [Job!]!
    job(queue: ID!, id: ID!): Job
    redisInfo: RedisInfo
    metricsEnabled: Boolean!
  }
`;
