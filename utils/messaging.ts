/**
 * Message types for communication between:
 * - Content Script (ISOLATED) ↔ Background Script
 * - Popup ↔ Background Script
 * - Content Script (ISOLATED) ↔ MAIN World Script (via CustomEvents)
 */

// ─── Extension Messaging (chrome.runtime) ───────────────────────────────────

export type ExtensionMessage =
  | { type: 'GET_SETTINGS' }
  | { type: 'GET_ACTIVE_SNOOZES' }
  | { type: 'GET_STATS' }
  | { type: 'UPDATE_SETTINGS'; payload: Record<string, unknown> }
  | { type: 'ADD_SNOOZE'; payload: { id: string; type: 'video' | 'channel' | 'keyword'; label: string; duration?: number } }
  | { type: 'REMOVE_SNOOZE'; payload: { id: string; type: 'video' | 'channel' | 'keyword' } }
  | { type: 'INCREMENT_STATS'; payload: { snoozed?: number; capped?: number; velocity?: number; intercepted?: number } }
  | { type: 'RESET_STATS' }
  | { type: 'CHECK_UPDATE' }
  | { type: 'REPORT_SCHEMA_HEALTH'; payload: { status: string; issues: string[]; totalChecked: number; consecutiveFailures: number } }
  | { type: 'GET_SCHEMA_HEALTH' }
  | { type: 'PIPELINE_DATA_REQUEST' }
  | { type: 'SETTINGS_CHANGED'; payload: Record<string, unknown> };

export type ExtensionResponse = {
  success: boolean;
  data?: unknown;
  error?: string;
};

// ─── MAIN World ↔ Content Script (CustomEvents) ────────────────────────────

/** Event name for MAIN world → Content Script communication */
export const MAIN_TO_CONTENT_EVENT = 'feedforge-main-to-content';
/** Event name for Content Script → MAIN world communication */
export const CONTENT_TO_MAIN_EVENT = 'feedforge-content-to-main';

export interface MainWorldMessage {
  type: 'INTERCEPTED_RESPONSE';
  payload: {
    url: string;
    body: string; // JSON string of the response
  };
}

export interface ContentToMainMessage {
  type: 'FILTERED_RESPONSE';
  payload: {
    url: string;
    body: string; // JSON string of the filtered response
  };
}

export interface PipelineConfigMessage {
  type: 'PIPELINE_CONFIG';
  payload: {
    settings: Record<string, unknown>;
    snoozes: Array<Record<string, unknown>>;
  };
}
