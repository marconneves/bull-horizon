// Must come first: the stores read `localStorage` when they are created.
import { readPersisted } from './helpers/local-storage';
import { AGENT_RUNS_PAGE, useAgentsStore } from '../agents';
import { useActiveScreenStore } from '../active-screen';
import { AgentRunsFilter, AgentRunsSort } from '../../typings/gql';

const RUN = { queue: 'bull:brand-app:ai', jobId: '0c2b77a1' };
const agents = () => useAgentsStore.getState();
const screen = () => useActiveScreenStore.getState().screen;

describe('agents store persistence', () => {
  it('migrates the v0 `view` to `tab` and never restores a run', () => {
    // v0 had `view: 'run'`: the reload lands on the runs list.
    expect(agents().tab).toBe('runs');
    expect(agents().run).toBeNull();
    expect(agents().runLayout).toBe('waterfall');
    expect(agents().range).toBe('24h');
    const saved = readPersisted('bull_monitor:store:agents');
    expect(saved.version).toBe(1);
    // Only the whitelisted keys: never the old `view`, nor a run.
    expect(saved.state.tab).toBe('runs');
    expect(saved.state).not.toHaveProperty('view');
    expect(saved.state).not.toHaveProperty('run');
  });
});

describe('agents store', () => {
  beforeEach(() => {
    useActiveScreenStore.setState({ screen: 'jobs' });
    useAgentsStore.setState({
      tab: 'metrics',
      run: null,
      backTo: 'runs',
      runsFilter: AgentRunsFilter.All,
      runsSort: AgentRunsSort.Recent,
      runsLimit: AGENT_RUNS_PAGE,
      conversation: null,
      conversationFrom: null,
      conversationMessage: null,
    });
  });

  it('opens a run on the agents screen and goes back to jobs', () => {
    agents().openRun(RUN, 'jobs');
    expect(screen()).toBe('agents');
    expect(agents().run).toEqual(RUN);
    agents().closeRun();
    expect(screen()).toBe('jobs');
    expect(agents().run).toBeNull();
    // Opened from jobs: the last tab is kept for the next visit.
    expect(agents().tab).toBe('metrics');
  });

  it('drops an open run when the user moves to another screen (m2)', () => {
    agents().openRun(RUN, 'jobs');
    useActiveScreenStore.getState().changeScreen('jobs');
    expect(agents().run).toBeNull();
    // Coming back from the sidebar lands on the tab, not the stale run.
    useActiveScreenStore.getState().changeScreen('agents');
    expect(agents().run).toBeNull();
    expect(agents().tab).toBe('metrics');
  });

  it('leaveRun drops the run and keeps the screen', () => {
    agents().changeTab('runs');
    agents().openRun(RUN, 'runs');
    agents().leaveRun();
    expect(screen()).toBe('agents');
    expect(agents().run).toBeNull();
    expect(agents().tab).toBe('runs');
  });

  it('keeps the runs filter, sort and page across a run (m3)', () => {
    agents().changeTab('runs');
    agents().changeRunsFilter(AgentRunsFilter.Failed);
    agents().changeRunsSort(AgentRunsSort.Slowest);
    agents().showMoreRuns();
    agents().openRun(RUN, 'runs');
    agents().closeRun();
    expect(screen()).toBe('agents');
    expect(agents().tab).toBe('runs');
    expect(agents().runsFilter).toBe(AgentRunsFilter.Failed);
    expect(agents().runsSort).toBe(AgentRunsSort.Slowest);
    expect(agents().runsLimit).toBe(2 * AGENT_RUNS_PAGE);
  });

  it('resets the page when the filter, sort or queue changes', () => {
    agents().showMoreRuns();
    agents().changeRunsFilter(AgentRunsFilter.Slow);
    expect(agents().runsLimit).toBe(AGENT_RUNS_PAGE);
    agents().showMoreRuns();
    agents().changeRunsSort(AgentRunsSort.Costliest);
    expect(agents().runsLimit).toBe(AGENT_RUNS_PAGE);
    agents().showMoreRuns();
    agents().changeQueue('bull:other:ai');
    expect(agents().runsLimit).toBe(AGENT_RUNS_PAGE);
  });

  describe('sidebar queue on Agents', () => {
    it('filters by the queue, keeps the tab and closes an open run', () => {
      agents().changeTab('runs');
      agents().openRun(RUN, 'runs');
      agents().showMoreRuns();
      agents().pickSidebarQueue('bull:brand-app:ai');
      expect(screen()).toBe('agents');
      expect(agents().queue).toBe('bull:brand-app:ai');
      expect(agents().tab).toBe('runs');
      expect(agents().run).toBeNull();
      expect(agents().runsLimit).toBe(AGENT_RUNS_PAGE);
    });

    it('closes an open conversation too', () => {
      agents().openRun(RUN, 'runs');
      agents().openConversation({ queue: RUN.queue, conversationId: 'c-1' });
      agents().pickSidebarQueue('bull:brand-app:ai');
      expect(agents().conversation).toBeNull();
      expect(agents().conversationFrom).toBeNull();
    });

    it('the same queue again goes back to every agent queue', () => {
      agents().changeQueue(null);
      agents().pickSidebarQueue('bull:brand-app:ai');
      agents().pickSidebarQueue('bull:brand-app:ai');
      expect(agents().queue).toBeNull();
      agents().pickSidebarQueue('bull:brand-app:ai');
      agents().pickSidebarQueue('bull:other:ai');
      expect(agents().queue).toBe('bull:other:ai');
    });
  });

  describe('conversation', () => {
    const CONV = { queue: RUN.queue, conversationId: 'c-7f21' };
    const MSG = { queue: RUN.queue, jobId: 'd41e6b02', attempt: 1 };

    it('opens from a run and goes back to that run', () => {
      agents().openRun(RUN, 'jobs');
      agents().openConversation(CONV);
      expect(agents().run).toBeNull();
      expect(agents().conversation).toEqual(CONV);
      agents().closeConversation();
      expect(agents().conversation).toBeNull();
      expect(agents().run).toEqual(RUN);
      // The run keeps its own way back.
      expect(agents().backTo).toBe('jobs');
    });

    it("returns to the conversation from a message's run", () => {
      agents().openRun(RUN, 'runs');
      agents().openConversation(CONV);
      agents().selectConversationMessage('d41e6b02');
      agents().openRun(MSG, 'conversation');
      expect(agents().run).toEqual(MSG);
      expect(agents().conversation).toEqual(CONV);
      agents().closeRun();
      expect(screen()).toBe('agents');
      expect(agents().run).toBeNull();
      expect(agents().conversation).toEqual(CONV);
      expect(agents().conversationMessage).toBe('d41e6b02');
      // And from there, back to the run it was opened from.
      agents().closeConversation();
      expect(agents().run).toEqual(RUN);
      expect(agents().backTo).toBe('runs');
    });

    it("from a message's run, the button returns to the same conversation (c1)", () => {
      agents().openRun(RUN, 'jobs');
      agents().openConversation(CONV);
      agents().selectConversationMessage('d41e6b02');
      agents().openRun(MSG, 'conversation');
      agents().openConversation(CONV);
      expect(agents().run).toBeNull();
      expect(agents().conversation).toEqual(CONV);
      expect(agents().conversationMessage).toBe('d41e6b02');
      // The source run is still the way back.
      expect(agents().conversationFrom).toEqual({ run: RUN, backTo: 'jobs' });
      agents().closeConversation();
      expect(agents().run).toEqual(RUN);
      expect(agents().backTo).toBe('jobs');
    });

    it('a run opened from elsewhere drops the conversation trail', () => {
      agents().openRun(RUN, 'runs');
      agents().openConversation(CONV);
      agents().openRun(MSG, 'jobs');
      expect(agents().conversation).toBeNull();
      expect(agents().conversationFrom).toBeNull();
    });

    it('leaving the screen or the sidebar entry lands on the tab', () => {
      agents().openRun(RUN, 'runs');
      agents().openConversation(CONV);
      useActiveScreenStore.getState().changeScreen('jobs');
      expect(agents().conversation).toBeNull();
      agents().openRun(RUN, 'runs');
      agents().openConversation(CONV);
      agents().leaveRun();
      expect(agents().conversation).toBeNull();
      expect(agents().run).toBeNull();
    });

    it('keeps the Chat / List choice', () => {
      agents().changeConversationLayout('list');
      agents().leaveRun();
      expect(agents().conversationLayout).toBe('list');
      const saved = readPersisted('bull_monitor:store:agents');
      expect(saved.state.conversationLayout).toBe('list');
    });
  });
});
