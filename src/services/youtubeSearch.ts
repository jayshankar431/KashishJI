export interface YouTubeTrack {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail: string;
  durationText: string;
  durationSeconds?: number;
  viewsText?: string;
  mediaType?: 'song' | 'video';
  catalogSource?: 'youtube_music' | 'youtube_video';
}

interface CachedSearchItem {
  tracks: YouTubeTrack[];
  cachedAt: number;
}

const memoryCache = new Map<string, CachedSearchItem>();
const videoMemoryCache = new Map<string, CachedSearchItem>();
const inFlightSearches = new Map<string, Promise<YouTubeTrack[]>>();
const inFlightVideoSearches = new Map<string, Promise<YouTubeTrack[]>>();
const SESSION_CACHE_KEY = 'kashish_ytmusic_catalog_cache_v5';
const SESSION_VIDEO_CACHE_KEY = 'kashish_ytvideo_catalog_cache_v1';
export const SEARCH_CACHE_STALE_MS = 5 * 60 * 1000; // 5 minutes Stale-While-Revalidate threshold

export function getHighResThumbnailUrl(videoId: string): string {
  if (!videoId) return '';
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

export function normalizeSquareThumbnail(rawUrl: string | undefined, videoId: string): string {
  const clean = (rawUrl || '').trim();
  if (clean.includes('googleusercontent.com') || clean.includes('ggpht.com')) {
    return clean.replace(/=w\d+-h\d+[^&?]*/, '=w512-h512-l90-rj');
  }
  if (videoId) {
    return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  }
  return clean;
}

// Hydrate session cache on module load
try {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    const raw = window.sessionStorage.getItem(SESSION_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, CachedSearchItem>;
      Object.entries(parsed).forEach(([k, v]) => {
        if (v && Array.isArray(v.tracks) && v.tracks.length > 0) {
          memoryCache.set(k, {
            tracks: v.tracks,
            cachedAt: typeof v.cachedAt === 'number' ? v.cachedAt : Date.now(),
          });
        }
      });
    }
    const rawVid = window.sessionStorage.getItem(SESSION_VIDEO_CACHE_KEY);
    if (rawVid) {
      const parsedVid = JSON.parse(rawVid) as Record<string, CachedSearchItem>;
      Object.entries(parsedVid).forEach(([k, v]) => {
        if (v && Array.isArray(v.tracks) && v.tracks.length > 0) {
          videoMemoryCache.set(k, {
            tracks: v.tracks,
            cachedAt: typeof v.cachedAt === 'number' ? v.cachedAt : Date.now(),
          });
        }
      });
    }
  }
} catch {
  // Ignore storage errors
}

function saveToCache(key: string, results: YouTubeTrack[]) {
  if (!results.length) return;
  const entry: CachedSearchItem = {
    tracks: results,
    cachedAt: Date.now(),
  };
  memoryCache.set(key, entry);
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const obj: Record<string, CachedSearchItem> = {};
      const entries = Array.from(memoryCache.entries()).slice(-30);
      for (const [k, v] of entries) {
        obj[k] = v;
      }
      window.sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(obj));
    }
  } catch {
    // Ignore quota errors
  }
}

function saveToVideoCache(key: string, results: YouTubeTrack[]) {
  if (!results.length) return;
  const entry: CachedSearchItem = {
    tracks: results,
    cachedAt: Date.now(),
  };
  videoMemoryCache.set(key, entry);
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const obj: Record<string, CachedSearchItem> = {};
      const entries = Array.from(videoMemoryCache.entries()).slice(-30);
      for (const [k, v] of entries) {
        obj[k] = v;
      }
      window.sessionStorage.setItem(SESSION_VIDEO_CACHE_KEY, JSON.stringify(obj));
    }
  } catch {
    // Ignore quota errors
  }
}

export function getCachedSearchEntry(
  rawQuery: string
): { tracks: YouTubeTrack[]; isStale: boolean; cachedAt: number } | null {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return null;
  const entry = memoryCache.get(normalized);
  if (!entry || entry.tracks.length === 0) return null;
  const isStale = Date.now() - entry.cachedAt > SEARCH_CACHE_STALE_MS;
  return {
    tracks: entry.tracks,
    isStale,
    cachedAt: entry.cachedAt,
  };
}

export function getCachedVideoSearchEntry(
  rawQuery: string
): { tracks: YouTubeTrack[]; isStale: boolean; cachedAt: number } | null {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return null;
  const entry = videoMemoryCache.get(normalized);
  if (!entry || entry.tracks.length === 0) return null;
  const isStale = Date.now() - entry.cachedAt > SEARCH_CACHE_STALE_MS;
  return {
    tracks: entry.tracks,
    isStale,
    cachedAt: entry.cachedAt,
  };
}

