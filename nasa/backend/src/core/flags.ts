import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { NotFoundError, ValidationError } from './errors.js';

extendZodWithOpenApi(z);

export const LlmModeEnum = z.enum(['auto', 'cloud', 'local']);
export type LlmMode = z.infer<typeof LlmModeEnum>;

export const FLAG_SCHEMAS = {
  ml_enabled: z.boolean(),
  llm_mode: LlmModeEnum,
  rules_only_fallback: z.boolean(),
  demo_panel_enabled: z.boolean(),
} as const;

export type FlagName = keyof typeof FLAG_SCHEMAS;

export interface FlagValues {
  ml_enabled: boolean;
  llm_mode: LlmMode;
  rules_only_fallback: boolean;
  demo_panel_enabled: boolean;
}

export const DEFAULT_FLAGS: FlagValues = {
  ml_enabled: true,
  llm_mode: 'auto',
  rules_only_fallback: false,
  demo_panel_enabled: true,
};

export const FlagsResponseSchema = z
  .object({
    ml_enabled: z.boolean().openapi({ description: 'Enable ML inference pipelines' }),
    llm_mode: LlmModeEnum.openapi({ description: 'LLM operational mode: auto | cloud | local' }),
    rules_only_fallback: z
      .boolean()
      .openapi({ description: 'Fallback to deterministic expert rules when delayed' }),
    demo_panel_enabled: z.boolean().openapi({ description: 'Enable simulation and demo controls' }),
  })
  .openapi('FlagsResponse');

export const FlagUpdateBodySchema = z
  .object({
    value: z
      .union([z.boolean(), z.string()])
      .openapi({ description: 'New value for the feature flag' }),
  })
  .openapi('FlagUpdateBody');

export const FlagUpdateResponseSchema = z
  .object({
    name: z.string().openapi({ description: 'Flag name' }),
    value: z.union([z.boolean(), z.string()]).openapi({ description: 'Updated flag value' }),
  })
  .openapi('FlagUpdateResponse');

/**
 * Storage interface for feature flags. Allows switching between In-Memory and MongoDB stores.
 */
export interface FlagStore {
  get(name: string): Promise<unknown> | unknown;
  set(name: string, value: unknown): Promise<void> | void;
  all(): Promise<Record<string, unknown>> | Record<string, unknown>;
}

/**
 * In-memory implementation of FlagStore.
 */
export class InMemoryFlagStore implements FlagStore {
  private readonly store = new Map<string, unknown>();

  constructor(initialValues?: Record<string, unknown> | Partial<FlagValues>) {
    if (initialValues) {
      for (const [k, v] of Object.entries(initialValues)) {
        this.store.set(k, v);
      }
    }
  }

  get(name: string): unknown {
    return this.store.get(name);
  }

  set(name: string, value: unknown): void {
    this.store.set(name, value);
  }

  all(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of this.store.entries()) {
      result[k] = v;
    }
    return result;
  }
}

/**
 * Parses initial flags from defaults and environment overrides (ASTRO_FLAG_<NAME>).
 */
export function getInitialFlags(env: Record<string, string | undefined> = process.env): FlagValues {
  const flags: FlagValues = { ...DEFAULT_FLAGS };

  if (env['ASTRO_FLAG_ML_ENABLED'] !== undefined) {
    flags.ml_enabled = env['ASTRO_FLAG_ML_ENABLED'].toLowerCase() === 'true';
  }

  if (env['ASTRO_FLAG_LLM_MODE'] !== undefined) {
    const rawMode = env['ASTRO_FLAG_LLM_MODE'];
    const parsed = LlmModeEnum.safeParse(rawMode);
    if (parsed.success) {
      flags.llm_mode = parsed.data;
    }
  }

  if (env['ASTRO_FLAG_RULES_ONLY_FALLBACK'] !== undefined) {
    flags.rules_only_fallback = env['ASTRO_FLAG_RULES_ONLY_FALLBACK'].toLowerCase() === 'true';
  }

  if (env['ASTRO_FLAG_DEMO_PANEL_ENABLED'] !== undefined) {
    flags.demo_panel_enabled = env['ASTRO_FLAG_DEMO_PANEL_ENABLED'].toLowerCase() === 'true';
  }

  return flags;
}

/**
 * Service for querying and updating feature flags.
 */
export class FlagService {
  private readonly store: FlagStore;

  constructor(store?: FlagStore, initialValues?: Partial<Record<string, unknown>>) {
    this.store = store ?? new InMemoryFlagStore(initialValues ?? getInitialFlags());
  }

  /**
   * Synchronous boolean check for a feature flag.
   * Reads directly from the underlying store (which may be sync or async;
   * when the store is InMemoryFlagStore this is always synchronous).
   * Returns false if the flag is unknown or has a falsy value.
   */
  isEnabled(name: FlagName): boolean {
    const raw = this.store.get(name);
    // Store.get may return a Promise for async stores; in that case we cannot
    // resolve synchronously — default to false for safety (fail-closed).
    if (raw instanceof Promise) return false;
    return Boolean(raw);
  }

  /**
   * Retrieves a single flag value by name.
   */
  async get(name: string): Promise<unknown> {
    if (!(name in FLAG_SCHEMAS)) {
      throw new NotFoundError(`Unknown feature flag: '${name}'`);
    }
    return await this.store.get(name);
  }

  /**
   * Returns all current feature flags as a dictionary.
   */
  async all(): Promise<FlagValues> {
    const raw = await this.store.all();
    return {
      ml_enabled: Boolean(raw['ml_enabled']),
      llm_mode: (raw['llm_mode'] as LlmMode) || 'auto',
      rules_only_fallback: Boolean(raw['rules_only_fallback']),
      demo_panel_enabled: Boolean(raw['demo_panel_enabled']),
    };
  }

  /**
   * Sets a feature flag value after validating allowed values and types.
   */
  async set(name: string, value: unknown): Promise<void> {
    if (!(name in FLAG_SCHEMAS)) {
      throw new NotFoundError(`Unknown feature flag: '${name}'`);
    }

    const flagKey = name as FlagName;
    const schema = FLAG_SCHEMAS[flagKey];
    const validationResult = schema.safeParse(value);

    if (!validationResult.success) {
      throw new ValidationError(`Invalid value for flag '${name}'`, [
        {
          field: 'value',
          issue: validationResult.error.errors.map((e) => e.message).join(', '),
        },
      ]);
    }

    await this.store.set(name, validationResult.data);
  }
}
