// Pure formatters of the Flows screen. No imports: unit-testable.

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** Epoch ms -> local "13:02:11.4". */
export const clockMs = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds()
  )}.${Math.floor(d.getMilliseconds() / 100)}`;
};

/** 6.4 -> "6.4/min", 0.04 -> "<0.1/min", 128 -> "128/min". */
export const fmtPerMin = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value === 0) return '0/min';
  if (value < 0.1) return '<0.1/min';
  if (value < 100) return `${+value.toFixed(1)}/min`;
  return `${Math.round(value)}/min`;
};
