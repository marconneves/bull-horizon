import type {
  QueryAgentConversationArgs,
  QueryAgentRunArgs,
  QueryAgentRunsArgs,
  QueryAgentsSummaryArgs,
  QueryFlowSummaryArgs,
  QueryFlowTraceArgs,
  QueryJobArgs,
  QueryMetricsArgs,
  QueryMetricsSummaryArgs,
  QueryQueueArgs,
} from '../../typings/gql';
import type { TResolvers } from './typings';

export const queryResolver: TResolvers = {
  Query: {
    async redisInfo(_, __, { dataSources: { bull } }) {
      return await bull.getRedisInfo();
    },
    metricsEnabled(_, __, { dataSources: { metrics } }) {
      return metrics.isEnabled();
    },
    metricsInfo(_, __, { dataSources: { metrics } }) {
      return metrics.isEnabled() ? metrics.getInfo() : null;
    },
    async metrics(_, args: QueryMetricsArgs, { dataSources: { metrics } }) {
      return await metrics.getMetrics(
        args.queue,
        args.start as number,
        args.end as number,
        args.since as number,
        args.maxPoints as number
      );
    },
    async metricsSummary(
      _,
      args: QueryMetricsSummaryArgs,
      { dataSources: { metrics } }
    ) {
      return await metrics.getSummary(
        args.since as number,
        args.maxPoints as number
      );
    },
    async agentRun(
      _,
      { queue, jobId, attempt }: QueryAgentRunArgs,
      { dataSources: { agents } }
    ) {
      return await agents.getRun(queue, jobId, attempt);
    },
    async agentsSummary(
      _,
      { queues, since, until, maxPoints }: QueryAgentsSummaryArgs,
      { dataSources: { agents } }
    ) {
      return await agents.getSummary(queues, since, until, maxPoints);
    },
    async agentRuns(_, args: QueryAgentRunsArgs, { dataSources: { agents } }) {
      return await agents.getRuns(args);
    },
    async agentConversation(
      _,
      { queue, conversationId }: QueryAgentConversationArgs,
      { dataSources: { agents } }
    ) {
      return await agents.getConversation(queue, conversationId);
    },
    flows(_, __, { dataSources: { flows } }) {
      return flows.getFlows();
    },
    async flowSummary(
      _,
      { flow, since }: QueryFlowSummaryArgs,
      { dataSources: { flows } }
    ) {
      return await flows.getSummary(flow, since);
    },
    async flowTrace(
      _,
      { flow, query, traceId }: QueryFlowTraceArgs,
      { dataSources: { flows } }
    ) {
      return await flows.getTrace(flow, query, traceId);
    },
    queues(_, __, { dataSources: { bull } }) {
      return bull.getQueues();
    },
    queue(_, args: QueryQueueArgs, { dataSources: { bull } }) {
      return bull.getQueueById(args.id);
    },
    async jobs(_, args, { dataSources: { bull } }) {
      return await bull.getQueueJobs(args);
    },
    async job(_parent, { queue, id }: QueryJobArgs, { dataSources: { bull } }) {
      return await bull.getJob(queue, id);
    },
  },
};
