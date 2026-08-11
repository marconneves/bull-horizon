/**
 * Mirrors the server-side downsampling in `MetricsCollector` so the demo build
 * shows the same shape a real deployment does: counters summed per bucket,
 * gauges taken from the bucket's last point. Without it the demo renders every
 * raw minute and reads as noise, which the real endpoint never returns.
 */
export const downsample = <T extends Record<string, any>>(
  points: T[],
  maxPoints: number | null | undefined,
  sumKeys: Array<keyof T>
): T[] => {
  if (!maxPoints || maxPoints < 1 || points.length <= maxPoints) return points;
  const bucketSize = Math.ceil(points.length / maxPoints);
  const buckets: T[] = [];
  for (let i = 0; i < points.length; i += bucketSize) {
    const bucket = points.slice(i, i + bucketSize);
    const last = { ...bucket[bucket.length - 1] };
    for (const key of sumKeys) {
      last[key] = bucket.reduce(
        (acc, point) => acc + ((point[key] as unknown as number) ?? 0),
        0
      ) as T[keyof T];
    }
    buckets.push(last);
  }
  return buckets;
};
