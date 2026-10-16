import React, { memo } from 'react';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CopyIcon from '@mui/icons-material/ContentCopy';
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined';
import OkIcon from '@mui/icons-material/CheckCircleOutline';
import WarnIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/ErrorOutline';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import { FlowCheckLevel } from '@/typings/gql';
import { MONO } from '../agents/shared';
import { useFlowColors } from './colors';
import type { TFlowColors } from './colors';
import type { TFlow } from './model';
import { JsonBlock, useFlowPartStyles } from './parts';

const useStyles = makeStyles((theme) => ({
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.3fr) minmax(300px, 1fr)',
    gap: theme.spacing(1),
    alignItems: 'start',
    [theme.breakpoints.down('lg')]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  card: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1.5),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.25),
    minWidth: 0,
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontSize: 13,
    fontWeight: 600,
    '& > svg': {
      fontSize: 17,
      color: theme.palette.text.secondary,
    },
  },
  readonly: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: '0.06em',
    padding: '1px 6px',
    borderRadius: 3,
    color: theme.palette.text.secondary,
    border: `1px solid ${theme.palette.divider}`,
  },
  spacer: {
    flex: 1,
  },
  code: {
    margin: 0,
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 1.65,
    overflow: 'auto',
    borderRadius: 4,
    backgroundColor: alpha(theme.palette.text.primary, 0.03),
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1, 0),
  },
  line: {
    display: 'flex',
    whiteSpace: 'pre',
  },
  lineNo: {
    width: 40,
    flex: 'none',
    textAlign: 'right',
    paddingRight: theme.spacing(1.5),
    color: theme.palette.text.disabled,
    userSelect: 'none',
  },
  key: {
    color: theme.palette.primary.main,
  },
  text: {
    fontSize: 12.5,
    lineHeight: 1.55,
    color: theme.palette.text.secondary,
    '& code': {
      fontFamily: MONO,
      fontSize: '0.92em',
      color: theme.palette.text.primary,
    },
  },
  snippet: {
    fontFamily: MONO,
    fontSize: 12,
    padding: theme.spacing(1, 1.25),
    borderRadius: 4,
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: alpha(theme.palette.primary.main, 0.05),
    whiteSpace: 'pre-wrap',
  },
  check: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1),
    borderRadius: 4,
    fontSize: 12.5,
    lineHeight: 1.45,
    '& svg': {
      fontSize: 17,
      flex: 'none',
      marginTop: 1,
    },
  },
}));

/** One YAML line: the key in the accent color, the rest as is. Plain text. */
const YamlLine = ({
  text,
  cls,
}: {
  text: string;
  cls: ReturnType<typeof useStyles>;
}) => {
  // The key ends at the first colon followed by a space or the line end, so
  // `content:Step:` is one key. One span: the line is a flex row, and loose
  // whitespace text would collapse there.
  const match = /^(\s*(?:- )?)(\S.*?:)(?=\s|$)(.*)$/.exec(text);
  if (!match) return <span>{text}</span>;
  return (
    <span>
      {match[1]}
      <span className={cls.key}>{match[2]}</span>
      {match[3]}
    </span>
  );
};

const checkStyle = (level: FlowCheckLevel, colors: TFlowColors) => {
  const color =
    level === FlowCheckLevel.Error
      ? colors.failed
      : level === FlowCheckLevel.Warn
      ? colors.warning
      : colors.completed;
  const Icon =
    level === FlowCheckLevel.Error
      ? ErrorIcon
      : level === FlowCheckLevel.Warn
      ? WarnIcon
      : OkIcon;
  return { color, Icon };
};

const TRACE_EXAMPLE = {
  videoId: '7428801239912',
  _trace: {
    v: 1,
    traceId: 'tr_9f2c41e7b0a1d3c5',
    flow: 'content-ingest',
    key: '7428801239912',
    startedAt: 1792087318200,
    parent: { queue: 'content:SelectCategory', jobId: '88213' },
    hop: 7,
  },
};

type TProps = {
  flow: TFlow;
  /** With the collector, the window's checks (coverage, lost, edges) join in. */
  collector: boolean;
  since: number;
};

/** The flow's definition as the monitor read it, the trace contract, the checks. */
function ConfigTab({ flow, collector, since }: TProps) {
  const cls = useStyles();
  const parts = useFlowPartStyles();
  const colors = useFlowColors();
  const {
    queries: { getFlowSummary },
  } = useNetwork();
  const args = { flow: flow.id, since };
  const { data } = useQuery(
    [QueryKeysConfig.flowSummary, args],
    () => getFlowSummary(args),
    { enabled: collector, staleTime: 30_000 }
  );
  const checks = [...flow.checks, ...(data?.flowSummary?.checks ?? [])];
  const lines = flow.definition.replace(/\n$/, '').split('\n');
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(flow.definition);
    } catch (_e) {
      // Clipboard blocked (insecure origin): the text stays selectable.
    }
  };
  return (
    <div className={cls.layout}>
      <Paper elevation={0} className={cls.card}>
        <div className={cls.head}>
          <DescriptionIcon />
          <span>Flow definition</span>
          <span className={cls.readonly}>READ ONLY</span>
          <span className={cls.spacer} />
          <Tooltip title="Copy">
            <IconButton
              size="small"
              onClick={copy}
              aria-label="copy definition"
            >
              <CopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
        <span className={parts.muted}>
          Declared in the monitor setup (<code>flows</code>), shown as YAML.
          Change it in code; the panel only reads it.
        </span>
        <pre className={cls.code} aria-label="flow definition">
          {lines.map((line, i) => (
            <div className={cls.line} key={i}>
              <span className={cls.lineNo}>{i + 1}</span>
              <YamlLine text={line} cls={cls} />
            </div>
          ))}
        </pre>
      </Paper>
      <div className={cls.card} style={{ border: 'none', padding: 0 }}>
        <Paper elevation={0} className={cls.card}>
          <div className={cls.head}>
            <span>Trace convention</span>
          </div>
          <span className={cls.text}>
            Every job of the flow carries <code>data._trace</code>. The entry
            opens it with <code>startTrace</code>; each worker enqueues the next
            step with <code>withTrace(job, data)</code>, which copies the trace
            id and records the parent job. It is written once, at enqueue, and
            never rewritten.
          </span>
          <JsonBlock value={TRACE_EXAMPLE} label="trace example" />
          <div className={cls.snippet}>
            {'await next.add(name, withTrace(job, { videoId }))'}
          </div>
        </Paper>
        <Paper elevation={0} className={cls.card}>
          <div className={cls.head}>
            <span>Config checks</span>
          </div>
          {checks.length ? (
            checks.map((check, i) => {
              const { color, Icon } = checkStyle(check.level, colors);
              return (
                <div
                  key={`${check.code}-${i}`}
                  className={cls.check}
                  style={{ backgroundColor: alpha(color, 0.07) }}
                >
                  <Icon style={{ color }} />
                  <span>{check.message}</span>
                </div>
              );
            })
          ) : (
            <span className={parts.muted}>No findings.</span>
          )}
          {!collector && (
            <span className={parts.muted}>
              Coverage and observed-edge checks need the metrics collector.
            </span>
          )}
        </Paper>
      </div>
    </div>
  );
}

export default memo(ConfigTab);
