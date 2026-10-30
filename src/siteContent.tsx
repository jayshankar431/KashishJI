import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { resolveFirestoreMediaUrl } from './androidBridge';
import { CONFIG } from './config';
import type { CustomTabDefinition, DynamicSlotsMap } from './dynamicSlots';

export interface NameLetterMeaning {
  char: string;
  title: string;
  desc: string;
}

export interface SavedSound {
  id: string;
  name: string;
  url: string;
}

export type PopupButtonAction = 'call_now' | 'call_later' | 'open_url' | 'open_section' | 'dismiss';

export interface PopupButtonItem {
  label: string;
  action: PopupButtonAction;
  payload?: string;
}

export interface PopupTemplate {
  id: string;
  name: string;
  title: string;
  message: string;
  imageUrl?: string;
  popupColor: string;
  buttons: PopupButtonItem[];
  createdAt?: number;
}

export interface AppFeaturesConfig {
  games: boolean;
  galleryUpload: boolean;
  hug: boolean;
  call: boolean;
  voiceNote: boolean;
}

export const DEFAULT_NAME_MEANINGS: NameLetterMeaning[] = [
  {
    char: 'K',
    title: 'Kindness',
    desc: 'The quiet grace and empathy with which you treat every living soul around you.',
  },
  {
    char: 'A',
    title: 'Adorable',
    desc: 'The effortless charm in your smile and the sweet way your laugh rings out.',
  },
  {
    char: 'S',
    title: 'Sunshine',
    desc: 'Your sheer ability to brighten any overcast sky just by showing up.',
  },
  {
    char: 'H',
    title: 'Heart of Gold',
    desc: 'Pure, patient, and full of rare warmth that makes everyone feel cherished.',
  },
  {
    char: 'I',
    title: 'Invaluable',
    desc: 'A gem so rare in this universe that knowing you feels like the greatest lucky gift.',
  },
  {
    char: 'S',
    title: 'Serene',
    desc: 'The gentle peace and safe comfort you bring whenever we talk.',
  },
  {
    char: 'H',
    title: 'Hope',
    desc: 'A constant reminder that the world holds profound sweetness and magic.',
  },
];

export const DEFAULT_SAVED_SOUNDS: SavedSound[] = [
  {
    id: 'default_chime',
    name: 'Romantic Soft Chime (Default)',
    url: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
  },
  {
    id: 'magic_bell',
    name: 'Sweet Magic Bell',
    url: 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3',
  },
  {
    id: 'gentle_harp',
    name: 'Gentle Harp Melody',
    url: 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3',
  },
  {
    id: 'urgent_ring',
    name: 'Urgent Attention Tone',
    url: 'https://assets.mixkit.co/active_storage/sfx/2868/2868-preview.mp3',
  },
];

export interface SavedMusicTrack {
  id: string;
  name: string;
  url: string;
  storagePath?: string;
}

export interface SiteContent {
  name: string;
  birthday: string;
  favouriteSong: string;
  favouriteColour: string;
  homeMessage: string;
  entryLockHint: string;
  entryPlaceholder: string;
  entryLockHash: string;
  entryPassword: string;
  installButtonText: string;
  passwordHint: string;
  personalMessage: string;
  compliments: string[];
  nameMeanings: NameLetterMeaning[];
  lockPhotoUrl: string;
  appIconUrl: string;
  musicUrl: string;
  musicVolume: number;
  musicEnabled: boolean;
  musicSessionId: number;
  savedMusicTracks: SavedMusicTrack[];
  secretLetterMusicUrl: string;
  hideDefaultGallery: boolean;
  dynamicSlots: DynamicSlotsMap;
  customTabs: CustomTabDefinition[];
  callPhoneNumber: string;
  savedSounds: SavedSound[];
  popupTemplates: PopupTemplate[];
  cloudinaryCloudName: string;
  cloudinaryUploadPreset: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
  cloudinaryGalleryFolder: string;
  features: AppFeaturesConfig;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  maintenanceLinkUrl: string;
  maintenanceLinkLabel: string;
  forceLock: boolean;
  apkUpdateRequired: boolean;
  apkAutoUpdateOnPush: boolean;
  apkLatestVersion: string;
  apkDownloadUrl: string;
  apkUpdateTitle: string;
  apkUpdateNotes: string;
  apkApplyToWeb: boolean;
}

export type SiteOverrides = Partial<SiteContent>;

