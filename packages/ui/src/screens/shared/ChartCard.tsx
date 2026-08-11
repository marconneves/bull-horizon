import React from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import makeStyles from '@mui/styles/makeStyles';

const useStyles = makeStyles((theme) => ({
  root: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(2),
    flexWrap: 'wrap',
  },
  title: {
    fontWeight: 600,
  },
  hint: {
    color: theme.palette.text.secondary,
    fontSize: 13,
  },
  body: {
    flex: 1,
    minHeight: 240,
    width: '100%',
  },
}));

type TProps = {
  title: string;
  /** Short clarification of what the numbers mean, when the title can't carry it. */
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * The card shell the throughput chart established. Extracted so the older
 * per-queue charts read as part of the same dashboard instead of as a screen
 * from a different era.
 */
export default function ChartCard({ title, hint, action, children }: TProps) {
  const cls = useStyles();
  return (
    <Paper className={cls.root} elevation={0}>
      <div className={cls.header}>
        <Typography className={cls.title} variant="subtitle1">
          {title}
        </Typography>
        {hint && <span className={cls.hint}>{hint}</span>}
        {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
      </div>
      <div className={cls.body}>{children}</div>
    </Paper>
  );
}
