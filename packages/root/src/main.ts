import {
  BullDataSource,
  MetricsDataSource,
  PoliciesDataSource,
} from './gql/data-sources';
import { UI } from './ui';
import { MetricsCollector } from './metrics-collector';
import { Queue } from './queue';
import { DEFAULT_METRICS_CONFIG, DEFAULT_ROOT_CONFIG } from './constants';
import type { Config, MetricsConfig } from './typings/config';

/**
 * GraphQL context shape shared by every framework adapter.
 *
 * `@apollo/server` v4 removed the constructor-level `dataSources` option
 * that Apollo Server v2/v3 provided. Framework adapters (express, fastify,
 * koa, ...) now own the `ApolloServer` instance themselves and must build
 * this context per-request by calling `createContext()` (see below) from
 * the `context` function they pass to their middleware integration, e.g.:
 *
 * ```ts
 * const server = new ApolloServer<BullMonitorContext>({ typeDefs, resolvers, plugins });
 * await server.start();
 * expressMiddleware(server, { context: async () => this.createContext() });
 * ```
 */
export type BullMonitorContext = {
  dataSources: {
    bull: BullDataSource;
    metrics: MetricsDataSource;
    policies: PoliciesDataSource;
  };
};

export abstract class BullMonitor {
  private _queues: Queue[] = [];
  private _queuesMap: Map<string, Queue> = new Map();
  private _ui: UI;
  private _metricsCollector?: MetricsCollector;

  constructor(config: Config) {
    this.config = this._normalizeConfig(config);
    this._ui = new UI();
    this._initQueues(this.config.queues);
    if (this.config.metrics) {
      this._initMetricsCollector();
    }
  }
  public get queues(): Queue[] {
    return this._queues;
  }
  public abstract init(...args: any): Promise<any>;
  public setQueues(queues: Config['queues']): void {
    this._initQueues(queues);
    if (this._metricsCollector && this.config.metrics) {
      this._metricsCollector.queues = this._queues;
    }
  }
  public startMetricsCollector() {
    if (this._metricsCollector) {
      this._metricsCollector.stopCollecting();
      this._metricsCollector.startCollecting();
    } else {
      console.warn(
        'Metrics collector is not initialized. Please pass the metrics config while initializing bull-monitor: { metrics: { collectInterval: { hours: 1 } } }'
      );
    }
  }
  public stopMetricsCollector() {
    this._metricsCollector?.stopCollecting();
  }
  /**
   * Builds a fresh per-request GraphQL context bound to this instance's
   * queues, config and metrics collector. Framework adapters must call
   * this from the `context` function they hand to their `@apollo/server`
   * middleware integration (see `BullMonitorContext` above for an example).
   */
  public createContext(): BullMonitorContext {
    return {
      dataSources: {
        bull: new BullDataSource(this._queues, this._queuesMap, {
          textSearchScanCount: this.config.textSearchScanCount,
        }),
        metrics: new MetricsDataSource(this._metricsCollector),
        policies: new PoliciesDataSource(this._queuesMap),
      },
    };
  }

  protected gqlBasePath = '/graphql';
  protected config: Required<Config>;
  protected renderUi() {
    return this._ui.render();
  }
  protected get baseUrl() {
    return this.config.baseUrl;
  }
  protected get uiEndpoint() {
    return this.baseUrl || '/';
  }
  protected get gqlEndpoint() {
    const base = this.baseUrl;
    if (!base) {
      return this.gqlBasePath;
    } else if (base.endsWith('/')) {
      return base.slice(0, -1) + this.gqlBasePath;
    }
    return base + this.gqlBasePath;
  }

  private _initQueues(rawQueues: Config['queues']) {
    this._queues = this._validateQueues(rawQueues);
    this._queuesMap.clear();
    this._queues.forEach((queue) => {
      this._queuesMap.set(queue.id, queue);
    });
  }
  private _validateQueues(queues: Queue[]): Queue[] {
    let hasInvalid = false;
    const validated = queues.filter((queue) => {
      const isValid = queue instanceof Queue;
      if (!isValid) {
        hasInvalid = true;
      }
      return isValid;
    });
    if (hasInvalid) {
      console.error(
        'Since version 3.0.0 every queue should be wrapped in bull or bullmq adapter. Check out the bull-monitor docs for more info - https://github.com/s-r-x/bull-monitor'
      );
    }
    return validated;
  }
  private _normalizeConfig(config: Config): Required<Config> {
    return {
      ...DEFAULT_ROOT_CONFIG,
      ...config,
      metrics: config.metrics
        ? { ...DEFAULT_METRICS_CONFIG, ...config.metrics }
        : false,
    };
  }
  private _initMetricsCollector() {
    this._metricsCollector = new MetricsCollector(
      this._queues,
      this.config.metrics as Required<MetricsConfig>
    );
    this._metricsCollector.startCollecting();
  }
}