export const SITE_DEFAULTS: SiteContent = {
  name: CONFIG.name,
  birthday: CONFIG.birthday,
  favouriteSong: CONFIG.favouriteSong,
  favouriteColour: CONFIG.favouriteColour,
  homeMessage: 'A private sanctuary crafted for every smile, memory, and quiet moment.',
  entryLockHint: '',
  entryPlaceholder: '',
  entryLockHash: '',
  entryPassword: '',
  installButtonText: CONFIG.installButtonText,
  passwordHint: '',
  personalMessage: CONFIG.personalMessage,
  compliments: CONFIG.compliments,
  nameMeanings: DEFAULT_NAME_MEANINGS,
  lockPhotoUrl: CONFIG.lockPhotoUrl,
  appIconUrl: CONFIG.appIconUrl,
  musicUrl: CONFIG.musicUrl,
  musicVolume: 0.9,
  musicEnabled: false,
  musicSessionId: 0,
  savedMusicTracks: [],
  secretLetterMusicUrl: '',
  hideDefaultGallery: false,
  dynamicSlots: {},
  customTabs: [],
  callPhoneNumber: '9817905531',
  savedSounds: DEFAULT_SAVED_SOUNDS,
  popupTemplates: [],
  cloudinaryCloudName: 'dsfcu9y1h',
  cloudinaryUploadPreset: 'Unsigned Upload Preset Name',
  cloudinaryApiKey: '',
  cloudinaryApiSecret: '',
  cloudinaryGalleryFolder: 'kashish-memories',
  features: {
    games: true,
    galleryUpload: true,
    hug: true,
    call: true,
    voiceNote: true,
  },
  maintenanceMode: false,
  maintenanceMessage: 'Currently updating your special world. Please download the latest update below to continue!',
  maintenanceLinkUrl: '',
  maintenanceLinkLabel: 'Download Updated App (Kashishhh.apk) 💖',
  forceLock: false,
  apkUpdateRequired: false,
  apkAutoUpdateOnPush: true,
  apkLatestVersion: '2.4.0',
  apkDownloadUrl: 'https://github.com/sivam1100-creator/Kashish-World/releases/download/latest-apk/Kashishhh.apk',
  apkUpdateTitle: 'New Update Available for Kashishhh 💖',
  apkUpdateNotes: 'A new version of your special app is ready! Please download & install the update below to continue.',
  apkApplyToWeb: false,
};

export function mergeSite(raw: SiteOverrides): SiteContent {
  const out: SiteContent = { ...SITE_DEFAULTS };
  (Object.keys(SITE_DEFAULTS) as (keyof SiteContent)[]).forEach((k) => {
    const v = raw[k];
    if (v === undefined || v === null) return;
    if (typeof v === 'string' && v.trim() === '' && k !== 'entryPassword') return;
    if (Array.isArray(v) && v.length === 0) return;
    Object.assign(out, { [k]: v });
  });
  if (raw.features) {
    out.features = { ...SITE_DEFAULTS.features, ...raw.features };
  }
  if (raw.entryLockHash && raw.entryLockHash.trim()) out.entryPassword = '';
  return out;
}

interface Ctx {
  site: SiteContent;
  overrides: SiteOverrides;
  ready: boolean;
}

const SiteContext = createContext<Ctx>({ site: SITE_DEFAULTS, overrides: {}, ready: true });

export const SiteContentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [overrides, setOverrides] = useState<SiteOverrides>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem('kashish_site_overrides');
        return saved ? (JSON.parse(saved) as SiteOverrides) : {};
      }
    } catch {
      // Ignore localStorage error
    }
    return {};
  });

  useEffect(() => {
    // 1. Real-time listener on content/main (text, poems, letters, name meanings, countdown date)
    const unsubContent = onSnapshot(
      doc(db, 'content', 'main'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<SiteContent>;
          setOverrides((prev) => {
            const next = { ...prev, ...data };
            try {
              window.localStorage.setItem('kashish_site_overrides', JSON.stringify(next));
            } catch {}
            return next;
          });
        }
      },
      () => {}
    );

    // 2. Real-time listener on settings/config (feature toggles, music, lock password, call number, maintenance)
    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'config'),
      async (snap) => {
        if (snap.exists()) {
          const rawData = { ...(snap.data() as Partial<SiteContent>) };
          const stateData = { ...rawData };
          if (
            stateData.musicUrl &&
            (stateData.musicUrl.startsWith('firestore-chunked://') ||
              stateData.musicUrl.startsWith('data:audio/'))
          ) {
            const resolved = await resolveFirestoreMediaUrl(stateData.musicUrl);
            if (resolved) stateData.musicUrl = resolved;
          }
          setOverrides((prev) => {
            const nextState = { ...prev, ...stateData };
            try {
              const forStorage = { ...prev, ...rawData };
              window.localStorage.setItem('kashish_site_overrides', JSON.stringify(forStorage));
            } catch {}
            return nextState;
          });
        }
      },
      () => {}
    );
    return () => {
      unsubContent();
      unsubSettings();
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      site: mergeSite(overrides),
      overrides,
      ready: true,
    }),
    [overrides]
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
};

export const useSite = () => useContext(SiteContext).site;
export const useSiteOverrides = () => useContext(SiteContext).overrides;
export const useSiteReady = () => useContext(SiteContext).ready;

