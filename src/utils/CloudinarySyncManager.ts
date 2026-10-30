import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  getCloudinaryRuntimeConfig,
  type CloudinaryRuntimeConfig,
  type CloudinarySyncedGalleryItem,
} from '../androidBridge';

export const DEFAULT_CLOUDINARY_GALLERY_FOLDER = 'kashish-memories';

export interface CloudinarySyncResult {
  items: CloudinarySyncedGalleryItem[];
  folder: string;
  syncedToFirestore: number;
  fromCache?: boolean;
}

function formatReadableCaption(
  publicId: string,
  customCaption?: string,
  displayName?: string
): string {
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
 * Utility class that interacts with the Cloudinary API (via server proxy, native Android bridge,
 * and client-side resource list endpoint) to fetch and synchronize photos from the
 * `'kashish-memories'` folder into the GallerySection.
 */
export class CloudinarySyncManager {
  static readonly DEFAULT_FOLDER = DEFAULT_CLOUDINARY_GALLERY_FOLDER;

  /**
   * Returns any locally cached photos for the target Cloudinary folder for instant initial render.
   */
  static getCachedPhotos(
    folderName: string = DEFAULT_CLOUDINARY_GALLERY_FOLDER
  ): CloudinarySyncedGalleryItem[] {
    const cleanFolder =
      folderName.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_CLOUDINARY_GALLERY_FOLDER;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(`kashish_cloudinary_folder_cache_${cleanFolder}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed;
          }
        }
      }
    } catch {
      // Ignore storage errors
    }
    return [];
  }

  /**
   * Generates an optimized 1:1 square Cloudinary transformation URL when applicable,
   * while preserving original non-Cloudinary or video URLs.
   */
  static getSquareImageUrl(url: string, size: number = 800): string {
    if (!url || !url.includes('res.cloudinary.com') || !url.includes('/image/upload/')) {
      return url;
    }
    // Avoid double-inserting transformations if already present
    if (/\/image\/upload\/[^/]*c_(?:fill|crop|thumb|scale)/.test(url)) {
      return url;
    }
    return url.replace(
      '/image/upload/',
      `/image/upload/c_fill,g_auto,w_${size},h_${size},q_auto,f_auto/`
    );
  }

  /**
   * Fetches photos and videos from the specified Cloudinary folder (defaults to `'kashish-memories'`)
   * and synchronizes them with Firestore and local cache.
   */
  static async fetchPhotosFromFolder(
    folderName: string = DEFAULT_CLOUDINARY_GALLERY_FOLDER,
    overrideConfig?: Partial<CloudinaryRuntimeConfig>
  ): Promise<CloudinarySyncResult> {
    const runtimeCfg = getCloudinaryRuntimeConfig();
    const cloudName = (overrideConfig?.cloudName ?? runtimeCfg.cloudName).trim();
    const apiKey = (overrideConfig?.apiKey ?? runtimeCfg.apiKey ?? '').trim();
    const apiSecret = (overrideConfig?.apiSecret ?? runtimeCfg.apiSecret ?? '').trim();
    const cleanFolder =
      (
        folderName ||
        overrideConfig?.galleryFolder ||
        runtimeCfg.galleryFolder ||
        DEFAULT_CLOUDINARY_GALLERY_FOLDER
      )
        .trim()
        .replace(/^\/+|\/+$/g, '') || DEFAULT_CLOUDINARY_GALLERY_FOLDER;

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

    // 1. Query server-side Cloudinary API middleware (`/api/cloudinary-folder`)
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
      // Fall through to Native Android bridge / public client list
    }

    // 2. Query Native Android APK bridge (`window.AndroidApp.fetchCloudinaryFolder`)
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
              const resType: 'image' | 'video' =
                r?.resource_type === 'video' ? 'video' : 'image';
              const format = String(
                r?.format || (resType === 'video' ? 'mp4' : 'jpg')
              ).trim();
              const version = r?.version ? `v${r.version}/` : '';
              const url =
                r?.secure_url ||
                `https://res.cloudinary.com/${encodeURIComponent(
                  cloudName
                )}/${resType}/upload/${version}${publicId}.${format}`;
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
                caption: formatReadableCaption(
                  publicId,
                  customCaption,
                  r?.display_name || r?.filename
                ),
                createdAt,
              };
            })
            .filter(Boolean);
        }
      } catch {
        // Fall through to public client-side list
      }
    }

    // 3. Query Cloudinary Client-Side Resource List (`res.cloudinary.com/{cloudName}/image/list/{folder}.json`)
    if (rawResources.length === 0) {
      const candidateFolders =
        cleanFolder === DEFAULT_CLOUDINARY_GALLERY_FOLDER
          ? [DEFAULT_CLOUDINARY_GALLERY_FOLDER, 'memories_of_kashish']
          : [cleanFolder];

      for (const folderCandidate of candidateFolders) {
        try {
          const pubResp = await fetch(
            `https://res.cloudinary.com/${encodeURIComponent(
              cloudName
            )}/image/list/${encodeURIComponent(folderCandidate)}.json`,
            { cache: 'no-store' }
          );
          if (pubResp.ok) {
            const pubData = await pubResp.json();
            const list = Array.isArray(pubData?.resources) ? pubData.resources : [];
            if (list.length > 0) {
              rawResources = list
                .map((r: any) => {
                  const publicId = String(r?.public_id || '').trim();
                  if (!publicId) return null;
                  const resType: 'image' | 'video' =
                    r?.resource_type === 'video' ? 'video' : 'image';
                  const format = String(r?.format || 'jpg').trim();
                  const version = r?.version ? `v${r.version}/` : '';
                  const url = `https://res.cloudinary.com/${encodeURIComponent(
                    cloudName
                  )}/${resType}/upload/${version}${publicId}.${format}`;
                  const customCaption =
                    r?.context?.custom?.caption || r?.context?.custom?.alt || '';
                  const createdAt = r?.created_at
                    ? new Date(r.created_at).getTime() || Date.now()
                    : Date.now();
                  return {
                    publicId,
                    url,
                    resourceType: resType,
                    caption: formatReadableCaption(publicId, customCaption),
                    createdAt,
                  };
                })
                .filter(Boolean);
              break;
            }
          }
        } catch {
          // Continue to next candidate or cache fallback
        }
      }
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
      } catch {
        // Ignore storage error
      }

      // Mirror newly discovered items into Firestore `media` collection so all clients stay synced
      try {
        const snap = await getDocs(
          query(collection(db, 'media'), where('category', '==', 'Gallery'))
        );
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

        // Clean up any auto-synced Firestore docs whose source photo was removed from the Cloudinary folder
        for (const [oldPid, docId] of existingFolderDocs.entries()) {
          if (!currentPublicIds.has(oldPid)) {
            await deleteDoc(doc(db, 'media', docId)).catch(() => {});
          }
        }
      } catch {
        // Non-blocking Firestore sync
      }
    } else {
      const cached = CloudinarySyncManager.getCachedPhotos(cleanFolder);
      if (cached.length > 0) {
        return {
          items: cached,
          folder: cleanFolder,
          syncedToFirestore: 0,
          fromCache: true,
        };
      }
    }

    return { items, folder: cleanFolder, syncedToFirestore, fromCache: false };
  }
}

export default CloudinarySyncManager;