export function getCachedSearchResults(rawQuery: string): YouTubeTrack[] | null {
  const entry = getCachedSearchEntry(rawQuery);
  return entry ? entry.tracks : null;
}

// ============================================================================
// User-Scoped LocalStorage Persistence (Strictly Isolated Per User ID)
// ============================================================================

function normalizeUserScope(userId?: string | null): string {
  const clean = (userId || 'guest').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return clean || 'guest';
}

function getLastPlayedStorageKey(userId?: string | null): string {
  return `kashish_ytm_last_played_v2_${normalizeUserScope(userId)}`;
}

function getLastSearchStorageKey(userId?: string | null): string {
  return `kashish_ytm_last_search_v2_${normalizeUserScope(userId)}`;
}

function getRecentSearchesStorageKey(userId?: string | null): string {
  return `kashish_ytm_recent_queries_v1_${normalizeUserScope(userId)}`;
}

export function loadUserLastPlayedTrack(userId?: string | null): YouTubeTrack | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(getLastPlayedStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as YouTubeTrack;
    if (parsed && typeof parsed.videoId === 'string' && parsed.videoId && parsed.title) {
      return {
        ...parsed,
        thumbnail: normalizeSquareThumbnail(parsed.thumbnail, parsed.videoId),
      };
    }
  } catch {}
  return null;
}

export function saveUserLastPlayedTrack(
  userId: string | null | undefined,
  track: YouTubeTrack | null
): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const key = getLastPlayedStorageKey(userId);
    if (!track) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(track));
      saveUserRecentPlayedTrack(userId, track);
    }
  } catch {}
}

function getRecentPlayedStorageKey(userId?: string | null): string {
  return `kashish_ytm_recent_played_v2_${normalizeUserScope(userId)}`;
}

export function loadUserRecentPlayedTracks(userId?: string | null): YouTubeTrack[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(getRecentPlayedStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((t): t is YouTubeTrack => t && typeof t.videoId === 'string' && t.videoId && t.title)
        .map((t) => ({
          ...t,
          thumbnail: normalizeSquareThumbnail(t.thumbnail, t.videoId),
        }));
    }
  } catch {}
  return [];
}

export function saveUserRecentPlayedTrack(
  userId?: string | null,
  track?: YouTubeTrack | null
): YouTubeTrack[] {
  if (!track || !track.videoId) return loadUserRecentPlayedTracks(userId);
  const current = loadUserRecentPlayedTracks(userId);
  const deduplicated = [
    track,
    ...current.filter((item) => item.videoId !== track.videoId),
  ].slice(0, 15);
  try {
    if (typeof window === 'undefined' || !window.localStorage) return deduplicated;
    window.localStorage.setItem(
      getRecentPlayedStorageKey(userId),
      JSON.stringify(deduplicated)
    );
  } catch {}
  return deduplicated;
}

export interface PersistedLastSearch {
  query: string;
  results: YouTubeTrack[];
  videoResults?: YouTubeTrack[];
  timestamp: number;
}

export function loadUserLastSearch(userId?: string | null): PersistedLastSearch | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(getLastSearchStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedLastSearch;
    if (
      parsed &&
      typeof parsed.query === 'string' &&
      parsed.query.trim() &&
      Array.isArray(parsed.results)
    ) {
      return {
        ...parsed,
        results: parsed.results.map((t) => ({
          ...t,
          thumbnail: normalizeSquareThumbnail(t.thumbnail, t.videoId),
        })),
        videoResults: Array.isArray(parsed.videoResults)
          ? parsed.videoResults.map((t) => ({
              ...t,
              mediaType: 'video',
              thumbnail: t.thumbnail || `https://i.ytimg.com/vi/${t.videoId}/mqdefault.jpg`,
            }))
          : [],
      };
    }
  } catch {}
  return null;
}

export function saveUserLastSearch(
  userId: string | null | undefined,
  query: string,
  results: YouTubeTrack[],
  videoResults?: YouTubeTrack[]
): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const trimmed = query.trim();
    if (!trimmed) return;
    const existing = loadUserLastSearch(userId);
    const effectiveVideos =
      videoResults !== undefined
        ? videoResults
        : existing && existing.query.toLowerCase() === trimmed.toLowerCase()
          ? existing.videoResults || []
          : [];
    const payload: PersistedLastSearch = {
      query: trimmed,
      results,
      videoResults: effectiveVideos,
      timestamp: Date.now(),
    };
    window.localStorage.setItem(getLastSearchStorageKey(userId), JSON.stringify(payload));
    if (results.length > 0) {
      saveToCache(trimmed.toLowerCase(), results);
    }
    if (effectiveVideos.length > 0) {
      saveToVideoCache(trimmed.toLowerCase(), effectiveVideos);
    }
  } catch {}
}

