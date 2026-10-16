import React, { memo } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import ChevronIcon from '@mui/icons-material/ChevronRight';
import type { AgentRunToolLink } from '@/typings/gql';
import { MONO } from './shared';
import { outcomeColor, useAgentColors } from './colors';

const useStyles = makeStyles((theme) => ({
  chain: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    minWidth: 0,
    overflow: 'hidden',
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    flex: 'none',
  },
  chip: {
    fontFamily: MONO,
    fontSize: 10.5,
    padding: '2px 6px',
    borderRadius: 3,
    whiteSpace: 'nowrap',
  },
  arrow: {
    fontSize: '13px !important',
    color: theme.palette.text.disabled,
  },
}));

type TGroup = { name: string; count: number; ok: boolean; empty: boolean };

/** Consecutive calls of the same tool read as one link: `searchFoods ×4`. */
const group = (tools: AgentRunToolLink[]): TGroup[] => {
  const groups: TGroup[] = [];
  for (const tool of tools) {
    const last = groups[groups.length - 1];
    if (last && last.name === tool.name) {
      last.count += 1;
      last.ok = last.ok && tool.ok;
      last.empty = last.empty || tool.empty;
    } else {
      groups.push({
        name: tool.name,
        count: 1,
        ok: tool.ok,
        empty: tool.empty,
      });
    }
  }
  return groups;
};

type TProps = {
  tools: AgentRunToolLink[];
  outcome: string;
};

function ToolChain({ tools, outcome }: TProps) {
  const cls = useStyles();
  const colors = useAgentColors();
  const links = [
    { key: 'req', label: 'req', color: colors.request },
    ...group(tools).map((g, idx) => ({
      key: `${g.name}-${idx}`,
      label: g.count > 1 ? `${g.name} ×${g.count}` : g.name,
      color: !g.ok ? colors.error : g.empty ? colors.warning : colors.tool,
    })),
    { key: 'out', label: outcome, color: outcomeColor(outcome, colors) },
  ];
  return (
    <div className={cls.chain}>
      {links.map((link, idx) => (
        <span className={cls.link} key={link.key}>
          <span
            className={cls.chip}
            style={{
              color: link.color,
              backgroundColor: alpha(link.color, 0.14),
            }}
          >
            {link.label}
          </span>
          {idx < links.length - 1 && <ChevronIcon className={cls.arrow} />}
        </span>
      ))}
    </div>
  );
}

export default memo(ToolChain);
