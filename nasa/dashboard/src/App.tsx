import { useState, useEffect, useCallback } from 'react';
import { User } from './types/auth';
import { CrewProfile, LiveVitalsMap } from './types/telemetry';
import { InboxItem } from './types/alerts';
import { LinkState } from './types/link';
import { ApiService } from './services/api';
import { SocketService } from './services/socket';

import { Header } from './components/Header';
import { LoginPage } from './components/LoginPage';
import { VitalsPanel } from './components/VitalsPanel';
import { AlertInbox } from './components/AlertInbox';
import { CommsDelayPanel } from './components/CommsDelayPanel';
import { ProtocolsPanel } from './components/ProtocolsPanel';
import { EmergencyModal } from './components/EmergencyModal';

export function App() {
  const [user, setUser] = useState<User | null>(ApiService.getCurrentUser());
  const [activeTab, setActiveTab] = useState<'vitals' | 'inbox' | 'comms' | 'protocols'>('vitals');
  const [crews, setCrews] = useState<CrewProfile[]>([]);
  const [selectedCrewId, setSelectedCrewId] = useState<string>('');
  const [vitals, setVitals] = useState<LiveVitalsMap>({});
  const [history, setHistory] = useState<Array<{ timestamp: string; hr: number; spo2: number }>>([]);
  const [alerts, setAlerts] = useState<InboxItem[]>([]);
  const [linkState, setLinkState] = useState<LinkState | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [hasActiveEmergency, setHasActiveEmergency] = useState(false);

  // Load initial data on mount or user login
  const loadDashboardData = useCallback(async () => {
    if (!user) return;
    try {
      const [crewList, alertList, link] = await Promise.all([
        ApiService.fetchCrewList().catch(() => []),
        ApiService.fetchInbox().catch(() => []),
        ApiService.fetchLinkState().catch(() => null),
      ]);

      setCrews(crewList);
      if (crewList.length > 0) {
        // If astronaut, default to own profile
        const myCrew = crewList.find((c) => c.id === user.crew_profile_id);
        setSelectedCrewId(myCrew ? myCrew.id : crewList[0]!.id);
      }
      setAlerts(alertList);
      setLinkState(link);
    } catch (err) {
      console.error('Error fetching dashboard initial data:', err);
    }
  }, [user]);

  // Auth expiry event listener
  useEffect(() => {
    const onAuthExpired = () => {
      setUser(null);
      SocketService.disconnect();
    };
    window.addEventListener('astrocare:auth-expired', onAuthExpired);
    return () => window.removeEventListener('astrocare:auth-expired', onAuthExpired);
  }, []);

  // Connect socket and fetch data when user changes
  useEffect(() => {
    if (user) {
      loadDashboardData();
      SocketService.connect();

      const unsubConn = SocketService.on('connection:change', (conn: boolean) => {
        setIsSocketConnected(conn);
      });

      // Telemetry readings listener
      const unsubTelem = SocketService.on('topic:telemetry', (envelope: any) => {
        const payload = envelope?.payload;
        if (!payload) return;

        // Single reading or batch
        const items = Array.isArray(payload) ? payload : [payload];
        items.forEach((item: any) => {
          if (item.metric && item.value !== undefined) {
            setVitals((prev) => ({
              ...prev,
              [item.metric]: {
                metric: item.metric,
                value: item.value,
                timestamp: item.timestamp || new Date().toISOString(),
                quality: item.quality || 'valid',
              },
            }));

            if (item.metric === 'heart_rate' || item.metric === 'spo2') {
              setHistory((prev) => {
                const last = prev[prev.length - 1];
                const newPoint = {
                  timestamp: item.timestamp || new Date().toISOString(),
                  hr: item.metric === 'heart_rate' ? item.value : last?.hr ?? 72,
                  spo2: item.metric === 'spo2' ? item.value : last?.spo2 ?? 98,
                };
                return [...prev.slice(-30), newPoint];
              });
            }
          }
        });
      });

      // Inbox alerts listener
      const unsubInbox = SocketService.on('topic:inbox', () => {
        ApiService.fetchInbox().then(setAlerts).catch(() => {});
      });

      // Emergency declaration listener
      const unsubEmerg = SocketService.on('topic:emergency', (envelope: any) => {
        if (envelope?.type === 'emergency.declared') {
          setHasActiveEmergency(true);
        } else if (envelope?.type === 'emergency.cancelled') {
          setHasActiveEmergency(false);
        }
      });

      // Link state update listener
      const unsubLink = SocketService.on('topic:link', (envelope: any) => {
        if (envelope?.payload) {
          setLinkState((prev) => ({
            ...prev!,
            ...envelope.payload,
          }));
        }
      });

      // Replay on reconnect handler
      const unsubReconnect = SocketService.onReconnect(() => {
        loadDashboardData();
      });

      return () => {
        unsubConn();
        unsubTelem();
        unsubInbox();
        unsubEmerg();
        unsubLink();
        unsubReconnect();
        SocketService.disconnect();
      };
    } else {
      SocketService.disconnect();
    }
  }, [user, loadDashboardData]);

  const handleLogout = () => {
    ApiService.logout();
    setUser(null);
  };

  if (!user) {
    return <LoginPage onLoginSuccess={setUser} />;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        user={user}
        linkState={linkState}
        onLogout={handleLogout}
        onOpenEmergency={() => setIsEmergencyModalOpen(true)}
        hasActiveEmergency={hasActiveEmergency}
      />

      {/* Main Console Navigation Bar */}
      <nav style={{ background: 'rgba(15, 23, 42, 0.7)', borderBottom: '1px solid var(--border-subtle)', padding: '0 24px' }}>
        <div style={{ maxWidth: '1600px', margin: '0 auto', display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('vitals')}
            style={{
              padding: '14px 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'vitals' ? '3px solid var(--accent-cyan)' : '3px solid transparent',
              color: activeTab === 'vitals' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '13px',
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>📊</span>
            <span>LIVE BIOMETRICS</span>
          </button>

          <button
            onClick={() => setActiveTab('inbox')}
            style={{
              padding: '14px 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'inbox' ? '3px solid var(--accent-cyan)' : '3px solid transparent',
              color: activeTab === 'inbox' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '13px',
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>🚨</span>
            <span>CLINICAL ALERTS</span>
            {alerts.filter((a) => a.status === 'open').length > 0 && (
              <span className="badge badge-red" style={{ fontSize: '10px', padding: '1px 6px' }}>
                {alerts.filter((a) => a.status === 'open').length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('comms')}
            style={{
              padding: '14px 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'comms' ? '3px solid var(--accent-cyan)' : '3px solid transparent',
              color: activeTab === 'comms' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '13px',
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>📡</span>
            <span>COMMS DELAY &amp; DTN</span>
          </button>

          <button
            onClick={() => setActiveTab('protocols')}
            style={{
              padding: '14px 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'protocols' ? '3px solid var(--accent-cyan)' : '3px solid transparent',
              color: activeTab === 'protocols' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '13px',
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>📋</span>
            <span>AUTONOMOUS GUIDANCE</span>
          </button>
        </div>
      </nav>

      {/* Main Content View */}
      <main style={{ flex: 1, padding: '24px', maxWidth: '1600px', width: '100%', margin: '0 auto' }}>
        {activeTab === 'vitals' && (
          <VitalsPanel
            user={user}
            crews={crews}
            selectedCrewId={selectedCrewId}
            onSelectCrew={setSelectedCrewId}
            vitals={vitals}
            history={history}
            isSocketConnected={isSocketConnected}
          />
        )}

        {activeTab === 'inbox' && (
          <AlertInbox
            user={user}
            alerts={alerts}
            onRefresh={() => ApiService.fetchInbox().then(setAlerts).catch(() => {})}
          />
        )}

        {activeTab === 'comms' && (
          <CommsDelayPanel
            user={user}
            linkState={linkState}
            onRefreshLink={() => ApiService.fetchLinkState().then(setLinkState).catch(() => {})}
          />
        )}

        {activeTab === 'protocols' && (
          <ProtocolsPanel
            user={user}
            isBlackout={Boolean(linkState?.in_blackout)}
          />
        )}
      </main>

      {/* Emergency Modal */}
      <EmergencyModal
        isOpen={isEmergencyModalOpen}
        onClose={() => setIsEmergencyModalOpen(false)}
        onDeclared={() => {
          setHasActiveEmergency(true);
          ApiService.fetchInbox().then(setAlerts).catch(() => {});
        }}
      />
    </div>
  );
}

export default App;
