import React, { memo, useMemo } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import clsx from 'clsx';
import { parseSafeMarkdown } from './parse';
import type { TMdBlock, TMdInline } from './parse';

const useStyles = makeStyles((theme) => ({
  root: {
    fontSize: 13,
    lineHeight: 1.55,
    wordBreak: 'break-word',
    '& > *:last-child': {
      marginBottom: 0,
    },
  },
  paragraph: {
    margin: theme.spacing(0, 0, 1),
  },
  list: {
    margin: theme.spacing(0, 0, 1),
    paddingLeft: theme.spacing(2.5),
  },
  code: {
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: '0.92em',
    padding: '1px 4px',
    borderRadius: 3,
    backgroundColor: alpha(theme.palette.text.primary, 0.08),
  },
}));

type TClasses = ReturnType<typeof useStyles>;

const renderInline = (nodes: TMdInline[], cls: TClasses): React.ReactNode[] =>
  nodes.map((node, idx) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'code':
        return (
          <code key={idx} className={cls.code}>
            {node.value}
          </code>
        );
      case 'strong':
        return <strong key={idx}>{renderInline(node.children, cls)}</strong>;
      case 'em':
        return <em key={idx}>{renderInline(node.children, cls)}</em>;
      case 'br':
        return <br key={idx} />;
      default:
        return null;
    }
  });

const renderBlock = (block: TMdBlock, idx: number, cls: TClasses) => {
  if (block.type === 'paragraph') {
    return (
      <p key={idx} className={cls.paragraph}>
        {renderInline(block.children, cls)}
      </p>
    );
  }
  const items = block.items.map((item, i) => (
    <li key={i}>{renderInline(item, cls)}</li>
  ));
  return block.ordered ? (
    <ol key={idx} className={cls.list} start={block.start}>
      {items}
    </ol>
  ) : (
    <ul key={idx} className={cls.list}>
      {items}
    </ul>
  );
};

type TProps = {
  text: string;
  className?: string;
};

/**
 * Renders LLM-written text with a small, safe markdown subset (bold, italic,
 * inline code, line breaks, lists). Built from React elements only — there is
 * no HTML string anywhere, so links, images and raw HTML show up literally.
 * Use it only for step text, final text and input text; summaries, card
 * titles and tool names stay plain text.
 */
function SafeMarkdown({ text, className }: TProps) {
  const cls = useStyles();
  const blocks = useMemo(() => parseSafeMarkdown(text), [text]);
  return (
    <div className={clsx(cls.root, className)}>
      {blocks.map((block, idx) => renderBlock(block, idx, cls))}
    </div>
  );
}

export default memo(SafeMarkdown);
