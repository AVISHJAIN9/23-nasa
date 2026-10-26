import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env if present
dotenv.config();

export const SettingsSchema = z
  .object({
    env: z
      .enum(['dev', 'test', 'prod'], {
        errorMap: () => ({ message: "ASTRO_ENV must be one of: 'dev', 'test', 'prod'" }),
      })
      .default('dev'),
    port: z.coerce
      .number({ invalid_type_error: 'ASTRO_PORT must be a valid port number' })
      .int()
      .min(1)
      .max(65535)
      .default(4000),
    app_version: z.string().default('0.1.0'),
    cors_origins: z
      .union([z.string(), z.array(z.string())])
      .transform((val) => {
        if (Array.isArray(val)) return val;
        return val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      })
      .refine(
        (origins) => !origins.includes('*'),
        'CORS origins cannot contain wildcard "*" when credentials (cookies) are enabled.',
      )
      .default(['http://localhost:5173']),
    mission_mode: z
      .enum(['iss', 'moon', 'mars'], {
        errorMap: () => ({ message: "ASTRO_MISSION_MODE must be one of: 'iss', 'moon', 'mars'" }),
      })
      .default('mars'),
    log_level: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
        errorMap: () => ({
          message:
            "ASTRO_LOG_LEVEL must be one of: 'fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'",
        }),
      })
      .default('info'),
    mongodb_uri: z.string().min(1).default('mongodb://localhost:27017/astrocare'),
    jwt_access_secret: z.string().default('dev_insecure_access_secret_min_32_chars_long!'),
    jwt_refresh_secret: z.string().default('dev_insecure_refresh_secret_min_32_chars_long!'),
    access_token_ttl: z.string().default('15m'),
    refresh_token_ttl: z.string().default('7d'),
    cookie_secure: z.boolean().optional(),
    ingest_api_key: z.string().default('dev_insecure_ingest_api_key_min_32_characters!'),
    telemetry_max_batch: z.coerce.number().int().min(1).max(5000).default(500),
    telemetry_expected_interval_s: z.coerce.number().min(0.01).default(1),
    telemetry_max_interp_gap_s: z.coerce.number().min(1).default(10),
    telemetry_retention_days: z.coerce.number().int().min(0).default(0),
    idempotency_ttl_h: z.coerce.number().int().min(1).default(24),
    // Phase 5: Rate Limiting and Security settings
    rate_limit_enabled: z.boolean().default(true),
    rate_limit_window_s: z.coerce.number().int().min(1).default(60),
    rate_limit_max_requests: z.coerce.number().int().min(1).default(100),
    rate_limit_auth_max_requests: z.coerce.number().int().min(1).default(10),
    rate_limit_telemetry_max_requests: z.coerce.number().int().min(1).default(120),
    telemetry_hmac_secret: z.string().default(''),
    telemetry_hmac_required: z.boolean().default(false),
    // Part 2c: Event Bus settings
    event_bus_driver: z
      .enum(['redis', 'memory'], {
        errorMap: () => ({ message: "ASTRO_EVENT_BUS_DRIVER must be 'redis' or 'memory'" }),
      })
      .default('redis'),
    redis_url: z.string().default('redis://localhost:6379'),
    redis_key_prefix: z.string().default('astro:'),
    redis_required: z.boolean().optional(),
    bus_stream_maxlen: z.coerce.number().int().min(100).default(10000),
    bus_replay_max_events: z.coerce.number().int().min(1).max(5000).default(1000),
    bus_outbox_max: z.coerce.number().int().min(10).default(1000),
    live_telemetry_coalesce_ms: z.coerce.number().int().min(50).default(500),
    socket_auth_refresh_warn_s: z.coerce.number().int().min(1).default(60),
    emergency_dedupe_s: z.coerce.number().int().min(0).default(30),
    emergency_cancel_window_s: z.coerce.number().int().min(0).default(60),
    // Part 2d: Alert triage, fusion and inbox settings
    fusion_enabled: z.boolean().default(true),
    ml_api_key: z.string().default('dev_insecure_ml_api_key_min_32_characters!'),
    fusion_ml_min_confidence: z.coerce.number().min(0).max(1).default(0.5),
    fusion_dismiss_suppress_s: z.coerce.number().int().min(0).default(3600),
    fusion_update_coalesce_s: z.coerce.number().min(0).default(2),
    fusion_max_members: z.coerce.number().int().min(1).default(50),
    fusion_timeline_max: z.coerce.number().int().min(1).default(200),
    fusion_snooze_max_watch_min: z.coerce.number().int().min(1).default(480),
    fusion_snooze_max_warning_min: z.coerce.number().int().min(1).default(60),
    fusion_sweep_s: z.coerce.number().int().min(1).default(5),
    fusion_reconcile_on_start: z.boolean().default(true),

    // Part 2e: Clock settings
    mission_start_at: z.string().datetime().optional(),
    mission_initial_day: z.coerce.number().int().min(1).default(31),
    mission_time_scale: z.coerce.number().min(0.1).max(3600).default(1),
    clock_refresh_s: z.coerce.number().min(1).default(15),
    mission_length_days: z.coerce.number().int().min(1).default(180),

    // Part 2e: Link settings
    link_enabled: z.boolean().default(true),
    link_delay_scale: z.coerce.number().min(0.001).max(1000).default(1),
    link_live_max_s: z.coerce.number().min(0).default(1.0),
    link_lag_banner_max_s: z.coerce.number().min(0).default(10),
    link_telemetry_buffer_max_s: z.coerce.number().min(0).default(30),
    link_downlink_interval_s: z.coerce.number().min(1).default(60),
    link_watch_s: z.coerce.number().min(0.1).default(1),
    link_refresh_s: z.coerce.number().min(1).default(15),
    link_max_blackout_s: z.coerce.number().int().min(1).default(86400),
    link_max_override_delay_s: z.coerce.number().int().min(1).default(3600),
    link_max_pending_per_socket: z.coerce.number().int().min(10).default(2000),

    // Part 2e: Radiation settings
    radiation_enabled: z.boolean().default(true),
    radiation_tick_s: z.coerce.number().min(0.1).default(5),
    radiation_publish_s: z.coerce.number().min(0.1).default(5),
    radiation_career_limit_msv: z.coerce.number().min(1).default(600),
    radiation_amber_at: z.coerce.number().min(0).max(1).default(0.6),
    radiation_red_at: z.coerce.number().min(0).max(1).default(0.85),
    radiation_daily_variation: z.coerce.number().min(0).max(0.5).default(0.05),
    radiation_seed: z.coerce.number().int().default(1),
    radiation_spe_alert_rate_msv_h: z.coerce.number().min(0).default(1.0),
    radiation_alerts_enabled: z.boolean().default(true),
    radiation_max_catchup_days: z.coerce.number().int().min(1).default(400),
  })
  .transform((data) => {
    return {
      ...data,
      cookie_secure: data.cookie_secure ?? data.env === 'prod',
      redis_required: data.redis_required ?? data.env === 'prod',
    };
  })
  .superRefine((data, ctx) => {
    if (data.env === 'prod') {
      if (
        !data.jwt_access_secret ||
        data.jwt_access_secret.length < 32 ||
        data.jwt_access_secret.includes('insecure')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['jwt_access_secret'],
          message:
            'ASTRO_JWT_ACCESS_SECRET must be explicitly set to a secure string with at least 32 characters in production',
        });
      }
      if (
        !data.jwt_refresh_secret ||
        data.jwt_refresh_secret.length < 32 ||
        data.jwt_refresh_secret.includes('insecure')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['jwt_refresh_secret'],
          message:
            'ASTRO_JWT_REFRESH_SECRET must be explicitly set to a secure string with at least 32 characters in production',
        });
      }
      if (
        !data.ingest_api_key ||
        data.ingest_api_key.length < 32 ||
        data.ingest_api_key.includes('insecure')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ingest_api_key'],
          message:
            'ASTRO_INGEST_API_KEY must be explicitly set to a secure string with at least 32 characters in production',
        });
      }
      if (data.ml_api_key && data.ml_api_key !== 'dev_insecure_ml_api_key_min_32_characters!') {
        if (data.ml_api_key.length < 32 || data.ml_api_key.includes('insecure')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['ml_api_key'],
            message:
              'ASTRO_ML_API_KEY must be explicitly set to a secure string with at least 32 characters in production',
          });
        }
        if (data.ml_api_key === data.ingest_api_key) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['ml_api_key'],
            message: 'ASTRO_ML_API_KEY must be different from the ingest key',
          });
        }
      }
    }

    if (data.radiation_amber_at >= data.radiation_red_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['radiation_amber_at'],
        message: 'ASTRO_RADIATION_AMBER_AT must be strictly less than ASTRO_RADIATION_RED_AT',
      });
    }
  });

