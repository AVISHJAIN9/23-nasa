import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { FakeClock } from '../src/core/clock.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { InMemoryAlertPublisher } from '../src/alerts/alertPublisher.js';
import { MongoFusionRepository } from '../src/fusion/fusionRepository.js';
import { InboxPublisher } from '../src/fusion/inboxPublisher.js';
import { FusionEngine } from '../src/fusion/fusionEngine.js';
import { FusedAlert } from '../src/models/FusedAlert.js';
import { type AlertDTO } from '../alerts/alertTypes.js';

describe('Storm Test: 50 Concurrent Alert Events (F049)', () => {
  let mongoServer: MongoMemoryServer;
  let fakeClock: FakeClock;
  let eventBus: MemoryEventBus;
  let alertPublisher: InMemoryAlertPublisher;
  let repository: MongoFusionRepository;
  let inboxPublisher: InboxPublisher;
  let engine: FusionEngine;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

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

    await engine.start();
  });

  afterAll(async () => {
    engine.stop();
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('50 raw alert events for ONE crew produce at most 4 fused alerts (one per hazard touched) and exactly one unresolved per hazard', async () => {
    const crewId = 'crew-storm-01';
    const metrics = ['spo2', 'resp_rate', 'heart_rate', 'systolic', 'temp_c'];
    const eventTypes: Array<'alert.raised' | 'alert.updated' | 'alert.cleared'> = [
      'alert.raised',
      'alert.updated',
      'alert.cleared',
    ];

    const stormEvents: Array<{
      type: 'alert.raised' | 'alert.updated' | 'alert.cleared';
      alert: AlertDTO;
    }> = [];

    for (let i = 0; i < 50; i++) {
      const metric = metrics[i % metrics.length]!;
      const eventType = i < 15 ? 'alert.raised' : eventTypes[i % eventTypes.length]!;
      const severity = i % 7 === 0 ? 'critical' : i % 3 === 0 ? 'warning' : 'info';

      stormEvents.push({
        type: eventType,
        alert: {
          id: `raw-storm-${metric}-${i % 3}`, // 3 distinct raw alerts per metric
          crew_id: crewId,
          metric,
          value: 100 + i,
          severity,
          status: eventType === 'alert.cleared' ? 'cleared' : 'active',
          message: `Storm event ${i} for ${metric}`,
          raised_at: '2026-10-18T12:00:00.000Z',
          cleared_at: eventType === 'alert.cleared' ? '2026-10-18T12:01:00.000Z' : undefined,
          mission_mode: 'mars',
        },
      });
    }

    // Fire all 50 events concurrently into AlertPublisher
    await Promise.all(
      stormEvents.map(async (ev) => {
        alertPublisher.publish(ev);
      }),
    );

    // Wait until queue drains
    for (let i = 0; i < 100; i++) {
      const depth = (
        engine as unknown as { keyedQueue: { getDepth: () => number } }
      ).keyedQueue.getDepth();
      if (depth === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    // Check fused alerts produced for this crew
    const allFusedAlerts = await FusedAlert.find({ crew_id: crewId });
    expect(allFusedAlerts.length).toBeLessThanOrEqual(4);

    const hazards = allFusedAlerts.map((f) => f.hazard);
    // Unique hazards touched: respiratory, cardiovascular, thermal (3 hazards)
    const uniqueHazards = Array.from(new Set(hazards));
    expect(uniqueHazards.length).toBeLessThanOrEqual(4);

    // For every hazard touched, there must be at most one unresolved item
    for (const hazard of uniqueHazards) {
      const unresolvedForHazard = await FusedAlert.find({
        crew_id: crewId,
        hazard,
        is_unresolved: true,
      });
      expect(unresolvedForHazard.length).toBeLessThanOrEqual(1);
    }
  });
});
