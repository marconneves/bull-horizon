import React, { memo, useMemo } from 'react';
import Tooltip from '@mui/material/Tooltip';
import makeStyles from '@mui/styles/makeStyles';
import { alpha, useTheme } from '@mui/material/styles';
import { Card, Legend, MONO } from '../shared';
import { useAgentColors } from '../colors';
import type { TAgentColors } from '../colors';
import { fmtCost, fmtInt, fmtMs } from '../format';
import { runSplits } from '../model';
import type { TRun, TSplitKind, TSplitSegment } from '../model';

const useStyles = makeStyles((theme) => ({
  row: {
    display: 'grid',
    gridTemplateColumns: '64px minmax(0, 1fr)',
    gap: theme.spacing(1.5),
    alignItems: 'center',
  },
  label: {
    fontSize: 11,
    color: theme.palette.text.secondary,
  },
  bar: {
    display: 'flex',
    height: 22,
    gap: 2,
    minWidth: 0,
  },
  seg: {
    minWidth: 3,
    borderRadius: 2,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    fontFamily: MONO,
    fontSize: 10,
    lineHeight: '22px',
    padding: '0 4px',
    boxSizing: 'border-box',
  },
  noPrice: {
    fontFamily: MONO,
    fontSize: 11,
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
  },
  legend: {
    paddingLeft: 64 + 12,
  },
}));

const colorOf = (kind: TSplitKind, colors: TAgentColors) => {
  switch (kind) {
    case 'llm':
      return colors.llm;
    case 'tool':
      return colors.tool;
    case 'overhead':
      return colors.overhead;
    case 'in':
      return colors.tokensIn;
    case 'out':
      return colors.tokensOut;
    case 'cost':
      return colors.cost;
  }
};

function SplitBar({
  segments,
  colors,
}: {
  segments: TSplitSegment[];
  colors: TAgentColors;
}) {
  const cls = useStyles();
  const theme = useTheme();
  // Normalised: flex-grow values summing below 1 would leave the bar part
  // empty (costs are fractions of a cent).
  const total = segments.reduce((acc, seg) => acc + Math.max(seg.value, 0), 0);
  return (
    <div className={cls.bar}>
      {segments.map((seg) => {
        const color = colorOf(seg.kind, colors);
        const neutral = seg.kind === 'cost' || seg.kind === 'overhead';
        return (
          <Tooltip title={seg.title} key={seg.key}>
            <div
              className={cls.seg}
              style={{
                flexGrow: total ? Math.max(seg.value, 0) / total : 1,
                flexBasis: 0,
                // `alpha()` would override the translucency the neutral
                // colors (cost, overhead) already carry, so they go as-is.
                backgroundColor: neutral ? color : alpha(color, 0.85),
                color: neutral
                  ? theme.palette.text.primary
                  : theme.palette.getContrastText(color),
              }}
            >
              {seg.label}
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function RunSplits({ run }: { run: TRun }) {
  const cls = useStyles();
  const colors = useAgentColors();
  const splits = useMemo(() => runSplits(run), [run]);
  return (
    <Card
      title="Where the time and the tokens went"
      aside={`${fmtMs(run.durationMs)} · ${fmtInt(
        run.inputTokens + run.outputTokens
      )} tokens`}
    >
      <div className={cls.row}>
        <span className={cls.label}>Time</span>
        <SplitBar segments={splits.time} colors={colors} />
      </div>
      <div className={cls.row}>
        <span className={cls.label}>Tokens</span>
        <SplitBar segments={splits.tokens} colors={colors} />
      </div>
      <div className={cls.row}>
        <span className={cls.label}>Cost</span>
        {splits.cost ? (
          <SplitBar segments={splits.cost} colors={colors} />
        ) : (
          <span className={cls.noPrice}>
            no price for {run.model} in the setup
          </span>
        )}
      </div>
      <div className={cls.legend}>
        <Legend
          items={[
            { label: 'LLM', color: colors.llm },
            { label: 'tool', color: colors.tool },
            { label: 'overhead', color: colors.overhead },
            { label: 'tokens in', color: colors.tokensIn },
            { label: 'tokens out', color: colors.tokensOut },
            ...(splits.cost
              ? [{ label: `cost (${fmtCost(run.cost)})`, color: colors.cost }]
              : []),
          ]}
        />
      </div>
    </Card>
  );
}

export default memo(RunSplits);
