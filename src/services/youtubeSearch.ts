export interface YouTubeTrack {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail: string;
  durationText: string;
  durationSeconds?: number;
  catalogSource?: 'youtube_music';
}

interface CachedSearchItem {
  tracks: YouTubeTrack[];
  cachedAt: number;
}

const memoryCache = new Map<string, CachedSearchItem>();
const inFlightSearches = new Map<string, Promise<YouTubeTrack[]>>();
const SESSION_CACHE_KEY = 'kashish_ytmusic_catalog_cache_v3';
export const SEARCH_CACHE_STALE_MS = 5 * 60 * 1000; // 5 minutes Stale-While-Revalidate threshold

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
  return `kashish_ytm_last_search_v1_${normalizeUserScope(userId)}`;
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
      return parsed;
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
      return parsed;
    }
  } catch {}
  return null;
}

export function saveUserLastSearch(
  userId: string | null | undefined,
  query: string,
  results: YouTubeTrack[]
): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const trimmed = query.trim();
    if (!trimmed) return;
    const payload: PersistedLastSearch = {
      query: trimmed,
      results,
      timestamp: Date.now(),
    };
    window.localStorage.setItem(getLastSearchStorageKey(userId), JSON.stringify(payload));
    saveToCache(trimmed.toLowerCase(), results);
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
  const endpoint = `/api/ytmusic/search?q=${encodeURIComponent(query)}${refresh ? '&refresh=1' : ''}`;
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
      thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      durationText: formatDuration(durSec),
      durationSeconds: durSec,
      catalogSource: 'youtube_music',
    });
    if (tracks.length >= 15) break;
  }

  if (tracks.length === 0) {
    throw new Error(`No YouTube Music songs found on ${baseUrl}`);
  }
  return tracks;
}

async function resolveDirectVideoId(videoId: string, signal?: AbortSignal): Promise<YouTubeTrack> {
  const res = await fetchWithTimeout(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    signal,
    3000
  );
  if (!res.ok) {
    throw new Error(`Invalid or unembeddable YouTube Music track ID (${videoId}): HTTP ${res.status}`);
  }
  const info = await res.json();
  return {
    videoId,
    title: info?.title || `Track ${videoId}`,
    artist: info?.author_name?.replace(/ - Topic$/i, '') || 'YouTube Music Artist',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    durationText: 'Direct',
    catalogSource: 'youtube_music',
  };
}

/**
 * Searches the genuine YouTube Music Song Catalog (`WEB_REMIX` InnerTube / `filter=music_songs`).
 * Never silently reverts to generic YouTube video search.
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
    const track = await resolveDirectVideoId(directId, signal);
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
      // Primary: Our backend /api/ytmusic/search (sigma67/ytmusicapi WEB_REMIX InnerTube Songs catalog)
      // Fallback (for static/offline origin): YouTube Music filter=music_songs catalog endpoints ONLY
      const catalogProviders: Promise<YouTubeTrack[]>[] = [
        searchViaBackendYTMusicApi(query, Boolean(options?.bypassCache), raceController.signal),
        searchViaPipedMusicSongsOnly('https://pipedapi.ducks.party', query, raceController.signal),
        searchViaPipedMusicSongsOnly(
          'https://api.piped.private.coffee',
          query,
          raceController.signal
        ),
      ];

      const winner = await Promise.any(catalogProviders);
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
 * Revalidates a stale cached search query in the background without blocking UI.
 */
export async function refreshSearchInBackground(rawQuery: string): Promise<YouTubeTrack[] | null> {
  try {
    return await searchYouTubeSongs(rawQuery, undefined, { bypassCache: true });
  } catch {
    return null;
  }
}

/**
 * Finds an embeddable YouTube Music song alternative if the primary track has
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
    const results = await searchYouTubeSongs(altQuery);
    for (const candidate of results) {
      if (!triedVideoIds.has(candidate.videoId)) {
        return candidate;
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}
