import type { IncomingMessage, ServerResponse } from 'http';

export interface YTMusicSongResult {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail: string;
  durationText: string;
  durationSeconds?: number;
  viewsText?: string;
  mediaType?: 'song' | 'video';
  catalogSource: 'youtube_music' | 'youtube_video';
}

interface ServerCacheEntry {
  tracks: YTMusicSongResult[];
  cachedAt: number;
}

export interface ResolvedAudioStream {
  videoId: string;
  url: string;
  mimeType: string;
  bitrate: number;
  contentLength?: number;
  durationSeconds?: number;
  expiresAt: number;
}

const serverCache = new Map<string, ServerCacheEntry>();
const serverVideoCache = new Map<string, ServerCacheEntry>();
const streamUrlCache = new Map<string, ResolvedAudioStream>();
const SERVER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const STREAM_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

// Exact protobuf filter used by sigma67/ytmusicapi for filter="songs" (YouTube Music catalog songs)
const YTMUSIC_SONGS_FILTER_PARAMS = 'EgWKAQIIAWoKEAkQBRAKEAMQBA==';
// Exact protobuf filter used by sigma67/ytmusicapi for filter="videos" (YouTube Music catalog videos)
const YTMUSIC_VIDEOS_FILTER_PARAMS = 'EgWKAQIQAWoKEAkQChAFEAMQBA==';

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
  results: YTMusicSongResult[],
  mediaType: 'song' | 'video' = 'song'
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
    let viewsText = '';

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
      } else if (/views$/i.test(text)) {
        viewsText = text;
      }
    }

    // Fallback if artist runs didn't carry a browseEndpoint (e.g. unlinked artist credit or video channel)
    if (artists.length === 0 && col1Runs.length > 0) {
      const firstText = String(col1Runs[0]?.text || '').trim();
      if (
        firstText &&
        firstText !== 'Song' &&
        firstText !== 'Video' &&
        firstText !== 'Episode' &&
        !/^\d{1,2}:\d{2}$/.test(firstText) &&
        !/views$/i.test(firstText)
      ) {
        artists.push(firstText);
      } else if (col1Runs.length >= 3) {
        const thirdText = String(col1Runs[2]?.text || '').trim();
        if (thirdText && !/^\d{1,2}:\d{2}$/.test(thirdText) && !/views$/i.test(thirdText)) {
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

    // Upgrade square YouTube Music album artwork to crisp 512x512 1:1, or use clean mqdefault
    const thumbnail =
      mediaType === 'song' &&
      (rawThumb.includes('googleusercontent.com') || rawThumb.includes('ggpht.com'))
        ? rawThumb.replace(/=w\d+-h\d+[^&?]*/, '=w512-h512-l90-rj')
        : `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    const durationSeconds = durationText ? parseDurationToSeconds(durationText) : undefined;

    seen.add(videoId);
    results.push({
      videoId,
      title,
      artist: artists.join(', ') || (mediaType === 'video' ? 'YouTube Video' : 'YouTube Music Artist'),
      album: album || undefined,
      thumbnail,
      durationText,
      durationSeconds,
      viewsText: viewsText || undefined,
      mediaType,
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
  results: YTMusicSongResult[] = [],
  mediaType: 'song' | 'video' = 'song'
): YTMusicSongResult[] {
  const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs || [];
  const sections =
    tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ||
    data?.contents?.sectionListRenderer?.contents ||
    [];

  for (const section of sections) {
    const shelf = section?.musicShelfRenderer;
    if (!shelf || !Array.isArray(shelf.contents)) continue;
    parseShelfItems(shelf.contents, seen, results, mediaType);
  }

  const continuationContents = data?.continuationContents?.musicShelfContinuation?.contents;
  if (Array.isArray(continuationContents)) {
    parseShelfItems(continuationContents, seen, results, mediaType);
  }

  return results;
}

/**
 * Parses standard YouTube WEB InnerTube search results (`videoRenderer`) so songs/videos
 * that are not indexed in YouTube Music at all still appear in the Videos section.
 */
function parseStandardYouTubeWebVideos(
  data: any,
  seen: Set<string>,
  results: YTMusicSongResult[]
): void {
  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
      ?.contents || [];

  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const v = item?.videoRenderer;
      if (!v) continue;

      const videoId = String(v?.videoId || '').trim();
      if (!videoId || seen.has(videoId)) continue;

      const title =
        (Array.isArray(v?.title?.runs)
          ? v.title.runs.map((r: any) => r?.text || '').join('')
          : v?.title?.simpleText) || '';
      const cleanTitle = String(title).trim();
      if (!cleanTitle) continue;

      const artist =
        v?.ownerText?.runs?.[0]?.text ||
        v?.longBylineText?.runs?.[0]?.text ||
        v?.shortBylineText?.runs?.[0]?.text ||
        'YouTube';

      const durationText = String(
        v?.lengthText?.simpleText ||
          (Array.isArray(v?.lengthText?.runs)
            ? v.lengthText.runs.map((r: any) => r?.text || '').join('')
            : '') ||
          ''
      ).trim();

      const viewsText = String(
        v?.shortViewCountText?.simpleText ||
          (Array.isArray(v?.shortViewCountText?.runs)
            ? v.shortViewCountText.runs.map((r: any) => r?.text || '').join('')
            : '') ||
          v?.viewCountText?.simpleText ||
          ''
      ).trim();

      const durationSeconds = durationText ? parseDurationToSeconds(durationText) : undefined;

      seen.add(videoId);
      results.push({
        videoId,
        title: cleanTitle,
        artist: String(artist).trim().replace(/ - Topic$/i, '') || 'YouTube',
        thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        durationText,
        durationSeconds,
        viewsText: viewsText || undefined,
        mediaType: 'video',
        catalogSource: 'youtube_video',
      });
    }
  }
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
    parseYTMusicSearchResponse(data, seen, tracks, 'song');

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
        parseYTMusicSearchResponse(contData, seen, tracks, 'song');
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

/**
 * Queries both YouTube Music Videos (`filter="videos"`) AND standard YouTube Videos (`WEB` InnerTube)
 * so that any song not available as an audio track in YouTube Music is guaranteed to appear in Videos.
 */
export async function queryYouTubeVideosCatalog(
  rawQuery: string,
  bypassCache = false
): Promise<{ videos: YTMusicSongResult[]; cached: boolean }> {
  const query = rawQuery.trim();
  if (!query) {
    return { videos: [], cached: false };
  }

  const key = query.toLowerCase();
  if (!bypassCache) {
    const hit = serverVideoCache.get(key);
    if (hit && Date.now() - hit.cachedAt < SERVER_CACHE_TTL_MS && hit.tracks.length > 0) {
      return { videos: hit.tracks, cached: true };
    }
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 6500);

  const ytmClientContext = {
    client: {
      clientName: 'WEB_REMIX',
      clientVersion: '1.20250120.01.00',
      hl: 'en',
      gl: 'IN',
    },
  };

  const ytWebClientContext = {
    client: {
      clientName: 'WEB',
      clientVersion: '2.20250120.00.00',
      hl: 'en',
      gl: 'IN',
    },
  };

  const ytmHeaders = {
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    Origin: 'https://music.youtube.com',
    Referer: 'https://music.youtube.com/',
  };

  const ytWebHeaders = {
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    Origin: 'https://www.youtube.com',
    Referer: 'https://www.youtube.com/',
  };

  try {
    const fetchYTMusicVideos = async (): Promise<YTMusicSongResult[]> => {
      const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: ytmHeaders,
        body: JSON.stringify({
          context: ytmClientContext,
          query,
          params: YTMUSIC_VIDEOS_FILTER_PARAMS,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const data = await res.json();
      const localSeen = new Set<string>();
      const list: YTMusicSongResult[] = [];
      parseYTMusicSearchResponse(data, localSeen, list, 'video');

      const nextContinuation = extractContinuationToken(data);
      if (nextContinuation) {
        try {
          const contUrl = `https://music.youtube.com/youtubei/v1/search?ctoken=${encodeURIComponent(
            nextContinuation
          )}&continuation=${encodeURIComponent(nextContinuation)}&type=next&prettyPrint=false`;
          const contRes = await fetch(contUrl, {
            method: 'POST',
            headers: ytmHeaders,
            body: JSON.stringify({ context: ytmClientContext }),
            signal: controller.signal,
          });
          if (contRes.ok) {
            const contData = await contRes.json();
            parseYTMusicSearchResponse(contData, localSeen, list, 'video');
          }
        } catch {}
      }
      return list;
    };

    const fetchStandardYouTubeVideos = async (): Promise<YTMusicSongResult[]> => {
      const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: ytWebHeaders,
        body: JSON.stringify({
          context: ytWebClientContext,
          query,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const data = await res.json();
      const localSeen = new Set<string>();
      const list: YTMusicSongResult[] = [];
      parseStandardYouTubeWebVideos(data, localSeen, list);
      return list;
    };

    const [ytmOutcome, ytWebOutcome] = await Promise.allSettled([
      fetchYTMusicVideos(),
      fetchStandardYouTubeVideos(),
    ]);

    const seen = new Set<string>();
    const videos: YTMusicSongResult[] = [];

    if (ytmOutcome.status === 'fulfilled') {
      for (const item of ytmOutcome.value) {
        if (!seen.has(item.videoId)) {
          seen.add(item.videoId);
          videos.push(item);
        }
      }
    }

    if (ytWebOutcome.status === 'fulfilled') {
      for (const item of ytWebOutcome.value) {
        if (!seen.has(item.videoId)) {
          seen.add(item.videoId);
          videos.push(item);
        }
      }
    }

    if (videos.length === 0) {
      throw new Error(`No YouTube videos found for "${query}"`);
    }

    if (serverVideoCache.size > 150) {
      const oldestKey = serverVideoCache.keys().next().value;
      if (oldestKey) serverVideoCache.delete(oldestKey);
    }
    serverVideoCache.set(key, { tracks: videos, cachedAt: Date.now() });

    return { videos, cached: false };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function YTMIC_SONGS_PARAM_SAFE(): string {
  return YTMUSIC_SONGS_FILTER_PARAMS;
}

/**
 * Resolves a direct audio stream URL (audio/mp4 m4a or audio/webm opus) for a YouTube videoId
 * using the YouTube InnerTube ANDROID_VR player API.
 */
export async function resolveYouTubeAudioStream(
  rawVideoId: string,
  bypassCache = false
): Promise<ResolvedAudioStream> {
  const videoId = rawVideoId.trim();
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
    throw new Error('Invalid YouTube videoId');
  }

  if (!bypassCache) {
    const cached = streamUrlCache.get(videoId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached;
    }
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 6500);

  try {
    const response = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 14; en_US; Quest 3; Build/UP1A.231005.007.A1; Cronet/132.0.6808.3)',
        'X-Goog-Api-Format-Version': '2',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID_VR',
            clientVersion: '1.60.19',
            androidSdkVersion: 34,
            osName: 'Android',
            osVersion: '14',
            hl: 'en',
            gl: 'IN',
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`InnerTube player HTTP ${response.status}`);
    }

    const data = await response.json();
    const adaptiveFormats: any[] = Array.isArray(data?.streamingData?.adaptiveFormats)
      ? data.streamingData.adaptiveFormats
      : [];
    const standardFormats: any[] = Array.isArray(data?.streamingData?.formats)
      ? data.streamingData.formats
      : [];

    const audioFormats = [...adaptiveFormats, ...standardFormats].filter(
      (f) => typeof f?.url === 'string' && f.url.startsWith('http') && String(f?.mimeType || '').startsWith('audio/')
    );

    if (audioFormats.length === 0) {
      throw new Error(
        data?.playabilityStatus?.reason || 'No direct audio formats returned for this track'
      );
    }

    // Prefer audio/mp4 (itag 140 / m4a) for universal compatibility across Android WebView, Chrome, and iOS Safari,
    // then sort by highest bitrate.
    audioFormats.sort((a, b) => {
      const aIsMp4 = String(a.mimeType || '').includes('audio/mp4') ? 1 : 0;
      const bIsMp4 = String(b.mimeType || '').includes('audio/mp4') ? 1 : 0;
      if (aIsMp4 !== bIsMp4) return bIsMp4 - aIsMp4;
      return (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
    });

    const chosen = audioFormats[0];
    const cleanMime = String(chosen.mimeType || 'audio/mp4').split(';')[0].trim() || 'audio/mp4';
    const contentLength = chosen.contentLength ? Number(chosen.contentLength) : undefined;
    const durationSeconds = data?.videoDetails?.lengthSeconds
      ? Number(data.videoDetails.lengthSeconds)
      : chosen.approxDurationMs
      ? Math.round(Number(chosen.approxDurationMs) / 1000)
      : undefined;

    const resolved: ResolvedAudioStream = {
      videoId,
      url: chosen.url,
      mimeType: cleanMime,
      bitrate: Number(chosen.bitrate) || 128000,
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
      expiresAt: Date.now() + STREAM_CACHE_TTL_MS,
    };

    if (streamUrlCache.size > 200) {
      const oldestKey = streamUrlCache.keys().next().value;
      if (oldestKey) streamUrlCache.delete(oldestKey);
    }
    streamUrlCache.set(videoId, resolved);
    return resolved;
  } finally {
    globalThis.clearTimeout(timeout);
  }
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
 * Connect/Vite HTTP middleware handler for `/api/ytmusic/search`, `/api/ytmusic/stream`, and `/api/cloudinary-folder`
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

    // Direct Audio Stream metadata endpoint (`/api/ytmusic/stream-info?videoId=...`)
    if (req.url.startsWith('/api/ytmusic/stream-info')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        const videoId = (parsedUrl.searchParams.get('videoId') || '').trim();
        const stream = await resolveYouTubeAudioStream(videoId);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            videoId: stream.videoId,
            mimeType: stream.mimeType,
            bitrate: stream.bitrate,
            contentLength: stream.contentLength,
            durationSeconds: stream.durationSeconds,
            streamProxyUrl: `/api/ytmusic/stream?videoId=${encodeURIComponent(stream.videoId)}`,
          })
        );
      } catch (err: any) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err?.message || 'Failed to resolve audio stream' }));
      }
      return;
    }

    // Direct Audio Stream byte-range proxy (`/api/ytmusic/stream?videoId=...`)
    // Plays directly in a top-level HTML5 <audio> element so background / minimized playback
    // never cuts out and Android Chrome / WebView immediately displays the system Media Notification controller.
    if (req.url.startsWith('/api/ytmusic/stream')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
      res.setHeader('Accept-Ranges', 'bytes');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        const videoId = (parsedUrl.searchParams.get('videoId') || '').trim();
        let streamInfo = await resolveYouTubeAudioStream(videoId, false);

        const fetchUpstream = async (targetUrl: string) => {
          const upstreamHeaders: Record<string, string> = {
            'User-Agent':
              'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 14; en_US; Quest 3; Build/UP1A.231005.007.A1; Cronet/132.0.6808.3)',
          };
          const rangeHeader = req.headers['range'];
          if (typeof rangeHeader === 'string' && rangeHeader.trim()) {
            upstreamHeaders['Range'] = rangeHeader.trim();
          } else {
            upstreamHeaders['Range'] = 'bytes=0-';
          }
          return fetch(targetUrl, {
            method: req.method === 'HEAD' ? 'HEAD' : 'GET',
            headers: upstreamHeaders,
          });
        };

        let upstreamRes = await fetchUpstream(streamInfo.url);
        if (upstreamRes.status === 403 || upstreamRes.status === 401 || upstreamRes.status === 410) {
          streamInfo = await resolveYouTubeAudioStream(videoId, true);
          upstreamRes = await fetchUpstream(streamInfo.url);
        }

        if (!upstreamRes.ok && upstreamRes.status !== 206) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Upstream audio HTTP ${upstreamRes.status}` }));
          return;
        }

        res.statusCode = upstreamRes.status;
        res.setHeader('Content-Type', streamInfo.mimeType || 'audio/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');

        const contentRange = upstreamRes.headers.get('content-range');
        if (contentRange) {
          res.setHeader('Content-Range', contentRange);
        }
        const contentLen = upstreamRes.headers.get('content-length');
        if (contentLen) {
          res.setHeader('Content-Length', contentLen);
        }

        if (req.method === 'HEAD' || !upstreamRes.body) {
          res.end();
          return;
        }

        const reader = upstreamRes.body.getReader();
        let closed = false;
        req.on('close', () => {
          closed = true;
          reader.cancel().catch(() => {});
        });

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && !closed) {
            const canContinue = res.write(Buffer.from(value));
            if (!canContinue) {
              await new Promise<void>((resolve) => res.once('drain', resolve));
            }
          }
        }
        if (!closed) {
          res.end();
        }
      } catch (err: any) {
        if (!res.headersSent) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err?.message || 'Audio stream proxy error' }));
        } else {
          try {
            res.end();
          } catch {}
        }
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
      const searchType = (parsedUrl.searchParams.get('type') || 'songs').toLowerCase();

      if (!q) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing search query parameter "q"' }));
        return;
      }

      const t0 = performance.now();

      if (searchType === 'videos') {
        const { videos, cached } = await queryYouTubeVideosCatalog(q, refresh);
        const elapsedMs = Math.round(performance.now() - t0);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
        res.end(
          JSON.stringify({
            query: q,
            type: 'videos',
            source: 'ytmusic_and_youtube_videos',
            serverCached: cached,
            serverLatencyMs: elapsedMs,
            videos,
            tracks: videos,
          })
        );
        return;
      }

      if (searchType === 'all') {
        const [songsOutcome, videosOutcome] = await Promise.allSettled([
          queryYouTubeMusicCatalog(q, refresh),
          queryYouTubeVideosCatalog(q, refresh),
        ]);

        const tracks =
          songsOutcome.status === 'fulfilled' ? songsOutcome.value.tracks : [];
        const videos =
          videosOutcome.status === 'fulfilled' ? videosOutcome.value.videos : [];
        const cached =
          (songsOutcome.status === 'fulfilled' && songsOutcome.value.cached) ||
          (videosOutcome.status === 'fulfilled' && videosOutcome.value.cached);
        const elapsedMs = Math.round(performance.now() - t0);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
        res.end(
          JSON.stringify({
            query: q,
            type: 'all',
            source: 'ytmusic_songs_and_videos',
            serverCached: cached,
            serverLatencyMs: elapsedMs,
            tracks,
            videos,
          })
        );
        return;
      }

      const { tracks, cached } = await queryYouTubeMusicCatalog(q, refresh);
      const elapsedMs = Math.round(performance.now() - t0);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
      res.end(
        JSON.stringify({
          query: q,
          type: 'songs',
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
