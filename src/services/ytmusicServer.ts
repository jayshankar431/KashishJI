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

function parseShelfItems(
  items: any[],
  seen: Set<string>,
  results: YTMusicSongResult[]
): void {
  for (const item of items) {
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

    // Upgrade square YouTube Music album artwork to crisp 512x512 1:1, or use clean mqdefault (no 4:3 black bars)
    const thumbnail =
      rawThumb.includes('googleusercontent.com') || rawThumb.includes('ggpht.com')
        ? rawThumb.replace(/=w\d+-h\d+[^&?]*/, '=w512-h512-l90-rj')
        : `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
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
  }
}

function extractContinuationToken(data: any): string | null {
  const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs || [];
  const sections =
    tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ||
    data?.contents?.sectionListRenderer?.contents ||
    [];

  for (const section of sections) {
    const token =
      section?.musicShelfRenderer?.continuations?.[0]?.nextContinuationData?.continuation;
    if (typeof token === 'string' && token) return token;
  }

  const contToken =
    data?.continuationContents?.musicShelfContinuation?.continuations?.[0]?.nextContinuationData
      ?.continuation;
  if (typeof contToken === 'string' && contToken) return contToken;

  return null;
}

/**
 * Parses YouTube Music WEB_REMIX InnerTube search response using the same structure
 * as sigma67/ytmusicapi's parser/songs.py (`musicResponsiveListItemRenderer`).
 */
export function parseYTMusicSearchResponse(
  data: any,
  seen: Set<string> = new Set<string>(),
  results: YTMusicSongResult[] = []
): YTMusicSongResult[] {
  const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs || [];
  const sections =
    tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ||
    data?.contents?.sectionListRenderer?.contents ||
    [];

  for (const section of sections) {
    const shelf = section?.musicShelfRenderer;
    if (!shelf || !Array.isArray(shelf.contents)) continue;
    parseShelfItems(shelf.contents, seen, results);
  }

  const continuationContents = data?.continuationContents?.musicShelfContinuation?.contents;
  if (Array.isArray(continuationContents)) {
    parseShelfItems(continuationContents, seen, results);
  }

  return results;
}

/**
 * Executes a genuine YouTube Music catalog search (`WEB_REMIX` InnerTube API with `songs` filter),
 * matching `sigma67/ytmusicapi` (`YTMusic().search(query, filter="songs")`), and fetches
 * continuation pages so all matching songs are returned without a 15-song limit.
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
  const timeout = globalThis.setTimeout(() => controller.abort(), 6500);

  const clientContext = {
    client: {
      clientName: 'WEB_REMIX',
      clientVersion: '1.20250120.01.00',
      hl: 'en',
      gl: 'IN',
    },
  };

  const requestHeaders = {
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    Origin: 'https://music.youtube.com',
    Referer: 'https://music.youtube.com/',
  };

  try {
    const response = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        context: clientContext,
        query,
        params: YTMIC_SONGS_PARAM_SAFE(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`YouTube Music InnerTube HTTP ${response.status}`);
    }

    const data = await response.json();
    const seen = new Set<string>();
    const tracks: YTMusicSongResult[] = [];
    parseYTMusicSearchResponse(data, seen, tracks);

    // Fetch up to 2 continuation pages from YouTube Music so search returns 50-60+ songs
    let nextContinuation = extractContinuationToken(data);
    for (let page = 0; page < 2 && nextContinuation; page++) {
      try {
        const contUrl = `https://music.youtube.com/youtubei/v1/search?ctoken=${encodeURIComponent(
          nextContinuation
        )}&continuation=${encodeURIComponent(nextContinuation)}&type=next&prettyPrint=false`;
        const contRes = await fetch(contUrl, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({ context: clientContext }),
          signal: controller.signal,
        });
        if (!contRes.ok) break;
        const contData = await contRes.json();
        const prevCount = tracks.length;
        parseYTMusicSearchResponse(contData, seen, tracks);
        if (tracks.length === prevCount) break;
        nextContinuation = extractContinuationToken(contData);
      } catch {
        break;
      }
    }

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

export interface CloudinaryFolderResource {
  publicId: string;
  url: string;
  resourceType: 'image' | 'video';
  caption: string;
  createdAt: number;
  format?: string;
}

function cleanCaptionFromPublicId(publicId: string, customCaption?: string, displayName?: string): string {
  if (customCaption && customCaption.trim()) return customCaption.trim();
  const base = (displayName || publicId.split('/').pop() || 'Memory of Kashish').trim();
  // Strip random Cloudinary suffixes like _a1b2c3 or file extensions
  const withoutExt = base.replace(/\.[a-zA-Z0-9]+$/, '');
  const withoutSuffix = withoutExt.replace(/_[a-z0-9]{6}$/i, '');
  const readable = withoutSuffix.replace(/[-_]+/g, ' ').trim();
  if (
    !readable ||
    /^(img|dsc|vid|pxl|whatsapp|screenshot|photo|image|upload)\b/i.test(readable) ||
    /^\d+$/.test(readable)
  ) {
    return 'Sweet memory of Kashish 💖';
  }
  return readable;
}

async function fetchCloudinaryFolderResources(
  cloudName: string,
  folder: string,
  apiKey?: string,
  apiSecret?: string
): Promise<CloudinaryFolderResource[]> {
  const cleanCloud = cloudName.trim();
  const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, '') || 'kashish-memories';
  if (!cleanCloud) return [];

  const mapRawResource = (r: any): CloudinaryFolderResource | null => {
    const publicId = String(r?.public_id || '').trim();
    if (!publicId) return null;
    const resType: 'image' | 'video' = r?.resource_type === 'video' ? 'video' : 'image';
    const format = String(r?.format || (resType === 'video' ? 'mp4' : 'jpg')).trim();
    const version = r?.version ? `v${r.version}/` : '';
    const secureUrl =
      r?.secure_url ||
      `https://res.cloudinary.com/${encodeURIComponent(cleanCloud)}/${resType}/upload/${version}${publicId}.${format}`;
    const customCaption =
      r?.context?.custom?.caption ||
      r?.context?.custom?.alt ||
      r?.context?.caption ||
      r?.context?.alt ||
      '';
    const createdAt = r?.created_at ? new Date(r.created_at).getTime() || Date.now() : Date.now();
    return {
      publicId,
      url: secureUrl,
      resourceType: resType,
      caption: cleanCaptionFromPublicId(publicId, customCaption, r?.display_name || r?.filename),
      createdAt,
      format,
    };
  };

  // 1. Authenticated Cloudinary Admin Search API + Prefix Fallback (when API Key & API Secret are configured)
  if (apiKey && apiSecret) {
    const basicAuth = Buffer.from(`${apiKey.trim()}:${apiSecret.trim()}`).toString('base64');
    const authHeaders = {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    };

    try {
      const folderExpr =
        cleanFolder === 'kashish-memories'
          ? `folder="kashish-memories" OR folder="kashish-memories/*" OR asset_folder="kashish-memories" OR asset_folder="kashish-memories/*" OR public_id:kashish-memories/* OR tags="kashish-memories" OR folder="memories_of_kashish" OR asset_folder="memories_of_kashish" OR public_id:memories_of_kashish/*`
          : `folder="${cleanFolder}" OR folder="${cleanFolder}/*" OR asset_folder="${cleanFolder}" OR asset_folder="${cleanFolder}/*" OR public_id:${cleanFolder}/* OR tags="${cleanFolder}"`;

      // Search across Fixed Folder (`folder`), Dynamic Folder (`asset_folder`), public_id prefix, and tags
      const searchResp = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cleanCloud)}/resources/search`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            expression: folderExpr,
            with_field: ['context', 'tags'],
            sort_by: [{ created_at: 'desc' }],
            max_results: 100,
          }),
        }
      );

      if (searchResp.ok) {
        const searchJson = await searchResp.json();
        if (Array.isArray(searchJson?.resources) && searchJson.resources.length > 0) {
          return searchJson.resources
            .map(mapRawResource)
            .filter((x: CloudinaryFolderResource | null): x is CloudinaryFolderResource => x !== null);
        }
      }
    } catch {
      // Fall through to prefix resource listing
    }

    try {
      const prefixResp = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(
          cleanCloud
        )}/resources/image/upload?prefix=${encodeURIComponent(
          cleanFolder
        )}&context=true&max_results=100`,
        {
          method: 'GET',
          headers: { Authorization: `Basic ${basicAuth}` },
        }
      );
      if (prefixResp.ok) {
        const prefixJson = await prefixResp.json();
        if (Array.isArray(prefixJson?.resources) && prefixJson.resources.length > 0) {
          return prefixJson.resources
            .map(mapRawResource)
            .filter((x: CloudinaryFolderResource | null): x is CloudinaryFolderResource => x !== null);
        }
      }
    } catch {
      // Fall through to public client-side list
    }
  }

  // 2. Public Client-Side Resource List Fallback (`https://res.cloudinary.com/{cloudName}/image/list/{folder}.json`)
  try {
    const listResp = await fetch(
      `https://res.cloudinary.com/${encodeURIComponent(cleanCloud)}/image/list/${encodeURIComponent(
        cleanFolder
      )}.json`
    );
    if (listResp.ok) {
      const listJson = await listResp.json();
      if (Array.isArray(listJson?.resources)) {
        return listJson.resources
          .map(mapRawResource)
          .filter((x: CloudinaryFolderResource | null): x is CloudinaryFolderResource => x !== null);
      }
    }
  } catch {}

  return [];
}

