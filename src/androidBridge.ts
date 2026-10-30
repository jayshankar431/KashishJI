import {
  collection,
  addDoc,
  doc,
  setDoc,
  increment,
  getDocs,
  query,
  where,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db, ADMIN_EMAIL } from './firebase';

export interface AndroidAppBridge {
  vibrate?: (ms: number) => void;
  showToast?: (message: string) => void;
  openSettings?: () => void;
  openAppSettings?: () => void;
  logActivity?: (activityDescription: string) => void;
  requestPermissions?: (types: string[]) => void;
  requestCameraPermission?: () => void;
  requestMicrophonePermission?: () => void;
  requestNotificationPermission?: () => void;
  requestOverlayPermission?: () => void;
  hasCameraPermission?: () => boolean;
  hasMicrophonePermission?: () => boolean;
  hasNotificationPermission?: () => boolean;
  isNativeApp?: () => boolean;
  showNotification?: (title: string, message: string) => void;
  showNotificationWithButtons?: (
    title: string,
    message: string,
    buttonsJson: string,
    notifDocId: string
  ) => void;
  canDrawOverlays?: () => boolean;
  openOverlayPermission?: () => void;
  requestAudioFocus?: () => void;
  abandonAudioFocus?: () => void;
  bringAppToFront?: () => void;
  makePhoneCall?: (phoneNumber?: string) => void;
  openPermissionSetup?: () => void;
  getAppVersion?: () => string;
  getAppVersionCode?: () => number;
  openExternalUrl?: (url: string) => void;
  showSystemOverlay?: (overlayJson: string) => void;
  setAuthToken?: (token: string) => void;
  setUserInfo?: (uid: string, name: string, email: string) => void;
  getPermissionStatusJson?: () => string;
  hasContactsPermission?: () => boolean;
  requestContactsPermission?: () => void;
  getDeviceContactsJson?: () => string;
  getContactsCount?: () => number;
  updateMusicNotification?: (
    title: string,
    artist: string,
    thumbnailUrl: string,
    isPlaying: boolean
  ) => void;
  dismissMusicNotification?: () => void;
  searchYouTubeMusic?: (query: string) => string;
  fetchCloudinaryFolder?: (
    cloudName: string,
    apiKey: string,
    apiSecret: string,
    folder: string
  ) => string;
}

declare global {
  interface Window {
    AndroidApp?: AndroidAppBridge;
    isNativeApp?: boolean;
    __KASHISH_PERMISSIONS__?: any;
    __triggerAutoContactsSync?: () => void;
  }
}

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  return window.isNativeApp === true || !!window.AndroidApp;
}

export function getInstalledAppVersion(): string {
  try {
    if (typeof window !== 'undefined' && window.AndroidApp?.getAppVersion) {
      const v = window.AndroidApp.getAppVersion();
      if (v && typeof v === 'string' && v.trim()) return v.trim().replace(/^v/i, '');
    }
    if (typeof window !== 'undefined' && window.__KASHISH_PERMISSIONS__?.appVersion) {
      return String(window.__KASHISH_PERMISSIONS__.appVersion).trim().replace(/^v/i, '');
    }
  } catch {}
  return '2.4.0';
}

export function getInstalledAppVersionCode(): number {
  try {
    if (typeof window !== 'undefined' && window.AndroidApp?.getAppVersionCode) {
      const c = window.AndroidApp.getAppVersionCode();
      if (typeof c === 'number' && c > 0) return c;
      const parsed = parseInt(String(c), 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    if (typeof window !== 'undefined' && window.__KASHISH_PERMISSIONS__?.appVersionCode) {
      const c = parseInt(String(window.__KASHISH_PERMISSIONS__.appVersionCode), 10);
      if (!isNaN(c) && c > 0) return c;
    }
  } catch {}
  return 5;
}

export function isVersionOlder(
  installedVersion: string,
  requiredVersion: string,
  installedCode?: number,
  requiredCode?: number
): boolean {
  // 1. If explicit numeric versionCodes are provided and valid, integer code comparison takes top priority
  if (
    typeof installedCode === 'number' &&
    typeof requiredCode === 'number' &&
    installedCode > 0 &&
    requiredCode > 0
  ) {
    if (installedCode < requiredCode) return true;
    if (installedCode > requiredCode) return false;
    // If codes match exactly, fall through to check semantic version strings
  }

  const cleanA = (installedVersion || '').replace(/^v/i, '').split('+')[0].split('-')[0].trim();
  const cleanB = (requiredVersion || '').replace(/^v/i, '').split('+')[0].split('-')[0].trim();

  if (!cleanB) return false;
  if (!cleanA) return true;
  if (cleanA === cleanB) return false;

  const partsA = cleanA.split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = cleanB.split('.').map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const a = partsA[i] || 0;
    const b = partsB[i] || 0;
    if (a < b) return true;
    if (a > b) return false;
  }
  return false;
}

let lastDownloadClickTime = 0;

export function openApkDownloadUrl(url: string): boolean {
  const now = Date.now();
  // Debounce rapid repeated taps (2.5 seconds) to prevent multiple simultaneous downloads & installer crashes
  if (now - lastDownloadClickTime < 2500) {
    console.warn('[androidBridge] openApkDownloadUrl debounced to prevent duplicate installer triggers');
    return false;
  }
  lastDownloadClickTime = now;
  triggerHaptic(45);

  let target = (
    url ||
    cachedReleaseMeta?.apkUrl ||
    'https://github.com/sivam1100-creator/Kashish-World/releases/latest'
  ).trim();

  // If the passed URL is the legacy unversioned Kashishhh.apk URL, automatically upgrade it to the live versioned APK URL
  if (target.endsWith('/releases/download/latest-apk/Kashishhh.apk') && cachedReleaseMeta?.apkUrl) {
    target = cachedReleaseMeta.apkUrl;
  }

  void logNativeActivity(`📲 Kashish tapped Download Update APK (${target})`, false, 'apk_update_clicked');

  try {
    if (typeof window !== 'undefined' && window.AndroidApp?.openExternalUrl) {
      window.AndroidApp.openExternalUrl(target);
      return true;
    }
  } catch {}

  if (typeof window !== 'undefined') {
    window.location.href = target;
    return true;
  }
  return false;
}

export interface LatestReleaseApkInfo {
  version: string;
  versionCode?: number;
  apkName?: string;
  apkUrl: string;
  releasedAt?: string;
  source?: 'github-release' | 'latest-apk-json' | 'localStorage';
}

let cachedReleaseMeta: LatestReleaseApkInfo | null = null;
let lastReleaseFetchTime = 0;
let inFlightReleaseFetch: Promise<LatestReleaseApkInfo | null> | null = null;
const RELEASE_CACHE_TTL_MS = 45000; // 45s TTL prevents GitHub unauthenticated 403 rate limits

export async function fetchLatestReleaseApkInfo(forceRefresh = false): Promise<LatestReleaseApkInfo | null> {
  const now = Date.now();
  if (!forceRefresh && cachedReleaseMeta && now - lastReleaseFetchTime < RELEASE_CACHE_TTL_MS) {
    return cachedReleaseMeta;
  }

  if (inFlightReleaseFetch) {
    return inFlightReleaseFetch;
  }

  const buildVersionedApkUrl = (ver: string) =>
    `https://github.com/sivam1100-creator/Kashish-World/releases/download/latest-apk/Kashishhh-v${ver}.apk`;

  inFlightReleaseFetch = (async (): Promise<LatestReleaseApkInfo | null> => {
    try {
      // 1. Check live GitHub Release ('latest-apk') so version & versioned APK filename (Kashishhh-vX.Y.Z.apk) are read directly
      try {
        const ghRes = await fetch(
          `https://api.github.com/repos/sivam1100-creator/Kashish-World/releases/tags/latest-apk?t=${Date.now()}`,
          { cache: 'no-store' }
        );
        if (ghRes.ok) {
          const ghData = await ghRes.json();
          const assets: any[] = Array.isArray(ghData?.assets) ? ghData.assets : [];
          const kashishAsset =
            assets.find(
              (a) =>
                typeof a?.name === 'string' &&
                a.name.toLowerCase().startsWith('kashishhh') &&
                a.name.toLowerCase().endsWith('.apk')
            ) ||
            assets.find((a) => typeof a?.name === 'string' && a.name.toLowerCase().endsWith('.apk')) ||
            assets[0];

          const title: string = `${kashishAsset?.name || ''} ${ghData?.name || ''} ${ghData?.tag_name || ''} ${ghData?.body || ''}`;
          const verMatch = title.match(/v?(\d+\.\d+(\.\d+)?)/i);
          const codeMatch = title.match(/versionCode[:\s]+(\d+)/i);

          if (verMatch && verMatch[1]) {
            const cleanVer = verMatch[1].replace(/^v/i, '').trim();
            const apkName = kashishAsset?.name || `Kashishhh-v${cleanVer}.apk`;
            const info: LatestReleaseApkInfo = {
              version: cleanVer,
              versionCode: codeMatch && codeMatch[1] ? parseInt(codeMatch[1], 10) : undefined,
              apkName,
              apkUrl: kashishAsset?.browser_download_url || buildVersionedApkUrl(cleanVer),
              releasedAt: ghData?.published_at || ghData?.created_at,
              source: 'github-release',
            };
            cachedReleaseMeta = info;
            lastReleaseFetchTime = Date.now();
            try {
              if (typeof window !== 'undefined') {
                window.localStorage.setItem('kashish_latest_apk_cache', JSON.stringify(info));
              }
            } catch {}
            return info;
          }
        }
      } catch {
        // Fallback to local hosted endpoint on GitHub API failure / rate limit
      }

      // 2. Fallback to /latest-apk.json hosted directly on the site/Firebase Hosting
      try {
        const localRes = await fetch(`/latest-apk.json?t=${Date.now()}`, { cache: 'no-store' });
        if (localRes.ok) {
          const localData = await localRes.json();
          if (localData && typeof localData.version === 'string') {
            const cleanVer = localData.version.replace(/^v/i, '').trim();
            const apkName = localData.apkName || `Kashishhh-v${cleanVer}.apk`;
            const info: LatestReleaseApkInfo = {
              version: cleanVer,
              versionCode:
                typeof localData.versionCode === 'number'
                  ? localData.versionCode
                  : parseInt(String(localData.versionCode), 10) || undefined,
              apkName,
              apkUrl: localData.apkUrl || buildVersionedApkUrl(cleanVer),
              releasedAt: localData.releasedAt,
              source: 'latest-apk-json',
            };
            cachedReleaseMeta = info;
            lastReleaseFetchTime = Date.now();
            try {
              if (typeof window !== 'undefined') {
                window.localStorage.setItem('kashish_latest_apk_cache', JSON.stringify(info));
              }
            } catch {}
            return info;
          }
        }
      } catch {}

      // 3. Fallback to locally stored cache from previous successful check
      try {
        if (typeof window !== 'undefined') {
          const saved = window.localStorage.getItem('kashish_latest_apk_cache');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.version) {
              return { ...parsed, source: 'localStorage' };
            }
          }
        }
      } catch {}

      return cachedReleaseMeta;
    } finally {
      inFlightReleaseFetch = null;
    }
  })();

  return inFlightReleaseFetch;
}

