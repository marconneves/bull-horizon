import React, { useMemo, useCallback } from 'react';
import makeStyles from '@mui/styles/makeStyles';
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
}));

type TProps = {
  children: string;
  className?: string;
  // When set, primitive leaves get an "add to filter" button that builds a
  // jsonata expression rooted at this path (e.g. "data") and appends it to
  // the job search — see search-examples.md for the expected syntax.
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

  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) {
    return <pre className={clsx([cls.root, cls.pre, className])}>{children}</pre>;
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
