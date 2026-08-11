import type { Queue } from '../../queue';
import type { TResolvers } from './typings';
import type {
  Queue as GqlQueue,
  QueueMetrics as GqlQueueMetrics,
} from '../../typings/gql';

/**
 * Every per-status count comes out of a single `getJobCounts()` call, memoized
 * per request by the data source. Before this, a query asking for `jobsCounts`
 * plus a few `*Count` fields opened one Redis round-trip per field, per queue,
 * on every poll — the dashboard polls all queues every 5s by default, so the
 * cost scaled with (queues x fields).
 *
 * `count` and `isPaused` stay as their own calls: `count` has provider-specific
 * semantics (waiting + delayed, with variations across bull/bullmq versions)
 * that deriving from `jobsCounts` would silently change, and `isPaused` is a
 * flag that `getJobCounts()` does not return.
 */
export const queueResolver: TResolvers = {
  Queue: {
    async count(parent: Queue, _, { dataSources: { bull } }) {
      return await bull.getCachedCount(parent);
    },
    async failedCount(parent: Queue, _, { dataSources: { bull } }) {
      return (await bull.getCachedJobCounts(parent)).failed;
    },
    async completedCount(parent: Queue, _, { dataSources: { bull } }) {
      return (await bull.getCachedJobCounts(parent)).completed;
    },
    async delayedCount(parent: Queue, _, { dataSources: { bull } }) {
      return (await bull.getCachedJobCounts(parent)).delayed;
    },
    async activeCount(parent: Queue, _, { dataSources: { bull } }) {
      return (await bull.getCachedJobCounts(parent)).active;
    },
    async waitingCount(parent: Queue, _, { dataSources: { bull } }) {
      return (await bull.getCachedJobCounts(parent)).waiting;
    },
    async pausedCount(parent: Queue, _, { dataSources: { bull } }) {
      return (await bull.getCachedJobCounts(parent)).paused;
    },
    async jobsCounts(
      parent: Queue,
      _,
      { dataSources: { bull } }
    ): Promise<GqlQueue['jobsCounts']> {
      return await bull.getCachedJobCounts(parent);
    },
    async isPaused(
      parent: Queue,
      _,
      { dataSources: { bull } }
    ): Promise<GqlQueue['isPaused']> {
      return await bull.getCachedIsPaused(parent);
    },
    async jobs(parent: Queue, _, { dataSources: { bull } }) {
      return await bull.getQueueJobs({ queue: parent.id });
    },
    async metrics(
      parent: Queue,
      _,
      { dataSources: { metrics } }
    ): Promise<GqlQueueMetrics[]> {
      return await metrics.getMetrics(parent.id);
    },
  },
};
