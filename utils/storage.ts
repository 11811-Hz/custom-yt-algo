/**
 * Chrome Storage wrapper for FeedForge settings and snooze database.
 * Uses chrome.storage.local directly for simplicity and compatibility.
 */

import type { FeedForgeSettings, SnoozeEntry, FilterStats, SchemaHealth } from './types';
import { DEFAULT_SETTINGS } from './types';

// ─── Storage Keys ───────────────────────────────────────────────────────────

const SETTINGS_KEY = 'feedforge-settings';
const SNOOZE_DB_KEY = 'feedforge-snooze-db';
const STATS_KEY = 'feedforge-stats';
const SCHEMA_HEALTH_KEY = 'feedforge-schema-health';

// ─── Default Stats ──────────────────────────────────────────────────────────

const DEFAULT_STATS: FilterStats = {
  totalIntercepted: 0,
  snoozedCount: 0,
  cappedCount: 0,
  velocityFilteredCount: 0,
  lastUpdated: Date.now(),
};

// ─── Generic Storage Helpers ────────────────────────────────────────────────

async function getItem<T>(key: string, fallback: T): Promise<T> {
  const result = await browser.storage.local.get(key);
  return (result[key] as T) ?? fallback;
}

async function setItem<T>(key: string, value: T): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

// ─── Settings ───────────────────────────────────────────────────────────────

/** Get current settings, merged with defaults for any missing fields */
export async function getSettings(): Promise<FeedForgeSettings> {
  const stored = await getItem<Partial<FeedForgeSettings>>(SETTINGS_KEY, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** Update settings (partial update) */
export async function updateSettings(
  partial: Partial<FeedForgeSettings>
): Promise<FeedForgeSettings> {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await setItem(SETTINGS_KEY, updated);
  return updated;
}

// ─── Snooze Database ────────────────────────────────────────────────────────

/** Add a snooze entry */
export async function addSnooze(
  entry: Omit<SnoozeEntry, 'snoozedAt' | 'expiresAt'>
): Promise<void> {
  const settings = await getSettings();
  const now = Date.now();
  const duration = entry.duration || settings.defaultSnoozeDuration;

  const fullEntry: SnoozeEntry = {
    ...entry,
    duration,
    snoozedAt: now,
    expiresAt: now + duration,
  };

  const db = await getItem<SnoozeEntry[]>(SNOOZE_DB_KEY, []);
  // Replace existing entry for same id+type, or add new
  const filtered = db.filter(
    (e) => !(e.id === fullEntry.id && e.type === fullEntry.type)
  );
  filtered.push(fullEntry);
  await setItem(SNOOZE_DB_KEY, filtered);
}

/** Remove a snooze entry */
export async function removeSnooze(
  id: string,
  type: SnoozeEntry['type']
): Promise<void> {
  const db = await getItem<SnoozeEntry[]>(SNOOZE_DB_KEY, []);
  await setItem(
    SNOOZE_DB_KEY,
    db.filter((e) => !(e.id === id && e.type === type))
  );
}

/** Get all active (non-expired) snooze entries, pruning expired ones */
export async function getActiveSnoozes(): Promise<SnoozeEntry[]> {
  const db = await getItem<SnoozeEntry[]>(SNOOZE_DB_KEY, []);
  const now = Date.now();
  const active = db.filter((e) => e.expiresAt > now);

  // Prune expired entries
  if (active.length !== db.length) {
    await setItem(SNOOZE_DB_KEY, active);
  }

  return active;
}

// ─── Stats ──────────────────────────────────────────────────────────────────

/** Get current stats */
export async function getStats(): Promise<FilterStats> {
  return getItem<FilterStats>(STATS_KEY, DEFAULT_STATS);
}

/** Increment stat counters */
export async function incrementStats(increments: {
  snoozed?: number;
  capped?: number;
  velocity?: number;
  intercepted?: number;
}): Promise<void> {
  const current = await getStats();
  await setItem(STATS_KEY, {
    totalIntercepted:
      current.totalIntercepted + (increments.intercepted ?? 0),
    snoozedCount: current.snoozedCount + (increments.snoozed ?? 0),
    cappedCount: current.cappedCount + (increments.capped ?? 0),
    velocityFilteredCount:
      current.velocityFilteredCount + (increments.velocity ?? 0),
    lastUpdated: Date.now(),
  });
}

/** Reset all stats */
export async function resetStats(): Promise<void> {
  await setItem(STATS_KEY, { ...DEFAULT_STATS, lastUpdated: Date.now() });
}

// ─── Schema Health ──────────────────────────────────────────────────────────

/** Get cached schema health status */
export async function getSchemaHealth(): Promise<SchemaHealth | null> {
  return getItem<SchemaHealth | null>(SCHEMA_HEALTH_KEY, null);
}

/** Store schema health status and return it */
export async function setSchemaHealth(health: SchemaHealth): Promise<SchemaHealth> {
  await setItem(SCHEMA_HEALTH_KEY, health);
  return health;
}
