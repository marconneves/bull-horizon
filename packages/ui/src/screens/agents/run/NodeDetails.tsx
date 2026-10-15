import React from 'react';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CopyIcon from '@mui/icons-material/ContentCopy';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import JsonTreeView from '@/components/JsonTreeView';
import SafeMarkdown from '@/components/SafeMarkdown';
import { copyToClipboard } from '@/services/clipboard';
import { useToast } from '@/hooks/use-toast';
import { AgentRunDetail } from '@/typings/gql';
import { MONO } from '../shared';
import { useAgentColors } from '../colors';
import type { TAgentColors } from '../colors';
import { DASH, fmtClock, fmtCost, fmtInt, fmtMs, plural } from '../format';
import type { TNodeRef, TRun } from '../model';

const NOT_RECORDED = 'Not recorded at basic detail.';

type TBlock =
  | { title: string; kind: 'json'; json: string; hint?: string }
  | { title: string; kind: 'markdown'; text: string }
  | { title: string; kind: 'plain'; text: string; color?: string }
  | { title: string; kind: 'note'; text: string }
  | {
      title: string;
      kind: 'cards';
      cards: NonNullable<TRun['final']>['cards'];
    };

type TMetric = { k: string; v: string; color?: string; title?: string };

export type TNodeDescription = {
  kicker: string;
  kickerColor: string;
  title: string;
  metrics: TMetric[];
  blocks: TBlock[];
};

export type TNodeContext = {
  run: TRun;
  /** `Job.data` (JSON string). Null when the job is gone. */
  jobData: string | null;
};

/** `{ truncated, chars }` is what the helper records above the size cap. */
const truncatedHint = (json: string | null | undefined) => {
  if (!json) return undefined;
  try {
    const value = JSON.parse(json);
    if (value && typeof value === 'object' && value.truncated === true) {
      return `Trimmed when recorded (${fmtInt(value.chars)} chars).`;
    }
  } catch (_e) {
    // Not JSON: shown raw.
  }
  return undefined;
};

const isBasic = (run: TRun) => run.detail === AgentRunDetail.Basic;

