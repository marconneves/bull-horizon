import React, { memo, useMemo } from 'react';
import Paper from '@mui/material/Paper';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import InputBase from '@mui/material/InputBase';
import FlowIcon from '@mui/icons-material/AccountTree';
import RouteIcon from '@mui/icons-material/Route';
import GraphIcon from '@mui/icons-material/Hub';
import TableIcon from '@mui/icons-material/TableRows';
import TimelineIcon from '@mui/icons-material/ViewTimeline';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import clsx from 'clsx';
import shallow from 'zustand/shallow';
import { useQuery } from 'react-query';
import { useNetwork } from '@/hooks/use-network';
import { useFlowsQuery } from '@/hooks/use-flows-query';
import { QueryKeysConfig } from '@/config/query-keys';
import { useFlowsStore } from '@/stores/flows';
import type { TFlowsTab } from '@/stores/flows';
import NetworkRequest from '@/components/NetworkRequest';
import Spin from '@/components/Spin';
import { FlowStepKind } from '@/typings/gql';
import TimeRangePicker from '../shared/TimeRangePicker';
import { useTimeRange } from '../shared/time-range';
import { MONO } from '../agents/shared';
import { plural } from '../agents/format';
import { commonPrefix } from './model';
import { LayoutToggle } from './parts';
import FlowTab from './FlowTab';
import TraceTab from './TraceTab';
import ConfigTab from './ConfigTab';

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: theme.spacing(0.5, 1.25),
    borderRadius: 16,
    border: `1px solid ${theme.palette.divider}`,
    background: 'none',
    color: theme.palette.text.secondary,
    fontFamily: MONO,
    fontSize: 12,
    cursor: 'pointer',
    '& svg': {
      fontSize: 15,
    },
  },
  chipOn: {
    color: theme.palette.primary.main,
    borderColor: alpha(theme.palette.primary.main, 0.6),
    backgroundColor: alpha(theme.palette.primary.main, 0.1),
  },
  header: {
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1, 1.5, 0),
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: theme.spacing(2),
    rowGap: theme.spacing(1),
  },
  title: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingBottom: theme.spacing(1),
    minWidth: 0,
  },
  titleTop: {
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(1),
  },
  heading: {
    fontWeight: 600,
    fontSize: 15,
  },
  id: {
    fontFamily: MONO,
    fontSize: 12,
    color: theme.palette.text.secondary,
  },
  sub: {
    fontFamily: MONO,
    fontSize: 11,
    color: theme.palette.text.secondary,
  },
  spacer: {
    flex: 1,
  },
  tabs: {
    minHeight: 40,
    '& .MuiTab-root': {
      minHeight: 40,
      textTransform: 'none',
      fontSize: 13,
      minWidth: 72,
    },
  },
  search: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    marginBottom: theme.spacing(1),
    paddingLeft: theme.spacing(1),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 4,
    '& > svg': {
      fontSize: 17,
      color: theme.palette.text.secondary,
    },
  },
  input: {
    fontFamily: MONO,
    fontSize: 12.5,
    width: 260,
    [theme.breakpoints.down('md')]: {
      width: 180,
    },
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(1.5),
  },
}));

/**
 * Flows: the tree each declared flow walks (Flow), the path of one event
 * through it (Trace), and the definition read from the monitor setup
 * (Config). Flow and Trace read the metrics collector; Config does not.
 */
