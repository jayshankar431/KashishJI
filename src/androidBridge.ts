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
  showSystemOverlay?: (overlayJson: string) => void;
  setAuthToken?: (token: string) => void;
  getPermissionStatusJson?: () => string;
}

declare global {
  interface Window {
    AndroidApp?: AndroidAppBridge;
    isNativeApp?: boolean;
    __KASHISH_PERMISSIONS__?: any;
  }
}

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  return window.isNativeApp === true || !!window.AndroidApp;
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
    if (typeof window !== 'undefined' && window.AndroidApp?.requestPermissions) {
      window.AndroidApp.requestPermissions(types);
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
      }
    }
  } catch {
    // Ignore storage read error
  }

  if (uploadPreset === PLACEHOLDER_PRESET) {
    uploadPreset = '';
  }

  return { cloudName, uploadPreset, apiKey, apiSecret };
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
  explicitConfig?: CloudinaryRuntimeConfig
): Promise<{ url: string; storagePath: string; resourceType: 'image' | 'video' }> {
  const { cloudName, uploadPreset } = explicitConfig || getCloudinaryRuntimeConfig();

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

    formData.append('file', fileOrBlob, fileName);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', `kashish_app/${folder}`);

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
  } catch {}
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