export const describeNode = (
  ref: TNodeRef,
  { run, jobData }: TNodeContext,
  colors: TAgentColors
): TNodeDescription => {
  const basic = isBasic(run);

  if (ref.kind === 'request') {
    const blocks: TBlock[] = [
      jobData
        ? { title: 'job data', kind: 'json', json: jobData }
        : { title: 'job data', kind: 'note', text: 'The job was removed.' },
    ];
    if (run.input?.text) {
      blocks.push({
        title: 'input text',
        kind: 'markdown',
        text: run.input.text,
      });
    } else if (basic) {
      blocks.push({ title: 'input text', kind: 'note', text: NOT_RECORDED });
    }
    return {
      kicker: 'REQUEST',
      kickerColor: colors.request,
      title: 'payload',
      metrics: [
        { k: 'Model', v: run.model },
        { k: 'Attempt', v: String(run.attempt) },
        { k: 'Started', v: fmtClock(run.startedAt) },
        {
          k: 'Overhead',
          v: fmtMs(run.overheadStartMs),
          title:
            run.overheadStartMs === null || run.overheadStartMs === undefined
              ? 'Only known for the last attempt'
              : 'Job start to run start',
        },
        ...(run.input?.conversationId
          ? [{ k: 'Conversation', v: run.input.conversationId }]
          : []),
      ],
      blocks,
    };
  }

  if (ref.kind === 'response') {
    const blocks: TBlock[] = [];
    if (run.final?.text) {
      blocks.push({
        title: 'final text',
        kind: 'markdown',
        text: run.final.text,
      });
    } else if (basic) {
      blocks.push({ title: 'final text', kind: 'note', text: NOT_RECORDED });
    } else if (run.final) {
      blocks.push({ title: 'final text', kind: 'note', text: 'Empty.' });
    }
    if (run.final?.cards.length) {
      blocks.push({ title: 'cards', kind: 'cards', cards: run.final.cards });
    }
    blocks.push(
      run.error
        ? {
            title: 'error',
            kind: 'plain',
            text: run.error,
            color: colors.error,
          }
        : { title: 'error', kind: 'plain', text: 'null', color: colors.ok }
    );
    return {
      kicker: 'RESPONSE',
      kickerColor: colors.response,
      title: run.error ? 'error' : 'final',
      metrics: [
        { k: 'Finished', v: fmtClock(run.finishedAt) },
        { k: 'Outcome', v: run.outcome },
        { k: 'Cards', v: String(run.final?.cards.length ?? 0) },
        { k: 'Total', v: fmtMs(run.durationMs) },
        { k: 'Cost est.', v: fmtCost(run.cost) },
        { k: 'Overhead', v: fmtMs(run.overheadEndMs) },
      ],
      blocks,
    };
  }

  const step = run.steps[ref.step];

  if (ref.kind === 'step') {
    let text: TBlock;
    if (step.text) text = { title: 'text', kind: 'markdown', text: step.text };
    else if (basic) text = { title: 'text', kind: 'note', text: NOT_RECORDED };
    else
      text = {
        title: 'text',
        kind: 'note',
        text: step.tools.length
          ? 'Empty, the step only called tools.'
          : 'Empty.',
      };
    return {
      kicker: `LLM · STEP ${step.step}`,
      kickerColor: colors.llm,
      title: step.finishReason ?? DASH,
      metrics: [
        { k: 'Started', v: fmtClock(step.startedAt) },
        { k: 'Duration', v: fmtMs(step.durationMs) },
        { k: 'Tokens in', v: fmtInt(step.inputTokens), color: colors.tokensIn },
        {
          k: 'Tokens out',
          v: fmtInt(step.outputTokens),
          color: colors.tokensOut,
        },
        { k: 'Cost est.', v: fmtCost(step.cost) },
        { k: 'Tools', v: String(step.tools.length), color: colors.tool },
      ],
      blocks: [text],
    };
  }

  const tool = step.tools[ref.tool];
  const blocks: TBlock[] = [];
  if (basic) {
    blocks.push({ title: 'input', kind: 'note', text: NOT_RECORDED });
    blocks.push({ title: 'output', kind: 'note', text: NOT_RECORDED });
  } else {
    blocks.push(
      tool.input
        ? {
            title: 'input',
            kind: 'json',
            json: tool.input,
            hint: truncatedHint(tool.input),
          }
        : { title: 'input', kind: 'note', text: 'No input.' }
    );
    blocks.push(
      tool.output
        ? {
            title: 'output',
            kind: 'json',
            json: tool.output,
            hint: truncatedHint(tool.output),
          }
        : { title: 'output', kind: 'note', text: 'No output.' }
    );
  }
  if (!tool.ok) {
    blocks.push(
      tool.error
        ? {
            title: 'error',
            kind: 'plain',
            text: tool.error,
            color: colors.error,
          }
        : { title: 'error', kind: 'note', text: NOT_RECORDED }
    );
  }
  return {
    kicker: `TOOL · STEP ${step.step}`,
    kickerColor: colors.tool,
    title: tool.name,
    metrics: [
      { k: 'Duration', v: fmtMs(tool.durationMs) },
      {
        k: 'ok',
        v: String(tool.ok),
        color: tool.ok ? colors.ok : colors.error,
      },
      {
        k: 'Summary',
        v: tool.summary,
        color: tool.empty ? colors.warning : undefined,
      },
      { k: 'Called by', v: `step ${step.step}`, color: colors.llm },
      {
        k: 'Output size',
        v:
          tool.outputChars === null || tool.outputChars === undefined
            ? DASH
            : plural(tool.outputChars, 'char'),
      },
      { k: 'Result', v: tool.empty ? 'empty' : 'has data' },
    ],
    blocks,
  };
};

