import React, { memo, useEffect, useMemo } from 'react';
import Paper from '@mui/material/Paper';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import BackIcon from '@mui/icons-material/ArrowBack';
import ChatIcon from '@mui/icons-material/ChatBubbleOutline';
import ListIcon from '@mui/icons-material/ViewList';
import OpenIcon from '@mui/icons-material/OpenInNew';
import AssistantIcon from '@mui/icons-material/SmartToyOutlined';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import clsx from 'clsx';
import shallow from 'zustand/shallow';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { useQueueData } from '@/hooks/use-queue-data';
import { QueryKeysConfig } from '@/config/query-keys';
import { getPollingInterval } from '@/stores/network-settings';
import { useAgentsStore } from '@/stores/agents';
import type { TAgentConversationRef } from '@/stores/agents';
import NetworkRequest from '@/components/NetworkRequest';
import SafeMarkdown from '@/components/SafeMarkdown';
import { Card, Kpis, MONO } from '../shared';
import type { TKpi } from '../shared';
import { outcomeColor, useAgentColors } from '../colors';
import type { TAgentColors } from '../colors';
import { fmtClock, fmtCost, fmtInt, fmtMs, plural } from '../format';
import ToolChain from '../ToolChain';
import {
  conversationTimeline,
  messageFlow,
  messageMeta,
  messageStart,
  messageToolLinks,
  pickMessage,
  replyText,
  userText,
} from '../conversation-model';
import type {
  TConversation,
  TFlowRow,
  TMessage,
  TMessageText,
} from '../conversation-model';

