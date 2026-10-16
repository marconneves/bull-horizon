import type { IResolvers } from '@graphql-tools/utils';
import type {
  AgentsDataSource,
  BullDataSource,
  FlowsDataSource,
  MetricsDataSource,
  PoliciesDataSource,
} from '../data-sources';

type DataSources = {
  dataSources: {
    bull: BullDataSource;
    metrics: MetricsDataSource;
    policies: PoliciesDataSource;
    agents: AgentsDataSource;
    flows: FlowsDataSource;
  };
};
export type TResolvers = IResolvers<any, DataSources>;
