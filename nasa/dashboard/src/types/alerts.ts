export type Severity = 'watch' | 'warning' | 'critical';
export type WorkflowStatus = 'open' | 'acknowledged' | 'snoozed' | 'resolved';

export interface TimelineEntry {
  action: string;
  actor: {
    userId?: string;
    role: string;
    isMedicalOfficer?: boolean;
  };
  timestamp: string;
  note?: string;
}

export interface InboxItem {
  id: string;
  crew_id: string;
  hazard: string;
  severity: Severity;
  status: WorkflowStatus;
  summary: string;
  first_detected_at: string;
  last_updated_at: string;
  member_count: number;
  affected_vitals: string[];
  priority_key: number;
  assigned_to?: string | null;
  snooze_until?: string | null;
  snooze_reason?: string | null;
  resolution_note?: string | null;
  resolution_category?: string | null;
  explanation?: {
    rules_fired?: string[];
    ml_factors?: Array<{ vital: string; score: number }>;
  };
  timeline?: TimelineEntry[];
}

export interface InboxSummary {
  counts_by_status: {
    open: number;
    acknowledged: number;
    snoozed: number;
    resolved: number;
  };
  unresolved_by_severity: {
    watch: number;
    warning: number;
    critical: number;
  };
  unacknowledged_critical: number;
  top_crews_by_priority: Array<{
    crew_id: string;
    max_priority: number;
    open_count: number;
  }>;
}
