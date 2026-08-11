import { StorageConfig } from '@/config/storage';
import createStore from 'zustand';
import { persist } from 'zustand/middleware';

export type TScreen = 'jobs' | 'metrics' | 'overview' | 'history';

/** Screens that only make sense when the metrics collector is running. */
export const METRICS_SCREENS: TScreen[] = ['metrics', 'history'];

type TState = {
  screen: TScreen;

  changeScreen: (screen: TScreen) => void;
};

export const useActiveScreenStore = createStore<TState>(
  persist(
    (set) => ({
      screen: 'jobs',

      changeScreen: (screen) => set({ screen }),
    }),
    {
      name: `${StorageConfig.persistNs}active-screen`,
    }
  )
);
