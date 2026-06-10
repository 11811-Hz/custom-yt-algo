import { useState, useEffect, useCallback } from 'react';
import type { FeedForgeSettings, FilterStats, SnoozeEntry } from '../../utils/types';
import { DEFAULT_SETTINGS } from '../../utils/types';
import Dashboard from './components/Dashboard';
import SnoozePanel from './components/SnoozePanel';
import ChannelCapPanel from './components/ChannelCapPanel';
import VelocityPanel from './components/VelocityPanel';
import UpdateBanner from './components/UpdateBanner';

type Tab = 'dashboard' | 'snooze' | 'caps' | 'velocity';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [settings, setSettings] = useState<FeedForgeSettings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<FilterStats>({
    totalIntercepted: 0,
    snoozedCount: 0,
    cappedCount: 0,
    velocityFilteredCount: 0,
    lastUpdated: Date.now(),
  });
  const [snoozes, setSnoozes] = useState<SnoozeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── Load data on mount ──────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [settingsRes, statsRes, snoozesRes] = await Promise.all([
        browser.runtime.sendMessage({ type: 'GET_SETTINGS' }),
        browser.runtime.sendMessage({ type: 'GET_STATS' }),
        browser.runtime.sendMessage({ type: 'GET_ACTIVE_SNOOZES' }),
      ]);

      if (settingsRes?.data) setSettings(settingsRes.data as FeedForgeSettings);
      if (statsRes?.data) setStats(statsRes.data as FilterStats);
      if (snoozesRes?.data) setSnoozes(snoozesRes.data as SnoozeEntry[]);
    } catch (error) {
      console.error('[FeedForge] Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Settings Update Handler ─────────────────────────────────────────────

  const updateSettings = async (partial: Partial<FeedForgeSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);

    try {
      await browser.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: partial,
      });
    } catch (error) {
      console.error('[FeedForge] Failed to update settings:', error);
    }
  };

  // ── Snooze Handlers ─────────────────────────────────────────────────────

  const addSnooze = async (entry: {
    id: string;
    type: 'video' | 'channel' | 'keyword';
    label: string;
    duration?: number;
  }) => {
    try {
      await browser.runtime.sendMessage({ type: 'ADD_SNOOZE', payload: entry });
      await loadData();
    } catch (error) {
      console.error('[FeedForge] Failed to add snooze:', error);
    }
  };

  const removeSnooze = async (id: string, type: SnoozeEntry['type']) => {
    try {
      await browser.runtime.sendMessage({ type: 'REMOVE_SNOOZE', payload: { id, type } });
      setSnoozes((prev) => prev.filter((s) => !(s.id === id && s.type === type)));
    } catch (error) {
      console.error('[FeedForge] Failed to remove snooze:', error);
    }
  };

  // ── Reset Stats ─────────────────────────────────────────────────────────

  const resetStats = async () => {
    try {
      await browser.runtime.sendMessage({ type: 'RESET_STATS' });
      setStats({
        totalIntercepted: 0,
        snoozedCount: 0,
        cappedCount: 0,
        velocityFilteredCount: 0,
        lastUpdated: Date.now(),
      });
    } catch (error) {
      console.error('[FeedForge] Failed to reset stats:', error);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '520px' }}>
        <div className="animate-pulse-glow" style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--color-accent), #7c3aed)',
        }} />
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'dashboard', label: 'Stats', icon: '📊' },
    { key: 'snooze', label: 'Snooze', icon: '😴' },
    { key: 'caps', label: 'Caps', icon: '🔒' },
    { key: 'velocity', label: 'Gems', icon: '💎' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '520px' }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header style={{
        padding: '16px 20px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: 'linear-gradient(135deg, var(--color-accent), #7c3aed)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}>
            ⚒️
          </div>
          <div>
            <h1 style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
            }}>
              FeedForge
            </h1>
            <p style={{
              fontSize: 10,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              YouTube Algorithm Control
            </p>
          </div>
        </div>

        {/* Master Toggle */}
        <div
          className={`toggle-switch ${settings.enabled ? 'active' : ''}`}
          onClick={() => updateSettings({ enabled: !settings.enabled })}
          role="switch"
          aria-checked={settings.enabled}
          aria-label="Toggle FeedForge"
          id="master-toggle"
        />
      </header>

      {/* ── Tab Navigation ───────────────────────────────────────────────── */}
      <nav style={{
        display: 'flex',
        gap: '0',
        padding: '0 20px',
        borderBottom: '1px solid var(--color-border)',
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            id={`tab-${tab.key}`}
            style={{ flex: 1 }}
          >
            <span style={{ marginRight: 4 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Update Banner ─────────────────────────────────────────────── */}
      <UpdateBanner />

      {/* ── Disabled Overlay ─────────────────────────────────────────────── */}
      {!settings.enabled && (
        <div style={{
          padding: '12px 20px',
          background: 'rgba(248, 113, 113, 0.08)',
          borderBottom: '1px solid rgba(248, 113, 113, 0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: 'var(--color-danger)',
        }}>
          <span>⏸️</span>
          FeedForge is paused — your feed is unfiltered
        </div>
      )}

      {/* ── Tab Content ──────────────────────────────────────────────────── */}
      <main style={{
        flex: 1,
        padding: '16px 20px',
        overflowY: 'auto',
        opacity: settings.enabled ? 1 : 0.5,
        pointerEvents: settings.enabled ? 'auto' : 'none',
        transition: 'opacity 0.3s ease',
      }}>
        {activeTab === 'dashboard' && (
          <Dashboard stats={stats} settings={settings} onResetStats={resetStats} />
        )}
        {activeTab === 'snooze' && (
          <SnoozePanel
            snoozes={snoozes}
            settings={settings}
            onAddSnooze={addSnooze}
            onRemoveSnooze={removeSnooze}
            onUpdateSettings={updateSettings}
          />
        )}
        {activeTab === 'caps' && (
          <ChannelCapPanel settings={settings} onUpdateSettings={updateSettings} />
        )}
        {activeTab === 'velocity' && (
          <VelocityPanel settings={settings} onUpdateSettings={updateSettings} />
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer style={{
        padding: '8px 20px',
        borderTop: '1px solid var(--color-border)',
        textAlign: 'center',
        fontSize: 10,
        color: 'var(--color-text-muted)',
      }}>
        FeedForge v0.1.0 • Custom YouTube Algorithm
      </footer>
    </div>
  );
}