const clock = (ms: number) => fmtClock(new Date(ms).toISOString(), false);

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  header: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1.25, 1.5),
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(1.5),
  },
  ident: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    flex: 1,
  },
  kicker: {
    fontSize: 10,
    letterSpacing: '0.06em',
    color: theme.palette.text.secondary,
  },
  convId: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sub: {
    fontFamily: MONO,
    fontSize: 11,
    color: theme.palette.text.secondary,
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
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 320px',
    gap: theme.spacing(1),
    alignItems: 'start',
    [theme.breakpoints.down('lg')]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  aside: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    minWidth: 0,
  },
  empty: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(4, 2),
    textAlign: 'center',
    color: theme.palette.text.secondary,
    fontSize: 14,
  },
  // Chat ---------------------------------------------------------------
  chat: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(3),
    minWidth: 0,
  },
  turn: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  bubble: {
    borderRadius: 10,
    padding: theme.spacing(1.25, 1.5),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    minWidth: 0,
  },
  user: {
    alignSelf: 'flex-end',
    maxWidth: '75%',
    borderBottomRightRadius: 2,
    backgroundColor: alpha(theme.palette.text.primary, 0.07),
  },
  reply: {
    border: `1px solid ${theme.palette.divider}`,
    borderBottomLeftRadius: 2,
    backgroundColor: alpha(theme.palette.text.primary, 0.03),
  },
  assistant: {
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-start',
    maxWidth: '85%',
  },
  avatar: {
    flex: 'none',
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.palette.primary.main,
    backgroundColor: alpha(theme.palette.primary.main, 0.14),
    '& svg': {
      fontSize: 16,
    },
  },
  assistantBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    minWidth: 0,
    flex: 1,
  },
  strip: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.25),
    padding: theme.spacing(0.75, 1.25),
    border: `1px dashed ${theme.palette.divider}`,
    borderRadius: 6,
    minWidth: 0,
    width: '100%',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    background: 'none',
  },
  stripButton: {
    cursor: 'pointer',
    '&:hover, &:focus-visible': {
      borderColor: alpha(theme.palette.primary.main, 0.6),
      backgroundColor: alpha(theme.palette.primary.main, 0.05),
    },
  },
  stripFrom: {
    borderStyle: 'solid',
    borderColor: alpha(theme.palette.primary.main, 0.5),
    backgroundColor: alpha(theme.palette.primary.main, 0.06),
  },
  stripJob: {
    fontFamily: MONO,
    fontSize: 11.5,
    flex: 'none',
  },
  stripChain: {
    flex: 1,
    minWidth: 0,
  },
  stripMeta: {
    fontFamily: MONO,
    fontSize: 10.5,
    color: theme.palette.text.secondary,
    whiteSpace: 'nowrap',
    [theme.breakpoints.down('md')]: {
      display: 'none',
    },
  },
  stripIcon: {
    fontSize: '15px !important',
    color: theme.palette.text.secondary,
    flex: 'none',
  },
  removedChip: {
    fontFamily: MONO,
    fontSize: 10.5,
    height: 20,
  },
  muted: {
    fontSize: 12,
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
  },
  error: {
    fontFamily: MONO,
    fontSize: 12,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  card: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    padding: theme.spacing(1, 1.25),
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    alignSelf: 'flex-start',
    minWidth: 200,
  },
  cardType: {
    fontSize: 10,
    letterSpacing: '0.06em',
    color: theme.palette.text.secondary,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 600,
  },
  // List ---------------------------------------------------------------
  list: {
    display: 'grid',
    gridTemplateColumns: 'minmax(240px, 340px) minmax(0, 1fr)',
    gap: theme.spacing(1),
    alignItems: 'start',
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  rows: {
    border: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  row: {
    display: 'flex',
    gap: theme.spacing(1.25),
    padding: theme.spacing(1.25, 1.5),
    borderLeft: '2px solid transparent',
    borderBottom: `1px solid ${theme.palette.divider}`,
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    background: 'none',
    borderTop: 'none',
    borderRight: 'none',
    width: '100%',
    '&:last-child': {
      borderBottom: 'none',
    },
    '&:hover, &:focus-visible': {
      backgroundColor: alpha(theme.palette.text.primary, 0.04),
    },
  },
  rowSelected: {
    borderLeftColor: theme.palette.primary.main,
    backgroundColor: alpha(theme.palette.primary.main, 0.07),
  },
  rowN: {
    fontFamily: MONO,
    fontSize: 11,
    color: theme.palette.text.secondary,
    paddingTop: 1,
  },
  rowBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minWidth: 0,
    flex: 1,
  },
  clamp: {
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    '& p': {
      margin: 0,
    },
  },
  rowUser: {
    fontSize: 13,
  },
  rowReply: {
    fontSize: 12,
    color: theme.palette.text.secondary,
    '& *': {
      fontSize: '12px !important',
    },
  },
  rowMeta: {
    fontFamily: MONO,
    fontSize: 10.5,
    color: theme.palette.text.secondary,
  },
  detail: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1.75),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    minWidth: 0,
  },
  detailHead: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  },
  detailJob: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
  },
  metrics: {
    display: 'grid',
    // Six cells: 3 x 2, or 2 x 3 when narrow, never a gap in the grid.
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    gap: 1,
    backgroundColor: theme.palette.divider,
    border: `1px solid ${theme.palette.divider}`,
  },
  metric: {
    backgroundColor: theme.palette.background.paper,
    padding: theme.spacing(1, 1.25),
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  metricLabel: {
    fontSize: 10,
    color: theme.palette.text.secondary,
  },
  metricValue: {
    fontFamily: MONO,
    fontSize: 12.5,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  flow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  flowRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.4fr) 92px minmax(60px, 1fr) 56px',
    alignItems: 'center',
    gap: theme.spacing(1.25),
    padding: theme.spacing(0.75, 1),
    borderRadius: 4,
  },
  flowTool: {
    paddingLeft: theme.spacing(4.5),
  },
  flowName: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    minWidth: 0,
  },
  flowDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    flex: 'none',
  },
  flowText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  flowTitle: {
    fontFamily: MONO,
    fontSize: 12,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  flowSub: {
    fontSize: 11,
    color: theme.palette.text.secondary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  flowNum: {
    fontFamily: MONO,
    fontSize: 11,
    color: theme.palette.text.secondary,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  flowTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: alpha(theme.palette.text.primary, 0.06),
    overflow: 'hidden',
  },
  flowBar: {
    height: '100%',
    borderRadius: 3,
  },
  // Side panel -----------------------------------------------------------
  timeline: {
    position: 'relative',
    height: 28,
    borderRadius: 4,
    backgroundColor: alpha(theme.palette.text.primary, 0.05),
  },
  timelineBar: {
    position: 'absolute',
    top: 6,
    height: 16,
    minWidth: 4,
    borderRadius: 2,
    padding: 0,
    border: 'none',
    cursor: 'pointer',
  },
  timelineAxis: {
    display: 'flex',
    justifyContent: 'space-between',
    fontFamily: MONO,
    fontSize: 10,
    color: theme.palette.text.secondary,
  },
  note: {
    fontSize: 11,
    color: theme.palette.text.secondary,
    lineHeight: 1.45,
  },
  tool: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontFamily: MONO,
    fontSize: 12,
  },
  toolName: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  info: {
    border: `1px solid ${alpha(theme.palette.info.main, 0.4)}`,
    backgroundColor: alpha(theme.palette.info.main, 0.06),
    padding: theme.spacing(1.25),
    display: 'flex',
    gap: theme.spacing(1),
    fontSize: 11.5,
    lineHeight: 1.45,
    '& svg': {
      fontSize: 16,
      color: theme.palette.info.main,
      flex: 'none',
    },
  },
}));

