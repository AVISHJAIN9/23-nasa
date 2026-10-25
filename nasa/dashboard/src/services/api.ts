import { User, LoginResponse } from '../types/auth';
import { CrewProfile } from '../types/telemetry';
import { InboxItem, InboxSummary } from '../types/alerts';
import { LinkState } from '../types/link';
import { ProtocolsListResponse } from '../types/protocols';

const TOKEN_KEY = 'astrocare_access_token';
const USER_KEY = 'astrocare_user';

export class ApiService {
  private static token: string | null = localStorage.getItem(TOKEN_KEY);
  private static currentUser: User | null = (() => {
    try {
      const u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  })();

  public static getToken(): string | null {
    return this.token;
  }

  public static getCurrentUser(): User | null {
    return this.currentUser;
  }

  public static setSession(token: string, user: User): void {
    this.token = token;
    this.currentUser = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  public static clearSession(): void {
    this.token = null;
    this.currentUser = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  private static async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(path, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      this.clearSession();
      window.dispatchEvent(new Event('astrocare:auth-expired'));
    }

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.json();
        if (errorBody?.error?.message) {
          errorMsg = errorBody.error.message;
        }
      } catch {
        // Fallback to text
      }
      throw new Error(errorMsg);
    }

    return response.json() as Promise<T>;
  }

  // ---------------- AUTH ----------------
  public static async login(email: string, password: string): Promise<LoginResponse> {
    const res = await this.request<LoginResponse>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setSession(res.access_token, res.user);
    return res;
  }

  public static async logout(): Promise<void> {
    try {
      await this.request('/v1/auth/logout', { method: 'POST' });
    } catch {
      // Ignored
    } finally {
      this.clearSession();
    }
  }

  // ---------------- CREW ----------------
  public static async fetchCrewList(): Promise<CrewProfile[]> {
    const res = await this.request<{ items: CrewProfile[] } | CrewProfile[]>('/v1/crew');
    return Array.isArray(res) ? res : res.items || [];
  }

  // ---------------- INBOX & ALERTS ----------------
  public static async fetchInbox(status?: string): Promise<InboxItem[]> {
    const url = status ? `/v1/inbox?status=${encodeURIComponent(status)}` : '/v1/inbox';
    const res = await this.request<{ items: InboxItem[] } | InboxItem[]>(url);
    return Array.isArray(res) ? res : res.items || [];
  }

  public static async fetchInboxSummary(): Promise<InboxSummary> {
    return this.request<InboxSummary>('/v1/inbox/summary');
  }

  public static async acknowledgeAlert(id: string, note?: string): Promise<void> {
    await this.request(`/v1/inbox/${id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ note: note || 'Acknowledged via mission dashboard' }),
    });
  }

  public static async assignAlert(id: string, assignedTo: string): Promise<void> {
    await this.request(`/v1/inbox/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assigned_to: assignedTo }),
    });
  }

  public static async snoozeAlert(
    id: string,
    durationMinutes: number,
    reason: string,
  ): Promise<void> {
    await this.request(`/v1/inbox/${id}/snooze`, {
      method: 'POST',
      body: JSON.stringify({
        snooze_duration_minutes: durationMinutes,
        reason,
      }),
    });
  }

  public static async resolveAlert(
    id: string,
    resolutionNote: string,
    category = 'treated',
  ): Promise<void> {
    await this.request(`/v1/inbox/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        resolution_notes: resolutionNote,
        category,
      }),
    });
  }

  // ---------------- EMERGENCIES ----------------
  public static async declareEmergency(
    type: string,
    note?: string,
  ): Promise<{ emergency_id: string }> {
    return this.request('/v1/emergencies', {
      method: 'POST',
      body: JSON.stringify({
        type,
        note: note || `Declared via Mission Dashboard [${type.toUpperCase()}]`,
      }),
    });
  }

  // ---------------- COMMS LINK ----------------
  public static async fetchLinkState(): Promise<LinkState> {
    return this.request<LinkState>('/v1/link/state');
  }

  public static async overrideLink(params: {
    delay_ms: number;
    packet_loss_rate?: number;
    force_blackout?: boolean;
    duration_s?: number;
    reason?: string;
  }): Promise<void> {
    await this.request('/v1/link/override', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  public static async clearLinkOverride(): Promise<void> {
    await this.request('/v1/link/override', {
      method: 'DELETE',
    });
  }

  // ---------------- ONBOARD PROTOCOLS ----------------
  public static async fetchProtocols(hazardType?: string): Promise<ProtocolsListResponse> {
    const url = hazardType ? `/v1/protocols?hazard_type=${hazardType}` : '/v1/protocols';
    return this.request<ProtocolsListResponse>(url);
  }

  public static async completeProtocolStep(
    protocolId: string,
    stepNumber: number,
    notes?: string,
  ): Promise<void> {
    await this.request(`/v1/protocols/${protocolId}/steps/${stepNumber}/complete`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  }
}