export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Parses settings from an environment dictionary with ASTRO_ prefix.
 * Throws a descriptive error listing every bad variable if parsing fails.
 */
export function parseConfig(env: Record<string, string | undefined> = process.env): Settings {
  const rawConfig: Record<string, unknown> = {};

  if (env['ASTRO_ENV'] !== undefined) rawConfig['env'] = env['ASTRO_ENV'];
  if (env['ASTRO_PORT'] !== undefined || env['PORT'] !== undefined) rawConfig['port'] = env['ASTRO_PORT'] || env['PORT'];
  if (env['ASTRO_APP_VERSION'] !== undefined) rawConfig['app_version'] = env['ASTRO_APP_VERSION'];
  if (env['ASTRO_CORS_ORIGINS'] !== undefined)
    rawConfig['cors_origins'] = env['ASTRO_CORS_ORIGINS'];
  if (env['ASTRO_MISSION_MODE'] !== undefined)
    rawConfig['mission_mode'] = env['ASTRO_MISSION_MODE'];
  if (env['ASTRO_LOG_LEVEL'] !== undefined) rawConfig['log_level'] = env['ASTRO_LOG_LEVEL'];
  if (env['ASTRO_MONGODB_URI'] !== undefined) rawConfig['mongodb_uri'] = env['ASTRO_MONGODB_URI'];
  if (env['ASTRO_JWT_ACCESS_SECRET'] !== undefined)
    rawConfig['jwt_access_secret'] = env['ASTRO_JWT_ACCESS_SECRET'];
  if (env['ASTRO_JWT_REFRESH_SECRET'] !== undefined)
    rawConfig['jwt_refresh_secret'] = env['ASTRO_JWT_REFRESH_SECRET'];
  if (env['ASTRO_ACCESS_TOKEN_TTL'] !== undefined)
    rawConfig['access_token_ttl'] = env['ASTRO_ACCESS_TOKEN_TTL'];
  if (env['ASTRO_REFRESH_TOKEN_TTL'] !== undefined)
    rawConfig['refresh_token_ttl'] = env['ASTRO_REFRESH_TOKEN_TTL'];
  if (env['ASTRO_COOKIE_SECURE'] !== undefined) {
    rawConfig['cookie_secure'] = env['ASTRO_COOKIE_SECURE'].toLowerCase() === 'true';
  }
  if (env['ASTRO_INGEST_API_KEY'] !== undefined)
    rawConfig['ingest_api_key'] = env['ASTRO_INGEST_API_KEY'];
  if (env['ASTRO_TELEMETRY_MAX_BATCH'] !== undefined)
    rawConfig['telemetry_max_batch'] = env['ASTRO_TELEMETRY_MAX_BATCH'];
  if (env['ASTRO_TELEMETRY_EXPECTED_INTERVAL_S'] !== undefined)
    rawConfig['telemetry_expected_interval_s'] = env['ASTRO_TELEMETRY_EXPECTED_INTERVAL_S'];
  if (env['ASTRO_TELEMETRY_MAX_INTERP_GAP_S'] !== undefined)
    rawConfig['telemetry_max_interp_gap_s'] = env['ASTRO_TELEMETRY_MAX_INTERP_GAP_S'];
  if (env['ASTRO_TELEMETRY_RETENTION_DAYS'] !== undefined)
    rawConfig['telemetry_retention_days'] = env['ASTRO_TELEMETRY_RETENTION_DAYS'];
  if (env['ASTRO_IDEMPOTENCY_TTL_H'] !== undefined)
    rawConfig['idempotency_ttl_h'] = env['ASTRO_IDEMPOTENCY_TTL_H'];
  if (env['ASTRO_EVENT_BUS_DRIVER'] !== undefined)
    rawConfig['event_bus_driver'] = env['ASTRO_EVENT_BUS_DRIVER'];
  if (env['ASTRO_REDIS_URL'] !== undefined) rawConfig['redis_url'] = env['ASTRO_REDIS_URL'];
  if (env['ASTRO_REDIS_KEY_PREFIX'] !== undefined)
    rawConfig['redis_key_prefix'] = env['ASTRO_REDIS_KEY_PREFIX'];
  if (env['ASTRO_REDIS_REQUIRED'] !== undefined) {
    rawConfig['redis_required'] = env['ASTRO_REDIS_REQUIRED'].toLowerCase() === 'true';
  }
  if (env['ASTRO_BUS_STREAM_MAXLEN'] !== undefined)
    rawConfig['bus_stream_maxlen'] = env['ASTRO_BUS_STREAM_MAXLEN'];
  if (env['ASTRO_BUS_REPLAY_MAX_EVENTS'] !== undefined)
    rawConfig['bus_replay_max_events'] = env['ASTRO_BUS_REPLAY_MAX_EVENTS'];
  if (env['ASTRO_BUS_OUTBOX_MAX'] !== undefined)
    rawConfig['bus_outbox_max'] = env['ASTRO_BUS_OUTBOX_MAX'];
  if (env['ASTRO_LIVE_TELEMETRY_COALESCE_MS'] !== undefined)
    rawConfig['live_telemetry_coalesce_ms'] = env['ASTRO_LIVE_TELEMETRY_COALESCE_MS'];
  if (env['ASTRO_SOCKET_AUTH_REFRESH_WARN_S'] !== undefined)
    rawConfig['socket_auth_refresh_warn_s'] = env['ASTRO_SOCKET_AUTH_REFRESH_WARN_S'];
  if (env['ASTRO_EMERGENCY_DEDUPE_S'] !== undefined)
    rawConfig['emergency_dedupe_s'] = env['ASTRO_EMERGENCY_DEDUPE_S'];
  if (env['ASTRO_EMERGENCY_CANCEL_WINDOW_S'] !== undefined)
    rawConfig['emergency_cancel_window_s'] = env['ASTRO_EMERGENCY_CANCEL_WINDOW_S'];
  if (env['ASTRO_FUSION_ENABLED'] !== undefined) {
    rawConfig['fusion_enabled'] = env['ASTRO_FUSION_ENABLED'].toLowerCase() === 'true';
  }
  if (env['ASTRO_ML_API_KEY'] !== undefined) rawConfig['ml_api_key'] = env['ASTRO_ML_API_KEY'];
  if (env['ASTRO_FUSION_ML_MIN_CONFIDENCE'] !== undefined)
    rawConfig['fusion_ml_min_confidence'] = env['ASTRO_FUSION_ML_MIN_CONFIDENCE'];
  if (env['ASTRO_FUSION_DISMISS_SUPPRESS_S'] !== undefined)
    rawConfig['fusion_dismiss_suppress_s'] = env['ASTRO_FUSION_DISMISS_SUPPRESS_S'];
  if (env['ASTRO_FUSION_UPDATE_COALESCE_S'] !== undefined)
    rawConfig['fusion_update_coalesce_s'] = env['ASTRO_FUSION_UPDATE_COALESCE_S'];
  if (env['ASTRO_FUSION_MAX_MEMBERS'] !== undefined)
    rawConfig['fusion_max_members'] = env['ASTRO_FUSION_MAX_MEMBERS'];
  if (env['ASTRO_FUSION_TIMELINE_MAX'] !== undefined)
    rawConfig['fusion_timeline_max'] = env['ASTRO_FUSION_TIMELINE_MAX'];
  if (env['ASTRO_FUSION_SNOOZE_MAX_WATCH_MIN'] !== undefined)
    rawConfig['fusion_snooze_max_watch_min'] = env['ASTRO_FUSION_SNOOZE_MAX_WATCH_MIN'];
  if (env['ASTRO_FUSION_SNOOZE_MAX_WARNING_MIN'] !== undefined)
    rawConfig['fusion_snooze_max_warning_min'] = env['ASTRO_FUSION_SNOOZE_MAX_WARNING_MIN'];
  if (env['ASTRO_FUSION_SWEEP_S'] !== undefined)
    rawConfig['fusion_sweep_s'] = env['ASTRO_FUSION_SWEEP_S'];
  if (env['ASTRO_FUSION_RECONCILE_ON_START'] !== undefined) {
    rawConfig['fusion_reconcile_on_start'] =
      env['ASTRO_FUSION_RECONCILE_ON_START'].toLowerCase() === 'true';
  }

  // Part 2e: Clock settings
  if (env['ASTRO_MISSION_START_AT'] !== undefined)
    rawConfig['mission_start_at'] = env['ASTRO_MISSION_START_AT'];
  if (env['ASTRO_MISSION_INITIAL_DAY'] !== undefined)
    rawConfig['mission_initial_day'] = env['ASTRO_MISSION_INITIAL_DAY'];
  if (env['ASTRO_MISSION_TIME_SCALE'] !== undefined)
    rawConfig['mission_time_scale'] = env['ASTRO_MISSION_TIME_SCALE'];
  if (env['ASTRO_CLOCK_REFRESH_S'] !== undefined)
    rawConfig['clock_refresh_s'] = env['ASTRO_CLOCK_REFRESH_S'];
  if (env['ASTRO_MISSION_LENGTH_DAYS'] !== undefined)
    rawConfig['mission_length_days'] = env['ASTRO_MISSION_LENGTH_DAYS'];

  // Part 2e: Link settings
  if (env['ASTRO_LINK_ENABLED'] !== undefined) {
    rawConfig['link_enabled'] = env['ASTRO_LINK_ENABLED'].toLowerCase() === 'true';
  }
  if (env['ASTRO_LINK_DELAY_SCALE'] !== undefined)
    rawConfig['link_delay_scale'] = env['ASTRO_LINK_DELAY_SCALE'];
  if (env['ASTRO_LINK_LIVE_MAX_S'] !== undefined)
    rawConfig['link_live_max_s'] = env['ASTRO_LINK_LIVE_MAX_S'];
  if (env['ASTRO_LINK_LAG_BANNER_MAX_S'] !== undefined)
    rawConfig['link_lag_banner_max_s'] = env['ASTRO_LINK_LAG_BANNER_MAX_S'];
  if (env['ASTRO_LINK_TELEMETRY_BUFFER_MAX_S'] !== undefined)
    rawConfig['link_telemetry_buffer_max_s'] = env['ASTRO_LINK_TELEMETRY_BUFFER_MAX_S'];
  if (env['ASTRO_LINK_DOWNLINK_INTERVAL_S'] !== undefined)
    rawConfig['link_downlink_interval_s'] = env['ASTRO_LINK_DOWNLINK_INTERVAL_S'];
  if (env['ASTRO_LINK_WATCH_S'] !== undefined)
    rawConfig['link_watch_s'] = env['ASTRO_LINK_WATCH_S'];
  if (env['ASTRO_LINK_REFRESH_S'] !== undefined)
    rawConfig['link_refresh_s'] = env['ASTRO_LINK_REFRESH_S'];
  if (env['ASTRO_LINK_MAX_BLACKOUT_S'] !== undefined)
    rawConfig['link_max_blackout_s'] = env['ASTRO_LINK_MAX_BLACKOUT_S'];
  if (env['ASTRO_LINK_MAX_OVERRIDE_DELAY_S'] !== undefined)
    rawConfig['link_max_override_delay_s'] = env['ASTRO_LINK_MAX_OVERRIDE_DELAY_S'];
  if (env['ASTRO_LINK_MAX_PENDING_PER_SOCKET'] !== undefined)
    rawConfig['link_max_pending_per_socket'] = env['ASTRO_LINK_MAX_PENDING_PER_SOCKET'];

  // Part 2e: Radiation settings
  if (env['ASTRO_RADIATION_ENABLED'] !== undefined) {
    rawConfig['radiation_enabled'] = env['ASTRO_RADIATION_ENABLED'].toLowerCase() === 'true';
  }
  if (env['ASTRO_RADIATION_TICK_S'] !== undefined)
    rawConfig['radiation_tick_s'] = env['ASTRO_RADIATION_TICK_S'];
  if (env['ASTRO_RADIATION_PUBLISH_S'] !== undefined)
    rawConfig['radiation_publish_s'] = env['ASTRO_RADIATION_PUBLISH_S'];
  if (env['ASTRO_RADIATION_CAREER_LIMIT_MSV'] !== undefined)
    rawConfig['radiation_career_limit_msv'] = env['ASTRO_RADIATION_CAREER_LIMIT_MSV'];
  if (env['ASTRO_RADIATION_AMBER_AT'] !== undefined)
    rawConfig['radiation_amber_at'] = env['ASTRO_RADIATION_AMBER_AT'];
  if (env['ASTRO_RADIATION_RED_AT'] !== undefined)
    rawConfig['radiation_red_at'] = env['ASTRO_RADIATION_RED_AT'];
  if (env['ASTRO_RADIATION_DAILY_VARIATION'] !== undefined)
    rawConfig['radiation_daily_variation'] = env['ASTRO_RADIATION_DAILY_VARIATION'];
  if (env['ASTRO_RADIATION_SEED'] !== undefined)
    rawConfig['radiation_seed'] = env['ASTRO_RADIATION_SEED'];
  if (env['ASTRO_RADIATION_SPE_ALERT_RATE_MSV_H'] !== undefined)
    rawConfig['radiation_spe_alert_rate_msv_h'] = env['ASTRO_RADIATION_SPE_ALERT_RATE_MSV_H'];
  if (env['ASTRO_RADIATION_ALERTS_ENABLED'] !== undefined) {
    rawConfig['radiation_alerts_enabled'] =
      env['ASTRO_RADIATION_ALERTS_ENABLED'].toLowerCase() === 'true';
  }
  if (env['ASTRO_RADIATION_MAX_CATCHUP_DAYS'] !== undefined)
    rawConfig['radiation_max_catchup_days'] = env['ASTRO_RADIATION_MAX_CATCHUP_DAYS'];

  // Phase 5: Rate Limiting and Security settings
  if (env['ASTRO_RATE_LIMIT_ENABLED'] !== undefined) {
    rawConfig['rate_limit_enabled'] = env['ASTRO_RATE_LIMIT_ENABLED'].toLowerCase() === 'true';
  }
  if (env['ASTRO_RATE_LIMIT_WINDOW_S'] !== undefined) {
    rawConfig['rate_limit_window_s'] = env['ASTRO_RATE_LIMIT_WINDOW_S'];
  }
  if (env['ASTRO_RATE_LIMIT_MAX_REQUESTS'] !== undefined) {
    rawConfig['rate_limit_max_requests'] = env['ASTRO_RATE_LIMIT_MAX_REQUESTS'];
  }
  if (env['ASTRO_RATE_LIMIT_AUTH_MAX_REQUESTS'] !== undefined) {
    rawConfig['rate_limit_auth_max_requests'] = env['ASTRO_RATE_LIMIT_AUTH_MAX_REQUESTS'];
  }
  if (env['ASTRO_RATE_LIMIT_TELEMETRY_MAX_REQUESTS'] !== undefined) {
    rawConfig['rate_limit_telemetry_max_requests'] = env['ASTRO_RATE_LIMIT_TELEMETRY_MAX_REQUESTS'];
  }
  if (env['ASTRO_TELEMETRY_HMAC_SECRET'] !== undefined) {
    rawConfig['telemetry_hmac_secret'] = env['ASTRO_TELEMETRY_HMAC_SECRET'];
  }
  if (env['ASTRO_TELEMETRY_HMAC_REQUIRED'] !== undefined) {
    rawConfig['telemetry_hmac_required'] =
      env['ASTRO_TELEMETRY_HMAC_REQUIRED'].toLowerCase() === 'true';
  }

  const result = SettingsSchema.safeParse(rawConfig);

  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => {
        const field = err.path.join('.') || 'configuration';
        const envVarName = `ASTRO_${field.toUpperCase()}`;
        return `  - ${envVarName} (${field}): ${err.message}`;
      })
      .join('\n');

    throw new Error(
      `Invalid AstroCare configuration:\n${errorDetails}\nPlease check your environment variables or .env file.`,
    );
  }

  return result.data;
}

/**
 * Loads configuration from process.env and .env.
 */
export function loadConfig(): Settings {
  return parseConfig(process.env);
}
