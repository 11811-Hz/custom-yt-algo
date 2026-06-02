/**
 * Filter Pipeline — orchestrates the sequential execution of all filters
 * on a batch of YouTube video renderers.
 * 
 * Pipeline order: Snooze → Channel Caps → View Velocity
 * Each stage receives the output of the previous stage.
 */

import type { FeedForgeSettings, SnoozeEntry, VideoRenderer } from './types';
import { applySnoozeFilter } from './filters/snooze-filter';
import { applyChannelCapFilter } from './filters/channel-cap-filter';
import { applyVelocityFilter } from './filters/velocity-filter';

export interface PipelineResult {
  videos: VideoRenderer[];
  stats: {
    inputCount: number;
    outputCount: number;
    snoozed: number;
    capped: number;
    velocityFiltered: number;
  };
}

/**
 * Run the full filter pipeline on a batch of videos.
 */
export function runPipeline(
  videos: VideoRenderer[],
  settings: FeedForgeSettings,
  activeSnoozes: SnoozeEntry[]
): PipelineResult {
  const inputCount = videos.length;
  let current = videos;

  // Stage 1: Snooze filter
  const snoozeResult = applySnoozeFilter(current, activeSnoozes);
  current = snoozeResult.kept;

  // Stage 2: Channel caps
  let cappedCount = 0;
  if (settings.channelCapEnabled) {
    const capResult = applyChannelCapFilter(current, settings.maxVideosPerChannel);
    current = capResult.kept;
    cappedCount = capResult.removed;
  }

  // Stage 3: View velocity
  let velocityCount = 0;
  if (settings.velocityEnabled && settings.velocityMode !== 'off') {
    const velocityResult = applyVelocityFilter(current, settings);
    current = velocityResult.kept;
    velocityCount = velocityResult.removed;
  }

  return {
    videos: current,
    stats: {
      inputCount,
      outputCount: current.length,
      snoozed: snoozeResult.removed,
      capped: cappedCount,
      velocityFiltered: velocityCount,
    },
  };
}
