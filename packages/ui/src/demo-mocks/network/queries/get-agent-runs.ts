import type {
  GetAgentRunsQuery,
  GetAgentRunsQueryVariables,
} from '@/typings/gql';
import { AgentRunsFilter, AgentRunsSort } from '@/typings/gql';
import { agentMock } from '../agents/runs';
import type { TRunIndexItem } from '../agents/runs';

/** Same filter, sort and paging the server applies over the runs index. */
export const getAgentRunsMock = async ({
  queues,
  since,
  filter = AgentRunsFilter.All,
  slowMs = 15000,
  sort = AgentRunsSort.Recent,
  offset = 0,
  limit = 50,
}: GetAgentRunsQueryVariables): Promise<GetAgentRunsQuery> => {
  const slow = slowMs ?? 15000;
  const all = agentMock().index.filter(
    (item) =>
      item.finishedAt >= since &&
      (!queues?.length || queues.includes(item.queue))
  );
  const matches: Record<AgentRunsFilter, (item: TRunIndexItem) => boolean> = {
    [AgentRunsFilter.All]: () => true,
    [AgentRunsFilter.Failed]: (item) => item.outcome === 'error',
    [AgentRunsFilter.EmptyTool]: (item) => item.tools.some((t) => t.empty),
    [AgentRunsFilter.Slow]: (item) => (item.durationMs ?? 0) >= slow,
  };
  const filtered = all.filter(matches[filter ?? AgentRunsFilter.All]);
  const sorted = [...filtered].sort((a, b) => {
    if (sort === AgentRunsSort.Slowest) {
      return (b.durationMs ?? 0) - (a.durationMs ?? 0);
    }
    if (sort === AgentRunsSort.Costliest) {
      // Unpriced runs go last.
      if (a.cost === null && b.cost === null) return 0;
      if (a.cost === null) return 1;
      if (b.cost === null) return -1;
      return (b.cost as number) - (a.cost as number);
    }
    return b.finishedAt - a.finishedAt;
  });
  const start = offset ?? 0;
  return {
    agentRuns: {
      total: filtered.length,
      counts: {
        all: all.length,
        failed: all.filter(matches[AgentRunsFilter.Failed]).length,
        emptyTool: all.filter(matches[AgentRunsFilter.EmptyTool]).length,
        slow: all.filter(matches[AgentRunsFilter.Slow]).length,
      },
      items: sorted.slice(start, start + (limit ?? 50)),
    },
  };
};
