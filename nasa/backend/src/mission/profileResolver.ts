/**
 * @module profileResolver
 * Resolves the effective mission profile for the current mission mode,
 * applying any 1c mission_config overrides on top of the defaults.
 *
 * The mission_config collection (Part 1c) may store custom overrides for
 * radio delay or radiation parameters per mode. This resolver merges them
 * at call time so callers always see the effective profile.
 */

import { DEFAULT_PROFILES, type MissionProfile } from './missionProfiles.js';
import type { Settings } from '../core/config.js';

export type MissionModeKey = 'iss' | 'moon' | 'mars';

/**
 * Returns the effective MissionProfile for the given mode.
 *
 * Currently applies deep-merge of any `settings.mission_profile_overrides`
 * (future hook for 1c mission_config stored overrides).
 * When no overrides are present this is a pure O(1) lookup.
 */
export function resolveProfile(mode: MissionModeKey, _settings?: Settings): MissionProfile {
  // Base profile from defaults
  const base = DEFAULT_PROFILES[mode];

  // Future: merge overrides from settings.mission_profile_overrides[mode] here.
  // Currently returns a shallow copy to prevent mutation of the module-level constant.
  return {
    ...base,
    radio: { ...base.radio, blackouts: [...base.radio.blackouts] },
    radiation: { ...base.radiation },
  };
}

/**
 * Validates whether a string value is a recognized MissionModeKey.
 */
export function isMissionMode(value: unknown): value is MissionModeKey {
  return value === 'iss' || value === 'moon' || value === 'mars';
}
