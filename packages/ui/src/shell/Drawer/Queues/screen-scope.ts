// Which queues the sidebar lists, per screen. Pure and import-free so the
// rule is unit-testable from the root jest setup.

type TScopedQueue = { agent?: unknown };

/**
 * On Agents the sidebar is a queue filter for that screen: only agent queues
 * (groups left without one disappear, since groups are built from this
 * list). Every other screen lists every queue.
 */
export const queuesForScreen = <T extends TScopedQueue>(
  queues: T[] | null | undefined,
  screen: string
): T[] | null | undefined =>
  screen === 'agents' && queues ? queues.filter((q) => !!q.agent) : queues;

export type TSidebarQueueAction = 'filter-agents' | 'go-to-jobs' | 'stay';

/**
 * What picking a queue in the sidebar does. Agents filters itself by it.
 * Overview, Metrics history and Flows are cross-queue, so they hand over to Jobs
 * (otherwise the click would look like it did nothing); Jobs just swaps the
 * queue.
 */
export const sidebarQueueAction = (screen: string): TSidebarQueueAction => {
  if (screen === 'agents') return 'filter-agents';
  if (screen === 'overview' || screen === 'history' || screen === 'flows') {
    return 'go-to-jobs';
  }
  return 'stay';
};
