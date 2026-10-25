import React, { useState } from 'react';
import { LinkState } from '../types/link';
import { User } from '../types/auth';
import { ApiService } from '../services/api';

interface CommsDelayPanelProps {
  user: User;
  linkState: LinkState | null;
  onRefreshLink: () => void;
}

export const CommsDelayPanel: React.FC<CommsDelayPanelProps> = ({
  user,
  linkState,
  onRefreshLink,
}) => {
  const [overrideDelaySeconds, setOverrideDelaySeconds] = useState(720);
  const [overridePacketLoss, setOverridePacketLoss] = useState(0.02);
  const [forceBlackout, setForceBlackout] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canOverride = user.role === 'admin' || user.role === 'flight_surgeon';

  const handleApplyOverride = async () => {
    setIsSubmitting(true);
    try {
      await ApiService.overrideLink({
        delay_ms: overrideDelaySeconds * 1000,
        packet_loss_rate: overridePacketLoss,
        force_blackout: forceBlackout,
        duration_s: 3600,
        reason: 'Console operator manual test override',
      });
      onRefreshLink();
    } catch (err: any) {
      alert(`Override failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearOverride = async () => {
    setIsSubmitting(true);
    try {
      await ApiService.clearLinkOverride();
      onRefreshLink();
    } catch (err: any) {
      alert(`Clear override failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDelayMinutes = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m ${rem}s (${s}s)`;
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }} className="font-display">
          DEEP-SPACE COMMUNICATIONS &amp; DELAY EMULATOR
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Speed-of-light propagation modeling, RF packet loss, and store-and-forward queue status (Phase 4 / F070)
        </p>
      </div>

      {/* Primary Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '6px' }}>
            ORBITAL MISSION MODE
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#38bdf8' }} className="font-display">
            {linkState?.mission_mode?.toUpperCase() || 'MARS'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {linkState?.mission_mode === 'mars' ? '4 to 24 min one-way light time' : linkState?.mission_mode === 'moon' ? '1.3s light time' : 'Low Earth Orbit (Real-time)'}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '6px' }}>
            EFFECTIVE ONE-WAY DELAY
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#fff' }} className="font-mono">
            {linkState ? formatDelayMinutes(linkState.effective_delay_ms) : '12m 00s (720s)'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Round-trip query latency: {linkState ? formatDelayMinutes(linkState.effective_delay_ms * 2) : '24m 00s'}
          </div>
        </div>

        <div className={`glass-panel ${linkState?.in_blackout ? 'pulse-critical' : ''}`} style={{ padding: '20px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '6px' }}>
            RADIO LINK STATUS
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: linkState?.in_blackout ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
            {linkState?.in_blackout ? 'BLACKOUT ACTIVE' : 'CARRIER LOCK'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {linkState?.in_blackout ? `Reason: ${linkState.blackout_label || 'Solar Conjunction'}` : 'Direct Ground Link Active'}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '6px' }}>
            RF PACKET DROP RATE
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#fff' }} className="font-mono">
            {linkState ? `${(linkState.packet_loss_rate * 100).toFixed(2)}%` : '0.00%'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Store-and-forward queue protects against lost frames
          </div>
        </div>
      </div>

      {/* Delay Emulator Overrides */}
      {canOverride && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }} className="font-display">
              ADMINISTRATIVE LINK OVERRIDE CONTROLS
            </h3>
            {linkState?.override_active && (
              <span className="badge badge-amber">OVERRIDE ACTIVE</span>
            )}
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
            Directly manipulate simulated propagation delay and blackout windows to evaluate autonomous crew behavior and DTN sync.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                ONE-WAY DELAY (SECONDS)
              </label>
              <input
                type="number"
                min={0}
                max={3600}
                value={overrideDelaySeconds}
                onChange={(e) => setOverrideDelaySeconds(Number(e.target.value))}
                style={{ width: '100%', padding: '8px', background: '#1e293b', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: '#fff' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                PACKET LOSS FRACTION (0.0 - 0.5)
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={0.5}
                value={overridePacketLoss}
                onChange={(e) => setOverridePacketLoss(Number(e.target.value))}
                style={{ width: '100%', padding: '8px', background: '#1e293b', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: '#fff' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '24px' }}>
              <input
                type="checkbox"
                id="forceBlackout"
                checked={forceBlackout}
                onChange={(e) => setForceBlackout(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <label htmlFor="forceBlackout" style={{ fontSize: '13px', color: '#fff', cursor: 'pointer' }}>
                Force Comms Blackout
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleApplyOverride}
              disabled={isSubmitting}
              className="btn btn-primary"
            >
              {isSubmitting ? 'Applying...' : 'Apply Simulation Override'}
            </button>
            <button
              onClick={handleClearOverride}
              disabled={isSubmitting}
              className="btn btn-secondary"
            >
              Restore Ephemeris Model
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
