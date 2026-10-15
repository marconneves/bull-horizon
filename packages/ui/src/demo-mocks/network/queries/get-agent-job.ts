import type {
  GetAgentJobQuery,
  GetAgentJobQueryVariables,
} from '@/typings/gql';
import { JobStatus } from '@/typings/gql';
import { networkMockData } from '../data';
import { agentMock, runFromIndexItem } from '../agents/runs';

export const getAgentJobMock = async ({
  queue,
  id,
}: GetAgentJobQueryVariables): Promise<GetAgentJobQuery> => {
  const { jobs, index } = agentMock();
  const job = networkMockData.findJob(queue, id);
  if (job) {
    const agentJob = jobs.find((j) => j.id === id);
    return {
      job: {
        id: job.id,
        name: job.name,
        status: job.status,
        data: job.data,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        agentRuns: agentJob?.runs ?? [],
      },
    };
  }
  // A runs-list row older than the jobs the demo keeps. A real deployment
  // would answer "job removed" here; the demo rebuilds the run from the index
  // entry so every row opens something.
  const entries = index
    .filter((item) => item.queue === queue && item.jobId === id)
    .sort((a, b) => a.attempt - b.attempt);
  if (!entries.length) return { job: null };
  const last = entries[entries.length - 1];
  return {
    job: {
      id,
      name: last.jobName,
      status: last.outcome === 'error' ? JobStatus.Failed : JobStatus.Completed,
      data: JSON.stringify({ messageId: `${id}-demo` }, null, 2),
      attemptsMade: entries.length,
      timestamp: last.finishedAt - (last.durationMs ?? 0) - 200,
      processedOn: last.finishedAt - (last.durationMs ?? 0) - 60,
      finishedOn: last.finishedAt,
      agentRuns: entries.map(runFromIndexItem),
    },
  };
};
