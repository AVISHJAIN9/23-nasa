import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export type CheckResult = {
  ok: boolean;
  message?: string;
  duration_ms?: number;
};

export type CheckFunction = () => Promise<boolean | CheckResult> | boolean | CheckResult;

export const ReadinessCheckResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().optional(),
    duration_ms: z.number().optional(),
  })
  .openapi('ReadinessCheckResult');

export const ReadinessResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded']).openapi({ description: 'Overall readiness status' }),
    version: z.string().openapi({ description: 'Application semver version' }),
    mission_mode: z
      .enum(['iss', 'moon', 'mars'])
      .openapi({ description: 'Active mission environment profile' }),
    flags: z.record(z.unknown()).openapi({ description: 'Summary of active feature flags' }),
    checks: z
      .record(ReadinessCheckResultSchema)
      .openapi({ description: 'Status of registered subsystem checks' }),
  })
  .openapi('ReadinessResponse');

export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;

/**
 * Registry for subsystem readiness health checks (e.g. MongoDB, Redis, ML sidecars).
 */
export class ReadinessRegistry {
  private readonly checks = new Map<string, CheckFunction>();

  /**
   * Registers a named health check function.
   *
   * @example
   * registry.registerCheck('mongodb', async () => {
   *   return mongoose.connection.readyState === 1;
   * });
   */
  registerCheck(name: string, fn: CheckFunction): void {
    this.checks.set(name, fn);
  }

  /**
   * Unregisters a named health check (useful for cleanup and tests).
   */
  unregisterCheck(name: string): void {
    this.checks.delete(name);
  }

  /**
   * Clears all registered checks.
   */
  clear(): void {
    this.checks.clear();
  }

  /**
   * Runs all registered checks in parallel.
   */
  async runChecks(): Promise<{ ok: boolean; results: Record<string, CheckResult> }> {
    const results: Record<string, CheckResult> = {};
    let allOk = true;

    const entries = Array.from(this.checks.entries());
    const executions = entries.map(async ([name, fn]) => {
      const start = Date.now();
      try {
        const raw = await fn();
        const duration_ms = Date.now() - start;

        if (typeof raw === 'boolean') {
          results[name] = { ok: raw, duration_ms };
          if (!raw) allOk = false;
        } else {
          results[name] = { ...raw, duration_ms };
          if (!raw.ok) allOk = false;
        }
      } catch (err) {
        const duration_ms = Date.now() - start;
        allOk = false;
        results[name] = {
          ok: false,
          message: err instanceof Error ? err.message : 'Check failed with an unexpected error',
          duration_ms,
        };
      }
    });

    await Promise.all(executions);
    return { ok: allOk, results };
  }
}

export const defaultReadinessRegistry = new ReadinessRegistry();

export const registerCheck = defaultReadinessRegistry.registerCheck.bind(defaultReadinessRegistry);
export const runChecks = defaultReadinessRegistry.runChecks.bind(defaultReadinessRegistry);
