/**
 * @module missionProfiles
 * Typed default comms & radiation profiles per mission mode.
 *
 * ASSUMPTIONS
 * -----------
 * - All delay values are ONE-WAY light-travel times in milliseconds.
 * - ISS: ~400 km orbit, effective one-way comms delay ~600 ms (round-trip ~1.2 s).
 * - Moon: average ~385 000 km distance, one-way ~1 280 ms (round-trip ~2.56 s).
 * - Mars: sinusoidal variation 3 min – 22 min one-way (54.6–401 M km range).
 * - Blackout windows are expressed as [startDegree, endDegree] of the mission orbit/position cycle
 *   where 0–360 maps over a 24-hour terrestrial day (for ISS AOS/LOS) or over a 26-month synodic period
 *   for Mars solar conjunction.  The LinkModel maps degrees → wall-clock windows.
 * - Radiation baseline dose rates are in micro-Sieverts per hour (µSv/hr).
 * - ISS baseline: ~0.5 mSv/day ≈ 20.8 µSv/hr inside shielded modules.
 * - Moon baseline: ~1.4 mSv/day ≈ 58.3 µSv/hr (no magnetosphere, partial shielding).
 * - Mars surface baseline: ~0.64 mSv/day ≈ 26.7 µSv/hr (thin atmosphere, no global field).
 */

/** One-way comms delay range in ms */
export interface DelayRange {
  minMs: number;
  maxMs: number;
}

/** A named blackout window definition (fraction 0–1 of the 24-hour "day cycle") */
export interface BlackoutWindow {
  /** Label for display/logging */
  label: string;
  /** Start fraction of 24 h cycle, 0.0–1.0 */
  startFraction: number;
  /** End fraction of 24 h cycle, 0.0–1.0 */
  endFraction: number;
}

export interface RadioLink {
  /** Effective one-way delay range (ms) */
  delay: DelayRange;
  /** Whether the delay oscillates sinusoidally across the range (Mars-style) */
  sinusoidalDelay: boolean;
  /** Sinusoid period in real-wall seconds (only used when sinusoidalDelay is true) */
  sinusoidPeriodS: number;
  /** List of scheduled blackout windows per 24 h cycle */
  blackouts: BlackoutWindow[];
  /** Max downlink bandwidth for telemetry throttling (bytes/s, 0 = unlimited) */
  downlinkThrottleBps: number;
  /** Packet loss probability rate (0.0 to 1.0) */
  packetLossRate: number;
}

export interface RadiationProfile {
  /** Baseline galactic cosmic ray dose rate in µSv/hr */
  baselineUsvPerHour: number;
  /** Peak SPE (Solar Proton Event) dose rate multiplier over baseline */
  speMultiplier: number;
  /** Daily deterministic variation amplitude as fraction of baseline (0.0–1.0) */
  dailyVariationAmplitude: number;
}

export interface MissionProfile {
  mode: 'iss' | 'moon' | 'mars';
  label: string;
  radio: RadioLink;
  radiation: RadiationProfile;
}

// ---------------------------------------------------------------------------
// Default Profiles
// ---------------------------------------------------------------------------

export const ISS_PROFILE: MissionProfile = {
  mode: 'iss',
  label: 'International Space Station (LEO)',
  radio: {
    // ISS: LEO orbit, effective one-way comms delay ~0s (0 to 100 ms)
    delay: { minMs: 0, maxMs: 100 },
    sinusoidalDelay: false,
    sinusoidPeriodS: 5400, // 90-minute ISS orbit
    // ISS experiences ~35 min LOS per orbit (4 blackouts per 24h, ~15 min each)
    blackouts: [
      { label: 'AOS-LOS-1', startFraction: 0.04, endFraction: 0.14 },
      { label: 'AOS-LOS-2', startFraction: 0.29, endFraction: 0.39 },
      { label: 'AOS-LOS-3', startFraction: 0.54, endFraction: 0.64 },
      { label: 'AOS-LOS-4', startFraction: 0.79, endFraction: 0.89 },
    ],
    downlinkThrottleBps: 0, // No throttle for LEO
    packetLossRate: 0.001, // 0.1% baseline packet loss
  },
  radiation: {
    baselineUsvPerHour: 20.8,
    speMultiplier: 15,
    dailyVariationAmplitude: 0.08,
  },
};

export const MOON_PROFILE: MissionProfile = {
  mode: 'moon',
  label: 'Lunar Gateway / Lunar Surface',
  radio: {
    // Moon: average distance ~385 000 km, effective one-way delay ~1.3s (1250 to 1350 ms)
    delay: { minMs: 1250, maxMs: 1350 },
    sinusoidalDelay: false,
    sinusoidPeriodS: 86400,
    // Lunar far-side communications blackout (approx 14-day cycle mapped to 24h for demo)
    blackouts: [{ label: 'Farside-Blackout', startFraction: 0.45, endFraction: 0.55 }],
    downlinkThrottleBps: 500_000, // 500 kbps lunar deep-space network
    packetLossRate: 0.01, // 1% baseline packet loss
  },
  radiation: {
    baselineUsvPerHour: 58.3,
    speMultiplier: 25,
    dailyVariationAmplitude: 0.12,
  },
};

export const MARS_PROFILE: MissionProfile = {
  mode: 'mars',
  label: 'Mars Surface / Transit',
  radio: {
    // Mars: 4 min (240 000 ms) to 24 min (1 440 000 ms) one-way light travel
    delay: { minMs: 4 * 60_000, maxMs: 24 * 60_000 },
    sinusoidalDelay: true,
    // Full Earth-Mars synodic period is ~780 days; for demo purposes we use a 48 h accelerated cycle
    sinusoidPeriodS: 48 * 3600,
    // Solar conjunction blackout: roughly 2 weeks per 26-month cycle → ~0.6% of cycle;
    // for demo mapped to ~14 min per 24 h
    blackouts: [{ label: 'Solar-Conjunction', startFraction: 0.49, endFraction: 0.51 }],
    downlinkThrottleBps: 50_000, // 50 kbps Mars Relay Network
    packetLossRate: 0.05, // 5% baseline packet loss
  },
  radiation: {
    baselineUsvPerHour: 26.7,
    speMultiplier: 20,
    dailyVariationAmplitude: 0.15,
  },
};

export const DEFAULT_PROFILES: Record<'iss' | 'moon' | 'mars', MissionProfile> = {
  iss: ISS_PROFILE,
  moon: MOON_PROFILE,
  mars: MARS_PROFILE,
};
