import { useState, useEffect } from 'react';
import type { SchemaHealth } from '../../../utils/types';

/**
 * Schema warning banner — shows a dismissible warning when YouTube's
 * JSON format has changed and FeedForge's filters may not work correctly.
 */
export default function SchemaWarningBanner() {
  const [health, setHealth] = useState<SchemaHealth | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Load current health on mount
    browser.runtime
      .sendMessage({ type: 'GET_SCHEMA_HEALTH' })
      .then((res: { success: boolean; data?: SchemaHealth | null }) => {
        if (res?.data && res.data.status !== 'healthy') {
          setHealth(res.data);
        }
      })
      .catch(() => { /* silently fail */ });

    // Also listen for storage changes to update in real-time
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && changes['feedforge-schema-health']) {
        const newHealth = changes['feedforge-schema-health'].newValue as SchemaHealth | undefined;
        if (newHealth) {
          setHealth(newHealth);
          if (newHealth.status === 'healthy') setDismissed(false); // Auto-undismiss on recovery
        }
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  if (!health || health.status === 'healthy' || dismissed) return null;

  const isBroken = health.status === 'broken';
  const borderColor = isBroken ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.35)';
  const bgGradient = isBroken
    ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.10), rgba(185, 28, 28, 0.10))'
    : 'linear-gradient(135deg, rgba(245, 158, 11, 0.10), rgba(217, 119, 6, 0.10))';
  const textColor = isBroken ? '#f87171' : '#fbbf24';
  const icon = isBroken ? '🚨' : '⚠️';
  const title = isBroken ? 'YouTube format changed' : 'Possible format change';
  const description = isBroken
    ? "FeedForge can't find videos in YouTube's response. Filters may not work until an update is released."
    : 'Some expected fields are missing. Filters may be partially broken.';

  return (
    <div
      id="schema-warning-banner"
      className="animate-fade-in-up"
      style={{
        margin: '8px 20px 0',
        padding: '10px 14px',
        background: bgGradient,
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        fontSize: 12,
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.2 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, color: textColor, lineHeight: 1.3 }}>
          {title}
        </p>
        <p style={{
          color: 'var(--color-text-secondary)',
          fontSize: 11,
          lineHeight: 1.4,
          marginTop: 3,
        }}>
          {description}
        </p>
        {health.issues.length > 0 && (
          <div style={{
            marginTop: 6,
            padding: '4px 8px',
            background: 'rgba(0, 0, 0, 0.2)',
            borderRadius: 6,
            fontSize: 10,
            fontFamily: 'monospace',
            color: 'var(--color-text-muted)',
            maxHeight: 48,
            overflowY: 'auto',
          }}>
            {health.issues.map((issue, i) => (
              <div key={i}>• {issue}</div>
            ))}
          </div>
        )}
        <p style={{
          fontSize: 10,
          color: 'var(--color-text-muted)',
          marginTop: 4,
        }}>
          Checked {health.totalChecked} responses • {health.consecutiveFailures} consecutive failures
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss schema warning"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          padding: 4,
          fontSize: 14,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
