import React, { useState, useEffect } from 'react';
import { ProtocolItem } from '../types/protocols';
import { ApiService } from '../services/api';
import { User } from '../types/auth';

interface ProtocolsPanelProps {
  user: User;
  isBlackout: boolean;
}

export const ProtocolsPanel: React.FC<ProtocolsPanelProps> = ({ isBlackout }) => {
  const [protocols, setProtocols] = useState<ProtocolItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [completedSteps, setCompletedSteps] = useState<Record<string, Set<number>>>({});
  const [selectedProtocolId, setSelectedProtocolId] = useState<string | null>(null);

  useEffect(() => {
    ApiService.fetchProtocols()
      .then((res) => {
        setProtocols(res.protocols || []);
        if (res.protocols?.length > 0) {
          setSelectedProtocolId(res.protocols[0]!.id);
        }
      })
      .catch((err) => console.error('Failed to load protocols:', err))
      .finally(() => setIsLoading(false));
  }, []);

  const handleToggleStep = async (protocolId: string, stepNumber: number) => {
    const current = completedSteps[protocolId] || new Set<number>();
    const next = new Set(current);

    if (next.has(stepNumber)) {
      next.delete(stepNumber);
    } else {
      next.add(stepNumber);
      try {
        await ApiService.completeProtocolStep(
          protocolId,
          stepNumber,
          `Completed by onboard officer at ${new Date().toISOString()}`,
        );
      } catch (err) {
        console.error('Failed to log protocol step completion:', err);
      }
    }

    setCompletedSteps({
      ...completedSteps,
      [protocolId]: next,
    });
  };

  const activeProtocol = protocols.find((p) => p.id === selectedProtocolId) || protocols[0];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }} className="font-display">
            AUTONOMOUS ONBOARD CLINICAL GUIDANCE &amp; CHECKLISTS
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            NASA-STD-3001 Microgravity Medical Emergency Protocols &bull; Standalone autonomous survival checklists
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isBlackout ? (
            <span className="badge badge-red pulse-critical" style={{ padding: '6px 12px' }}>
              AUTONOMOUS MODE ENGAGED (LINK OFFLINE)
            </span>
          ) : (
            <span className="badge badge-green" style={{ padding: '6px 12px' }}>
              GROUND TELE-MEDICINE SYNCHRONIZED
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading NASA microgravity emergency checklists...
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.2fr', gap: '24px' }}>
          {/* Protocol Selector List */}
          <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              SELECT EMERGENCY PROTOCOL
            </div>
            {protocols.map((p) => {
              const isSelected = p.id === activeProtocol?.id;
              const completedCount = completedSteps[p.id]?.size || 0;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedProtocolId(p.id)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(30, 41, 59, 0.4)',
                    border: `1px solid ${isSelected ? 'var(--accent-cyan)' : 'transparent'}`,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: isSelected ? 'var(--accent-cyan)' : '#fff' }}>
                      {p.title}
                    </span>
                    <span className={`badge ${p.severity === 'critical' ? 'badge-red' : 'badge-amber'}`} style={{ fontSize: '9px' }}>
                      {p.severity}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Steps: {completedCount} / {p.steps?.length || 0} completed
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active Checklist Details */}
          {activeProtocol && (
            <div className="glass-panel" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span className="badge badge-purple">HAZARD: {activeProtocol.hazard_type.toUpperCase()}</span>
                    <span className={`badge ${activeProtocol.severity === 'critical' ? 'badge-red' : 'badge-amber'}`}>
                      {activeProtocol.severity.toUpperCase()}
                    </span>
                  </div>
                  <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>{activeProtocol.title}</h3>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {activeProtocol.description}
                  </p>
                </div>
              </div>

              {/* Steps List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
                {activeProtocol.steps?.map((step) => {
                  const isDone = completedSteps[activeProtocol.id]?.has(step.step_number);
                  return (
                    <div
                      key={step.step_number}
                      onClick={() => handleToggleStep(activeProtocol.id, step.step_number)}
                      style={{
                        padding: '14px 18px',
                        borderRadius: '10px',
                        background: isDone ? 'rgba(16, 185, 129, 0.08)' : 'rgba(30, 41, 59, 0.5)',
                        border: `1px solid ${isDone ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-subtle)'}`,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '14px',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(isDone)}
                        onChange={() => {}}
                        style={{ marginTop: '3px', width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: isDone ? 'var(--accent-emerald)' : '#fff' }}>
                          Step {step.step_number}: {step.instruction}
                        </div>

                        {step.medication && (
                          <div style={{ fontSize: '11px', color: 'var(--accent-cyan)', marginTop: '4px', fontWeight: 600 }}>
                            💊 Dosing: {step.medication}
                          </div>
                        )}

                        {step.caution && (
                          <div style={{ fontSize: '11px', color: '#fda4af', marginTop: '4px' }}>
                            ⚠️ Caution: {step.caution}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: '24px', padding: '12px 16px', background: 'rgba(0, 0, 0, 0.25)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Decision Audit: Step executions are logged to the onboard tamper-evident ledger and will automatically synchronize with Ground Medical upon link reconnection.
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
