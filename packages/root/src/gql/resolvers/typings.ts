import type { IResolvers } from '@graphql-tools/utils';
import type {
  AgentsDataSource,
  BullDataSource,
  MetricsDataSource,
  PoliciesDataSource,
} from '../data-sources';

type DataSources = {
  dataSources: {
    bull: BullDataSource;
    metrics: MetricsDataSource;
    policies: PoliciesDataSource;
    agents: AgentsDataSource;
  };
};
export type TResolvers = IResolvers<any, DataSources>;
