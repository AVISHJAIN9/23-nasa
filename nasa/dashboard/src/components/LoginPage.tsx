import React, { useState } from 'react';
import { ApiService } from '../services/api';
import { User } from '../types/auth';

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
}

const DEMO_ACCOUNTS = [
  {
    roleTitle: 'Flight Surgeon',
    name: 'Dr. Sarah Connor',
    email: 'surgeon@astrocare.nasa.gov',
    password: '',
    badge: 'badge-blue',
    icon: '🩺',
    desc: 'Unredacted clinical triage, baseline z-scores, snooze & clinical notes',
  },
  {
    roleTitle: 'Mission Control',
    name: 'Gene Kranz (Flight Director)',
    email: 'control@astrocare.nasa.gov',
    password: '',
    badge: 'badge-purple',
    icon: '📡',
    desc: 'Telemetry & flight awareness with confidential medical notes redacted',
  },
  {
    roleTitle: 'Lead Astronaut',
    name: 'Cmdr. Alex Mercer',
    email: 'mercer@astrocare.nasa.gov',
    password: '',
    badge: 'badge-green',
    icon: '👨‍🚀',
    desc: 'Personal biometrics, autonomous checklists & emergency declaration',
  },
  {
    roleTitle: 'Medical Officer',
    name: 'Lt. Maya Chen',
    email: 'chen@astrocare.nasa.gov',
    password: '',
    badge: 'badge-green',
    icon: '💉',
    desc: 'Crew medical officer with unredacted clinical triage & protocols',
  },
  {
    roleTitle: 'System Admin',
    name: 'Dr. Marcus Vance',
    email: 'admin@astrocare.nasa.gov',
    password: '',
    badge: 'badge-amber',
    icon: '🛡️',
    desc: 'Ledger audit verification, comms overrides, system configuration',
  },
];

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await ApiService.login(email, password);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err?.message || 'Authentication failed. Check credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickLogin = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setIsLoading(true);
    setError(null);
    ApiService.login(demoEmail, demoPass)
      .then((res) => onLoginSuccess(res.user))
      .catch((err: any) => setError(err?.message || 'Failed to authenticate demo user'))
      .finally(() => setIsLoading(false));
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ maxWidth: '980px', width: '100%', display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: '32px' }}>
        {/* Left Side: Login Form */}
        <div className="glass-panel" style={{ padding: '36px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '22px',
              color: '#fff',
              boxShadow: '0 0 20px rgba(56, 189, 248, 0.4)',
            }}>
              ✦
            </div>
            <div>
              <h1 className="font-display" style={{ fontSize: '22px', fontWeight: 900, letterSpacing: '0.05em' }}>ASTROCARE</h1>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Deep-Space Clinical Decision Support</p>
            </div>
          </div>

          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
            Authenticate with your NASA mission credentials or choose a quick role-based evaluation profile.
          </p>

          {error && (
            <div style={{
              background: 'rgba(244, 63, 94, 0.15)',
              border: '1px solid rgba(244, 63, 94, 0.4)',
              color: '#fda4af',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '12px',
              marginBottom: '20px',
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                CREW EMAIL
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
                  fontFamily: 'var(--font-mono)',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                SECURITY PASSKEY
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
                  fontFamily: 'var(--font-mono)',
                  outline: 'none',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', fontSize: '14px', opacity: isLoading ? 0.7 : 1 }}
            >
              {isLoading ? 'AUTHENTICATING...' : 'SECURE CONSOLE LOGIN →'}
            </button>
          </form>

          <div style={{ marginTop: '24px', padding: '12px', background: 'rgba(56, 189, 248, 0.05)', borderRadius: '8px', border: '1px dashed rgba(56, 189, 248, 0.2)' }}>
            <div style={{ fontSize: '11px', color: 'var(--accent-cyan)', fontWeight: 600 }}>MISSION SECURITY NOTICE</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Protected under NASA-STD-3001 biomedical privacy. Sessions monitored via hash-chained audit ledger.
            </div>
          </div>
        </div>

        {/* Right Side: Quick One-Click Demo Accounts */}
        <div className="glass-panel" style={{ padding: '36px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px', color: '#fff' }} className="font-display">
            QUICK EVALUATION ROLES
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
            Click any operational role to test specific role permissions and confidentiality protections:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {DEMO_ACCOUNTS.map((acc) => (
              <div
                key={acc.email}
                onClick={() => handleQuickLogin(acc.email, acc.password)}
                className="glass-panel"
                style={{
                  padding: '12px 16px',
                  cursor: 'pointer',
                  background: 'rgba(30, 41, 59, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                }}
              >
                <div style={{ fontSize: '24px' }}>{acc.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{acc.name}</span>
                    <span className={`badge ${acc.badge}`}>{acc.roleTitle}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {acc.desc}
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--accent-cyan)', fontWeight: 700 }}>
                  LOGIN &rarr;
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
