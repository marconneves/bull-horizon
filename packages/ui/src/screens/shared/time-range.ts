import { useState, useCallback } from 'react';

export type TTimeRange = {
  label: string;
  ms: number;
  /** Cap on points requested from the server for this range. */
  maxPoints: number;
};

/**
 * The ranges stop at 3 days on purpose: that is what the default retention
 * (`maxMetrics: 4320` at a one-minute interval) can actually back. Offering a
 * 90-day button over a 3-day series would just render an empty chart with a
 * confident label on it.
 */
export const TIME_RANGES: TTimeRange[] = [
  { label: '60m', ms: 60 * 60 * 1000, maxPoints: 60 },
  { label: '24h', ms: 24 * 60 * 60 * 1000, maxPoints: 144 },
  { label: '3d', ms: 3 * 24 * 60 * 60 * 1000, maxPoints: 216 },
];

export const DEFAULT_TIME_RANGE = TIME_RANGES[1];

export const useTimeRange = (initial: TTimeRange = DEFAULT_TIME_RANGE) => {
  const [range, setRange] = useState<TTimeRange>(initial);
  const changeRange = useCallback((next: TTimeRange) => setRange(next), []);
  // Quantized to the range's own resolution. react-query compares keys by
  // value, so a raw `Date.now()` here would produce a new key on every render
  // and defeat the cache entirely; snapping to a bucket keeps it stable until
  // the window has actually moved.
  const bucket = Math.max(Math.floor(range.ms / range.maxPoints), 1000);
  const since = Math.floor((Date.now() - range.ms) / bucket) * bucket;
  return { range, changeRange, since };
};
