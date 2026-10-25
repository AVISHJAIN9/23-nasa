import request, { type Agent } from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp, type AppDependencies } from '../src/app.js';
import { parseConfig, type Settings } from '../src/core/config.js';
import { FlagService, InMemoryFlagStore } from '../src/core/flags.js';
import { ReadinessRegistry } from '../src/core/readiness.js';
import { type AuditWriter, InMemoryAuditWriter } from '../src/core/audit.js';
import { User, type IUser } from '../src/models/User.js';
import { hashPassword } from '../src/core/passwords.js';
import { signAccessToken } from '../src/core/tokens.js';
import type { Role } from '../src/core/roles.js';

let mongoServer: MongoMemoryServer | null = null;

/**
 * Initializes an in-memory MongoDB instance for fast, isolated test suites.
 */
export async function setupTestMongo(): Promise<string> {
  if (!mongoServer) {
    mongoServer = await MongoMemoryServer.create({
      binary: {
        version: '7.0.14',
      },
    });
  }
  const uri = mongoServer.getUri();

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }

  return uri;
}

/**
 * Tears down the in-memory MongoDB connection and instance.
 */
export async function teardownTestMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    const server = mongoServer;
    mongoServer = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await server.stop();
        break;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if ((code === 'ENOTEMPTY' || code === 'EBUSY') && attempt < 2) {
          await new Promise((res) => setTimeout(res, 100));
          continue;
        }
        if (code === 'ENOTEMPTY' || code === 'EBUSY') {
          break;
        }
        throw err;
      }
    }
  }
}

/**
 * Clears all collections in the in-memory MongoDB instance between tests.
 */
export async function clearTestMongo(): Promise<void> {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    const collections = await mongoose.connection.db.collections();
    for (const collection of collections) {
      if (collection.collectionName.startsWith('system.')) {
        continue;
      }
      await collection.deleteMany({});
    }
  }
}

import type { EventBus } from '../src/bus/eventBus.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import type { DeliveryPolicy } from '../src/bus/deliveryPolicy.js';
import type { Clock } from '../src/core/clock.js';
import type { FusionEngine } from '../src/fusion/fusionEngine.js';
import type { InboxService } from '../src/fusion/inboxService.js';
import type { RateLimiter } from '../src/core/rateLimiter.js';

export interface TestAppOptions {
  customSettings?: Partial<Settings>;
  initialFlags?: Partial<Record<string, unknown>>;
  readinessRegistry?: ReadinessRegistry;
  auditWriter?: AuditWriter;
  rateLimiter?: RateLimiter;
  eventBus?: EventBus;
  deliveryPolicy?: DeliveryPolicy;
  clock?: Clock;
  fusionEngine?: FusionEngine;
  inboxService?: InboxService;
}

/**
 * Creates an isolated test application instance and wrapped Supertest agent.
 */
export function createTestApp(options?: TestAppOptions): {
  app: ReturnType<typeof createApp>;
  agent: Agent;
  settings: Settings;
  flagService: FlagService;
  readinessRegistry: ReadinessRegistry;
  auditWriter: InMemoryAuditWriter;
  eventBus: EventBus;
} {
  const baseSettings = parseConfig({
    ASTRO_ENV: 'test',
    ASTRO_PORT: '4001',
    ASTRO_APP_VERSION: '0.1.0-test',
    ASTRO_CORS_ORIGINS: 'http://localhost:5173,http://localhost:3000',
    ASTRO_MISSION_MODE: 'mars',
    ASTRO_LOG_LEVEL: 'silent',
    ASTRO_JWT_ACCESS_SECRET: 'test_access_secret_min_32_chars_long_for_vitest!',
    ASTRO_JWT_REFRESH_SECRET: 'test_refresh_secret_min_32_chars_long_for_vitest!',
  });

  const settings: Settings = {
    ...baseSettings,
    rate_limit_enabled: false,
    ...(options?.customSettings || {}),
  };

  const flagStore = new InMemoryFlagStore(options?.initialFlags);
  const flagService = new FlagService(flagStore);
  const readinessRegistry = options?.readinessRegistry ?? new ReadinessRegistry();
  const auditWriter = (options?.auditWriter as InMemoryAuditWriter) ?? new InMemoryAuditWriter();

  const eventBus =
    options?.eventBus ??
    new MemoryEventBus({
      maxLen: settings.bus_stream_maxlen,
      missionMode: settings.mission_mode,
    });

  const dependencies: AppDependencies = {
    settings,
    flagService,
    readinessRegistry,
    auditWriter,
    rateLimiter: options?.rateLimiter,
    eventBus,
    deliveryPolicy: options?.deliveryPolicy,
    clock: options?.clock,
    fusionEngine: options?.fusionEngine,
    inboxService: options?.inboxService,
  };

  const app = createApp(dependencies);
  const agent = request(app);

  return {
    app,
    agent,
    settings,
    flagService,
    readinessRegistry,
    auditWriter,
    eventBus,
  };
}

/**
 * Helper to seed a test user with hashed password.
 */
export async function createTestUser(
  spec: {
    email?: string;
    display_name?: string;
    role?: Role;
    is_medical_officer?: boolean;
    password?: string;
    status?: 'active' | 'disabled';
  } = {},
): Promise<{ user: IUser; rawPassword: string; token: string }> {
  const rawPassword = spec.password || 'TestPassword#2026';
  const password_hash = await hashPassword(rawPassword);
  const email =
    spec.email ||
    `user_${Date.now()}_${Math.random().toString(36).substring(7)}@astrocare.nasa.gov`;

  const user = await User.create({
    email: email.toLowerCase(),
    display_name: spec.display_name || 'Test Crew Member',
    role: spec.role || 'astronaut',
    is_medical_officer: spec.is_medical_officer ?? false,
    status: spec.status || 'active',
    password_hash,
  });

  const token = signAccessToken(
    {
      userId: user.id,
      role: user.role,
      isMedicalOfficer: user.is_medical_officer,
    },
    'test_access_secret_min_32_chars_long_for_vitest!',
    '1h',
  );

  return { user, rawPassword, token };
}

/**
 * Generates an Authorization Bearer header string.
 */
export function authHeader(
  userId: string,
  role: Role = 'astronaut',
  isMedicalOfficer = false,
  secret = 'test_access_secret_min_32_chars_long_for_vitest!',
): string {
  const token = signAccessToken({ userId, role, isMedicalOfficer }, secret, '1h');
  return `Bearer ${token}`;
}
