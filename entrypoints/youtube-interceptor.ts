/**
 * MAIN World Interceptor Script
 * 
 * This script is injected into YouTube's page context (MAIN world) to
 * monkey-patch `window.fetch`. It intercepts YouTube's API responses,
 * sends the raw JSON to the content script for filtering, and passes
 * the filtered result back to YouTube's frontend.
 * 
 * NOTE: This runs in the page's execution context, NOT in the extension's
 * isolated world. It has no access to chrome.* APIs.
 */

export default defineUnlistedScript(() => {
  const YOUTUBE_API_PATTERNS = [
    '/youtubei/v1/browse',
    '/youtubei/v1/next',
    '/youtubei/v1/search',
    '/youtubei/v1/reel/reel_watch_sequence',
  ];

  // ─── State ──────────────────────────────────────────────────────────────────

  /** Pipeline config received from the content script */
  let pipelineConfig: {
    settings: Record<string, unknown>;
    snoozes: Array<Record<string, unknown>>;
  } | null = null;

  // ─── Listen for config updates from content script ──────────────────────────

  window.addEventListener('feedforge-content-to-main', ((event: CustomEvent) => {
    const data = event.detail;
    if (data?.type === 'PIPELINE_CONFIG') {
      pipelineConfig = data.payload;
      console.log('[FeedForge] Pipeline config updated', pipelineConfig);
    }
  }) as EventListener);

  // ─── Fetch Monkey-Patch ─────────────────────────────────────────────────────

  const originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : '';

    // Check if this is a YouTube API request we care about
    const isTargetRequest = YOUTUBE_API_PATTERNS.some((pattern) => url.includes(pattern));

    if (!isTargetRequest) {
      return originalFetch.call(this, input, init);
    }

    try {
      // Call the original fetch
      const response = await originalFetch.call(this, input, init);

      // Clone the response so we can read the body without consuming it
      const clone = response.clone();
      const responseBody = await clone.json();

      // Process the response through our pipeline
      const filteredBody = processResponse(url, responseBody);

      // Create a new response with the filtered body
      return new Response(JSON.stringify(filteredBody), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      console.error('[FeedForge] Error intercepting response:', error);
      // On error, fall back to original
      return originalFetch.call(this, input, init);
    }
  };

  // ─── Response Processing ────────────────────────────────────────────────────

  function processResponse(url: string, body: Record<string, unknown>): Record<string, unknown> {
    if (!pipelineConfig) {
      // No config yet, pass through unfiltered
      return body;
    }

    const settings = pipelineConfig.settings as {
      enabled?: boolean;
      channelCapEnabled?: boolean;
      maxVideosPerChannel?: number;
      velocityEnabled?: boolean;
      velocityMode?: string;
      viralThreshold?: number;
      gemMinVelocity?: number;
      gemMaxTotalViews?: number;
    };

    if (!settings?.enabled) {
      return body;
    }

    const snoozes = pipelineConfig.snoozes as Array<{
      id: string;
      type: 'video' | 'channel' | 'keyword';
      expiresAt: number;
    }>;

    let totalFiltered = 0;

    // Process the various response structures
    const processed = structuredClone(body);

    // ── Browse results (home page) ──────────────────────────────────────────
    const tabs = (processed as Record<string, unknown>)?.contents
      ? ((processed as Record<string, unknown>).contents as Record<string, unknown>)
          ?.twoColumnBrowseResultsRenderer
        ? (
            ((processed as Record<string, unknown>).contents as Record<string, unknown>)
              .twoColumnBrowseResultsRenderer as Record<string, unknown>
          )?.tabs as Array<Record<string, unknown>> | undefined
        : undefined
      : undefined;

    if (tabs) {
      for (const tab of tabs) {
        const tabRenderer = tab?.tabRenderer as Record<string, unknown> | undefined;
        const richGrid = tabRenderer?.content
          ? (tabRenderer.content as Record<string, unknown>)?.richGridRenderer as
              | Record<string, unknown>
              | undefined
          : undefined;
        if (richGrid?.contents) {
          const result = filterRichGridItems(
            richGrid.contents as Array<Record<string, unknown>>,
            settings,
            snoozes
          );
          richGrid.contents = result.items;
          totalFiltered += result.filtered;
        }
      }
    }

    // ── Continuation items (infinite scroll) ────────────────────────────────
    const actions = (
      (processed as Record<string, unknown>).onResponseReceivedActions ??
      (processed as Record<string, unknown>).onResponseReceivedEndpoints
    ) as Array<Record<string, unknown>> | undefined;

    if (actions) {
      for (const action of actions) {
        const continuationItems = (
          action?.appendContinuationItemsAction ??
          action?.reloadContinuationItemsCommand
        ) as Record<string, unknown> | undefined;

        if (continuationItems?.continuationItems) {
          const result = filterRichGridItems(
            continuationItems.continuationItems as Array<Record<string, unknown>>,
            settings,
            snoozes
          );
          continuationItems.continuationItems = result.items;
          totalFiltered += result.filtered;
        }
      }
    }

    // ── Watch next sidebar ──────────────────────────────────────────────────
    const watchNext = (processed as Record<string, unknown>)?.contents
      ? ((processed as Record<string, unknown>).contents as Record<string, unknown>)
          ?.twoColumnWatchNextResults
        ? (
            ((processed as Record<string, unknown>).contents as Record<string, unknown>)
              .twoColumnWatchNextResults as Record<string, unknown>
          )?.secondaryResults
          ? (
              (
                ((processed as Record<string, unknown>).contents as Record<string, unknown>)
                  .twoColumnWatchNextResults as Record<string, unknown>
              ).secondaryResults as Record<string, unknown>
            )?.secondaryResults as Record<string, unknown> | undefined
          : undefined
        : undefined
      : undefined;

    if (watchNext?.results) {
      const result = filterCompactVideoItems(
        watchNext.results as Array<Record<string, unknown>>,
        settings,
        snoozes
      );
      watchNext.results = result.items;
      totalFiltered += result.filtered;
    }

    if (totalFiltered > 0) {
      console.log(`[FeedForge] Filtered ${totalFiltered} videos from response`);

      // Notify content script of stats
      window.dispatchEvent(
        new CustomEvent('feedforge-main-to-content', {
          detail: {
            type: 'FILTER_STATS',
            payload: { filtered: totalFiltered },
          },
        })
      );
    }

    return processed;
  }

  // ─── Filter Helpers (inline, since we can't import modules in MAIN world) ──

  function filterRichGridItems(
    items: Array<Record<string, unknown>>,
    settings: Record<string, unknown>,
    snoozes: Array<{ id: string; type: string; expiresAt: number }>
  ): { items: Array<Record<string, unknown>>; filtered: number } {
    // Extract video renderers, apply filters, reconstruct
    const now = Date.now();
    const activeSnoozes = snoozes.filter((s) => s.expiresAt > now);
    const channelCounts = new Map<string, number>();
    const maxPerChannel = (settings.maxVideosPerChannel as number) ?? 2;
    let filtered = 0;

    const result = items.filter((item) => {
      const richItem = item?.richItemRenderer as Record<string, unknown> | undefined;
      if (!richItem) return true; // Not a video item, keep (e.g. section, continuation)

      const content = richItem.content as Record<string, unknown> | undefined;
      const video = content?.videoRenderer as Record<string, unknown> | undefined;
      if (!video) return true; // Not a standard video

      // ── Snooze check ────────────────────────────────────────────────────
      if (activeSnoozes.length > 0) {
        const videoId = video.videoId as string | undefined;
        const channelId = getChannelId(video);
        const title = getTitle(video).toLowerCase();

        for (const snooze of activeSnoozes) {
          if (
            (snooze.type === 'video' && snooze.id === videoId) ||
            (snooze.type === 'channel' && snooze.id === channelId) ||
            (snooze.type === 'keyword' && title.includes(snooze.id.toLowerCase()))
          ) {
            filtered++;
            return false;
          }
        }
      }

      // ── Channel cap check ─────────────────────────────────────────────
      if (settings.channelCapEnabled) {
        const channelKey = getChannelId(video) || getChannelName(video);
        if (channelKey) {
          const count = channelCounts.get(channelKey) ?? 0;
          if (count >= maxPerChannel) {
            filtered++;
            return false;
          }
          channelCounts.set(channelKey, count + 1);
        }
      }

      // ── Velocity check ────────────────────────────────────────────────
      if (settings.velocityEnabled && settings.velocityMode !== 'off') {
        const viewCount = parseViews(getViewCountText(video));
        const hoursAgo = parseAge(
          (video.publishedTimeText as Record<string, unknown>)?.simpleText as string | undefined
        );
        const velocity = hoursAgo > 0 ? viewCount / hoursAgo : 0;

        if (settings.velocityMode === 'hide-viral') {
          if (velocity > ((settings.viralThreshold as number) ?? 50000)) {
            filtered++;
            return false;
          }
        } else if (settings.velocityMode === 'gems-only') {
          const meetsVelocity = velocity >= ((settings.gemMinVelocity as number) ?? 100);
          const isHidden = viewCount <= ((settings.gemMaxTotalViews as number) ?? 100000);
          const unknownAge = viewCount === 0 && hoursAgo === Infinity;
          if (!unknownAge && !(meetsVelocity && isHidden)) {
            filtered++;
            return false;
          }
        }
      }

      return true;
    });

    return { items: result, filtered };
  }

  function filterCompactVideoItems(
    items: Array<Record<string, unknown>>,
    settings: Record<string, unknown>,
    snoozes: Array<{ id: string; type: string; expiresAt: number }>
  ): { items: Array<Record<string, unknown>>; filtered: number } {
    const now = Date.now();
    const activeSnoozes = snoozes.filter((s) => s.expiresAt > now);
    const channelCounts = new Map<string, number>();
    const maxPerChannel = (settings.maxVideosPerChannel as number) ?? 2;
    let filtered = 0;

    const result = items.filter((item) => {
      const video = item?.compactVideoRenderer as Record<string, unknown> | undefined;
      if (!video) return true;

      // ── Snooze check ────────────────────────────────────────────────────
      if (activeSnoozes.length > 0) {
        const videoId = video.videoId as string | undefined;
        const channelId = getChannelId(video);
        const title = getTitle(video).toLowerCase();

        for (const snooze of activeSnoozes) {
          if (
            (snooze.type === 'video' && snooze.id === videoId) ||
            (snooze.type === 'channel' && snooze.id === channelId) ||
            (snooze.type === 'keyword' && title.includes(snooze.id.toLowerCase()))
          ) {
            filtered++;
            return false;
          }
        }
      }

      // ── Channel cap check ─────────────────────────────────────────────
      if (settings.channelCapEnabled) {
        const channelKey = getChannelId(video) || getChannelName(video);
        if (channelKey) {
          const count = channelCounts.get(channelKey) ?? 0;
          if (count >= maxPerChannel) {
            filtered++;
            return false;
          }
          channelCounts.set(channelKey, count + 1);
        }
      }

      return true;
    });

    return { items: result, filtered };
  }

  // ─── Inline Parsers (can't import modules in MAIN world) ───────────────────

  function getTitle(video: Record<string, unknown>): string {
    const title = video.title as Record<string, unknown> | undefined;
    const runs = title?.runs as Array<{ text: string }> | undefined;
    return runs?.map((r) => r.text).join('') ?? '';
  }

  function getChannelName(video: Record<string, unknown>): string {
    const longByline = video.longBylineText as Record<string, unknown> | undefined;
    const shortByline = video.shortBylineText as Record<string, unknown> | undefined;
    const runs = (longByline?.runs ?? shortByline?.runs) as Array<{ text: string }> | undefined;
    return runs?.[0]?.text ?? '';
  }

  function getChannelId(video: Record<string, unknown>): string {
    const longByline = video.longBylineText as Record<string, unknown> | undefined;
    const shortByline = video.shortBylineText as Record<string, unknown> | undefined;
    const runs = (longByline?.runs ?? shortByline?.runs) as
      | Array<{
          navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
        }>
      | undefined;
    return runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? '';
  }

  function getViewCountText(video: Record<string, unknown>): string {
    const viewCount = video.viewCountText as Record<string, unknown> | undefined;
    if (viewCount?.simpleText) return viewCount.simpleText as string;
    const runs = viewCount?.runs as Array<{ text: string }> | undefined;
    return runs?.map((r) => r.text).join('') ?? '';
  }

  function parseViews(text: string): number {
    if (!text) return 0;
    const cleaned = text.toLowerCase().replace(/views?/gi, '').replace(/,/g, '').replace(/\s+/g, '').trim();
    if (!cleaned) return 0;
    const match = cleaned.match(/^([\d.]+)([kmbt])?$/i);
    if (match) {
      const num = parseFloat(match[1]);
      switch (match[2]?.toLowerCase()) {
        case 'k': return Math.round(num * 1000);
        case 'm': return Math.round(num * 1000000);
        case 'b': case 't': return Math.round(num * 1000000000);
        default: return Math.round(num);
      }
    }
    return Math.round(parseFloat(cleaned)) || 0;
  }

  function parseAge(text: string | undefined): number {
    if (!text) return Infinity;
    const match = text.toLowerCase().match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/);
    if (!match) return Infinity;
    const amount = parseInt(match[1], 10);
    switch (match[2]) {
      case 'second': return amount / 3600;
      case 'minute': return amount / 60;
      case 'hour': return amount;
      case 'day': return amount * 24;
      case 'week': return amount * 168;
      case 'month': return amount * 720;
      case 'year': return amount * 8760;
      default: return Infinity;
    }
  }

  console.log('[FeedForge] MAIN world interceptor loaded — fetch patched');
});