export function loadUserRecentSearches(userId?: string | null): string[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(getRecentSearchesStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
    }
  } catch {}
  return [];
}

export function saveUserRecentSearch(userId: string | null | undefined, query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return loadUserRecentSearches(userId);
  const current = loadUserRecentSearches(userId);
  const deduplicated = [
    trimmed,
    ...current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
  ].slice(0, 8);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        getRecentSearchesStorageKey(userId),
        JSON.stringify(deduplicated)
      );
    }
  } catch {}
  return deduplicated;
}

export function removeUserRecentSearch(
  userId: string | null | undefined,
  queryToRemove: string
): string[] {
  const current = loadUserRecentSearches(userId);
  const next = current.filter((item) => item.toLowerCase() !== queryToRemove.toLowerCase());
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(getRecentSearchesStorageKey(userId), JSON.stringify(next));
    }
  } catch {}
  return next;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const regex =
    /(?:(?:music\.)?youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}

function fetchWithTimeout(
  url: string,
  parentSignal?: AbortSignal,
  timeoutMs = 4200
): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      globalThis.clearTimeout(timer);
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  return fetch(url, { signal: controller.signal }).finally(() => {
    globalThis.clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  });
}

/**
 * Primary YouTube Music catalog search via the backend `/api/ytmusic/search` route
 * (which executes the sigma67/ytmusicapi WEB_REMIX InnerTube Songs search against music.youtube.com).
 */
async function searchViaBackendYTMusicApi(
  query: string,
  refresh = false,
  signal?: AbortSignal
): Promise<YouTubeTrack[]> {
  const endpoint = `/api/ytmusic/search?q=${encodeURIComponent(query)}&type=songs${refresh ? '&refresh=1' : ''}`;
  const res = await fetchWithTimeout(endpoint, signal, 4500);
  if (!res.ok) {
    let errDetail = `HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody?.error) errDetail = errBody.error;
    } catch {}
    throw new Error(`ytmusicapi backend error: ${errDetail}`);
  }
  const data = await res.json();
  const tracks: YouTubeTrack[] = Array.isArray(data?.tracks) ? data.tracks : [];
  if (tracks.length === 0) {
    throw new Error(`No YouTube Music catalog tracks returned for "${query}"`);
  }
  return tracks;
}

/**
 * Primary YouTube Videos search via backend `/api/ytmusic/search?type=videos`
 * (combines YouTube Music Videos + standard YouTube WEB video search).
 */
async function searchVideosViaBackendApi(
  query: string,
  refresh = false,
  signal?: AbortSignal
): Promise<YouTubeTrack[]> {
  const endpoint = `/api/ytmusic/search?q=${encodeURIComponent(query)}&type=videos${refresh ? '&refresh=1' : ''}`;
  const res = await fetchWithTimeout(endpoint, signal, 5000);
  if (!res.ok) {
    let errDetail = `HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody?.error) errDetail = errBody.error;
    } catch {}
    throw new Error(`video search backend error: ${errDetail}`);
  }
  const data = await res.json();
  const videos: YouTubeTrack[] = Array.isArray(data?.videos)
    ? data.videos
    : Array.isArray(data?.tracks)
      ? data.tracks
      : [];
  if (videos.length === 0) {
    throw new Error(`No YouTube videos returned for "${query}"`);
  }
  return videos.map((v) => ({
    ...v,
    mediaType: 'video',
    thumbnail: getHighResThumbnailUrl(v.videoId),
  }));
}

/**
 * Secondary YouTube Music catalog search (`filter=music_songs` ONLY — never generic YouTube videos)
 * used if running in a standalone static WebView where `/api/ytmusic/search` is not local.
 */
