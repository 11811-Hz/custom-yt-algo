import type { FeedForgeSettings } from '../../../utils/types';

interface ChannelCapPanelProps {
  settings: FeedForgeSettings;
  onUpdateSettings: (partial: Partial<FeedForgeSettings>) => Promise<void>;
}

export default function ChannelCapPanel({ settings, onUpdateSettings }: ChannelCapPanelProps) {
  return (
    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
        Limit how many videos from the same channel appear in a single batch,
        forcing YouTube to dig deeper for diverse recommendations.
      </p>

      {/* Toggle */}
      <div className="glass-card" style={{ padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600 }}>Channel Caps</p>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Limit repeats per channel</p>
          </div>
        </div>
        <div
          className={`toggle-switch ${settings.channelCapEnabled ? 'active' : ''}`}
          onClick={() => onUpdateSettings({ channelCapEnabled: !settings.channelCapEnabled })}
          role="switch"
          aria-checked={settings.channelCapEnabled}
          id="channel-cap-toggle"
        />
      </div>

      {/* Slider */}
      <div className="glass-card" style={{ padding: '14px', opacity: settings.channelCapEnabled ? 1 : 0.4, pointerEvents: settings.channelCapEnabled ? 'auto' : 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>Max videos per channel</p>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-cap)' }}>{settings.maxVideosPerChannel}</span>
        </div>
        <input type="range" min="1" max="10" step="1" value={settings.maxVideosPerChannel}
          onChange={(e) => onUpdateSettings({ maxVideosPerChannel: parseInt(e.target.value, 10) })}
          id="max-videos-slider" style={{ width: '100%' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--color-text-muted)' }}>
          <span>1 (strict)</span><span>10 (relaxed)</span>
        </div>
      </div>

      {/* Explainer */}
      <div className="glass-card" style={{ padding: '14px' }}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 10 }}>How it works</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: 'var(--color-success)' }}>✓</span>
            <span>First {settings.maxVideosPerChannel} from each channel pass through</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: 'var(--color-danger)' }}>✕</span>
            <span>Extra videos from the same channel are silently removed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
