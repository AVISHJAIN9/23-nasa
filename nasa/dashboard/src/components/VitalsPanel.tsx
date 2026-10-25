import React, { useState } from 'react';
import { CrewProfile, LiveVitalsMap } from '../types/telemetry';
import { User } from '../types/auth';

interface VitalsPanelProps {
  user: User;
  crews: CrewProfile[];
  selectedCrewId: string;
  onSelectCrew: (crewId: string) => void;
  vitals: LiveVitalsMap;
  history: Array<{ timestamp: string; hr: number; spo2: number }>;
  isSocketConnected: boolean;
}

export const VitalsPanel: React.FC<VitalsPanelProps> = ({
  user,
  crews,
  selectedCrewId,
  onSelectCrew,
  vitals,
  history,
  isSocketConnected,
}) => {
  const [selectedChartMetric, setSelectedChartMetric] = useState<'hr' | 'spo2'>('hr');

  const selectedCrew = crews.find((c) => c.id === selectedCrewId) || crews[0];
  const isAstronautRestricted = user.role === 'astronaut' && !user.is_medical_officer;

  // NASA-STD-3001 threshold evaluations
  const hr = vitals.heart_rate?.value ?? 72;
  const spo2 = vitals.spo2?.value ?? 98;
  const sys = vitals.blood_pressure_systolic?.value ?? 118;
  const dia = vitals.blood_pressure_diastolic?.value ?? 78;
  const rr = vitals.respiration_rate?.value ?? 15;
  const temp = vitals.temperature?.value ?? 37.0;
  const co2 = vitals.cabin_co2?.value ?? 2.1;
  const rad = vitals.cumulative_radiation_msv?.value ?? 48.2;

  const getHrStatus = (v: number) => {
    if (v > 130 || v < 45) return { status: 'CRITICAL', color: 'var(--accent-rose)', badge: 'badge-red' };
    if (v > 100 || v < 55) return { status: 'WARNING', color: 'var(--accent-amber)', badge: 'badge-amber' };
    return { status: 'NOMINAL', color: 'var(--accent-emerald)', badge: 'badge-green' };
  };

  const getSpo2Status = (v: number) => {
    if (v < 90) return { status: 'CRITICAL', color: 'var(--accent-rose)', badge: 'badge-red' };
    if (v < 94) return { status: 'WARNING', color: 'var(--accent-amber)', badge: 'badge-amber' };
    return { status: 'NOMINAL', color: 'var(--accent-emerald)', badge: 'badge-green' };
  };

  const hrEval = getHrStatus(hr);
  const spo2Eval = getSpo2Status(spo2);

  // SVG Chart rendering helper
  const renderSparkline = () => {
    if (!history || history.length < 2) {
      return (
        <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          Waiting for live telemetry stream frames from Socket.IO /live...
        </div>
      );
    }

    const width = 680;
    const height = 180;
    const padding = 20;

    const values = history.map((d) => (selectedChartMetric === 'hr' ? d.hr : d.spo2));
    const minVal = Math.min(...values) - 2;
    const maxVal = Math.max(...values) + 2;
    const range = Math.max(1, maxVal - minVal);

    const points = values.map((val, idx) => {
      const x = padding + (idx / (values.length - 1)) * (width - padding * 2);
      const y = height - padding - ((val - minVal) / range) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    const strokeColor = selectedChartMetric === 'hr' ? '#f43f5e' : '#38bdf8';

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '180px', overflow: 'visible' }}>
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="rgba(255,255,255,0.06)" />
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="rgba(255,255,255,0.06)" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(255,255,255,0.06)" />

        {/* Curve Area */}
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />

        {/* Current Value Circle */}
        {values.length > 0 && (
          <circle
            cx={width - padding}
            cy={height - padding - ((values[values.length - 1] - minVal) / range) * (height - padding * 2)}
            r="4.5"
            fill={strokeColor}
            className="pulse-critical"
          />
        )}
      </svg>
    );
  };

  return (
    <div>
      {/* Crew Selector Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
          {crews.map((crew) => {
            const isSelected = crew.id === selectedCrewId;
            const isSelf = user.crew_profile_id === crew.id;
            return (
              <button
                key={crew.id}
                onClick={() => onSelectCrew(crew.id)}
                className="btn btn-secondary"
                disabled={isAstronautRestricted && !isSelf}
                style={{
                  background: isSelected ? 'linear-gradient(135deg, rgba(2, 132, 199, 0.4) 0%, rgba(56, 189, 248, 0.2) 100%)' : undefined,
                  borderColor: isSelected ? 'var(--accent-cyan)' : undefined,
                  opacity: isAstronautRestricted && !isSelf ? 0.35 : 1,
                  padding: '8px 14px',
                }}
              >
                <span style={{ fontWeight: 700 }}>{crew.callsign}</span>
                {isSelf && <span className="badge badge-green" style={{ fontSize: '9px' }}>YOU</span>}
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({crew.sex[0].toUpperCase()}/{crew.age})</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <span style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isSocketConnected ? 'var(--accent-emerald)' : 'var(--accent-rose)',
            }} />
            <span style={{ color: isSocketConnected ? 'var(--accent-emerald)' : 'var(--accent-rose)', fontWeight: 600 }}>
              {isSocketConnected ? 'STREAMING 1 Hz' : 'BUS OFFLINE'}
            </span>
          </div>
        </div>
      </div>

      {/* Primary Biometrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {/* Heart Rate */}
        <div className={`glass-panel ${hrEval.status === 'CRITICAL' ? 'pulse-critical' : ''}`} style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>HEART RATE</span>
            <span className={`badge ${hrEval.badge}`}>{hrEval.status}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span className="font-mono" style={{ fontSize: '32px', fontWeight: 800, color: hrEval.color }}>{hr.toFixed(0)}</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>bpm</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            NASA Limits: 60 - 100 bpm
          </div>
        </div>

        {/* SpO2 */}
        <div className={`glass-panel ${spo2Eval.status === 'CRITICAL' ? 'pulse-critical' : ''}`} style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>PULSE OXIMETRY</span>
            <span className={`badge ${spo2Eval.badge}`}>{spo2Eval.status}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span className="font-mono" style={{ fontSize: '32px', fontWeight: 800, color: spo2Eval.color }}>{spo2.toFixed(1)}</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>%</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            NASA Limits: &ge; 95% SpO2
          </div>
        </div>

        {/* Blood Pressure */}
        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>BLOOD PRESSURE</span>
            <span className="badge badge-green">NOMINAL</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span className="font-mono" style={{ fontSize: '32px', fontWeight: 800, color: '#fff' }}>
              {sys.toFixed(0)}/{dia.toFixed(0)}
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>mmHg</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Baseline: 120/80 mmHg
          </div>
        </div>

        {/* Respiration Rate */}
        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>RESPIRATION</span>
            <span className="badge badge-green">NOMINAL</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span className="font-mono" style={{ fontSize: '32px', fontWeight: 800, color: '#fff' }}>{rr.toFixed(0)}</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>br/min</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Normal: 12 - 20 br/min
          </div>
        </div>

        {/* Core Temperature */}
        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>CORE TEMP</span>
            <span className="badge badge-green">NOMINAL</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span className="font-mono" style={{ fontSize: '32px', fontWeight: 800, color: '#fff' }}>{temp.toFixed(1)}</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>&deg;C</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Normal: 36.5 - 37.5 &deg;C
          </div>
        </div>

        {/* Cabin CO2 */}
        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>CABIN CO2</span>
            <span className={`badge ${co2 > 4.0 ? 'badge-red' : co2 > 3.0 ? 'badge-amber' : 'badge-green'}`}>
              {co2 > 4.0 ? 'HIGH' : co2 > 3.0 ? 'ELEVATED' : 'SAFE'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span className="font-mono" style={{ fontSize: '32px', fontWeight: 800, color: co2 > 3.0 ? 'var(--accent-amber)' : '#fff' }}>
              {co2.toFixed(2)}
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>mmHg</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            NASA-STD-3001 Limit: &lt; 3.0 mmHg
          </div>
        </div>

        {/* Radiation Dose */}
        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>CAREER RADIATION</span>
            <span className="badge badge-purple">CUMULATIVE</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span className="font-mono" style={{ fontSize: '32px', fontWeight: 800, color: 'var(--accent-purple)' }}>{rad.toFixed(1)}</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>mSv</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Career Limit: 600 mSv
          </div>
        </div>
      </div>

      {/* Streaming Interactive Time-Series Waveform */}
      <div className="glass-panel" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }} className="font-display">
              REAL-TIME BIOMETRIC WAVEFORM: {selectedCrew?.callsign || 'CREW-01'}
            </h3>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Streaming via WebSocket bus topic <code>telemetry.reading</code> with auto-replay on reconnect
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setSelectedChartMetric('hr')}
              className={`btn btn-sm ${selectedChartMetric === 'hr' ? 'btn-primary' : 'btn-secondary'}`}
            >
              HEART RATE
            </button>
            <button
              onClick={() => setSelectedChartMetric('spo2')}
              className={`btn btn-sm ${selectedChartMetric === 'spo2' ? 'btn-primary' : 'btn-secondary'}`}
            >
              SpO2
            </button>
          </div>
        </div>

        {renderSparkline()}
      </div>
    </div>
  );
};
