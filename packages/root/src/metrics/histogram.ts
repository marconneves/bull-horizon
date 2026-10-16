/**
 * Fixed-band histograms shared by the agent and flow series. Mergeable by
 * summing counts position by position; percentiles are interpolated on read.
 * Zero dependency on purpose (lesson of the 004 agent metrics).
 */

/** Index of the band holding `value`. `bounds.length` = overflow. */
export function histogramBand(value: number, bounds: number[]): number {
  const index = bounds.findIndex((bound) => value <= bound);
  return index === -1 ? bounds.length : index;
}

/**
 * Estimated quantile from the band counts: walk the bands up to `q * total`,
 * then interpolate linearly inside the band. The overflow band answers `max`.
 * Never reports more than was observed (`max`, when known). Error is at most
 * the width of the band. `null` without samples.
 */
export function histogramQuantile(
  counts: ArrayLike<number>,
  bounds: number[],
  q: number,
  max: number
): number | null {
  let total = 0;
  for (let i = 0; i < counts.length; i++) total += counts[i] ?? 0;
  if (!total) return null;
  const target = q * total;
  let cumulative = 0;
  for (let i = 0; i < counts.length; i++) {
    const count = counts[i] ?? 0;
    if (count && cumulative + count >= target) {
      if (i >= bounds.length) return max;
      const lower = i === 0 ? 0 : bounds[i - 1];
      const upper = bounds[i];
      const estimate =
        lower + ((target - cumulative) / count) * (upper - lower);
      return max > 0 ? Math.min(estimate, max) : estimate;
    }
    cumulative += count;
  }
  return max;
}

/** Sparse histogram: band index -> count. JSON turns the keys into strings. */
export type TSparseHistogram = Record<number, number>;

/**
 * Dense counts from a sparse histogram read back from Redis. Own keys only,
 * integer indexes in `[0, bands)`, finite non-negative counts: anything else
 * is ignored (the reader does not trust the writer).
 */
export function denseHistogram(hist: unknown, bands: number): number[] {
  const out = new Array(bands).fill(0);
  if (!hist || typeof hist !== 'object' || Array.isArray(hist)) return out;
  for (const key of Object.keys(hist as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= bands) continue;
    const count = (hist as Record<string, unknown>)[key];
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
      out[index] += count;
    }
  }
  return out;
}

/** Sparse sum of two sparse histograms (either may come from JSON). */
export function mergeSparseHistograms(
  a: unknown,
  b: unknown,
  bands: number
): TSparseHistogram {
  const dense = denseHistogram(a, bands);
  const other = denseHistogram(b, bands);
  const out: TSparseHistogram = Object.create(null);
  for (let i = 0; i < bands; i++) {
    const count = dense[i] + other[i];
    if (count) out[i] = count;
  }
  return out;
}
