import { type Settings } from './config.js';

/**
 * Returns the current mission mode from settings.
 * Part 2b's full implementation may add dynamic switching; for now, static from config.
 */
export function getMissionMode(settings: Settings): 'iss' | 'moon' | 'mars' {
  return settings.mission_mode;
}
