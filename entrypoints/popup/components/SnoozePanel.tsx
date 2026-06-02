import { useState } from 'react';
import type { FeedForgeSettings, SnoozeEntry } from '../../../utils/types';

interface SnoozePanelProps {
  snoozes: SnoozeEntry[];
  settings: FeedForgeSettings;
  onAddSnooze: (entry: {
    id: string;
    type: 'video' | 'channel' | 'keyword';
    label: string;
    duration?: number;
  }) => Promise<void>;
  onRemoveSnooze: (id: string, type: SnoozeEntry['type']) => Promise<void>;
  onUpdateSettings: (partial: Partial<FeedForgeSettings>) => Promise<void>;
}

const DURATION_OPTIONS = [
  { label: '5 min', value: 5 * 60 * 1000 },
  { label: '10 min', value: 10 * 60 * 1000 },
  { label: '30 min', value: 30 * 60 * 1000 },
  { label: '1 hour', value: 60 * 60 * 1000 },
  { label: '4 hours', value: 4 * 60 * 60 * 1000 },
];

export default function SnoozePanel({
  snoozes,
  settings,
  onAddSnooze,
  onRemoveSnooze,
  onUpdateSettings,
}: SnoozePanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [snoozeType, setSnoozeType] = useState<'keyword' | 'channel'>('keyword');

  const handleAddSnooze = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    await onAddSnooze({
      id: trimmed,
      type: snoozeType,
      label: trimmed,
      duration: settings.defaultSnoozeDuration,
    });

    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddSnooze();
    }
  };

  const formatTimeRemaining = (expiresAt: number) => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return 'Expired';
    const minutes = Math.ceil(remaining / 60000);
    if (minutes < 60) return `${minutes}m left`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m left`;
  };

  return (
    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Description ──────────────────────────────────────────────────── */}
      <p style={{
        fontSize: 12,
        color: 'var(--color-text-secondary)',
        lineHeight: 1.5,
      }}>
        Temporarily block channels or keywords from your feed. They'll come back
        automatically after the snooze expires.
      </p>

      {/* ── Default Duration Setting ─────────────────────────────────────── */}
      <div className="glass-card" style={{ padding: '14px' }}>
        <p style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-text-muted)',
          marginBottom: 10,
        }}>
          Default Snooze Duration
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DURATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`btn-ghost ${settings.defaultSnoozeDuration === opt.value ? '' : ''}`}
              onClick={() => onUpdateSettings({ defaultSnoozeDuration: opt.value })}
              style={{
                ...(settings.defaultSnoozeDuration === opt.value
                  ? {
                      background: 'var(--color-accent-glow)',
                      borderColor: 'var(--color-accent)',
                      color: 'var(--color-accent-light)',
                    }
                  : {}),
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Add Snooze Input ─────────────────────────────────────────────── */}
      <div className="glass-card" style={{ padding: '14px' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button
            className={`btn-ghost`}
            onClick={() => setSnoozeType('keyword')}
            style={{
              flex: 1,
              ...(snoozeType === 'keyword'
                ? {
                    background: 'rgba(244, 114, 182, 0.1)',
                    borderColor: 'var(--color-snooze)',
                    color: 'var(--color-snooze)',
                  }
                : {}),
            }}
            id="snooze-type-keyword"
          >
            🏷️ Keyword
          </button>
          <button
            className={`btn-ghost`}
            onClick={() => setSnoozeType('channel')}
            style={{
              flex: 1,
              ...(snoozeType === 'channel'
                ? {
                    background: 'rgba(244, 114, 182, 0.1)',
                    borderColor: 'var(--color-snooze)',
                    color: 'var(--color-snooze)',
                  }
                : {}),
            }}
            id="snooze-type-channel"
          >
            📺 Channel ID
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input-field"
            type="text"
            placeholder={
              snoozeType === 'keyword'
                ? 'e.g., ASMR, Gaming, mukbang...'
                : 'e.g., UCxxxxx (channel ID)...'
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            id="snooze-input"
          />
          <button
            className="btn-primary"
            onClick={handleAddSnooze}
            disabled={!inputValue.trim()}
            style={{
              opacity: inputValue.trim() ? 1 : 0.5,
              flexShrink: 0,
            }}
            id="add-snooze-btn"
          >
            + Add
          </button>
        </div>
      </div>

      {/* ── Active Snoozes ───────────────────────────────────────────────── */}
      <div>
        <p style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-text-muted)',
          marginBottom: 10,
        }}>
          Active Snoozes ({snoozes.length})
        </p>

        {snoozes.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🌙</div>
            <p style={{ fontSize: 12 }}>No active snoozes</p>
            <p style={{ fontSize: 11, marginTop: 4 }}>
              Add a keyword or channel ID above to snooze it from your feed
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {snoozes.map((snooze) => (
              <div
                key={`${snooze.type}-${snooze.id}`}
                className="snooze-tag"
                style={{ justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12 }}>
                    {snooze.type === 'keyword' ? '🏷️' : snooze.type === 'channel' ? '📺' : '🎬'}
                  </span>
                  <span style={{ fontWeight: 500 }}>{snooze.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 10,
                    color: 'var(--color-text-muted)',
                  }}>
                    {formatTimeRemaining(snooze.expiresAt)}
                  </span>
                  <button
                    className="remove-btn"
                    onClick={() => onRemoveSnooze(snooze.id, snooze.type)}
                    aria-label={`Remove snooze for ${snooze.label}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
