import { MetricsCollector } from '../../../metrics-collector';
import { BullMonitorError } from '../../../errors';
import { MetricsErrorEnum as ErrorEnum } from './errors-enum';
import type { TMetricsSummary } from '../../../metrics-collector';

export class MetricsDataSource {
  constructor(private _internalCollector?: MetricsCollector) {}
  public isEnabled(): boolean {
    return !!this._internalCollector;
  }
  public async getMetrics(
    queue: string,
    start?: number,
    end?: number,
    since?: number,
    maxPoints?: number
  ) {
    // `since` and the index-based start/end are mutually exclusive views of
    // the same list; the time window wins when both are supplied because it
    // is the only one whose meaning survives a change of collect interval.
    if (since || maxPoints) {
      return await this._collector.extractSince(queue, since, maxPoints);
    }
    return await this._collector.extract(queue, start, end);
  }
  public async getSummary(
    since?: number,
    maxPoints?: number
  ): Promise<TMetricsSummary> {
    return await this._collector.getSummary(since, maxPoints);
  }
  public async clearAllMetrics() {
    await this._collector.clearAll();
    return true;
  }
  public async clearMetrics(queue: string) {
    await this._collector.clear(queue);
    return true;
  }

  private _throwInternalError(e: ErrorEnum) {
    throw new BullMonitorError(e);
  }
  private _throwNoCollector() {
    this._throwInternalError(ErrorEnum.NO_COLLECTOR);
  }
  private get _collector() {
    if (!this._internalCollector) {
      this._throwNoCollector();
    }
    return this._internalCollector as NonNullable<MetricsCollector>;
  }
}
