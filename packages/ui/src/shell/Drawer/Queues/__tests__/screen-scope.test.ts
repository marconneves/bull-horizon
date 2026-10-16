import { queuesForScreen, sidebarQueueAction } from '../screen-scope';

const QUEUES = [
  { id: 'a', agent: null },
  { id: 'ai', agent: { label: 'brand-app:ai' } },
  { id: 'b' },
];

describe('queuesForScreen', () => {
  it('lists only agent queues on Agents', () => {
    expect(queuesForScreen(QUEUES, 'agents')?.map((q) => q.id)).toEqual(['ai']);
  });
  it('lists every queue elsewhere', () => {
    for (const screen of ['jobs', 'overview', 'history']) {
      expect(queuesForScreen(QUEUES, screen)).toBe(QUEUES);
    }
  });
  it('passes a missing list through', () => {
    expect(queuesForScreen(undefined, 'agents')).toBeUndefined();
  });
});

describe('sidebarQueueAction', () => {
  it('filters Agents instead of leaving it', () => {
    expect(sidebarQueueAction('agents')).toBe('filter-agents');
  });
  it('hands the cross-queue screens over to Jobs', () => {
    expect(sidebarQueueAction('overview')).toBe('go-to-jobs');
    expect(sidebarQueueAction('history')).toBe('go-to-jobs');
  });
  it('keeps Jobs where it is', () => {
    expect(sidebarQueueAction('jobs')).toBe('stay');
  });
});