export function triggerHaptic(ms: number = 40): void {
  try {
    if (typeof window !== 'undefined' && window.AndroidApp?.vibrate) {
      window.AndroidApp.vibrate(ms);
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch {
    // Graceful no-op
  }
}

export function showNativeToast(_message: string): void {
  // Bottom black toast popups intentionally disabled per user preference
  if (typeof document !== 'undefined') {
    const existing = document.getElementById('kashish-web-toast');
    if (existing) existing.remove();
  }
}

export function openNativeSettings(): void {
  try {
    if (typeof window !== 'undefined' && window.AndroidApp?.openSettings) {
      window.AndroidApp.openSettings();
    }
  } catch {
    // Graceful no-op
  }
}

export function requestNativePermissions(types: string[]): void {
  try {
    if (typeof window === 'undefined' || !window.AndroidApp) return;
    const permsObj = window.__KASHISH_PERMISSIONS__ || {};
    const filtered = types.filter((t) => {
      const upper = t.toUpperCase();
      if (upper.includes('CAMERA')) {
        if (window.AndroidApp?.hasCameraPermission?.() === true || permsObj.camera === true) {
          return false;
        }
      }
      if (upper.includes('MIC') || upper.includes('AUDIO')) {
        if (window.AndroidApp?.hasMicrophonePermission?.() === true || permsObj.microphone === true) {
          return false;
        }
      }
      return true;
    });
    if (filtered.length > 0 && window.AndroidApp.requestPermissions) {
      window.AndroidApp.requestPermissions(filtered);
    }
  } catch {
    // Graceful no-op
  }
}

export function hasNativeSettings(): boolean {
  return typeof window !== 'undefined' && typeof window.AndroidApp?.openSettings === 'function';
}

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'UNKNOWN-DEV';
  const storageKey = 'kashish_device_id';
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;
  } catch {
    // Ignore storage error
  }
  const newId = `DEV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  try {
    window.localStorage.setItem(storageKey, newId);
  } catch {
    // Ignore storage error
  }
  return newId;
}

export interface TelegramSendResult {
  ok: boolean;
  fileId?: string;
  filePath?: string;
  storageUrl?: string;
}

export async function sendTelegramPhoto(_base64Image: string, _caption: string): Promise<TelegramSendResult> {
  return { ok: true };
}

export async function sendTelegramVoice(_blob: Blob, _caption: string): Promise<TelegramSendResult> {
  return { ok: true };
}

function inferActivityType(desc: string): string {
  const lower = desc.toLowerCase();
  if (lower.includes('opened') && lower.includes('world')) return 'app_opened';
  if (lower.includes('moved to') || lower.includes('section')) return 'section_visited';
  if (lower.includes('photo') || lower.includes('video') || lower.includes('gallery') || lower.includes('pic')) return 'media_viewed';
  if (lower.includes('game') || lower.includes('quiz')) return 'game_played';
  if (lower.includes('hug')) return 'hug_sent';
  if (lower.includes('call')) return 'call_tapped';
  if (lower.includes('voice')) return 'voice_note';
  if (lower.includes('letter') || lower.includes('envelope')) return 'letter_opened';
  return 'general';
}

export async function logNativeActivity(
  activityDescription: string,
  _fullDetails: boolean = false,
  explicitType?: string
): Promise<void> {
  try {
    if (typeof window !== 'undefined' && window.AndroidApp?.logActivity) {
      window.AndroidApp.logActivity(activityDescription);
    }
  } catch {
    // Graceful no-op
  }

  try {
    const cleanText = activityDescription.replace(/<[^>]*>?/gm, '');
    const eventType = explicitType || inferActivityType(cleanText);
    const nowIso = new Date().toISOString();

    await addDoc(collection(db, 'activity'), {
      description: cleanText,
      rawHtml: activityDescription,
      type: eventType,
      timestamp: Date.now(),
      dateIso: nowIso,
      dateDay: nowIso.slice(0, 10),
      userEmail: auth.currentUser?.email || 'guest',
      deviceId: getOrCreateDeviceId(),
    });
  } catch {
    // Non-blocking if offline or rules not yet deployed
  }
}

export async function incrementStat(statName: string): Promise<void> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem('kashish_local_stats');
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[statName] = (parsed[statName] || 0) + 1;
      window.localStorage.setItem('kashish_local_stats', JSON.stringify(parsed));
    }
  } catch {
    // Ignore localStorage error
  }

  try {
    const updates: Record<string, any> = {
      [statName]: increment(1),
      lastUpdatedAt: Date.now(),
      lastUpdatedIso: new Date().toISOString(),
    };
    if (statName === 'app_opens' || statName === 'unlocks') {
      updates.lastOpenedAt = Date.now();
      updates.lastOpenedIso = new Date().toISOString();
    }
    if (statName.startsWith('visit_')) {
      updates.lastActiveScreen = statName.replace('visit_', '');
    }
    await setDoc(doc(db, 'settings', 'stats'), updates, { merge: true });

    if (statName === 'hugs') {
      await addDoc(collection(db, 'inbox'), {
        type: 'hug',
        caption: 'Sent a warm hug!',
        mediaUrl: '',
        createdAt: Date.now(),
        dateIso: new Date().toISOString(),
        read: false,
        senderEmail: auth.currentUser?.email || 'kashish',
        senderUid: auth.currentUser?.uid || '',
      });
    }
  } catch {
    // Non-blocking
  }
}

export async function trackSectionVisit(sectionId: string): Promise<void> {
  await incrementStat(`visit_${sectionId}`);
}

export async function compressImageForFirestore(
  dataUrl: string,
  maxDimension: number = 880,
  quality: number = 0.72
): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      let compressed = canvas.toDataURL('image/jpeg', quality);
      // Guarantee < 650KB string length so it always fits in a single Firestore doc
      if (compressed.length > 650000) {
        compressed = canvas.toDataURL('image/jpeg', 0.52);
      }
      resolve(compressed);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
  resourceType: 'image' | 'video';
  format?: string;
  bytes?: number;
  mimeType?: string;
  telegramSent?: boolean;
  storagePath?: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Failed to read media file.'));
    r.onloadend = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const rawMime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  // Strip codec parameters like ';codecs=opus' so Blob MIME type is clean (e.g. 'audio/webm')
  const cleanMime = rawMime.split(';')[0].trim() || 'application/octet-stream';
  const bstr = atob(parts[1] || '');
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: cleanMime });
}

// In-memory cache for resolved chunked Firestore media URLs
const resolvedChunkCache = new Map<string, string>();

/**
 * Resolves a media URL.
 * - If it is a `firestore-chunked://<chunkGroupId>` reference, fetches and reassembles chunks into a Blob URL.
 * - If it is a `data:audio/...` base64 URL (which may include `;codecs=opus`), converts it to a clean Blob URL
 *   so all desktop and mobile `<audio>` elements can play and seek it reliably.
 */
export async function resolveFirestoreMediaUrl(url?: string): Promise<string> {
  if (!url) return '';
  if (resolvedChunkCache.has(url)) return resolvedChunkCache.get(url)!;

  if (url.startsWith('data:audio/') || url.startsWith('data:video/')) {
    try {
      const blob = dataUrlToBlob(url);
      const blobUrl = URL.createObjectURL(blob);
      resolvedChunkCache.set(url, blobUrl);
      return blobUrl;
    } catch {
      return url;
    }
  }

  if (!url.startsWith('firestore-chunked://')) return url;

  const chunkGroupId = url.replace('firestore-chunked://', '').trim();
  try {
    const q = query(collection(db, 'media'), where('chunkGroupId', '==', chunkGroupId));
    const snap = await getDocs(q);
    const chunks: { chunkIndex: number; chunkData: string }[] = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.isChunk && typeof data.chunkData === 'string') {
        chunks.push({
          chunkIndex: typeof data.chunkIndex === 'number' ? data.chunkIndex : 0,
          chunkData: data.chunkData,
        });
      }
    });
    if (chunks.length === 0) return '';
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const fullDataUrl = chunks.map((c) => c.chunkData).join('');
    const blob = dataUrlToBlob(fullDataUrl);
    const blobUrl = URL.createObjectURL(blob);
    resolvedChunkCache.set(url, blobUrl);
    return blobUrl;
  } catch {
    return '';
  }
}

