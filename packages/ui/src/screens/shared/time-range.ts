import { useState, useCallback, useMemo } from 'react';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';

export type TTimeRange = {
  label: string;
  ms: number;
  /** Cap on points requested from the server for this range. */
  maxPoints: number;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The full menu. Which of these are actually offered is decided at runtime from
 * the retention the server reports — the server rolls old points into coarser
 * buckets, so how far back it can answer is a matter of configuration, not a
 * constant we can hardcode here.
 */
export const ALL_TIME_RANGES: TTimeRange[] = [
  { label: '60m', ms: HOUR, maxPoints: 60 },
  { label: '6h', ms: 6 * HOUR, maxPoints: 72 },
  { label: '24h', ms: DAY, maxPoints: 144 },
  { label: '7d', ms: 7 * DAY, maxPoints: 168 },
  { label: '30d', ms: 30 * DAY, maxPoints: 180 },
  { label: '90d', ms: 90 * DAY, maxPoints: 180 },
];

/** Used until the server has answered, and as the floor if it reports nothing. */
const FALLBACK_RANGES = ALL_TIME_RANGES.slice(0, 3);

export const useAvailableTimeRanges = (): TTimeRange[] => {
  const {
    queries: { getMetricsInfo },
  } = useNetwork();
  const { data } = useQuery(QueryKeysConfig.metricsInfo, getMetricsInfo, {
    // Server configuration, not live state.
    staleTime: Infinity,
  });
  const retentionMs = data?.metricsInfo?.retentionMs;
  return useMemo(() => {
    if (!retentionMs) return FALLBACK_RANGES;
    // Keep the first range that exceeds retention: a window slightly wider than
    // the data is a chart that trails off, which reads correctly. Every range
    // after that would be empty space with a confident label.
    const available: TTimeRange[] = [];
    for (const range of ALL_TIME_RANGES) {
      available.push(range);
      if (range.ms >= retentionMs) break;
    }
    return available;
  }, [retentionMs]);
};

export const useTimeRange = () => {
  const ranges = useAvailableTimeRanges();
  const [label, setLabel] = useState<string | null>(null);
  // Default to 24h when it is available, otherwise the widest on offer.
  const range =
    ranges.find((r) => r.label === label) ??
    ranges.find((r) => r.label === '24h') ??
    ranges[ranges.length - 1];
  const changeRange = useCallback(
    (next: TTimeRange) => setLabel(next.label),
    []
  );

  // Quantized to the range's own resolution. react-query compares keys by
  // value, so a raw `Date.now()` here would produce a new key on every render
  // and defeat the cache entirely; snapping to a bucket keeps it stable until
  // the window has actually moved.
  const bucket = Math.max(Math.floor(range.ms / range.maxPoints), 1000);
  const since = Math.floor((Date.now() - range.ms) / bucket) * bucket;
  return { range, ranges, changeRange, since };
};
