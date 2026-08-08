import createStore from 'zustand';
import { persist } from 'zustand/middleware';
import { StorageConfig } from '@/config/storage';

type TState = {
  expanded: Record<string, boolean>;
  toggle: (group: string) => void;
};

// Groups start closed unless the user has explicitly expanded them —
// missing entries in `expanded` are treated as closed.
export const useExpandedQueueGroupsStore = createStore<TState>(
  persist(
    (set) => ({
      expanded: {},
      toggle: (group) =>
        set((state) => ({
          expanded: { ...state.expanded, [group]: !state.expanded[group] },
        })),
    }),
    {
      name: `${StorageConfig.persistNs}expanded-queue-groups`,
    }
  )
);
