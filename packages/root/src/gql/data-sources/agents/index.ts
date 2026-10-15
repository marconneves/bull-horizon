import { BullMonitorError } from '../../../errors';
import { MetricsErrorEnum } from '../metrics/errors-enum';
import { BullErrorEnum } from '../bull/errors-enum';
import {
  applyAgentRunDetail,
  parseAgentRunLine,
  recordedAgentRunDetail,
} from '../../../agent';
import { clipId } from '../../../agent/limits';
import {
  AGENT_LOG_TAIL,
  AGENT_MAX_TOOLS,
  AGENT_OTHER_KEY,
  AGENT_STEPS_BUCKETS,
  agentRunOutcome,
  checkAgentDetailMismatch,
  emptyAgentPoint,
  isCurrentAttemptRun,
  latencyPercentile,
  mergeAgentPoints,
} from '../../../metrics/agent-metrics';
import { DEFAULT_AGENTS_CONFIG } from '../../../constants';
import type { MetricsCollector } from '../../../metrics-collector';
import type {
  TAgentPoint,
  TAgentRunIndexEntry,
} from '../../../metrics/agent-metrics';
import type { AgentRunDetail, AgentRunV1 } from '../../../agent';
import type { Job, Queue } from '../../../queue';
import type { AgentModelPrice, AgentsConfig } from '../../../typings/config';
import type {
  AgentConversation,
  AgentConversationMessage,
  AgentLatencyPoint,
  AgentQueueConfig as GqlAgentQueueConfig,
  AgentRun,
  AgentRunListItem,
  AgentRunsFilter,
  AgentRunsPage,
  AgentRunsSort,
  AgentsSummary,
  Maybe,
} from '../../../typings/gql';

const MAX_RUNS_LIMIT = 500;
/** Messages served per conversation (the newest). */
export const AGENT_CONVERSATION_MAX_MESSAGES = 100;
/** Jobs read in parallel while loading a conversation's runs. */
const CONVERSATION_READ_CONCURRENCY = 10;
/** Floor of the pause used by the `maybeIncomplete` heuristic. */
const CONVERSATION_MIN_GAP_MS = 30 * 60 * 1000;

const stringifyJson = (value: unknown): string | null => {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
};

const ratio = (part: number, total: number): number | null =>
  total > 0 ? part / total : null;

/**
 * Agent runs (read from the job logs) and agent aggregates (read from the
 * collector). Run reads work without the collector; aggregates do not.
 *
 * Cost is always computed here, on read, from `config.ai.pricing`: the UI
 * never sees a price, and a model without one yields `null`, never 0.
 */
export class AgentsDataSource {
  private _pricing: Map<string, AgentModelPrice> = new Map();
  private _config: Required<AgentsConfig>;

  constructor(
    private _queues: Queue[],
    private _queuesMap: Map<string, Queue>,
    private _collector?: MetricsCollector,
    config: AgentsConfig = {}
  ) {
    this._config = { ...DEFAULT_AGENTS_CONFIG, ...config };
    for (const [model, price] of Object.entries(this._config.pricing ?? {})) {
      if (
        price &&
        Number.isFinite(price.input) &&
        Number.isFinite(price.output)
      ) {
        this._pricing.set(model.toLowerCase(), price);
      }
    }
  }

  public getQueueAgent(queue: Queue): Maybe<GqlAgentQueueConfig> {
    const agent = queue.agent;
    if (!agent) return null;
    return {
      jobs: agent.jobs ?? null,
      detail: agent.detail as GqlAgentQueueConfig['detail'],
      label: agent.label,
    };
  }

  /** Every attempt of the job, in log order. Empty outside agent jobs. */
  public async getJobRuns(job: Job): Promise<AgentRun[]> {
    const queue = job.queue;
    const agent = queue.agent;
    if (!agent || !queue.isAgentJob(job.name)) return [];
    const { logs } = await queue.getJobLogs(job.id, -AGENT_LOG_TAIL, -1);
    const runs = (logs ?? [])
      .map(parseAgentRunLine)
      .filter((run): run is AgentRunV1 => !!run);
    return runs.map((run, i) =>
      this._toView(
        run,
        agent.detail,
        i === runs.length - 1 ? job : null,
        queue.name
      )
    );
  }

