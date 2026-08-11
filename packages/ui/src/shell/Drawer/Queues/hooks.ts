import { usePreferencesStore } from '@/stores/preferences';
import type { GetQueuesQuery, JobStatus, QueueJobsCounts } from '@/typings/gql';
import { useMemo } from 'react';
import groupBy from 'lodash/groupBy';
import omitBy from 'lodash/omitBy';
import isNil from 'lodash/isNil';

type QueueFromQuery = NonNullable<GetQueuesQuery['queues']>[0];
export const useJobsCountArray = (count: QueueJobsCounts) => {
  return useMemo(() => {
    return Object.entries(omitBy(count, isNil)).map(([status, count]) => ({
      status: status as JobStatus,
      count: count as number,
    }));
  }, [count]);
};
export const useQueueWorkspaceLabel = (queue: QueueFromQuery): string => {
  if (!queue.keyPrefix || queue.keyPrefix === 'bull') {
    return queue.name;
  }
  return queue.keyPrefix + ' ' + queue.name;
};
export const useMaybeGroupQueuesByPrefix = (queues: QueueFromQuery[]) => {
  const shouldGroup = usePreferencesStore((state) => state.groupQueuesByPrefix);
  if (!shouldGroup) {
    return null;
  }
  return groupBy(queues, 'keyPrefix');
};

export type TQueueGroup = {
  name: string;
  queues: QueueFromQuery[];
};
export type TGroupedQueues = {
  groups: TQueueGroup[];
  ungrouped: QueueFromQuery[];
};
// Splits queues into named groups (via the `group` field set on the
// BullAdapter/BullMQAdapter config) plus whatever's left ungrouped, keeping
// each group's first-seen order stable across renders.
export const useGroupedQueues = (queues: QueueFromQuery[]): TGroupedQueues => {
  return useMemo(() => {
    const groups: TQueueGroup[] = [];
    const groupsByName = new Map<string, TQueueGroup>();
    const ungrouped: QueueFromQuery[] = [];
    queues.forEach((queue) => {
      if (!queue.group) {
        ungrouped.push(queue);
        return;
      }
      let group = groupsByName.get(queue.group);
      if (!group) {
        group = { name: queue.group, queues: [] };
        groupsByName.set(queue.group, group);
        groups.push(group);
      }
      group.queues.push(queue);
    });
    return { groups, ungrouped };
  }, [queues]);
};

// Sums job counts across a group's queues, keeping only statuses with at
// least one job — a group collapsed to zero noise is exactly as quiet as it
// should be, while a single failed job anywhere inside still surfaces.
export const useAggregatedJobsCount = (queues: QueueFromQuery[]) => {
  return useMemo(() => {
    const sums: Partial<Record<JobStatus, number>> = {};
    queues.forEach(({ jobsCounts }) => {
      Object.entries(omitBy(jobsCounts, isNil)).forEach(([status, count]) => {
        if (!count) return;
        const key = status as JobStatus;
        sums[key] = (sums[key] ?? 0) + (count as number);
      });
    });
    return Object.entries(sums).map(([status, count]) => ({
      status: status as JobStatus,
      count: count as number,
    }));
  }, [queues]);
};
