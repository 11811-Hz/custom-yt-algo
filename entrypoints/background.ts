/**
 * Background Service Worker
 * 
 * Handles:
 * - Message routing between popup ↔ content scripts
 * - Storage operations (settings, snooze DB, stats)
 * - Settings change broadcasting to all YouTube tabs
 */

import { getSettings, updateSettings, addSnooze, removeSnooze, getActiveSnoozes, incrementStats, resetStats, getStats } from '@/utils/storage';
import type { ExtensionMessage, ExtensionResponse } from '@/utils/messaging';

export default defineBackground(() => {
  console.log('[FeedForge] Background service worker started');

  // ── Message Handler ─────────────────────────────────────────────────────

  browser.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse: (response: ExtensionResponse) => void) => {
      handleMessage(message)
        .then((response) => sendResponse(response))
        .catch((error) => {
          console.error('[FeedForge] Message handler error:', error);
          sendResponse({ success: false, error: String(error) });
        });

      // Return true to indicate we will respond asynchronously
      return true;
    }
  );

  // ── Storage Change Listener ─────────────────────────────────────────────
  // When settings change, notify all YouTube tabs so they can update the
  // MAIN world interceptor config

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes['feedforge-settings']) {
      broadcastSettingsChange(changes['feedforge-settings'].newValue);
    }
  });
});

async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { success: true, data: settings };
    }

    case 'GET_ACTIVE_SNOOZES': {
      const snoozes = await getActiveSnoozes();
      return { success: true, data: snoozes };
    }

    case 'GET_STATS': {
      const stats = await getStats();
      return { success: true, data: stats };
    }

    case 'UPDATE_SETTINGS': {
      const updated = await updateSettings(message.payload as Record<string, unknown>);
      return { success: true, data: updated };
    }

    case 'ADD_SNOOZE': {
      await addSnooze(message.payload);
      return { success: true };
    }

    case 'REMOVE_SNOOZE': {
      await removeSnooze(message.payload.id, message.payload.type);
      return { success: true };
    }

    case 'INCREMENT_STATS': {
      await incrementStats(message.payload);
      return { success: true };
    }

    case 'RESET_STATS': {
      await resetStats();
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}

/**
 * Broadcast settings changes to all YouTube tabs so content scripts
 * can update the MAIN world interceptor.
 */
async function broadcastSettingsChange(newSettings: unknown): Promise<void> {
  try {
    const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
    for (const tab of tabs) {
      if (tab.id) {
        browser.tabs
          .sendMessage(tab.id, {
            type: 'SETTINGS_CHANGED',
            payload: newSettings,
          })
          .catch(() => {
            // Tab may not have content script loaded yet
          });
      }
    }
  } catch (error) {
    console.warn('[FeedForge] Failed to broadcast settings change:', error);
  }
}
