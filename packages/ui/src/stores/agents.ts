// Relative imports keep the store usable from the root jest setup.
import { StorageConfig } from '../config/storage';
import createStore from 'zustand';
import { persist } from 'zustand/middleware';
import { useActiveScreenStore } from './active-screen';
import { AgentRunsFilter, AgentRunsSort } from '../typings/gql';
import type { AgentRunListItem } from '../typings/gql';

export type TAgentsTab = 'metrics' | 'runs';
export type TAgentsRunLayout = 'graph' | 'waterfall';
export type TAgentsConversationLayout = 'chat' | 'list';
export type TAgentsBackTo = 'jobs' | 'runs' | 'conversation';

export type TAgentConversationRef = {
  queue: string;
  conversationId: string;
};

/** Rows the runs list loads per "Show more". */
export const AGENT_RUNS_PAGE = 50;

export type TAgentRunRef = {
  queue: string;
  jobId: string;
  /** Omitted = the last attempt. */
  attempt?: number;
  /**
   * The runs-list entry the run was opened from. Kept so a run whose job was
   * already removed still shows what the index knows about it.
   */
  entry?: Omit<AgentRunListItem, 'tools'> & {
    tools: AgentRunListItem['tools'];
  };
};

type TAgentsState = {
  /** Last list tab, where the screen lands when no run is open. */
  tab: TAgentsTab;
  /** Null = every agent queue. */
  queue: string | null;
  /** The open run. Set = the screen shows the run view. */
  run: TAgentRunRef | null;
  runLayout: TAgentsRunLayout;
  /** Label from `screens/shared/time-range.ts`. Null = its default. */
  range: string | null;
  backTo: TAgentsBackTo;
  /**
   * The open conversation. Shown when set and no run is open on top of it
   * (a message's run opened from the conversation comes back to it).
   */
  conversation: TAgentConversationRef | null;
  /** The run (and its way back) the conversation was opened from. */
  conversationFrom: { run: TAgentRunRef; backTo: TAgentsBackTo } | null;
  conversationLayout: TAgentsConversationLayout;
  /** Message picked in the List layout. Null = the newest. */
  conversationMessage: string | null;
  /**
   * Runs list state. Lives here (not in the tab) so it survives opening a run
   * and coming back; not persisted.
   */
  runsFilter: AgentRunsFilter;
  runsSort: AgentRunsSort;
  runsLimit: number;

  changeTab: (tab: TAgentsTab) => void;
  changeQueue: (queue: string | null) => void;
  changeRunLayout: (layout: TAgentsRunLayout) => void;
  changeRange: (range: string) => void;
  changeAttempt: (attempt: number) => void;
  changeRunsFilter: (filter: AgentRunsFilter) => void;
  changeRunsSort: (sort: AgentRunsSort) => void;
  showMoreRuns: () => void;
  openRun: (run: TAgentRunRef, backTo: TAgentsBackTo) => void;
  /** Leaves the run view for wherever it was opened from. */
  closeRun: () => void;
  /** Drops an open run and lands on the last tab, staying on the screen. */
  leaveRun: () => void;
  /** From the open run: shows its whole conversation. */
  openConversation: (conversation: TAgentConversationRef) => void;
  /** Back to the run the conversation was opened from. */
  closeConversation: () => void;
  changeConversationLayout: (layout: TAgentsConversationLayout) => void;
  selectConversationMessage: (jobId: string) => void;
};

/** No run, no conversation: the screen shows the last tab. */
const CLEARED = {
  run: null,
  conversation: null,
  conversationFrom: null,
  conversationMessage: null,
};

export const useAgentsStore = createStore<TAgentsState>(
  persist(
    (set, get) => ({
      tab: 'metrics',
      queue: null,
      run: null,
      runLayout: 'graph',
      range: null,
      backTo: 'runs',
      runsFilter: AgentRunsFilter.All,
      runsSort: AgentRunsSort.Recent,
      runsLimit: AGENT_RUNS_PAGE,
      conversation: null,
      conversationFrom: null,
      conversationLayout: 'chat',
      conversationMessage: null,

      changeTab: (tab) => set({ tab, ...CLEARED }),
      changeQueue: (queue) => set({ queue, runsLimit: AGENT_RUNS_PAGE }),
      changeRunLayout: (runLayout) => set({ runLayout }),
      changeRange: (range) => set({ range }),
      changeAttempt: (attempt) => {
        const run = get().run;
        if (run) set({ run: { ...run, attempt } });
      },
      changeRunsFilter: (runsFilter) =>
        set({ runsFilter, runsLimit: AGENT_RUNS_PAGE }),
      changeRunsSort: (runsSort) =>
        set({ runsSort, runsLimit: AGENT_RUNS_PAGE }),
      showMoreRuns: () => set({ runsLimit: get().runsLimit + AGENT_RUNS_PAGE }),
      openRun: (run, backTo) => {
        // A run opened from anywhere but its conversation starts a new trail.
        if (backTo === 'conversation') set({ run, backTo });
        else set({ ...CLEARED, run, backTo });
        useActiveScreenStore.getState().changeScreen('agents');
      },
      closeRun: () => {
        const { backTo } = get();
        // The conversation is still set underneath: it shows again.
        if (backTo === 'conversation') {
          set({ run: null });
          return;
        }
        // Back to the runs list when it came from there, so its filter, sort
        // and page are where they were.
        const tab = backTo === 'runs' ? 'runs' : get().tab;
        set({ ...CLEARED, tab });
        if (backTo === 'jobs') {
          useActiveScreenStore.getState().changeScreen('jobs');
        }
      },
      leaveRun: () => {
        if (get().run || get().conversation) set(CLEARED);
      },
      openConversation: (conversation) => {
        const { run, backTo, conversation: open } = get();
        // A message's run opened from this same conversation: go back to it
        // instead of stacking it again (which would lose the source run).
        if (
          backTo === 'conversation' &&
          open?.queue === conversation.queue &&
          open.conversationId === conversation.conversationId
        ) {
          set({ run: null });
          return;
        }
        set({
          conversation,
          conversationFrom: run ? { run, backTo } : null,
          conversationMessage: null,
          run: null,
        });
      },
      closeConversation: () => {
        const from = get().conversationFrom;
        if (from) set({ ...CLEARED, run: from.run, backTo: from.backTo });
        else set(CLEARED);
      },
      changeConversationLayout: (conversationLayout) =>
        set({ conversationLayout }),
      selectConversationMessage: (conversationMessage) =>
        set({ conversationMessage }),
    }),
    {
      name: `${StorageConfig.persistNs}agents`,
      // `run` is not persisted, so a reload lands on the last tab.
      whitelist: ['tab', 'runLayout', 'range', 'conversationLayout'],
      // v0 persisted `view` ('metrics' | 'runs' | 'run') instead of `tab`.
      version: 1,
      migrate: (persisted) => {
        const saved = (persisted ?? {}) as Partial<TAgentsState> & {
          view?: string;
        };
        const { view, ...rest } = saved;
        return {
          ...rest,
          tab: view === 'metrics' || !view ? 'metrics' : 'runs',
        } as TAgentsState;
      },
    }
  )
);

// A run left open while the user went to another screen is stale: the next
// visit to Agents (from the sidebar) lands on the last tab instead.
useActiveScreenStore.subscribe(
  (screen: string) => {
    if (screen !== 'agents') useAgentsStore.getState().leaveRun();
  },
  (state) => state.screen
);
