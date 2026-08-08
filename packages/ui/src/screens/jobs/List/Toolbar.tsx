import React from 'react';
import Toolbar from '@mui/material/Toolbar';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';
import makeStyles from '@mui/styles/makeStyles';
import isempty from 'lodash/isEmpty';
import { useSelectedJobsStore } from '@/stores/selected-jobs';
import shallow from 'zustand/shallow';
import type { GetJobsQuery } from '@/typings/gql';
import QueueActions from '../QueueActions';
import SelectedJobsActions from '../SelectedJobsActions';
import { LIST_CARD_RADIUS } from './constants';

const useStyles = makeStyles((theme) => ({
  root: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: LIST_CARD_RADIUS,
    backgroundColor: theme.palette.background.paper,
    gap: theme.spacing(1),
  },
  count: {
    color: theme.palette.text.secondary,
  },
}));

type TProps = {
  jobs?: GetJobsQuery['jobs'];
};

export default function TableToolbar({ jobs }: TProps) {
  const cls = useStyles();
  const [selected, clearSelected, setSelected] = useSelectedJobsStore(
    (state) => [state.selected, state.clear, state.setJobs],
    shallow
  );
  const hasJobs = !isempty(jobs);
  const jobsLength = jobs?.length ?? 0;
  const isIndeterminate = selected.size > 0 && selected.size !== jobsLength;
  const isChecked = hasJobs && selected.size === jobsLength;
  const onChangeAll = (_e: any, checked: boolean) => {
    if (checked) {
      if (jobs && hasJobs) setSelected(jobs.map((job) => job.id));
    } else {
      clearSelected();
    }
  };
  const selectedCount = selected.size;
  return (
    <Toolbar className={cls.root}>
      <Checkbox
        indeterminate={isIndeterminate}
        checked={isChecked}
        onChange={onChangeAll}
        disabled={!hasJobs}
      />
      {selectedCount === 0 && hasJobs && (
        <Typography className={cls.count} variant="body2">
          {jobsLength} job{jobsLength === 1 ? '' : 's'}
        </Typography>
      )}
      {selectedCount > 0 ? <SelectedJobsActions /> : <QueueActions />}
    </Toolbar>
  );
}
