/**
 * Snooze Filter — removes videos/channels that are temporarily snoozed.
 * 
 * Checks each video against the snooze database. Matches by:
 * - videoId (exact video snooze)
 * - channelId (entire channel snooze)
 * - keyword in title (keyword snooze)
 */

import type { SnoozeEntry, VideoRenderer } from '../types';
import { extractTitle, extractChannelId } from '../parsers';

export interface SnoozeFilterResult {
  kept: VideoRenderer[];
  removed: number;
}

/**
 * Filter out videos that match active snooze entries.
 */
export function applySnoozeFilter(
  videos: VideoRenderer[],
  activeSnoozes: SnoozeEntry[]
): SnoozeFilterResult {
  if (activeSnoozes.length === 0) {
    return { kept: videos, removed: 0 };
  }

  const now = Date.now();

  // Build lookup sets for O(1) matching
  const snoozedVideoIds = new Set<string>();
  const snoozedChannelIds = new Set<string>();
  const snoozedKeywords: string[] = [];

  for (const entry of activeSnoozes) {
    if (entry.expiresAt <= now) continue; // Skip expired

    switch (entry.type) {
      case 'video':
        snoozedVideoIds.add(entry.id);
        break;
      case 'channel':
        snoozedChannelIds.add(entry.id);
        break;
      case 'keyword':
        snoozedKeywords.push(entry.id.toLowerCase());
        break;
    }
  }

  let removed = 0;
  const kept = videos.filter((video) => {
    // Check video ID
    if (video.videoId && snoozedVideoIds.has(video.videoId)) {
      removed++;
      return false;
    }

    // Check channel ID
    const channelId = extractChannelId(video);
    if (channelId && snoozedChannelIds.has(channelId)) {
      removed++;
      return false;
    }

    // Check keywords in title
    if (snoozedKeywords.length > 0) {
      const title = extractTitle(video).toLowerCase();
      for (const keyword of snoozedKeywords) {
        if (title.includes(keyword)) {
          removed++;
          return false;
        }
      }
    }

    return true;
  });

  return { kept, removed };
}
