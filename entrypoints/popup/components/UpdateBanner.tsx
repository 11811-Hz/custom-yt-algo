import { useState, useEffect } from 'react';
import type { UpdateInfo } from '../../../utils/updater';

/**
 * Update banner component — shows a dismissible notification
 * when a newer version of FeedForge is available on GitHub.
 */
export default function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    browser.runtime
      .sendMessage({ type: 'CHECK_UPDATE' })
      .then((res: { success: boolean; data?: UpdateInfo }) => {
        if (res?.data?.available) {
          setUpdate(res.data);
        }
      })
      .catch(() => { /* silently fail */ });
  }, []);

  if (!update?.available || dismissed) return null;

  return (
    <div
      id="update-banner"
      className="animate-fade-in-up"
      style={{
        margin: '0 20px',
        padding: '10px 14px',
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(168, 85, 247, 0.12))',
        border: '1px solid rgba(139, 92, 246, 0.25)',
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 12,
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>🆕</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, color: 'var(--color-accent-light)', lineHeight: 1.3 }}>
          v{update.latestVersion} available
        </p>
        <a
          href={update.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--color-accent)',
            fontSize: 11,
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          }}
        >
          Download update ↗
        </a>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update banner"
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