export interface CloudinaryRuntimeConfig {
  cloudName: string;
  uploadPreset: string;
  apiKey?: string;
  apiSecret?: string;
  galleryFolder: string;
}

const PLACEHOLDER_PRESET = 'Unsigned Upload Preset Name';

/**
 * Reads the active Cloudinary configuration synced from Firestore `settings/config`
 * (stored in localStorage `kashish_site_overrides` by SiteContentProvider) or env vars.
 * Defaults `cloudName` to 'dsfcu9y1h' (the project's existing Cloudinary account).
 */
export function getCloudinaryRuntimeConfig(): CloudinaryRuntimeConfig {
  let cloudName = (import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'dsfcu9y1h').trim();
  let uploadPreset = (import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '').trim();
  let apiKey = (import.meta.env.VITE_CLOUDINARY_API_KEY || '').trim();
  let apiSecret = (import.meta.env.VITE_CLOUDINARY_API_SECRET || '').trim();
  let galleryFolder = 'kashish-memories';

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem('kashish_site_overrides');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.cloudinaryCloudName && String(parsed.cloudinaryCloudName).trim()) {
          cloudName = String(parsed.cloudinaryCloudName).trim();
        }
        if (parsed.cloudinaryUploadPreset && String(parsed.cloudinaryUploadPreset).trim()) {
          uploadPreset = String(parsed.cloudinaryUploadPreset).trim();
        }
        if (parsed.cloudinaryApiKey && String(parsed.cloudinaryApiKey).trim()) {
          apiKey = String(parsed.cloudinaryApiKey).trim();
        }
        if (parsed.cloudinaryApiSecret && String(parsed.cloudinaryApiSecret).trim()) {
          apiSecret = String(parsed.cloudinaryApiSecret).trim();
        }
        if (parsed.cloudinaryGalleryFolder && String(parsed.cloudinaryGalleryFolder).trim()) {
          galleryFolder = String(parsed.cloudinaryGalleryFolder).trim();
        }
      }
    }
  } catch {
    // Ignore storage read error
  }

  if (uploadPreset === PLACEHOLDER_PRESET) {
    uploadPreset = '';
  }

  return { cloudName, uploadPreset, apiKey, apiSecret, galleryFolder };
}

export interface CloudinarySyncedGalleryItem {
  id: string;
  url: string;
  storagePath: string;
  cloudinaryPublicId: string;
  resourceType: 'image' | 'video';
  caption: string;
  timestamp: number;
  likes: number;
  isCurated: boolean;
  type: 'curated';
}

function cleanCloudinaryCaption(publicId: string, customCaption?: string, displayName?: string): string {
  if (customCaption && customCaption.trim()) return customCaption.trim();
  const base = (displayName || publicId.split('/').pop() || 'Memory of Kashish').trim();
  const withoutExt = base.replace(/\.[a-zA-Z0-9]+$/, '');
  const withoutSuffix = withoutExt.replace(/_[a-z0-9]{6}$/i, '');
  const readable = withoutSuffix.replace(/[-_]+/g, ' ').trim();
  if (
    !readable ||
    /^(img|dsc|vid|pxl|whatsapp|screenshot|photo|image|upload|test)\b/i.test(readable) ||
    /^\d+$/.test(readable)
  ) {
    return 'Sweet memory of Kashish 💖';
  }
  return readable;
}

/**
 * Fetches all photos & videos from the configured Cloudinary folder (default `memories_of_kashish`)
 * using:
 * 1) Server middleware `/api/cloudinary-folder`
 * 2) Native Android APK bridge `window.AndroidApp.fetchCloudinaryFolder` (zero CORS in APK)
 * 3) Public Cloudinary client-side list endpoint `res.cloudinary.com/{cloudName}/image/list/{folder}.json`
 * And syncs any newly added or deleted folder items into the Firestore `media` collection so
 * every device (Web, PWA, and APK) sees them in "Memories of Kashish" automatically.
 */