  public async getRun(
    queueId: string,
    jobId: string,
    attempt?: Maybe<number>
  ): Promise<Maybe<AgentRun>> {
    const queue = this._queuesMap.get(queueId);
    if (!queue) throw new BullMonitorError(BullErrorEnum.QUEUE_NOT_FOUND);
    const job = await queue.getJob(jobId);
    if (!job) return null;
    const runs = await this.getJobRuns(job);
    if (attempt == null) return runs[runs.length - 1] ?? null;
    // A manual retry can record the same attempt number twice; the newest wins.
    return runs.filter((run) => run.attempt === attempt).pop() ?? null;
  }

  public async getSummary(
    queueIds: Maybe<string[]> | undefined,
    since: number,
    until?: Maybe<number>,
    maxPoints?: Maybe<number>
  ): Promise<AgentsSummary> {
    const collector = this._requireCollector();
    const perQueue = await Promise.all(
      this._agentQueues(queueIds).map((queue) =>
        collector.agents.extractSince(queue.id, since, until ?? undefined)
      )
    );
    const byTimestamp: Map<number, TAgentPoint> = new Map();
    let total = emptyAgentPoint();
    for (const point of perQueue.flat()) {
      total = mergeAgentPoints(total, point);
      const bucket = byTimestamp.get(point.timestamp);
      byTimestamp.set(
        point.timestamp,
        bucket
          ? // Same tick across queues: the widths agree, do not add them.
            { ...mergeAgentPoints(bucket, point), windowMs: bucket.windowMs }
          : point
      );
    }
    const series = Array.from(byTimestamp.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );
    const timed = total.lat.reduce((a, b) => a + b, 0);
    const models = Object.entries(total.models)
      .map(([model, stats]) => ({
        model,
        runs: stats.r,
        inputTokens: stats.i,
        outputTokens: stats.o,
        cost: this._cost(model, stats.i, stats.o),
      }))
      .sort((a, b) => b.runs - a.runs);
    const priced = models.filter((m) => m.cost !== null);
    const stepsWeight = total.steps.reduce((sum, count) => sum + count, 0);
    return {
      runs: total.runs,
      failed: total.failed,
      lost: total.lost,
      p50: latencyPercentile(total.lat, 0.5, total.durMax),
      p95: latencyPercentile(total.lat, 0.95, total.durMax),
      avgDurationMs: ratio(total.durSum, timed),
      llmShare: ratio(total.llmMs, total.llmMs + total.toolMs),
      inputTokens: models.reduce((sum, m) => sum + m.inputTokens, 0),
      outputTokens: models.reduce((sum, m) => sum + m.outputTokens, 0),
      cost: priced.length
        ? priced.reduce((sum, m) => sum + (m.cost as number), 0)
        : null,
      hasUnpricedModels: models.some((m) => m.cost === null && m.runs > 0),
      // The 5+ bucket counts as 5: a floor, not an exact mean.
      avgSteps: ratio(
        total.steps.reduce((sum, count, i) => sum + count * (i + 1), 0),
        stepsWeight
      ),
      runsWithEmptyTool: total.emptyRuns,
      latency: this._downsample(series, maxPoints).map(
        (point): AgentLatencyPoint => ({
          timestamp: point.timestamp,
          windowMs: point.windowMs,
          runs: point.runs,
          failed: point.failed,
          p50: latencyPercentile(point.lat, 0.5, point.durMax),
          p95: latencyPercentile(point.lat, 0.95, point.durMax),
        })
      ),
      steps: AGENT_STEPS_BUCKETS.map((label, i) => ({
        label,
        count: total.steps[i] ?? 0,
      })),
      tools: Object.entries(total.tools)
        .map(([name, stats]) => ({
          name,
          calls: stats.c,
          avgDurationMs: ratio(stats.ms, stats.c) ?? 0,
          errorRate: ratio(stats.e, stats.c) ?? 0,
          emptyRate: ratio(stats.z, stats.c) ?? 0,
        }))
        .sort((a, b) => b.calls - a.calls),
      models,
      outcomes: Object.entries(total.outcomes)
        .map(([outcome, count]) => ({ outcome, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  public async getRuns(args: {
    queues?: Maybe<string[]> | undefined;
    since: number;
    filter?: Maybe<AgentRunsFilter>;
    slowMs?: Maybe<number>;
    sort?: Maybe<AgentRunsSort>;
    offset?: Maybe<number>;
    limit?: Maybe<number>;
  }): Promise<AgentRunsPage> {
    const collector = this._requireCollector();
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 50;
    if (offset < 0) throw new BullMonitorError(BullErrorEnum.BAD_OFFSET);
    if (limit < 1) throw new BullMonitorError(BullErrorEnum.BAD_LIMIT);
    const slowMs = args.slowMs ?? 15000;
    const perQueue = await Promise.all(
      this._agentQueues(args.queues).map(async (queue) =>
        (
          await collector.agents.getRecentRuns(queue.id, args.since)
        ).map((entry) => this._toListItem(queue.id, entry))
      )
    );
    const all = perQueue.flat();
    const matches: Record<string, (item: AgentRunListItem) => boolean> = {
      all: () => true,
      failed: (item) => item.outcome === 'error',
      emptyTool: (item) => item.tools.some((tool) => tool.empty),
      slow: (item) => (item.durationMs ?? 0) >= slowMs,
    };
    const filtered = all.filter(matches[args.filter ?? 'all'] ?? matches.all);
    // Missing values sort last whatever the key.
    const desc = (a?: Maybe<number>, b?: Maybe<number>) =>
      (b ?? -Infinity) - (a ?? -Infinity);
    const sorters: Record<
      string,
      (a: AgentRunListItem, b: AgentRunListItem) => number
    > = {
      recent: (a, b) => b.finishedAt - a.finishedAt,
      slowest: (a, b) => desc(a.durationMs, b.durationMs),
      costliest: (a, b) => desc(a.cost, b.cost),
    };
    filtered.sort(sorters[args.sort ?? 'recent'] ?? sorters.recent);
    return {
      total: filtered.length,
      counts: {
        all: all.length,
        failed: all.filter(matches.failed).length,
        emptyTool: all.filter(matches.emptyTool).length,
        slow: all.filter(matches.slow).length,
      },
      items: filtered.slice(offset, offset + Math.min(limit, MAX_RUNS_LIMIT)),
    };
  }

  /**
   * Runs of the queue's recent runs index sharing `input.conversationId`.
   * Bounded twice: the index holds at most `recentRuns` entries, and only the
   * newest 100 messages are loaded from the job logs (200-line tail each,
   * 10 jobs at a time). Null outside agent queues.
   */
  public async getConversation(
    queueId: string,
    rawConversationId: string
  ): Promise<Maybe<AgentConversation>> {
    const collector = this._requireCollector();
    const queue = this._queuesMap.get(queueId);
    if (!queue) throw new BullMonitorError(BullErrorEnum.QUEUE_NOT_FOUND);
    if (!queue.agent) return null;
    // Same cap as the writer, so a long id still matches its stored form.
    const conversationId = clipId(rawConversationId);
    const { entries, full } = await collector.agents.getAllRecentRuns(queue.id);
    // One message per job: its highest attempt, the newest on a tie (a
    // manual retry can record the same attempt number twice). A Map, so ids
    // like `__proto__` are plain keys.
    const byJob: Map<string, TAgentRunIndexEntry> = new Map();
    for (const entry of entries) {
      if (
        !Object.prototype.hasOwnProperty.call(entry, 'c') ||
        typeof entry.c !== 'string' ||
        clipId(entry.c) !== conversationId ||
        typeof entry.t !== 'number' ||
        typeof entry.a !== 'number'
      ) {
        continue;
      }
      // Not clipped: the writer stores the job id whole, and it is a lookup key.
      const jobId = String(entry.j);
      const kept = byJob.get(jobId);
      if (
        !kept ||
        entry.a > kept.a ||
        (entry.a === kept.a && entry.t >= kept.t)
      ) {
        byJob.set(jobId, entry);
      }
    }
    const sorted = Array.from(byJob.values()).sort((a, b) => a.t - b.t);
    const listed = sorted.slice(-AGENT_CONVERSATION_MAX_MESSAGES);
    const loaded: Array<{
      message: AgentConversationMessage;
      tools: string[];
    }> = [];
    for (let i = 0; i < listed.length; i += CONVERSATION_READ_CONCURRENCY) {
      loaded.push(
        ...(await Promise.all(
          listed
            .slice(i, i + CONVERSATION_READ_CONCURRENCY)
            .map((entry) => this._toMessage(queue, entry))
        ))
      );
    }
    const messages = loaded.map((item) => item.message);
    const toolNames = loaded.flatMap((item) => item.tools);
    return {
      queue: queue.id,
      conversationId,
      messages,
      maybeIncomplete:
        sorted.length > listed.length ||
        (full && this._olderMessageLikelyEvicted(sorted, entries)),
      totals: {
        ...this._conversationTotals(messages),
        toolCalls: toolNames.length,
      },
      tools: this._toolCounts(toolNames),
    };
  }

  /**
   * With the index at its cap, an older message of the conversation was
   * likely evicted when the index does not reach back further before the
   * first message than the conversation's own largest pause (at least 30
   * minutes). If it does reach that far, an older message would most likely
   * still be in it.
   */
  private _olderMessageLikelyEvicted(
    sorted: TAgentRunIndexEntry[],
    entries: TAgentRunIndexEntry[]
  ): boolean {
    if (!sorted.length) return false;
    const start = (entry: TAgentRunIndexEntry) =>
      typeof entry.d === 'number' && entry.d >= 0 ? entry.t - entry.d : entry.t;
    let oldest = Infinity;
    for (const entry of entries) {
      if (typeof entry.t === 'number' && entry.t < oldest) oldest = entry.t;
    }
    let maxGap = CONVERSATION_MIN_GAP_MS;
    for (let i = 1; i < sorted.length; i++) {
      maxGap = Math.max(maxGap, start(sorted[i]) - sorted[i - 1].t);
    }
    return start(sorted[0]) - oldest <= maxGap;
  }

  /**
   * The message plus the names of the tools it called: from the run when
   * the log still holds it (complete), else from the index chain (first 30).
   */
  private async _toMessage(
    queue: Queue,
    entry: TAgentRunIndexEntry
  ): Promise<{ message: AgentConversationMessage; tools: string[] }> {
    const jobId = String(entry.j);
    const model = clipId(entry.m);
    const durationMs =
      typeof entry.d === 'number' && entry.d >= 0 ? entry.d : null;
    const job = await queue.getJob(jobId);
    const runs = job ? await this.getJobRuns(job) : [];
    const run = runs.filter((r) => r.attempt === entry.a).pop() ?? null;
    const tools = run
      ? run.steps.flatMap((step) => step.tools.map((tool) => tool.name))
      : (Array.isArray(entry.tc) ? entry.tc : []).map(([name]) => clipId(name));
    const message: AgentConversationMessage = {
      jobId,
      attempt: entry.a,
      startedAt: durationMs === null ? null : entry.t - durationMs,
      finishedAt: entry.t,
      durationMs,
      model,
      inputTokens: entry.i,
      outputTokens: entry.o,
      cost: this._cost(model, entry.i, entry.o),
      outcome: clipId(entry.oc),
      steps: entry.s,
      run,
      jobRemoved: !job,
    };
    return { message, tools };
  }

  private _conversationTotals(
    messages: AgentConversationMessage[]
  ): Omit<AgentConversation['totals'], 'toolCalls'> {
    const first = messages[0];
    const last = messages[messages.length - 1];
    const priced = messages.filter((m) => m.cost != null);
    const sum = (pick: (m: AgentConversationMessage) => number) =>
      messages.reduce((total, m) => total + pick(m), 0);
    return {
      messages: messages.length,
      durationMs:
        first?.startedAt != null && last
          ? Math.max(last.finishedAt - first.startedAt, 0)
          : null,
      aiMs: sum((m) => m.durationMs ?? 0),
      inputTokens: sum((m) => m.inputTokens),
      outputTokens: sum((m) => m.outputTokens),
      cost: priced.length
        ? priced.reduce((total, m) => total + (m.cost as number), 0)
        : null,
      hasUnpricedMessages: priced.length < messages.length,
      steps: sum((m) => m.steps),
    };
  }

  /** Most used first; past 50 names the rest fold into `(other)`. */
  private _toolCounts(names: string[]): AgentConversation['tools'] {
    const counts: Map<string, number> = new Map();
    for (const raw of names) {
      const name = clipId(raw);
      const key =
        counts.has(name) || counts.size < AGENT_MAX_TOOLS
          ? name
          : AGENT_OTHER_KEY;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts, ([name, count]) => ({ name, count })).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    );
  }

  /**
   * Serves the run at the level the queue declares, never above it: a line
   * recorded at full on a queue declared basic (or a legacy payload, which
   * counts as full) is cut again here. The content stays in Redis — this is
   * defense in depth, flagged by `detailMismatch`.
   */
  private _toView(
    stored: AgentRunV1,
    declared: AgentRunDetail,
    lastAttemptJob: Job | null,
    queueName: string
  ): AgentRun {
    const recorded = recordedAgentRunDetail(stored);
    const detailMismatch = checkAgentDetailMismatch(
      queueName,
      declared,
      stored
    );
    const run = applyAgentRunDetail(
      stored,
      detailMismatch ? 'basic' : recorded
    );
    const last = run.steps[run.steps.length - 1];
    const { overheadStartMs, overheadEndMs } = this._overhead(
      run,
      lastAttemptJob
    );
    return {
      v: run.v,
      detail: run.detail as AgentRun['detail'],
      detailMismatch,
      model: run.model,
      attempt: run.attempt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      finishReason: last?.finishReason ?? null,
      outcome: agentRunOutcome(run),
      cost: this._cost(run.model, run.inputTokens, run.outputTokens),
      overheadStartMs,
      overheadEndMs,
      steps: run.steps.map((step) => ({
        step: step.step,
        startedAt: step.startedAt,
        durationMs: step.durationMs,
        finishReason: step.finishReason,
        inputTokens: step.inputTokens,
        outputTokens: step.outputTokens,
        cost:
          step.inputTokens == null && step.outputTokens == null
            ? null
            : this._cost(
                run.model,
                step.inputTokens ?? 0,
                step.outputTokens ?? 0
              ),
        text: step.text ?? null,
        tools: step.tools.map((tool) => ({
          name: tool.name,
          ok: tool.ok,
          durationMs: tool.durationMs,
          summary: tool.summary,
          empty: tool.empty ?? null,
          startedAt: tool.startedAt ?? null,
          outputChars: tool.outputChars ?? null,
          input: stringifyJson(tool.input),
          output: stringifyJson(tool.output),
          error: tool.error ?? null,
        })),
      })),
      final: run.final
        ? { text: run.final.text ?? null, cards: run.final.cards }
        : null,
      error: run.error,
      input: run.input
        ? {
            conversationId: run.input.conversationId ?? null,
            text: run.input.text ?? null,
          }
        : null,
      truncated: !!run.truncated,
    };
  }

  /**
   * Time between the job starting and the run starting, and between the run
   * ending and the job ending. Only when the run is the job's current
   * attempt: `processedOn`/`finishedOn` are overwritten on every attempt, so
   * while attempt N+1 runs (or after a manual retry that has no line yet) the
   * newest line is attempt N and the subtraction would mix two attempts.
   * Never negative: a negative gap means mismatched attempts, so `null`.
   */
  private _overhead(
    run: AgentRunV1,
    job: Job | null
  ): { overheadStartMs: number | null; overheadEndMs: number | null } {
    const none = { overheadStartMs: null, overheadEndMs: null };
    const processedOn = job?.processedOn;
    const startedAt = Date.parse(run.startedAt);
    if (!processedOn || !Number.isFinite(startedAt)) return none;
    if (!isCurrentAttemptRun(run, processedOn)) return none;
    const overheadStartMs = startedAt - processedOn;
    if (overheadStartMs < 0) return none;
    const finishedAt = run.finishedAt ? Date.parse(run.finishedAt) : NaN;
    const jobFinishedOn = job?.finishedOn;
    // `finishedOn` before `processedOn` is left over from an earlier attempt.
    const overheadEndMs =
      jobFinishedOn &&
      jobFinishedOn >= processedOn &&
      Number.isFinite(finishedAt) &&
      jobFinishedOn >= finishedAt
        ? jobFinishedOn - finishedAt
        : null;
    return { overheadStartMs, overheadEndMs };
  }

  private _toListItem(
    queue: string,
    entry: TAgentRunIndexEntry
  ): AgentRunListItem {
    // Index entries are read back from Redis: identifiers re-capped here.
    const model = clipId(entry.m);
    return {
      queue,
      jobId: entry.j,
      jobName: clipId(entry.n),
      attempt: entry.a,
      finishedAt: entry.t,
      durationMs: entry.d,
      model,
      steps: entry.s,
      inputTokens: entry.i,
      outputTokens: entry.o,
      cost: this._cost(model, entry.i, entry.o),
      outcome: clipId(entry.oc),
      tools: (Array.isArray(entry.tc) ? entry.tc : []).map(
        ([name, ok, empty]) => ({
          name: clipId(name),
          ok: ok === 1,
          empty: empty === 1,
        })
      ),
      error: entry.e ?? null,
    };
  }

  /** USD; `null` when the model has no price (never 0). */
  private _cost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number | null {
    const price = this._pricing.get(String(model).toLowerCase());
    if (!price) return null;
    return (inputTokens * price.input + outputTokens * price.output) / 1e6;
  }

  /**
   * Requested queues that are agent queues; none requested = all of them.
   * Walks the configured queues, not the argument: repeated or unknown ids
   * cost nothing, and the result is at most one entry per agent queue.
   */
  private _agentQueues(ids?: Maybe<string[]> | undefined): Queue[] {
    const agentQueues = this._queues.filter((queue) => !!queue.agent);
    if (!ids?.length) return agentQueues;
    const wanted = new Set(ids);
    return agentQueues.filter((queue) => wanted.has(queue.id));
  }

  /**
   * Buckets of consecutive points merged together, stamped with the last
   * timestamp of the bucket (same rule as the throughput downsampling).
   */
  private _downsample(
    points: TAgentPoint[],
    maxPoints?: Maybe<number>
  ): TAgentPoint[] {
    if (!maxPoints || maxPoints < 1 || points.length <= maxPoints) {
      return points;
    }
    const size = Math.ceil(points.length / maxPoints);
    const buckets: TAgentPoint[] = [];
    for (let i = 0; i < points.length; i += size) {
      const bucket = points.slice(i, i + size);
      const merged = bucket.reduce(mergeAgentPoints);
      buckets.push({
        ...merged,
        timestamp: bucket[bucket.length - 1].timestamp,
      });
    }
    return buckets;
  }

  private _requireCollector(): MetricsCollector {
    if (!this._collector) {
      throw new BullMonitorError(MetricsErrorEnum.NO_COLLECTOR);
    }
    return this._collector;
  }
}
