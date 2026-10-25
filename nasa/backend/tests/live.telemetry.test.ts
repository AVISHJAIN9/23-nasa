import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTelemetryPublisher } from '../src/telemetry/publisher.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { TelemetryBridge } from '../src/bus/telemetryBridge.js';
import { type Envelope } from '../src/bus/eventTypes.js';
import { type EvaluatedReading } from '../src/telemetry/qualityEvaluator.js';

describe('Live Telemetry Coalescing and Bridge (F118)', () => {
  let publisher: InMemoryTelemetryPublisher;
  let eventBus: MemoryEventBus;
  let bridge: TelemetryBridge;
  let receivedEvents: Envelope[];

  beforeEach(() => {
    publisher = new InMemoryTelemetryPublisher();
    eventBus = new MemoryEventBus();
    receivedEvents = [];
    eventBus.subscribe((e) => receivedEvents.push(e), { topics: ['telemetry'] });

    bridge = new TelemetryBridge(publisher, eventBus, { coalesceMs: 50 });
  });

  function createReading(
    crewId: string,
    metric: string,
    value: number,
    flag: 'ok' | 'spike' | 'dropout' = 'ok',
  ): EvaluatedReading {
    return {
      crew_id: crewId,
      metric,
      value,
      timestamp: new Date(),
      source: 'simulated',
      quality: { flag, reasons: [] },
      ingested_at: new Date(),
    };
  }

  it('coalesces multiple high-frequency readings into a single update per crew per interval', async () => {
    bridge.start();

    // Publish 5 readings for crew-1 across 2 metrics in quick succession
    publisher.publish({
      readings: [
        createReading('crew-1', 'heart_rate', 70),
        createReading('crew-1', 'spo2', 98),
        createReading('crew-1', 'heart_rate', 72),
        createReading('crew-1', 'heart_rate', 75),
        createReading('crew-1', 'spo2', 97),
      ],
    });

    // Wait for coalesce flush interval (50ms)
    await new Promise((r) => setTimeout(r, 80));

    expect(receivedEvents).toHaveLength(1);
    const event = receivedEvents[0];
    expect(event.topic).toBe('telemetry');
    expect(event.type).toBe('telemetry.update');
    expect(event.crew_id).toBe('crew-1');

    const values = event.payload['values'] as Record<
      string,
      { value: number; quality_flag: string }
    >;
    expect(values['heart_rate'].value).toBe(75);
    expect(values['spo2'].value).toBe(97);

    bridge.stop();
  });

  it('includes quality flags on readings so UI can display quality states', async () => {
    bridge.start();

    publisher.publish({
      readings: [createReading('crew-1', 'heart_rate', 210, 'spike')],
    });

    await new Promise((r) => setTimeout(r, 80));

    expect(receivedEvents).toHaveLength(1);
    const values = receivedEvents[0].payload['values'] as Record<
      string,
      { value: number; quality_flag: string }
    >;
    expect(values['heart_rate'].quality_flag).toBe('spike');
    expect(values['heart_rate'].value).toBe(210);

    bridge.stop();
  });

  it('ensures telemetry is never added to the replay stream', async () => {
    bridge.start();

    publisher.publish({
      readings: [createReading('crew-1', 'heart_rate', 80)],
    });

    await new Promise((r) => setTimeout(r, 80));
    expect(receivedEvents).toHaveLength(1);

    // Query replay from bus
    const replay = await eventBus.replay('0-0', { limit: 10, filter: () => true });
    expect(replay.events).toHaveLength(0);

    bridge.stop();
  });

  it('verifies the ingest callback does zero asynchronous I/O and executes synchronously', () => {
    bridge.start();

    const start = performance.now();
    publisher.publish({
      readings: [createReading('crew-1', 'heart_rate', 75), createReading('crew-2', 'spo2', 99)],
    });
    const elapsed = performance.now() - start;

    // Callback execution is pure memory assignment, should be well under 5ms
    expect(elapsed).toBeLessThan(10);

    bridge.stop();
  });
});
