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
import { useAgentsStore } from '@/stores/agents';
import { sidebarQueueAction } from './screen-scope';
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
  const onAgents = useActiveScreenStore((state) => state.screen === 'agents');
  const agentsQueue = useAgentsStore((state) => state.queue);
  const onSelect = useCallback(
    (queue: string, label: string, status?: Maybe<JobStatus>) => {
      // Read through `getState()` rather than a subscription so this callback
      // keeps a stable identity — it is handed to every queue row, and a new
      // identity on every screen change re-renders the entire list.
      const { screen, changeScreen } = useActiveScreenStore.getState();
      const action = sidebarQueueAction(screen);
      // On Agents the sidebar filters that screen; Jobs keeps its queue.
      if (action === 'filter-agents') {
        useAgentsStore.getState().pickSidebarQueue(queue);
        closeDrawer();
        return;
      }
      changeActiveQueue(queue);
      changeActiveQueueLabel(label);
      if (status) {
        changeActiveStatus(status);
      }
      // Overview and Metrics history are cross-queue: picking a queue there
      // changed the selection but left the screen looking identical, which
      // reads as "clicking a queue does nothing", so it opens Jobs.
      if (action === 'go-to-jobs') changeScreen('jobs');
      closeDrawer();
    },
    []
  );
  const renderQueue = (queue: TProps['queues'][0]) => {
    return (
      <Queue
        onSelect={onSelect}
        isSelected={
          onAgents ? agentsQueue === queue.id : activeQueue === queue.id
        }
        showAgentIcon={!onAgents}
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
