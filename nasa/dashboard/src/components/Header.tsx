import React, { useState, useEffect } from 'react';
import { User } from '../types/auth';
import { LinkState } from '../types/link';

interface HeaderProps {
  user: User;
  linkState: LinkState | null;
  onLogout: () => void;
  onOpenEmergency: () => void;
  hasActiveEmergency?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  linkState,
  onLogout,
  onOpenEmergency,
  hasActiveEmergency,
}) => {
  const [now, setNow] = useState(new Date().toISOString());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date().toISOString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDelay = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'flight_surgeon':
        return 'badge-blue';
      case 'mission_control':
        return 'badge-purple';
      case 'astronaut':
        return 'badge-green';
      case 'admin':
        return 'badge-amber';
      default:
        return 'badge-blue';
    }
  };

  return (
    <header style={{ borderBottom: '1px solid var(--border-subtle)', background: 'rgba(7, 10, 19, 0.95)', position: 'sticky', top: 0, zIndex: 100 }}>
      {/* Top Blackout / Comms Banner */}
      {linkState?.in_blackout && (
        <div style={{
          background: 'linear-gradient(90deg, #991b1b 0%, #b91c1c 50%, #991b1b 100%)',
          color: '#fff',
          padding: '6px 20px',
          textAlign: 'center',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.1em',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
        }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#fff' }} className="pulse-critical" />
          <span>DEEP SPACE COMMS BLACKOUT ACTIVE &bull; {linkState.blackout_label || 'SOLAR CONJUNCTION'} &bull; AUTONOMOUS ONBOARD MODE ENGAGED</span>
        </div>
      )}

      {hasActiveEmergency && (
        <div style={{
          background: 'linear-gradient(90deg, #dc2626 0%, #ef4444 50%, #dc2626 100%)',
          color: '#fff',
          padding: '8px 20px',
          textAlign: 'center',
          fontSize: '13px',
          fontWeight: 800,
          letterSpacing: '0.12em',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
        }} className="pulse-critical">
          <span>⚠️ CRITICAL MEDICAL EMERGENCY DECLARED &bull; TRIAGE PROTOCOL IN EFFECT &bull; ALL CHANNELS ALERTED</span>
        </div>
      )}

      <div style={{ maxWidth: '1600px', margin: '0 auto', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
        {/* Brand / Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 900,
            fontSize: '18px',
            color: '#fff',
            boxShadow: '0 0 15px rgba(56, 189, 248, 0.5)',
          }}>
            ✦
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="font-display" style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '0.08em', color: '#fff' }}>ASTROCARE</span>
              <span className="badge badge-blue">SPACE-MED</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>NASA Clinical Decision Support</div>
          </div>
        </div>

        {/* Mission Telemetry & Comms State */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {/* Mission Mode & Delay */}
          <div className="glass-panel" style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div>
              <div style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>MISSION MODE</div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8' }} className="font-display">
                {linkState?.mission_mode?.toUpperCase() || 'MARS'}
              </div>
            </div>
            <div style={{ width: '1px', height: '20px', background: 'var(--border-subtle)' }} />
            <div>
              <div style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>ONE-WAY DELAY</div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#e2e8f0' }} className="font-mono">
                {linkState ? formatDelay(linkState.effective_delay_ms) : '14m 24s'}
              </div>
            </div>
            <div style={{ width: '1px', height: '20px', background: 'var(--border-subtle)' }} />
            <div>
              <div style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>PACKET LOSS</div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#e2e8f0' }} className="font-mono">
                {linkState ? `${(linkState.packet_loss_rate * 100).toFixed(1)}%` : '0.0%'}
              </div>
            </div>
          </div>

          {/* Mission Clock UTC */}
          <div className="glass-panel" style={{ padding: '6px 14px' }}>
            <div style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>MISSION CLOCK (UTC)</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-emerald)' }} className="font-mono">
              {now.replace('T', ' ').slice(0, 19)}Z
            </div>
          </div>
        </div>

        {/* User Session & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            onClick={onOpenEmergency}
            className="btn btn-emergency btn-sm pulse-critical"
            title="Declare Critical Medical Emergency"
          >
            🚨 DECLARE EMERGENCY
          </button>

          <div className="glass-panel" style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>{user.display_name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                <span className={`badge ${getRoleBadgeClass(user.role)}`}>{user.role.replace('_', ' ')}</span>
                {user.is_medical_officer && <span className="badge badge-green">MED-OFFICER</span>}
              </div>
            </div>
            <button onClick={onLogout} className="btn btn-secondary btn-sm" style={{ padding: '4px 8px' }} title="Log out">
              Log out
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