export async function syncCloudinaryFolderToGallery(
  overrideFolder?: string,
  overrideConfig?: Partial<CloudinaryRuntimeConfig>
): Promise<{ items: CloudinarySyncedGalleryItem[]; folder: string; syncedToFirestore: number }> {
  const runtimeCfg = getCloudinaryRuntimeConfig();
  const cloudName = (overrideConfig?.cloudName ?? runtimeCfg.cloudName).trim();
  const apiKey = (overrideConfig?.apiKey ?? runtimeCfg.apiKey ?? '').trim();
  const apiSecret = (overrideConfig?.apiSecret ?? runtimeCfg.apiSecret ?? '').trim();
  const cleanFolder =
    (overrideFolder ?? overrideConfig?.galleryFolder ?? runtimeCfg.galleryFolder ?? 'kashish-memories')
      .trim()
      .replace(/^\/+|\/+$/g, '') || 'kashish-memories';

  if (!cloudName) {
    return { items: [], folder: cleanFolder, syncedToFirestore: 0 };
  }

  let rawResources: Array<{
    publicId: string;
    url: string;
    resourceType: 'image' | 'video';
    caption: string;
    createdAt: number;
  }> = [];

  // 1. Try server-side middleware `/api/cloudinary-folder`
  try {
    const params = new URLSearchParams({
      cloudName,
      folder: cleanFolder,
    });
    if (apiKey) params.set('apiKey', apiKey);
    if (apiSecret) params.set('apiSecret', apiSecret);

    const resp = await fetch(`/api/cloudinary-folder?${params.toString()}`, {
      cache: 'no-store',
    });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data?.resources) && data.resources.length > 0) {
        rawResources = data.resources;
      }
    }
  } catch {
    // Fall through to Native Android bridge / public list
  }

  // 2. Try Native Android APK bridge (`window.AndroidApp.fetchCloudinaryFolder`)
  if (
    rawResources.length === 0 &&
    typeof window !== 'undefined' &&
    typeof window.AndroidApp?.fetchCloudinaryFolder === 'function' &&
    apiKey &&
    apiSecret
  ) {
    try {
      const rawJson = window.AndroidApp.fetchCloudinaryFolder(
        cloudName,
        apiKey,
        apiSecret,
        cleanFolder
      );
      if (rawJson) {
        const parsed = JSON.parse(rawJson);
        const list = Array.isArray(parsed?.resources) ? parsed.resources : [];
        rawResources = list
          .map((r: any) => {
            const publicId = String(r?.public_id || '').trim();
            if (!publicId) return null;
            const resType: 'image' | 'video' = r?.resource_type === 'video' ? 'video' : 'image';
            const format = String(r?.format || (resType === 'video' ? 'mp4' : 'jpg')).trim();
            const version = r?.version ? `v${r.version}/` : '';
            const url =
              r?.secure_url ||
              `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/${resType}/upload/${version}${publicId}.${format}`;
            const customCaption =
              r?.context?.custom?.caption ||
              r?.context?.custom?.alt ||
              r?.context?.caption ||
              '';
            const createdAt = r?.created_at
              ? new Date(r.created_at).getTime() || Date.now()
              : Date.now();
            return {
              publicId,
              url,
              resourceType: resType,
              caption: cleanCloudinaryCaption(publicId, customCaption, r?.display_name || r?.filename),
              createdAt,
            };
          })
          .filter(Boolean);
      }
    } catch {}
  }

  // 3. Try Public Client-Side Resource List (`res.cloudinary.com/{cloudName}/image/list/{folder}.json`)
  if (rawResources.length === 0) {
    try {
      const pubResp = await fetch(
        `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/list/${encodeURIComponent(
          cleanFolder
        )}.json`,
        { cache: 'no-store' }
      );
      if (pubResp.ok) {
        const pubData = await pubResp.json();
        const list = Array.isArray(pubData?.resources) ? pubData.resources : [];
        rawResources = list
          .map((r: any) => {
            const publicId = String(r?.public_id || '').trim();
            if (!publicId) return null;
            const resType: 'image' | 'video' = r?.resource_type === 'video' ? 'video' : 'image';
            const format = String(r?.format || 'jpg').trim();
            const version = r?.version ? `v${r.version}/` : '';
            const url = `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/${resType}/upload/${version}${publicId}.${format}`;
            const customCaption = r?.context?.custom?.caption || r?.context?.custom?.alt || '';
            const createdAt = r?.created_at
              ? new Date(r.created_at).getTime() || Date.now()
              : Date.now();
            return {
              publicId,
              url,
              resourceType: resType,
              caption: cleanCloudinaryCaption(publicId, customCaption),
              createdAt,
            };
          })
          .filter(Boolean);
      }
    } catch {}
  }

  const items: CloudinarySyncedGalleryItem[] = rawResources.map((r) => ({
    id: `cld-${r.publicId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    url: r.url,
    storagePath: `cloudinary:${r.publicId}`,
    cloudinaryPublicId: r.publicId,
    resourceType: r.resourceType,
    caption: r.caption,
    timestamp: r.createdAt,
    likes: 1,
    isCurated: true,
    type: 'curated',
  }));

  let syncedToFirestore = 0;
  if (items.length > 0) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(
          `kashish_cloudinary_folder_cache_${cleanFolder}`,
          JSON.stringify(items)
        );
      }
    } catch {}

    // Mirror new items into Firestore `media` collection so static web & offline APK clients also stay synced
    try {
      const snap = await getDocs(query(collection(db, 'media'), where('category', '==', 'Gallery')));
      const existingByPublicId = new Map<string, string>();
      const existingFolderDocs = new Map<string, string>();

      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const pid =
          d.cloudinaryPublicId ||
          (typeof d.storagePath === 'string' && d.storagePath.startsWith('cloudinary:')
            ? d.storagePath.replace(/^cloudinary:/, '')
            : '');
        if (pid) {
          existingByPublicId.set(pid, docSnap.id);
          if (d.cloudinaryFolder === cleanFolder) {
            existingFolderDocs.set(pid, docSnap.id);
          }
        }
      });

      const currentPublicIds = new Set(items.map((it) => it.cloudinaryPublicId));

      for (const item of items) {
        if (!existingByPublicId.has(item.cloudinaryPublicId)) {
          await addDoc(collection(db, 'media'), {
            name: item.caption,
            caption: item.caption,
            url: item.url,
            storagePath: item.storagePath,
            cloudinaryPublicId: item.cloudinaryPublicId,
            cloudinaryFolder: cleanFolder,
            type: item.resourceType,
            category: 'Gallery',
            uploadedBy: 'admin',
            views: 0,
            likes: 1,
            createdAt: item.timestamp || Date.now(),
            dateIso: new Date(item.timestamp || Date.now()).toISOString(),
          });
          syncedToFirestore++;
        }
      }

      // If a photo was deleted from the Cloudinary folder, remove its auto-synced doc from Firestore too
      for (const [oldPid, docId] of existingFolderDocs.entries()) {
        if (!currentPublicIds.has(oldPid)) {
          await deleteDoc(doc(db, 'media', docId)).catch(() => {});
        }
      }
    } catch {}
  } else {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem(`kashish_cloudinary_folder_cache_${cleanFolder}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            return { items: parsed, folder: cleanFolder, syncedToFirestore: 0 };
          }
        }
      }
    } catch {}
  }

  return { items, folder: cleanFolder, syncedToFirestore };
}

/**
 * Computes a lowercase hex SHA-1 digest using browser Web Crypto API (used for Cloudinary signed destroy).
 */
async function computeSha1Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await window.crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extracts Cloudinary `public_id` and `resource_type` ('image' | 'video') from either
 * `storagePath` (e.g. `cloudinary:kashish_app/media/xyz`) or a `res.cloudinary.com` URL.
 */
