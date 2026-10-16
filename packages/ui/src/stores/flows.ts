// Relative imports keep the store usable from the root jest setup.
import { StorageConfig } from '../config/storage';
import createStore from 'zustand';
import { persist } from 'zustand/middleware';

export type TFlowsTab = 'flow' | 'trace' | 'config';
export type TFlowsLayout = 'A' | 'B';

type TFlowsState = {
  /** Selected flow. Null = the first one. */
  flowId: string | null;
  tab: TFlowsTab;
  flowLayout: TFlowsLayout;
  traceLayout: TFlowsLayout;
  /** Label from `screens/shared/time-range.ts`. Null = its default (24h). */
  range: string | null;
  /** Step picked in the graph (A) or expanded in the table (B). */
  step: string | null;
  /** What the search box holds while typing. */
  input: string;
  /** The search that was run (Enter / TRACE). */
  query: string | null;
  /** Candidate picked when the key matched several executions. */
  traceId: string | null;
  /** Job picked in the trace (`queueId/jobId`): graph node, path row or gantt row. */
  traceJob: string | null;

  changeFlow: (flowId: string) => void;
  changeTab: (tab: TFlowsTab) => void;
  changeFlowLayout: (layout: TFlowsLayout) => void;
  changeTraceLayout: (layout: TFlowsLayout) => void;
  changeRange: (range: string) => void;
  selectStep: (step: string | null) => void;
  changeInput: (input: string) => void;
  /** Runs the search in the box and opens the Trace tab. */
  runTrace: () => void;
  /** Runs a given search (a job id from elsewhere, a candidate). */
  openTrace: (query: string, traceId?: string | null) => void;
  pickCandidate: (traceId: string) => void;
  selectTraceJob: (key: string | null) => void;
  /** Back to the Flow tab with no trace. */
  clearTrace: () => void;
};

const NO_TRACE = { query: null, traceId: null, traceJob: null };

export const useFlowsStore = createStore<TFlowsState>(
  persist(
    (set, get) => ({
      flowId: null,
      tab: 'flow',
      flowLayout: 'A',
      traceLayout: 'A',
      range: null,
      step: null,
      input: '',
      query: null,
      traceId: null,
      traceJob: null,

      changeFlow: (flowId) =>
        set({ flowId, step: null, input: '', ...NO_TRACE }),
      changeTab: (tab) => set({ tab }),
      changeFlowLayout: (flowLayout) => set({ flowLayout }),
      changeTraceLayout: (traceLayout) => set({ traceLayout }),
      changeRange: (range) => set({ range }),
      selectStep: (step) => set({ step }),
      changeInput: (input) => set({ input }),
      runTrace: () => {
        const query = get().input.trim();
        if (!query) return;
        get().openTrace(query);
      },
      openTrace: (query, traceId = null) =>
        set({
          tab: 'trace',
          input: query,
          query,
          traceId,
          traceJob: null,
        }),
      pickCandidate: (traceId) => set({ traceId, traceJob: null }),
      selectTraceJob: (traceJob) => set({ traceJob }),
      clearTrace: () => set({ tab: 'flow', input: '', ...NO_TRACE }),
    }),
    {
      name: `${StorageConfig.persistNs}flows`,
      // The search is per visit; the choices of view are kept.
      whitelist: ['flowId', 'tab', 'flowLayout', 'traceLayout', 'range'],
    }
  )
);
