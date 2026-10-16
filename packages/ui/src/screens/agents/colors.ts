import { useMemo } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { useJobStatusesPalette } from '@/components/JobStatusChip/hooks';
import { JobStatus } from '@/typings/gql';

/**
 * Semantic colors of the agents screens, all derived from the app theme and
 * the shared status palette — never from the design file's hex values — so
 * both themes and every selectable accent work.
 */
export const useAgentColors = () => {
  const theme = useTheme();
  const status = useJobStatusesPalette();
  return useMemo(
    () => ({
      request: theme.palette.primary.main,
      llm: status[JobStatus.Waiting],
      tool: status[JobStatus.Active],
      response: status[JobStatus.Completed],
      tokensIn: theme.palette.primary.main,
      tokensOut: status[JobStatus.Completed],
      ok: status[JobStatus.Completed],
      error: status[JobStatus.Failed],
      warning: theme.palette.warning.main,
      overhead: theme.palette.text.disabled,
      // Neutral and light enough to carry a label in both themes.
      cost: alpha(theme.palette.text.primary, 0.4),
      muted: theme.palette.text.secondary,
    }),
    [theme, status]
  );
};

export type TAgentColors = ReturnType<typeof useAgentColors>;

export const outcomeColor = (outcome: string, colors: TAgentColors) => {
  switch (outcome) {
    case 'stop':
      return colors.ok;
    case 'error':
      return colors.error;
    case 'max-steps':
    case 'content-filter':
      return colors.warning;
    case 'length':
      return colors.llm;
    default:
      return colors.overhead;
  }
};