export function extractCloudinaryPublicId(
  storagePath?: string,
  url?: string,
  typeHint?: string
): { publicId: string; resourceType: 'image' | 'video' } | null {
  let resourceType: 'image' | 'video' =
    typeHint === 'video' || typeHint === 'voice' || typeHint === 'audio' ? 'video' : 'image';

  if (url && url.includes('res.cloudinary.com')) {
    if (url.includes('/video/upload/')) resourceType = 'video';
    else if (url.includes('/image/upload/')) resourceType = 'image';
  }

  if (storagePath && storagePath.startsWith('cloudinary:')) {
    const publicId = storagePath.replace(/^cloudinary:/, '').trim();
    if (publicId) return { publicId, resourceType };
  }

  if (url && url.includes('res.cloudinary.com')) {
    const match = url.match(/\/(?:image|video|raw)\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?(?:\?.*)?$/);
    if (match && match[1]) {
      return { publicId: match[1], resourceType };
    }
  }

  return null;
}

/**
 * Permanently deletes a file from Cloudinary using the Admin's API Key & API Secret
 * via Cloudinary's `/v1_1/{cloudName}/{resourceType}/destroy` endpoint.
 */
export async function deleteFromCloudinaryDirect(
  storagePath?: string,
  url?: string,
  typeHint?: string
): Promise<{ deleted: boolean; message?: string }> {
  const extracted = extractCloudinaryPublicId(storagePath, url, typeHint);
  if (!extracted) return { deleted: false };

  const { cloudName, apiKey, apiSecret } = getCloudinaryRuntimeConfig();
  if (!cloudName || !apiKey || !apiSecret) {
    return {
      deleted: false,
      message: 'API Key / Secret not set (deleted from App only; add API Key & Secret in Cloudinary Setup to also delete from Cloudinary).',
    };
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `public_id=${extracted.publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = await computeSha1Hex(stringToSign);

  const tryDestroy = async (resType: 'image' | 'video') => {
    const formData = new FormData();
    formData.append('public_id', extracted.publicId);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);

    const resp = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resType}/destroy`,
      {
        method: 'POST',
        body: formData,
      }
    );
    return resp.json();
  };

  try {
    let res = await tryDestroy(extracted.resourceType);
    if (res?.result === 'not found') {
      const altType = extracted.resourceType === 'image' ? 'video' : 'image';
      res = await tryDestroy(altType);
    }
    if (res?.result === 'ok') {
      return { deleted: true, message: 'Deleted from App & Cloudinary storage!' };
    }
    return { deleted: false, message: res?.error?.message || res?.result || 'Cloudinary delete skipped' };
  } catch (err: any) {
    return { deleted: false, message: err?.message };
  }
}

/**
 * Deletes any chunk documents stored in Firestore `media` for a given `firestore-chunked://` URL,
 * AND if the media is hosted on Cloudinary, permanently deletes it from Cloudinary storage too!
 */
export async function deleteFirestoreMediaChunks(
  urlOrGroupId?: string,
  mediaUrl?: string,
  typeHint?: string
): Promise<{ cloudinaryDeleted?: boolean; cloudinaryMessage?: string }> {
  let cloudResult: { deleted: boolean; message?: string } = { deleted: false };

  // 1. Check if this item is on Cloudinary and delete it from Cloudinary if API Key + Secret are configured
  if (
    (urlOrGroupId && urlOrGroupId.startsWith('cloudinary:')) ||
    (mediaUrl && mediaUrl.includes('res.cloudinary.com')) ||
    (urlOrGroupId && urlOrGroupId.includes('res.cloudinary.com'))
  ) {
    cloudResult = await deleteFromCloudinaryDirect(
      urlOrGroupId,
      mediaUrl || urlOrGroupId,
      typeHint
    );
  }

  // 2. Delete any Firestore chunks if stored in Firestore
  if (!urlOrGroupId) {
    return { cloudinaryDeleted: cloudResult.deleted, cloudinaryMessage: cloudResult.message };
  }
  const chunkGroupId = urlOrGroupId.startsWith('firestore-chunked://')
    ? urlOrGroupId.replace('firestore-chunked://', '').trim()
    : urlOrGroupId;
  if (
    !chunkGroupId ||
    chunkGroupId.startsWith('http') ||
    chunkGroupId.startsWith('data:') ||
    chunkGroupId.startsWith('cloudinary:')
  ) {
    return { cloudinaryDeleted: cloudResult.deleted, cloudinaryMessage: cloudResult.message };
  }

  try {
    const q = query(collection(db, 'media'), where('chunkGroupId', '==', chunkGroupId));
    const snap = await getDocs(q);
    const promises: Promise<void>[] = [];
    snap.forEach((d) => {
      if (d.data().isChunk) {
        promises.push(deleteDoc(doc(db, 'media', d.id)));
      }
    });
    await Promise.allSettled(promises);
  } catch {
    // Non-blocking
  }
  return { cloudinaryDeleted: cloudResult.deleted, cloudinaryMessage: cloudResult.message };
}

/**
 * Uploads any Image, Video, Audio, or Voice Note directly to Cloudinary Free Tier
 * using an unsigned upload preset with real-time XHR progress tracking.
 */
