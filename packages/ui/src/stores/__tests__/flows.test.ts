import './helpers/local-storage';
import { useFlowsStore } from '../flows';

const flows = () => useFlowsStore.getState();

describe('flows store', () => {
  beforeEach(() => {
    useFlowsStore.setState({
      flowId: null,
      tab: 'flow',
      input: '',
      query: null,
      traceId: null,
      traceJob: null,
      step: null,
    });
  });

  it('runs the typed search on the Trace tab, trimmed', () => {
    flows().changeInput('  tr_9f2c41e7b0 ');
    flows().runTrace();
    expect(flows().tab).toBe('trace');
    expect(flows().query).toBe('tr_9f2c41e7b0');
  });

  it('ignores an empty search', () => {
    flows().changeInput('   ');
    flows().runTrace();
    expect(flows().tab).toBe('flow');
    expect(flows().query).toBeNull();
  });

  it('picks a candidate and a job, and clears back to Flow', () => {
    flows().openTrace('7428801239912');
    flows().pickCandidate('tr_51d0a8c3e2');
    flows().selectTraceJob('bull:a/1');
    expect(flows().traceId).toBe('tr_51d0a8c3e2');
    flows().pickCandidate('tr_9f2c41e7b0');
    expect(flows().traceJob).toBeNull();
    flows().clearTrace();
    expect(flows()).toMatchObject({ tab: 'flow', query: null, input: '' });
  });

  it('a new flow drops the search and the selection', () => {
    flows().openTrace('x');
    flows().selectStep('s');
    flows().changeFlow('other');
    expect(flows()).toMatchObject({ flowId: 'other', query: null, step: null });
  });
});