type TOpen = (message: TMessage) => void;

const conversationKpis = (
  conversation: TConversation,
  queueName: string,
  colors: TAgentColors
): TKpi[] => {
  const { totals, messages } = conversation;
  const first = messages[0];
  const last = messages[messages.length - 1];
  const perMessage = (value: number) =>
    totals.messages ? value / totals.messages : 0;
  return [
    {
      label: 'Messages',
      value: fmtInt(totals.messages),
      sub: `${plural(totals.messages, 'job')} in ${queueName}`,
    },
    {
      label: 'Conversation',
      value: fmtMs(totals.durationMs),
      sub:
        first && last
          ? `${clock(messageStart(first))} → ${clock(last.finishedAt)}`
          : undefined,
    },
    {
      label: 'AI time',
      value: fmtMs(totals.aiMs),
      sub: `avg ${fmtMs(perMessage(totals.aiMs))} per message`,
      color: colors.llm,
    },
    {
      label: 'Tokens in',
      value: fmtInt(totals.inputTokens),
      sub: `avg ${fmtInt(perMessage(totals.inputTokens))} per message`,
      color: colors.tokensIn,
    },
    {
      label: 'Tokens out',
      value: fmtInt(totals.outputTokens),
      sub: `avg ${fmtInt(perMessage(totals.outputTokens))} per message`,
      color: colors.tokensOut,
    },
    {
      label: 'Cost estimate',
      value: fmtCost(totals.cost),
      sub: totals.hasUnpricedMessages
        ? 'some messages have no price'
        : totals.cost !== null && totals.cost !== undefined
        ? `avg ${fmtCost(perMessage(totals.cost))} per message`
        : undefined,
    },
    {
      label: 'Steps',
      value: fmtInt(totals.steps),
      sub: plural(totals.toolCalls, 'tool call'),
    },
  ];
};

function Text({ value }: { value: TMessageText }) {
  const cls = useStyles();
  const colors = useAgentColors();
  if (value.kind === 'text') return <SafeMarkdown text={value.text} />;
  if (value.kind === 'error') {
    return (
      <span className={cls.error} style={{ color: colors.error }}>
        {value.text}
      </span>
    );
  }
  return <span className={cls.muted}>{value.reason}</span>;
}

function Cards({ message }: { message: TMessage }) {
  const cls = useStyles();
  const cards = message.run?.final?.cards ?? [];
  return (
    <>
      {cards.map((card, idx) => (
        <div className={cls.card} key={idx}>
          <span className={cls.cardType}>CARD · {card.type}</span>
          <span className={cls.cardTitle}>{card.title}</span>
        </div>
      ))}
    </>
  );
}

function UserBubble({ message }: { message: TMessage }) {
  const cls = useStyles();
  return (
    <div className={clsx(cls.bubble, cls.user)}>
      <span className={cls.kicker}>USER · {clock(messageStart(message))}</span>
      <Text value={userText(message)} />
    </div>
  );
}

function Reply({ message }: { message: TMessage }) {
  const cls = useStyles();
  return (
    <div className={cls.assistant}>
      <span className={cls.avatar}>
        <AssistantIcon />
      </span>
      <div className={cls.assistantBody}>
        <div className={clsx(cls.bubble, cls.reply)}>
          <span className={cls.kicker}>
            ASSISTANT · {clock(message.finishedAt)}
          </span>
          <Text value={replyText(message)} />
        </div>
        <Cards message={message} />
      </div>
    </div>
  );
}