function FlowsScreen() {
  const cls = useStyles();
  const [
    flowId,
    tab,
    flowLayout,
    traceLayout,
    rangeLabel,
    input,
    changeFlow,
    changeTab,
    changeFlowLayout,
    changeTraceLayout,
    setRange,
    changeInput,
    runTrace,
  ] = useFlowsStore(
    (state) => [
      state.flowId,
      state.tab,
      state.flowLayout,
      state.traceLayout,
      state.range,
      state.input,
      state.changeFlow,
      state.changeTab,
      state.changeFlowLayout,
      state.changeTraceLayout,
      state.changeRange,
      state.changeInput,
      state.runTrace,
    ],
    shallow
  );
  const { status, data, error, refetch } = useFlowsQuery();
  const {
    queries: { getMetricsEnabled },
  } = useNetwork();
  const { data: metricsEnabledData, status: metricsStatus } = useQuery(
    QueryKeysConfig.metricsEnabled,
    getMetricsEnabled,
    { staleTime: Infinity }
  );
  const collectorKnown =
    metricsEnabledData !== undefined || metricsStatus === 'error';
  const collector = metricsEnabledData?.metricsEnabled ?? false;
  const { range, ranges, changeRange, since } = useTimeRange({
    label: rangeLabel,
    setLabel: setRange,
  });
  const flows = data?.flows ?? [];
  const flow = flows.find((f) => f.id === flowId) ?? flows[0] ?? null;
  const prefix = useMemo(() => (flow ? commonPrefix(flow) : null), [flow]);

  if (status !== 'success' || !collectorKnown) {
    return (
      <NetworkRequest status={status} error={error} refetch={refetch}>
        <Spin centered size={28} />
      </NetworkRequest>
    );
  }
  if (!flow) {
    return (
      <Alert severity="info" variant="outlined">
        No flow is declared in the monitor setup.
      </Alert>
    );
  }
  // Without the collector only the definition is there to show.
  const activeTab: TFlowsTab = collector ? tab : 'config';
  const queues = new Set(
    flow.steps
      .filter((s) => s.kind !== FlowStepKind.End && s.queue)
      .map((s) => s.queue)
  ).size;

  return (
    <div className={cls.root}>
      {flows.length > 1 && (
        <div className={cls.chips} role="tablist" aria-label="flows">
          {flows.map((f) => (
            <button
              type="button"
              key={f.id}
              role="tab"
              aria-selected={f.id === flow.id}
              className={clsx(cls.chip, f.id === flow.id && cls.chipOn)}
              onClick={() => changeFlow(f.id)}
            >
              <FlowIcon />
              {f.id}
            </button>
          ))}
        </div>
      )}
      <Paper elevation={0} className={cls.header}>
        <div className={cls.title}>
          <div className={cls.titleTop}>
            <span className={cls.heading}>{flow.label}</span>
            {flow.label !== flow.id && (
              <span className={cls.id}>{flow.id}</span>
            )}
          </div>
          <span className={cls.sub}>
            {plural(queues, 'queue')} · monitor setup · read only
          </span>
        </div>
        <span className={cls.spacer} />
        <Tabs
          className={cls.tabs}
          value={activeTab}
          onChange={(_e, next) => changeTab(next)}
          textColor="primary"
          indicatorColor="primary"
        >
          {collector && <Tab value="flow" label="Flow" />}
          {collector && <Tab value="trace" label="Trace" />}
          <Tab value="config" label="Config" />
        </Tabs>
        {collector && (
          <form
            className={cls.search}
            onSubmit={(e) => {
              e.preventDefault();
              runTrace();
            }}
            role="search"
          >
            <RouteIcon />
            <InputBase
              className={cls.input}
              value={input}
              onChange={(e) => changeInput(e.target.value)}
              placeholder={`Trace id, job id or ${flow.keyLabel ?? 'key'}`}
              inputProps={{
                'aria-label': 'trace search',
                maxLength: 256,
              }}
            />
            <Button size="small" type="submit" disabled={!input.trim()}>
              Trace
            </Button>
          </form>
        )}
      </Paper>
      {!collector && (
        <Alert severity="info" variant="outlined">
          Flow and Trace need the metrics collector, which is not running. The
          definition and its checks are below.
        </Alert>
      )}
      {activeTab === 'flow' && (
        <div className={cls.controls}>
          <LayoutToggle
            value={flowLayout}
            onChange={changeFlowLayout}
            options={[
              { value: 'A', label: 'Graph', icon: <GraphIcon /> },
              { value: 'B', label: 'Table', icon: <TableIcon /> },
            ]}
          />
          <span className={cls.spacer} />
          <TimeRangePicker
            value={range}
            ranges={ranges}
            onChange={changeRange}
          />
        </div>
      )}
      {activeTab === 'trace' && (
        <div className={cls.controls}>
          <LayoutToggle
            value={traceLayout}
            onChange={changeTraceLayout}
            options={[
              { value: 'A', label: 'Graph', icon: <GraphIcon /> },
              { value: 'B', label: 'Timeline', icon: <TimelineIcon /> },
            ]}
          />
        </div>
      )}
      {activeTab === 'flow' && (
        <FlowTab flow={flow} prefix={prefix} since={since} range={range} />
      )}
      {activeTab === 'trace' && <TraceTab flow={flow} prefix={prefix} />}
      {activeTab === 'config' && (
        <ConfigTab flow={flow} collector={collector} since={since} />
      )}
    </div>
  );
}

export default memo(FlowsScreen);
