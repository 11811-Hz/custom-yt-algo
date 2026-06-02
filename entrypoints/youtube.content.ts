/**
 * YouTube Content Script (ISOLATED world)
 * 
 * Responsibilities:
 * 1. Inject the MAIN world interceptor script into YouTube's page context
 * 2. Bridge communication between MAIN world ↔ extension APIs
 * 3. Push settings/snooze config to the interceptor via CustomEvents
 * 4. Relay filter stats to the background script
 */

import { CONTENT_TO_MAIN_EVENT, MAIN_TO_CONTENT_EVENT } from '@/utils/messaging';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_start',

  async main(ctx) {
    console.log('[FeedForge] Content script loaded on YouTube');

    // ── Step 1: Inject the MAIN world interceptor ──────────────────────────
    await injectScript('/youtube-interceptor.js', {
      keepInDom: true,
    });
    console.log('[FeedForge] MAIN world interceptor injected');

    // ── Step 2: Fetch initial settings and push to MAIN world ─────────────
    await pushConfigToMainWorld();

    // ── Step 3: Listen for filter stats from MAIN world ───────────────────
    window.addEventListener(MAIN_TO_CONTENT_EVENT, ((event: CustomEvent) => {
      const data = event.detail;
      if (data?.type === 'FILTER_STATS' && data?.payload) {
        // Relay stats to background script
        browser.runtime.sendMessage({
          type: 'INCREMENT_STATS',
          payload: {
            intercepted: data.payload.filtered,
            snoozed: 0,
            capped: 0,
            velocity: 0,
          },
        }).catch(() => {
          // Background may not be ready yet
        });
      }
    }) as EventListener);

    // ── Step 4: Listen for settings changes from background ───────────────
    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'SETTINGS_CHANGED') {
        pushConfigToMainWorld();
      }
    });

    // ── Step 5: Re-push config on SPA navigation ─────────────────────────
    // YouTube is a SPA, so we need to handle navigation changes
    ctx.addEventListener(window, 'yt-navigate-finish', () => {
      pushConfigToMainWorld();
    });

    // Also listen for storage changes
    browser.storage.onChanged.addListener(() => {
      pushConfigToMainWorld();
    });
  },
});

/**
 * Fetch current settings + active snoozes from the background script
 * and push them to the MAIN world interceptor via CustomEvent.
 */
async function pushConfigToMainWorld(): Promise<void> {
  try {
    const [settingsResponse, snoozesResponse] = await Promise.all([
      browser.runtime.sendMessage({ type: 'GET_SETTINGS' }),
      browser.runtime.sendMessage({ type: 'GET_ACTIVE_SNOOZES' }),
    ]);

    const settings = settingsResponse?.data ?? {};
    const snoozes = snoozesResponse?.data ?? [];

    window.dispatchEvent(
      new CustomEvent(CONTENT_TO_MAIN_EVENT, {
        detail: {
          type: 'PIPELINE_CONFIG',
          payload: { settings, snoozes },
        },
      })
    );
  } catch (error) {
    console.warn('[FeedForge] Failed to push config to MAIN world:', error);
  }
}
