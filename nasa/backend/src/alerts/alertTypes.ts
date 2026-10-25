/**
 * Alert severity levels used across the alert engine (Part 2b) and event bus (Part 2c).
 */
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/**
 * Data transfer object representing a threshold alert raised by the alert engine.
 * Part 2b owns the full implementation; this is the contract used by the event bus.
 */
export interface AlertDTO {
  id: string;
  crew_id: string;
  metric: string;
  value: number | null;
  threshold_value?: number;
  direction?: 'above' | 'below';
  severity: AlertSeverity;
  status: 'active' | 'acknowledged' | 'cleared';
  message: string;
  raised_at: string;
  cleared_at?: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  mission_mode: string;
  mission_day?: number;
  request_id?: string;
}

export interface AlertEvent {
  type: string;
  alert: AlertDTO;
}
