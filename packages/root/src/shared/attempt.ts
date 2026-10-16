/**
 * Attempt numbering shared by the agent helper, the flow helpers and the
 * collector. Pure and dependency-free: it runs inside the consumer's worker
 * (agent/ and flow/ import it) as well as in the monitor.
 *
 * The bit of a job read here. Bull and BullMQ jobs (and the objects handed to
 * sandboxed processors) all satisfy it structurally.
 */
export interface AttemptJobLike {
  attemptsMade?: unknown;
  /** BullMQ 5+: attempts moved to active, this one included. */
  attemptsStarted?: unknown;
  /** BullMQ only (Bull v3 has `progress()` instead). */
  updateProgress?: unknown;
  /** A method on Bull v3, a number on BullMQ. */
  progress?: unknown;
}

export const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** BullMQ job: it has `updateProgress()`, and `progress` is not Bull's method. */
export function isBullMQJobLike(job: AttemptJobLike | null | undefined) {
  return (
    !!job &&
    typeof job.updateProgress === 'function' &&
    typeof job.progress !== 'function'
  );
}

/**
 * 1-based number of the attempt running now, from the job alone.
 *
 * The libraries disagree on `attemptsMade` inside the processor:
 * - Bull v3 bumps it only when an attempt fails, so attempt N sees N - 1.
 * - BullMQ 1.x to 4.x bumps it when the job becomes active
 *   (`moveJobFromWaitToActive`), so attempt N already sees N.
 * - BullMQ 5+ only bumps it on failure again, and counts activations in
 *   `attemptsStarted`, so attempt N sees `attemptsStarted = N`.
 *
 * `attemptsStarted` wins when present; otherwise a BullMQ job (it has
 * `updateProgress()`, and `progress` is a number, not Bull's method) uses
 * `attemptsMade` as is, and anything else is treated as Bull.
 */
export function currentAttempt(job: AttemptJobLike): number {
  const started = job?.attemptsStarted;
  if (finiteNumber(started) && started >= 1) return Math.floor(started);
  const made = job?.attemptsMade;
  if (!finiteNumber(made)) return 1;
  return Math.max(Math.floor(isBullMQJobLike(job) ? made : made + 1), 1);
}

/**
 * 1-based number of the attempt that just ended, read by the monitor on the
 * terminal event (the job is already completed or failed).
 *
 * - BullMQ: `attemptsStarted` (5+) or `attemptsMade` (1..4, bumped on
 *   activation, so it already counts the attempt that ended).
 * - Bull 3/4: `completed` -> `attemptsMade + 1` (only failures bump it);
 *   `failed` -> `attemptsMade` (the failure that ended it was counted).
 *
 * The adapters do not expose `updateProgress`, so the caller may pass
 * `bullmq` from the queue provider; without it the job shape decides.
 */
export function terminalAttempts(
  job: AttemptJobLike | null | undefined,
  status: 'completed' | 'failed',
  bullmq?: boolean
): number {
  if (!job) return 1;
  const isBullMQ = bullmq ?? isBullMQJobLike(job);
  const made = finiteNumber(job.attemptsMade) ? job.attemptsMade : 0;
  if (isBullMQ) {
    const started = job.attemptsStarted;
    const value = finiteNumber(started) && started >= 1 ? started : made;
    return Math.max(Math.floor(value), 1);
  }
  return Math.max(Math.floor(status === 'completed' ? made + 1 : made), 1);
}
