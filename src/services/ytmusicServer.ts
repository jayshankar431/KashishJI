import type { IncomingMessage, ServerResponse } from 'http';

export interface YTMusicSongResult {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail: string;
  durationText: string;
  durationSeconds?: number;
  catalogSource: 'youtube_music';
}

interface ServerCacheEntry {
  tracks: YTMusicSongResult[];
  cachedAt: number;
}

const serverCache = new Map<string, ServerCacheEntry>();
const SERVER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Exact protobuf filter used by sigma67/ytmusicapi for filter="songs" (YouTube Music catalog songs)
const YTMUSIC_SONGS_FILTER_PARAMS = 'EgWKAQIIAWoKEAkQBRAKEAMQBA==';

function parseDurationToSeconds(text: string): number {
  const parts = text.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

/**
 * Parses YouTube Music WEB_REMIX InnerTube search response using the same structure
 * as sigma67/ytmusicapi's parser/songs.py (`musicResponsiveListItemRenderer`).
 */
export function parseYTMusicSearchResponse(data: any): YTMusicSongResult[] {
  const results: YTMusicSongResult[] = [];
  const seen = new Set<string>();

  const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs || [];
  const sections =
    tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ||
    data?.contents?.sectionListRenderer?.contents ||
    [];

  for (const section of sections) {
    const shelf = section?.musicShelfRenderer;
    if (!shelf || !Array.isArray(shelf.contents)) continue;

    for (const item of shelf.contents) {
      const m = item?.musicResponsiveListItemRenderer;
      if (!m) continue;

      const flexCols: any[] = Array.isArray(m.flexColumns) ? m.flexColumns : [];
      const col0Runs: any[] =
        flexCols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const col1Runs: any[] =
        flexCols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];

      const videoId: string =
        m?.playlistItemData?.videoId ||
        col0Runs[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
        m?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
          ?.playNavigationEndpoint?.watchEndpoint?.videoId ||
        '';

      if (!videoId || seen.has(videoId)) continue;

      const title: string = col0Runs.map((r) => r?.text || '').join('').trim();
      if (!title) continue;

      const artists: string[] = [];
      let album = '';
      let durationText = '';

      for (const run of col1Runs) {
        const text = String(run?.text || '').trim();
        if (!text || text === '•' || text === '&' || text === ',') continue;

        const pageType: string =
          run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
            ?.browseEndpointContextMusicConfig?.pageType || '';

        if (
          pageType === 'MUSIC_PAGE_TYPE_ARTIST' ||
          pageType === 'MUSIC_PAGE_TYPE_USER_CHANNEL'
        ) {
          artists.push(text);
        } else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM') {
          album = text;
        } else if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) {
          durationText = text;
        }
      }

      // Fallback if artist runs didn't carry a browseEndpoint (e.g. unlinked artist credit)
      if (artists.length === 0 && col1Runs.length > 0) {
        const firstText = String(col1Runs[0]?.text || '').trim();
        if (firstText && firstText !== 'Song' && !/^\d{1,2}:\d{2}$/.test(firstText)) {
          artists.push(firstText);
        } else if (col1Runs.length >= 3) {
          const thirdText = String(col1Runs[2]?.text || '').trim();
          if (thirdText && !/^\d{1,2}:\d{2}$/.test(thirdText)) {
            artists.push(thirdText);
          }
        }
      }

      const thumbs: Array<{ url?: string; width?: number; height?: number }> =
        m?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      const rawThumb =
        thumbs[thumbs.length - 1]?.url ||
        thumbs[0]?.url ||
        `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

      // Upgrade square YouTube Music album artwork to crisp 226x226
      const thumbnail = rawThumb.replace(/=w\d+-h\d+/, '=w226-h226');
      const durationSeconds = durationText ? parseDurationToSeconds(durationText) : undefined;

      seen.add(videoId);
      results.push({
        videoId,
        title,
        artist: artists.join(', ') || 'YouTube Music Artist',
        album: album || undefined,
        thumbnail,
        durationText,
        durationSeconds,
        catalogSource: 'youtube_music',
      });

      if (results.length >= 15) break;
    }
    if (results.length >= 15) break;
  }

  return results;
}

/**
 * Executes a genuine YouTube Music catalog search (`WEB_REMIX` InnerTube API with `songs` filter),
 * matching `sigma67/ytmusicapi` (`YTMusic().search(query, filter="songs")`).
 */
export async function queryYouTubeMusicCatalog(
  rawQuery: string,
  bypassCache = false
): Promise<{ tracks: YTMusicSongResult[]; cached: boolean }> {
  const query = rawQuery.trim();
  if (!query) {
    return { tracks: [], cached: false };
  }

  const key = query.toLowerCase();
  if (!bypassCache) {
    const hit = serverCache.get(key);
    if (hit && Date.now() - hit.cachedAt < SERVER_CACHE_TTL_MS && hit.tracks.length > 0) {
      return { tracks: hit.tracks, cached: true };
    }
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
        Origin: 'https://music.youtube.com',
        Referer: 'https://music.youtube.com/',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20250120.01.00',
            hl: 'en',
            gl: 'IN',
          },
        },
        query,
        params: YTMIC_SONGS_PARAM_SAFE(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`YouTube Music InnerTube HTTP ${response.status}`);
    }

    const data = await response.json();
    const tracks = parseYTMusicSearchResponse(data);
    if (tracks.length === 0) {
      throw new Error(`No YouTube Music songs found for "${query}"`);
    }

    if (serverCache.size > 150) {
      const oldestKey = serverCache.keys().next().value;
      if (oldestKey) serverCache.delete(oldestKey);
    }
    serverCache.set(key, { tracks, cachedAt: Date.now() });

    return { tracks, cached: false };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function YTMIC_SONGS_PARAM_SAFE(): string {
  return YTMUSIC_SONGS_FILTER_PARAMS;
}

/**
 * Connect/Vite HTTP middleware handler for `/api/ytmusic/search?q=...`
 */
export function createYTMusicSearchMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url || !req.url.startsWith('/api/ytmusic/search')) {
      next();
      return;
    }

    // Support CORS for preview/WebView origins
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const q = (parsedUrl.searchParams.get('q') || '').trim();
      const refresh = parsedUrl.searchParams.get('refresh') === '1';

      if (!q) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing search query parameter "q"' }));
        return;
      }

      const t0 = performance.now();
      const { tracks, cached } = await queryYouTubeMusicCatalog(q, refresh);
      const elapsedMs = Math.round(performance.now() - t0);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
      res.end(
        JSON.stringify({
          query: q,
          source: 'ytmusicapi_web_remix',
          serverCached: cached,
          serverLatencyMs: elapsedMs,
          tracks,
        })
      );
    } catch (err: any) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: err?.message || 'YouTube Music catalog search failed',
          source: 'ytmusicapi_web_remix',
        })
      );
    }
  };
}
