import React from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import makeStyles from '@mui/styles/makeStyles';
import clsx from 'clsx';
import { alpha } from '@mui/material/styles';
import WarningIcon from '@mui/icons-material/WarningAmberOutlined';
import { unrecordedMessage } from './format';

export const MONO = '"IBM Plex Mono", ui-monospace, monospace';

const useStyles = makeStyles((theme) => ({
  kpis: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: theme.spacing(1),
  },
  kpi: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1.25, 1.5),
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  kpiLabel: {
    fontSize: 11,
    color: theme.palette.text.secondary,
  },
  kpiValue: {
    fontSize: 19,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontVariantNumeric: 'tabular-nums',
  },
  kpiSub: {
    fontFamily: MONO,
    fontSize: 10.5,
    color: theme.palette.text.secondary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  card: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1.75),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    minWidth: 0,
  },
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
  },
  cardAside: {
    fontFamily: MONO,
    fontSize: 11,
    color: theme.palette.text.secondary,
  },
  swatch: {
    display: 'inline-block',
    width: 12,
    height: 8,
    borderRadius: 2,
    flexShrink: 0,
  },
  unrecorded: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1.25, 1.5),
    fontSize: 13,
    lineHeight: 1.5,
    textAlign: 'left',
    color: theme.palette.text.primary,
    border: `1px solid ${alpha(theme.palette.warning.main, 0.5)}`,
    backgroundColor: alpha(theme.palette.warning.main, 0.08),
    '& svg': {
      fontSize: 18,
      color: theme.palette.warning.main,
      flex: 'none',
      marginTop: 1,
    },
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    fontSize: 11,
    color: theme.palette.text.secondary,
    '& > span': {
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
    },
  },
}));

export type TKpi = {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  title?: string;
};

export function Kpis({ items }: { items: TKpi[] }) {
  const cls = useStyles();
  return (
    <section className={cls.kpis}>
      {items.map((kpi) => (
        <Paper elevation={0} className={cls.kpi} key={kpi.label}>
          <span className={cls.kpiLabel}>{kpi.label}</span>
          <span
            className={cls.kpiValue}
            style={{ color: kpi.color }}
            title={kpi.title ?? kpi.value}
          >
            {kpi.value}
          </span>
          {kpi.sub && (
            <span className={cls.kpiSub} title={kpi.sub}>
              {kpi.sub}
            </span>
          )}
        </Paper>
      ))}
    </section>
  );
}

type TCardProps = {
  title: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export function Card({ title, aside, className, children }: TCardProps) {
  const cls = useStyles();
  return (
    <Paper elevation={0} className={clsx(cls.card, className)}>
      <div className={cls.cardHead}>
        <Typography className={cls.cardTitle} component="h3">
          {title}
        </Typography>
        {aside && <span className={cls.cardAside}>{aside}</span>}
      </div>
      {children}
    </Paper>
  );
}

export function Legend({
  items,
}: {
  items: Array<{ label: string; color: string }>;
}) {
  const cls = useStyles();
  return (
    <div className={cls.legend}>
      {items.map((item) => (
        <span key={item.label}>
          <span className={cls.swatch} style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Agent jobs that finished with neither a run log line nor an AgentRunV1
 * return value: usually a worker without the helper. Shown wherever runs
 * would be, so an empty screen does not read as "no traffic".
 */
export function UnrecordedNotice({ count }: { count: number }) {
  const cls = useStyles();
  if (count <= 0) return null;
  return (
    <div className={cls.unrecorded} role="status">
      <WarningIcon />
      <span>{unrecordedMessage(count)}</span>
    </div>
  );
}
