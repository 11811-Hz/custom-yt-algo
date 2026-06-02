import type { FilterStats, FeedForgeSettings } from '../../../utils/types';

interface DashboardProps {
  stats: FilterStats;
  settings: FeedForgeSettings;
  onResetStats: () => void;
}

export default function Dashboard({ stats, settings, onResetStats }: DashboardProps) {
  const totalFiltered = stats.snoozedCount + stats.cappedCount + stats.velocityFilteredCount;

  const statCards = [
    {
      label: 'Intercepted',
      value: stats.totalIntercepted,
      color: 'var(--color-accent)',
      bg: 'var(--color-accent-glow)',
      icon: '🔍',
    },
    {
      label: 'Snoozed',
      value: stats.snoozedCount,
      color: 'var(--color-snooze)',
      bg: 'rgba(244, 114, 182, 0.1)',
      icon: '😴',
    },
    {
      label: 'Capped',
      value: stats.cappedCount,
      color: 'var(--color-cap)',
      bg: 'rgba(56, 189, 248, 0.1)',
      icon: '🔒',
    },
    {
      label: 'Velocity',
      value: stats.velocityFilteredCount,
      color: 'var(--color-velocity)',
      bg: 'rgba(250, 204, 21, 0.1)',
      icon: '💎',
    },
  ];

  return (
    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Hero Stat ────────────────────────────────────────────────────── */}
      <div className="glass-card" style={{
        padding: '20px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background gradient */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 50% 0%, var(--color-accent-glow), transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative' }}>
          <p style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--color-text-muted)',
            marginBottom: 4,
          }}>
            Total Videos Filtered
          </p>
          <p style={{
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            background: 'linear-gradient(135deg, var(--color-accent-light), var(--color-snooze))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            lineHeight: 1.1,
          }}>
            {totalFiltered.toLocaleString()}
          </p>
          <p style={{
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            marginTop: 4,
          }}>
            from {stats.totalIntercepted.toLocaleString()} intercepted
          </p>
        </div>
      </div>

      {/* ── Stat Grid ────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
      }}>
        {statCards.map((card, i) => (
          <div
            key={card.label}
            className={`glass-card animate-fade-in-up stagger-${i + 1}`}
            style={{
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>{card.icon}</span>
              <span style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--color-text-muted)',
              }}>
                {card.label}
              </span>
            </div>
            <p style={{
              fontSize: 24,
              fontWeight: 700,
              color: card.color,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}>
              {card.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* ── Active Filters Summary ───────────────────────────────────────── */}
      <div className="glass-card" style={{ padding: '14px' }}>
        <p style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-text-muted)',
          marginBottom: 10,
        }}>
          Active Filters
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <div className="stat-badge" style={{
            background: 'rgba(244, 114, 182, 0.1)',
            color: 'var(--color-snooze)',
          }}>
            😴 Snooze: Always On
          </div>
          <div className="stat-badge" style={{
            background: settings.channelCapEnabled ? 'rgba(56, 189, 248, 0.1)' : 'rgba(85, 85, 106, 0.1)',
            color: settings.channelCapEnabled ? 'var(--color-cap)' : 'var(--color-text-muted)',
          }}>
            🔒 Caps: {settings.channelCapEnabled ? `Max ${settings.maxVideosPerChannel}` : 'Off'}
          </div>
          <div className="stat-badge" style={{
            background: settings.velocityEnabled ? 'rgba(250, 204, 21, 0.1)' : 'rgba(85, 85, 106, 0.1)',
            color: settings.velocityEnabled ? 'var(--color-velocity)' : 'var(--color-text-muted)',
          }}>
            💎 Gems: {settings.velocityEnabled ? settings.velocityMode : 'Off'}
          </div>
        </div>
      </div>

      {/* ── Reset ────────────────────────────────────────────────────────── */}
      <button
        className="btn-ghost btn-danger"
        onClick={onResetStats}
        id="reset-stats-btn"
        style={{ width: '100%' }}
      >
        🗑️ Reset Statistics
      </button>
    </div>
  );
}
