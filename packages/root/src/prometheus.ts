import type { Queue } from './queue';
import type { MetricsCollector } from './metrics-collector';

/**
 * Prometheus text exposition format, rendered by hand.
 *
 * Deliberately not using `prom-client`: the format is a handful of lines and
 * this is a library that ships in other people's dependency trees, so a
 * runtime dependency for string concatenation is a bad trade.
 *
 * Pull-based on purpose too — Grafana Alloy (`prometheus.scrape`), Grafana
 * Cloud and a self-hosted Prometheus all scrape this same endpoint, so one
 * implementation covers the three. Push (OTLP) would only be needed on
 * platforms where nothing can reach the process, which is not the case for a
 * dashboard that already serves HTTP.
 */

export const PROMETHEUS_CONTENT_TYPE =
  'text/plain; version=0.0.4; charset=utf-8';

const PREFIX = 'bull_horizon';

type Sample = {
  labels: Record<string, string>;
  value: number;
};

type Family = {
  name: string;
  help: string;
  type: 'gauge' | 'counter';
  samples: Sample[];
};

/** https://prometheus.io/docs/instrumenting/exposition_formats/ */
function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function renderFamily(family: Family): string {
  if (family.samples.length === 0) return '';
  const lines = [
    `# HELP ${family.name} ${family.help}`,
    `# TYPE ${family.name} ${family.type}`,
  ];
  for (const sample of family.samples) {
    const labels = Object.entries(sample.labels)
      .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
      .join(',');
    lines.push(`${family.name}{${labels}} ${sample.value}`);
  }
  return lines.join('\n');
}

const JOB_STATUSES = [
  'waiting',
  'active',
  'completed',
  'failed',
  'delayed',
  'paused',
  'prioritized',
] as const;

export async function renderPrometheusMetrics(
  queues: Queue[],
  collector?: MetricsCollector
): Promise<string> {
  const jobs: Family = {
    name: `${PREFIX}_queue_jobs`,
    help: 'Number of jobs currently in a queue, by status.',
    type: 'gauge',
    samples: [],
  };
  const paused: Family = {
    name: `${PREFIX}_queue_paused`,
    help: 'Whether the queue is paused (1) or running (0).',
    type: 'gauge',
    samples: [],
  };
  const completedTotal: Family = {
    name: `${PREFIX}_jobs_completed_total`,
    help: 'Jobs completed since this monitor process started.',
    type: 'counter',
    samples: [],
  };
  const failedTotal: Family = {
    name: `${PREFIX}_jobs_failed_total`,
    help: 'Jobs failed since this monitor process started.',
    type: 'counter',
    samples: [],
  };
  const processingTime: Family = {
    name: `${PREFIX}_job_processing_time_ms`,
    help: 'Job processing time over the last collected window, in milliseconds.',
    type: 'gauge',
    samples: [],
  };

  await Promise.all(
    queues.map(async (queue) => {
      const labels = { queue: queue.name, provider: queue.provider };
      const [counts, isPaused] = await Promise.all([
        queue.getJobCounts(),
        queue.isPaused(),
      ]);
      for (const status of JOB_STATUSES) {
        const value = (counts as Record<string, number | undefined>)[status];
        // `prioritized` only exists on providers that support it — emitting a
        // 0 there would be a claim we cannot back.
        if (typeof value !== 'number') continue;
        jobs.samples.push({ labels: { ...labels, status }, value });
      }
      paused.samples.push({ labels, value: isPaused ? 1 : 0 });

      if (!collector) return;
      const totals = collector.getThroughputTotals(queue.id);
      completedTotal.samples.push({ labels, value: totals.completed });
      failedTotal.samples.push({ labels, value: totals.failed });

      const [lastPoint] = await collector.extract(queue.id, -1, -1);
      if (!lastPoint) return;
      const stats: Array<[string, number | undefined]> = [
        ['avg', lastPoint.processingTime],
        ['min', lastPoint.processingTimeMin],
        ['max', lastPoint.processingTimeMax],
      ];
      for (const [stat, value] of stats) {
        if (typeof value !== 'number') continue;
        processingTime.samples.push({ labels: { ...labels, stat }, value });
      }
    })
  );

  return (
    [jobs, paused, completedTotal, failedTotal, processingTime]
      .map(renderFamily)
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}