/** The run between the two bubbles: chain, meta and the way into it. */
function RunStrip({
  n,
  message,
  fromJobId,
  onOpen,
}: {
  n: number;
  message: TMessage;
  fromJobId: string | null;
  onOpen: TOpen;
}) {
  const cls = useStyles();
  const links = messageToolLinks(message);
  const canOpen = !message.jobRemoved;
  const content = (
    <>
      <span className={cls.stripJob}>
        #{n} {message.jobId}
      </span>
      <span className={cls.stripChain}>
        {links ? (
          <ToolChain tools={links} outcome={message.outcome} />
        ) : (
          <Chip
            size="small"
            variant="outlined"
            className={cls.removedChip}
            label={message.jobRemoved ? 'job removed' : 'run not in logs'}
          />
        )}
      </span>
      <span className={cls.stripMeta}>{messageMeta(message)}</span>
      {canOpen && <OpenIcon className={cls.stripIcon} />}
    </>
  );
  const className = clsx(
    cls.strip,
    canOpen && cls.stripButton,
    message.jobId === fromJobId && cls.stripFrom
  );
  if (!canOpen) {
    return (
      <div className={className} title="Only the runs index entry is left">
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => onOpen(message)}
      aria-label={`open run of message ${n}`}
      title={messageMeta(message)}
    >
      {content}
    </button>
  );
}

function ChatLayout({
  conversation,
  fromJobId,
  onOpen,
}: {
  conversation: TConversation;
  fromJobId: string | null;
  onOpen: TOpen;
}) {
  const cls = useStyles();
  return (
    <Paper elevation={0} className={cls.chat}>
      {conversation.messages.map((message, idx) => (
        <div className={cls.turn} key={message.jobId}>
          <UserBubble message={message} />
          <RunStrip
            n={idx + 1}
            message={message}
            fromJobId={fromJobId}
            onOpen={onOpen}
          />
          <Reply message={message} />
        </div>
      ))}
    </Paper>
  );
}

const flowColor = (row: TFlowRow, colors: TAgentColors) => {
  switch (row.kind) {
    case 'request':
      return colors.request;
    case 'step':
      return colors.llm;
    case 'tool':
      return colors.tool;
    case 'response':
      return colors.response;
  }
};

