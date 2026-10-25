import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { FakeClock } from '../src/core/clock.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { InMemoryAlertPublisher } from '../src/alerts/alertPublisher.js';
import { MongoFusionRepository } from '../src/fusion/fusionRepository.js';
import { InboxPublisher } from '../src/fusion/inboxPublisher.js';
import { FusionEngine } from '../src/fusion/fusionEngine.js';
import { SnoozeSweeper } from '../src/fusion/snoozeSweeper.js';
import { FusedAlert } from '../src/models/FusedAlert.js';
import { type Envelope } from '../src/bus/eventTypes.js';
import { applySnooze } from '../src/fusion/workflow.js';

describe('FusionEngine Integration Tests (F049 / F097)', () => {
  let mongoServer: MongoMemoryServer;
  let fakeClock: FakeClock;
  let eventBus: MemoryEventBus;
  let alertPublisher: InMemoryAlertPublisher;
  let repository: MongoFusionRepository;
  let inboxPublisher: InboxPublisher;
  let engine: FusionEngine;
  let sweeper: SnoozeSweeper;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await FusedAlert.deleteMany({});

    fakeClock = new FakeClock('2026-10-18T12:00:00.000Z');
    eventBus = new MemoryEventBus();
    alertPublisher = new InMemoryAlertPublisher();
    repository = new MongoFusionRepository();
    inboxPublisher = new InboxPublisher(eventBus);

    engine = new FusionEngine(
      repository,
      inboxPublisher,
      fakeClock,
      {
        enabled: true,
        minConfidence: 0.5,
        dismissSuppressS: 3600,
        updateCoalesceS: 2,
        maxMembers: 50,
        timelineMax: 200,
        reconcileOnStart: false,
      },
      alertPublisher,
    );

    sweeper = new SnoozeSweeper(repository, inboxPublisher, fakeClock, 5);

    await engine.start();
  });

  afterEach(() => {
    engine?.stop();
    sweeper?.stop();
  });

  it('creates one fused alert from alert.raised and publishes inbox.raised with fusion_latency_ms', async () => {
    const publishedEvents: Envelope[] = [];
    eventBus.subscribe((env) => {
      if (env.type.startsWith('inbox.')) {
        publishedEvents.push(env);
      }
    });

    alertPublisher.publish({
      type: 'alert.raised',
      alert: {
        id: 'raw-spo2-1',
        crew_id: 'crew-01',
        metric: 'spo2',
        value: 87,
        severity: 'critical',
        status: 'active',
        message: 'SpO2 critically low at 87%',
        raised_at: '2026-10-18T12:00:00.000Z',
        mission_mode: 'mars',
      },
    });

    let fused = await FusedAlert.findOne({ group_key: 'crew-01:respiratory' });
    for (let i = 0; i < 50 && !fused; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      fused = await FusedAlert.findOne({ group_key: 'crew-01:respiratory' });
    }

    expect(fused).not.toBeNull();
    expect(fused?.severity).toBe('critical');
    expect(fused?.condition).toBe('active');
    expect(fused?.status).toBe('open');
    expect(fused?.members).toHaveLength(1);
    expect(fused?.members[0]?.ref_id).toBe('raw-spo2-1');
    expect(fused?.fusion_latency_ms).toBeDefined();
    expect(fused?.fusion_latency_ms).toBeLessThanOrEqual(1000);

    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]?.type).toBe('inbox.raised');
    expect(publishedEvents[0]?.crew_id).toBe('crew-01');
    expect(publishedEvents[0]?.topic).toBe('alerts');
  });

  it('updates fused alert on alert.updated and clears condition when cleared', async () => {
    // 1. Raise alert
    alertPublisher.publish({
      type: 'alert.raised',
      alert: {
        id: 'raw-spo2-1',
        crew_id: 'crew-01',
        metric: 'spo2',
        value: 89,
        severity: 'warning',
        status: 'active',
        message: 'SpO2 warning',
        raised_at: '2026-10-18T12:00:00.000Z',
        mission_mode: 'mars',
      },
    });

    let fused = await FusedAlert.findOne({ group_key: 'crew-01:respiratory' });
    for (let i = 0; i < 50 && !fused; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      fused = await FusedAlert.findOne({ group_key: 'crew-01:respiratory' });
    }

    // 2. Clear alert
    alertPublisher.publish({
      type: 'alert.cleared',
      alert: {
        id: 'raw-spo2-1',
        crew_id: 'crew-01',
        metric: 'spo2',
        value: 98,
        severity: 'warning',
        status: 'cleared',
        message: 'SpO2 recovered',
        raised_at: '2026-10-18T12:00:00.000Z',
        cleared_at: '2026-10-18T12:05:00.000Z',
        mission_mode: 'mars',
      },
    });

    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      fused = await FusedAlert.findOne({ group_key: 'crew-01:respiratory' });
      if (fused?.condition === 'cleared') break;
    }

    expect(fused?.condition).toBe('cleared');
    expect(fused?.status).toBe('open'); // Stays open until acknowledged
    expect(fused?.cleared_at).toBe('2026-10-18T12:05:00.000Z');
  });

  it('handles race conditions: two concurrent inserts create exactly one unresolved item and attach both', async () => {
    const input1 = {
      source: 'rule' as const,
      ref_id: 'race-r1',
      crew_id: 'crew-02',
      hazard: 'thermal' as const,
      metric: 'temp_c',
      severity: 'warning' as const,
      status: 'active' as const,
      raised_at: '2026-10-18T12:00:00.000Z',
      event_at: '2026-10-18T12:00:00.000Z',
      title: 'Temp High',
      explanation: 'Hyperthermia',
      mission_mode: 'mars' as const,
    };

    const input2 = {
      source: 'anomaly' as const,
      ref_id: 'race-ml1',
      crew_id: 'crew-02',
      hazard: 'thermal' as const,
      metric: 'temp_c',
      severity: 'warning' as const,
      status: 'active' as const,
      confidence: 0.9,
      raised_at: '2026-10-18T12:00:00.000Z',
      event_at: '2026-10-18T12:00:00.000Z',
      title: 'ML Temp Anomaly',
      explanation: 'Thermal spike',
      mission_mode: 'mars' as const,
    };

    // Run both concurrently
    await Promise.all([engine.processInput(input1), engine.processInput(input2)]);

    const items = await FusedAlert.find({ group_key: 'crew-02:thermal', is_unresolved: true });
    expect(items).toHaveLength(1);
    expect(items[0]?.members).toHaveLength(2);
    expect(items[0]?.sources).toEqual(expect.arrayContaining(['rule', 'anomaly']));
  });

  it('update coalescing: skips publishing member refreshes that change no visible state within window', async () => {
    const publishedEvents: Envelope[] = [];
    eventBus.subscribe((env) => {
      if (env.type.startsWith('inbox.')) {
        publishedEvents.push(env);
      }
    });

    const input1 = {
      source: 'rule' as const,
      ref_id: 'r1',
      crew_id: 'crew-03',
      hazard: 'cardiovascular' as const,
      metric: 'heart_rate',
      severity: 'warning' as const,
      status: 'active' as const,
      raised_at: '2026-10-18T12:00:00.000Z',
      event_at: '2026-10-18T12:00:00.000Z',
      title: 'Tachycardia',
      explanation: 'HR elevated',
      mission_mode: 'mars' as const,
    };

    // 1. Initial creation: publishes inbox.raised immediately
    await engine.processInput(input1);
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]?.type).toBe('inbox.raised');

    // 2. Advance clock by 500ms (inside 2s coalesce window) and send identical reading refresh
    fakeClock.advanceMs(500);
    await engine.processInput({
      ...input1,
      event_at: fakeClock.nowIso(),
    });

    // Unchanged update is persisted to DB but skipped on bus!
    expect(publishedEvents).toHaveLength(1);

    // 3. Advance past 2s coalesce window and send another refresh: now it publishes!
    fakeClock.advanceSeconds(3);
    await engine.processInput({
      ...input1,
      event_at: fakeClock.nowIso(),
    });
    expect(publishedEvents).toHaveLength(2);
    expect(publishedEvents[1]?.type).toBe('inbox.updated');
  });

  it('sweeper: sweepOnce wakes expired snoozes and publishes inbox.status_changed', async () => {
    // 1. Create alert
    const item = await engine.processInput({
      source: 'rule',
      ref_id: 'r1',
      crew_id: 'crew-01',
      hazard: 'thermal',
      metric: 'temp_c',
      severity: 'warning',
      status: 'active',
      raised_at: fakeClock.nowIso(),
      event_at: fakeClock.nowIso(),
      title: 'Temp Warning',
      explanation: 'High temp',
      mission_mode: 'mars',
    });

    expect(item).not.toBeNull();

    // 2. Snooze for 30 minutes
    const { state: snoozedState } = applySnooze(
      item!.toObject(),
      { userId: 'surgeon-1', role: 'flight_surgeon' },
      30,
      'Monitoring trend',
      fakeClock.nowIso(),
      { maxWarningMin: 60, maxWatchMin: 480 },
    );
    await repository.atomicUpdateAlert(item!._id.toString(), snoozedState);

    const publishedEvents: Envelope[] = [];
    eventBus.subscribe((env) => {
      if (env.type.startsWith('inbox.')) {
        publishedEvents.push(env);
      }
    });

    // 3. Sweep before expiry (10 min in): nothing wakes
    fakeClock.advanceMinutes(10);
    const awakenedEarly = await sweeper.sweepOnce();
    expect(awakenedEarly).toBe(0);
    expect(publishedEvents).toHaveLength(0);

    // 4. Advance past 30 min (total 35 min in): alert wakes!
    fakeClock.advanceMinutes(25);
    const awakened = await sweeper.sweepOnce();
    expect(awakened).toBe(1);

    const updated = await FusedAlert.findById(item!._id);
    expect(updated?.status).toBe('open');
    expect(updated?.snoozed_until).toBeUndefined();

    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]?.type).toBe('inbox.status_changed');
  });

  it('readiness check reports valid metrics', async () => {
    const ready = await engine.getReadiness();
    expect(ready.running).toBe(true);
    expect(ready.queue_depth).toBe(0);
    expect(typeof ready.unresolved_count).toBe('number');
    expect(typeof ready.unacked_critical).toBe('number');
  });
});
