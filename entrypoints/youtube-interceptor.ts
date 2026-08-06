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

  /** Schema health tracking */
  const schemaTracker = {
    totalChecked: 0,
    consecutiveFailures: 0,
    lastStatus: 'healthy' as 'healthy' | 'degraded' | 'broken',
    lastIssues: [] as string[],
  };

  /** Dispatch schema health to content script */
  function dispatchHealthEvent() {
    const status = schemaTracker.consecutiveFailures === 0
      ? 'healthy'
      : schemaTracker.consecutiveFailures < 4
        ? 'degraded'
        : 'broken';

    // Only dispatch when status changes or every 10 checks as heartbeat
    if (status !== schemaTracker.lastStatus || schemaTracker.totalChecked % 10 === 0) {
      schemaTracker.lastStatus = status;
      window.dispatchEvent(
        new CustomEvent('feedforge-main-to-content', {
          detail: JSON.stringify({
            type: 'SCHEMA_HEALTH',
            payload: {
              status,
              issues: schemaTracker.lastIssues,
              totalChecked: schemaTracker.totalChecked,
              consecutiveFailures: schemaTracker.consecutiveFailures,
            },
          }),
        })
      );
    }
  }

  // ─── Listen for config updates from content script ──────────────────────────

  window.addEventListener('feedforge-content-to-main', ((event: CustomEvent) => {
    // Detail is JSON-stringified to cross the MAIN/ISOLATED world boundary
    let data: Record<string, unknown> | null = null;
    try {
      data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
    } catch { /* ignore parse errors */ }
    if (data?.type === 'PIPELINE_CONFIG') {
      pipelineConfig = data.payload as typeof pipelineConfig;
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

    let totalSnoozed = 0;
    let totalCapped = 0;
    let totalVelocity = 0;

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
          totalSnoozed += result.snoozed;
          totalCapped += result.capped;
          totalVelocity += result.velocity;
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
          totalSnoozed += result.snoozed;
          totalCapped += result.capped;
          totalVelocity += result.velocity;
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
      totalSnoozed += result.snoozed;
      totalCapped += result.capped;
      totalVelocity += result.velocity;
    }

    const totalFiltered = totalSnoozed + totalCapped + totalVelocity;
    if (totalFiltered > 0) {
      console.log(`[FeedForge] Filtered ${totalFiltered} videos (snoozed: ${totalSnoozed}, capped: ${totalCapped}, velocity: ${totalVelocity})`);

      // Notify content script of stats with per-filter breakdown
      // Detail is JSON-stringified to cross the MAIN/ISOLATED world boundary
      window.dispatchEvent(
        new CustomEvent('feedforge-main-to-content', {
          detail: JSON.stringify({
            type: 'FILTER_STATS',
            payload: {
              snoozed: totalSnoozed,
              capped: totalCapped,
              velocity: totalVelocity,
            },
          }),
        })
      );
    }

    // ── Schema validation ────────────────────────────────────────────────
    validateSchema(url, body, processed);

    return processed;
  }

  // ─── Schema Validation ─────────────────────────────────────────────────────

  /**
   * Validate that YouTube's response JSON still has the structure we expect.
   * Only flags when we find a known container (e.g. twoColumnBrowseResultsRenderer)
   * but the inner video renderers are missing or have changed fields.
   */
  function validateSchema(
    url: string,
    originalBody: Record<string, unknown>,
    _processed: Record<string, unknown>
  ): void {
    const issues: string[] = [];
    let wasRelevantResponse = false;
    let foundVideos = false;

    // ── Check browse/home page structure ──────────────────────────────────
    const twoCol = (originalBody as Record<string, unknown>)?.contents
      ? ((originalBody as Record<string, unknown>).contents as Record<string, unknown>)
          ?.twoColumnBrowseResultsRenderer as Record<string, unknown> | undefined
      : undefined;

    if (twoCol) {
      wasRelevantResponse = true;
      const tabs = twoCol.tabs as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(tabs)) {
        issues.push('browse: tabs array missing');
      } else {
        for (const tab of tabs) {
          const grid = (tab?.tabRenderer as Record<string, unknown>)?.content
            ? ((tab.tabRenderer as Record<string, unknown>).content as Record<string, unknown>)
                ?.richGridRenderer as Record<string, unknown> | undefined
            : undefined;
          if (grid) {
            const contents = grid.contents as Array<Record<string, unknown>> | undefined;
            if (!Array.isArray(contents)) {
              issues.push('browse: richGridRenderer.contents missing');
            } else {
              // Check first few items for video renderers
              for (const item of contents.slice(0, 10)) {
                const vr = (item?.richItemRenderer as Record<string, unknown>)?.content
                  ? ((item.richItemRenderer as Record<string, unknown>).content as Record<string, unknown>)
                      ?.videoRenderer as Record<string, unknown> | undefined
                  : undefined;
                if (vr) {
                  foundVideos = true;
                  if (!vr.videoId) issues.push('video: missing videoId');
                  if (!vr.title) issues.push('video: missing title');
                  if (!vr.longBylineText && !vr.shortBylineText) issues.push('video: missing byline (channel)');
                  break;
                }
              }
              if (!foundVideos && contents.length > 3) {
                issues.push('browse: no videoRenderer found in grid items');
              }
            }
          }
        }
      }
    }

    // ── Check continuation items ──────────────────────────────────────────
    const actions = (
      originalBody.onResponseReceivedActions ?? originalBody.onResponseReceivedEndpoints
    ) as Array<Record<string, unknown>> | undefined;

    if (Array.isArray(actions)) {
      for (const action of actions) {
        const ciSource = action?.appendContinuationItemsAction ?? action?.reloadContinuationItemsCommand;
        const ci = ciSource as Record<string, unknown> | undefined;
        if (ci) {
          wasRelevantResponse = true;
          const items = ci.continuationItems as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(items)) {
            issues.push('continuation: items array missing');
          } else {
            for (const item of items.slice(0, 10)) {
              const vr = (item?.richItemRenderer as Record<string, unknown>)?.content
                ? ((item.richItemRenderer as Record<string, unknown>).content as Record<string, unknown>)
                    ?.videoRenderer as Record<string, unknown> | undefined
                : undefined;
              if (vr) {
                foundVideos = true;
                if (!vr.videoId) issues.push('video: missing videoId');
                break;
              }
            }
          }
        }
      }
    }

    // ── Check watch next sidebar ──────────────────────────────────────────
    const watchNextContainer = (originalBody as Record<string, unknown>)?.contents
      ? ((originalBody as Record<string, unknown>).contents as Record<string, unknown>)
          ?.twoColumnWatchNextResults as Record<string, unknown> | undefined
      : undefined;

    if (watchNextContainer) {
      wasRelevantResponse = true;
      const secondary = (watchNextContainer.secondaryResults as Record<string, unknown>)
        ?.secondaryResults as Record<string, unknown> | undefined;
      if (secondary) {
        const results = secondary.results as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(results)) {
          issues.push('watchNext: results array missing');
        } else {
          for (const item of results.slice(0, 5)) {
            if ((item as Record<string, unknown>)?.compactVideoRenderer) {
              foundVideos = true;
              const cvr = (item as Record<string, unknown>).compactVideoRenderer as Record<string, unknown>;
              if (!cvr.videoId) issues.push('video: missing videoId');
              break;
            }
          }
        }
      }
    }

    // ── Update health tracker ─────────────────────────────────────────────
    if (!wasRelevantResponse) return; // Not a response we validate (e.g. search, reel)

    schemaTracker.totalChecked++;
    const uniqueIssues = [...new Set(issues)];

    if (foundVideos && uniqueIssues.length === 0) {
      // Fully healthy
      schemaTracker.consecutiveFailures = 0;
      schemaTracker.lastIssues = [];
    } else if (foundVideos && uniqueIssues.length > 0) {
      // Found videos but some fields missing — degraded
      schemaTracker.consecutiveFailures++;
      schemaTracker.lastIssues = uniqueIssues;
      console.warn('[FeedForge] Schema degraded:', uniqueIssues);
    } else {
      // No videos found where expected — broken
      schemaTracker.consecutiveFailures++;
      schemaTracker.lastIssues = uniqueIssues.length > 0 ? uniqueIssues : ['No video renderers found in expected location'];
      console.error('[FeedForge] Schema broken:', schemaTracker.lastIssues);
    }

    dispatchHealthEvent();
  }

  // ─── Filter Helpers (inline, since we can't import modules in MAIN world) ──

  function filterRichGridItems(
    items: Array<Record<string, unknown>>,
    settings: Record<string, unknown>,
    snoozes: Array<{ id: string; type: string; expiresAt: number }>
  ): { items: Array<Record<string, unknown>>; snoozed: number; capped: number; velocity: number } {
    // Extract video renderers, apply filters, reconstruct
    const now = Date.now();
    const activeSnoozes = snoozes.filter((s) => s.expiresAt > now);
    const channelCounts = new Map<string, number>();
    const maxPerChannel = (settings.maxVideosPerChannel as number) ?? 2;
    let snoozed = 0;
    let capped = 0;
    let velocity = 0;

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
            snoozed++;
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
            capped++;
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
        const velo = hoursAgo > 0 ? viewCount / hoursAgo : 0;

        if (settings.velocityMode === 'hide-viral') {
          if (velo > ((settings.viralThreshold as number) ?? 50000)) {
            velocity++;
            return false;
          }
        } else if (settings.velocityMode === 'gems-only') {
          const meetsVelocity = velo >= ((settings.gemMinVelocity as number) ?? 100);
          const isHidden = viewCount <= ((settings.gemMaxTotalViews as number) ?? 100000);
          const unknownAge = viewCount === 0 && hoursAgo === Infinity;
          if (!unknownAge && !(meetsVelocity && isHidden)) {
            velocity++;
            return false;
          }
        }
      }

      return true;
    });

    return { items: result, snoozed, capped, velocity };
  }

  function filterCompactVideoItems(
    items: Array<Record<string, unknown>>,
    settings: Record<string, unknown>,
    snoozes: Array<{ id: string; type: string; expiresAt: number }>
  ): { items: Array<Record<string, unknown>>; snoozed: number; capped: number; velocity: number } {
    const now = Date.now();
    const activeSnoozes = snoozes.filter((s) => s.expiresAt > now);
    const channelCounts = new Map<string, number>();
    const maxPerChannel = (settings.maxVideosPerChannel as number) ?? 2;
    let snoozed = 0;
    let capped = 0;

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
            snoozed++;
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
            capped++;
            return false;
          }
          channelCounts.set(channelKey, count + 1);
        }
      }

      return true;
    });

    return { items: result, snoozed, capped, velocity: 0 };
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
