export type Role = 'admin' | 'flight_surgeon' | 'mission_control' | 'astronaut';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  is_medical_officer: boolean;
  crew_profile_id?: string | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}
