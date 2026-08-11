import React, { useCallback } from 'react';
import List from '@mui/material/List';
import ListSubheader from '@mui/material/ListSubheader';
import { useDrawerState } from '@/stores/drawer';
import Queue from './Queue';
import QueueGroup from './Group';
import { useAtom } from 'jotai';
import {
  activeQueueAtom,
  activeQueueLabelAtom,
  activeStatusAtom,
} from '@/atoms/workspaces';
import { useGroupedQueues, useMaybeGroupQueuesByPrefix } from './hooks';
import { useActiveScreenStore } from '@/stores/active-screen';
import { useUpdateAtom } from 'jotai/utils';
import type { GetQueuesQuery, JobStatus } from '@/typings/gql';
import type { Maybe } from '@/typings/utils';

type TProps = {
  queues: NonNullable<GetQueuesQuery['queues']>;
};
export default function DrawerQueuesList({ queues }: TProps) {
  const { groups, ungrouped } = useGroupedQueues(queues);
  const groupedQueues = useMaybeGroupQueuesByPrefix(queues);
  const [activeQueue, changeActiveQueue] = useAtom(activeQueueAtom);
  const changeActiveQueueLabel = useUpdateAtom(activeQueueLabelAtom);
  const changeActiveStatus = useUpdateAtom(activeStatusAtom);
  const closeDrawer = useDrawerState((state) => state.close);
  const onSelect = useCallback(
    (queue: string, label: string, status?: Maybe<JobStatus>) => {
      changeActiveQueue(queue);
      changeActiveQueueLabel(label);
      if (status) {
        changeActiveStatus(status);
      }
      // Overview and Metrics history are cross-queue: picking a queue while one
      // of them is open changed the selection but left the screen looking
      // identical, which reads as "clicking a queue does nothing". Per-queue
      // screens (jobs, metrics) keep their context and just swap the queue.
      //
      // Read through `getState()` rather than a subscription so this callback
      // keeps a stable identity — it is handed to every queue row, and a new
      // identity on every screen change re-renders the entire list.
      const { screen, changeScreen } = useActiveScreenStore.getState();
      if (screen === 'overview' || screen === 'history') {
        changeScreen('jobs');
      }
      closeDrawer();
    },
    []
  );
  const renderQueue = (queue: TProps['queues'][0]) => {
    return (
      <Queue
        onSelect={onSelect}
        isSelected={activeQueue === queue.id}
        key={queue.id}
        queue={queue}
      />
    );
  };
  if (groups.length > 0) {
    return (
      <List>
        {groups.map((group) => (
          <QueueGroup
            key={group.name}
            group={group}
            renderQueue={renderQueue}
          />
        ))}
        {ungrouped.length > 0 && <ListSubheader>No group</ListSubheader>}
        {ungrouped.map(renderQueue)}
      </List>
    );
  }
  if (groupedQueues) {
    return (
      <>
        {Object.entries(groupedQueues).map(([prefix, queues]) => (
          <List
            key={prefix}
            subheader={<ListSubheader>{prefix}</ListSubheader>}
          >
            {queues.map(renderQueue)}
          </List>
        ))}
      </>
    );
  }
  return <List>{queues.map(renderQueue)}</List>;
}
