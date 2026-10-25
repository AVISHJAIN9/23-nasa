export interface ProtocolStep {
  step_number: number;
  instruction: string;
  medication?: string;
  caution?: string;
  completed?: boolean;
}

export interface ProtocolItem {
  id: string;
  title: string;
  hazard_type: string;
  description: string;
  severity: 'watch' | 'warning' | 'critical';
  steps: ProtocolStep[];
}

export interface ProtocolsListResponse {
  autonomous_mode_active: boolean;
  protocols: ProtocolItem[];
}
