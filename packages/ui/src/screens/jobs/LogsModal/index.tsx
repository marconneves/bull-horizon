import React from 'react';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Button from '@mui/material/Button';
import shallow from 'zustand/shallow';
import { useQuery } from 'react-query';
import { QueryKeysConfig } from '@/config/query-keys';
import { useJobLogsStore } from '@/stores/job-logs';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import { useNetwork } from '@/hooks/use-network';
import { useAbstractMutation } from '@/hooks/use-abstract-mutation';
import NetworkRequest from '@/components/NetworkRequest';
import makeStyles from '@mui/styles/makeStyles';
import { useQueueData } from '@/hooks/use-queue-data';
import { useAgentsStore } from '@/stores/agents';
import {
  readAgentRunLogLine,
  shouldCollapseAgentRunLine,
} from '@/services/agent-run-log';
import type { TJobIdentity } from '@/typings';

const useStyles = makeStyles((theme) => ({
  root: {
    width: 500,
    '@media(max-width: 540px)': {
      width: 'auto',
    },
  },
  runLine: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: theme.spacing(0.5),
  },
  runHead: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontSize: 14,
  },
  runMeta: {
    flex: 1,
    fontSize: 12,
    color: theme.palette.text.secondary,
  },
  raw: {
    margin: 0,
    maxHeight: 200,
    overflow: 'auto',
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: 11,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    color: theme.palette.text.secondary,
  },
  inputRoot: {
    display: 'flex',
    alignItems: 'center',
    '& button': {
      marginLeft: theme.spacing(1),
    },
  },
}));

/**
 * A run line is one JSON object of up to 64 KB. Printed as-is it buries every
 * other log line, so it collapses to a summary that links to the run view.
 */
const AgentRunLine = ({
  line,
  jobIdentity,
  onOpen,
}: {
  line: string;
  jobIdentity: TJobIdentity;
  onOpen: () => void;
}) => {
  const cls = useStyles();
  const [showRaw, setShowRaw] = React.useState(false);
  const openRun = useAgentsStore((state) => state.openRun);
  const { attempt, chars } = React.useMemo(
    () => readAgentRunLogLine(line),
    [line]
  );
  return (
    <div className={cls.runLine}>
      <div className={cls.runHead}>
        <span>agent run{attempt !== null ? ` (attempt ${attempt})` : ''}</span>
        <span className={cls.runMeta}>
          {chars.toLocaleString('en-US')} chars
        </span>
        <Button
          size="small"
          color="inherit"
          onClick={() => setShowRaw(!showRaw)}
        >
          {showRaw ? 'Hide raw' : 'Raw'}
        </Button>
        <Button
          size="small"
          onClick={() => {
            onOpen();
            openRun(
              {
                queue: jobIdentity.queue,
                jobId: jobIdentity.id,
                attempt: attempt ?? undefined,
              },
              'jobs'
            );
          }}
        >
          Open run
        </Button>
      </div>
      {showRaw && <pre className={cls.raw}>{line}</pre>}
    </div>
  );
};

const JobLogs = () => {
  const [log, setLog] = React.useState('');
  const cls = useStyles();
  const {
    queries: { getJobLogs },
    mutations: { createJobLog },
  } = useNetwork();
  const [onClose, jobIdentity, jobName] = useJobLogsStore(
    (state) => [
      state.close,
      state.jobIdentity as NonNullable<typeof state.jobIdentity>,
      state.jobName,
    ],
    shallow
  );
  const queueData = useQueueData(jobIdentity.queue);
  const readonly = !!queueData?.readonly;
  const { status, refetch, data } = useQuery(
    [QueryKeysConfig.jobLogs, jobIdentity],
    () => getJobLogs(jobIdentity),
    {
      enabled: Boolean(jobIdentity),
    }
  );
  const mutation = useAbstractMutation({
    mutation: createJobLog,
    toast: 'Created',
    onSuccess: () => {
      refetch();
      setLog('');
    },
  });
  const onSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    mutation.mutate({
      ...jobIdentity,
      row: log,
    });
  };
  return (
    <>
      <DialogContent className={cls.root}>
        <form aria-disabled={readonly} onSubmit={onSubmit} autoComplete="off">
          <div className={cls.inputRoot}>
            <TextField
              disabled={readonly}
              fullWidth
              value={log}
              onChange={(e) => setLog(e.target.value)}
              required
              id="job-log-input"
              label="Log"
            />
            <Button color="inherit" disabled={readonly} type="submit">
              submit
            </Button>
          </div>
        </form>
        <NetworkRequest status={status} refetch={refetch}>
          <List dense>
            {data?.job?.logs?.logs.map((log, idx) => (
              <ListItem divider={true} disableGutters key={idx}>
                {log &&
                shouldCollapseAgentRunLine(log, queueData?.agent, jobName) ? (
                  <AgentRunLine
                    line={log}
                    jobIdentity={jobIdentity}
                    onOpen={onClose}
                  />
                ) : (
                  <ListItemText primary={log} />
                )}
              </ListItem>
            ))}
          </List>
        </NetworkRequest>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </>
  );
};
export default function JobLogsModal() {
  const [isOpen, onClose] = useJobLogsStore(
    (state) => [state.isOpen, state.close],
    shallow
  );
  return (
    <Dialog open={isOpen} onClose={onClose}>
      <JobLogs />
    </Dialog>
  );
}
