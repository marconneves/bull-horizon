import createStore from 'zustand';
import { persist } from 'zustand/middleware';
import { StorageConfig } from '@/config/storage';

type TState = {
  confirmDangerousActions: boolean;
  groupQueuesByPrefix: boolean;
  expandJobData: boolean;
  expandJobReturnValue: boolean;
  expandJobStackTrace: boolean;
  visualJobFilter: boolean;

  changeConfirmDangerousActions: (value: boolean) => void;
  toggleConfirmDangerousActions: () => void;
  toggleGroupQueuesByPrefix: () => void;
  toggleExpandJobData: () => void;
  toggleExpandJobReturnValue: () => void;
  toggleExpandJobStackTrace: () => void;
  toggleVisualJobFilter: () => void;
};
export const usePreferencesStore = createStore<TState>(
  persist(
    (set) => ({
      confirmDangerousActions: true,
      groupQueuesByPrefix: false,
      expandJobData: false,
      expandJobReturnValue: false,
      expandJobStackTrace: false,
      // The visual builder is the search's initial mode; the `<>` button still
      // switches to the raw jsonata expression at any time.
      visualJobFilter: true,

      changeConfirmDangerousActions: (confirmDangerousActions) =>
        set({ confirmDangerousActions }),
      toggleConfirmDangerousActions: () =>
        set((state) => ({
          confirmDangerousActions: !state.confirmDangerousActions,
        })),
      toggleGroupQueuesByPrefix: () =>
        set((state) => ({
          groupQueuesByPrefix: !state.groupQueuesByPrefix,
        })),
      toggleExpandJobData: () =>
        set((state) => ({ expandJobData: !state.expandJobData })),
      toggleExpandJobReturnValue: () =>
        set((state) => ({ expandJobReturnValue: !state.expandJobReturnValue })),
      toggleExpandJobStackTrace: () =>
        set((state) => ({ expandJobStackTrace: !state.expandJobStackTrace })),
      toggleVisualJobFilter: () =>
        set((state) => ({ visualJobFilter: !state.visualJobFilter })),
    }),
    {
      name: `${StorageConfig.persistNs}prefs`,
      version: 3,
    }
  )
);
