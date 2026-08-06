/**
 * Core type definitions for YouTube recommendation JSON payloads.
 * 
 * YouTube's internal API returns deeply nested protobuf-like JSON.
 * These interfaces map the subset we need for filtering.
 */

// ─── YouTube API Payload Types ──────────────────────────────────────────────

/** Top-level response from YouTube's /youtubei/v1/browse or /next endpoints */
export interface YouTubeApiResponse {
  contents?: {
    twoColumnBrowseResultsRenderer?: {
      tabs?: YouTubeTab[];
    };
    twoColumnWatchNextResults?: {
      secondaryResults?: {
        secondaryResults?: {
          results?: YouTubeResultItem[];
        };
      };
    };
  };
  onResponseReceivedActions?: OnResponseReceivedAction[];
  onResponseReceivedEndpoints?: OnResponseReceivedAction[];
  [key: string]: unknown;
}

export interface YouTubeTab {
  tabRenderer?: {
    content?: {
      richGridRenderer?: {
        contents?: RichGridItem[];
      };
    };
  };
}

export interface OnResponseReceivedAction {
  appendContinuationItemsAction?: {
    continuationItems?: RichGridItem[];
  };
  reloadContinuationItemsCommand?: {
    continuationItems?: RichGridItem[];
  };
  [key: string]: unknown;
}

export interface RichGridItem {
  richItemRenderer?: {
    content?: {
      videoRenderer?: VideoRenderer;
      reelItemRenderer?: ReelItemRenderer;
    };
  };
  richSectionRenderer?: unknown;
  continuationItemRenderer?: unknown;
  [key: string]: unknown;
}

export interface YouTubeResultItem {
  compactVideoRenderer?: VideoRenderer;
  [key: string]: unknown;
}

/** The main video data object we intercept and filter */
export interface VideoRenderer {
  videoId?: string;
  title?: {
    runs?: Array<{ text: string }>;
    accessibility?: { accessibilityData?: { label?: string } };
  };
  longBylineText?: {
    runs?: Array<{
      text: string;
      navigationEndpoint?: {
        browseEndpoint?: { browseId?: string };
      };
    }>;
  };
  shortBylineText?: {
    runs?: Array<{
      text: string;
      navigationEndpoint?: {
        browseEndpoint?: { browseId?: string };
      };
    }>;
  };
  viewCountText?: {
    simpleText?: string; // e.g., "1,234,567 views"
    runs?: Array<{ text: string }>; // e.g., "10K views"
  };
  publishedTimeText?: {
    simpleText?: string; // e.g., "2 hours ago"
  };
  lengthText?: {
    simpleText?: string; // e.g., "12:34"
  };
  channelThumbnailSupportedRenderers?: unknown;
  thumbnailOverlays?: unknown[];
  [key: string]: unknown;
}

export interface ReelItemRenderer {
  videoId?: string;
  headline?: { simpleText?: string };
  viewCountText?: { simpleText?: string };
  [key: string]: unknown;
}

// ─── Extension Internal Types ───────────────────────────────────────────────

/** Normalized video object extracted from YouTube's nested JSON */
export interface NormalizedVideo {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  viewCount: number;
  publishedAgo: string;
  viewVelocity: number; // views per hour
}

/** Snooze entry stored in Chrome Storage */
export interface SnoozeEntry {
  id: string; // videoId, channelId, or category keyword
  type: 'video' | 'channel' | 'keyword';
  label: string; // human-readable label
  snoozedAt: number; // timestamp ms
  duration: number; // duration ms (default: 5-10 min)
  expiresAt: number; // snoozedAt + duration
}

/** User settings persisted to Chrome Storage */
export interface FeedForgeSettings {
  enabled: boolean;

  // Snooze
  defaultSnoozeDuration: number; // ms, default 5 min

  // Channel Caps
  channelCapEnabled: boolean;
  maxVideosPerChannel: number; // default 2

  // View Velocity
  velocityEnabled: boolean;
  velocityMode: 'hide-viral' | 'gems-only' | 'off';
  viralThreshold: number; // views/hour above which = viral
  gemMinVelocity: number; // minimum views/hour to qualify as a "gem"
  gemMaxTotalViews: number; // max total views to still count as "hidden"
}

/** Stats tracked per session */
export interface FilterStats {
  totalIntercepted: number;
  snoozedCount: number;
  cappedCount: number;
  velocityFilteredCount: number;
  lastUpdated: number;
}

/** Default settings */
export const DEFAULT_SETTINGS: FeedForgeSettings = {
  enabled: true,
  defaultSnoozeDuration: 5 * 60 * 1000, // 5 minutes
  channelCapEnabled: true,
  maxVideosPerChannel: 2,
  velocityEnabled: false,
  velocityMode: 'off',
  viralThreshold: 50000, // 50k views/hour
  gemMinVelocity: 100, // 100 views/hour
  gemMaxTotalViews: 100000, // 100k total views
};

/** Schema health status — detects when YouTube changes their JSON format */
export interface SchemaHealth {
  status: 'healthy' | 'degraded' | 'broken';
  issues: string[];
  totalChecked: number;
  consecutiveFailures: number;
  lastCheckedAt: number;
}