function MessageDetail({
  n,
  message,
  onOpen,
}: {
  n: number;
  message: TMessage;
  onOpen: TOpen;
}) {
  const cls = useStyles();
  const colors = useAgentColors();
  const flow = useMemo(
    () => (message.run ? messageFlow(message.run) : null),
    [message.run]
  );
  const metrics = [
    { label: 'Steps', value: String(message.steps) },
    { label: 'Time', value: fmtMs(message.durationMs) },
    {
      label: 'Tokens in',
      value: fmtInt(message.inputTokens),
      color: colors.tokensIn,
    },
    {
      label: 'Tokens out',
      value: fmtInt(message.outputTokens),
      color: colors.tokensOut,
    },
    { label: 'Cost est.', value: fmtCost(message.cost) },
    {
      label: 'Outcome',
      value: message.outcome,
      color: outcomeColor(message.outcome, colors),
    },
  ];
  return (
    <Paper elevation={0} className={cls.detail}>
      <div className={cls.detailHead}>
        <span className={cls.kicker}>MESSAGE {n}</span>
        <span className={cls.detailJob}>{message.jobId}</span>
        {!message.jobRemoved && (
          <Button
            size="small"
            startIcon={<OpenIcon />}
            onClick={() => onOpen(message)}
          >
            Open run
          </Button>
        )}
      </div>
      <UserBubble message={message} />
      <div className={cls.metrics}>
        {metrics.map((m) => (
          <div className={cls.metric} key={m.label}>
            <span className={cls.metricLabel}>{m.label}</span>
            <span className={cls.metricValue} style={{ color: m.color }}>
              {m.value}
            </span>
          </div>
        ))}
      </div>
      {flow ? (
        <div className={cls.flow} aria-label="message steps">
          {flow.map((row) => {
            const color = flowColor(row, colors);
            return (
              <div
                key={row.key}
                className={clsx(
                  cls.flowRow,
                  row.kind === 'tool' && cls.flowTool
                )}
                style={{ backgroundColor: alpha(color, 0.05) }}
              >
                <span className={cls.flowName}>
                  <span
                    className={cls.flowDot}
                    style={{ backgroundColor: color }}
                  />
                  <span className={cls.flowText}>
                    <span className={cls.flowTitle}>{row.title}</span>
                    <span className={cls.flowSub} title={row.sub}>
                      {row.sub}
                    </span>
                  </span>
                </span>
                <span className={cls.flowNum}>{row.tokens ?? ''}</span>
                {row.share !== null ? (
                  <span className={cls.flowTrack}>
                    <span
                      className={cls.flowBar}
                      style={{
                        display: 'block',
                        width: `${Math.min(row.share, 1) * 100}%`,
                        backgroundColor: color,
                      }}
                    />
                  </span>
                ) : (
                  <span />
                )}
                <span className={cls.flowNum}>{row.duration ?? ''}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <span className={cls.muted}>
          {message.jobRemoved
            ? 'Job removed: only the runs index entry is left, so the steps are not available.'
            : 'The run is no longer in the job logs.'}
        </span>
      )}
      <Reply message={message} />
    </Paper>
  );
}

function ListLayout({
  conversation,
  selected,
  onSelect,
  onOpen,
}: {
  conversation: TConversation;
  selected: TMessage;
  onSelect: (jobId: string) => void;
  onOpen: TOpen;
}) {
  const cls = useStyles();
  const { messages } = conversation;
  const n = messages.indexOf(selected) + 1;
  return (
    <div className={cls.list}>
      <Paper elevation={0} className={cls.rows} aria-label="messages">
        {messages.map((message, idx) => {
          const user = userText(message);
          const reply = replyText(message);
          return (
            <button
              type="button"
              key={message.jobId}
              className={clsx(cls.row, message === selected && cls.rowSelected)}
              aria-pressed={message === selected}
              onClick={() => onSelect(message.jobId)}
            >
              <span className={cls.rowN}>{idx + 1}</span>
              <span className={cls.rowBody}>
                <span className={cls.kicker}>
                  USER · {clock(messageStart(message))}
                </span>
                <span className={clsx(cls.clamp, cls.rowUser)}>
                  <Text value={user} />
                </span>
                <span className={clsx(cls.clamp, cls.rowReply)}>
                  <Text value={reply} />
                </span>
                <span className={cls.rowMeta}>{messageMeta(message)}</span>
              </span>
            </button>
          );
        })}
      </Paper>
      <MessageDetail n={n} message={selected} onOpen={onOpen} />
    </div>
  );
}

function SidePanel({
  conversation,
  fromJobId,
  selected,
  onPick,
}: {
  conversation: TConversation;
  fromJobId: string | null;
  selected: string | null;
  onPick: (jobId: string) => void;
}) {
  const cls = useStyles();
  const colors = useAgentColors();
  const timeline = useMemo(
    () => conversationTimeline(conversation.messages),
    [conversation.messages]
  );
  return (
    <div className={cls.aside}>
      {timeline && (
        <Card title="Messages over time">
          <div className={cls.timeline}>
            {timeline.bars.map((bar, idx) => {
              const highlight =
                bar.jobId === fromJobId || bar.jobId === selected;
              return (
                <Tooltip
                  key={bar.jobId}
                  title={`#${idx + 1} ${bar.jobId}`}
                  placement="top"
                >
                  <button
                    type="button"
                    aria-label={`message ${idx + 1}`}
                    className={cls.timelineBar}
                    onClick={() => onPick(bar.jobId)}
                    style={{
                      left: `${bar.left}%`,
                      width: `${bar.width}%`,
                      backgroundColor: highlight ? colors.request : colors.llm,
                    }}
                  />
                </Tooltip>
              );
            })}
          </div>
          <div className={cls.timelineAxis}>
            {timeline.ticks.map((tick) => (
              <span key={tick}>{clock(tick).slice(0, 5)}</span>
            ))}
          </div>
          <span className={cls.note}>
            Bars are the time of each run. The gap between them is the time the
            user took to answer.
          </span>
        </Card>
      )}
      <Card
        title="Tools used"
        aside={plural(conversation.totals.toolCalls, 'call')}
      >
        {conversation.tools.length ? (
          conversation.tools.map((tool) => (
            <div className={cls.tool} key={tool.name}>
              <span className={cls.toolName} title={tool.name}>
                {tool.name}
              </span>
              <span style={{ color: colors.tool }}>{tool.count}×</span>
            </div>
          ))
        ) : (
          <span className={cls.muted}>No tool was called.</span>
        )}
      </Card>
      <div className={cls.info}>
        <InfoIcon />
        <span>
          Messages are the runs of this queue sharing input.conversationId, one
          per job (its last attempt). The user text comes from input.text and
          the reply from final.text, both recorded at full detail only.
        </span>
      </div>
    </div>
  );
}

/**
 * Every message of one conversation, read from the collector's runs index.
 * Reached from a run ("View whole conversation"); a message's run opens on
 * top of it and its back button returns here.
 */
function AgentConversationView() {
  const cls = useStyles();
  const colors = useAgentColors();
  const [
    ref,
    from,
    layout,
    picked,
    closeConversation,
    changeLayout,
    selectMessage,
    openRun,
  ] = useAgentsStore(
    (state) => [
      state.conversation as TAgentConversationRef,
      state.conversationFrom,
      state.conversationLayout,
      state.conversationMessage,
      state.closeConversation,
      state.changeConversationLayout,
      state.selectConversationMessage,
      state.openRun,
    ],
    shallow
  );
  const {
    queries: { getAgentConversation },
  } = useNetwork();
  const queue = useQueueData(ref.queue);
  const queueName = queue?.agent?.label || queue?.name || ref.queue;
  const { status, data, error, refetch } = useQuery(
    [QueryKeysConfig.agentConversation, ref.queue, ref.conversationId],
    () =>
      getAgentConversation({
        queue: ref.queue,
        conversationId: ref.conversationId,
      }),
    { refetchInterval: getPollingInterval(), keepPreviousData: true }
  );
  // Same as the run view: entering from a scrolled page starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [ref.queue, ref.conversationId]);

  const conversation = data?.agentConversation ?? null;
  const fromJobId = from?.run.jobId ?? null;
  const selected = conversation
    ? pickMessage(conversation.messages, picked ?? fromJobId)
    : null;
  const open: TOpen = (message) =>
    openRun(
      { queue: ref.queue, jobId: message.jobId, attempt: message.attempt },
      'conversation'
    );
  const pick = (jobId: string) => {
    selectMessage(jobId);
    if (layout === 'chat') changeLayout('list');
  };

  return (
    <div className={cls.root}>
      <Paper elevation={0} className={cls.header}>
        <Button
          size="small"
          color="inherit"
          startIcon={<BackIcon />}
          onClick={closeConversation}
        >
          {from ? 'Run' : 'Agents'}
        </Button>
        <div className={cls.ident}>
          <span className={cls.kicker}>CONVERSATION</span>
          <span className={cls.convId} title={ref.conversationId}>
            {ref.conversationId}
          </span>
          <span className={cls.sub}>
            {queueName}
            {conversation
              ? ` · ${plural(conversation.messages.length, 'message')}`
              : ''}
          </span>
        </div>
        <ToggleButtonGroup
          className={cls.toggle}
          size="small"
          exclusive
          value={layout}
          onChange={(_e, next) => {
            if (next) changeLayout(next);
          }}
        >
          <ToggleButton value="chat" aria-label="chat">
            <ChatIcon /> Chat
          </ToggleButton>
          <ToggleButton value="list" aria-label="list">
            <ListIcon /> List
          </ToggleButton>
        </ToggleButtonGroup>
      </Paper>
      <NetworkRequest status={status} error={error} refetch={refetch}>
        {!conversation || !selected ? (
          <div className={cls.empty}>
            No run of this conversation is in the recent runs index.
          </div>
        ) : (
          <>
            {conversation.maybeIncomplete && (
              <Alert severity="info" variant="outlined">
                Older messages may be missing: the conversation is read from the
                recent runs index, which keeps a limited number of runs per
                queue, and lists at most the last 100 messages.
              </Alert>
            )}
            <Kpis items={conversationKpis(conversation, queueName, colors)} />
            <div className={cls.layout}>
              {layout === 'list' ? (
                <ListLayout
                  conversation={conversation}
                  selected={selected}
                  onSelect={selectMessage}
                  onOpen={open}
                />
              ) : (
                <ChatLayout
                  conversation={conversation}
                  fromJobId={fromJobId}
                  onOpen={open}
                />
              )}
              <SidePanel
                conversation={conversation}
                fromJobId={fromJobId}
                selected={layout === 'list' ? selected.jobId : null}
                onPick={pick}
              />
            </div>
          </>
        )}
      </NetworkRequest>
    </div>
  );
}

export default memo(AgentConversationView);
