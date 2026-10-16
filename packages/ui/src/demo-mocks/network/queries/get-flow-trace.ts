import { FlowTraceMatch } from '@/typings/gql';
import type {
  GetFlowTraceQuery,
  GetFlowTraceQueryVariables,
} from '@/typings/gql';
import { FLOW_ID, flowTracesMock } from '../flows/content-ingest';
import type { TDemoTraceJob } from '../flows/content-ingest';

type TResult = NonNullable<GetFlowTraceQuery['flowTrace']>;
type TTrace = NonNullable<TResult['trace']>;

const MAX_QUERY_CHARS = 256;

const toJob = (job: TDemoTraceJob): TTrace['jobs'][0] => ({
  stepId: job.stepId,
  queueId: job.queueId,
  jobId: job.jobId,
  attempt: job.attempt,
  status: job.status,
  parentQueueId: job.parentQueueId,
  parentJobId: job.parentJobId,
  parentStepId: job.parentStepId,
  enqueuedAt: job.enqueuedAt,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  waitMs: job.waitMs,
  processMs: job.processMs,
  failedReason: job.failedReason,
  fallback: job.fallback,
  pending: job.pending,
});

/**
 * Same resolution as the server: exact trace id, then job id, then business
 * key (several executions = candidates, newest first). Exact match only.
 */
export const getFlowTraceMock = async ({
  flow,
  query,
  traceId,
}: GetFlowTraceQueryVariables): Promise<GetFlowTraceQuery> => {
  if (flow !== FLOW_ID) return { flowTrace: null };
  const q = query.trim();
  if (!q.length || q.length > MAX_QUERY_CHARS) {
    throw new Error(`query must have 1 to ${MAX_QUERY_CHARS} characters`);
  }
  const traces = flowTracesMock();
  const toTrace = (t: (typeof traces)[0]): TTrace => {
    const jobs = t.jobs.map(toJob);
    const longest = jobs.reduce<TTrace['jobs'][0] | null>(
      (best, job) => ((job.waitMs ?? 0) > (best?.waitMs ?? -1) ? job : best),
      null
    );
    return {
      traceId: t.traceId,
      key: t.key,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      durationMs: t.finishedAt === null ? null : t.finishedAt - t.startedAt,
      status: t.status,
      jobs,
      longestWait: longest,
      truncated: false,
      partial: false,
    };
  };
  const result = (
    matchedBy: FlowTraceMatch,
    trace: TTrace | null,
    candidates: TResult['candidates'] = []
  ): GetFlowTraceQuery => ({
    flowTrace: { matchedBy, trace, candidates, indexFull: false },
  });

  const byId = traces.find((t) => t.traceId === q);
  if (byId) return result(FlowTraceMatch.TraceId, toTrace(byId));
  const byJob = traces.find((t) => t.jobs.some((j) => j.jobId === q));
  if (byJob) return result(FlowTraceMatch.JobId, toTrace(byJob));
  const byKey = traces
    .filter((t) => t.key === q)
    .sort((a, b) => b.startedAt - a.startedAt);
  if (byKey.length) {
    const chosen = byKey.find((t) => t.traceId === traceId) ?? byKey[0];
    return result(
      FlowTraceMatch.Key,
      toTrace(chosen),
      byKey.length > 1
        ? byKey.map((t) => ({
            traceId: t.traceId,
            startedAt: t.startedAt,
            status: t.status,
          }))
        : []
    );
  }
  return result(FlowTraceMatch.None, null);
};