/**
 * Connect/Vite HTTP middleware handler for `/api/ytmusic/search?q=...` and `/api/cloudinary-folder`
 */
export function createYTMusicSearchMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url) {
      next();
      return;
    }

    if (req.url.startsWith('/api/cloudinary-folder')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        const cloudName = (
          parsedUrl.searchParams.get('cloudName') ||
          process.env.VITE_CLOUDINARY_CLOUD_NAME ||
          'dsfcu9y1h'
        ).trim();
        const folder = (
          parsedUrl.searchParams.get('folder') ||
          'kashish-memories'
        ).trim();
        const apiKey = (
          parsedUrl.searchParams.get('apiKey') ||
          process.env.VITE_CLOUDINARY_API_KEY ||
          ''
        ).trim();
        const apiSecret = (
          parsedUrl.searchParams.get('apiSecret') ||
          process.env.VITE_CLOUDINARY_API_SECRET ||
          ''
        ).trim();

        const resources = await fetchCloudinaryFolderResources(
          cloudName,
          folder,
          apiKey,
          apiSecret
        );

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(
          JSON.stringify({
            cloudName,
            folder,
            count: resources.length,
            resources,
          })
        );
      } catch (err: any) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: err?.message || 'Cloudinary folder fetch failed',
            resources: [],
          })
        );
      }
      return;
    }

    if (!req.url.startsWith('/api/ytmusic/search')) {
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
