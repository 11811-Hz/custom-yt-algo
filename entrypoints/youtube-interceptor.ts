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

  /** Persistent channel cap state — survives across continuation responses */
  const feedState = {
    channelCounts: new Map<string, number>(),
    currentUrl: '',
  };

  /** Reset feed state on YouTube SPA navigation */
  window.addEventListener('yt-navigate-start', () => {
    feedState.channelCounts.clear();
    feedState.currentUrl = location.href;
  });

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
      const snoozeCount = pipelineConfig?.snoozes?.length ?? 0;
      console.log(`[FeedForge] Pipeline config updated — ${snoozeCount} snooze(s)`, 
        snoozeCount > 0 ? pipelineConfig?.snoozes : '(none)');

      // Apply DOM-level filter for already-rendered videos
      // (initial page load uses inline data, not fetch)
      requestAnimationFrame(() => filterRenderedVideos());
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

  // ─── Recursive Video Discovery ──────────────────────────────────────────────
  //
  // Instead of hardcoding paths like twoColumnBrowseResultsRenderer → tabs → ...
  // we recursively walk the response tree and find arrays containing video
  // renderer objects. This makes filtering resilient to YouTube restructuring
  // the response JSON.

  /** Known renderer keys that contain filterable video content */
  const VIDEO_RENDERER_KEYS = new Set([
    'videoRenderer',
    'compactVideoRenderer',
    'gridVideoRenderer',
    'playlistVideoRenderer',
    'reelItemRenderer',
  ]);

  interface DiscoveredArray {
    array: Array<Record<string, unknown>>;
    path: string;
    rendererKey: string;
  }

  /**
   * Recursively find all arrays in the response that contain video renderer
   * objects. Returns references to the parent arrays so we can filter in-place.
   */
  function discoverVideoArrays(
    obj: unknown,
    path: string,
    results: DiscoveredArray[],
    visited: WeakSet<object>,
    depth: number
  ): void {
    if (depth > 20 || obj === null || obj === undefined) return;
    if (typeof obj !== 'object') return;
    if (visited.has(obj as object)) return;
    visited.add(obj as object);

    if (Array.isArray(obj)) {
      // Check if any element in this array has a video renderer key
      for (const item of obj) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          for (const key of VIDEO_RENDERER_KEYS) {
            if (key in (item as Record<string, unknown>)) {
              results.push({ array: obj as Array<Record<string, unknown>>, path, rendererKey: key });
              return; // Don't recurse into this array further — we'll filter it
            }
          }
          // Also check richItemRenderer -> content -> videoRenderer pattern
          const richItem = (item as Record<string, unknown>).richItemRenderer as Record<string, unknown> | undefined;
          if (richItem?.content) {
            const content = richItem.content as Record<string, unknown>;
            for (const key of VIDEO_RENDERER_KEYS) {
              if (key in content) {
                results.push({ array: obj as Array<Record<string, unknown>>, path, rendererKey: `richItem.${key}` });
                return;
              }
            }
          }
        }
      }
      // Recurse into array elements
      for (let i = 0; i < obj.length; i++) {
        discoverVideoArrays(obj[i], `${path}[${i}]`, results, visited, depth + 1);
      }
    } else {
      // Recurse into object properties
      for (const key of Object.keys(obj as Record<string, unknown>)) {
        discoverVideoArrays(
          (obj as Record<string, unknown>)[key],
          `${path}.${key}`,
          results,
          visited,
          depth + 1
        );
      }
    }
  }

  /**
   * Extract the video renderer object from an array item, regardless of wrapper.
   */
  function extractVideoRenderer(item: Record<string, unknown>, rendererKey: string): Record<string, unknown> | null {
    if (rendererKey.startsWith('richItem.')) {
      const actualKey = rendererKey.slice('richItem.'.length);
      const richItem = item.richItemRenderer as Record<string, unknown> | undefined;
      const content = richItem?.content as Record<string, unknown> | undefined;
      return (content?.[actualKey] as Record<string, unknown>) ?? null;
    }
    return (item[rendererKey] as Record<string, unknown>) ?? null;
  }

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

    // ── Recursive discovery pass (catches anything the hardcoded paths miss) ──
    const discoveredArrays: DiscoveredArray[] = [];
    discoverVideoArrays(processed, 'root', discoveredArrays, new WeakSet(), 0);

    let recursiveSnoozed = 0;
    let recursiveCapped = 0;
    let recursiveVelocity = 0;

    for (const discovered of discoveredArrays) {
      const result = filterDiscoveredArray(discovered, settings, snoozes);
      recursiveSnoozed += result.snoozed;
      recursiveCapped += result.capped;
      recursiveVelocity += result.velocity;
    }

    totalSnoozed += recursiveSnoozed;
    totalCapped += recursiveCapped;
    totalVelocity += recursiveVelocity;

    const totalFiltered = totalSnoozed + totalCapped + totalVelocity;

    // ── Debug logging ─────────────────────────────────────────────────────
    const endpoint = url.split('/youtubei/v1/')[1]?.split('?')[0] ?? url;
    console.log(
      `[FeedForge] ${endpoint}: discovered ${discoveredArrays.length} video array(s) ` +
      `[${discoveredArrays.map(d => `${d.rendererKey}@${d.path}`).join(', ')}], ` +
      `filtered ${totalFiltered} (snoozed:${totalSnoozed} capped:${totalCapped} velocity:${totalVelocity})`
    );

    if (totalFiltered > 0) {
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

  // ─── Recursive Filter (for discovered arrays) ──────────────────────────────

  function filterDiscoveredArray(
    discovered: DiscoveredArray,
    settings: Record<string, unknown>,
    snoozes: Array<{ id: string; type: string; expiresAt: number }>
  ): { snoozed: number; capped: number; velocity: number } {
    const now = Date.now();
    const activeSnoozes = snoozes.filter((s) => s.expiresAt > now);
    const maxPerChannel = (settings.maxVideosPerChannel as number) ?? 2;
    let snoozed = 0;
    let capped = 0;
    let velocity = 0;

    // Filter in-place by splicing rejected items (iterate backwards)
    for (let i = discovered.array.length - 1; i >= 0; i--) {
      const item = discovered.array[i];
      const video = extractVideoRenderer(item, discovered.rendererKey);
      if (!video) continue; // Not a video item (continuation token, section header, etc.)

      let shouldRemove = false;
      let reason = '';

      // ── Snooze check ──
      if (!shouldRemove && activeSnoozes.length > 0) {
        const videoId = video.videoId as string | undefined;
        const channelId = getChannelId(video);
        const channelName = getChannelName(video).toLowerCase();
        const title = getTitle(video).toLowerCase();

        for (const snooze of activeSnoozes) {
          const keyword = snooze.id.toLowerCase();
          if (
            (snooze.type === 'video' && snooze.id === videoId) ||
            (snooze.type === 'channel' && snooze.id === channelId) ||
            (snooze.type === 'keyword' && (title.includes(keyword) || channelName.includes(keyword)))
          ) {
            shouldRemove = true;
            reason = `snooze:${snooze.type}:${snooze.id}`;
            snoozed++;
            break;
          }
        }
      }

      // ── Channel cap check ──
      if (!shouldRemove && settings.channelCapEnabled) {
        const channelKey = getChannelId(video) || getChannelName(video);
        if (channelKey) {
          const count = feedState.channelCounts.get(channelKey) ?? 0;
          if (count >= maxPerChannel) {
            shouldRemove = true;
            reason = `cap:${channelKey}`;
            capped++;
          } else {
            feedState.channelCounts.set(channelKey, count + 1);
          }
        }
      }

      // ── Velocity check ──
      if (!shouldRemove && settings.velocityEnabled && settings.velocityMode !== 'off') {
        const viewCount = parseViews(getViewCountText(video));
        const hoursAgo = parseAge(
          (video.publishedTimeText as Record<string, unknown>)?.simpleText as string | undefined
        );

        if (hoursAgo !== null) {
          const velo = hoursAgo > 0 ? viewCount / hoursAgo : 0;

          if (settings.velocityMode === 'hide-viral') {
            if (velo > ((settings.viralThreshold as number) ?? 50000)) {
              shouldRemove = true;
              reason = `viral:${Math.round(velo)}v/h`;
              velocity++;
            }
          } else if (settings.velocityMode === 'gems-only') {
            const meetsVelocity = velo >= ((settings.gemMinVelocity as number) ?? 100);
            const isHidden = viewCount <= ((settings.gemMaxTotalViews as number) ?? 100000);
            if (!(meetsVelocity && isHidden)) {
              shouldRemove = true;
              reason = `gems:${Math.round(velo)}v/h,${viewCount}v`;
              velocity++;
            }
          }
        }
      }

      if (shouldRemove) {
        discovered.array.splice(i, 1);
      }
    }

    return { snoozed, capped, velocity };
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
        const channelName = getChannelName(video).toLowerCase();
        const title = getTitle(video).toLowerCase();

        for (const snooze of activeSnoozes) {
          const keyword = snooze.id.toLowerCase();
          if (
            (snooze.type === 'video' && snooze.id === videoId) ||
            (snooze.type === 'channel' && snooze.id === channelId) ||
            (snooze.type === 'keyword' && (title.includes(keyword) || channelName.includes(keyword)))
          ) {
            console.log(`[FeedForge] Snoozed: "${title.slice(0, 50)}" (matched ${snooze.type}: "${snooze.id}")`);
            snoozed++;
            return false;
          }
        }
      } else {
        // Log if no active snoozes (helps debug expired snoozes)
        if (items.indexOf(item) === 0) {
          console.log(`[FeedForge] No active snoozes (total snoozes received: ${snoozes.length})`);
        }
      }

      // ── Channel cap check ─────────────────────────────────────────────
      if (settings.channelCapEnabled) {
        const channelKey = getChannelId(video) || getChannelName(video);
        if (channelKey) {
          const count = feedState.channelCounts.get(channelKey) ?? 0;
          if (count >= maxPerChannel) {
            capped++;
            return false;
          }
          feedState.channelCounts.set(channelKey, count + 1);
        }
      }

      // ── Velocity check ────────────────────────────────────────────────
      if (settings.velocityEnabled && settings.velocityMode !== 'off') {
        const viewCount = parseViews(getViewCountText(video));
        const hoursAgo = parseAge(
          (video.publishedTimeText as Record<string, unknown>)?.simpleText as string | undefined
        );

        // Unknown age → unknown velocity → keep conservatively
        if (hoursAgo === null) return true;

        const velo = hoursAgo > 0 ? viewCount / hoursAgo : 0;

        if (settings.velocityMode === 'hide-viral') {
          if (velo > ((settings.viralThreshold as number) ?? 50000)) {
            velocity++;
            return false;
          }
        } else if (settings.velocityMode === 'gems-only') {
          const meetsVelocity = velo >= ((settings.gemMinVelocity as number) ?? 100);
          const isHidden = viewCount <= ((settings.gemMaxTotalViews as number) ?? 100000);
          if (!(meetsVelocity && isHidden)) {
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
          const count = feedState.channelCounts.get(channelKey) ?? 0;
          if (count >= maxPerChannel) {
            capped++;
            return false;
          }
          feedState.channelCounts.set(channelKey, count + 1);
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
        case 'b': return Math.round(num * 1000000000);
        case 't': return Math.round(num * 1000000000000);
        default: return Math.round(num);
      }
    }
    return Math.round(parseFloat(cleaned)) || 0;
  }

  function parseAge(text: string | undefined): number | null {
    if (!text) return null;
    const match = text.toLowerCase().match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/);
    if (!match) {
      if (text.toLowerCase().includes('just now') || text.toLowerCase().includes('moment')) {
        return 0.01;
      }
      return null;
    }
    const amount = parseInt(match[1], 10);
    switch (match[2]) {
      case 'second': return amount / 3600;
      case 'minute': return amount / 60;
      case 'hour': return amount;
      case 'day': return amount * 24;
      case 'week': return amount * 168;
      case 'month': return amount * 720;
      case 'year': return amount * 8760;
      default: return null;
    }
  }

  // ─── DOM-Level Filtering (fallback for server-side rendered content) ────────
  //
  // YouTube embeds the initial feed data inline in the HTML (ytInitialData),
  // so fetch interception misses the first page load. This MutationObserver
  // watches for rendered video elements and hides ones matching active filters.
  //
  // NOTE: YouTube's DOM uses yt-lockup-view-model for video cards (as of 2026).
  // Title: h3 a (inside the lockup) or #video-title (legacy)
  // Channel: yt-content-metadata-view-model a or #channel-name (legacy)

  let domObserverStarted = false;

  /**
   * Extract title text from a video card element using multiple selector
   * strategies to handle YouTube's evolving DOM structure.
   */
  function extractTitle(el: Element): string {
    // New lockup model (2026+): title is in h3 > a
    const lockupTitle = el.querySelector('yt-lockup-view-model h3 a');
    if (lockupTitle?.textContent) return lockupTitle.textContent.trim();

    // Try the lockup title class directly
    const lockupTitleClass = el.querySelector('a[class*="lockup"][class*="title"], a[class*="Title"]');
    if (lockupTitleClass?.textContent) return lockupTitleClass.textContent.trim();

    // Legacy selectors
    const legacyTitle = el.querySelector('#video-title, #video-title-link, a#video-title-link');
    if (legacyTitle?.textContent) return legacyTitle.textContent.trim();

    // Broadest fallback: any h3 text or aria-label on the element
    const h3 = el.querySelector('h3');
    if (h3?.textContent) return h3.textContent.trim();

    const ariaLabel = el.getAttribute('aria-label') || el.querySelector('[aria-label]')?.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    return '';
  }

  /**
   * Extract channel name from a video card element.
   */
  function extractChannel(el: Element): string {
    // New lockup model (2026+): channel is in yt-content-metadata-view-model
    const metadataLink = el.querySelector('yt-content-metadata-view-model a');
    if (metadataLink?.textContent) return metadataLink.textContent.trim();

    // Try attributed string links in the metadata area
    const attrLink = el.querySelector('.ytAttributedStringLink, a[class*="attributed"]');
    if (attrLink?.textContent) return attrLink.textContent.trim();

    // Legacy selectors
    const legacyChannel = el.querySelector('#channel-name #text, ytd-channel-name #text, ytd-channel-name a');
    if (legacyChannel?.textContent) return legacyChannel.textContent.trim();

    // Fallback: any second link text (first is usually the title)
    const allLinks = el.querySelectorAll('a[href*="/@"], a[href*="/channel/"]');
    for (const link of allLinks) {
      const text = link.textContent?.trim();
      if (text && text.length > 0 && text.length < 80) return text;
    }

    return '';
  }

  function filterRenderedVideos(root?: Element): void {
    if (!pipelineConfig) return;
    const settings = pipelineConfig.settings as Record<string, unknown>;
    if (!settings?.enabled) return;

    const now = Date.now();
    const snoozes = (pipelineConfig.snoozes as Array<{ id: string; type: string; expiresAt: number }>)
      .filter((s) => s.expiresAt > now);

    const hasSnoozes = snoozes.length > 0;
    const hasChannelCap = !!settings.channelCapEnabled;
    const maxPerChannel = (settings.maxVideosPerChannel as number) ?? 2;

    // Nothing to filter at DOM level
    if (!hasSnoozes && !hasChannelCap) return;

    const container = root || document;

    // Home feed items
    const richItems = container.querySelectorAll(
      'ytd-rich-item-renderer:not([data-feedforge-filtered])'
    );

    let hiddenCount = 0;
    richItems.forEach((el) => {
      el.setAttribute('data-feedforge-filtered', 'true');
      const title = extractTitle(el).toLowerCase();
      const channel = extractChannel(el).toLowerCase();

      // ── Snooze check ──
      if (hasSnoozes) {
        for (const snooze of snoozes) {
          const keyword = snooze.id.toLowerCase();
          if (
            (snooze.type === 'keyword' && (title.includes(keyword) || channel.includes(keyword))) ||
            (snooze.type === 'channel' && channel === keyword)
          ) {
            (el as HTMLElement).style.display = 'none';
            hiddenCount++;
            console.log(`[FeedForge] DOM filter: hidden "${title.slice(0, 60)}" (matched: "${snooze.id}")`);
            return;
          }
        }
      }

      // ── Channel cap check (DOM-level) ──
      if (hasChannelCap && channel) {
        const count = feedState.channelCounts.get(channel) ?? 0;
        if (count >= maxPerChannel) {
          (el as HTMLElement).style.display = 'none';
          hiddenCount++;
          return;
        }
        feedState.channelCounts.set(channel, count + 1);
      }
    });

    // Watch sidebar items (compact video renderers)
    const compactItems = container.querySelectorAll(
      'ytd-compact-video-renderer:not([data-feedforge-filtered])'
    );
    compactItems.forEach((el) => {
      el.setAttribute('data-feedforge-filtered', 'true');
      const title = extractTitle(el).toLowerCase();
      const channel = extractChannel(el).toLowerCase();

      if (hasSnoozes) {
        for (const snooze of snoozes) {
          const keyword = snooze.id.toLowerCase();
          if (
            (snooze.type === 'keyword' && (title.includes(keyword) || channel.includes(keyword))) ||
            (snooze.type === 'channel' && channel === keyword)
          ) {
            (el as HTMLElement).style.display = 'none';
            hiddenCount++;
            return;
          }
        }
      }

      if (hasChannelCap && channel) {
        const count = feedState.channelCounts.get(channel) ?? 0;
        if (count >= maxPerChannel) {
          (el as HTMLElement).style.display = 'none';
          hiddenCount++;
          return;
        }
        feedState.channelCounts.set(channel, count + 1);
      }
    });

    // Shorts shelf items
    const shortsItems = container.querySelectorAll(
      'ytd-reel-item-renderer:not([data-feedforge-filtered])'
    );
    shortsItems.forEach((el) => {
      el.setAttribute('data-feedforge-filtered', 'true');
      const title = (el.querySelector('#headline, [id*="title"]')?.textContent ?? '').toLowerCase();

      if (hasSnoozes) {
        for (const snooze of snoozes) {
          if (snooze.type === 'keyword' && title.includes(snooze.id.toLowerCase())) {
            (el as HTMLElement).style.display = 'none';
            hiddenCount++;
            return;
          }
        }
      }
    });

    if (hiddenCount > 0) {
      console.log(`[FeedForge] DOM filter pass: hidden ${hiddenCount} video(s)`);
    }

    // Start the MutationObserver for future additions (once)
    if (!domObserverStarted && document.body) {
      domObserverStarted = true;
      const observer = new MutationObserver((mutations) => {
        let hasNewItems = false;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              if (
                node.tagName === 'YTD-RICH-ITEM-RENDERER' ||
                node.tagName === 'YTD-COMPACT-VIDEO-RENDERER' ||
                node.tagName === 'YTD-REEL-ITEM-RENDERER' ||
                node.querySelector?.('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-reel-item-renderer')
              ) {
                hasNewItems = true;
              }
            }
          }
        }
        if (hasNewItems) {
          // Debounce — wait for batch of elements to be added
          requestAnimationFrame(() => filterRenderedVideos());
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      console.log('[FeedForge] DOM observer started for initial/fallback filtering');
    }
  }

  console.log('[FeedForge] MAIN world interceptor loaded — fetch patched');
});
