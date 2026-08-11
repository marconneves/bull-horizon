import type {
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
