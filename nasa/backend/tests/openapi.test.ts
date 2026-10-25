import { describe, it, expect } from 'vitest';
import { createTestApp } from './helpers.js';

describe('OpenAPI Specification & Documentation (F131)', () => {
  it('serves OpenAPI 3.0 specification at /v1/openapi.json', async () => {
    const { agent, settings } = createTestApp();

    const res = await agent.get('/v1/openapi.json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('AstroCare API');
    expect(res.body.info.version).toBe(settings.app_version);
    expect(res.body.paths).toBeDefined();
  });

  it('verifies that EVERY route under /v1 has tags, summary, and a success response schema', async () => {
    const { agent } = createTestApp();

    const res = await agent.get('/v1/openapi.json');
    expect(res.status).toBe(200);

    const paths = res.body.paths as Record<
      string,
      Record<
        string,
        {
          tags?: string[];
          summary?: string;
          responses?: Record<string, { description?: string; content?: Record<string, unknown> }>;
        }
      >
    >;

    const offenders: string[] = [];
    let v1RouteCount = 0;

    for (const [pathStr, pathItem] of Object.entries(paths)) {
      if (!pathStr.startsWith('/v1')) {
        continue;
      }

      for (const [method, operation] of Object.entries(pathItem)) {
        if (['parameters', 'summary', 'description'].includes(method)) {
          continue;
        }

        v1RouteCount++;
        const routeId = `${method.toUpperCase()} ${pathStr}`;

        // 1. Tags check
        if (!operation.tags || !Array.isArray(operation.tags) || operation.tags.length === 0) {
          offenders.push(`${routeId}: Missing or empty tags`);
        }

        // 2. Summary check
        if (!operation.summary || operation.summary.trim().length === 0) {
          offenders.push(`${routeId}: Missing or empty summary`);
        }

        // 3. Success response schema check
        const responses = operation.responses || {};
        const successCodes = Object.keys(responses).filter((code) => /^2\d\d$/.test(code));

        if (successCodes.length === 0) {
          offenders.push(`${routeId}: Missing 2xx success response definition`);
        } else {
          const hasSchema = successCodes.some((code) => {
            const resp = responses[code];
            return resp && resp.content && Object.keys(resp.content).length > 0;
          });

          if (!hasSchema) {
            offenders.push(`${routeId}: 2xx response does not contain content schema`);
          }
        }
      }
    }

    expect(v1RouteCount).toBeGreaterThan(0);

    if (offenders.length > 0) {
      throw new Error(
        `OpenAPI specification validation failed for ${offenders.length} route(s):\n${offenders.join('\n')}`,
      );
    }
  });
});
