/**
 * Channel Cap Filter — limits the number of videos from any single channel
 * within a single response batch.
 * 
 * If a channel exceeds the user-defined threshold (e.g., max 2 per batch),
 * excess videos are silently dropped, forcing diversity.
 */

import type { VideoRenderer } from '../types';
import { extractChannelId, extractChannelName } from '../parsers';

export interface ChannelCapFilterResult {
  kept: VideoRenderer[];
  removed: number;
}

/**
 * Apply per-channel cap to a batch of videos.
 * @param videos - Array of video renderers from YouTube's response
 * @param maxPerChannel - Maximum videos allowed from one channel per batch
 */
export function applyChannelCapFilter(
  videos: VideoRenderer[],
  maxPerChannel: number
): ChannelCapFilterResult {
  if (maxPerChannel <= 0) {
    return { kept: videos, removed: 0 };
  }

  const channelCounts = new Map<string, number>();
  let removed = 0;

  const kept = videos.filter((video) => {
    // Use channelId if available, fall back to channel name
    const channelKey = extractChannelId(video) || extractChannelName(video);
    if (!channelKey) return true; // Can't identify channel, keep it

    const currentCount = channelCounts.get(channelKey) ?? 0;

    if (currentCount >= maxPerChannel) {
      removed++;
      return false;
    }

    channelCounts.set(channelKey, currentCount + 1);
    return true;
  });

  return { kept, removed };
}
