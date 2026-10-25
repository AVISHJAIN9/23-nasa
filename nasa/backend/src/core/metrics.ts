import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface MetricLabels {
  [key: string]: string | number;
}

function formatLabels(labels?: MetricLabels): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  const entries = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`);
  return `{${entries.join(',')}}`;
}

const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * High-performance, zero-dependency Prometheus metrics registry and collector.
 * Exposes standard Prometheus text exposition format (version 0.0.4).
 */
export class PrometheusRegistry {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<
    string,
    { count: number; sum: number; buckets: Map<number, number> }
  >();

  // Rolling ingest rate window
  private recentIngestReadings: Array<{ count: number; timestamp: number }> = [];

  // --------------------------------------------------------------------------
  // COUNTERS
  // --------------------------------------------------------------------------
  incCounter(name: string, labels?: MetricLabels, value = 1): void {
    const key = `${name}${formatLabels(labels)}`;
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);
  }

  getCounter(name: string, labels?: MetricLabels): number {
    const key = `${name}${formatLabels(labels)}`;
    return this.counters.get(key) ?? 0;
  }

  // --------------------------------------------------------------------------
  // GAUGES
  // --------------------------------------------------------------------------
  setGauge(name: string, labels: MetricLabels | undefined, value: number): void {
    const key = `${name}${formatLabels(labels)}`;
    this.gauges.set(key, value);
  }

  getGauge(name: string, labels?: MetricLabels): number {
    const key = `${name}${formatLabels(labels)}`;
    return this.gauges.get(key) ?? 0;
  }

  // --------------------------------------------------------------------------
  // HISTOGRAMS
  // --------------------------------------------------------------------------
  observeDuration(name: string, labels: MetricLabels | undefined, durationSeconds: number): void {
    const labelStr = formatLabels(labels);
    const key = `${name}${labelStr}`;
    let hist = this.histograms.get(key);

    if (!hist) {
      hist = {
        count: 0,
        sum: 0,
        buckets: new Map<number, number>(HISTOGRAM_BUCKETS.map((b) => [b, 0])),
      };
      this.histograms.set(key, hist);
    }

    hist.count += 1;
    hist.sum += durationSeconds;

    for (const bucket of HISTOGRAM_BUCKETS) {
      if (durationSeconds <= bucket) {
        hist.buckets.set(bucket, (hist.buckets.get(bucket) ?? 0) + 1);
      }
    }
  }

  // --------------------------------------------------------------------------
  // DOMAIN RECORDING HELPERS
  // --------------------------------------------------------------------------
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const labels = { method, path: route, status: statusCode };
    this.incCounter('http_requests_total', labels, 1);
    this.observeDuration('http_request_duration_seconds', { method, path: route }, durationSeconds);
  }

  recordTelemetryIngest(readingCount: number): void {
    const now = Date.now();
    this.incCounter('telemetry_ingested_readings_total', undefined, readingCount);

    this.recentIngestReadings.push({ count: readingCount, timestamp: now });
    // Keep 10 second rolling window
    const cutoff = now - 10000;
    this.recentIngestReadings = this.recentIngestReadings.filter((e) => e.timestamp >= cutoff);

    const totalRecent = this.recentIngestReadings.reduce((acc, e) => acc + e.count, 0);
    const windowSeconds = Math.max(
      1,
      (now - (this.recentIngestReadings[0]?.timestamp ?? now)) / 1000,
    );
    const rate = totalRecent / windowSeconds;
    this.setGauge('telemetry_ingest_rate_readings_per_second', undefined, Number(rate.toFixed(1)));
  }

  recordAlertRaised(hazard: string, severity: string): void {
    this.incCounter('alerts_raised_total', { hazard, severity }, 1);
  }

  setAlertCounts(counts: { red: number; amber: number; watch: number }): void {
    this.setGauge('alerts_active_count', { severity: 'red' }, counts.red);
    this.setGauge('alerts_active_count', { severity: 'amber' }, counts.amber);
    this.setGauge('alerts_active_count', { severity: 'watch' }, counts.watch);
  }

  setBusLag(topic: string, lagCount: number): void {
    this.setGauge('event_bus_lag_events', { topic }, lagCount);
  }

  setLinkState(params: {
    missionMode: string;
    isBlackout: boolean;
    oneWayDelaySeconds: number;
    packetLossRate: number;
  }): void {
    const labels = { mission_mode: params.missionMode };
    this.setGauge('link_blackout_active', labels, params.isBlackout ? 1 : 0);
    this.setGauge('link_one_way_delay_seconds', labels, params.oneWayDelaySeconds);
    this.setGauge('link_packet_loss_rate', labels, params.packetLossRate);
  }

  // --------------------------------------------------------------------------
  // PROMETHEUS TEXT EXPOSITION FORMATTER
  // --------------------------------------------------------------------------
  exportMetrics(): string {
    const lines: string[] = [];

    // 1. http_requests_total
    lines.push('# HELP http_requests_total Total number of HTTP requests processed by endpoint');
    lines.push('# TYPE http_requests_total counter');
    if (this.counters.size === 0) {
      lines.push('http_requests_total 0');
    } else {
      for (const [key, value] of this.counters.entries()) {
        if (key.startsWith('http_requests_total')) {
          lines.push(`${key} ${value}`);
        }
      }
    }

    // 2. http_request_duration_seconds
    lines.push('\n# HELP http_request_duration_seconds HTTP request execution latency in seconds');
    lines.push('# TYPE http_request_duration_seconds histogram');
    for (const [key, hist] of this.histograms.entries()) {
      if (key.startsWith('http_request_duration_seconds')) {
        const baseLabels = key.substring('http_request_duration_seconds'.length);
        const prefix = baseLabels.startsWith('{') ? baseLabels.slice(1, -1) : '';
        const comma = prefix ? ',' : '';

        for (const bucket of HISTOGRAM_BUCKETS) {
          const count = hist.buckets.get(bucket) ?? 0;
          lines.push(
            `http_request_duration_seconds_bucket{${prefix}${comma}le="${bucket}"} ${count}`,
          );
        }
        lines.push(
          `http_request_duration_seconds_bucket{${prefix}${comma}le="+Inf"} ${hist.count}`,
        );
        lines.push(`http_request_duration_seconds_sum{${prefix}} ${hist.sum.toFixed(6)}`);
        lines.push(`http_request_duration_seconds_count{${prefix}} ${hist.count}`);
      }
    }

    // 3. telemetry_ingested_readings_total & rate
    lines.push(
      '\n# HELP telemetry_ingested_readings_total Total vital telemetry readings processed through ingestion',
    );
    lines.push('# TYPE telemetry_ingested_readings_total counter');
    lines.push(
      `telemetry_ingested_readings_total ${this.getCounter('telemetry_ingested_readings_total')}`,
    );

    lines.push(
      '\n# HELP telemetry_ingest_rate_readings_per_second Current telemetry ingestion throughput in readings per second',
    );
    lines.push('# TYPE telemetry_ingest_rate_readings_per_second gauge');
    lines.push(
      `telemetry_ingest_rate_readings_per_second ${this.getGauge('telemetry_ingest_rate_readings_per_second')}`,
    );

    // 4. alerts_active_count & alerts_raised_total
    lines.push(
      '\n# HELP alerts_active_count Number of currently active unresolved medical alerts by severity',
    );
    lines.push('# TYPE alerts_active_count gauge');
    for (const [key, value] of this.gauges.entries()) {
      if (key.startsWith('alerts_active_count')) {
        lines.push(`${key} ${value}`);
      }
    }

    lines.push(
      '\n# HELP alerts_raised_total Total number of medical alerts raised by hazard and severity',
    );
    lines.push('# TYPE alerts_raised_total counter');
    for (const [key, value] of this.counters.entries()) {
      if (key.startsWith('alerts_raised_total')) {
        lines.push(`${key} ${value}`);
      }
    }

    // 5. event_bus_lag_events
    lines.push(
      '\n# HELP event_bus_lag_events Number of pending unacknowledged events in the event bus topic queue',
    );
    lines.push('# TYPE event_bus_lag_events gauge');
    for (const [key, value] of this.gauges.entries()) {
      if (key.startsWith('event_bus_lag_events')) {
        lines.push(`${key} ${value}`);
      }
    }

    // 6. Link state metrics
    lines.push(
      '\n# HELP link_blackout_active Deep space communications blackout status (1 = blackout in progress, 0 = link active)',
    );
    lines.push('# TYPE link_blackout_active gauge');
    for (const [key, value] of this.gauges.entries()) {
      if (key.startsWith('link_blackout_active')) {
        lines.push(`${key} ${value}`);
      }
    }

    lines.push(
      '\n# HELP link_one_way_delay_seconds Current one-way light-time communication propagation delay in seconds',
    );
    lines.push('# TYPE link_one_way_delay_seconds gauge');
    for (const [key, value] of this.gauges.entries()) {
      if (key.startsWith('link_one_way_delay_seconds')) {
        lines.push(`${key} ${value}`);
      }
    }

    lines.push(
      '\n# HELP link_packet_loss_rate Radio transmission packet loss rate (fraction between 0.0 and 1.0)',
    );
    lines.push('# TYPE link_packet_loss_rate gauge');
    for (const [key, value] of this.gauges.entries()) {
      if (key.startsWith('link_packet_loss_rate')) {
        lines.push(`${key} ${value}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.recentIngestReadings = [];
  }
}

export const defaultMetricsRegistry = new PrometheusRegistry();

/**
 * Normalizes HTTP route paths to prevent label cardinality explosions.
 * Replaces MongoDB ObjectIds and UUIDs with parameterized placeholders.
 */
export function normalizePath(path: string): string {
  const normalized = path
    .replace(/[0-9a-fA-F]{24}/g, ':id')
    .replace(/[0-9a-fA-F-]{36}/g, ':uuid')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Express middleware measuring request execution duration and status code.
 */
export function createMetricsMiddleware(
  registry: PrometheusRegistry = defaultMetricsRegistry,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/metrics') {
      return next();
    }

    const start = performance.now();
    res.on('finish', () => {
      const durationSeconds = (performance.now() - start) / 1000;
      const cleanPath = normalizePath(req.baseUrl ? `${req.baseUrl}${req.path}` : req.path);
      registry.recordHttpRequest(req.method, cleanPath, res.statusCode, durationSeconds);
    });

    next();
  };
}
