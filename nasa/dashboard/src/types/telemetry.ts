export interface VitalReading {
  metric: string;
  value: number;
  timestamp: string;
  quality?: 'valid' | 'degraded' | 'suspect';
}

export interface CrewProfile {
  id: string;
  callsign: string;
  age: number;
  sex: 'male' | 'female';
  baseline_status: 'pending' | 'computed';
  baseline?: Record<string, { mean: number; std: number }>;
  is_synthetic?: boolean;
}

export interface LiveVitalsMap {
  heart_rate?: VitalReading;
  spo2?: VitalReading;
  blood_pressure_systolic?: VitalReading;
  blood_pressure_diastolic?: VitalReading;
  respiration_rate?: VitalReading;
  temperature?: VitalReading;
  cabin_co2?: VitalReading;
  cumulative_radiation_msv?: VitalReading;
  hrv?: VitalReading;
}
