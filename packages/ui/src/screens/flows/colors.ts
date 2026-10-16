import { useMemo } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { useJobStatusesPalette } from '@/components/JobStatusChip/hooks';
import { JobStatus } from '@/typings/gql';
import type { TTraceJobKind } from './model';

/**
 * Semantic colors of the Flows screen, from the app theme and the shared
 * status palette (never the design file's hex), so both themes and every
 * accent work.
 */
export const useFlowColors = () => {
  const theme = useTheme();
  const status = useJobStatusesPalette();
  return useMemo(
    () => ({
      waiting: status[JobStatus.Waiting],
      active: status[JobStatus.Active],
      completed: status[JobStatus.Completed],
      failed: status[JobStatus.Failed],
      delayed: status[JobStatus.Delayed],
      accent: theme.palette.primary.main,
      warning: theme.palette.warning.main,
      // Fallback branches: the same violet as waiting, read as "the other way".
      fallback: status[JobStatus.Waiting],
      edge: alpha(theme.palette.text.primary, 0.35),
      edgeMuted: alpha(theme.palette.text.primary, 0.12),
      muted: theme.palette.text.secondary,
      waitBar: alpha(theme.palette.text.primary, 0.3),
    }),
    [theme, status]
  );
};

export type TFlowColors = ReturnType<typeof useFlowColors>;

export const traceKindColor = (kind: TTraceJobKind, colors: TFlowColors) => {
  switch (kind) {
    case 'failed':
      return colors.failed;
    case 'fallback':
      return colors.fallback;
    case 'error':
      return colors.warning;
    case 'pending':
      return colors.active;
    default:
      return colors.completed;
  }
};
