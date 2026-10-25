/**
 * Tests for DTN Store-and-Forward Queue, Deduplication, Ordering, and Conflict-Safe Sync (Phase 4).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestMongo, teardownTestMongo, clearTestMongo } from './helpers.js';
import { FakeClock } from '../src/core/clock.js';
import { parseConfig } from '../src/core/config.js';
import { InMemoryLinkStore } from '../src/link/linkStore.js';
import { CommsDelayEmulator } from '../src/link/commsDelayEmulator.js';
import { StoreAndForwardQueue } from '../src/link/storeAndForward.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { DtnMessage } from '../src/models/DtnMessage.js';

describe('DTN Store-and-Forward Queue & Conflict Resolution (Phase 4)', () => {
  let clock: FakeClock;
  let emulator: CommsDelayEmulator;
  let linkStore: InMemoryLinkStore;
  let eventBus: MemoryEventBus;
  let queue: StoreAndForwardQueue;

  const BASE_TIME = Date.UTC(2025, 0, 15, 12, 0, 0);

  beforeEach(async () => {
    await setupTestMongo();
    await clearTestMongo();

    clock = new FakeClock(BASE_TIME);
    const settings = parseConfig({ ASTRO_MISSION_MODE: 'mars' });
    linkStore = new InMemoryLinkStore();
    emulator = new CommsDelayEmulator({ clock, settings, linkStore });
    await emulator.refresh();

    eventBus = new MemoryEventBus({ maxLen: 100, missionMode: 'mars' });
    queue = new StoreAndForwardQueue({ clock, emulator, eventBus });
  });

  afterEach(async () => {
    await teardownTestMongo();
  });

  it('assigns strictly monotonic sequence numbers per direction', async () => {
    const msg1 = await queue.enqueue({
      direction: 'uplink',
      sender_id: 'ground-1',
      sender_role: 'flight_surgeon',
      type: 'clinical_note',
      payload: { note: 'Hydration directive' },
      idempotency_key: 'key-seq-1',
    });

    const msg2 = await queue.enqueue({
      direction: 'uplink',
      sender_id: 'ground-1',
      sender_role: 'flight_surgeon',
      type: 'clinical_note',
      payload: { note: 'Followup note' },
      idempotency_key: 'key-seq-2',
    });

    const msg3 = await queue.enqueue({
      direction: 'downlink',
      sender_id: 'cmo-1',
      sender_role: 'astronaut',
      type: 'vitals_report',
      payload: { hr: 72 },
      idempotency_key: 'key-seq-3',
    });

    expect(msg1.sequence_number).toBe(1);
    expect(msg2.sequence_number).toBe(2);
    expect(msg3.sequence_number).toBe(1); // downlink sequence is separate
  });

  it('deduplicates messages with identical idempotency_key', async () => {
    const first = await queue.enqueue({
      direction: 'downlink',
      sender_id: 'cmo-1',
      sender_role: 'astronaut',
      type: 'protocol_action',
      payload: { step: 's1', action: 'ECG checked' },
      idempotency_key: 'idem-key-duplicate-test',
    });

    const second = await queue.enqueue({
      direction: 'downlink',
      sender_id: 'cmo-1',
      sender_role: 'astronaut',
      type: 'protocol_action',
      payload: { step: 's1', action: 'ECG checked (retry)' },
      idempotency_key: 'idem-key-duplicate-test',
    });

    expect(first.message_id).toBe(second.message_id);
    expect(first.sequence_number).toBe(second.sequence_number);

    const totalInDb = await DtnMessage.countDocuments();
    expect(totalInDb).toBe(1);
  });

  it('marks messages as "queued" when comms link is in blackout', async () => {
    // Force blackout
    await emulator.setOverride('downlink', {
      force_blackout: true,
      actor_id: 'admin',
    });

    const msg = await queue.enqueue({
      direction: 'downlink',
      sender_id: 'cmo-1',
      sender_role: 'astronaut',
      type: 'protocol_action',
      payload: { step: 's2' },
      idempotency_key: 'blackout-msg-1',
    });

    expect(msg.status).toBe('queued');
    expect(msg.release_at).toBeNull();
  });

  it('applies one-way delay for in-flight messages when link is live', async () => {
    // Set 5-minute Mars delay (300,000 ms), no blackout
    await emulator.setOverride('downlink', {
      force_delay_ms: 300_000,
      force_blackout: false,
      actor_id: 'admin',
    });

    const msg = await queue.enqueue({
      direction: 'downlink',
      sender_id: 'cmo-1',
      sender_role: 'astronaut',
      type: 'telemetry_burst',
      payload: { batch_size: 50 },
      idempotency_key: 'delayed-msg-1',
    });

    expect(msg.status).toBe('in_flight');
    expect(msg.release_at).toBe(new Date(BASE_TIME + 300_000).toISOString());
  });

  it('syncOnReconnect blocks draining while blackout is still active', async () => {
    await emulator.setOverride('downlink', { force_blackout: true, actor_id: 'admin' });

    await queue.enqueue({
      direction: 'downlink',
      sender_id: 'cmo-1',
      sender_role: 'astronaut',
      type: 'vitals',
      payload: {},
      idempotency_key: 'blackout-sync-block',
    });

    const res = await queue.syncOnReconnect();
    expect(res.ok).toBe(false);
    expect(res.link_state.in_blackout).toBe(true);
    expect(res.delivered_count).toBe(0);
  });

  it('resolves conflicts with "onboard_wins" when emergency life-safety actions clash with ground directives', async () => {
    // 1. Enter blackout
    await emulator.setOverride('downlink', { force_blackout: true, actor_id: 'admin' });

    const emergencyId = 'emg-cardiac-777';

    // 2. Ground enqueues directive during blackout
    const groundMsg = await queue.enqueue({
      direction: 'uplink',
      sender_id: 'flight_surgeon_ground',
      sender_role: 'flight_surgeon',
      type: 'emergency_directive',
      target_id: emergencyId,
      payload: {
        emergency_id: emergencyId,
        directive: 'Wait for ground telemetry analysis before administering drugs',
      },
      idempotency_key: 'ground-directive-1',
    });

    // 3. Crew Medical Officer on-scene executes immediate life-saving protocol
    const onboardMsg = await queue.enqueue({
      direction: 'downlink',
      sender_id: 'cmo_onboard',
      sender_role: 'astronaut',
      type: 'protocol_action',
      target_id: emergencyId,
      payload: {
        emergency_id: emergencyId,
        action_taken: 'Administered Adenosine 6mg rapid IV for acute SVT',
        is_emergency: true,
      },
      idempotency_key: 'cmo-intervention-1',
    });

    expect(groundMsg.status).toBe('queued');
    expect(onboardMsg.status).toBe('queued');

    // 4. Blackout ends, comms restored
    await emulator.setOverride('downlink', {
      force_blackout: false,
      force_delay_ms: 100, // fast link for sync
      actor_id: 'admin',
    });

    // 5. Trigger syncOnReconnect
    const syncRes = await queue.syncOnReconnect({
      nowMs: BASE_TIME + 60_000,
      reconciledBy: 'auto_sync_engine',
    });

    expect(syncRes.ok).toBe(true);
    expect(syncRes.conflicts_count).toBe(1);

    // Verify DB state
    const updatedGround = await DtnMessage.findOne({ message_id: groundMsg.message_id });
    const updatedOnboard = await DtnMessage.findOne({ message_id: onboardMsg.message_id });

    expect(updatedOnboard?.status).toBe('delivered');
    expect(updatedGround?.status).toBe('conflict');
    expect(updatedGround?.conflict_resolution?.policy).toBe('onboard_wins');
    expect(updatedGround?.conflict_resolution?.winner_message_id).toBe(onboardMsg.message_id);
    expect(updatedGround?.conflict_resolution?.details).toContain('takes clinical precedence');
  });

  it('resolves conflicts with "ground_wins" for administrative / long-term prescription revisions', async () => {
    await emulator.setOverride('downlink', { force_blackout: true, actor_id: 'admin' });

    const targetId = 'prescription-policy-44';

    // Ground updates clinical prescription policy
    const groundMsg = await queue.enqueue({
      direction: 'uplink',
      sender_id: 'flight_surgeon_ground',
      sender_role: 'flight_surgeon',
      type: 'clinical_prescription',
      target_id: targetId,
      payload: { policy: 'Adjust radiation antioxidant dosage to 500mg' },
      idempotency_key: 'ground-policy-1',
    });

    // Onboard queries routine medication log
    const onboardMsg = await queue.enqueue({
      direction: 'downlink',
      sender_id: 'astronaut_1',
      sender_role: 'astronaut',
      type: 'routine_medication_query',
      target_id: targetId,
      payload: { query: 'Antioxidant stock check' },
      idempotency_key: 'onboard-query-1',
    });

    // Comms restored
    await emulator.setOverride('downlink', {
      force_blackout: false,
      force_delay_ms: 50,
      actor_id: 'admin',
    });

    const syncRes = await queue.syncOnReconnect({
      nowMs: BASE_TIME + 120_000,
    });

    expect(syncRes.ok).toBe(true);

    const updatedGround = await DtnMessage.findOne({ message_id: groundMsg.message_id });
    const updatedOnboard = await DtnMessage.findOne({ message_id: onboardMsg.message_id });

    expect(updatedGround?.status).toBe('delivered');
    expect(updatedOnboard?.status).toBe('conflict');
    expect(updatedOnboard?.conflict_resolution?.policy).toBe('ground_wins');
  });

  it('drops messages when packet loss occurs on the radio link', async () => {
    // Force packet loss override on active link (non-blackout)
    await emulator.setOverride('downlink', {
      force_blackout: false,
      force_packet_loss_rate: 1.0, // 100% loss
      actor_id: 'admin',
    });

    const decision = emulator.delivery(BASE_TIME, {
      simulatePacketLoss: true,
    });

    expect(decision.deliverability).toBe('never');
    expect(decision.dropped).toBe(true);
    expect(decision.reason).toBe('packet_loss');
  });

  it('merges non-conflicting concurrent ground and onboard updates during sync', async () => {
    await emulator.setOverride('downlink', { force_blackout: true, actor_id: 'admin' });

    // Ground updates communication schedule (target: sched-1)
    const groundMsg = await queue.enqueue({
      direction: 'uplink',
      sender_id: 'flight_director',
      sender_role: 'flight_director',
      type: 'comm_schedule_update',
      target_id: 'sched-1',
      payload: { next_pass: '14:00 UTC' },
      idempotency_key: 'ground-sched-1',
    });

    // Onboard reports water recycler status (target: eclss-water-2)
    const onboardMsg = await queue.enqueue({
      direction: 'downlink',
      sender_id: 'cmo-1',
      sender_role: 'astronaut',
      type: 'subsystem_telemetry',
      target_id: 'eclss-water-2',
      payload: { tank_level_pct: 92 },
      idempotency_key: 'onboard-water-1',
    });

    // Link restored
    await emulator.setOverride('downlink', {
      force_blackout: false,
      force_delay_ms: 100,
      actor_id: 'admin',
    });

    const syncRes = await queue.syncOnReconnect({
      nowMs: BASE_TIME + 60_000,
    });

    expect(syncRes.ok).toBe(true);
    expect(syncRes.conflicts_count).toBe(0);
    expect(syncRes.delivered_count).toBe(2);

    const updatedGround = await DtnMessage.findOne({ message_id: groundMsg.message_id });
    const updatedOnboard = await DtnMessage.findOne({ message_id: onboardMsg.message_id });

    expect(updatedGround?.status).toBe('delivered');
    expect(updatedOnboard?.status).toBe('delivered');
  });
});
