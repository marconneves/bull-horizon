import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from 'react-query';
import { useAtom } from 'jotai';
import { dataSearchAtom } from '@/atoms/workspaces';
import { QueryKeysConfig } from '@/config/query-keys';
import { JsonataPathService } from '@/services/jsonata-path';
import { JsonataFilterService } from '@/services/jsonata-filter';
import type { TFilterGroup } from '@/services/jsonata-filter';

const MAX_SUGGESTION_DEPTH = 4;
const MAX_SUGGESTIONS = 60;

// Job-level fields (not payload) the search can see, because jsonata is
// evaluated against Bull's raw Job object — see packages/root/src/data-search.ts.
const JOB_LEVEL_FIELDS = [
  'name',
  'id',
  'attemptsMade',
  'timestamp',
  'delay',
  'failedReason',
  'returnvalue',
];

const collectPaths = (
  value: unknown,
  base: string,
  segments: Array<string | number>,
  out: Set<string>
) => {
  if (segments.length > MAX_SUGGESTION_DEPTH || out.size >= MAX_SUGGESTIONS) {
    return;
  }
  if (value === null || typeof value !== 'object') {
    if (segments.length) out.add(JsonataPathService.buildPath(base, segments));
    return;
  }
  // Array indexes aren't suggested: `data.items[0].sku` doesn't fit the row
  // grammar. We suggest the path inside the first item instead, which the user
  // can reach by combining it with `*` or `**`.
  if (Array.isArray(value)) {
    if (value.length) collectPaths(value[0], base, segments, out);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectPaths(child, base, [...segments, key], out);
  }
};

const parseMaybeJson = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
};

// Suggestions come from jobs already in the react-query cache — no extra
// request, and no invented schema the project doesn't have.
export const useFieldSuggestions = (): string[] => {
  const queryClient = useQueryClient();
  return useMemo(() => {
    const out = new Set<string>();
    const cached = queryClient
      .getQueryCache()
      .findAll([QueryKeysConfig.jobsList]);
    for (const query of cached) {
      const result = query.state.data as { jobs?: unknown[] } | undefined;
      for (const job of result?.jobs ?? []) {
        const j = job as Record<string, unknown>;
        collectPaths(parseMaybeJson(j.data), 'data', [], out);
        collectPaths(parseMaybeJson(j.opts), 'opts', [], out);
        collectPaths(parseMaybeJson(j.returnValue), 'returnvalue', [], out);
        if (out.size >= MAX_SUGGESTIONS) break;
      }
    }
    return [...JOB_LEVEL_FIELDS, ...[...out].sort()];
  }, [queryClient]);
};

type TBuilderState = {
  // `null` = the current expression doesn't fit in rows; the UI keeps text mode.
  tree: TFilterGroup | null;
  setTree: (next: TFilterGroup) => void;
  expression: string;
};

// The jsonata string stays the source of truth. The tree is a projection: every
// edit serialises back into the atom, and every external atom change (e.g. a
// click on the job's JSON) re-projects the tree.
export const useFilterBuilderState = (): TBuilderState => {
  const [expression, setExpression] = useAtom(dataSearchAtom);
  const [tree, setLocalTree] = useState<TFilterGroup | null>(() =>
    JsonataFilterService.parse(expression)
  );
  const lastSerialized = useRef(expression);

  useEffect(() => {
    if (expression === lastSerialized.current) return;
    lastSerialized.current = expression;
    setLocalTree(JsonataFilterService.parse(expression));
  }, [expression]);

  const setTree = useCallback(
    (next: TFilterGroup) => {
      setLocalTree(next);
      const serialized = JsonataFilterService.serialize(next);
      lastSerialized.current = serialized;
      setExpression(serialized);
    },
    [setExpression]
  );

  return { tree, setTree, expression };
};
