import { useState, useRef, useEffect } from 'react';
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
  { label: '24 hours', value: 24 * 60 * 60 * 1000 },
];

/**
 * Curated list of popular topics / categories for quick snoozing.
 * Grouped by broad category for easy scanning.
 */
const PRESET_KEYWORDS = [
  // Gaming
  { label: 'Gaming', icon: '🎮' },
  { label: 'Minecraft', icon: '⛏️' },
  { label: 'Fortnite', icon: '🔫' },
  { label: 'League of Legends', icon: '⚔️' },
  { label: 'GTA', icon: '🚗' },
  { label: 'Roblox', icon: '🧱' },
  { label: 'Valorant', icon: '🎯' },
  // Entertainment
  { label: 'ASMR', icon: '🎧' },
  { label: 'Mukbang', icon: '🍜' },
  { label: 'Reaction', icon: '😲' },
  { label: 'Prank', icon: '🤡' },
  { label: 'Drama', icon: '🎭' },
  { label: 'Shorts', icon: '📱' },
  { label: 'Podcast', icon: '🎙️' },
  // Knowledge / Tech
  { label: 'AI', icon: '🤖' },
  { label: 'Crypto', icon: '₿' },
  { label: 'NFT', icon: '🖼️' },
  { label: 'Tutorial', icon: '📚' },
  { label: 'Programming', icon: '💻' },
  // News / Social
  { label: 'Politics', icon: '🏛️' },
  { label: 'News', icon: '📰' },
  { label: 'Debate', icon: '🗣️' },
  { label: 'True Crime', icon: '🔍' },
  // Lifestyle
  { label: 'Fitness', icon: '💪' },
  { label: 'Cooking', icon: '👨‍🍳' },
  { label: 'Vlog', icon: '📹' },
  { label: 'Unboxing', icon: '📦' },
  // Music
  { label: 'K-Pop', icon: '🎵' },
  { label: 'Rap', icon: '🎤' },
  { label: 'Lo-Fi', icon: '🌙' },
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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter presets by search input
  const filteredPresets = PRESET_KEYWORDS.filter((preset) => {
    const search = inputValue.trim().toLowerCase();
    if (!search) return true;
    return preset.label.toLowerCase().includes(search);
  });

  // Check if a keyword is already snoozed
  const isAlreadySnoozed = (keyword: string) =>
    snoozes.some(
      (s) => s.id.toLowerCase() === keyword.toLowerCase() && s.type === 'keyword'
    );

  const handleAddSnooze = async (value?: string) => {
    const trimmed = (value ?? inputValue).trim();
    if (!trimmed) return;

    await onAddSnooze({
      id: trimmed,
      type: snoozeType,
      label: trimmed,
      duration: settings.defaultSnoozeDuration,
    });

    setInputValue('');
    setIsDropdownOpen(false);
  };

  const handlePresetClick = async (preset: { label: string }) => {
    if (isAlreadySnoozed(preset.label)) return;
    await handleAddSnooze(preset.label);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddSnooze();
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
    }
  };

  const handleInputFocus = () => {
    if (snoozeType === 'keyword') {
      setIsDropdownOpen(true);
    }
  };

  const formatTimeRemaining = (expiresAt: number) => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return 'Expired';
    const minutes = Math.ceil(remaining / 60000);
    if (minutes < 60) return `${minutes}m left`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    if (hours < 24) return `${hours}h ${remainingMins}m left`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h left`;
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
              className={`btn-ghost`}
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
            onClick={() => {
              setSnoozeType('keyword');
              setIsDropdownOpen(true);
            }}
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
            🏷️ Topic / Keyword
          </button>
          <button
            className={`btn-ghost`}
            onClick={() => {
              setSnoozeType('channel');
              setIsDropdownOpen(false);
            }}
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

        {/* Combobox: input + dropdown */}
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              className="input-field"
              type="text"
              placeholder={
                snoozeType === 'keyword'
                  ? 'Search topics or type custom keyword...'
                  : 'Paste channel ID and press Enter...'
              }
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (snoozeType === 'keyword') setIsDropdownOpen(true);
              }}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              id="snooze-input"
              autoComplete="off"
              role="combobox"
              aria-expanded={isDropdownOpen}
              aria-haspopup="listbox"
              style={{ paddingRight: snoozeType === 'keyword' ? 28 : undefined }}
            />
            {/* Dropdown chevron for keyword mode */}
            {snoozeType === 'keyword' && (
              <button
                onClick={() => {
                  setIsDropdownOpen(!isDropdownOpen);
                  inputRef.current?.focus();
                }}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: `translateY(-50%) rotate(${isDropdownOpen ? '180deg' : '0deg'})`,
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: 10,
                  padding: 4,
                  transition: 'transform 0.2s ease',
                }}
                aria-label="Toggle topic list"
                tabIndex={-1}
              >
                ▼
              </button>
            )}
          </div>

          {/* ── Dropdown List ──────────────────────────────────────────────── */}
          {isDropdownOpen && snoozeType === 'keyword' && (
            <div
              ref={dropdownRef}
              role="listbox"
              className="combobox-dropdown"
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                right: 0,
                maxHeight: 200,
                overflowY: 'auto',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-active)',
                borderRadius: 10,
                zIndex: 50,
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
              }}
            >
              {/* Custom keyword option (when user has typed something not in presets) */}
              {inputValue.trim() &&
                !filteredPresets.some(
                  (p) => p.label.toLowerCase() === inputValue.trim().toLowerCase()
                ) && (
                  <button
                    onClick={() => handleAddSnooze()}
                    className="combobox-option"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      background: 'none',
                      border: 'none',
                      borderBottom: '1px solid var(--color-border)',
                      color: 'var(--color-accent-light)',
                      fontSize: 12,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    role="option"
                  >
                    <span style={{ fontSize: 14 }}>✨</span>
                    <span>
                      Add custom: <strong>"{inputValue.trim()}"</strong>
                    </span>
                  </button>
                )}

              {filteredPresets.length === 0 && !inputValue.trim() && (
                <div style={{
                  padding: '16px 12px',
                  textAlign: 'center',
                  color: 'var(--color-text-muted)',
                  fontSize: 12,
                }}>
                  No matching topics
                </div>
              )}

              {filteredPresets.map((preset) => {
                const alreadySnoozed = isAlreadySnoozed(preset.label);
                return (
                  <button
                    key={preset.label}
                    onClick={() => handlePresetClick(preset)}
                    disabled={alreadySnoozed}
                    className="combobox-option"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '7px 12px',
                      background: 'none',
                      border: 'none',
                      borderBottom: '1px solid var(--color-border)',
                      color: alreadySnoozed
                        ? 'var(--color-text-muted)'
                        : 'var(--color-text-primary)',
                      fontSize: 12,
                      fontFamily: 'inherit',
                      cursor: alreadySnoozed ? 'default' : 'pointer',
                      textAlign: 'left',
                      opacity: alreadySnoozed ? 0.5 : 1,
                    }}
                    role="option"
                    aria-selected={alreadySnoozed}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>
                        {preset.icon}
                      </span>
                      <span>{preset.label}</span>
                    </span>
                    {alreadySnoozed && (
                      <span style={{
                        fontSize: 10,
                        color: 'var(--color-snooze)',
                        fontWeight: 600,
                      }}>
                        SNOOZED
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
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
              Pick a topic above or type a custom keyword to snooze it
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