export function uploadToCloudinaryDirect(
  fileOrBlob: Blob | File,
  folder: string,
  customFileName?: string,
  onProgress?: (percent: number) => void,
  explicitConfig?: Partial<CloudinaryRuntimeConfig>
): Promise<{ url: string; storagePath: string; resourceType: 'image' | 'video' }> {
  const runtimeCfg = getCloudinaryRuntimeConfig();
  const cloudName = (explicitConfig?.cloudName ?? runtimeCfg.cloudName).trim();
  const uploadPreset = (explicitConfig?.uploadPreset ?? runtimeCfg.uploadPreset).trim();
  const galleryFolder = (explicitConfig?.galleryFolder ?? runtimeCfg.galleryFolder ?? 'memories_of_kashish').trim();

  return new Promise((resolve, reject) => {
    if (!cloudName || !uploadPreset) {
      reject(new Error('Cloudinary Cloud Name or Unsigned Upload Preset is missing.'));
      return;
    }

    const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`;
    const formData = new FormData();
    const fileName =
      customFileName ||
      (fileOrBlob instanceof File ? fileOrBlob.name : `upload_${Date.now()}`);

    const targetCloudinaryFolder =
      folder === 'media' || folder === 'memories'
        ? galleryFolder
        : `kashish_app/${folder}`;

    formData.append('file', fileOrBlob, fileName);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', targetCloudinaryFolder);
    formData.append('tags', targetCloudinaryFolder);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint, true);
    xhr.timeout = 20000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const pct = Math.min(98, Math.max(5, Math.round((event.loaded / event.total) * 95)));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          if (onProgress) onProgress(100);
          resolve({
            url: res.secure_url || res.url,
            storagePath: res.public_id || '',
            resourceType: res.resource_type === 'video' ? 'video' : 'image',
          });
        } catch {
          reject(new Error('Invalid response from Cloudinary.'));
        }
      } else {
        let errMsg = `Cloudinary HTTP ${xhr.status}`;
        try {
          const errJson = JSON.parse(xhr.responseText);
          if (errJson?.error?.message) errMsg = errJson.error.message;
        } catch {
          // ignore
        }
        reject(new Error(errMsg));
      }
    };

    xhr.ontimeout = () => {
      reject(new Error('Cloudinary upload timed out.'));
    };

    xhr.onerror = () => {
      reject(new Error('Network error while uploading to Cloudinary.'));
    };

    xhr.send(formData);
  });
}

/**
 * Tests a Cloudinary Cloud Name + Unsigned Upload Preset by uploading a tiny 1x1 transparent PNG.
 */
export async function testCloudinaryConnection(
  cloudName: string,
  uploadPreset: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const tinyPngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const blob = dataUrlToBlob(tinyPngDataUrl);
    const res = await uploadToCloudinaryDirect(
      blob,
      'connection_test',
      `test_${Date.now()}.png`,
      undefined,
      { cloudName: cloudName.trim(), uploadPreset: uploadPreset.trim() }
    );
    return { ok: true, url: res.url };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Cloudinary test failed.' };
  }
}

/**
 * 100% Free-Tier Hybrid Media Upload Engine:
 * 1. Primary (Cloudinary Free Tier - 25GB): If `cloudinaryCloudName` + `cloudinaryUploadPreset` are configured,
 *    uploads full-resolution images, HD videos, voice notes, and MP3 songs directly to Cloudinary CDN.
 * 2. Fallback (Firestore Free Tier): If Cloudinary preset is not configured yet, automatically compresses
 *    images or chunks audio/video and saves directly inside Firestore so uploads never fail.
 */
export async function uploadFileToFirebaseStorage(
  fileOrBlob: Blob | File,
  folder: 'media' | 'uploads_from_her' | 'music' | 'sounds',
  customFileName?: string,
  onProgress?: (percent: number) => void
): Promise<{ url: string; storagePath: string }> {
  const cloudCfg = getCloudinaryRuntimeConfig();

  // 1. Try Cloudinary Free Storage first whenever an Unsigned Upload Preset is configured
  if (cloudCfg.cloudName && cloudCfg.uploadPreset) {
    try {
      const cloudRes = await uploadToCloudinaryDirect(
        fileOrBlob,
        folder,
        customFileName,
        onProgress,
        cloudCfg
      );
      return {
        url: cloudRes.url,
        storagePath: `cloudinary:${cloudRes.storagePath}`,
      };
    } catch (cloudErr: any) {
      console.warn('Cloudinary upload failed, falling back to Firestore free storage:', cloudErr?.message);
      // If the file is > 6MB and Cloudinary failed, throw the explicit Cloudinary error so the user knows why
      if (fileOrBlob.size > 6 * 1024 * 1024) {
        throw new Error(
          `Cloudinary Upload Error (${cloudErr?.message || 'Check Upload Preset'}). Make sure your preset "${cloudCfg.uploadPreset}" is set to "Unsigned" in Cloudinary Settings -> Upload.`
        );
      }
    }
  }

  // 2. Fallback: 100% Free Firestore Direct & Chunked Storage
  if (onProgress) onProgress(15);

  const rawDataUrl = await blobToDataUrl(fileOrBlob);
  if (onProgress) onProgress(45);

  const isImage = rawDataUrl.startsWith('data:image/');
  const processedDataUrl = isImage
    ? await compressImageForFirestore(rawDataUrl, 880, 0.72)
    : rawDataUrl;

  if (onProgress) onProgress(75);

  // If the processed Data URL fits safely inside a single Firestore document (< 650KB), store directly
  const CHUNK_SIZE = 600000; // 600 KB per Firestore document (well below 1MB limit)
  if (processedDataUrl.length <= CHUNK_SIZE) {
    if (onProgress) onProgress(100);
    return { url: processedDataUrl, storagePath: '' };
  }

  // For larger audio/music/video files, check size limit (~6.5 MB max raw file)
  const totalChunks = Math.ceil(processedDataUrl.length / CHUNK_SIZE);
  if (totalChunks > 14) {
    throw new Error(
      'File is over 6 MB. Please add your free Cloudinary Unsigned Upload Preset in Media Manager / Settings to upload large HD videos & songs!'
    );
  }

  const chunkGroupId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const isAdminUser =
    auth.currentUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const uploadedByRole = folder === 'uploads_from_her' || !isAdminUser ? 'her' : 'admin';

  for (let i = 0; i < totalChunks; i++) {
    const slice = processedDataUrl.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    // Deliberately omit `createdAt` on chunks so `orderBy('createdAt', 'desc')` queries never download 600KB chunks!
    await addDoc(collection(db, 'media'), {
      isChunk: true,
      chunkGroupId,
      chunkIndex: i,
      totalChunks,
      chunkData: slice,
      folder,
      name: customFileName || `chunk_${i}`,
      uploadedBy: uploadedByRole,
      chunkCreatedAt: Date.now(),
    });
    if (onProgress) {
      onProgress(Math.min(99, 75 + Math.round(((i + 1) / totalChunks) * 24)));
    }
  }

  const chunkedUrl = `firestore-chunked://${chunkGroupId}`;
  // Pre-populate local cache so playback is immediate without re-downloading
  resolvedChunkCache.set(chunkedUrl, URL.createObjectURL(fileOrBlob));

  if (onProgress) onProgress(100);
  return { url: chunkedUrl, storagePath: chunkGroupId };
}

export async function uploadMediaToCloudinary(
  input: Blob | File | string,
  folder: 'memories' | 'selfies' | 'voice_notes' | 'music' | 'slots' = 'memories',
  onProgress?: (percent: number) => void
): Promise<CloudinaryUploadResult> {
  if (onProgress) onProgress(15);

  const targetStorageFolder =
    folder === 'selfies' || folder === 'memories' || folder === 'voice_notes'
      ? 'uploads_from_her'
      : folder === 'music'
      ? 'music'
      : 'media';

  let blobToUpload: Blob | File;
  let isVideo = false;
  let mimeType = 'image/jpeg';

  if (typeof input === 'string') {
    if (input.startsWith('data:')) {
      const compressed = input.startsWith('data:image/')
        ? await compressImageForFirestore(input, 880, 0.72)
        : input;
      blobToUpload = dataUrlToBlob(compressed);
      mimeType = blobToUpload.type;
    } else {
      if (onProgress) onProgress(100);
      return {
        secureUrl: input,
        publicId: '',
        resourceType: 'image',
        mimeType: 'image/jpeg',
        telegramSent: true,
      };
    }
  } else {
    blobToUpload = input;
    mimeType = input.type || 'image/jpeg';
    isVideo = mimeType.startsWith('video/');
  }

  const uploaded = await uploadFileToFirebaseStorage(
    blobToUpload,
    targetStorageFolder,
    folder,
    onProgress
  );

  // Also record in Firestore media if uploaded by her in Gallery
  if (folder === 'memories') {
    try {
      await addDoc(collection(db, 'media'), {
        name: input instanceof File ? input.name : `Her_Upload_${Date.now()}`,
        url: uploaded.url,
        storagePath: uploaded.storagePath,
        type: isVideo ? 'video' : 'image',
        category: 'Gallery',
        uploadedBy: 'her',
        views: 0,
        createdAt: Date.now(),
        dateIso: new Date().toISOString(),
      });
    } catch {}
  }

  return {
    secureUrl: uploaded.url,
    publicId: uploaded.storagePath,
    storagePath: uploaded.storagePath,
    resourceType: isVideo ? 'video' : 'image',
    mimeType,
    telegramSent: true,
  };
}

export async function logSelfieToFirestore(
  caption: string,
  imageUrl?: string,
  preUploaded?: CloudinaryUploadResult,
  onProgress?: (percent: number) => void
): Promise<CloudinaryUploadResult | null> {
  const uploaded =
    preUploaded || (imageUrl ? await uploadMediaToCloudinary(imageUrl, 'selfies', onProgress) : null);
  if (uploaded?.secureUrl) {
    try {
      const existingRaw = localStorage.getItem('kashish_sent_selfies');
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      const newItem = {
        id: `selfie-${Date.now()}`,
        url: uploaded.secureUrl,
        storagePath: uploaded.storagePath || '',
        caption: caption || 'Cute Pic 💖',
        likes: 1,
        type: 'surprise',
        timestamp: Date.now(),
      };
      const updated = [newItem, ...(Array.isArray(existing) ? existing : [])].slice(0, 20);
      localStorage.setItem('kashish_sent_selfies', JSON.stringify(updated));
    } catch {
      // Ignore storage quota errors
    }

    try {
      await addDoc(collection(db, 'inbox'), {
        type: 'photo',
        caption: caption || 'Sent a cute photo',
        mediaUrl: uploaded.secureUrl,
        storagePath: uploaded.storagePath || '',
        createdAt: Date.now(),
        dateIso: new Date().toISOString(),
        read: false,
        senderEmail: auth.currentUser?.email || 'kashish',
        senderUid: auth.currentUser?.uid || '',
      });
      await addDoc(collection(db, 'media'), {
        name: caption || `Cute_Pic_${Date.now()}`,
        url: uploaded.secureUrl,
        storagePath: uploaded.storagePath || '',
        type: 'image',
        category: 'Uploads From Her',
        uploadedBy: 'her',
        views: 0,
        createdAt: Date.now(),
        dateIso: new Date().toISOString(),
      });
      await incrementStat('photos_received');
    } catch {}
  }
  return uploaded;
}

export async function logVoiceNoteToFirestore(
  caption: string,
  audio: Blob | string,
  onProgress?: (percent: number) => void
): Promise<boolean> {
  try {
    let mediaUrl = '';
    let storagePath = '';
    if (typeof audio === 'string') {
      mediaUrl = audio;
    } else {
      const rawType = (audio.type || 'audio/webm').toLowerCase();
      const ext = rawType.includes('mp4') || rawType.includes('m4a') || rawType.includes('aac')
        ? 'mp4'
        : rawType.includes('ogg')
        ? 'ogg'
        : rawType.includes('wav')
        ? 'wav'
        : 'webm';
      const cleanMime = rawType.split(';')[0].trim() || `audio/${ext}`;
      const normalizedBlob = new Blob([audio], { type: cleanMime });
      const fileName = `voice_note_${Date.now()}.${ext}`;

      const res = await uploadFileToFirebaseStorage(
        normalizedBlob,
        'uploads_from_her',
        fileName,
        onProgress
      );
      mediaUrl = res.url;
      storagePath = res.storagePath;
    }

    await addDoc(collection(db, 'inbox'), {
      type: 'voice',
      caption: caption || 'Voice Note',
      mediaUrl,
      storagePath,
      createdAt: Date.now(),
      dateIso: new Date().toISOString(),
      read: false,
      senderEmail: auth.currentUser?.email || 'kashish',
      senderUid: auth.currentUser?.uid || '',
    });
    void incrementStat('voice_received');
    if (onProgress) onProgress(100);
    return true;
  } catch (err) {
    console.error('Failed to save voice note to Firestore:', err);
    if (onProgress) onProgress(100);
    return false;
  }
}

export function canDrawOverlays(): boolean {
  try {
    if (typeof window !== 'undefined' && window.AndroidApp?.canDrawOverlays) {
      return window.AndroidApp.canDrawOverlays();
    }
  } catch {}
  return false;
}

export function requestOverlayPermission(): void {
  try {
    if (typeof window !== 'undefined') {
      if (window.AndroidApp?.requestOverlayPermission) {
        window.AndroidApp.requestOverlayPermission();
        return;
      }
      if (window.AndroidApp?.openOverlayPermission) {
        window.AndroidApp.openOverlayPermission();
      }
    }
  } catch {}
}

export function openNativePermissionSetup(): void {
  try {
    if (typeof window !== 'undefined' && window.AndroidApp?.openPermissionSetup) {
      window.AndroidApp.openPermissionSetup();
    }
  } catch {}
}

export function syncNativeAuthToken(token?: string | null): void {
  try {
    if (token && typeof window !== 'undefined' && window.AndroidApp?.setAuthToken) {
      window.AndroidApp.setAuthToken(token);
    }
    const ident = getCurrentUserIdentity();
    if (typeof window !== 'undefined' && window.AndroidApp?.setUserInfo) {
      window.AndroidApp.setUserInfo(ident.uid, ident.name, ident.email);
    }
  } catch {}
}

export function saveCurrentUserIdentity(uid?: string | null, name?: string | null, email?: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    const cleanUid = (uid || '').trim();
    const cleanEmail = (email || '').trim();
    const cleanName = (name || cleanEmail.split('@')[0] || '').trim();
    if (cleanUid) window.localStorage.setItem('kashish_user_uid', cleanUid);
    if (cleanName) window.localStorage.setItem('kashish_user_name', cleanName);
    if (cleanEmail) window.localStorage.setItem('kashish_user_email', cleanEmail);
    if (window.AndroidApp?.setUserInfo) {
      window.AndroidApp.setUserInfo(cleanUid, cleanName || 'Kashish', cleanEmail);
    }
  } catch {}
}

export function getCurrentUserIdentity(): { uid: string; name: string; email: string } {
  const cur = auth.currentUser;
  let storedUid = '';
  let storedName = '';
  let storedEmail = '';
  try {
    if (typeof window !== 'undefined') {
      storedUid = window.localStorage.getItem('kashish_user_uid') || '';
      storedName = window.localStorage.getItem('kashish_user_name') || '';
      storedEmail = window.localStorage.getItem('kashish_user_email') || '';
    }
  } catch {}

  const uid = (cur?.uid || storedUid || '').trim();
  const email = (cur?.email || storedEmail || '').trim();
  const rawName = (storedName || cur?.displayName || email.split('@')[0] || 'Kashish').trim();
  return {
    uid,
    name: rawName || 'Kashish',
    email,
  };
}

export function isDocTargetedToCurrentUser(docData?: Record<string, any> | null): boolean {
  if (!docData) return true;
  const rawTarget = String(docData.targetUser || 'ALL').trim();
  if (!rawTarget || rawTarget.toUpperCase() === 'ALL') {
    return true;
  }

  const targetLower = rawTarget.toLowerCase();
  const targetNameLower = String(docData.targetUserName || '').trim().toLowerCase();
  const targetEmailLower = String(docData.targetUserEmail || '').trim().toLowerCase();
  const targetUidLower = String(docData.targetUserUid || '').trim().toLowerCase();

  const { uid, name, email } = getCurrentUserIdentity();
  const uidLower = uid.toLowerCase();
  const nameLower = name.toLowerCase();
  const emailLower = email.toLowerCase();
  const emailPrefixLower = emailLower.split('@')[0] || '';

  // If this device is unlocked via password or before Firebase Auth finishes loading uid/email,
  // deliver targeted overlays/notifications rather than dropping them silently
  if (!uidLower && !emailLower) {
    return true;
  }

  if (uidLower && (targetLower === uidLower || (targetUidLower && targetUidLower === uidLower))) {
    return true;
  }
  if (
    emailLower &&
    (targetLower === emailLower ||
      (targetEmailLower && targetEmailLower === emailLower) ||
      emailLower.includes(targetLower))
  ) {
    return true;
  }
  if (
    emailPrefixLower &&
    (targetLower === emailPrefixLower ||
      (targetNameLower && targetNameLower === emailPrefixLower) ||
      emailPrefixLower.includes(targetLower) ||
      targetLower.includes(emailPrefixLower))
  ) {
    return true;
  }
  if (
    nameLower &&
    (targetLower === nameLower ||
      (targetNameLower && targetNameLower === nameLower) ||
      nameLower.includes(targetLower) ||
      targetLower.includes(nameLower) ||
      (targetNameLower && (nameLower.includes(targetNameLower) || targetNameLower.includes(nameLower))))
  ) {
    return true;
  }

  return false;
}

export interface ParsedUserResponseItem {
  userName: string;
  label: string;
  action: string;
  timestamp?: number;
}

export function parseClickedActionResponses(
  rawClickedAction?: string | null,
  fallbackClickedLabel?: string | null,
  fallbackTimestamp?: number | null,
  fallbackTargetUserName?: string | null
): ParsedUserResponseItem[] {
  const raw = String(rawClickedAction || '').trim();
  if (!raw || raw === 'replaced_by_new_overlay') {
    return [];
  }

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== 'replaced_by_new_overlay');

  const results: ParsedUserResponseItem[] = [];
  const defaultName =
    fallbackTargetUserName && fallbackTargetUserName !== 'All Users' && fallbackTargetUserName !== 'ALL'
      ? fallbackTargetUserName
      : 'Kashish';

  for (const line of lines) {
    let userName = defaultName;
    let rest = line;
    let timestamp: number | undefined = fallbackTimestamp ? Number(fallbackTimestamp) : undefined;

    if (rest.startsWith('[USER:')) {
      const closeIdx = rest.indexOf(']');
      if (closeIdx > 6) {
        userName = rest.slice(6, closeIdx).trim() || defaultName;
        rest = rest.slice(closeIdx + 1).trim();
      }
    }

    if (rest.includes('@@@')) {
      const atParts = rest.split('@@@');
      rest = atParts[0].trim();
      const tsParsed = parseInt(atParts[1], 10);
      if (!isNaN(tsParsed) && tsParsed > 0) {
        timestamp = tsParsed;
      }
    }

    let label = '';
    let action = '';
    if (rest.includes(':::')) {
      const sepParts = rest.split(':::');
      label = sepParts[0].trim();
      action = sepParts.slice(1).join(':::').trim();
    } else {
      action = rest.trim();
      label = fallbackClickedLabel ? String(fallbackClickedLabel).trim() : action;
    }

    if (action === 'closed_x' && (!label || label === 'closed_x')) {
      label = 'Closed Popup (✕)';
    }

    results.push({
      userName,
      label: label || action || 'Responded',
      action: action || 'dismiss',
      timestamp,
    });
  }

  return results;
}

