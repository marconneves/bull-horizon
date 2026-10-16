import type {
  GetAgentConversationQuery,
  GetAgentConversationQueryVariables,
} from '@/typings/gql';
import {
  AGENT_QUEUE_ID,
  INDEX_CAP,
  agentMock,
  conversationOf,
  runFromIndexItem,
} from '../agents/runs';
import type { TRunIndexItem } from '../agents/runs';
import { demoCost } from '../agents/design-run';

type TConversation = NonNullable<
  GetAgentConversationQuery['agentConversation']
>;
type TMessage = TConversation['messages'][0];

/** Same cap as the server (AGENT_CONVERSATION_MAX_MESSAGES). */
const MAX_MESSAGES = 100;
/**
 * Older synthetic entries stand for jobs a `removeOnComplete` already
 * dropped: only the index entry is left, so the message has no run.
 */
const REMOVED_AFTER_MS = 12 * 60 * 60 * 1000;

const MIN_GAP_MS = 30 * 60 * 1000;
const startOf = (item: TRunIndexItem) =>
  item.finishedAt - (item.durationMs ?? 0);

/**
 * Same heuristic as the server: more than 100 messages, or the index is at
 * its cap and the conversation starts close enough to the oldest entry that
 * an earlier message may have been evicted ("close" = within the largest gap
 * between two of its messages, at least 30 minutes).
 */
export const maybeIncomplete = (
  index: TRunIndexItem[],
  sorted: TRunIndexItem[]
): boolean => {
  if (sorted.length > MAX_MESSAGES) return true;
  if (index.length < INDEX_CAP || !sorted.length) return false;
  const oldest = Math.min(...index.map((item) => item.finishedAt));
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    maxGap = Math.max(maxGap, startOf(sorted[i]) - sorted[i - 1].finishedAt);
  }
  return startOf(sorted[0]) - oldest <= Math.max(maxGap, MIN_GAP_MS);
};

/**
 * Mirrors `getConversation` on the server: the queue's runs index filtered
 * by conversation, one message per job (highest attempt), oldest first,
 * the newest 100, totals over what is listed.
 */
export const getAgentConversationMock = async ({
  queue,
  conversationId,
}: GetAgentConversationQueryVariables): Promise<GetAgentConversationQuery> => {
  if (queue !== AGENT_QUEUE_ID) return { agentConversation: null };
  const { jobs, index } = agentMock();
  const byJob = new Map<string, TRunIndexItem>();
  for (const item of index) {
    if (conversationOf(item.jobId) !== conversationId) continue;
    const kept = byJob.get(item.jobId);
    if (!kept || item.attempt > kept.attempt) byJob.set(item.jobId, item);
  }
  const sorted = Array.from(byJob.values()).sort(
    (a, b) => a.finishedAt - b.finishedAt
  );
  const listed = sorted.slice(-MAX_MESSAGES);
  const now = Date.now();
  const toolNames: string[] = [];
  const messages: TMessage[] = listed.map((item) => {
    const job = jobs.find((j) => j.id === item.jobId);
    const removed = !job && now - item.finishedAt > REMOVED_AFTER_MS;
    const run = job
      ? job.runs.find((r) => r.attempt === item.attempt) ?? null
      : removed
      ? null
      : runFromIndexItem(item);
    toolNames.push(
      ...(run
        ? run.steps.flatMap((step) => step.tools.map((tool) => tool.name))
        : item.tools.map((tool) => tool.name))
    );
    return {
      jobId: item.jobId,
      attempt: item.attempt,
      startedAt:
        item.durationMs === null || item.durationMs === undefined
          ? null
          : item.finishedAt - item.durationMs,
      finishedAt: item.finishedAt,
      durationMs: item.durationMs,
      model: item.model,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      cost: demoCost(item.model, item.inputTokens, item.outputTokens),
      outcome: item.outcome,
      steps: item.steps,
      run,
      jobRemoved: removed,
    };
  });

  const first = messages[0];
  const last = messages[messages.length - 1];
  const priced = messages.filter(
    (m) => m.cost !== null && m.cost !== undefined
  );
  const sum = (pick: (m: TMessage) => number) =>
    messages.reduce((total, m) => total + pick(m), 0);
  const counts = new Map<string, number>();
  for (const name of toolNames) counts.set(name, (counts.get(name) ?? 0) + 1);

  return {
    agentConversation: {
      queue,
      conversationId,
      messages,
      maybeIncomplete: maybeIncomplete(index, sorted),
      totals: {
        messages: messages.length,
        durationMs:
          first?.startedAt !== null && first?.startedAt !== undefined && last
            ? Math.max(last.finishedAt - first.startedAt, 0)
            : null,
        aiMs: sum((m) => m.durationMs ?? 0),
        inputTokens: sum((m) => m.inputTokens),
        outputTokens: sum((m) => m.outputTokens),
        cost: priced.length
          ? priced.reduce((total, m) => total + (m.cost as number), 0)
          : null,
        hasUnpricedMessages: priced.length < messages.length,
        steps: sum((m) => m.steps),
        toolCalls: toolNames.length,
      },
      tools: Array.from(counts, ([name, count]) => ({ name, count })).sort(
        (a, b) => b.count - a.count || a.name.localeCompare(b.name)
      ),
    },
  };
};
