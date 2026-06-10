/**
 * Update Checker
 *
 * Periodically checks the GitHub Releases API for new versions.
 * Stores the latest version info in chrome.storage.local so the
 * popup can display an update banner when one is available.
 */

const GITHUB_OWNER = '11811-Hz';
const GITHUB_REPO = 'custom-yt-algo';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

/** How often to check for updates (4 hours) */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  releaseUrl: string;
  checkedAt: number;
}

/**
 * Compare two semver strings (e.g. "0.1.0" vs "0.2.0").
 * Returns true if `latest` is newer than `current`.
 */
function isNewerVersion(current: string, latest: string): boolean {
  const c = current.replace(/^v/, '').split('.').map(Number);
  const l = latest.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

/**
 * Get the current extension version from the manifest.
 */
function getCurrentVersion(): string {
  return browser.runtime.getManifest().version;
}

/**
 * Fetch the latest release from GitHub and compare versions.
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const currentVersion = getCurrentVersion();

  try {
    const response = await fetch(RELEASES_API, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
    });

    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }

    const release = await response.json() as {
      tag_name: string;
      html_url: string;
      assets: Array<{ name: string; browser_download_url: string }>;
    };

    const latestVersion = release.tag_name.replace(/^v/, '');

    // Find the .zip asset
    const zipAsset = release.assets.find((a) => a.name.endsWith('.zip'));
    const downloadUrl = zipAsset?.browser_download_url ?? release.html_url;

    const updateInfo: UpdateInfo = {
      available: isNewerVersion(currentVersion, latestVersion),
      currentVersion,
      latestVersion,
      downloadUrl,
      releaseUrl: release.html_url,
      checkedAt: Date.now(),
    };

    // Cache the result
    await browser.storage.local.set({ 'feedforge-update': updateInfo });

    return updateInfo;
  } catch (error) {
    console.warn('[FeedForge] Update check failed:', error);

    // Return a "no update" result on failure
    const fallback: UpdateInfo = {
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      downloadUrl: '',
      releaseUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      checkedAt: Date.now(),
    };
    return fallback;
  }
}

/**
 * Get cached update info from storage.
 */
export async function getCachedUpdateInfo(): Promise<UpdateInfo | null> {
  const result = await browser.storage.local.get('feedforge-update');
  return (result['feedforge-update'] as UpdateInfo) ?? null;
}

/**
 * Check for update only if enough time has elapsed since the last check.
 */
export async function checkForUpdateIfDue(): Promise<UpdateInfo | null> {
  const cached = await getCachedUpdateInfo();

  if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
    return cached;
  }

  return checkForUpdate();
}
