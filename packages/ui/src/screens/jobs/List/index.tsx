import React from 'react';
import Job from './Job';
import makeStyles from '@mui/styles/makeStyles';
import Pagination from './Pagination';
import DataEditor from '../DataEditorModal';
import JobLogsModal from '../LogsModal';
import { useJobsQuery } from './hooks';
import NetworkRequest from '@/components/NetworkRequest';
import TableToolbar from './Toolbar';
import { useSelectedJobsStore } from '@/stores/selected-jobs';
import shallow from 'zustand/shallow';
import { useAtomValue } from 'jotai/utils';
import { activeQueueAtom } from '@/atoms/workspaces';
import { useQueueData } from '@/hooks/use-queue-data';

const useStyles = makeStyles((theme) => ({
  cards: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    margin: theme.spacing(1.5, 0),
  },
}));

export default function Jobs() {
  const cls = useStyles();
  const queue = useAtomValue(activeQueueAtom) as string;
  const { data, status, refetch, error } = useJobsQuery();
  const [selectedJobs, toggleSelected, removeSelected] = useSelectedJobsStore(
    (state) => [state.selected, state.toggleJob, state.removeJob],
    shallow
  );
  const readonly = !!useQueueData(queue)?.readonly;
  return (
    <div>
      <NetworkRequest status={status} refetch={refetch} error={error}>
        <TableToolbar jobs={data?.jobs} />
        <div className={cls.cards}>
          {data?.jobs?.map((job) => (
            <Job
              readonly={readonly}
              toggleSelected={toggleSelected}
              removeSelected={removeSelected}
              isSelected={selectedJobs.has(job.id)}
              queue={queue}
              key={job.id}
              job={job}
            />
          ))}
        </div>
        <Pagination />
      </NetworkRequest>
      <DataEditor />
      <JobLogsModal />
    </div>
  );
}
