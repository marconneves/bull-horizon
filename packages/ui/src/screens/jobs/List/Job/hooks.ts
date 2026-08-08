import { useEffect, useMemo, useRef } from 'react';

export type TParsedProgress =
  | { kind: 'numeric'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'empty' };

const NUMERIC_PROGRESS_RE = /^-?\d+(\.\d+)?$/;

// job.progress is a GraphQL String scalar, but Bull/BullMQ allow progress to
// be a plain 0-100 number OR an arbitrary JSON-serializable value (an
// object, for instance). We only render a progress bar for the strict
// numeric case and fall back to raw text otherwise — Number()/parseFloat()
// alone would be too lenient here (e.g. "" -> 0, "42abc" -> 42).
export const parseJobProgress = (progress?: string | null): TParsedProgress => {
  if (!progress) return { kind: 'empty' };
  const trimmed = progress.trim();
  if (!trimmed) return { kind: 'empty' };
  if (NUMERIC_PROGRESS_RE.test(trimmed)) {
    const value = Math.min(100, Math.max(0, Number(trimmed)));
    return { kind: 'numeric', value };
  }
  return { kind: 'text', value: progress };
};

export const useParsedProgress = (progress?: string | null) =>
  useMemo(() => parseJobProgress(progress), [progress]);

export const useRemoveJobSelectionOnUnmount = (
  jobId: string,
  isSelected: boolean,
  removeSelected: (id: string) => void
) => {
  const jobIdRef = useRef(jobId);
  const isSelectedRef = useRef(isSelected);
  jobIdRef.current = jobId;
  isSelectedRef.current = isSelected;
  useEffect(() => {
    return () => {
      if (isSelectedRef.current && jobIdRef.current) {
        removeSelected(jobIdRef.current);
      }
    };
  }, []);
};
