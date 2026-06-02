import type { FeedForgeSettings } from '../../../utils/types';

interface VelocityPanelProps {
  settings: FeedForgeSettings;
  onUpdateSettings: (partial: Partial<FeedForgeSettings>) => Promise<void>;
}

type VelocityMode = 'off' | 'hide-viral' | 'gems-only';

const MODES: { key: VelocityMode; label: string; icon: string; desc: string }[] = [
  { key: 'off', label: 'Off', icon: '⏹️', desc: 'No velocity filtering' },
  { key: 'hide-viral', label: 'Hide Viral', icon: '🔥', desc: 'Remove mega-viral videos above threshold' },
  { key: 'gems-only', label: 'Gems Only', icon: '💎', desc: 'Show only fast-growing, under-the-radar videos' },
];

export default function VelocityPanel({ settings, onUpdateSettings }: VelocityPanelProps) {
  const setMode = (mode: VelocityMode) => {
    onUpdateSettings({
      velocityEnabled: mode !== 'off',
      velocityMode: mode,
    });
  };

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  };

  return (
    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
        Calculate a views-per-hour metric for each video. Use it to hide mega-viral content or discover hidden gems gaining rapid traction.
      </p>

      {/* Mode selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {MODES.map((mode) => (
          <div
            key={mode.key}
            className="glass-card"
            onClick={() => setMode(mode.key)}
            style={{
              padding: '12px 14px',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12,
              borderColor: settings.velocityMode === mode.key && settings.velocityEnabled
                ? 'var(--color-accent)' : (mode.key === 'off' && !settings.velocityEnabled ? 'var(--color-accent)' : undefined),
              background: (settings.velocityMode === mode.key && settings.velocityEnabled) || (mode.key === 'off' && !settings.velocityEnabled)
                ? 'var(--color-accent-glow)' : undefined,
            }}
            id={`velocity-mode-${mode.key}`}
          >
            <span style={{ fontSize: 20 }}>{mode.icon}</span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600 }}>{mode.label}</p>
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{mode.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Thresholds - only show when a mode is active */}
      {settings.velocityEnabled && settings.velocityMode === 'hide-viral' && (
        <div className="glass-card animate-fade-in-up" style={{ padding: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>
              Viral threshold (views/hour)
            </p>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-velocity)' }}>
              {formatNumber(settings.viralThreshold)}
            </span>
          </div>
          <input type="range" min="1000" max="500000" step="1000" value={settings.viralThreshold}
            onChange={(e) => onUpdateSettings({ viralThreshold: parseInt(e.target.value, 10) })}
            id="viral-threshold-slider" style={{ width: '100%' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--color-text-muted)' }}>
            <span>1K/hr</span><span>500K/hr</span>
          </div>
        </div>
      )}

      {settings.velocityEnabled && settings.velocityMode === 'gems-only' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="glass-card animate-fade-in-up" style={{ padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>
                Min velocity (views/hour)
              </p>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-velocity)' }}>
                {formatNumber(settings.gemMinVelocity)}
              </span>
            </div>
            <input type="range" min="10" max="10000" step="10" value={settings.gemMinVelocity}
              onChange={(e) => onUpdateSettings({ gemMinVelocity: parseInt(e.target.value, 10) })}
              id="gem-velocity-slider" style={{ width: '100%' }} />
          </div>

          <div className="glass-card animate-fade-in-up stagger-1" style={{ padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>
                Max total views
              </p>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-velocity)' }}>
                {formatNumber(settings.gemMaxTotalViews)}
              </span>
            </div>
            <input type="range" min="1000" max="1000000" step="1000" value={settings.gemMaxTotalViews}
              onChange={(e) => onUpdateSettings({ gemMaxTotalViews: parseInt(e.target.value, 10) })}
              id="gem-max-views-slider" style={{ width: '100%' }} />
          </div>
        </div>
      )}
    </div>
  );
}
