import {
  AGENT_RUN_LOG_PREFIX,
  isAgentJob,
  readAgentRunLogLine,
  shouldCollapseAgentRunLine,
} from '../agent-run-log';

const LINE = `${AGENT_RUN_LOG_PREFIX}${JSON.stringify({ v: 1, attempt: 2 })}`;

describe('isAgentJob', () => {
  it('is false outside agent queues', () => {
    expect(isAgentJob(null, 'reply')).toBe(false);
    expect(isAgentJob(undefined, 'reply')).toBe(false);
  });
  it('treats every job as a run when the queue has no `jobs` list', () => {
    expect(isAgentJob({}, 'anything')).toBe(true);
    expect(isAgentJob({ jobs: null }, 'anything')).toBe(true);
  });
  it('matches the job name against `jobs`', () => {
    expect(isAgentJob({ jobs: ['reply'] }, 'reply')).toBe(true);
    expect(isAgentJob({ jobs: ['reply'] }, 'cleanup')).toBe(false);
    expect(isAgentJob({ jobs: ['reply'] }, null)).toBe(false);
  });
});

describe('shouldCollapseAgentRunLine (m5)', () => {
  it('collapses a run line of an agent job', () => {
    expect(shouldCollapseAgentRunLine(LINE, { jobs: ['reply'] }, 'reply')).toBe(
      true
    );
  });
  it('shows the raw line outside agent queues', () => {
    expect(shouldCollapseAgentRunLine(LINE, null, 'reply')).toBe(false);
  });
  it('shows the raw line for a job name outside `jobs`', () => {
    expect(
      shouldCollapseAgentRunLine(LINE, { jobs: ['reply'] }, 'cleanup')
    ).toBe(false);
    // Unknown job name: cannot tell, so no "Open run" that leads nowhere.
    expect(shouldCollapseAgentRunLine(LINE, { jobs: ['reply'] }, null)).toBe(
      false
    );
  });
  it('never collapses a line without the prefix', () => {
    expect(shouldCollapseAgentRunLine('reply: started', {}, 'reply')).toBe(
      false
    );
    expect(shouldCollapseAgentRunLine(null, {}, 'reply')).toBe(false);
  });
});

describe('readAgentRunLogLine', () => {
  it('reads the attempt and size', () => {
    expect(readAgentRunLogLine(LINE)).toEqual({
      attempt: 2,
      chars: LINE.length,
    });
  });
  it('tolerates a broken line', () => {
    const broken = `${AGENT_RUN_LOG_PREFIX}{nope`;
    expect(readAgentRunLogLine(broken)).toEqual({
      attempt: null,
      chars: broken.length,
    });
  });
});
