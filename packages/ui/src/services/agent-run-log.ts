/**
 * Mirrors `AGENT_RUN_LOG_PREFIX` from `@bull-horizon/root`: the job log line
 * that carries one attempt's agent run. Everything after it is JSON.
 */
export const AGENT_RUN_LOG_PREFIX = 'bull-horizon:agent-run ';

/** Same ceiling the server parser uses; bigger lines are not runs it reads. */
const MAX_LINE_CHARS = 512 * 1024;

export type TAgentRunLogLine = {
  /** Null when the line could not be read. */
  attempt: number | null;
  chars: number;
};

export const isAgentRunLogLine = (line: string | null | undefined) =>
  !!line && line.startsWith(AGENT_RUN_LOG_PREFIX);

export const readAgentRunLogLine = (line: string): TAgentRunLogLine => {
  const chars = line.length;
  if (chars > MAX_LINE_CHARS) return { attempt: null, chars };
  try {
    const parsed = JSON.parse(line.slice(AGENT_RUN_LOG_PREFIX.length));
    const attempt =
      parsed && typeof parsed.attempt === 'number' ? parsed.attempt : null;
    return { attempt, chars };
  } catch (_e) {
    return { attempt: null, chars };
  }
};

/** The parts of a queue's `agent` config that decide which jobs are runs. */
export type TAgentJobsConfig = {
  jobs?: ReadonlyArray<string> | null;
};

/**
 * Mirrors `Queue.isAgentJob` on the server: only agent queues have runs, and
 * an agent queue without a `jobs` list treats every job as one. Runs outside
 * that scope are never read by the server, so the UI must not offer them.
 */
export const isAgentJob = (
  agent: TAgentJobsConfig | null | undefined,
  jobName: string | null | undefined
): boolean =>
  !!agent && (!agent.jobs || (!!jobName && agent.jobs.includes(jobName)));

/**
 * Whether the Logs modal collapses a line into the agent-run summary: it must
 * carry the prefix and belong to a job the server reads runs for. Anything
 * else is shown raw, since "Open run" would lead nowhere.
 */
export const shouldCollapseAgentRunLine = (
  line: string | null | undefined,
  agent: TAgentJobsConfig | null | undefined,
  jobName: string | null | undefined
): boolean => isAgentRunLogLine(line) && isAgentJob(agent, jobName);
