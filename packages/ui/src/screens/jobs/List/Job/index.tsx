import React from 'react';
import { alpha } from '@mui/material/styles';
import { useFormatDateTime } from '@/hooks/use-format-date-time';
import LinearProgress from '@mui/material/LinearProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DataObjectIcon from '@mui/icons-material/DataObject';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import BugReportIcon from '@mui/icons-material/BugReport';
import Actions from './Actions';
import type { TJobProps } from './typings';
import Checkbox from '@mui/material/Checkbox';
import JobStatusChip from '@/components/JobStatusChip';
import isempty from 'lodash/isEmpty';
import makeStyles from '@mui/styles/makeStyles';
import { useParsedProgress, useRemoveJobSelectionOnUnmount } from './hooks';
import ms from 'ms';
import AccordionJsonView from '@/components/AccordionJsonView';
import { usePreferencesStore } from '@/stores/preferences';
import { useAddDataSearchFilter } from '@/screens/jobs/Filters/DataSearch/hooks';
import { LIST_CARD_RADIUS } from '../constants';

const monospace = '"IBM Plex Mono", ui-monospace, monospace';

const useStyles = makeStyles((theme) => ({
  card: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: LIST_CARD_RADIUS,
    padding: theme.spacing(1.5, 2),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    transition: 'border-color 120ms, background-color 120ms',
    '&:hover': {
      borderColor: theme.palette.text.disabled,
    },
  },
  cardSelected: {
    borderColor: theme.palette.primary.main,
    backgroundColor: alpha(theme.palette.primary.main, 0.06),
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  checkbox: {
    padding: 0,
  },
  idText: {
    fontFamily: monospace,
    fontVariantNumeric: 'tabular-nums',
    color: theme.palette.text.secondary,
    maxWidth: 320,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  spacer: {
    flex: 1,
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(0.75),
    fontSize: '0.8rem',
    color: theme.palette.text.secondary,
  },
  dot: {
    color: theme.palette.text.disabled,
  },
  unnamed: {
    color: theme.palette.text.disabled,
    fontStyle: 'italic',
  },
  mono: {
    fontFamily: monospace,
    fontVariantNumeric: 'tabular-nums',
  },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    maxWidth: 320,
  },
  progressBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: alpha(theme.palette.text.primary, 0.08),
    '& .MuiLinearProgress-bar': {
      borderRadius: 3,
    },
  },
  progressText: {
    minWidth: 34,
    textAlign: 'right',
  },
  progressRaw: {
    display: 'block',
    maxWidth: 420,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  extraOneCol: {
    display: 'grid',
    gridTemplateColumns: '1fr',
  },
  extraTwoCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gridGap: theme.spacing(1),
    [theme.breakpoints.down('xl')]: {
      gridTemplateColumns: '1fr',
    },
  },
  stacktrace: {
    backgroundColor: `${alpha(theme.palette.error.main, 0.08)} !important`,
    border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
  },
}));

const MetaSeparator = ({ className }: { className: string }) => (
  <span className={className}>·</span>
);

const Job = ({
  job,
  queue,
  isSelected,
  toggleSelected,
  removeSelected,
  readonly,
}: TJobProps) => {
  const prefs = usePreferencesStore();
  const addDataSearchFilter = useAddDataSearchFilter();
  const date = useFormatDateTime(job.timestamp);
  const cls = useStyles();
  const progress = useParsedProgress(job.progress);
  useRemoveJobSelectionOnUnmount(job.id, isSelected, removeSelected);
  const delayDate = useFormatDateTime(
    job.delay && job.timestamp ? job.timestamp + job.delay : null
  );
  const hasData = !!job.data && job.data !== '{}';
  const hasStacktrace = !isempty(job.stacktrace);
  const hasReturnValue = !isempty(job.returnValue);
  const showExtra = hasData || hasStacktrace || hasReturnValue;
  const isUnnamed = job.name === '__default__';

  return (
    <div className={`${cls.card} ${isSelected ? cls.cardSelected : ''}`}>
      <div className={cls.topRow}>
        <Checkbox
          className={cls.checkbox}
          onChange={() => toggleSelected(job.id)}
          checked={isSelected}
        />
        <Tooltip title={job.id}>
          <span className={cls.idText}>{job.id}</span>
        </Tooltip>
        <JobStatusChip status={job.status} />
        <span className={cls.spacer} />
        <Actions readonly={readonly} job={job} queue={queue} />
      </div>
      <div className={cls.metaRow}>
        <span className={isUnnamed ? cls.unnamed : undefined}>
          {isUnnamed ? 'Unnamed' : job.name}
        </span>
        <MetaSeparator className={cls.dot} />
        <span className={cls.mono}>Created {date}</span>
        {delayDate && (
          <>
            <MetaSeparator className={cls.dot} />
            <span className={cls.mono}>Runs at {delayDate}</span>
          </>
        )}
        {job.processingTime ? (
          <>
            <MetaSeparator className={cls.dot} />
            <span className={cls.mono}>Duration {ms(job.processingTime)}</span>
          </>
        ) : null}
        {job.attemptsMade > 1 && (
          <>
            <MetaSeparator className={cls.dot} />
            <span className={cls.mono}>Attempts {job.attemptsMade}</span>
          </>
        )}
      </div>
      {progress.kind === 'numeric' && (
        <div className={cls.progressRow}>
          <LinearProgress
            className={cls.progressBar}
            variant="determinate"
            value={progress.value}
          />
          <Typography
            className={`${cls.mono} ${cls.progressText}`}
            variant="caption"
          >
            {Math.round(progress.value)}%
          </Typography>
        </div>
      )}
      {progress.kind === 'text' && (
        <Tooltip title={progress.value}>
          <Typography
            className={`${cls.mono} ${cls.progressRaw}`}
            variant="caption"
          >
            Progress: {progress.value}
          </Typography>
        </Tooltip>
      )}
      {showExtra && (
        <div
          className={
            [hasData, hasStacktrace, hasReturnValue].filter(Boolean).length > 1
              ? cls.extraTwoCol
              : cls.extraOneCol
          }
        >
          {hasData && (
            <AccordionJsonView
              defaultExpanded={prefs.expandJobData}
              header="Job Data"
              icon={<DataObjectIcon fontSize="small" />}
              filterBasePath="data"
              onFilterAdded={addDataSearchFilter}
            >
              {job.data}
            </AccordionJsonView>
          )}
          {hasReturnValue && (
            <AccordionJsonView
              defaultExpanded={prefs.expandJobReturnValue}
              header="Return Value"
              icon={<AssignmentReturnIcon fontSize="small" />}
              filterBasePath="returnvalue"
              onFilterAdded={addDataSearchFilter}
            >
              {job.returnValue}
            </AccordionJsonView>
          )}
          {hasStacktrace && (
            <AccordionJsonView
              defaultExpanded={prefs.expandJobStackTrace}
              textClassName={cls.stacktrace}
              header="Stacktrace"
              icon={<BugReportIcon fontSize="small" />}
            >
              {job.stacktrace.join('\n\n')}
            </AccordionJsonView>
          )}
        </div>
      )}
    </div>
  );
};
export default React.memo(Job);
