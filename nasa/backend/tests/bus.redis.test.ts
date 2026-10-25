import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisEventBus } from '../src/bus/redisEventBus.js';
import { type Envelope } from '../src/bus/eventTypes.js';

const redisUrl = process.env.ASTRO_TEST_REDIS_URL;

describe.skipIf(!redisUrl)('EventBus - Redis Implementation (F118)', () => {
  let bus: RedisEventBus;

  beforeAll(() => {
    bus = new RedisEventBus({
      redisUrl: redisUrl!,
      keyPrefix: `test:${Date.now()}:`,
      streamMaxlen: 100,
    });
  });

  afterAll(async () => {
    if (bus) {
      await bus.close();
    }
  });

  it('publishes and receives events via Redis streams', async () => {
    const received: Envelope[] = [];
    const unsub = bus.subscribe((e) => received.push(e));

    const pubRes = await bus.publish({
      topic: 'alerts',
      type: 'alert.raised',
      payload: { test: true },
    });

    expect(pubRes.bus).toBe('ok');
    expect(pubRes.id).toBeTruthy();

    // Allow reader loop to deliver
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(received.some((e) => e.uid === pubRes.uid)).toBe(true);
    unsub();
  });

  it('replays events from Redis stream', async () => {
    const pubRes1 = await bus.publish({
      topic: 'alerts',
      type: 'alert.raised',
      payload: { step: 1 },
    });
    const pubRes2 = await bus.publish({
      topic: 'alerts',
      type: 'alert.raised',
      payload: { step: 2 },
    });

    const replay = await bus.replay(pubRes1.id, {
      limit: 10,
      filter: () => true,
    });

    expect(replay.events.length).toBeGreaterThanOrEqual(1);
    expect(replay.events.some((e) => e.uid === pubRes2.uid)).toBe(true);
  });
});
