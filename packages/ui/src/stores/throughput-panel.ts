import { StorageConfig } from '@/config/storage';
import createStore from 'zustand';
import { persist } from 'zustand/middleware';

type TState = {
  isOpen: boolean;
  toggle: () => void;
};

/**
 * Persisted so the panel does not reopen (and resume polling) on every reload
 * for people who collapsed it on purpose.
 */
export const useThroughputPanelStore = createStore<TState>(
  persist(
    (set, get) => ({
      isOpen: true,
      toggle: () => set({ isOpen: !get().isOpen }),
    }),
    {
      name: `${StorageConfig.persistNs}throughput-panel`,
    }
  )
);
