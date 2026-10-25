import React, { useState } from 'react';
import { ApiService } from '../services/api';

interface EmergencyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeclared: () => void;
}

const EMERGENCY_TYPES = [
  { id: 'cardiac', label: 'Cardiac Arrest / Arrhythmia', icon: '❤️' },
  { id: 'decompression', label: 'Cabin Decompression / DCS', icon: '💨' },
  { id: 'radiation', label: 'Solar Proton Event (SPE) Radiation', icon: '☢️' },
  { id: 'toxic', label: 'Ammonia / CO2 Toxic Inhalation', icon: '☣️' },
  { id: 'trauma', label: 'EVA Physical Trauma / Hemorrhage', icon: '🩸' },
  { id: 'general', label: 'General Life-Safety Emergency', icon: '⚠️' },
];

export const EmergencyModal: React.FC<EmergencyModalProps> = ({ isOpen, onClose, onDeclared }) => {
  const [selectedType, setSelectedType] = useState('cardiac');
  const [note, setNote] = useState('Life-critical cardiac arrhythmia detected during mission operations.');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await ApiService.declareEmergency(selectedType, note);
      onDeclared();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Emergency declaration failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ borderColor: 'var(--accent-rose)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '28px' }}>🚨</div>
          <div>
            <h2 className="font-display" style={{ fontSize: '18px', fontWeight: 900, color: 'var(--accent-rose)' }}>
              DECLARE CRITICAL EMERGENCY
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Immediately engages life-critical triage and broadcasts emergency envelope across bus
            </p>
          </div>
        </div>

        {error && (
          <div style={{
            background: 'rgba(244, 63, 94, 0.15)',
            border: '1px solid rgba(244, 63, 94, 0.4)',
            color: '#fda4af',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '12px',
            marginBottom: '16px',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              HAZARD TYPE
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {EMERGENCY_TYPES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setSelectedType(t.id)}
                  className={`btn btn-secondary ${selectedType === t.id ? 'btn-primary' : ''}`}
                  style={{
                    fontSize: '11px',
                    justifyContent: 'flex-start',
                    padding: '8px 10px',
                    textAlign: 'left',
                    borderColor: selectedType === t.id ? 'var(--accent-rose)' : undefined,
                  }}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              EMERGENCY SITUATION NOTE
            </label>
            <textarea
              rows={3}
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                background: '#1e293b',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-emergency pulse-critical"
              style={{ padding: '10px 20px' }}
            >
              {isSubmitting ? 'TRANSMITTING...' : '⚠️ BROADCAST EMERGENCY NOW'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
