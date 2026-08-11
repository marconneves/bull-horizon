import { renderPrometheusMetrics } from '../prometheus';
import type { Queue } from '../queue';
import type { MetricsCollector } from '../metrics-collector';

type FakeQueueOptions = {
  name: string;
  provider?: string;
  counts?: Record<string, number>;
  isPaused?: boolean;
};

const fakeQueue = ({
  name,
  provider = 'bull',
  counts = {},
  isPaused = false,
}: FakeQueueOptions): Queue =>
  ({
    id: `id:${name}`,
    name,
    provider,
    getJobCounts: async () => ({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
      ...counts,
    }),
    isPaused: async () => isPaused,
  } as unknown as Queue);

describe('renderPrometheusMetrics', () => {
  it('renders job counts per status with queue and provider labels', async () => {
    const output = await renderPrometheusMetrics([
      fakeQueue({ name: 'emails', counts: { waiting: 3, failed: 1 } }),
    ]);

    expect(output).toContain('# TYPE bull_horizon_queue_jobs gauge');
    expect(output).toContain(
      'bull_horizon_queue_jobs{queue="emails",provider="bull",status="waiting"} 3'
    );
    expect(output).toContain(
      'bull_horizon_queue_jobs{queue="emails",provider="bull",status="failed"} 1'
    );
  });

  it('omits statuses the provider does not report instead of claiming zero', async () => {
    const output = await renderPrometheusMetrics([
      fakeQueue({ name: 'emails' }),
    ]);

    // `prioritized` is absent from the counts object above, so no sample for
    // it — reporting 0 would be indistinguishable from "supported and empty".
    expect(output).not.toContain('status="prioritized"');
    expect(output).toContain('status="waiting"');
  });

  it('reports the paused flag as a 0/1 gauge', async () => {
    const output = await renderPrometheusMetrics([
      fakeQueue({ name: 'a', isPaused: true }),
      fakeQueue({ name: 'b', isPaused: false }),
    ]);

    expect(output).toContain(
      'bull_horizon_queue_paused{queue="a",provider="bull"} 1'
    );
    expect(output).toContain(
      'bull_horizon_queue_paused{queue="b",provider="bull"} 0'
    );
  });

  it('escapes quotes and backslashes in label values', async () => {
    const output = await renderPrometheusMetrics([
      fakeQueue({ name: 'we"ird\\name' }),
    ]);

    expect(output).toContain('queue="we\\"ird\\\\name"');
  });

  it('omits throughput counters entirely when no collector is configured', async () => {
    const output = await renderPrometheusMetrics([fakeQueue({ name: 'a' })]);

    expect(output).not.toContain('bull_horizon_jobs_completed_total');
    expect(output).not.toContain('bull_horizon_job_processing_time_ms');
  });

  it('renders throughput counters and processing time from the collector', async () => {
    const collector = {
      getThroughputTotals: () => ({ completed: 42, failed: 7 }),
      extract: async () => [
        {
          queue: 'id:a',
          timestamp: 1,
          counts: {} as any,
          processingTime: 12.5,
          processingTimeMin: 2,
          processingTimeMax: 30,
        },
      ],
    } as unknown as MetricsCollector;

    const output = await renderPrometheusMetrics(
      [fakeQueue({ name: 'a' })],
      collector
    );

    expect(output).toContain(
      '# TYPE bull_horizon_jobs_completed_total counter'
    );
    expect(output).toContain(
      'bull_horizon_jobs_completed_total{queue="a",provider="bull"} 42'
    );
    expect(output).toContain(
      'bull_horizon_jobs_failed_total{queue="a",provider="bull"} 7'
    );
    expect(output).toContain(
      'bull_horizon_job_processing_time_ms{queue="a",provider="bull",stat="avg"} 12.5'
    );
    expect(output).toContain('stat="min"} 2');
    expect(output).toContain('stat="max"} 30');
  });

  it('ends with a newline, as the exposition format requires', async () => {
    const output = await renderPrometheusMetrics([fakeQueue({ name: 'a' })]);
    expect(output.endsWith('\n')).toBe(true);
  });
});
