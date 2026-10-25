export interface LinkState {
  effective_delay_ms: number;
  in_blackout: boolean;
  blackout_label?: string | null;
  packet_loss_rate: number;
  override_active: boolean;
  mission_mode: 'iss' | 'moon' | 'mars';
}

export interface DtnMessage {
  id: string;
  source: 'onboard' | 'ground';
  destination: 'onboard' | 'ground';
  sequence_number: number;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'in_flight' | 'delivered' | 'dropped';
  created_at: string;
  delivered_at?: string | null;
}
