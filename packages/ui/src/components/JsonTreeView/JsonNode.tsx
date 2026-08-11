import React, { useState, useCallback } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

type TPrimitive = string | number | boolean | null;
export type TPathSegment = string | number;

const useStyles = makeStyles((theme) => ({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    minHeight: 20,
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: 12,
    lineHeight: '20px',
    cursor: 'default',
    '&:hover $filterBtn': {
      opacity: 1,
    },
  },
  branchRow: {
    cursor: 'pointer',
    userSelect: 'none',
    '&:hover': {
      color: theme.palette.text.primary,
    },
  },
  chevron: {
    width: 14,
    height: 14,
    flexShrink: 0,
    display: 'flex',
    color: theme.palette.text.disabled,
    transition: theme.transitions.create('transform', { duration: 100 }),
  },
  chevronOpen: {
    transform: 'rotate(90deg)',
  },
  chevronSpacer: {
    width: 14,
    flexShrink: 0,
  },
  key: {
    color: theme.palette.text.secondary,
    flexShrink: 0,
  },
  count: {
    color: theme.palette.text.disabled,
  },
  string: {
    color: theme.palette.text.primary,
    wordBreak: 'break-word',
  },
  scalar: {
    color: theme.palette.primary.light,
  },
  nullish: {
    color: theme.palette.text.disabled,
    fontStyle: 'italic',
  },
  indent: {
    marginLeft: 15,
    paddingLeft: 6,
    borderLeft: `1px solid ${theme.palette.divider}`,
  },
  filterBtn: {
    opacity: 0,
    padding: 2,
    marginLeft: 2,
    transition: theme.transitions.create('opacity', { duration: 100 }),
  },
}));

function formatScalar(value: TPrimitive): {
  text: string;
  cls: 'string' | 'scalar' | 'nullish';
} {
  if (value === null) return { text: 'null', cls: 'nullish' };
  if (typeof value === 'string') return { text: `"${value}"`, cls: 'string' };
  return { text: String(value), cls: 'scalar' };
}

type TProps = {
  keyLabel: TPathSegment | null;
  value: unknown;
  path: TPathSegment[];
  depth: number;
  onAddFilter?: (
    path: TPathSegment[],
    value: string | number | boolean
  ) => void;
};

const JsonNode = ({ keyLabel, value, path, depth, onAddFilter }: TProps) => {
  const cls = useStyles();
  const isBranch = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < 1);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  if (isBranch) {
    const isArray = Array.isArray(value);
    const entries = isArray
      ? (value as unknown[]).map((v, i): [TPathSegment, unknown] => [i, v])
      : Object.entries(value as Record<string, unknown>);
    return (
      <div>
        <div
          className={`${cls.row} ${cls.branchRow}`}
          onClick={toggle}
          role="button"
          tabIndex={0}
        >
          <span className={`${cls.chevron} ${open ? cls.chevronOpen : ''}`}>
            <ChevronRightIcon fontSize="inherit" />
          </span>
          {keyLabel !== null && <span className={cls.key}>{keyLabel}:</span>}
          <span className={cls.count}>
            {isArray ? `Array(${entries.length})` : `Object(${entries.length})`}
          </span>
        </div>
        {open && (
          <div className={cls.indent}>
            {entries.map(([k, v]) => (
              <JsonNode
                key={k}
                keyLabel={k}
                value={v}
                path={[...path, k]}
                depth={depth + 1}
                onAddFilter={onAddFilter}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const { text, cls: valueCls } = formatScalar(value as TPrimitive);
  const canFilter = onAddFilter && value !== null;
  return (
    <div className={cls.row}>
      <span className={cls.chevronSpacer} />
      {keyLabel !== null && <span className={cls.key}>{keyLabel}:</span>}
      <span className={cls[valueCls]}>{text}</span>
      {canFilter && (
        <Tooltip title="Add to filter">
          <IconButton
            className={cls.filterBtn}
            size="small"
            onClick={() =>
              onAddFilter!(path, value as string | number | boolean)
            }
          >
            <FilterAltIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      )}
    </div>
  );
};

export default JsonNode;
