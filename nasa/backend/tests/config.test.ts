import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/core/config.js';

describe('Configuration & Settings (F141)', () => {
  it('applies default settings when minimal env is provided', () => {
    const config = parseConfig({});

    expect(config.env).toBe('dev');
    expect(config.port).toBe(4000);
    expect(config.app_version).toBe('0.1.0');
    expect(config.cors_origins).toEqual(['http://localhost:5173']);
    expect(config.mission_mode).toBe('mars');
    expect(config.log_level).toBe('info');
  });

  it('correctly parses environment overrides with ASTRO_ prefix', () => {
    const config = parseConfig({
      ASTRO_ENV: 'prod',
      ASTRO_PORT: '8080',
      ASTRO_APP_VERSION: '1.2.3',
      ASTRO_CORS_ORIGINS: 'https://astrocare.nasa.gov, https://station.local',
      ASTRO_MISSION_MODE: 'moon',
      ASTRO_LOG_LEVEL: 'warn',
      ASTRO_JWT_ACCESS_SECRET: 'production_access_secret_32_chars_minimum_length!',
      ASTRO_JWT_REFRESH_SECRET: 'production_refresh_secret_32_chars_minimum_length!',
      ASTRO_INGEST_API_KEY: 'production_ingest_key_32_chars_min_length!',
    });

    expect(config.env).toBe('prod');
    expect(config.port).toBe(8080);
    expect(config.app_version).toBe('1.2.3');
    expect(config.cors_origins).toEqual(['https://astrocare.nasa.gov', 'https://station.local']);
    expect(config.mission_mode).toBe('moon');
    expect(config.log_level).toBe('warn');
    expect(config.ingest_api_key).toBe('production_ingest_key_32_chars_min_length!');
  });

  it('fails in production if JWT secrets or ingest key are missing or under 32 characters', () => {
    expect(() => {
      parseConfig({
        ASTRO_ENV: 'prod',
        ASTRO_JWT_ACCESS_SECRET: 'short_secret',
      });
    }).toThrowError(/ASTRO_JWT_ACCESS_SECRET/);

    expect(() => {
      parseConfig({
        ASTRO_ENV: 'prod',
        ASTRO_JWT_ACCESS_SECRET: 'production_access_secret_32_chars_minimum_length!',
        ASTRO_JWT_REFRESH_SECRET: 'production_refresh_secret_32_chars_minimum_length!',
        ASTRO_INGEST_API_KEY: 'short_key',
      });
    }).toThrowError(/ASTRO_INGEST_API_KEY/);
  });

  it('fails config parsing when invalid mission_mode is provided', () => {
    expect(() => {
      parseConfig({
        ASTRO_MISSION_MODE: 'jupiter',
      });
    }).toThrowError(/ASTRO_MISSION_MODE/);
  });

  it('fails config parsing when invalid env is provided', () => {
    expect(() => {
      parseConfig({
        ASTRO_ENV: 'staging',
      });
    }).toThrowError(/ASTRO_ENV/);
  });

  it('fails config parsing when invalid port is provided', () => {
    expect(() => {
      parseConfig({
        ASTRO_PORT: 'not-a-port',
      });
    }).toThrowError(/ASTRO_PORT/);
  });
});
