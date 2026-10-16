import { useCallback } from 'react';
import { useUpdateAtom } from 'jotai/utils';
import {
  activeQueueAtom,
  activeQueueLabelAtom,
  activeStatusAtom,
  jobIdAtom,
} from '@/atoms/workspaces';
import { useActiveScreenStore } from '@/stores/active-screen';
import { useQueuesQuery } from '@/hooks/use-queues-query';
import { JobStatus } from '@/typings/gql';

/**
 * Opens Jobs on a queue of the flow, optionally on a status and on one job
 * (through the Job ID filter): "View queue jobs", a FAILED count, a recent
 * error, "Open job".
 */
export const useOpenQueueJobs = () => {
  const { data } = useQueuesQuery();
  const changeQueue = useUpdateAtom(activeQueueAtom);
  const changeLabel = useUpdateAtom(activeQueueLabelAtom);
  const changeStatus = useUpdateAtom(activeStatusAtom);
  const changeJobId = useUpdateAtom(jobIdAtom);
  return useCallback(
    (queueId: string, opts: { status?: JobStatus; jobId?: string } = {}) => {
      const queue = data?.queues?.find((q) => q.id === queueId);
      changeQueue(queueId);
      if (queue) {
        changeLabel(
          !queue.keyPrefix || queue.keyPrefix === 'bull'
            ? queue.name
            : `${queue.keyPrefix} ${queue.name}`
        );
      }
      // Without an explicit status the link means "the queue": the Jobs
      // screen's default, not whatever status was picked there last.
      changeStatus(opts.status ?? JobStatus.Active);
      changeJobId(opts.jobId ?? '');
      useActiveScreenStore.getState().changeScreen('jobs');
    },
    [data]
  );
};