async function searchViaPipedMusicSongsOnly(
  baseUrl: string,
  query: string,
  signal?: AbortSignal
): Promise<YouTubeTrack[]> {
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&filter=music_songs`;
  const res = await fetchWithTimeout(url, signal, 4200);
  if (!res.ok) throw new Error(`YouTube Music catalog endpoint (${baseUrl}) HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  const tracks: YouTubeTrack[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const rawUrl: string = item?.url || '';
    const idMatch =
      rawUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || rawUrl.match(/\/([a-zA-Z0-9_-]{11})$/);
    const videoId = item?.id || (idMatch ? idMatch[1] : '');
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);

    const durSec = typeof item.duration === 'number' ? item.duration : 0;
    tracks.push({
      videoId,
      title: item.title || 'Untitled Song',
      artist: item.uploaderName || 'YouTube Music Artist',
      thumbnail: normalizeSquareThumbnail(item.thumbnail, videoId),
      durationText: formatDuration(durSec),
      durationSeconds: durSec,
      mediaType: 'song',
      catalogSource: 'youtube_music',
    });
  }

  // Fetch second page from Piped if available so standalone WebViews also get full song lists
  if (typeof data?.nextpage === 'string' && data.nextpage) {
    try {
      const nextUrl = `${baseUrl}/nextpage/search?nextpage=${encodeURIComponent(
        data.nextpage
      )}&q=${encodeURIComponent(query)}&filter=music_songs`;
      const nextRes = await fetchWithTimeout(nextUrl, signal, 3500);
      if (nextRes.ok) {
        const nextData = await nextRes.json();
        const nextItems = Array.isArray(nextData?.items) ? nextData.items : [];
        for (const item of nextItems) {
          const rawUrl: string = item?.url || '';
          const idMatch =
            rawUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || rawUrl.match(/\/([a-zA-Z0-9_-]{11})$/);
          const videoId = item?.id || (idMatch ? idMatch[1] : '');
          if (!videoId || seen.has(videoId)) continue;
          seen.add(videoId);
          const durSec = typeof item.duration === 'number' ? item.duration : 0;
          tracks.push({
            videoId,
            title: item.title || 'Untitled Song',
            artist: item.uploaderName || 'YouTube Music Artist',
            thumbnail: normalizeSquareThumbnail(item.thumbnail, videoId),
            durationText: formatDuration(durSec),
            durationSeconds: durSec,
            mediaType: 'song',
            catalogSource: 'youtube_music',
          });
        }
      }
    } catch {
      // Ignore nextpage error if first page succeeded
    }
  }

  if (tracks.length === 0) {
    throw new Error(`No YouTube Music songs found on ${baseUrl}`);
  }
  return tracks;
}

/**
 * Secondary Piped video search (`filter=videos` + `filter=music_videos`) for standalone APK/WebViews.
 */
async function searchViaPipedVideos(
  baseUrl: string,
  query: string,
  signal?: AbortSignal
): Promise<YouTubeTrack[]> {
  const [musicVideosOutcome, generalVideosOutcome] = await Promise.allSettled([
    fetchWithTimeout(`${baseUrl}/search?q=${encodeURIComponent(query)}&filter=music_videos`, signal, 4200).then(
      (r) => (r.ok ? r.json() : null)
    ),
    fetchWithTimeout(`${baseUrl}/search?q=${encodeURIComponent(query)}&filter=videos`, signal, 4200).then(
      (r) => (r.ok ? r.json() : null)
    ),
  ]);

  const combinedItems: any[] = [];
  if (musicVideosOutcome.status === 'fulfilled' && Array.isArray(musicVideosOutcome.value?.items)) {
    combinedItems.push(...musicVideosOutcome.value.items);
  }
  if (generalVideosOutcome.status === 'fulfilled' && Array.isArray(generalVideosOutcome.value?.items)) {
    combinedItems.push(...generalVideosOutcome.value.items);
  }

  const videos: YouTubeTrack[] = [];
  const seen = new Set<string>();

  for (const item of combinedItems) {
    const rawUrl: string = item?.url || '';
    const idMatch =
      rawUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || rawUrl.match(/\/([a-zA-Z0-9_-]{11})$/);
    const videoId = item?.id || (idMatch ? idMatch[1] : '');
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);

    const durSec = typeof item.duration === 'number' ? item.duration : 0;
    const views =
      typeof item.views === 'number' && item.views > 0
        ? item.views >= 1_000_000
          ? `${(item.views / 1_000_000).toFixed(1)}M views`
          : item.views >= 1_000
            ? `${Math.round(item.views / 1_000)}K views`
            : `${item.views} views`
        : undefined;

    videos.push({
      videoId,
      title: item.title || 'Untitled Video',
      artist: item.uploaderName?.replace(/ - Topic$/i, '') || 'YouTube Video',
      thumbnail: getHighResThumbnailUrl(videoId),
      durationText: formatDuration(durSec),
      durationSeconds: durSec,
      viewsText: views,
      mediaType: 'video',
      catalogSource: 'youtube_video',
    });
  }

  if (videos.length === 0) {
    throw new Error(`No YouTube videos found on ${baseUrl}`);
  }
  return videos;
}

async function resolveDirectVideoId(
  videoId: string,
  signal?: AbortSignal,
  mediaType: 'song' | 'video' = 'song'
): Promise<YouTubeTrack> {
  const res = await fetchWithTimeout(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    signal,
    3000
  );
  if (!res.ok) {
    throw new Error(`Invalid or unembeddable YouTube track ID (${videoId}): HTTP ${res.status}`);
  }
  const info = await res.json();
  return {
    videoId,
    title: info?.title || `Track ${videoId}`,
    artist: info?.author_name?.replace(/ - Topic$/i, '') || 'YouTube Artist',
    thumbnail: getHighResThumbnailUrl(videoId),
    durationText: 'Direct',
    mediaType,
    catalogSource: mediaType === 'video' ? 'youtube_video' : 'youtube_music',
  };
}

