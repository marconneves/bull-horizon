// Pure formatters shared by the agents screens. No imports, so the run model
// that uses them stays testable from the root jest setup.

export const DASH = '—';

/** 53 -> "53ms", 4086 -> "4.1s", 75000 -> "1m15s". */
export const fmtMs = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return DASH;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
};

/** USD estimate. Null means the model has no price — never shown as $0. */
export const fmtCost = (cost: number | null | undefined): string => {
  if (cost === null || cost === undefined) return 'no price';
  if (cost === 0) return '$0';
  if (cost < 1) return `$${cost.toFixed(4)}`;
  if (cost < 100) return `$${cost.toFixed(2)}`;
  return `$${Math.round(cost).toLocaleString('en-US')}`;
};

export const fmtInt = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? DASH
    : Math.round(value).toLocaleString('en-US');

/** 11200000 -> "11.2M". */
export const fmtCompact = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return DASH;
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${+(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${+(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${+(value / 1e3).toFixed(1)}k`;
  return Math.round(value).toLocaleString('en-US');
};

/** Fraction (0..1) to "12.3%". */
export const fmtPct = (
  fraction: number | null | undefined,
  digits = 1
): string =>
  fraction === null || fraction === undefined || Number.isNaN(fraction)
    ? DASH
    : `${(fraction * 100).toFixed(digits)}%`;

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** ISO -> local "19:05:28.514". */
export const fmtClock = (iso: string | null | undefined, ms = true): string => {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  const base = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
  return ms ? `${base}.${pad(date.getMilliseconds(), 3)}` : base;
};

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/** Notice for agent jobs that finished without a recorded run. */
export const unrecordedMessage = (count: number) =>
  `${plural(count, 'agent job')} finished without a run in this window. ` +
  'Make sure the worker records runs with createAgentRun (or returns an ' +
  'AgentRunV1). See docs/agent-runs.md.';
