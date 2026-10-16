import React from 'react';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import OpenIcon from '@mui/icons-material/OpenInNew';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import { MONO } from '../agents/shared';
import type { TFlowsLayout } from '@/stores/flows';
import { useFlowColors } from './colors';

export const useFlowPartStyles = makeStyles((theme) => ({
  spark: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 2,
    height: 36,
  },
  sparkBar: {
    flex: 1,
    minWidth: 2,
    borderRadius: 1,
  },
  tag: {
    fontFamily: MONO,
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: '0.06em',
    padding: '1px 5px',
    borderRadius: 3,
    whiteSpace: 'nowrap',
    flex: 'none',
  },
  errors: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 4,
    background: 'none',
    color: 'inherit',
    font: 'inherit',
    fontSize: 12,
    textAlign: 'left',
    cursor: 'pointer',
    width: '100%',
    '&:hover, &:focus-visible': {
      borderColor: alpha(theme.palette.error.main, 0.5),
      backgroundColor: alpha(theme.palette.error.main, 0.05),
    },
    '& svg': {
      fontSize: 13,
      color: theme.palette.text.secondary,
      flex: 'none',
    },
  },
  errorMsg: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  errorCount: {
    fontFamily: MONO,
    fontSize: 11,
  },
  muted: {
    fontSize: 12,
    color: theme.palette.text.secondary,
  },
  label: {
    fontSize: 11,
    color: theme.palette.text.secondary,
  },
  json: {
    margin: 0,
    padding: theme.spacing(1, 1.25),
    borderRadius: 4,
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: alpha(theme.palette.text.primary, 0.03),
    fontFamily: MONO,
    fontSize: 11.5,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflow: 'auto',
    maxHeight: 260,
  },
  toggle: {
    '& .MuiToggleButton-root': {
      border: `1px solid ${theme.palette.divider}`,
      padding: theme.spacing(0.25, 1.25),
      fontSize: 12,
      lineHeight: 1.6,
      textTransform: 'none',
      color: theme.palette.text.secondary,
      gap: theme.spacing(0.5),
    },
    '& .MuiToggleButton-root.Mui-selected': {
      color: theme.palette.text.primary,
      backgroundColor: theme.palette.action.selected,
    },
    '& svg': {
      fontSize: 15,
    },
  },
}));

/** Completed jobs per bucket; the recent stretch tinted when it lags. */
export function Sparkline({
  values,
  alert,
}: {
  values: number[];
  alert?: boolean;
}) {
  const cls = useFlowPartStyles();
  const colors = useFlowColors();
  const max = Math.max(1, ...values);
  return (
    <div className={cls.spark} aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className={cls.sparkBar}
          style={{
            height: `${Math.max(4, (v / max) * 100)}%`,
            backgroundColor:
              alert && i > (values.length * 2) / 3
                ? colors.warning
                : alpha(colors.completed, 0.8),
          }}
        />
      ))}
    </div>
  );
}

export type TTag = 'bottleneck' | 'fallback' | 'onError' | 'failed' | 'pending';
const TAG_LABEL: Record<TTag, string> = {
  bottleneck: 'BOTTLENECK',
  fallback: 'FALLBACK',
  onError: 'ON ERROR',
  failed: 'FAILED',
  pending: 'PENDING',
};

export function StepTag({ tag }: { tag: TTag }) {
  const cls = useFlowPartStyles();
  const colors = useFlowColors();
  const color = {
    bottleneck: colors.warning,
    fallback: colors.fallback,
    onError: colors.failed,
    failed: colors.failed,
    pending: colors.active,
  }[tag];
  return (
    <span
      className={cls.tag}
      style={{ color, backgroundColor: alpha(color, 0.16) }}
    >
      {TAG_LABEL[tag]}
    </span>
  );
}

export type TStepErrorItem = {
  message: string;
  count: number;
  lastJobId?: string | null;
};

/** Recent errors grouped by message; each opens the failed jobs of the queue. */
export function RecentErrors({
  errors,
  onOpen,
}: {
  errors: TStepErrorItem[];
  onOpen: (error: TStepErrorItem) => void;
}) {
  const cls = useFlowPartStyles();
  if (!errors.length) {
    return <span className={cls.muted}>No errors in this window.</span>;
  }
  return (
    <div className={cls.errors}>
      {errors.map((error) => (
        <button
          type="button"
          key={error.message}
          className={cls.error}
          onClick={() => onOpen(error)}
          title={error.message}
        >
          <span className={cls.errorMsg}>{error.message}</span>
          <span className={cls.errorCount}>{error.count}</span>
          <OpenIcon />
        </button>
      ))}
    </div>
  );
}

/** Plain-text JSON (job values are never rendered as HTML). */
export function JsonBlock({
  value,
  label,
}: {
  value: unknown;
  label?: string;
}) {
  const cls = useFlowPartStyles();
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre className={cls.json} aria-label={label}>
      {text}
    </pre>
  );
}

export function LayoutToggle({
  value,
  onChange,
  options,
}: {
  value: TFlowsLayout;
  onChange: (value: TFlowsLayout) => void;
  options: Array<{ value: TFlowsLayout; label: string; icon: React.ReactNode }>;
}) {
  const cls = useFlowPartStyles();
  return (
    <ToggleButtonGroup
      className={cls.toggle}
      size="small"
      exclusive
      value={value}
      onChange={(_e, next) => {
        if (next) onChange(next);
      }}
    >
      {options.map((o) => (
        <ToggleButton key={o.value} value={o.value} aria-label={o.label}>
          {o.icon} {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
