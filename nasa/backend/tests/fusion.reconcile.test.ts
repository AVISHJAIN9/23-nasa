import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { FakeClock } from '../src/core/clock.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { InMemoryAlertPublisher } from '../src/alerts/alertPublisher.js';
import { MongoFusionRepository } from '../src/fusion/fusionRepository.js';
import { InboxPublisher } from '../src/fusion/inboxPublisher.js';
import { FusionEngine } from '../src/fusion/fusionEngine.js';
import { FusedAlert } from '../src/models/FusedAlert.js';
import { Alert } from '../src/models/Alert.js';
import { reconcileStartupAlerts } from '../src/fusion/reconcile.js';

describe('Startup Reconciliation (reconcile.ts)', () => {
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
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await FusedAlert.deleteMany({});
    await Alert.deleteMany({});
  });

  it('reconciles active raw alerts in database when no fused alerts exist, and is idempotent', async () => {
    // Seed 2 active raw alerts
    await Alert.create({
      crew_id: 'crew-01',
      metric: 'spo2',
      value: 88,
      severity: 'critical',
      status: 'active',
      message: 'SpO2 critical',
      raised_at: '2026-10-18T12:00:00.000Z',
      mission_mode: 'mars',
    });

    await Alert.create({
      crew_id: 'crew-01',
      metric: 'resp_rate',
      value: 28,
      severity: 'warning',
      status: 'active',
      message: 'Resp rate warning',
      raised_at: '2026-10-18T12:01:00.000Z',
      mission_mode: 'mars',
    });

    // Run reconciliation 1: items created
    const stats1 = await reconcileStartupAlerts(engine);
    expect(stats1.activeRuleAlertsProcessed).toBe(2);

    const fusedList = await FusedAlert.find({ group_key: 'crew-01:respiratory' });
    expect(fusedList).toHaveLength(1);
    expect(fusedList[0]?.members).toHaveLength(2);
    expect(fusedList[0]?.status).toBe('open');
    expect(fusedList[0]?.condition).toBe('active');

    // Run reconciliation 2: idempotent, 0 new items processed
    const stats2 = await reconcileStartupAlerts(engine);
    expect(stats2.activeRuleAlertsProcessed).toBe(0);
    expect(stats2.membersCleared).toBe(0);

    const fusedList2 = await FusedAlert.find({ group_key: 'crew-01:respiratory' });
    expect(fusedList2).toHaveLength(1);
    expect(fusedList2[0]?.members).toHaveLength(2);
  });

  it('marks fused member cleared when raw alert in database is cleared', async () => {
    // 1. Create active raw alert and fuse it
    const rawAlert = await Alert.create({
      crew_id: 'crew-02',
      metric: 'temp_c',
      value: 39.5,
      severity: 'warning',
      status: 'active',
      message: 'Temp elevated',
      raised_at: '2026-10-18T12:00:00.000Z',
      mission_mode: 'mars',
    });

    await reconcileStartupAlerts(engine);
    let fused = await FusedAlert.findOne({ group_key: 'crew-02:thermal' });
    expect(fused?.condition).toBe('active');

    // 2. Mark raw alert cleared in DB (e.g. while server was down)
    await Alert.findByIdAndUpdate(rawAlert._id, {
      status: 'cleared',
      cleared_at: '2026-10-18T12:10:00.000Z',
    });

    // 3. Reconcile: active member should be marked cleared
    const stats = await reconcileStartupAlerts(engine);
    expect(stats.membersCleared).toBe(1);

    fused = await FusedAlert.findOne({ group_key: 'crew-02:thermal' });
    expect(fused?.condition).toBe('cleared');
    expect(fused?.members[0]?.status).toBe('cleared');
  });
});
