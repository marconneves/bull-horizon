import type { Maybe } from '@/typings/gql';
import createStore from 'zustand';
import type { TJobIdentity } from '@/typings';

type TJobLogsState = {
  isOpen: boolean;
  close: () => void;
  /** `jobName` decides whether agent-run lines collapse (agent jobs only). */
  open: (jobIdentity: TJobIdentity, jobName?: string) => void;
  jobIdentity: Maybe<TJobIdentity>;
  jobName: Maybe<string>;
};
export const useJobLogsStore = createStore<TJobLogsState>((set) => ({
  jobIdentity: null,
  jobName: null,
  isOpen: false,
  open: (jobIdentity, jobName) =>
    set({ isOpen: true, jobIdentity, jobName: jobName ?? null }),
  close: () => set({ isOpen: false }),
}));