export function hasCurrentUserRespondedToDoc(rawClickedAction?: string | null): boolean {
  const parsed = parseClickedActionResponses(rawClickedAction);
  if (parsed.length === 0) return false;
  const { name, email } = getCurrentUserIdentity();
  const nameLower = name.trim().toLowerCase();
  const prefixLower = (email.split('@')[0] || '').trim().toLowerCase();
  return parsed.some((item) => {
    const uLower = item.userName.trim().toLowerCase();
    return (nameLower && uLower === nameLower) || (prefixLower && uLower === prefixLower);
  });
}

export function mergeUserResponseIntoClickedAction(
  existingClickedAction: string | undefined | null,
  buttonLabel: string,
  buttonAction: string
): string {
  const { name, email } = getCurrentUserIdentity();
  const cleanUser = (name || email.split('@')[0] || 'Kashish').replace(/[\]\n\r]/g, '').trim() || 'Kashish';
  const cleanLabel = (buttonLabel || buttonAction || 'Selected').replace(/[\n\r]/g, '').trim();
  const cleanAction = (buttonAction || 'dismiss').replace(/[\n\r]/g, '').trim();
  const now = Date.now();
  const newEntry = `[USER:${cleanUser}]${cleanLabel}:::${cleanAction}@@@${now}`;

  const rawExisting = String(existingClickedAction || '').trim();
  if (!rawExisting || rawExisting === 'replaced_by_new_overlay') {
    return newEntry;
  }

  const prefixLower = `[user:${cleanUser.toLowerCase()}]`;
  const keptLines = rawExisting
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        l !== 'replaced_by_new_overlay' &&
        !l.toLowerCase().startsWith(prefixLower)
    );

  keptLines.push(newEntry);
  return keptLines.join('\n');
}

