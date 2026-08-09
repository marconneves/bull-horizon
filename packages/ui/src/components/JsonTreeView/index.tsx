import React, { useMemo, useCallback } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import clsx from 'clsx';
import JsonNode from './JsonNode';
import type { TPathSegment } from './JsonNode';
import { JsonataPathService } from '@/services/jsonata-path';

const useStyles = makeStyles((theme) => ({
  root: {
    backgroundColor: theme.palette.background.default,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    padding: theme.spacing(1),
    color: theme.palette.text.primary,
    maxHeight: '260px',
    overflow: 'auto',
    margin: 0,
  },
  pre: {
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: 12,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
  },
  rawWrapper: {
    position: 'relative',
  },
  rawFilterBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    // Visible by default: unlike the tree, there's no row here hinting the block
    // is clickable, so a hover-only button simply never gets found.
    opacity: 0.55,
    padding: 2,
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
    transition: theme.transitions.create('opacity', { duration: 100 }),
    '&:hover': {
      opacity: 1,
      backgroundColor: theme.palette.background.paper,
    },
  },
}));

type TProps = {
  children: string;
  className?: string;
  // When set, primitive leaves get an "add to filter" button that builds a
  // jsonata expression rooted at this path and appends it to the job search.
  // The path must be a property of the raw job object the search evaluates
  // against (`data`, `returnvalue`, `opts`, ...) — see the search docs.
  // A payload that isn't a JSON object filters on the base path itself
  // (`returnvalue = "done"`).
  filterBasePath?: string;
  onFilterAdded?: (expression: string) => void;
};

const JsonTreeView = ({
  children,
  className,
  filterBasePath,
  onFilterAdded,
}: TProps) => {
  const cls = useStyles();
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(children) };
    } catch (_e) {
      return { ok: false as const, value: null };
    }
  }, [children]);

  const handleAddFilter = useCallback(
    (path: TPathSegment[], value: string | number | boolean) => {
      if (!filterBasePath || !onFilterAdded) return;
      const expr = JsonataPathService.buildPath(filterBasePath, path);
      const literal = JsonataPathService.formatLiteral(value);
      onFilterAdded(`${expr} = ${literal}`);
    },
    [filterBasePath, onFilterAdded]
  );

  // Not a JSON object (a plain-text return value, a stacktrace): there are no
  // leaves to click, so the only meaningful filter is an equality on the base
  // path itself.
  const handleAddRawFilter = useCallback(() => {
    if (!filterBasePath || !onFilterAdded) return;
    const literal = JsonataPathService.formatLiteral(children.trim());
    onFilterAdded(`${filterBasePath} = ${literal}`);
  }, [filterBasePath, onFilterAdded, children]);

  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) {
    const raw = <pre className={clsx([cls.root, cls.pre, className])}>{children}</pre>;
    if (!filterBasePath || !onFilterAdded || !children.trim()) return raw;
    return (
      <div className={cls.rawWrapper}>
        {raw}
        <Tooltip title="Add to filter">
          <IconButton
            className={cls.rawFilterBtn}
            size="small"
            onClick={handleAddRawFilter}
          >
            <FilterAltIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={clsx([cls.root, className])}>
      <JsonNode
        keyLabel={null}
        value={parsed.value}
        path={[]}
        depth={0}
        onAddFilter={filterBasePath ? handleAddFilter : undefined}
      />
    </div>
  );
};

export default JsonTreeView;
