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

export function normalizeSquareThumbnail(rawUrl: string | undefined, videoId: string): string {
  const clean = (rawUrl || '').trim();
  if (clean.includes('googleusercontent.com') || clean.includes('ggpht.com')) {
    return clean.replace(/=w\d+-h\d+[^&?]*/, '=w512-h512-l90-rj');
  }
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
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
  return `kashish_ytm_last_played_v1_${normalizeUserScope(userId)}`;
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
    }
  } catch {}
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
    thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
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
      thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
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
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
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

      const delayedPipedFallback = (baseUrl: string) =>
        new Promise<YouTubeTrack[]>((resolve, reject) => {
          const timer = globalThis.setTimeout(() => {
            searchViaPipedMusicSongsOnly(baseUrl, query, raceController.signal).then(resolve, reject);
          }, 900);
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
        searchViaBackendYTMusicApi(query, Boolean(options?.bypassCache), raceController.signal),
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
      const delayedPipedVideoFallback = (baseUrl: string) =>
        new Promise<YouTubeTrack[]>((resolve, reject) => {
          const timer = globalThis.setTimeout(() => {
            searchViaPipedVideos(baseUrl, query, raceController.signal).then(resolve, reject);
          }, 900);
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
        searchVideosViaBackendApi(query, Boolean(options?.bypassCache), raceController.signal),
        delayedPipedVideoFallback('https://pipedapi.ducks.party'),
        delayedPipedVideoFallback('https://api.piped.private.coffee'),
      ];

      const winner = (await Promise.any(videoProviders)).map((t) => ({
        ...t,
        mediaType: 'video' as const,
        thumbnail: `https://i.ytimg.com/vi/${t.videoId}/mqdefault.jpg`,
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

/**
 * Finds an embeddable YouTube Music song or video alternative if the primary track has
 * third-party embedding disabled by the uploader (YouTube Error 101 / 150).
 */
export async function findEmbeddableAlternative(
  track: YouTubeTrack,
  triedVideoIds: Set<string>
): Promise<YouTubeTrack | null> {
  try {
    const cleanTitle = track.title
      .replace(/\(official.*?\)/gi, '')
      .replace(/\[official.*?\]/gi, '')
      .replace(/official video|full video|music video/gi, '')
      .trim();
    const altQuery = `${cleanTitle} ${track.artist}`;
    const [songsRes, videosRes] = await Promise.allSettled([
      searchYouTubeSongs(altQuery),
      searchYouTubeVideos(altQuery),
    ]);
    const candidates: YouTubeTrack[] = [];
    if (songsRes.status === 'fulfilled') candidates.push(...songsRes.value);
    if (videosRes.status === 'fulfilled') candidates.push(...videosRes.value);

    for (const candidate of candidates) {
      if (!triedVideoIds.has(candidate.videoId)) {
        return candidate;
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}
