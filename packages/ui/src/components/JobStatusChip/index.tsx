import React from 'react';
import Chip from '@mui/material/Chip';
import type { JobStatus } from '@/typings/gql';
import isUndefined from 'lodash/isUndefined';
import { useJobStatusColor } from './hooks';
import { getStatusPillColors } from './style-utils';

type TProps = {
  status: JobStatus;
  label?: string | number;
  className?: string;
  size?: 'medium' | 'small';
};

export default function JobStatusChip(props: TProps) {
  const color = useJobStatusColor(props.status);
  // "small" is used for the sidebar's per-queue counters, packed tightly
  // side by side — a solid fill reads at a glance there. The tinted pill
  // (used at default size, e.g. the job list) has room to be softer.
  const isSmall = props.size === 'small';
  const { background, border, text } = isSmall
    ? { background: color, border: color, text: '#fff' }
    : getStatusPillColors(color);
  return (
    <Chip
      style={{
        color: text,
        backgroundColor: background,
        border: `1px solid ${border}`,
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 600,
      }}
      icon={
        isSmall ? undefined : (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: color,
            }}
          />
        )
      }
      size={props.size}
      className={props.className}
      label={isUndefined(props.label) ? props.status : props.label}
    />
  );
}
