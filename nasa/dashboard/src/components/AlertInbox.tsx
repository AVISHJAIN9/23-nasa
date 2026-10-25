import React, { useState } from 'react';
import { InboxItem, Severity, WorkflowStatus } from '../types/alerts';
import { User } from '../types/auth';
import { ApiService } from '../services/api';

interface AlertInboxProps {
  user: User;
  alerts: InboxItem[];
  onRefresh: () => void;
}

export const AlertInbox: React.FC<AlertInboxProps> = ({ user, alerts, onRefresh }) => {
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [statusFilter, setStatusFilter] = useState<string>('unresolved');
  const [snoozeModalAlertId, setSnoozeModalAlertId] = useState<string | null>(null);
  const [snoozeMinutes, setSnoozeMinutes] = useState(30);
  const [snoozeReason, setSnoozeReason] = useState('Monitoring stabilizing vital trends');
  const [resolveModalAlertId, setResolveModalAlertId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('Administered protocol guidance; vitals stabilized');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isMissionControl = user.role === 'mission_control';

  // Filter alerts
  const filteredAlerts = alerts.filter((a) => {
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false;
    if (statusFilter === 'unresolved') return a.status !== 'resolved';
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    return true;
  });

  const handleAcknowledge = async (id: string) => {
    setIsSubmitting(true);
    try {
      await ApiService.acknowledgeAlert(id, 'Acknowledged via mission console');
      onRefresh();
    } catch (err: any) {
      alert(`Acknowledge failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssignToMe = async (id: string) => {
    setIsSubmitting(true);
    try {
      await ApiService.assignAlert(id, user.id);
      onRefresh();
    } catch (err: any) {
      alert(`Assign failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSnooze = async () => {
    if (!snoozeModalAlertId) return;
    setIsSubmitting(true);
    try {
      await ApiService.snoozeAlert(snoozeModalAlertId, snoozeMinutes, snoozeReason);
      setSnoozeModalAlertId(null);
      onRefresh();
    } catch (err: any) {
      alert(`Snooze failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResolve = async () => {
    if (!resolveModalAlertId) return;
    setIsSubmitting(true);
    try {
      await ApiService.resolveAlert(resolveModalAlertId, resolutionNote, 'treated');
      setResolveModalAlertId(null);
      onRefresh();
    } catch (err: any) {
      alert(`Resolve failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getSeverityBadge = (sev: Severity) => {
    switch (sev) {
      case 'critical':
        return <span className="badge badge-red pulse-critical">CRITICAL (RED)</span>;
      case 'warning':
        return <span className="badge badge-amber">WARNING (AMBER)</span>;
      case 'watch':
        return <span className="badge badge-blue">WATCH</span>;
    }
  };

  const getStatusBadge = (status: WorkflowStatus) => {
    switch (status) {
      case 'open':
        return <span className="badge badge-red">OPEN</span>;
      case 'acknowledged':
        return <span className="badge badge-amber">ACKNOWLEDGED</span>;
      case 'snoozed':
        return <span className="badge badge-purple">SNOOZED</span>;
      case 'resolved':
        return <span className="badge badge-green">RESOLVED</span>;
    }
  };

  return (
    <div>
      {/* Triage Header & Filter Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }} className="font-display">
            CLINICAL ALERT INBOX &amp; FUSION ENGINE
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Real-time fused alerts with multi-vital ML anomaly correlation &bull; De-duplicated across sensor streams
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid var(--border-subtle)',
              color: '#fff',
              fontSize: '12px',
            }}
          >
            <option value="unresolved">Unresolved (Active)</option>
            <option value="all">All Alerts</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="snoozed">Snoozed</option>
            <option value="resolved">Resolved</option>
          </select>

          <div style={{ display: 'flex', gap: '4px' }}>
            {(['all', 'critical', 'warning', 'watch'] as const).map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`btn btn-sm ${severityFilter === sev ? 'btn-primary' : 'btn-secondary'}`}
              >
                {sev.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Redaction Notice for Mission Control */}
      {isMissionControl && (
        <div style={{
          background: 'rgba(168, 85, 247, 0.12)',
          border: '1px solid rgba(168, 85, 247, 0.35)',
          borderRadius: '10px',
          padding: '12px 18px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <span style={{ fontSize: '20px' }}>🔒</span>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#e9d5ff' }}>
              MISSION CONTROL CONFIDENTIALITY FILTER ACTIVE (NASA-STD-3001)
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Operational flight telemetry and hazard classifications are visible. Private clinical triage notes, diagnostic explanations, and personal medication logs are redacted.
            </div>
          </div>
        </div>
      )}

      {/* Alerts List */}
      {filteredAlerts.length === 0 ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>✅</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>No Active Alerts Matching Criteria</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            All crew vital streams operating within nominal baseline envelopes.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {filteredAlerts.map((alert) => (
            <div
              key={alert.id}
              className="glass-panel"
              style={{
                padding: '20px',
                borderLeft: alert.severity === 'critical' ? '4px solid #ef4444' : alert.severity === 'warning' ? '4px solid #f59e0b' : '4px solid #38bdf8',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    {getSeverityBadge(alert.severity)}
                    {getStatusBadge(alert.status)}
                    <span className="badge badge-purple" style={{ fontSize: '10px' }}>
                      HAZARD: {alert.hazard.toUpperCase()}
                    </span>
                    <span className="badge badge-blue" style={{ fontSize: '10px' }}>
                      CREW: {alert.crew_id}
                    </span>
                  </div>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>{alert.summary}</h3>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>First Detected:</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }} className="font-mono">
                    {new Date(alert.first_detected_at).toLocaleTimeString()}
                  </div>
                </div>
              </div>

              {/* Affected vitals tags */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>AFFECTED VITALS:</span>
                {alert.affected_vitals.map((v) => (
                  <span key={v} className="badge badge-red" style={{ fontSize: '10px', padding: '1px 6px' }}>
                    {v.replace('_', ' ')}
                  </span>
                ))}
              </div>

              {/* ML Explanation & Rules Fired */}
              <div style={{ background: 'rgba(0, 0, 0, 0.25)', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '12px' }}>
                <div style={{ color: 'var(--accent-cyan)', fontWeight: 600, marginBottom: '4px' }}>
                  ANOMALY DETECTION &amp; ML DIAGNOSTIC FACTORS:
                </div>
                {isMissionControl ? (
                  <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'var(--font-mono)' }}>
                    [REDACTED MEDICAL CONFIDENTIAL - FLIGHT SURGEON ACCESS ONLY]
                  </div>
                ) : (
                  <div>
                    {alert.explanation?.rules_fired && alert.explanation.rules_fired.length > 0 && (
                      <div style={{ color: 'var(--text-secondary)' }}>
                        Fired Clinical Rules: {alert.explanation.rules_fired.join(', ')}
                      </div>
                    )}
                    {alert.explanation?.ml_factors && alert.explanation.ml_factors.length > 0 && (
                      <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                        Isolation Forest &amp; Z-Score Impact:{' '}
                        {alert.explanation.ml_factors.map((f) => `${f.vital} (+${f.score.toFixed(1)}σ)`).join(', ')}
                      </div>
                    )}
                    {alert.resolution_note && (
                      <div style={{ color: 'var(--accent-emerald)', marginTop: '4px' }}>
                        Resolution Note: {alert.resolution_note}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
                {alert.status === 'open' && (
                  <button
                    onClick={() => handleAcknowledge(alert.id)}
                    disabled={isSubmitting}
                    className="btn btn-primary btn-sm"
                  >
                    ✓ ACKNOWLEDGE
                  </button>
                )}

                {!isMissionControl && (
                  <>
                    <button
                      onClick={() => handleAssignToMe(alert.id)}
                      disabled={isSubmitting}
                      className="btn btn-secondary btn-sm"
                    >
                      👤 ASSIGN TO ME
                    </button>
                    <button
                      onClick={() => setSnoozeModalAlertId(alert.id)}
                      disabled={isSubmitting}
                      className="btn btn-secondary btn-sm"
                    >
                      ⏱️ SNOOZE...
                    </button>
                  </>
                )}

                {alert.status !== 'resolved' && (
                  <button
                    onClick={() => setResolveModalAlertId(alert.id)}
                    disabled={isSubmitting}
                    className="btn btn-secondary btn-sm"
                    style={{ borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)' }}
                  >
                    ✓ RESOLVE...
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Snooze Modal */}
      {snoozeModalAlertId && (
        <div className="modal-backdrop" onClick={() => setSnoozeModalAlertId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', marginBottom: '14px' }}>SNOOZE CLINICAL ALERT</h3>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                SNOOZE DURATION (MINUTES)
              </label>
              <select
                value={snoozeMinutes}
                onChange={(e) => setSnoozeMinutes(Number(e.target.value))}
                style={{ width: '100%', padding: '8px', background: '#1e293b', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: '#fff' }}
              >
                <option value={15}>15 Minutes</option>
                <option value={30}>30 Minutes</option>
                <option value={60}>60 Minutes (1 Hour)</option>
                <option value={120}>120 Minutes (2 Hours - Watch Max)</option>
              </select>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                CLINICAL REASON FOR SNOOZE
              </label>
              <input
                type="text"
                value={snoozeReason}
                onChange={(e) => setSnoozeReason(e.target.value)}
                style={{ width: '100%', padding: '8px', background: '#1e293b', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: '#fff' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setSnoozeModalAlertId(null)} className="btn btn-secondary btn-sm">Cancel</button>
              <button onClick={handleSnooze} disabled={isSubmitting} className="btn btn-primary btn-sm">Confirm Snooze</button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      {resolveModalAlertId && (
        <div className="modal-backdrop" onClick={() => setResolveModalAlertId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', marginBottom: '14px' }}>RESOLVE CLINICAL ALERT</h3>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                TREATMENT / RESOLUTION NOTES
              </label>
              <textarea
                rows={3}
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                style={{ width: '100%', padding: '8px', background: '#1e293b', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: '#fff', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setResolveModalAlertId(null)} className="btn btn-secondary btn-sm">Cancel</button>
              <button onClick={handleResolve} disabled={isSubmitting} className="btn btn-primary btn-sm" style={{ background: '#10b981' }}>
                Confirm Resolution
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