const useStyles = makeStyles((theme) => ({
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 1,
    backgroundColor: theme.palette.divider,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 4,
    overflow: 'hidden',
  },
  metric: {
    backgroundColor: theme.palette.background.paper,
    padding: theme.spacing(1, 1.25),
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  metricKey: {
    fontSize: 10,
    color: theme.palette.text.secondary,
  },
  metricValue: {
    fontFamily: MONO,
    fontSize: 12.5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  blocks: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    minWidth: 0,
  },
  blocksGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: theme.spacing(1.5),
  },
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
    minWidth: 0,
  },
  blockHead: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    minHeight: 24,
  },
  blockTitle: {
    fontSize: 11,
    fontWeight: 600,
    flex: 1,
  },
  copy: {
    padding: 2,
    fontSize: 15,
    color: theme.palette.text.secondary,
  },
  text: {
    backgroundColor: theme.palette.background.default,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    padding: theme.spacing(1, 1.25),
    maxHeight: 260,
    overflow: 'auto',
  },
  plain: {
    fontFamily: MONO,
    fontSize: 12,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
  },
  note: {
    fontSize: 12,
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
  },
  hint: {
    fontSize: 11,
    color: theme.palette.warning.main,
  },
  cards: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  },
  cardItem: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    padding: theme.spacing(0.75, 1),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    backgroundColor: alpha(theme.palette.primary.main, 0.05),
  },
  cardType: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: '0.06em',
    color: theme.palette.text.secondary,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
}));

export function NodeMetrics({ metrics }: { metrics: TMetric[] }) {
  const cls = useStyles();
  return (
    <div className={cls.metrics}>
      {metrics.map((metric) => (
        <div className={cls.metric} key={metric.k}>
          <span className={cls.metricKey}>{metric.k}</span>
          <span
            className={cls.metricValue}
            style={{ color: metric.color }}
            title={metric.title ?? metric.v}
          >
            {metric.v}
          </span>
        </div>
      ))}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const cls = useStyles();
  const toast = useToast();
  return (
    <Tooltip title="Copy">
      <IconButton
        size="small"
        className={cls.copy}
        aria-label={`copy ${label}`}
        onClick={async () => {
          const ok = await copyToClipboard(text);
          toast(ok ? `${label} copied` : 'Could not copy to clipboard', {
            variant: ok ? 'success' : 'error',
          });
        }}
      >
        <CopyIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  );
}

function Block({ block }: { block: TBlock }) {
  const cls = useStyles();
  let body: React.ReactNode;
  let copyText: string | null = null;
  switch (block.kind) {
    case 'json':
      copyText = block.json;
      body = <JsonTreeView>{block.json}</JsonTreeView>;
      break;
    case 'markdown':
      copyText = block.text;
      body = (
        <div className={cls.text}>
          <SafeMarkdown text={block.text} />
        </div>
      );
      break;
    case 'plain':
      copyText = block.text;
      body = (
        <div className={cls.text}>
          <pre className={cls.plain} style={{ color: block.color }}>
            {block.text}
          </pre>
        </div>
      );
      break;
    case 'note':
      body = <span className={cls.note}>{block.text}</span>;
      break;
    case 'cards':
      body = (
        <div className={cls.cards}>
          {block.cards.map((card, idx) => (
            <div className={cls.cardItem} key={idx}>
              <span className={cls.cardTitle} title={card.title}>
                {card.title}
              </span>
              <span className={cls.cardType}>{card.type}</span>
            </div>
          ))}
        </div>
      );
      break;
  }
  return (
    <div className={cls.block}>
      <div className={cls.blockHead}>
        <span className={cls.blockTitle}>{block.title}</span>
        {copyText && <CopyButton text={copyText} label={block.title} />}
      </div>
      {body}
      {block.kind === 'json' && block.hint && (
        <span className={cls.hint}>{block.hint}</span>
      )}
    </div>
  );
}

type TBlocksProps = {
  blocks: TBlock[];
  /** Side by side (waterfall rows) instead of stacked (graph panel). */
  grid?: boolean;
};

export function NodeBlocks({ blocks, grid }: TBlocksProps) {
  const cls = useStyles();
  return (
    <div className={grid ? cls.blocksGrid : cls.blocks}>
      {blocks.map((block, idx) => (
        <Block block={block} key={`${block.title}-${idx}`} />
      ))}
    </div>
  );
}

export const useNodeDescription = (
  ref: TNodeRef | null,
  context: TNodeContext
): TNodeDescription | null => {
  const colors = useAgentColors();
  return React.useMemo(
    () => (ref ? describeNode(ref, context, colors) : null),
    [ref, context.run, context.jobData, colors]
  );
};
