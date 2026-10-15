import React, { memo } from 'react';
import shallow from 'zustand/shallow';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import clsx from 'clsx';
import { useQuery } from 'react-query';
import day from 'dayjs';
import { useNetwork } from '@/hooks/use-network';
import { useQueuesQuery } from '@/hooks/use-queues-query';
import { QueryKeysConfig } from '@/config/query-keys';
import { getPollingInterval } from '@/stores/network-settings';
import { useAgentsStore } from '@/stores/agents';
import NetworkRequest from '@/components/NetworkRequest';
import { AgentRunsFilter, AgentRunsSort } from '@/typings/gql';
import type { GetAgentRunsQuery } from '@/typings/gql';
import { MONO } from './shared';
import { outcomeColor, useAgentColors } from './colors';
import { fmtCost, fmtInt, fmtMs, plural } from './format';
import ToolChain from './ToolChain';

/** Same threshold as the server default for the `slow` filter. */
const SLOW_MS = 15000;

type TItem = NonNullable<GetAgentRunsQuery['agentRuns']>['items'][0];

const FILTERS: Array<{ value: AgentRunsFilter; label: string }> = [
  { value: AgentRunsFilter.All, label: 'All' },
  { value: AgentRunsFilter.Failed, label: 'Failed' },
  { value: AgentRunsFilter.EmptyTool, label: 'Empty tool' },
  { value: AgentRunsFilter.Slow, label: 'Over 15s' },
];
const SORTS: Array<{ value: AgentRunsSort; label: string }> = [
  { value: AgentRunsSort.Recent, label: 'recent' },
  { value: AgentRunsSort.Slowest, label: 'slowest' },
  { value: AgentRunsSort.Costliest, label: 'costliest' },
];