/**
 * Searches the genuine YouTube Music Song Catalog (`WEB_REMIX` InnerTube / `filter=music_songs`).
 */
export async function searchYouTubeSongs(
  rawQuery: string,
  signal?: AbortSignal,
  options?: { bypassCache?: boolean }
): Promise<YouTubeTrack[]> {
  const query = rawQuery.trim();
  if (!query) return [];

  // 1. Direct YouTube Music / YouTube video ID or URL
  const directId = extractYouTubeId(query);
  if (directId) {
    const track = await resolveDirectVideoId(directId, signal, 'song');
    return [track];
  }

  const normalizedKey = query.toLowerCase();

  // 2. Return cached results immediately unless bypassCache is requested
  if (!options?.bypassCache) {
    const cached = memoryCache.get(normalizedKey);
    if (cached && cached.tracks.length > 0) {
      return cached.tracks;
    }
  }

  // 3. Deduplicate in-flight requests for the same query
  const existingInFlight = inFlightSearches.get(normalizedKey);
  if (existingInFlight && !signal?.aborted && !options?.bypassCache) {
    return existingInFlight;
  }

  const raceController = new AbortController();
  const onAbort = () => raceController.abort();
  if (signal) {
    if (signal.aborted) {
      raceController.abort();
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  const searchPromise = (async () => {
    try {
      const nativeBridgeSearch = async (): Promise<YouTubeTrack[]> => {
        const bridge = typeof window !== 'undefined' ? (window as any).AndroidApp : null;
        if (!bridge || typeof bridge.searchYouTubeMusic !== 'function') {
          throw new Error('Native bridge search unavailable');
        }
        const rawJson = bridge.searchYouTubeMusic(query);
        const parsed = JSON.parse(rawJson || '[]');
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error('Empty native YTMusic response');
        }
        return parsed.map((t: any) => ({
          ...t,
          mediaType: 'song' as const,
          thumbnail: normalizeSquareThumbnail(t.thumbnail, t.videoId),
        }));
      };

      const isStaticHost =
        typeof window !== 'undefined' &&
        (window.location.hostname.endsWith('.web.app') ||
          window.location.hostname.endsWith('.firebaseapp.com'));
      const fallbackDelayMs = isStaticHost ? 0 : 150;

      const delayedPipedFallback = (baseUrl: string) =>
        new Promise<YouTubeTrack[]>((resolve, reject) => {
          const timer = globalThis.setTimeout(() => {
            searchViaPipedMusicSongsOnly(baseUrl, query, raceController.signal).then(resolve, reject);
          }, fallbackDelayMs);
          raceController.signal.addEventListener(
            'abort',
            () => {
              globalThis.clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true }
          );
        });

      const catalogProviders: Promise<YouTubeTrack[]>[] = [
        nativeBridgeSearch(),
        ...(isStaticHost
          ? []
          : [searchViaBackendYTMusicApi(query, Boolean(options?.bypassCache), raceController.signal)]),
        delayedPipedFallback('https://pipedapi.ducks.party'),
        delayedPipedFallback('https://api.piped.private.coffee'),
      ];

      const winner = (await Promise.any(catalogProviders)).map((t) => ({
        ...t,
        mediaType: 'song' as const,
        thumbnail: normalizeSquareThumbnail(t.thumbnail, t.videoId),
      }));
      raceController.abort();
      saveToCache(normalizedKey, winner);
      return winner;
    } catch (err: any) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const subErrors: string[] = Array.isArray(err?.errors)
        ? err.errors.map((e: any) => e?.message || String(e))
        : [err?.message || 'Unknown YouTube Music search error'];
      throw new Error(`YouTube Music catalog search failed: ${subErrors[0]}`);
    } finally {
      inFlightSearches.delete(normalizedKey);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  })();

  inFlightSearches.set(normalizedKey, searchPromise);
  return searchPromise;
}

/**
 * Searches YouTube Music Videos AND general YouTube Videos so any song that is missing
 * from the YouTube Music audio catalog still appears in the Videos section.
 */
export async function searchYouTubeVideos(
  rawQuery: string,
  signal?: AbortSignal,
  options?: { bypassCache?: boolean }
): Promise<YouTubeTrack[]> {
  const query = rawQuery.trim();
  if (!query) return [];

  const directId = extractYouTubeId(query);
  if (directId) {
    const track = await resolveDirectVideoId(directId, signal, 'video');
    return [track];
  }

  const normalizedKey = query.toLowerCase();

  if (!options?.bypassCache) {
    const cached = videoMemoryCache.get(normalizedKey);
    if (cached && cached.tracks.length > 0) {
      return cached.tracks;
    }
  }

  const existingInFlight = inFlightVideoSearches.get(normalizedKey);
  if (existingInFlight && !signal?.aborted && !options?.bypassCache) {
    return existingInFlight;
  }

  const raceController = new AbortController();
  const onAbort = () => raceController.abort();
  if (signal) {
    if (signal.aborted) {
      raceController.abort();
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  const videoSearchPromise = (async () => {
    try {
      const isStaticHost =
        typeof window !== 'undefined' &&
        (window.location.hostname.endsWith('.web.app') ||
          window.location.hostname.endsWith('.firebaseapp.com'));
      const fallbackDelayMs = isStaticHost ? 0 : 150;

      const delayedPipedVideoFallback = (baseUrl: string) =>
        new Promise<YouTubeTrack[]>((resolve, reject) => {
          const timer = globalThis.setTimeout(() => {
            searchViaPipedVideos(baseUrl, query, raceController.signal).then(resolve, reject);
          }, fallbackDelayMs);
          raceController.signal.addEventListener(
            'abort',
            () => {
              globalThis.clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true }
          );
        });

      const videoProviders: Promise<YouTubeTrack[]>[] = [
        ...(isStaticHost
          ? []
          : [searchVideosViaBackendApi(query, Boolean(options?.bypassCache), raceController.signal)]),
        delayedPipedVideoFallback('https://pipedapi.ducks.party'),
        delayedPipedVideoFallback('https://api.piped.private.coffee'),
      ];

      const winner = (await Promise.any(videoProviders)).map((t) => ({
        ...t,
        mediaType: 'video' as const,
        thumbnail: getHighResThumbnailUrl(t.videoId),
      }));
      raceController.abort();
      saveToVideoCache(normalizedKey, winner);
      return winner;
    } catch (err: any) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const subErrors: string[] = Array.isArray(err?.errors)
        ? err.errors.map((e: any) => e?.message || String(e))
        : [err?.message || 'Unknown YouTube Video search error'];
      throw new Error(`YouTube Video search failed: ${subErrors[0]}`);
    } finally {
      inFlightVideoSearches.delete(normalizedKey);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  })();

  inFlightVideoSearches.set(normalizedKey, videoSearchPromise);
  return videoSearchPromise;
}

/**
 * Revalidates a stale cached search query in the background without blocking UI.
 */
export async function refreshSearchInBackground(
  rawQuery: string
): Promise<{ songs: YouTubeTrack[] | null; videos: YouTubeTrack[] | null }> {
  const [songsRes, videosRes] = await Promise.allSettled([
    searchYouTubeSongs(rawQuery, undefined, { bypassCache: true }),
    searchYouTubeVideos(rawQuery, undefined, { bypassCache: true }),
  ]);
  return {
    songs: songsRes.status === 'fulfilled' ? songsRes.value : null,
    videos: videosRes.status === 'fulfilled' ? videosRes.value : null,
  };
}

const verifiedPlayableIdMap = new Map<string, string>();

export function getKnownPlayableVideoId(videoId: string): string {
  return verifiedPlayableIdMap.get(videoId) || videoId;
}

export function rememberPlayableAlternative(originalVideoId: string, workingVideoId: string): void {
  if (originalVideoId && workingVideoId) {
    verifiedPlayableIdMap.set(originalVideoId, workingVideoId);
  }
}

/**
 * Finds an embeddable YouTube video or song alternative if the primary track has
 * third-party embedding disabled by the uploader (YouTube Error 101 / 150 / 152).
 * Prioritizes standard YouTube videos and lyrical/audio uploads because Topic Art Tracks frequently block embeds.
 */
export async function findEmbeddableAlternative(
  track: YouTubeTrack,
  triedVideoIds: Set<string>,
  signal?: AbortSignal
): Promise<YouTubeTrack | null> {
  try {
    const cleanTitle = (track.title || '')
      .replace(/\(.*?\)|\[.*?\]/g, '')
      .replace(/official\s*(music\s*)?video|full\s*video|music\s*video|lyric\s*video/gi, '')
      .trim();
    const primaryArtist = (track.artist || '')
      .replace(/ - Topic$/i, '')
      .split(/[,&·|/]/)[0]
      .trim();
    const altQuery = `${cleanTitle || track.title} ${primaryArtist}`.trim();
    const [videosRes, songsRes] = await Promise.allSettled([
      searchYouTubeVideos(altQuery, signal),
      searchYouTubeSongs(`${altQuery} song`, signal),
    ]);
    const candidates: YouTubeTrack[] = [];
    if (videosRes.status === 'fulfilled') candidates.push(...videosRes.value);
    if (songsRes.status === 'fulfilled') candidates.push(...songsRes.value);

    const normalizeWords = (str: string) =>
      str
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2);

    const targetWords = normalizeWords(cleanTitle || track.title);

    // 1. Prefer candidates whose title contains the key words of the requested track
    for (const candidate of candidates) {
      if (!candidate.videoId || triedVideoIds.has(candidate.videoId)) continue;
      const candTitleLower = candidate.title.toLowerCase();
      if (
        targetWords.length === 0 ||
        targetWords.every((w) => candTitleLower.includes(w)) ||
        (targetWords.length >= 2 &&
          targetWords.slice(0, 2).every((w) => candTitleLower.includes(w)))
      ) {
        rememberPlayableAlternative(track.videoId, candidate.videoId);
        return candidate;
      }
    }

    // 2. Fallback to any candidate sharing at least the primary title word
    if (targetWords.length > 0) {
      const primaryWord = targetWords[0];
      for (const candidate of candidates) {
        if (
          candidate.videoId &&
          !triedVideoIds.has(candidate.videoId) &&
          candidate.title.toLowerCase().includes(primaryWord)
        ) {
          rememberPlayableAlternative(track.videoId, candidate.videoId);
          return candidate;
        }
      }
    }

    // 3. Final fallback: first untried candidate from the specific title+artist query
    for (const candidate of candidates) {
      if (candidate.videoId && !triedVideoIds.has(candidate.videoId)) {
        rememberPlayableAlternative(track.videoId, candidate.videoId);
        return candidate;
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Proactively verifies whether `track.videoId` is embeddable and warms up its stream/artwork
 * in the background so `Next` starts with near-zero delay.
 */
export async function preloadNextTrackResources(
  track: YouTubeTrack,
  isHighQuality: boolean,
  signal?: AbortSignal
): Promise<string> {
  if (!track?.videoId) return '';

  const knownId = verifiedPlayableIdMap.get(track.videoId);
  if (knownId) return knownId;

  // 1. Pre-warm thumbnail artwork according to Quality / Data Saver mode
  if (typeof window !== 'undefined' && typeof Image !== 'undefined') {
    const img = new Image();
    img.src = isHighQuality
      ? normalizeSquareThumbnail(track.thumbnail, track.videoId)
      : `https://i.ytimg.com/vi/${track.videoId}/mqdefault.jpg`;
  }

  // 2. Verify oEmbed availability; if 401/403/404, resolve an embeddable alternative ahead of time
  let playableId = track.videoId;
  try {
    const oembedRes = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(
        track.videoId
      )}&format=json`,
      signal,
      2800
    );
    if (oembedRes.ok) {
      verifiedPlayableIdMap.set(track.videoId, track.videoId);
    } else if (oembedRes.status === 401 || oembedRes.status === 403 || oembedRes.status === 404) {
      const alt = await findEmbeddableAlternative(track, new Set([track.videoId]), signal);
      if (alt?.videoId) {
        playableId = alt.videoId;
        verifiedPlayableIdMap.set(track.videoId, playableId);
      }
    }
  } catch {
    // Network/abort — keep original ID
  }

  if (signal?.aborted) return playableId;

  // 3. Warm server/native audio stream resolver & pre-buffer initial ~30s audio chunk (~480KB) when available
  try {
    const isStaticHost =
      typeof window !== 'undefined' &&
      (window.location.hostname.endsWith('.web.app') ||
        window.location.hostname.endsWith('.firebaseapp.com'));

    if (!isStaticHost) {
      const infoRes = await fetchWithTimeout(
        `/api/ytmusic/stream-info?videoId=${encodeURIComponent(playableId)}`,
        signal,
        3200
      );
      if (infoRes.ok && !signal?.aborted) {
        // Pre-buffer ~30 seconds of audio (~480KB at 128kbps; or ~192KB in Data Saver mode) into browser HTTP cache
        const preloadBytes = isHighQuality ? 491520 : 196608;
        void fetch(`/api/ytmusic/stream?videoId=${encodeURIComponent(playableId)}`, {
          headers: { Range: `bytes=0-${preloadBytes}` },
          signal,
        }).catch(() => {});
      }
    }
  } catch {
    // Ignore stream pre-buffer errors
  }

  return playableId;
}


const POPULAR_MUSIC_SUGGESTIONS: string[] = [
  'Tum Hi Ho Arijit Singh',
  'Kesariya Brahmastra',
  'Apna Bana Le Arijit Singh',
  'Pehle Bhi Main Vishal Mishra',
  'Satranga Animal',
  'O Maahi Dunki',
  'Chaleya Jawan',
  'Heeriye Jasleen Royal',
  'Raataan Lambiyan Shershaah',
  'Agar Tum Saath Ho',
  'Tere Hawaale Arijit Singh',
  'Sajni Laapataa Ladies',
  'Arijit Singh Romantic Hits',
  'Atif Aslam Best Songs',
  'Shreya Ghoshal Melodies',
  'KK Best Hindi Songs',
  'Zara Sa Jannat',
  'Tujh Mein Rab Dikhta Hai',
  'Kabira Yeh Jawaani Hai Deewani',
  'Ve Kamleya Rocky Aur Rani',
  'Phir Aur Kya Chahiye',
  'Husn Anuv Jain',
  'Diljit Dosanjh Hits',
  'Kishore Kumar Evergreen Songs',
  '90s Bollywood Romantic Songs',
  'Hindi Lo-Fi Chill Songs',
];

const suggestionMemoryCache = new Map<string, string[]>();

/**
 * Returns instant 0ms search suggestions combining recent user searches,
 * cached track titles/artists, and popular music queries.
 */
export function getInstantSuggestions(
  rawQuery: string,
  recentSearches: string[] = [],
  limit = 6
): string[] {
  const q = rawQuery.trim().toLowerCase();
  const seen = new Set<string>();
  const results: string[] = [];

  const pushUnique = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(clean);
  };

  if (!q) {
    for (const r of recentSearches) {
      pushUnique(r);
      if (results.length >= limit) return results;
    }
    for (const p of POPULAR_MUSIC_SUGGESTIONS) {
      pushUnique(p);
      if (results.length >= limit) return results;
    }
    return results;
  }

  // 1. Prefix matches in recent searches
  for (const r of recentSearches) {
    if (r.toLowerCase().includes(q)) {
      pushUnique(r);
      if (results.length >= limit) return results;
    }
  }

  // 2. Cached suggestions from previous network autocomplete
  const cachedNet = suggestionMemoryCache.get(q);
  if (cachedNet) {
    for (const item of cachedNet) {
      pushUnique(item);
      if (results.length >= limit) return results;
    }
  }

  // 3. Popular music suggestions matching prefix first, then substring
  for (const p of POPULAR_MUSIC_SUGGESTIONS) {
    if (p.toLowerCase().startsWith(q)) {
      pushUnique(p);
      if (results.length >= limit) return results;
    }
  }
  for (const p of POPULAR_MUSIC_SUGGESTIONS) {
    if (p.toLowerCase().includes(q)) {
      pushUnique(p);
      if (results.length >= limit) return results;
    }
  }

  // 4. Cached song/video titles from session memory
  for (const [, entry] of memoryCache.entries()) {
    for (const t of entry.tracks) {
      if (t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)) {
        pushUnique(`${t.title} - ${t.artist}`);
        if (results.length >= limit) return results;
      }
    }
  }

  return results;
}

/**
 * Fetches live YouTube search autocomplete suggestions combined with instant local matches
 * using pure fetch (never injecting cross-origin <script> tags).
 */
export async function fetchYouTubeSuggestions(
  rawQuery: string,
  recentSearches: string[] = [],
  signal?: AbortSignal,
  limit = 6
): Promise<string[]> {
  const query = rawQuery.trim();
  const instant = getInstantSuggestions(query, recentSearches, limit);
  if (!query) return instant;

  const key = query.toLowerCase();
  const cached = suggestionMemoryCache.get(key);
  if (cached && cached.length > 0) {
    return getInstantSuggestions(query, recentSearches, limit);
  }

  const fetchPipedSuggestions = async (baseUrl: string): Promise<string[]> => {
    const res = await fetchWithTimeout(
      `${baseUrl}/suggestions?query=${encodeURIComponent(query)}`,
      signal,
      2000
    );
    if (!res.ok) throw new Error('Piped suggestions failed');
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('Empty suggestions');
    return data.map((s: any) => String(s || '').trim()).filter(Boolean);
  };

  try {
    const liveList = await Promise.any([
      fetchPipedSuggestions('https://pipedapi.ducks.party'),
      fetchPipedSuggestions('https://api.piped.private.coffee'),
    ]);

    if (signal?.aborted) return instant;

    suggestionMemoryCache.set(key, liveList);
    const merged: string[] = [];
    const seen = new Set<string>();
    const add = (val: string) => {
      const clean = val.trim();
      if (!clean) return;
      const k = clean.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      merged.push(clean);
    };

    for (const r of recentSearches) {
      if (r.toLowerCase().includes(key)) add(r);
    }
    for (const s of liveList) {
      add(s);
      if (merged.length >= limit) break;
    }
    for (const i of instant) {
      if (merged.length >= limit) break;
      add(i);
    }
    return merged.slice(0, limit);
  } catch {
    return instant;
  }
}

