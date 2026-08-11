import React from 'react';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import makeStyles from '@mui/styles/makeStyles';
import { TIME_RANGES } from './time-range';
import type { TTimeRange } from './time-range';

const useStyles = makeStyles((theme) => ({
  group: {
    '& .MuiToggleButton-root': {
      border: `1px solid ${theme.palette.divider}`,
      padding: theme.spacing(0.25, 1.25),
      fontSize: 12,
      lineHeight: 1.6,
      textTransform: 'none',
      color: theme.palette.text.secondary,
    },
    '& .MuiToggleButton-root.Mui-selected': {
      color: theme.palette.text.primary,
      backgroundColor: theme.palette.action.selected,
    },
  },
}));

type TProps = {
  value: TTimeRange;
  onChange: (range: TTimeRange) => void;
};

export default function TimeRangePicker({ value, onChange }: TProps) {
  const cls = useStyles();
  return (
    <ToggleButtonGroup
      className={cls.group}
      size="small"
      exclusive
      value={value.label}
      onChange={(_e, label) => {
        // `null` when the active button is clicked again — keep the current
        // range instead of leaving the chart without one.
        if (!label) return;
        const next = TIME_RANGES.find((range) => range.label === label);
        if (next) onChange(next);
      }}
    >
      {TIME_RANGES.map((range) => (
        <ToggleButton
          key={range.label}
          value={range.label}
          aria-label={`last ${range.label}`}
        >
          {range.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
