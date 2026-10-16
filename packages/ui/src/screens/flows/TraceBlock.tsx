import React, { memo } from 'react';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { QueryKeysConfig } from '@/config/query-keys';
import Spin from '@/components/Spin';
import { traceBlock } from './model';
import type { TTrace, TTraceJob } from './model';
import { JsonBlock, useFlowPartStyles } from './parts';

/**
 * The job's `data._trace`, read from the job itself (`Query.job`); only a
 * removed job falls back to the reconstruction from the trace index, and
 * says so.
 */
function TraceBlock({
  job,
  trace,
  flowId,
}: {
  job: TTraceJob;
  trace: TTrace;
  flowId: string;
}) {
  const parts = useFlowPartStyles();
  const {
    queries: { getJobData },
  } = useNetwork();
  const { status, data } = useQuery(
    [QueryKeysConfig.jobData, 'flow-trace', job.queueId, job.jobId],
    () => getJobData({ queue: job.queueId, id: job.jobId }),
    { staleTime: 60_000 }
  );
  const block = traceBlock(
    job,
    trace,
    flowId,
    status === 'loading' || status === 'idle'
      ? { loading: true }
      : { loading: false, record: data?.job ?? null }
  );
  return (
    <>
      <span className={parts.label}>
        data._trace
        {block.source === 'index' &&
          (block.reason === 'removed'
            ? ' · reconstructed from the trace index (job removed)'
            : ' · reconstructed from the trace index (no _trace in the job data)')}
      </span>
      {block.source === 'loading' ? (
        <Spin size={16} centered={false} />
      ) : (
        <JsonBlock value={block.value} label="data._trace" />
      )}
    </>
  );
}

export default memo(TraceBlock);
