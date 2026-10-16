import { fmtCost, plural, unrecordedMessage } from '../format';

describe('plural (m4)', () => {
  it('uses the singular for exactly one', () => {
    expect(plural(1, 'run')).toBe('1 run');
  });
  it('uses the plural for zero and many', () => {
    expect(plural(0, 'run')).toBe('0 runs');
    expect(plural(2, 'run')).toBe('2 runs');
    expect(plural(1160, 'run')).toBe('1,160 runs');
  });
  it('takes an irregular plural', () => {
    expect(plural(3, 'entry', 'entries')).toBe('3 entries');
  });
});

describe('fmtCost', () => {
  it('never shows a missing price as $0', () => {
    expect(fmtCost(null)).toBe('no price');
    expect(fmtCost(0)).toBe('$0');
  });
});

describe('unrecordedMessage', () => {
  it('counts the jobs and points at the helper and the docs', () => {
    const one = unrecordedMessage(1);
    expect(one.startsWith('1 agent job finished without a run')).toBe(true);
    expect(unrecordedMessage(7).startsWith('7 agent jobs finished')).toBe(true);
    expect(one).toContain('createAgentRun');
    expect(one).toContain('AgentRunV1');
    expect(one).toContain('docs/agent-runs.md');
  });
});
