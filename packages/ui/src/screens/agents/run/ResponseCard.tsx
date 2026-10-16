import React, { memo } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import Button from '@mui/material/Button';
import ForumIcon from '@mui/icons-material/ForumOutlined';
import { useQuery } from 'react-query';
import shallow from 'zustand/shallow';
import SafeMarkdown from '@/components/SafeMarkdown';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import { useAgentsStore } from '@/stores/agents';
import { AgentRunDetail } from '@/typings/gql';
import { Card, MONO } from '../shared';
import { useAgentColors } from '../colors';
import { fmtClock } from '../format';
import type { TRun } from '../model';

const useStyles = makeStyles((theme) => ({
  bubble: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    padding: theme.spacing(1.25, 1.5),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
    minWidth: 0,
  },
  user: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: alpha(theme.palette.text.primary, 0.04),
  },
  assistant: {
    backgroundColor: alpha(theme.palette.primary.main, 0.05),
  },
  kicker: {
    fontSize: 10,
    letterSpacing: '0.06em',
    color: theme.palette.text.secondary,
  },
  muted: {
    fontSize: 12,
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
  },
  mono: {
    fontFamily: MONO,
    fontSize: 11,
    color: theme.palette.text.secondary,
  },
  card: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    padding: theme.spacing(1, 1.25),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  cardType: {
    fontSize: 10,
    letterSpacing: '0.06em',
    color: theme.palette.text.secondary,
  },
  conversation: {
    alignSelf: 'flex-start',
    textTransform: 'none',
    fontSize: 12,
  },
  error: {
    fontFamily: MONO,
    fontSize: 12,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
}));

/** The exchange this run answered: user input (when recorded) and the reply. */
function ResponseCard({ run }: { run: TRun }) {
  const cls = useStyles();
  const colors = useAgentColors();
  const basic = run.detail === AgentRunDetail.Basic;
  const [queue, openConversation] = useAgentsStore(
    (state) => [state.run?.queue ?? null, state.openConversation],
    shallow
  );
  const {
    queries: { getMetricsEnabled },
  } = useNetwork();
  const { data: metricsEnabled } = useQuery(
    QueryKeysConfig.metricsEnabled,
    getMetricsEnabled,
    { staleTime: Infinity }
  );
  const conversationId = run.input?.conversationId;
  // The conversation is read from the collector's runs index.
  const canOpenConversation =
    !!queue && !!conversationId && !!metricsEnabled?.metricsEnabled;
  const notRecorded = (
    <span className={cls.muted}>Not recorded at basic detail.</span>
  );
  return (
    <Card title="This run" aside={run.input?.conversationId ?? undefined}>
      <div className={`${cls.bubble} ${cls.user}`}>
        <span className={cls.kicker}>
          USER · {fmtClock(run.startedAt, false)}
        </span>
        {run.input?.text ? (
          <SafeMarkdown text={run.input.text} />
        ) : basic ? (
          notRecorded
        ) : (
          <span className={cls.muted}>The input text is not in the run.</span>
        )}
      </div>
      <div className={`${cls.bubble} ${cls.assistant}`}>
        <span className={cls.kicker}>
          ASSISTANT · {fmtClock(run.finishedAt, false)}
        </span>
        {run.error ? (
          <span className={cls.error} style={{ color: colors.error }}>
            {run.error}
          </span>
        ) : run.final?.text ? (
          <SafeMarkdown text={run.final.text} />
        ) : basic ? (
          notRecorded
        ) : (
          <span className={cls.muted}>No final text.</span>
        )}
      </div>
      {run.final?.cards.map((card, idx) => (
        <div className={cls.card} key={idx}>
          <span className={cls.cardTitle} title={card.title}>
            {card.title}
          </span>
          <span className={cls.cardType}>CARD · {card.type}</span>
        </div>
      ))}
      {canOpenConversation && (
        <Button
          size="small"
          className={cls.conversation}
          startIcon={<ForumIcon />}
          onClick={() =>
            openConversation({
              queue: queue as string,
              conversationId: conversationId as string,
            })
          }
        >
          View whole conversation
        </Button>
      )}
    </Card>
  );
}

export default memo(ResponseCard);
