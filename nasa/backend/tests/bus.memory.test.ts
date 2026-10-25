import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { compareStreamIds, isValidStreamId, type Envelope } from '../src/bus/eventTypes.js';

describe('EventBus - Memory Implementation (F118)', () => {
  let bus: MemoryEventBus;

  beforeEach(() => {
    bus = new MemoryEventBus({ maxLen: 10, missionMode: 'mars' });
  });

  describe('compareStreamIds helper', () => {
    it('compares stream ids numerically by timestamp then sequence', () => {
      expect(compareStreamIds('1000-0', '1000-0')).toBe(0);
      expect(compareStreamIds('1000-0', '1000-1')).toBe(-1);
      expect(compareStreamIds('1000-2', '1000-1')).toBe(1);
      expect(compareStreamIds('999-99', '1000-0')).toBe(-1);
      expect(compareStreamIds('1001-0', '1000-999')).toBe(1);
    });

    it('validates stream id format', () => {
      expect(isValidStreamId('1700000000000-0')).toBe(true);
      expect(isValidStreamId('12345-67')).toBe(true);
      expect(isValidStreamId('invalid')).toBe(false);
      expect(isValidStreamId('$')).toBe(false);
    });
  });

  describe('Publish & Subscribe', () => {
    it('publishes and delivers to local subscriber once, in order', async () => {
      const received: Envelope[] = [];
      const unsub = bus.subscribe((e) => received.push(e));

      const res1 = await bus.publish({
        topic: 'alerts',
        type: 'alert.raised',
        payload: { alert_id: 'a1' },
      });
      const res2 = await bus.publish({
        topic: 'alerts',
        type: 'alert.cleared',
        payload: { alert_id: 'a1' },
      });

      expect(res1.bus).toBe('ok');
      expect(res1.id).toBeTruthy();
      expect(res2.id).toBeTruthy();
      expect(compareStreamIds(res1.id!, res2.id!)).toBe(-1);

      expect(received).toHaveLength(2);
      expect(received[0].type).toBe('alert.raised');
      expect(received[1].type).toBe('alert.cleared');
      expect(received[0].uid).toBe(res1.uid);
      expect(received[1].uid).toBe(res2.uid);

      unsub();
      await bus.publish({
        topic: 'alerts',
        type: 'alert.raised',
        payload: { alert_id: 'a2' },
      });
      expect(received).toHaveLength(2);
    });

    it('filters subscribers by topic', async () => {
      const alertEvents: Envelope[] = [];
      const emergencyEvents: Envelope[] = [];

      bus.subscribe((e) => alertEvents.push(e), { topics: ['alerts'] });
      bus.subscribe((e) => emergencyEvents.push(e), { topics: ['emergency'] });

      await bus.publish({ topic: 'alerts', type: 'alert.raised', payload: {} });
      await bus.publish({ topic: 'emergency', type: 'emergency.declared', payload: {} });

      expect(alertEvents).toHaveLength(1);
      expect(alertEvents[0].topic).toBe('alerts');
      expect(emergencyEvents).toHaveLength(1);
      expect(emergencyEvents[0].topic).toBe('emergency');
    });

    it('delivers ephemeral telemetry events to subscribers, but does NOT store in ring buffer', async () => {
      const received: Envelope[] = [];
      bus.subscribe((e) => received.push(e));

      const res = await bus.publish({
        topic: 'telemetry',
        type: 'telemetry.update',
        crew_id: 'c1',
        payload: { heart_rate: 75 },
      });

      expect(res.bus).toBe('ok');
      expect(res.id).toBeNull();
      expect(received).toHaveLength(1);
      expect(received[0].topic).toBe('telemetry');

      const info = bus.info();
      expect(info.stream_length).toBe(0);
      expect(info.head_id).toBeNull();

      const replay = await bus.replay(null, { limit: 10, filter: () => true });
      expect(replay.head_id).toBeNull();
    });
  });

  describe('Replay behavior', () => {
    it('returns only head_id when afterId is null', async () => {
      const res = await bus.publish({
        topic: 'alerts',
        type: 'alert.raised',
        payload: { alert_id: 'a1' },
      });

      const replay = await bus.replay(null, { limit: 10, filter: () => true });
      expect(replay.events).toEqual([]);
      expect(replay.truncated).toBe(false);
      expect(replay.reset).toBe(false);
      expect(replay.head_id).toBe(res.id);
    });

    it('replays exactly later events after afterId in order', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await bus.publish({
          topic: 'alerts',
          type: 'alert.raised',
          payload: { index: i },
        });
        ids.push(res.id!);
      }

      // Replay after index 1
      const replay = await bus.replay(ids[1], { limit: 10, filter: () => true });
      expect(replay.events).toHaveLength(3);
      expect(replay.events[0].id).toBe(ids[2]);
      expect(replay.events[1].id).toBe(ids[3]);
      expect(replay.events[2].id).toBe(ids[4]);
      expect(replay.truncated).toBe(false);
      expect(replay.reset).toBe(false);
    });

    it('respects filter and limit during replay', async () => {
      const p1 = await bus.publish({
        topic: 'alerts',
        type: 'alert.raised',
        crew_id: 'crew-1',
        payload: {},
      });
      await bus.publish({ topic: 'alerts', type: 'alert.raised', crew_id: 'crew-2', payload: {} });
      const p3 = await bus.publish({
        topic: 'alerts',
        type: 'alert.raised',
        crew_id: 'crew-1',
        payload: {},
      });
      await bus.publish({ topic: 'alerts', type: 'alert.raised', crew_id: 'crew-1', payload: {} });

      const replayCrew1 = await bus.replay(p1.id, {
        limit: 1,
        filter: (e) => e.crew_id === 'crew-1',
      });

      expect(replayCrew1.events).toHaveLength(1);
      expect(replayCrew1.events[0].id).toBe(p3.id);
      expect(replayCrew1.truncated).toBe(true);
    });

    it('returns reset: true if afterId is newer than head_id', async () => {
      const p1 = await bus.publish({ topic: 'alerts', type: 'alert.raised', payload: {} });
      const futureId = '9999999999999-0';

      const replay = await bus.replay(futureId, { limit: 10, filter: () => true });
      expect(replay.reset).toBe(true);
      expect(replay.events).toHaveLength(0);
      expect(replay.head_id).toBe(p1.id);
    });

    it('returns truncated: true when afterId is older than trimmed buffer', async () => {
      // bus maxLen is 10
      const ids: string[] = [];
      for (let i = 0; i < 15; i++) {
        const res = await bus.publish({
          topic: 'alerts',
          type: 'alert.raised',
          payload: { index: i },
        });
        ids.push(res.id!);
      }

      // Replay after index 0 (which was trimmed from the 10-item buffer)
      const replay = await bus.replay(ids[0], { limit: 20, filter: () => true });
      expect(replay.truncated).toBe(true);
      expect(replay.reset).toBe(false);
      // Remaining 10 items in buffer (from index 5 to 14)
      expect(replay.events).toHaveLength(10);
    });
  });

  describe('info() and lifecycle', () => {
    it('returns correct bus info metrics', async () => {
      const info0 = bus.info();
      expect(info0.driver).toBe('memory');
      expect(info0.connected).toBe(true);
      expect(info0.stream_length).toBe(0);
      expect(info0.head_id).toBeNull();
      expect(info0.subscriber_count).toBe(0);

      const unsub = bus.subscribe(() => {});
      const p = await bus.publish({ topic: 'alerts', type: 'alert.raised', payload: {} });

      const info1 = bus.info();
      expect(info1.subscriber_count).toBe(1);
      expect(info1.stream_length).toBe(1);
      expect(info1.head_id).toBe(p.id);

      unsub();
      await bus.close();
      expect(bus.info().connected).toBe(false);
    });
  });
});
