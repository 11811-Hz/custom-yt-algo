/**
 * Utility functions for parsing YouTube's human-readable metadata strings
 * into machine-usable numbers.
 */

/**
 * Parse a view count string like "1,234,567 views", "10K views", "1.2M views"
 * into a raw number.
 */
export function parseViewCount(text: string | undefined): number {
  if (!text) return 0;

  // Clean the string: remove "views", commas, extra whitespace
  const cleaned = text
    .toLowerCase()
    .replace(/views?/gi, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!cleaned) return 0;

  // Handle suffixed numbers: 10K, 1.2M, 500B, etc.
  const suffixMatch = cleaned.match(/^([\d.]+)([kmbt])?$/i);
  if (suffixMatch) {
    const num = parseFloat(suffixMatch[1]);
    const suffix = suffixMatch[2]?.toLowerCase();

    switch (suffix) {
      case 'k':
        return Math.round(num * 1_000);
      case 'm':
        return Math.round(num * 1_000_000);
      case 'b':
        return Math.round(num * 1_000_000_000);
      case 't':
        return Math.round(num * 1_000_000_000_000);
      default:
        return Math.round(num);
    }
  }

  // Fallback: try direct parse
  const direct = parseFloat(cleaned);
  return isNaN(direct) ? 0 : Math.round(direct);
}

/**
 * Parse a relative time string like "2 hours ago", "3 days ago", "1 month ago"
 * into hours elapsed. Returns null if the text cannot be parsed — callers must
 * handle unknown age explicitly rather than treating it as Infinity.
 */
export function parsePublishedAgo(text: string | undefined): number | null {
  if (!text) return null; // Unknown — do NOT treat as old

  const cleaned = text.toLowerCase().trim();

  // Match patterns like "2 hours ago", "3 days ago", "Streamed 1 hour ago"
  const match = cleaned.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/);
  if (!match) {
    // Handle "just now", "moments ago"
    if (cleaned.includes('just now') || cleaned.includes('moment')) {
      return 0.01; // Avoid division by zero
    }
    return null;
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'second':
      return amount / 3600;
    case 'minute':
      return amount / 60;
    case 'hour':
      return amount;
    case 'day':
      return amount * 24;
    case 'week':
      return amount * 24 * 7;
    case 'month':
      return amount * 24 * 30;
    case 'year':
      return amount * 24 * 365;
    default:
      return null;
  }
}

/**
 * Calculate view velocity: views per hour since publication.
 * Returns null if age is unknown or zero — callers should treat null as
 * "velocity cannot be determined" (conservative: keep the video).
 */
export function calculateViewVelocity(viewCount: number, hoursAgo: number | null): number | null {
  if (hoursAgo === null || hoursAgo <= 0) return null;
  return Math.round(viewCount / hoursAgo);
}

/**
 * Extract the video title from a VideoRenderer
 */
export function extractTitle(renderer: { title?: { runs?: Array<{ text: string }> } }): string {
  return renderer.title?.runs?.map((r) => r.text).join('') ?? '';
}

/**
 * Extract channel name from a VideoRenderer
 */
export function extractChannelName(renderer: {
  longBylineText?: { runs?: Array<{ text: string }> };
  shortBylineText?: { runs?: Array<{ text: string }> };
}): string {
  return (
    renderer.longBylineText?.runs?.[0]?.text ??
    renderer.shortBylineText?.runs?.[0]?.text ??
    ''
  );
}

/**
 * Extract channel ID from a VideoRenderer
 */
export function extractChannelId(renderer: {
  longBylineText?: {
    runs?: Array<{ navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }>;
  };
  shortBylineText?: {
    runs?: Array<{ navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }>;
  };
}): string {
  return (
    renderer.longBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ??
    renderer.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ??
    ''
  );
}

/**
 * Extract view count text from a VideoRenderer
 */
export function extractViewCountText(renderer: {
  viewCountText?: { simpleText?: string; runs?: Array<{ text: string }> };
}): string {
  return (
    renderer.viewCountText?.simpleText ??
    renderer.viewCountText?.runs?.map((r) => r.text).join('') ??
    ''
  );
}
