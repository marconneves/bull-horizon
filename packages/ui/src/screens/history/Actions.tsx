import React from 'react';
import Button from '@mui/material/Button';
import makeStyles from '@mui/styles/makeStyles';
import { useAtomValue } from 'jotai/utils';
import { activeQueueAtom } from '@/atoms/workspaces';
import { useAbstractMutation } from '@/hooks/use-abstract-mutation';
import { useNetwork } from '@/hooks/use-network';
import { useQueryClient } from 'react-query';
import { QueryKeysConfig } from '@/config/query-keys';
import { useQueueData } from '@/hooks/use-queue-data';

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    gap: theme.spacing(0.5),
  },
}));

/**
 * The only UI for the clear-metrics mutations. It used to sit on the per-queue
 * metrics screen; when that screen was removed these moved here rather than
 * leaving the mutations unreachable.
 */
const MetricsActions = () => {
  const {
    mutations: { clearMetrics, clearAllMetrics },
  } = useNetwork();
  const queryClient = useQueryClient();
  const queue = useAtomValue(activeQueueAtom) as string;
  const readonly = !!useQueueData(queue)?.readonly;
  const invalidate = () => {
    queryClient.invalidateQueries(QueryKeysConfig.metricsSummary);
    queryClient.invalidateQueries(QueryKeysConfig.throughput);
  };
  const clearMetricsMutation = useAbstractMutation({
    mutation: clearMetrics,
    toast: 'Cleared',
    confirm: {
      description: 'Clear metrics of the active queue',
    },
    onSuccess: invalidate,
  });
  const clearAllMetricsMutation = useAbstractMutation({
    mutation: clearAllMetrics,
    toast: 'Cleared',
    confirm: {
      description: 'Clear metrics of every queue',
    },
    onSuccess: invalidate,
  });
  const cls = useStyles();
  return (
    <div className={cls.root}>
      <Button
        size="small"
        disabled={readonly || !queue}
        onClick={() => clearMetricsMutation.mutate({ queue })}
        color="secondary"
      >
        Clear active queue
      </Button>
      <Button
        size="small"
        disabled={readonly}
        onClick={() => clearAllMetricsMutation.mutate(null)}
        color="secondary"
      >
        Clear all
      </Button>
    </div>
  );
};

export default MetricsActions;
