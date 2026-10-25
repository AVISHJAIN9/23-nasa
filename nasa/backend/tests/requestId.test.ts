import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers.js';

describe('Request ID Middleware (F132)', () => {
  it('generates a new UUID v4 when X-Request-ID is missing', async () => {
    const { agent } = createTestApp();

    const res = await agent.get('/health');

    expect(res.status).toBe(200);
    const headerId = res.headers['x-request-id'];
    expect(headerId).toBeDefined();
    expect(headerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('echoes back a valid incoming X-Request-ID in response header', async () => {
    const { agent } = createTestApp();
    const customId = randomUUID();

    const res = await agent.get('/health').set('X-Request-ID', customId);

    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe(customId);
  });

  it('replaces an invalid incoming X-Request-ID with a valid UUID v4', async () => {
    const { agent } = createTestApp();

    const res = await agent.get('/health').set('X-Request-ID', 'invalid-non-uuid-string');

    expect(res.status).toBe(200);
    const headerId = res.headers['x-request-id'];
    expect(headerId).not.toBe('invalid-non-uuid-string');
    expect(headerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('includes the identical request_id in error body and response header', async () => {
    const { agent } = createTestApp();
    const clientTraceId = randomUUID();

    const res = await agent.get('/v1/unknown-endpoint').set('X-Request-ID', clientTraceId);

    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBe(clientTraceId);
    expect(res.body.error.request_id).toBe(clientTraceId);
  });
});
