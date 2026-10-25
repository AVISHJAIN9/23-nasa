import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PrometheusRegistry } from '../src/core/metrics.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';

describe('Prometheus Observability & Metrics (Phase 6)', () => {
  let registry: PrometheusRegistry;

  beforeEach(() => {
    registry = new PrometheusRegistry();
  });

  describe('PrometheusRegistry unit operations', () => {
    it('accurately increments and retrieves counters with and without labels', () => {
      registry.incCounter('test_counter_total', undefined, 1);
      registry.incCounter('test_counter_total', undefined, 4);
      expect(registry.getCounter('test_counter_total')).toBe(5);

      registry.incCounter('http_req_total', { method: 'GET', status: 200 }, 2);
      expect(registry.getCounter('http_req_total', { method: 'GET', status: 200 })).toBe(2);
      expect(registry.getCounter('http_req_total', { method: 'POST', status: 200 })).toBe(0);
    });

    it('sets and retrieves gauge values', () => {
      registry.setGauge('test_gauge', undefined, 42.5);
      expect(registry.getGauge('test_gauge')).toBe(42.5);

      registry.setGauge('link_delay', { mission_mode: 'mars' }, 240.2);
      expect(registry.getGauge('link_delay', { mission_mode: 'mars' })).toBe(240.2);
    });

    it('records duration into histogram buckets, count, and sum', () => {
      registry.observeDuration('http_request_duration_seconds', { method: 'GET' }, 0.02);
      registry.observeDuration('http_request_duration_seconds', { method: 'GET' }, 0.15);

      const exp = registry.exportMetrics();
      expect(exp).toContain('http_request_duration_seconds_bucket{method="GET",le="0.025"} 1');
      expect(exp).toContain('http_request_duration_seconds_bucket{method="GET",le="0.25"} 2');
      expect(exp).toContain('http_request_duration_seconds_count{method="GET"} 2');
      expect(exp).toContain('http_request_duration_seconds_sum{method="GET"} 0.170000');
    });

    it('computes rolling telemetry ingest rates and increments total count', () => {
      registry.recordTelemetryIngest(100);
      expect(registry.getCounter('telemetry_ingested_readings_total')).toBe(100);
      const rate = registry.getGauge('telemetry_ingest_rate_readings_per_second');
      expect(rate).toBeGreaterThan(0);

      const exp = registry.exportMetrics();
      expect(exp).toContain('telemetry_ingested_readings_total 100');
      expect(exp).toContain('telemetry_ingest_rate_readings_per_second');
    });

    it('records clinical alerts and link states', () => {
      registry.recordAlertRaised('cardiac', 'red');
      registry.setAlertCounts({ red: 2, amber: 1, watch: 0 });
      registry.setBusLag('telemetry', 5);
      registry.setLinkState({
        missionMode: 'mars',
        isBlackout: true,
        oneWayDelaySeconds: 720,
        packetLossRate: 0.05,
      });

      const exp = registry.exportMetrics();
      expect(exp).toContain('alerts_raised_total{hazard="cardiac",severity="red"} 1');
      expect(exp).toContain('alerts_active_count{severity="red"} 2');
      expect(exp).toContain('alerts_active_count{severity="amber"} 1');
      expect(exp).toContain('event_bus_lag_events{topic="telemetry"} 5');
      expect(exp).toContain('link_blackout_active{mission_mode="mars"} 1');
      expect(exp).toContain('link_one_way_delay_seconds{mission_mode="mars"} 720');
      expect(exp).toContain('link_packet_loss_rate{mission_mode="mars"} 0.05');
    });
  });

  describe('HTTP /metrics Exposition Endpoints', () => {
    it('serves Prometheus text exposition format on GET /metrics with correct Content-Type', async () => {
      const customRegistry = new PrometheusRegistry();
      const settings = parseConfig({
        ASTRO_ENV: 'test',
        ASTRO_EVENT_BUS_DRIVER: 'memory',
        ASTRO_RATE_LIMIT_ENABLED: 'false',
      });
      const app = createApp({ settings, metricsRegistry: customRegistry });

      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['content-type']).toContain('version=0.0.4');
      expect(res.text).toContain('# HELP http_requests_total');
      expect(res.text).toContain('# TYPE http_requests_total counter');
      expect(res.text).toContain('# HELP telemetry_ingest_rate_readings_per_second');
      expect(res.text).toContain('# HELP link_blackout_active');
    });

    it('serves metrics on /v1/metrics and tracks preceding request counts and durations', async () => {
      const customRegistry = new PrometheusRegistry();
      const settings = parseConfig({
        ASTRO_ENV: 'test',
        ASTRO_EVENT_BUS_DRIVER: 'memory',
        ASTRO_RATE_LIMIT_ENABLED: 'false',
      });
      const app = createApp({ settings, metricsRegistry: customRegistry });

      // Trigger a request to be captured by metrics middleware
      await request(app).get('/v1/flags');

      const res = await request(app).get('/v1/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain(
        'http_requests_total{method="GET",path="/v1/flags",status="200"} 1',
      );
      expect(res.text).toContain(
        'http_request_duration_seconds_count{method="GET",path="/v1/flags"} 1',
      );
    });
  });
});