const GRID =
  '92px minmax(110px, 1fr) minmax(160px, 2.6fr) 48px 120px 64px 72px 92px';

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  bar: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1.25, 1.5),
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    padding: theme.spacing(0.5, 1.25),
    borderRadius: 999,
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    userSelect: 'none',
    font: 'inherit',
    backgroundColor: alpha(theme.palette.text.secondary, 0.08),
    border: `1px solid ${theme.palette.divider}`,
    color: theme.palette.text.secondary,
    '&:hover': {
      borderColor: theme.palette.text.disabled,
    },
  },
  pillActive: {
    backgroundColor: alpha(theme.palette.primary.main, 0.16),
    borderColor: theme.palette.primary.main,
    color: theme.palette.primary.main,
    '&:hover': {
      borderColor: theme.palette.primary.main,
    },
  },
  count: {
    fontWeight: 500,
    opacity: 0.8,
    fontFamily: MONO,
  },
  spacer: {
    flex: 1,
  },
  sortLabel: {
    fontSize: 11,
    color: theme.palette.text.secondary,
  },
  sort: {
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    padding: theme.spacing(0.25, 0.5),
    color: theme.palette.text.secondary,
    '&:hover': {
      color: theme.palette.text.primary,
    },
  },
  sortActive: {
    color: theme.palette.primary.main,
    '&:hover': {
      color: theme.palette.primary.main,
    },
  },
  list: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(0.5, 0),
    overflowX: 'auto',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: GRID,
    gap: theme.spacing(1.5),
    alignItems: 'center',
    padding: theme.spacing(1, 2),
    minWidth: 860,
    fontSize: 12,
    borderBottom: `1px solid ${theme.palette.divider}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  head: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: '0.06em',
    color: theme.palette.text.secondary,
  },
  clickable: {
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: -2,
    },
  },
  mono: {
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
  },
  muted: {
    color: theme.palette.text.secondary,
  },
  right: {
    textAlign: 'right',
  },
  job: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    '& > span': {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  },
  sub: {
    fontSize: 10.5,
    color: theme.palette.text.secondary,
  },
  tokens: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  tokenBar: {
    display: 'flex',
    height: 5,
    gap: 1,
    '& > span': {
      borderRadius: 1,
    },
  },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 600,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  empty: {
    padding: theme.spacing(5, 2),
    textAlign: 'center',
    color: theme.palette.text.secondary,
    fontSize: 14,
  },
  more: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    fontSize: 12,
    color: theme.palette.text.secondary,
  },
}));

const formatTime = (ms: number) => {
  const date = day(ms);
  return date.isSame(day(), 'day')
    ? date.format('HH:mm:ss')
    : date.format('MMM D HH:mm');
};

type TProps = {
  queues: string[] | null;
  since: number;
};

function RunsTab({ queues, since }: TProps) {
  const cls = useStyles();
  const colors = useAgentColors();
  // Filter, sort and page live in the store so they survive a trip into a
  // run and back (the tab unmounts while the run is open).
  const [openRun, filter, sort, limit, setFilter, setSort, showMore] =
    useAgentsStore(
      (state) => [
        state.openRun,
        state.runsFilter,
        state.runsSort,
        state.runsLimit,
        state.changeRunsFilter,
        state.changeRunsSort,
        state.showMoreRuns,
      ],
      shallow
    );
  const { data: queuesData } = useQueuesQuery();
  const {
    queries: { getAgentRuns },
  } = useNetwork();
  const args = {
    queues,
    since,
    filter,
    sort,
    slowMs: SLOW_MS,
    offset: 0,
    limit,
  };
  const { status, data, error, refetch } = useQuery(
    [QueryKeysConfig.agentRuns, args],
    () => getAgentRuns(args),
    { refetchInterval: getPollingInterval(), keepPreviousData: true }
  );
  const page = data?.agentRuns;
  const queueName = (id: string) => {
    const queue = queuesData?.queues?.find((q) => q.id === id);
    return queue?.agent?.label || queue?.name || id;
  };
  const maxTokens = Math.max(
    1,
    ...(page?.items ?? []).map((i) => i.inputTokens + i.outputTokens)
  );
  const open = (item: TItem) =>
    openRun(
      {
        queue: item.queue,
        jobId: item.jobId,
        attempt: item.attempt,
        entry: item,
      },
      'runs'
    );

  return (
    <div className={cls.root}>
      <Paper elevation={0} className={cls.bar}>
        {FILTERS.map((f) => (
          <button
            type="button"
            key={f.value}
            className={clsx(cls.pill, filter === f.value && cls.pillActive)}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
            <span className={cls.count}>
              {page ? fmtInt(page.counts[f.value]) : '·'}
            </span>
          </button>
        ))}
        <span className={cls.spacer} />
        <span className={cls.sortLabel}>sort by</span>
        {SORTS.map((s) => (
          <button
            type="button"
            key={s.value}
            className={clsx(cls.sort, sort === s.value && cls.sortActive)}
            aria-pressed={sort === s.value}
            onClick={() => setSort(s.value)}
          >
            {s.label}
          </button>
        ))}
      </Paper>
      <NetworkRequest status={status} error={error} refetch={refetch}>
        <Paper elevation={0} className={cls.list}>
          <div className={`${cls.row} ${cls.head}`}>
            <span>TIME</span>
            <span>JOB</span>
            <span>STEPS AND TOOLS</span>
            <span className={cls.right}>STEPS</span>
            <span>TOKENS IN · OUT</span>
            <span className={cls.right}>DURATION</span>
            <span className={cls.right}>COST</span>
            <span>STATUS</span>
          </div>
          {!page?.items.length && (
            <div className={cls.empty}>No runs match in this window.</div>
          )}
          {page?.items.map((item) => {
            const slow = (item.durationMs ?? 0) >= SLOW_MS;
            const failed = item.outcome === 'error';
            const statusColor = failed
              ? colors.error
              : outcomeColor(item.outcome, colors);
            return (
              <div
                key={`${item.queue}:${item.jobId}:${item.attempt}:${item.finishedAt}`}
                className={`${cls.row} ${cls.clickable}`}
                role="button"
                tabIndex={0}
                onClick={() => open(item)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open(item);
                  }
                }}
              >
                <span className={`${cls.mono} ${cls.muted}`}>
                  {formatTime(item.finishedAt)}
                </span>
                <span className={cls.job}>
                  <span className={cls.mono} title={item.jobId}>
                    {item.jobId}
                    {item.attempt > 1 ? ` #${item.attempt}` : ''}
                  </span>
                  <span className={cls.sub} title={queueName(item.queue)}>
                    {queueName(item.queue)} · {item.jobName}
                  </span>
                </span>
                <ToolChain tools={item.tools} outcome={item.outcome} />
                <span className={`${cls.mono} ${cls.right}`}>{item.steps}</span>
                <span className={cls.tokens}>
                  <span className={cls.tokenBar}>
                    <span
                      style={{
                        width: `${(item.inputTokens / maxTokens) * 100}%`,
                        backgroundColor: colors.tokensIn,
                      }}
                    />
                    <span
                      style={{
                        width: `${(item.outputTokens / maxTokens) * 100}%`,
                        backgroundColor: colors.tokensOut,
                      }}
                    />
                  </span>
                  <span className={`${cls.mono} ${cls.sub}`}>
                    {fmtInt(item.inputTokens)} · {fmtInt(item.outputTokens)}
                  </span>
                </span>
                <span
                  className={`${cls.mono} ${cls.right}`}
                  style={{ color: slow ? colors.warning : undefined }}
                >
                  {fmtMs(item.durationMs)}
                </span>
                <span
                  className={`${cls.mono} ${cls.right}`}
                  style={{
                    color: item.cost === null ? colors.muted : undefined,
                  }}
                >
                  {fmtCost(item.cost)}
                </span>
                <span
                  className={cls.status}
                  style={{ color: statusColor }}
                  title={item.error ?? item.outcome}
                >
                  <span
                    className={cls.dot}
                    style={{ backgroundColor: statusColor }}
                  />
                  {failed ? 'failed' : 'completed'}
                </span>
              </div>
            );
          })}
        </Paper>
        {!!page && page.items.length > 0 && (
          <div className={cls.more}>
            <span>
              {fmtInt(page.items.length)} of {plural(page.total, 'run')}
            </span>
            {page.total > page.items.length && (
              <Button size="small" onClick={showMore}>
                Show more
              </Button>
            )}
          </div>
        )}
      </NetworkRequest>
    </div>
  );
}

export default memo(RunsTab);