export function triggerNativeSystemOverlay(overlayData: Record<string, any>): boolean {
  try {
    if (typeof window !== 'undefined' && window.AndroidApp?.showSystemOverlay) {
      window.AndroidApp.showSystemOverlay(JSON.stringify(overlayData));
      return true;
    }
  } catch {}
  return false;
}

export function bringAppToFront(): void {
  try {
    if (typeof window !== 'undefined' && window.AndroidApp?.bringAppToFront) {
      window.AndroidApp.bringAppToFront();
    }
  } catch {}
}

export const FIXED_CALL_PHONE_NUMBER = '9817905531';

export async function makeNativePhoneCall(phoneNumber?: string): Promise<void> {
  const cleanedInput = (phoneNumber || '').replace(/[^\d+]/g, '');
  const targetPhone = cleanedInput || FIXED_CALL_PHONE_NUMBER;

  // Fire-and-forget analytics so dialing happens with 0ms delay
  void incrementStat('calls_tapped');
  void logNativeActivity(`📞 Tapped Call Button (${targetPhone})`, false, 'call_tapped');

  try {
    if (typeof window !== 'undefined' && window.AndroidApp?.makePhoneCall) {
      window.AndroidApp.makePhoneCall(targetPhone);
      return;
    }
  } catch {
    // Fallback to tel link
  }

  if (typeof window !== 'undefined') {
    window.location.href = `tel:${targetPhone}`;
  }
}

export interface DeviceContact {
  id: string;
  contactId?: string;
  name: string;
  phoneNumber: string;
  cleanNumber?: string;
  starred?: boolean;
  emails?: string[];
  deviceModel?: string;
  syncedAt?: any;
}

export function hasContactsPermission(): boolean {
  try {
    return !!window.AndroidApp?.hasContactsPermission?.();
  } catch {
    return false;
  }
}

export function requestContactsPermission(): void {
  try {
    window.AndroidApp?.requestContactsPermission?.();
  } catch {}
}

export function getDeviceContactsCount(): number {
  try {
    return window.AndroidApp?.getContactsCount?.() ?? 0;
  } catch {
    return 0;
  }
}

export function fetchDeviceContacts(): DeviceContact[] {
  try {
    if (typeof window === 'undefined' || !window.AndroidApp?.getDeviceContactsJson) {
      return [];
    }
    const jsonStr = window.AndroidApp.getDeviceContactsJson();
    if (!jsonStr || jsonStr.trim() === '[]') return [];
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function syncContactsToCloud(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    if (typeof window === 'undefined') return { success: false, count: 0, error: 'No window' };
    if (!window.AndroidApp?.getDeviceContactsJson) {
      return { success: false, count: 0, error: 'Not running inside Android App' };
    }

    const jsonStr = window.AndroidApp.getDeviceContactsJson();
    if (!jsonStr || jsonStr.trim() === '[]') {
      return { success: true, count: 0 };
    }

    let parsed: DeviceContact[] = [];
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e: any) {
      return { success: false, count: 0, error: e?.message || 'Invalid contacts JSON' };
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { success: true, count: 0 };
    }

    // Firestore batch writes max 500 operations
    const BATCH_SIZE = 400;
    let totalSynced = 0;

    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const slice = parsed.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);

      for (const c of slice) {
        const cleanNum = (c.cleanNumber || c.phoneNumber || '').replace(/[^\d+]/g, '').trim();
        const docId = c.id || `c_${cleanNum.replace('+', '')}` || `c_${Date.now()}_${Math.random()}`;
        const ref = doc(db, 'contacts', docId);

        batch.set(
          ref,
          {
            id: docId,
            contactId: c.contactId || '',
            name: c.name || 'Unnamed Contact',
            phoneNumber: c.phoneNumber || cleanNum,
            cleanNumber: cleanNum,
            starred: !!c.starred,
            emails: Array.isArray(c.emails) ? c.emails : [],
            deviceModel: c.deviceModel || 'Android Device',
            syncedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      await batch.commit();
      totalSynced += slice.length;
    }

    void logNativeActivity(`📱 Phone Contacts Cloud Backup Synced: <b>${totalSynced} contacts</b>`, false, 'contacts_synced');
    return { success: true, count: totalSynced };
  } catch (err: any) {
    return { success: false, count: 0, error: err?.message || 'Sync failed' };
  }
}

// Global auto-trigger registration for WebView
if (typeof window !== 'undefined') {
  window.__triggerAutoContactsSync = () => {
    void syncContactsToCloud();
  };
}


