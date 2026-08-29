/**
 * View Velocity Filter — surfaces "hidden gems" or hides mega-viral content
 * based on a views-per-hour metric.
 * 
 * Modes:
 * - "hide-viral": Remove videos above the viral threshold
 * - "gems-only": Keep only videos with high velocity but low total views
 * - "off": No filtering
 */

import type { FeedForgeSettings, VideoRenderer } from '../types';
import {
  parseViewCount,
  parsePublishedAgo,
  calculateViewVelocity,
  extractViewCountText,
} from '../parsers';

export interface VelocityFilterResult {
  kept: VideoRenderer[];
  removed: number;
}

/**
 * Apply view velocity filtering based on user mode.
 */
export function applyVelocityFilter(
  videos: VideoRenderer[],
  settings: Pick<
    FeedForgeSettings,
    'velocityMode' | 'viralThreshold' | 'gemMinVelocity' | 'gemMaxTotalViews'
  >
): VelocityFilterResult {
  if (settings.velocityMode === 'off') {
    return { kept: videos, removed: 0 };
  }

  let removed = 0;

  const kept = videos.filter((video) => {
    const viewCountText = extractViewCountText(video);
    const viewCount = parseViewCount(viewCountText);
    const hoursAgo = parsePublishedAgo(video.publishedTimeText?.simpleText);
    const velocity = calculateViewVelocity(viewCount, hoursAgo);

    // If velocity is null (unknown age), keep the video conservatively.
    // We don't want to silently filter videos just because their age
    // couldn't be parsed.
    if (velocity === null) return true;

    switch (settings.velocityMode) {
      case 'hide-viral':
        // Remove videos with velocity above threshold
        if (velocity > settings.viralThreshold) {
          removed++;
          return false;
        }
        return true;

      case 'gems-only':
        // Keep only videos with decent velocity but low total views
        if (
          velocity >= settings.gemMinVelocity &&
          viewCount <= settings.gemMaxTotalViews
        ) {
          return true;
        }
        removed++;
        return false;

      default:
        return true;
    }
  });

  return { kept, removed };
}

