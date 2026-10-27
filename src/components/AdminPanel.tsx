import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  limit,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import {
  signInWithEmailAndPassword,
  updatePassword,
  onAuthStateChanged,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import { auth, db, ADMIN_EMAIL, firebaseConfig } from '../firebase';
import {
  uploadFileToFirebaseStorage,
  resolveFirestoreMediaUrl,
  deleteFirestoreMediaChunks,
  testCloudinaryConnection,
  fetchLatestReleaseApkInfo,
  LatestReleaseApkInfo,
  isVersionOlder,
  syncContactsToCloud,
  parseClickedActionResponses,
} from '../androidBridge';
import {
  useSite,
  useSiteOverrides,
  DEFAULT_NAME_MEANINGS,
  DEFAULT_SAVED_SOUNDS,
  NameLetterMeaning,
  PopupButtonAction,
  PopupButtonItem,
} from '../siteContent';
import { CONFIG } from '../config';
import { audioCache } from '../services/audioCache';
import { romanticAudio } from '../audio';
import {
  OVERLAY_THEMES,
  OVERLAY_FONTS,
  OverlayThemeId,
  OverlayFontId,
} from './LiveOverlaysAndNotifications';
import {
  LayoutDashboard,
  Activity,
  Image as ImageIcon,
  Inbox,
  Bell,
  Layers,
  FolderKanban,
  FileEdit,
  Sliders,
  Settings,
  Menu,
  X,
  Sun,
  Moon,
  Trash2,
  Plus,
  Download,
  Check,
  Search,
  Play,
  Pause,
  Send,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  LogOut,
  ExternalLink,
  Copy,
  RefreshCw,
  UserCheck,
  BookUser,
  Smartphone,
  Phone,
  MessageSquare,
  Star,
  Mail,
} from 'lucide-react';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type AdminSectionId =
  | 'dashboard'
  | 'users'
  | 'activity'
  | 'media'
  | 'inbox'
  | 'notifications'
  | 'overlays'
  | 'content'
  | 'control'
  | 'settings'
  | 'contacts';

const SIDEBAR_ITEMS: { id: AdminSectionId; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'dashboard', label: '1. Dashboard', icon: LayoutDashboard },
  { id: 'users', label: 'User Approvals', icon: UserCheck },
  { id: 'activity', label: '2. Activity Tracker', icon: Activity },
  { id: 'media', label: '3. Media Manager', icon: ImageIcon },
  { id: 'inbox', label: '4. Inbox (From Her)', icon: Inbox },
  { id: 'notifications', label: '5. Notification Sender', icon: Bell },
  { id: 'overlays', label: '6. Overlay Popup Sender', icon: Layers },
  { id: 'content', label: '8. Content Editor', icon: FileEdit },
  { id: 'control', label: '9. App Control', icon: Sliders },
  { id: 'settings', label: '10. Settings & Rules', icon: Settings },
  { id: 'contacts', label: '11. Contacts Cloud Vault', icon: BookUser },
];

const MEDIA_CATEGORIES = ['Gallery', 'Secret Photos', 'Open When', 'Home photo', 'Uploads From Her'] as const;

export const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose }) => {
  const site = useSite();

  // Theme & Layout State
  const [dark, setDark] = useState<boolean>(true);
  const [activeSection, setActiveSection] = useState<AdminSectionId>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('kashish_admin_active_section') : null;
      return (saved as AdminSectionId) || 'dashboard';
    } catch {
      return 'dashboard';
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  // Keep active section saved in localStorage
  useEffect(() => {
    try {
      localStorage.setItem('kashish_admin_active_section', activeSection);
    } catch {}
  }, [activeSection]);

  // Auth State
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(() => auth.currentUser);
  const [loginEmail, setLoginEmail] = useState<string>(ADMIN_EMAIL);
  const [loginPass, setLoginPass] = useState<string>('');
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>('');

  // Status & Confirmation Modal State
  const [statusText, setStatusText] = useState<string>('');
  const [errorText, setErrorText] = useState<string>('');
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);

  // Real-time Firestore Data State
  const [statsDoc, setStatsDoc] = useState<Record<string, any>>({});
  const [activities, setActivities] = useState<any[]>([]);
  const [mediaItems, setMediaItems] = useState<any[]>([]);
  const [inboxItems, setInboxItems] = useState<any[]>([]);
  const [notificationsList, setNotificationsList] = useState<any[]>([]);
  const [overlaysList, setOverlaysList] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [contactsList, setContactsList] = useState<any[]>([]);
  const [contactsSearch, setContactsSearch] = useState<string>(() => {
    try {
      return localStorage.getItem('kashish_admin_contacts_search') || '';
    } catch {
      return '';
    }
  });
  const [contactsSort, setContactsSort] = useState<'name' | 'recent'>(() => {
    try {
      return (localStorage.getItem('kashish_admin_contacts_sort') as any) || 'name';
    } catch {
      return 'name';
    }
  });
  const [copiedNumber, setCopiedNumber] = useState<string | null>(null);
  const [syncingContacts, setSyncingContacts] = useState<boolean>(false);
  const [userFilter, setUserFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [userSearch, setUserSearch] = useState<string>('');
  const [dataLoading, setDataLoading] = useState<boolean>(true);

  // Section 2: Activity Filters
  const [actDateFilter, setActDateFilter] = useState<string>('');
  const [actTypeFilter, setActTypeFilter] = useState<string>('all');
  const [actSearch, setActSearch] = useState<string>('');

  // Section 3: Media Manager State
  const [mediaViewMode, setMediaViewMode] = useState<'grid' | 'list'>('grid');
  const [mediaCategoryFilter, setMediaCategoryFilter] = useState<string>('all');
  const [uploadCategory, setUploadCategory] = useState<string>('Gallery');
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploadingMedia, setIsUploadingMedia] = useState<boolean>(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [previewMedia, setPreviewMedia] = useState<any | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [directMediaUrl, setDirectMediaUrl] = useState<string>('');
  const [directMediaName, setDirectMediaName] = useState<string>('');
  const [directMediaType, setDirectMediaType] = useState<'image' | 'video'>('image');

  // Section 4: Inbox State
  const [replyTarget, setReplyTarget] = useState<any | null>(null);
  const [replyTitle, setReplyTitle] = useState<string>('Reply from Jay');
  const [replyMessage, setReplyMessage] = useState<string>('');
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioEl] = useState<HTMLAudioElement | null>(() =>
    typeof Audio !== 'undefined' ? new Audio() : null
  );

  // Section 5: Notification Sender State (Restores last saved setting from localStorage)
  const [notifTitle, setNotifTitle] = useState<string>(() => {
    try {
      return localStorage.getItem('kashish_admin_notif_title') || '';
    } catch {
      return '';
    }
  });
  const [notifMessage, setNotifMessage] = useState<string>(() => {
    try {
      return localStorage.getItem('kashish_admin_notif_msg') || '';
    } catch {
      return '';
    }
  });
  const [notifImage, setNotifImage] = useState<string>(() => {
    try {
      return localStorage.getItem('kashish_admin_notif_img') || '';
    } catch {
      return '';
    }
  });
  const [notifSoundUrl, setNotifSoundUrl] = useState<string>(() => {
    try {
      return localStorage.getItem('kashish_admin_notif_sound') || DEFAULT_SAVED_SOUNDS[0].url;
    } catch {
      return DEFAULT_SAVED_SOUNDS[0].url;
    }
  });
  const [notifScheduleTime, setNotifScheduleTime] = useState<string>('');
  const [notifButtons, setNotifButtons] = useState<PopupButtonItem[]>(() => {
    try {
      const raw = localStorage.getItem('kashish_admin_notif_buttons');
      if (raw) return JSON.parse(raw);
    } catch {}
    return [
      { label: 'Call Me Now 📞', action: 'call_now', payload: '9817905531' },
      { label: 'Open Our Gallery ✨', action: 'open_section', payload: 'gallery' },
    ];
  });
  const [notifTargetMode, setNotifTargetMode] = useState<'ALL' | 'USER'>(() => {
    try {
      return (localStorage.getItem('kashish_admin_notif_target_mode') as 'ALL' | 'USER') || 'ALL';
    } catch {
      return 'ALL';
    }
  });
  const [notifTargetUser, setNotifTargetUser] = useState<string>(() => {
    try {
      return localStorage.getItem('kashish_admin_notif_target_user') || '';
    } catch {
      return '';
    }
  });
  const [customSounds, setCustomSounds] = useState<{ id?: string; name: string; url: string }[]>(() => {
    const saved = site.savedSounds || [];
    const defaultUrls = new Set(DEFAULT_SAVED_SOUNDS.map((d) => d.url));
    return saved.filter((s) => s.url && !defaultUrls.has(s.url));
  });
  const [uploadingSound, setUploadingSound] = useState<boolean>(false);
  const [previewingSoundUrl, setPreviewingSoundUrl] = useState<string>('');

  // Persist notification sender draft so last entered settings stay
  useEffect(() => {
    try {
      localStorage.setItem('kashish_admin_notif_title', notifTitle);
      localStorage.setItem('kashish_admin_notif_msg', notifMessage);
      localStorage.setItem('kashish_admin_notif_img', notifImage);
      localStorage.setItem('kashish_admin_notif_sound', notifSoundUrl);
      localStorage.setItem('kashish_admin_notif_buttons', JSON.stringify(notifButtons));
      localStorage.setItem('kashish_admin_notif_target_mode', notifTargetMode);
      localStorage.setItem('kashish_admin_notif_target_user', notifTargetUser);
    } catch {}
  }, [notifTitle, notifMessage, notifImage, notifSoundUrl, notifButtons, notifTargetMode, notifTargetUser]);

  // Section 6: Overlay Popup Sender State (Restores last saved setting from localStorage)
  const [ovTitle, setOvTitle] = useState<string>(() => {
    try {
      return localStorage.getItem('kashish_admin_ov_title') || 'Thinking of You, Kashish';
    } catch {
      return 'Thinking of You, Kashish';
    }
  });
  const [ovMessage, setOvMessage] = useState<string>(() => {
    try {
      return (
        localStorage.getItem('kashish_admin_ov_msg') ||
        'Just wanted to remind you how special you are to me. Tap below whenever you want to talk!'
      );
    } catch {
      return 'Just wanted to remind you how special you are to me. Tap below whenever you want to talk!';
    }
  });
  const [ovImage, setOvImage] = useState<string>(() => {
    try {
      return localStorage.getItem('kashish_admin_ov_img') || '';
    } catch {
      return '';
    }
  });
  const [ovTheme, setOvTheme] = useState<OverlayThemeId>(() => {
    try {
      return (localStorage.getItem('kashish_admin_ov_theme') as OverlayThemeId) || 'velvet-rose';
    } catch {
      return 'velvet-rose';
    }
  });
  const [ovFontStyle, setOvFontStyle] = useState<OverlayFontId>(() => {
    try {
      return (localStorage.getItem('kashish_admin_ov_font') as OverlayFontId) || 'romantic-serif';
    } catch {
      return 'romantic-serif';
    }
  });
  const [ovSoundUrl, setOvSoundUrl] = useState<string>(() => {
    try {
      return localStorage.getItem('kashish_admin_ov_sound') || DEFAULT_SAVED_SOUNDS[0].url;
    } catch {
      return DEFAULT_SAVED_SOUNDS[0].url;
    }
  });
  const [ovScheduleTime, setOvScheduleTime] = useState<string>('');
  const [ovButtons, setOvButtons] = useState<PopupButtonItem[]>(() => {
    try {
      const raw = localStorage.getItem('kashish_admin_ov_buttons');
      if (raw) return JSON.parse(raw);
    } catch {}
    return [
      { label: 'Call Me Now', action: 'call_now', payload: '9817905531' },
      { label: 'Open Our Gallery', action: 'open_section', payload: 'gallery' },
      { label: 'Keep in My Heart', action: 'dismiss', payload: '' },
    ];
  });
  const [ovTargetMode, setOvTargetMode] = useState<'ALL' | 'USER'>(() => {
    try {
      return (localStorage.getItem('kashish_admin_ov_target_mode') as 'ALL' | 'USER') || 'ALL';
    } catch {
      return 'ALL';
    }
  });
  const [ovTargetUser, setOvTargetUser] = useState<string>(() => {
    try {
      return localStorage.getItem('kashish_admin_ov_target_user') || '';
    } catch {
      return '';
    }
  });
  const [deviceStatusDoc, setDeviceStatusDoc] = useState<Record<string, any>>({});

  // Persist overlay popup sender draft so last entered settings stay
  useEffect(() => {
    try {
      localStorage.setItem('kashish_admin_ov_title', ovTitle);
      localStorage.setItem('kashish_admin_ov_msg', ovMessage);
      localStorage.setItem('kashish_admin_ov_img', ovImage);
      localStorage.setItem('kashish_admin_ov_theme', ovTheme);
      localStorage.setItem('kashish_admin_ov_font', ovFontStyle);
      localStorage.setItem('kashish_admin_ov_sound', ovSoundUrl);
      localStorage.setItem('kashish_admin_ov_buttons', JSON.stringify(ovButtons));
      localStorage.setItem('kashish_admin_ov_target_mode', ovTargetMode);
      localStorage.setItem('kashish_admin_ov_target_user', ovTargetUser);
    } catch {}
  }, [ovTitle, ovMessage, ovImage, ovTheme, ovFontStyle, ovSoundUrl, ovButtons, ovTargetMode, ovTargetUser]);

  // Persist contacts vault search & sort so last settings stay
  useEffect(() => {
    try {
      localStorage.setItem('kashish_admin_contacts_search', contactsSearch);
      localStorage.setItem('kashish_admin_contacts_sort', contactsSort);
    } catch {}
  }, [contactsSearch, contactsSort]);

  // Section 8: Content Editor State
  const [editRecipientName, setEditRecipientName] = useState<string>(site.name);
  const [editCountdownDate, setEditCountdownDate] = useState<string>(site.birthday || '2026-12-17');
  const [editHomeMessage, setEditHomeMessage] = useState<string>(site.homeMessage || '');
  const [editSecretLetter, setEditSecretLetter] = useState<string>(site.personalMessage || '');
  const [editNameMeanings, setEditNameMeanings] = useState<NameLetterMeaning[]>(
    site.nameMeanings?.length ? site.nameMeanings : DEFAULT_NAME_MEANINGS
  );
  const [editCompliments, setEditCompliments] = useState<string[]>(site.compliments || []);
  const [newCompliment, setNewCompliment] = useState<string>('');

  // Section 10: App Control State
  const [featGames, setFeatGames] = useState<boolean>(site.features?.games !== false);
  const [featGalleryUpload, setFeatGalleryUpload] = useState<boolean>(site.features?.galleryUpload !== false);
  const [featHug, setFeatHug] = useState<boolean>(site.features?.hug !== false);
  const [featCall, setFeatCall] = useState<boolean>(site.features?.call !== false);
  const [featVoiceNote, setFeatVoiceNote] = useState<boolean>(site.features?.voiceNote !== false);
  const [lockPasswordInput, setLockPasswordInput] = useState<string>(site.entryPassword || '');
  const [callNumberInput, setCallNumberInput] = useState<string>(site.callPhoneNumber || '9817905531');
  const [maintMode, setMaintMode] = useState<boolean>(!!site.maintenanceMode);
  const [maintMessage, setMaintMessage] = useState<string>(
    site.maintenanceMessage || 'Currently updating your special world. Please download the latest update below to continue!'
  );
  const [maintLinkUrl, setMaintLinkUrl] = useState<string>(site.maintenanceLinkUrl || '');
  const [maintLinkLabel, setMaintLinkLabel] = useState<string>(
    site.maintenanceLinkLabel || 'Download Updated App (Kashishhh.apk) 💖'
  );
  const [forceLockMode, setForceLockMode] = useState<boolean>(!!site.forceLock);
  const [apkUpdateReq, setApkUpdateReq] = useState<boolean>(!!site.apkUpdateRequired);
  const [apkAutoPush, setApkAutoPush] = useState<boolean>(site.apkAutoUpdateOnPush !== false);
  const [apkLatestVer, setApkLatestVer] = useState<string>(site.apkLatestVersion || '3.0.0');
  const [apkUrlInput, setApkUrlInput] = useState<string>(
    site.apkDownloadUrl ||
      'https://github.com/sivam1100-creator/Kashish-World/releases/download/latest-apk/Kashishhh.apk'
  );
  const [apkTitleInput, setApkTitleInput] = useState<string>(
    site.apkUpdateTitle || 'New Update Available for Kashishhh 💖'
  );
  const [apkNotesInput, setApkNotesInput] = useState<string>(
    site.apkUpdateNotes ||
      'A new version of your special app is ready! Please download & install the update below to continue.'
  );
  const [apkApplyWeb, setApkApplyWeb] = useState<boolean>(!!site.apkApplyToWeb);
  const [liveCiApkMeta, setLiveCiApkMeta] = useState<LatestReleaseApkInfo | null>(null);

  // Section 11 & Media Manager: Cloudinary Free Storage State
  const [newAdminPassword, setNewAdminPassword] = useState<string>('');
  const [cloudNameInput, setCloudNameInput] = useState<string>(site.cloudinaryCloudName || 'dsfcu9y1h');
  const [uploadPresetInput, setUploadPresetInput] = useState<string>(
    site.cloudinaryUploadPreset || 'Unsigned Upload Preset Name'
  );
  const [apiKeyInput, setApiKeyInput] = useState<string>(site.cloudinaryApiKey || '');
  const [apiSecretInput, setApiSecretInput] = useState<string>(site.cloudinaryApiSecret || '');
  const [testingCloudinary, setTestingCloudinary] = useState<boolean>(false);
  const [cloudinaryStatusMsg, setCloudinaryStatusMsg] = useState<string>('');
  const [showCloudinaryBox, setShowCloudinaryBox] = useState<boolean>(false);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
    });
    return () => unsub();
  }, []);

  // Sync local editor fields ONCE when Admin Panel opens (prevents 22-state re-render storms on every live save)
  useEffect(() => {
    if (!isOpen) return;
    setEditRecipientName(site.name);
    setEditCountdownDate(site.birthday || '2026-12-17');
    setEditHomeMessage(site.homeMessage || '');
    setEditSecretLetter(site.personalMessage || '');
    if (site.nameMeanings?.length) setEditNameMeanings(site.nameMeanings);
    if (site.compliments?.length) setEditCompliments(site.compliments);
    setFeatGames(site.features?.games !== false);
    setFeatGalleryUpload(site.features?.galleryUpload !== false);
    setFeatHug(site.features?.hug !== false);
    setFeatCall(site.features?.call !== false);
    setFeatVoiceNote(site.features?.voiceNote !== false);
    setLockPasswordInput(site.entryPassword || '');
    setCallNumberInput(site.callPhoneNumber || '9817905531');
    setMaintMode(!!site.maintenanceMode);
    if (site.maintenanceMessage) setMaintMessage(site.maintenanceMessage);
    setMaintLinkUrl(site.maintenanceLinkUrl || '');
    setMaintLinkLabel(site.maintenanceLinkLabel || 'Download Updated App (Kashishhh.apk) 💖');
    setForceLockMode(!!site.forceLock);
    setApkUpdateReq(!!site.apkUpdateRequired);
    setApkAutoPush(site.apkAutoUpdateOnPush !== false);
    if (site.apkLatestVersion) setApkLatestVer(site.apkLatestVersion);
    if (site.apkDownloadUrl) setApkUrlInput(site.apkDownloadUrl);
    if (site.apkUpdateTitle) setApkTitleInput(site.apkUpdateTitle);
    if (site.apkUpdateNotes) setApkNotesInput(site.apkUpdateNotes);
    setApkApplyWeb(!!site.apkApplyToWeb);
    void fetchLatestReleaseApkInfo().then((info) => {
      if (info) setLiveCiApkMeta(info);
    });
    if (site.cloudinaryCloudName) setCloudNameInput(site.cloudinaryCloudName);
    if (site.cloudinaryUploadPreset !== undefined) setUploadPresetInput(site.cloudinaryUploadPreset);
    if (site.cloudinaryApiKey !== undefined) setApiKeyInput(site.cloudinaryApiKey);
    if (site.cloudinaryApiSecret !== undefined) setApiSecretInput(site.cloudinaryApiSecret);
    if (Array.isArray(site.savedSounds) && site.savedSounds.length > 0) {
      const defaultUrls = new Set(DEFAULT_SAVED_SOUNDS.map((d) => d.url));
      setCustomSounds(site.savedSounds.filter((s) => s.url && !defaultUrls.has(s.url)));
    }
  }, [isOpen]);

  const isAdminAuthenticated =
    !!currentUser && currentUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  // Attach real-time Firestore listeners when admin panel is open & authenticated
  useEffect(() => {
    if (!isOpen || !isAdminAuthenticated) return;
    setDataLoading(true);

    const unsubStats = onSnapshot(
      doc(db, 'settings', 'stats'),
      (snap) => {
        if (snap.exists()) setStatsDoc(snap.data());
        setDataLoading(false);
      },
      (err) => {
        setErrorText(`Stats sync notice: ${err.message}`);
        setDataLoading(false);
      }
    );

    const unsubActivity = onSnapshot(
      query(collection(db, 'activity'), orderBy('timestamp', 'desc'), limit(100)),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setActivities(list);
      },
      () => {}
    );

    const unsubMedia = onSnapshot(
      query(collection(db, 'media'), orderBy('createdAt', 'desc'), limit(80)),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          const data = d.data();
          if (data.isChunk) {
            // Auto-strip `createdAt` from legacy 600KB chunk docs so they never slow down media queries again
            if (data.createdAt !== undefined) {
              void updateDoc(doc(db, 'media', d.id), {
                createdAt: deleteField(),
                chunkCreatedAt: data.createdAt,
              }).catch(() => {});
            }
            return;
          }
          list.push({ id: d.id, ...data });
        });
        setMediaItems(list);
      },
      () => {}
    );

    const unsubInbox = onSnapshot(
      query(collection(db, 'inbox'), orderBy('createdAt', 'desc'), limit(80)),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setInboxItems(list);
      },
      () => {}
    );

    const unsubNotifs = onSnapshot(
      query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(60)),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setNotificationsList(list);
      },
      () => {}
    );

    const unsubOverlays = onSnapshot(
      query(collection(db, 'overlays'), orderBy('createdAt', 'desc'), limit(60)),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setOverlaysList(list);
      },
      () => {}
    );
    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setUsersList(list);
      },
      () => {}
    );

    const unsubContacts = onSnapshot(
      collection(db, 'contacts'),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setContactsList(list);
      },
      () => {}
    );

    const unsubDeviceStatus = onSnapshot(
      doc(db, 'settings', 'device_status'),
      (snap) => {
        if (snap.exists()) setDeviceStatusDoc(snap.data());
      },
      () => {}
    );

    // Real-time listener for Content Editor (content/main) to guarantee last saved values persist
    const unsubContentDoc = onSnapshot(
      doc(db, 'content', 'main'),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        if (d.name !== undefined) setEditRecipientName(d.name);
        if (d.birthday !== undefined) setEditCountdownDate(d.birthday);
        if (d.homeMessage !== undefined) setEditHomeMessage(d.homeMessage);
        if (d.personalMessage !== undefined) setEditSecretLetter(d.personalMessage);
        if (Array.isArray(d.nameMeanings) && d.nameMeanings.length > 0) setEditNameMeanings(d.nameMeanings);
        if (Array.isArray(d.compliments)) setEditCompliments(d.compliments);
      },
      () => {}
    );

    // Real-time listener for Settings & App Control (settings/config) to guarantee last saved values persist
    const unsubSettingsConfig = onSnapshot(
      doc(db, 'settings', 'config'),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        if (d.features) {
          if (d.features.games !== undefined) setFeatGames(d.features.games);
          if (d.features.galleryUpload !== undefined) setFeatGalleryUpload(d.features.galleryUpload);
          if (d.features.hug !== undefined) setFeatHug(d.features.hug);
          if (d.features.call !== undefined) setFeatCall(d.features.call);
          if (d.features.voiceNote !== undefined) setFeatVoiceNote(d.features.voiceNote);
        }
        if (d.callPhoneNumber !== undefined) setCallNumberInput(d.callPhoneNumber);
        if (d.entryPassword !== undefined) setLockPasswordInput(d.entryPassword);
        if (d.maintenanceMode !== undefined) setMaintMode(d.maintenanceMode);
        if (d.maintenanceMessage !== undefined) setMaintMessage(d.maintenanceMessage);
        if (d.maintenanceLinkUrl !== undefined) setMaintLinkUrl(d.maintenanceLinkUrl);
        if (d.maintenanceLinkLabel !== undefined) setMaintLinkLabel(d.maintenanceLinkLabel);
        if (d.forceLock !== undefined) setForceLockMode(d.forceLock);
        if (d.apkUpdateRequired !== undefined) setApkUpdateReq(d.apkUpdateRequired);
        if (d.apkAutoUpdateOnPush !== undefined) setApkAutoPush(d.apkAutoUpdateOnPush);
        if (d.apkLatestVersion !== undefined) setApkLatestVer(d.apkLatestVersion);
        if (d.apkDownloadUrl !== undefined) setApkUrlInput(d.apkDownloadUrl);
        if (d.apkUpdateTitle !== undefined) setApkTitleInput(d.apkUpdateTitle);
        if (d.apkUpdateNotes !== undefined) setApkNotesInput(d.apkUpdateNotes);
        if (d.apkApplyToWeb !== undefined) setApkApplyWeb(d.apkApplyToWeb);
        if (d.cloudinaryCloudName !== undefined) setCloudNameInput(d.cloudinaryCloudName);
        if (d.cloudinaryUploadPreset !== undefined) setUploadPresetInput(d.cloudinaryUploadPreset);
        if (d.cloudinaryApiKey !== undefined) setApiKeyInput(d.cloudinaryApiKey);
        if (d.cloudinaryApiSecret !== undefined) setApiSecretInput(d.cloudinaryApiSecret);
        if (Array.isArray(d.savedSounds) && d.savedSounds.length > 0) {
          const defaultUrls = new Set(DEFAULT_SAVED_SOUNDS.map((s) => s.url));
          setCustomSounds(d.savedSounds.filter((s: any) => s.url && !defaultUrls.has(s.url)));
        }
      },
      () => {}
    );

    return () => {
      unsubStats();
      unsubActivity();
      unsubMedia();
      unsubInbox();
      unsubNotifs();
      unsubOverlays();
      unsubUsers();
      unsubContacts();
      unsubDeviceStatus();
      unsubContentDoc();
      unsubSettingsConfig();
    };
  }, [isOpen, isAdminAuthenticated]);

  const isUserAdminAccount = (u: any) =>
    String(u?.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();

  const getUserStatus = (u: any): 'approved' | 'pending' | 'rejected' => {
    if (isUserAdminAccount(u) || u?.approved === true || u?.status === 'approved') {
      return 'approved';
    }
    if (u?.status === 'rejected') return 'rejected';
    return 'pending';
  };

  const pendingUsersList = useMemo(
    () => usersList.filter((u) => !isUserAdminAccount(u) && getUserStatus(u) === 'pending'),
    [usersList]
  );

  const filteredUsersList = useMemo(() => {
    return usersList.filter((u) => {
      const st = getUserStatus(u);
      if (userFilter !== 'all' && st !== userFilter) return false;
      if (userSearch.trim()) {
        const q = userSearch.toLowerCase();
        const emailStr = String(u.email || '').toLowerCase();
        const nameStr = String(u.displayName || '').toLowerCase();
        if (!emailStr.includes(q) && !nameStr.includes(q)) return false;
      }
      return true;
    });
  }, [usersList, userFilter, userSearch]);

  // Selectable non-admin users for Notification & Overlay Target Audience Selector
  const selectableTargetUsers = useMemo(() => {
    const map = new Map<string, { id: string; username: string; email: string; status: string }>();
    usersList.forEach((u) => {
      if (isUserAdminAccount(u)) return;
      const email = String(u.email || '').trim();
      const username = String(u.displayName || email.split('@')[0] || 'User').trim();
      const key = (email || username || u.id).toLowerCase();
      if (!key) return;
      map.set(key, {
        id: u.uid || u.id || username,
        username,
        email,
        status: getUserStatus(u),
      });
    });
    activities.forEach((a) => {
      const email = String(a.userEmail || '').trim();
      if (!email || email === 'guest' || email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return;
      const key = email.toLowerCase();
      if (!map.has(key)) {
        const username = email.split('@')[0] || email;
        map.set(key, {
          id: username,
          username,
          email,
          status: 'approved',
        });
      }
    });
    return Array.from(map.values());
  }, [usersList, activities]);

  const resolveTargetMetadata = (mode: 'ALL' | 'USER', rawInput: string) => {
    if (mode === 'ALL') {
      return {
        targetUser: 'ALL',
        targetUserName: 'All Users',
        targetUserEmail: '',
        targetUserUid: '',
      };
    }
    const fallbackUser = selectableTargetUsers[0]?.username || editRecipientName.trim() || 'Kashish';
    const clean = (rawInput || fallbackUser).trim();
    const matched = selectableTargetUsers.find(
      (u) =>
        u.username.toLowerCase() === clean.toLowerCase() ||
        u.email.toLowerCase() === clean.toLowerCase() ||
        u.id.toLowerCase() === clean.toLowerCase()
    );
    if (matched) {
      return {
        targetUser: matched.username || matched.email || matched.id,
        targetUserName: matched.username,
        targetUserEmail: matched.email,
        targetUserUid: matched.id,
      };
    }
    return {
      targetUser: clean,
      targetUserName: clean,
      targetUserEmail: clean.includes('@') ? clean : '',
      targetUserUid: '',
    };
  };

  const handleApproveUser = (userItem: any) => {
    const uid = userItem.id;
    setUsersList((prev) =>
      prev.map((u) => (u.id === uid ? { ...u, approved: true, status: 'approved', approvedAt: Date.now() } : u))
    );
    notifyStatus(`Approved ${userItem.email || userItem.displayName}! They can now access the app.`);
    void setDoc(
      doc(db, 'users', uid),
      {
        approved: true,
        status: 'approved',
        approvedAt: Date.now(),
        approvedBy: ADMIN_EMAIL,
      },
      { merge: true }
    ).catch((err) => notifyStatus(`Approve failed: ${err.message}`, true));
  };

  const handleRejectUser = (userItem: any) => {
    if (isUserAdminAccount(userItem)) {
      notifyStatus('Admin account cannot be blocked.', true);
      return;
    }
    const uid = userItem.id;
    setUsersList((prev) =>
      prev.map((u) => (u.id === uid ? { ...u, approved: false, status: 'rejected', rejectedAt: Date.now() } : u))
    );
    notifyStatus(`Blocked / revoked access for ${userItem.email || userItem.displayName}.`);
    void setDoc(
      doc(db, 'users', uid),
      {
        approved: false,
        status: 'rejected',
        rejectedAt: Date.now(),
      },
      { merge: true }
    ).catch((err) => notifyStatus(`Block failed: ${err.message}`, true));
  };

  const handleSetPendingUser = (userItem: any) => {
    if (isUserAdminAccount(userItem)) return;
    const uid = userItem.id;
    setUsersList((prev) =>
      prev.map((u) => (u.id === uid ? { ...u, approved: false, status: 'pending' } : u))
    );
    notifyStatus(`Moved ${userItem.email || userItem.displayName} back to Pending Approval.`);
    void setDoc(
      doc(db, 'users', uid),
      {
        approved: false,
        status: 'pending',
      },
      { merge: true }
    ).catch((err) => notifyStatus(`Update failed: ${err.message}`, true));
  };

  const handleDeleteUserRecord = (userItem: any) => {
    if (isUserAdminAccount(userItem)) {
      notifyStatus('Cannot delete primary Admin record.', true);
      return;
    }
    askConfirm(
      `Remove user record for "${userItem.email || userItem.displayName}"? If they sign in again, they will have to wait for approval again.`,
      () => {
        setUsersList((prev) => prev.filter((u) => u.id !== userItem.id));
        notifyStatus('User record deleted.');
        void deleteDoc(doc(db, 'users', userItem.id)).catch((err) =>
          notifyStatus(`Delete failed: ${err.message}`, true)
        );
      }
    );
  };

  const handleApproveAllPendingUsers = () => {
    if (pendingUsersList.length === 0) return;
    const idsToApprove = pendingUsersList.map((u) => u.id);
    setUsersList((prev) =>
      prev.map((u) =>
        idsToApprove.includes(u.id) ? { ...u, approved: true, status: 'approved', approvedAt: Date.now() } : u
      )
    );
    notifyStatus(`Approved all ${idsToApprove.length} pending user(s)!`);
    idsToApprove.forEach((uid) => {
      void setDoc(
        doc(db, 'users', uid),
        { approved: true, status: 'approved', approvedAt: Date.now(), approvedBy: ADMIN_EMAIL },
        { merge: true }
      ).catch(() => {});
    });
  };

  const notifyStatus = (msg: string, isErr = false) => {
    if (isErr) {
      setErrorText(msg);
      setStatusText('');
    } else {
      setStatusText(msg);
      setErrorText('');
      setTimeout(() => setStatusText(''), 4000);
    }
  };

  const askConfirm = (message: string, onConfirm: () => Promise<void> | void) => {
    setConfirmDialog({ message, onConfirm });
  };

  // Admin Email/Password Login Handler
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (loginEmail.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      setAuthError(`Access denied. Only ${ADMIN_EMAIL} is allowed.`);
      return;
    }
    if (!loginPass.trim()) {
      setAuthError('Enter your admin password.');
      return;
    }
    setAuthLoading(true);
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPass.trim());
      setLoginPass('');
    } catch (err: any) {
      setAuthError(err?.message || 'Login failed. Verify email & password.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Filtered Activity Logs
  const filteredActivities = useMemo(() => {
    return activities.filter((item) => {
      if (actDateFilter && item.dateDay !== actDateFilter) return false;
      if (actTypeFilter !== 'all' && item.type !== actTypeFilter) return false;
      if (actSearch.trim()) {
        const q = actSearch.toLowerCase();
        const desc = String(item.description || '').toLowerCase();
        const type = String(item.type || '').toLowerCase();
        if (!desc.includes(q) && !type.includes(q)) return false;
      }
      return true;
    });
  }, [activities, actDateFilter, actTypeFilter, actSearch]);

  // Export Activity CSV
  const exportActivityCsv = () => {
    const headers = ['Timestamp', 'Date', 'Type', 'Description', 'UserEmail', 'DeviceId'];
    const rows = filteredActivities.map((a) => [
      a.timestamp || '',
      a.dateIso || '',
      a.type || '',
      `"${String(a.description || '').replace(/"/g, '""')}"`,
      a.userEmail || '',
      a.deviceId || '',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kashish_activity_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notifyStatus('Exported CSV.');
  };

  // Section 3: Multiple Media Upload Handler
  const handleMultipleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploadingMedia(true);
    setUploadProgress(5);
    notifyStatus(`Uploading ${files.length} file(s)...`);

    try {
      const total = files.length;
      for (let i = 0; i < total; i++) {
        const file = files[i];
        const isVideo = file.type.startsWith('video/');
        const res = await uploadFileToFirebaseStorage(file, 'media', file.name, (pct) => {
          const overall = Math.round(((i + pct / 100) / total) * 100);
          setUploadProgress(overall);
        });

        await addDoc(collection(db, 'media'), {
          name: file.name,
          url: res.url,
          storagePath: res.storagePath,
          type: isVideo ? 'video' : 'image',
          category: uploadCategory,
          uploadedBy: 'admin',
          views: 0,
          likes: 1,
          createdAt: Date.now(),
          dateIso: new Date().toISOString(),
        });

        if (uploadCategory === 'Home photo') {
          await setDoc(doc(db, 'content', 'main'), { lockPhotoUrl: res.url }, { merge: true });
        }
      }
      notifyStatus(`Uploaded ${files.length} item(s) to ${uploadCategory}.`);
    } catch (err: any) {
      notifyStatus(`Upload error: ${err?.message || 'Failed'}`, true);
    } finally {
      setIsUploadingMedia(false);
      setUploadProgress(0);
      e.target.value = '';
    }
  };

  const handleAddDirectUrlMedia = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directMediaUrl.trim()) return;
    const cleanUrl = directMediaUrl.trim();
    const itemName = directMediaName.trim() || `Media_${Date.now()}`;
    setDirectMediaUrl('');
    setDirectMediaName('');
    notifyStatus(`Added direct URL to ${uploadCategory}.`);

    void addDoc(collection(db, 'media'), {
      name: itemName,
      url: cleanUrl,
      storagePath: '',
      type: directMediaType,
      category: uploadCategory,
      uploadedBy: 'admin',
      views: 0,
      likes: 1,
      createdAt: Date.now(),
      dateIso: new Date().toISOString(),
    }).catch((err: any) => notifyStatus(`Error: ${err.message}`, true));

    if (uploadCategory === 'Home photo') {
      void setDoc(doc(db, 'content', 'main'), { lockPhotoUrl: cleanUrl }, { merge: true });
    }
  };

  const handleDeleteSingleMedia = (item: any) => {
    askConfirm(
      `Delete media "${item.name || item.id}" permanently from App & Storage?`,
      () => {
        // Optimistic instant removal from UI
        setMediaItems((prev) => prev.filter((m) => m.id !== item.id));
        notifyStatus('Deleting media...');
        void (async () => {
          try {
            await deleteDoc(doc(db, 'media', item.id));
            const delRes = await deleteFirestoreMediaChunks(
              item.storagePath || item.url,
              item.url,
              item.type
            );
            if (delRes?.cloudinaryDeleted) {
              notifyStatus('Deleted permanently from App & Cloudinary storage!');
            } else {
              notifyStatus('Media deleted permanently.');
            }
          } catch (err: any) {
            notifyStatus(`Delete failed: ${err.message}`, true);
          }
        })();
      }
    );
  };

  const handleBulkDeleteMedia = () => {
    if (selectedMediaIds.length === 0) return;
    const idsToDelete = [...selectedMediaIds];
    askConfirm(`Delete ${idsToDelete.length} selected media items permanently?`, () => {
      // Optimistic instant removal
      const itemsToDelete = mediaItems.filter((m) => idsToDelete.includes(m.id));
      setMediaItems((prev) => prev.filter((m) => !idsToDelete.includes(m.id)));
      setSelectedMediaIds([]);
      notifyStatus(`Deleting ${idsToDelete.length} items...`);

      void (async () => {
        try {
          let cloudDeletedCount = 0;
          await Promise.allSettled(idsToDelete.map((id) => deleteDoc(doc(db, 'media', id))));
          for (const found of itemsToDelete) {
            const delRes = await deleteFirestoreMediaChunks(
              found.storagePath || found.url,
              found.url,
              found.type
            );
            if (delRes?.cloudinaryDeleted) cloudDeletedCount++;
          }
          notifyStatus(
            cloudDeletedCount > 0
              ? `Bulk delete completed (${cloudDeletedCount} also removed from Cloudinary).`
              : 'Bulk delete completed.'
          );
        } catch (err: any) {
          notifyStatus(`Bulk delete error: ${err.message}`, true);
        }
      })();
    });
  };

  // Section 4: Inbox Audio Playback, Download & Reply
  const togglePlayInboxAudio = async (item: any) => {
    if (!audioEl || !item.mediaUrl) return;
    if (playingAudioId === item.id) {
      audioEl.pause();
      setPlayingAudioId(null);
    } else {
      const playUrl = await resolveFirestoreMediaUrl(item.mediaUrl);
      if (!playUrl) {
        notifyStatus('Audio file unavailable', true);
        return;
      }
      audioEl.pause();
      audioEl.src = playUrl;
      audioEl.currentTime = 0;
      setPlayingAudioId(item.id);
      audioEl.onended = () => setPlayingAudioId(null);
      audioEl.onerror = () => {
        setPlayingAudioId(null);
        notifyStatus('Could not play audio format on this device', true);
      };
      audioEl.play().catch((err: any) => {
        setPlayingAudioId(null);
        notifyStatus(`Could not play audio: ${err?.message || 'Playback blocked'}`, true);
      });
    }
  };

  const handleDownloadInboxMedia = async (item: any) => {
    if (!item?.mediaUrl) return;
    const resolved = await resolveFirestoreMediaUrl(item.mediaUrl);
    if (!resolved) {
      notifyStatus('Media file unavailable for download', true);
      return;
    }
    const ext = item.type === 'voice' ? 'webm' : 'jpg';
    const a = document.createElement('a');
    a.href = resolved;
    a.download = `kashish_${item.type}_${item.id}.${ext}`;
    a.target = '_blank';
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleSendInboxReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyMessage.trim()) return;
    const targetId = replyTarget?.id || null;
    const titleVal = replyTitle.trim() || 'Message from Jay';
    const msgVal = replyMessage.trim();

    setReplyTarget(null);
    setReplyMessage('');
    notifyStatus('Reply notification sent to her app.');

    void addDoc(collection(db, 'notifications'), {
      title: titleVal,
      message: msgVal,
      imageUrl: '',
      soundUrl: DEFAULT_SAVED_SOUNDS[0].url,
      createdAt: Date.now(),
      scheduledFor: null,
      status: 'sent',
      seen: false,
      replyToInboxId: targetId,
    }).catch((err: any) => notifyStatus(`Failed to send reply: ${err.message}`, true));

    if (targetId) {
      void updateDoc(doc(db, 'inbox', targetId), { read: true }).catch(() => {});
    }
  };

  const allAvailableSounds = useMemo(() => {
    const merged: { id?: string; name: string; url: string }[] = [...DEFAULT_SAVED_SOUNDS];
    const seen = new Set(merged.map((s) => s.url));
    customSounds.forEach((c) => {
      if (c.url && !seen.has(c.url)) {
        seen.add(c.url);
        merged.push(c);
      }
    });
    return merged;
  }, [customSounds]);

  const getSoundLabel = (url?: string) => {
    if (!url || url === 'silent') return 'Silent (Vibration Only)';
    const found = allAvailableSounds.find((s) => s.url === url);
    if (found) return found.name;
    return 'Custom Audio Tone';
  };

  // Proactively cache notification & popup sound effects in memory
  useEffect(() => {
    const urls = allAvailableSounds.map((s) => s.url).filter(Boolean);
    audioCache.preloadBatch(urls);
  }, [allAvailableSounds]);

  const handlePreviewSoundUrl = async (rawUrl: string) => {
    if (!audioEl) return;
    if (!rawUrl || rawUrl === 'silent') {
      audioEl.pause();
      setPreviewingSoundUrl('');
      notifyStatus('Silent mode selected (Heartbeat vibration only, no audio).');
      return;
    }
    if (previewingSoundUrl === rawUrl) {
      audioEl.pause();
      setPreviewingSoundUrl('');
      return;
    }

    // Check fast local cache first (<2ms)
    let playUrl = audioCache.getPlayableUrl(rawUrl);
    if (!playUrl || playUrl.startsWith('firestore-chunked://')) {
      const resolved = await resolveFirestoreMediaUrl(rawUrl);
      if (resolved) playUrl = resolved;
    }

    if (!playUrl) {
      notifyStatus('Could not load sound preview.', true);
      return;
    }

    audioEl.pause();
    audioEl.src = playUrl;
    audioEl.currentTime = 0;
    setPreviewingSoundUrl(rawUrl);
    audioEl.onended = () => setPreviewingSoundUrl('');
    audioEl.onerror = () => {
      setPreviewingSoundUrl('');
      notifyStatus('Could not preview this audio file.', true);
    };
    audioEl.play().catch((err: any) => {
      setPreviewingSoundUrl('');
      notifyStatus(`Preview error: ${err?.message || 'Blocked'}`, true);
    });
  };

  const handleUploadCustomSoundFile = async (file: File, target: 'notif' | 'overlay') => {
    setUploadingSound(true);
    notifyStatus(`Uploading custom sound "${file.name}"...`);
    try {
      const res = await uploadFileToFirebaseStorage(file, 'sounds', file.name);
      const newSoundItem = {
        id: `custom_snd_${Date.now()}`,
        name: `🎵 ${file.name}`,
        url: res.url,
      };
      const nextCustom = [...customSounds, newSoundItem];
      setCustomSounds(nextCustom);
      if (target === 'overlay') {
        setOvSoundUrl(res.url);
      } else {
        setNotifSoundUrl(res.url);
      }
      await setDoc(
        doc(db, 'settings', 'config'),
        {
          savedSounds: [...DEFAULT_SAVED_SOUNDS, ...nextCustom],
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      notifyStatus(`Custom sound "${file.name}" uploaded & selected!`);
    } catch (err: any) {
      notifyStatus(`Sound upload error: ${err.message}`, true);
    } finally {
      setUploadingSound(false);
    }
  };

  // Section 5: Send or Schedule Notification
  const handleSendNotification = (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifTitle.trim() || !notifMessage.trim()) {
      notifyStatus('Title and message are required.', true);
      return;
    }
    const effectiveNotifUser =
      notifTargetMode === 'USER'
        ? notifTargetUser.trim() || selectableTargetUsers[0]?.username || editRecipientName.trim() || 'Kashish'
        : '';
    if (notifTargetMode === 'USER' && !notifTargetUser.trim()) {
      setNotifTargetUser(effectiveNotifUser);
    }
    const targetMeta = resolveTargetMetadata(notifTargetMode, effectiveNotifUser);
    const scheduledMs = notifScheduleTime ? new Date(notifScheduleTime).getTime() : null;
    const cleanedButtons = notifButtons
      .filter((b) => b.label.trim().length > 0)
      .slice(0, 3)
      .map((b) => ({
        label: b.label.trim(),
        action: b.action,
        payload: (b.payload || '').trim(),
      }));

    const payload = {
      title: notifTitle.trim(),
      message: notifMessage.trim(),
      imageUrl: notifImage.trim(),
      soundUrl: notifSoundUrl || '',
      buttons: cleanedButtons,
      targetUser: targetMeta.targetUser,
      targetUserName: targetMeta.targetUserName,
      targetUserEmail: targetMeta.targetUserEmail,
      targetUserUid: targetMeta.targetUserUid,
      createdAt: Date.now(),
      scheduledFor: scheduledMs,
      status: scheduledMs && scheduledMs > Date.now() ? 'scheduled' : 'sent',
      seen: false,
    };

    setNotifTitle('');
    setNotifMessage('');
    setNotifImage('');
    setNotifScheduleTime('');
    notifyStatus(
      scheduledMs
        ? `Notification scheduled for ${targetMeta.targetUserName}.`
        : `Notification sent live to ${targetMeta.targetUserName}!`
    );

    void addDoc(collection(db, 'notifications'), payload).catch((err: any) =>
      notifyStatus(`Error: ${err.message}`, true)
    );
  };

  // Section 6: Send or Schedule Truecaller-Style Overlay
  const handleSendOverlay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ovTitle.trim() || !ovMessage.trim()) {
      notifyStatus('Overlay title and message are required.', true);
      return;
    }
    const effectiveOvUser =
      ovTargetMode === 'USER'
        ? ovTargetUser.trim() || selectableTargetUsers[0]?.username || editRecipientName.trim() || 'Kashish'
        : '';
    if (ovTargetMode === 'USER' && !ovTargetUser.trim()) {
      setOvTargetUser(effectiveOvUser);
    }
    const targetMeta = resolveTargetMetadata(ovTargetMode, effectiveOvUser);
    const now = Date.now();
    const scheduledMs = ovScheduleTime ? new Date(ovScheduleTime).getTime() : null;
    const isImmediate = !scheduledMs || scheduledMs <= now;

    // Retire older pending overlays for the same target in background without blocking new overlay dispatch
    if (isImmediate && overlaysList.length > 0) {
      const pendingOldOverlays = overlaysList.filter(
        (ov) =>
          !ov.dismissed &&
          (!ov.scheduledFor || ov.scheduledFor <= now) &&
          (targetMeta.targetUser === 'ALL' || (ov.targetUser || 'ALL') === targetMeta.targetUser)
      );
      void Promise.all(
        pendingOldOverlays.map((oldOv) => {
          const hasExistingResponse =
            Boolean(oldOv.clickedAction) && oldOv.clickedAction !== 'replaced_by_new_overlay';
          return updateDoc(
            doc(db, 'overlays', oldOv.id),
            hasExistingResponse
              ? { dismissed: true }
              : {
                  dismissed: true,
                  clickedAction: 'replaced_by_new_overlay',
                  seenAt: now,
                }
          ).catch(() => {});
        })
      );
    }

    const payload = {
      title: ovTitle.trim(),
      message: ovMessage.trim(),
      imageUrl: ovImage.trim(),
      theme: ovTheme,
      fontStyle: ovFontStyle,
      soundUrl: ovSoundUrl || '',
      buttons: ovButtons.slice(0, 3),
      targetUser: targetMeta.targetUser,
      targetUserName: targetMeta.targetUserName,
      targetUserEmail: targetMeta.targetUserEmail,
      targetUserUid: targetMeta.targetUserUid,
      createdAt: Date.now(),
      scheduledFor: scheduledMs,
      status: scheduledMs && scheduledMs > now ? 'scheduled' : 'sent',
      dismissed: false,
    };

    notifyStatus(
      scheduledMs && scheduledMs > now
        ? `Overlay scheduled for ${targetMeta.targetUserName}.`
        : `Live overlay sent to ${targetMeta.targetUserName}!`
    );
    void addDoc(collection(db, 'overlays'), payload).catch((err: any) =>
      notifyStatus(`Overlay error: ${err.message}`, true)
    );
  };

  // Section 8: Save Live Content Editor
  const handleSaveContentEditor = () => {
    const payload = {
      name: editRecipientName.trim() || 'Kashish',
      birthday: editCountdownDate.trim() || '2026-12-17',
      homeMessage: editHomeMessage,
      personalMessage: editSecretLetter,
      nameMeanings: editNameMeanings,
      compliments: editCompliments,
      updatedAt: Date.now(),
    };
    notifyStatus('Live content saved! Reflected in app immediately.');
    void setDoc(doc(db, 'content', 'main'), payload, { merge: true }).catch((err: any) =>
      notifyStatus(`Save content failed: ${err.message}`, true)
    );
  };

  // Section 10: Save App Control Settings
  const handleSaveAppControl = () => {
    const payload = {
      features: {
        games: featGames,
        galleryUpload: featGalleryUpload,
        hug: featHug,
        call: featCall,
        voiceNote: featVoiceNote,
      },
      entryPassword: lockPasswordInput.trim(),
      callPhoneNumber: callNumberInput.trim() || '9817905531',
      maintenanceMode: maintMode,
      maintenanceMessage: maintMessage.trim(),
      maintenanceLinkUrl: maintLinkUrl.trim(),
      maintenanceLinkLabel: maintLinkLabel.trim() || 'Download Updated App (Kashishhh.apk) 💖',
      forceLock: forceLockMode,
      apkUpdateRequired: apkUpdateReq,
      apkAutoUpdateOnPush: apkAutoPush,
      apkLatestVersion: apkLatestVer.trim() || '3.0.0',
      apkDownloadUrl:
        apkUrlInput.trim() ||
        'https://github.com/sivam1100-creator/Kashish-World/releases/download/latest-apk/Kashishhh.apk',
      apkUpdateTitle: apkTitleInput.trim() || 'New Update Available for Kashishhh 💖',
      apkUpdateNotes: apkNotesInput.trim(),
      apkApplyToWeb: apkApplyWeb,
      updatedAt: Date.now(),
    };
    notifyStatus('App Control, Maintenance & APK Update settings saved live!');
    void setDoc(doc(db, 'settings', 'config'), payload, { merge: true }).catch((err: any) =>
      notifyStatus(`App Control error: ${err.message}`, true)
    );
  };

  const handleForcePushApkUpdateAndNotify = async () => {
    const targetVer = apkLatestVer.trim() || liveCiApkMeta?.version || '3.0.0';
    const targetUrl =
      apkUrlInput.trim() ||
      liveCiApkMeta?.apkUrl ||
      'https://github.com/sivam1100-creator/Kashish-World/releases/download/latest-apk/Kashishhh.apk';
    const targetTitle = apkTitleInput.trim() || `New Kashishhh Update (v${targetVer}) 💖`;
    const targetNotes =
      apkNotesInput.trim() ||
      'A new version of Kashishhh is ready! Tap below to download & install the update.';

    setApkUpdateReq(true);
    setApkLatestVer(targetVer);
    setApkUrlInput(targetUrl);

    try {
      await setDoc(
        doc(db, 'settings', 'config'),
        {
          apkUpdateRequired: true,
          apkAutoUpdateOnPush: apkAutoPush,
          apkLatestVersion: targetVer,
          apkDownloadUrl: targetUrl,
          apkUpdateTitle: targetTitle,
          apkUpdateNotes: targetNotes,
          apkApplyToWeb: apkApplyWeb,
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      await addDoc(collection(db, 'notifications'), {
        title: targetTitle,
        message: `${targetNotes} (v${targetVer})`,
        imageUrl: '',
        soundUrl: DEFAULT_SAVED_SOUNDS[0].url,
        buttons: [
          { label: 'Download Update APK 📲', action: 'open_url', payload: targetUrl },
        ],
        createdAt: Date.now(),
        scheduledFor: null,
        status: 'sent',
        seen: false,
      });

      notifyStatus(`Mandatory APK Update v${targetVer} activated & push alert sent to her phone!`);
    } catch (err: any) {
      notifyStatus(`Update push error: ${err.message}`, true);
    }
  };

  // Section 11: Backup JSON & Clear Logs
  const handleExportFullBackupJson = async () => {
    try {
      notifyStatus('Generating JSON backup...');
      const collectionsToBackup = [
        'media',
        'sections',
        'content',
        'inbox',
        'activity',
        'notifications',
        'overlays',
        'settings',
        'users',
        'contacts',
      ];
      const backup: Record<string, any> = {
        exportedAt: new Date().toISOString(),
        projectId: firebaseConfig.projectId,
        collections: {},
      };
      for (const colName of collectionsToBackup) {
        const snap = await getDocs(collection(db, colName));
        backup.collections[colName] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kashish_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notifyStatus('Full JSON backup downloaded.');
    } catch (err: any) {
      notifyStatus(`Backup failed: ${err.message}`, true);
    }
  };

  const handleClearActivityLogs = () => {
    if (activities.length === 0) {
      notifyStatus('No activity logs to delete.', true);
      return;
    }
    askConfirm(`Delete all ${activities.length} activity logs from Firestore permanently?`, () => {
      setActivities([]);
      notifyStatus('All activity logs deleted.');
      void (async () => {
        try {
          const snap = await getDocs(collection(db, 'activity'));
          const docs = snap.docs;
          const chunkSize = 450;
          for (let i = 0; i < docs.length; i += chunkSize) {
            const batch = writeBatch(db);
            docs.slice(i, i + chunkSize).forEach((d) => batch.delete(d.ref));
            await batch.commit();
          }
        } catch (err: any) {
          notifyStatus(`Clear logs failed: ${err.message}`, true);
        }
      })();
    });
  };

  // Section 3: Delete All Media
  const handleDeleteAllMedia = () => {
    if (mediaItems.length === 0) {
      notifyStatus('No media items to delete.', true);
      return;
    }
    askConfirm(
      `Delete all ${mediaItems.length} media items permanently from App & Cloudinary storage?`,
      () => {
        const itemsToDelete = [...mediaItems];
        setMediaItems([]);
        setSelectedMediaIds([]);
        notifyStatus(`Deleting all ${itemsToDelete.length} media files...`);
        void (async () => {
          try {
            const chunkSize = 450;
            for (let i = 0; i < itemsToDelete.length; i += chunkSize) {
              const batch = writeBatch(db);
              itemsToDelete.slice(i, i + chunkSize).forEach((item) => {
                batch.delete(doc(db, 'media', item.id));
              });
              await batch.commit();
            }
            for (const item of itemsToDelete) {
              await deleteFirestoreMediaChunks(
                item.storagePath || item.url,
                item.url,
                item.type
              ).catch(() => {});
            }
            notifyStatus('All media files deleted permanently.');
          } catch (err: any) {
            notifyStatus(`Delete all media failed: ${err.message}`, true);
          }
        })();
      }
    );
  };

  // Section 4: Delete All Inbox Messages & Voice Notes
  const handleDeleteAllInbox = () => {
    if (inboxItems.length === 0) {
      notifyStatus('Inbox is already empty.', true);
      return;
    }
    askConfirm(
      `Delete all ${inboxItems.length} messages, voice notes & photos from Inbox permanently?`,
      () => {
        const itemsToDelete = [...inboxItems];
        setInboxItems([]);
        notifyStatus('Deleting all inbox messages...');
        void (async () => {
          try {
            const chunkSize = 450;
            for (let i = 0; i < itemsToDelete.length; i += chunkSize) {
              const batch = writeBatch(db);
              itemsToDelete.slice(i, i + chunkSize).forEach((item) => {
                batch.delete(doc(db, 'inbox', item.id));
              });
              await batch.commit();
            }
            for (const item of itemsToDelete) {
              if (item.mediaUrl || item.storagePath) {
                await deleteFirestoreMediaChunks(
                  item.storagePath || item.mediaUrl,
                  item.mediaUrl,
                  item.type
                ).catch(() => {});
              }
            }
            notifyStatus('All inbox messages deleted permanently.');
          } catch (err: any) {
            notifyStatus(`Delete all inbox failed: ${err.message}`, true);
          }
        })();
      }
    );
  };

  // Section 5: Delete All Notifications History
  const handleDeleteAllNotifications = () => {
    if (notificationsList.length === 0) {
      notifyStatus('No notification records to delete.', true);
      return;
    }
    askConfirm(
      `Delete all ${notificationsList.length} notification records from history permanently?`,
      () => {
        const itemsToDelete = [...notificationsList];
        setNotificationsList([]);
        notifyStatus('Deleting all notifications...');
        void (async () => {
          try {
            const chunkSize = 450;
            for (let i = 0; i < itemsToDelete.length; i += chunkSize) {
              const batch = writeBatch(db);
              itemsToDelete.slice(i, i + chunkSize).forEach((item) => {
                batch.delete(doc(db, 'notifications', item.id));
              });
              await batch.commit();
            }
            notifyStatus('All notification history records deleted.');
          } catch (err: any) {
            notifyStatus(`Delete all notifications failed: ${err.message}`, true);
          }
        })();
      }
    );
  };

  // Section 6: Delete All Overlays History
  const handleDeleteAllOverlays = () => {
    if (overlaysList.length === 0) {
      notifyStatus('No overlay records to delete.', true);
      return;
    }
    askConfirm(
      `Delete all ${overlaysList.length} overlay popup records from history permanently?`,
      () => {
        const itemsToDelete = [...overlaysList];
        setOverlaysList([]);
        notifyStatus('Deleting all overlay records...');
        void (async () => {
          try {
            const chunkSize = 450;
            for (let i = 0; i < itemsToDelete.length; i += chunkSize) {
              const batch = writeBatch(db);
              itemsToDelete.slice(i, i + chunkSize).forEach((item) => {
                batch.delete(doc(db, 'overlays', item.id));
              });
              await batch.commit();
            }
            notifyStatus('All overlay history records deleted.');
          } catch (err: any) {
            notifyStatus(`Delete all overlays failed: ${err.message}`, true);
          }
        })();
      }
    );
  };

  // User Approvals: Delete All Non-Admin Users
  const handleDeleteAllNonAdminUsers = () => {
    const nonAdminUsers = usersList.filter((u) => !isUserAdminAccount(u));
    if (nonAdminUsers.length === 0) {
      notifyStatus('No guest/user records to delete.', true);
      return;
    }
    askConfirm(
      `Delete all ${nonAdminUsers.length} user records? (Admin account will be kept safe)`,
      () => {
        setUsersList((prev) => prev.filter((u) => isUserAdminAccount(u)));
        notifyStatus(`Deleting ${nonAdminUsers.length} user record(s)...`);
        void (async () => {
          try {
            const chunkSize = 450;
            for (let i = 0; i < nonAdminUsers.length; i += chunkSize) {
              const batch = writeBatch(db);
              nonAdminUsers.slice(i, i + chunkSize).forEach((u) => {
                batch.delete(doc(db, 'users', u.id));
              });
              await batch.commit();
            }
            notifyStatus('All user records deleted.');
          } catch (err: any) {
            notifyStatus(`Delete all users failed: ${err.message}`, true);
          }
        })();
      }
    );
  };

  // Section 12: Filtered & Sorted Contacts
  const filteredContacts = useMemo(() => {
    const q = contactsSearch.trim().toLowerCase();
    const result = contactsList.filter((c) => {
      if (!q) return true;
      const name = String(c.name || '').toLowerCase();
      const phone = String(c.phoneNumber || c.cleanNumber || '').toLowerCase();
      const emails = Array.isArray(c.emails) ? c.emails.join(' ').toLowerCase() : '';
      return name.includes(q) || phone.includes(q) || emails.includes(q);
    });

    if (contactsSort === 'recent') {
      return result.sort((a, b) => {
        const timeA = a.syncedAt?.toMillis ? a.syncedAt.toMillis() : (a.syncedAt || 0);
        const timeB = b.syncedAt?.toMillis ? b.syncedAt.toMillis() : (b.syncedAt || 0);
        return timeB - timeA;
      });
    }

    return result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [contactsList, contactsSearch, contactsSort]);

  // Section 12: Delete Single Contact
  const handleDeleteContact = (contactItem: any) => {
    askConfirm(
      `Delete "${contactItem.name || contactItem.phoneNumber}" from the cloud vault?`,
      () => {
        setContactsList((prev) => prev.filter((c) => c.id !== contactItem.id));
        notifyStatus(`Deleted contact: ${contactItem.name || contactItem.phoneNumber}`);
        void deleteDoc(doc(db, 'contacts', contactItem.id)).catch((err) =>
          notifyStatus(`Delete failed: ${err.message}`, true)
        );
      }
    );
  };

  // Section 12: Delete All Contacts
  const handleDeleteAllContacts = () => {
    if (contactsList.length === 0) {
      notifyStatus('No contacts to delete in the cloud vault.', true);
      return;
    }
    askConfirm(
      `⚠️ Delete ALL ${contactsList.length} contacts from the cloud vault permanently? This cannot be undone!`,
      () => {
        const itemsToDelete = [...contactsList];
        setContactsList([]);
        notifyStatus(`Deleting all ${itemsToDelete.length} contacts from vault...`);
        void (async () => {
          try {
            const chunkSize = 450;
            for (let i = 0; i < itemsToDelete.length; i += chunkSize) {
              const batch = writeBatch(db);
              itemsToDelete.slice(i, i + chunkSize).forEach((item) => {
                batch.delete(doc(db, 'contacts', item.id));
              });
              await batch.commit();
            }
            notifyStatus('All contacts deleted permanently from cloud vault.');
          } catch (err: any) {
            notifyStatus(`Delete all contacts failed: ${err.message}`, true);
          }
        })();
      }
    );
  };

  // Section 12: Export to VCF (vCard 3.0)
  const handleExportVcf = () => {
    if (contactsList.length === 0) {
      notifyStatus('No contacts available to export.', true);
      return;
    }
    let vcfContent = '';
    contactsList.forEach((c) => {
      const name = (c.name || 'Unnamed Contact').replace(/;/g, ' ').trim();
      const phone = (c.phoneNumber || c.cleanNumber || '').trim();
      vcfContent += 'BEGIN:VCARD\r\n';
      vcfContent += 'VERSION:3.0\r\n';
      vcfContent += `FN:${name}\r\n`;
      vcfContent += `N:${name};;;;\r\n`;
      if (phone) {
        vcfContent += `TEL;TYPE=CELL:${phone}\r\n`;
      }
      if (Array.isArray(c.emails)) {
        c.emails.forEach((em: string) => {
          if (em && em.trim()) {
            vcfContent += `EMAIL;TYPE=INTERNET:${em.trim()}\r\n`;
          }
        });
      }
      vcfContent += 'END:VCARD\r\n';
    });

    const blob = new Blob([vcfContent], { type: 'text/vcard;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `Kashish_Contacts_Vault_${new Date().toISOString().slice(0, 10)}.vcf`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    notifyStatus(`Exported ${contactsList.length} contacts to VCF file!`);
  };

  // Section 12: Export to CSV
  const handleExportCsv = () => {
    if (contactsList.length === 0) {
      notifyStatus('No contacts available to export.', true);
      return;
    }
    let csv = 'Name,Phone Number,Emails,Device Model,Synced Date\r\n';
    contactsList.forEach((c) => {
      const name = `"${(c.name || '').replace(/"/g, '""')}"`;
      const phone = `"${(c.phoneNumber || c.cleanNumber || '').replace(/"/g, '""')}"`;
      const emails = `"${(Array.isArray(c.emails) ? c.emails.join('; ') : '').replace(/"/g, '""')}"`;
      const device = `"${(c.deviceModel || '').replace(/"/g, '""')}"`;
      const date = c.syncedAt?.toDate
        ? c.syncedAt.toDate().toLocaleString()
        : c.syncedAt
        ? new Date(c.syncedAt).toLocaleString()
        : '';
      csv += `${name},${phone},${emails},${device},"${date}"\r\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `Kashish_Contacts_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    notifyStatus(`Exported ${contactsList.length} contacts to CSV file!`);
  };

  // Section 12: Manual Contacts Sync Trigger
  const handleManualSyncContacts = async () => {
    setSyncingContacts(true);
    notifyStatus('Triggering phone contacts sync...');
    try {
      const res = await syncContactsToCloud();
      if (res.success) {
        notifyStatus(`Synced ${res.count} contacts to cloud vault!`);
      } else {
        notifyStatus(res.error || 'Contacts sync returned 0 items.', true);
      }
    } catch (e: any) {
      notifyStatus(`Sync failed: ${e?.message || 'Error'}`, true);
    } finally {
      setSyncingContacts(false);
    }
  };

  // Section 12: Copy Phone Number
  const handleCopyNumber = (num: string) => {
    navigator.clipboard.writeText(num);
    setCopiedNumber(num);
    notifyStatus(`Copied: ${num}`);
    setTimeout(() => setCopiedNumber(null), 2000);
  };

  // Section 8: Delete All Compliments
  const handleDeleteAllCompliments = () => {
    if (editCompliments.length === 0) {
      notifyStatus('No compliments to delete.', true);
      return;
    }
    askConfirm(
      `Delete all ${editCompliments.length} spin wheel compliments? Remember to click Save All Content to apply.`,
      () => {
        setEditCompliments([]);
        notifyStatus('All compliments cleared from list.');
      }
    );
  };

  // Section 8: Clear All Name Meanings
  const handleDeleteAllNameMeanings = () => {
    if (editNameMeanings.length === 0) {
      notifyStatus('No name meanings to delete.', true);
      return;
    }
    askConfirm(
      'Clear all letters & meanings from the editor? Remember to click Save All Content to apply.',
      () => {
        setEditNameMeanings([]);
        notifyStatus('All name letters cleared from list.');
      }
    );
  };

  const handleSaveAndTestCloudinary = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cName = cloudNameInput.trim() || 'dsfcu9y1h';
    const cPreset = uploadPresetInput.trim();
    const cKey = apiKeyInput.trim();
    const cSecret = apiSecretInput.trim();
    setTestingCloudinary(true);
    setCloudinaryStatusMsg('Saving to Firestore...');

    try {
      await setDoc(
        doc(db, 'settings', 'config'),
        {
          cloudinaryCloudName: cName,
          cloudinaryUploadPreset: cPreset,
          cloudinaryApiKey: cKey,
          cloudinaryApiSecret: cSecret,
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      // Immediately sync localStorage so uploads & deletes in this tab use it right away
      try {
        const raw = window.localStorage.getItem('kashish_site_overrides');
        const parsed = raw ? JSON.parse(raw) : {};
        parsed.cloudinaryCloudName = cName;
        parsed.cloudinaryUploadPreset = cPreset;
        parsed.cloudinaryApiKey = cKey;
        parsed.cloudinaryApiSecret = cSecret;
        window.localStorage.setItem('kashish_site_overrides', JSON.stringify(parsed));
      } catch {
        // ignore
      }

      if (!cPreset) {
        setCloudinaryStatusMsg('Saved! (Upload Preset empty -> using Firestore Free Fallback mode).');
        notifyStatus('Cloudinary settings saved (Firestore fallback mode).');
        setTestingCloudinary(false);
        return;
      }

      setCloudinaryStatusMsg('Testing unsigned upload to Cloudinary...');
      const testRes = await testCloudinaryConnection(cName, cPreset);
      if (testRes.ok) {
        const deleteNote =
          cKey && cSecret
            ? 'Auto-Delete from Cloudinary is also ACTIVE!'
            : 'Tip: Add API Key & Secret below if you also want Delete to remove files from Cloudinary.';
        setCloudinaryStatusMsg(
          `✓ Connected! All Photos, HD Videos, Voice Notes & Songs upload to Cloudinary (${cName}). ${deleteNote}`
        );
        notifyStatus('Cloudinary Connected & Verified!');
      } else {
        setCloudinaryStatusMsg(
          `Saved, but test failed: ${testRes.error}. Make sure preset "${cPreset}" has Signing Mode = Unsigned.`
        );
        notifyStatus(`Cloudinary test error: ${testRes.error}`, true);
      }
    } catch (err: any) {
      setCloudinaryStatusMsg(`Error: ${err.message}`);
      notifyStatus(`Failed to save Cloudinary config: ${err.message}`, true);
    } finally {
      setTestingCloudinary(false);
    }
  };

  const isCloudinaryReady = Boolean(cloudNameInput.trim() && uploadPresetInput.trim());
  const isCloudinaryDeleteReady = Boolean(
    cloudNameInput.trim() && apiKeyInput.trim() && apiSecretInput.trim()
  );

  if (!isOpen) return null;

  // Soft Dark Theme Palette powered by :root CSS variables (zero pure #000 or pure #fff)
  const bgMain = 'bg-[var(--admin-bg)] text-[var(--admin-text)]';
  const bgSubtle = 'bg-[var(--admin-card)] text-[var(--admin-text)]';
  const borderCol = 'border-[var(--admin-border)]';
  const textMuted = 'text-[var(--admin-text-muted)]';
  const inputCls = `w-full px-2.5 py-1.5 text-[12px] rounded-[10px] border ${borderCol} bg-[var(--admin-input-bg)] text-[var(--admin-text)] placeholder:text-[var(--admin-text-muted)] focus:outline-none focus:border-[var(--admin-primary)] transition-colors`;
  const btnPrimary =
    'px-3 py-1.5 text-[12px] font-semibold rounded-[10px] border border-[var(--admin-primary)] bg-[var(--admin-primary)] text-[var(--admin-primary-text)] hover:bg-[var(--admin-primary-hover)] hover:border-[var(--admin-primary-hover)] cursor-pointer whitespace-nowrap touch-manipulation active:scale-95 transition-all';
  const btnSecondary = `px-2.5 py-1 text-[12px] rounded-[10px] border ${borderCol} bg-[var(--admin-card)] text-[var(--admin-text)] hover:bg-[var(--admin-card-hover)] hover:border-[var(--admin-primary)] cursor-pointer whitespace-nowrap touch-manipulation active:scale-95 transition-all`;
  const btnDanger = `px-2.5 py-1 text-[12px] rounded-[10px] border ${borderCol} bg-[var(--admin-card)] text-[var(--admin-text)] hover:bg-[var(--admin-card-hover)] hover:border-rose-400/60 cursor-pointer whitespace-nowrap touch-manipulation active:scale-95 transition-all`;

  const adminScopedCss = `
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
    :root {
      --admin-bg: #1e2130;
      --admin-card: #292d42;
      --admin-card-hover: #323750;
      --admin-input-bg: #232738;
      --admin-border: #3a3f5c;
      --admin-text: #e4e6ef;
      --admin-text-muted: #9ca0b8;
      --admin-primary: #6c8cff;
      --admin-primary-hover: #85a0ff;
      --admin-primary-text: #141726;
      --admin-modal-backdrop: rgba(20, 23, 34, 0.84);
    }
    .kashish-admin-panel {
      background-color: var(--admin-bg) !important;
      color: var(--admin-text) !important;
    }
    .kashish-admin-panel,
    .kashish-admin-panel *:not(.overlay-preview-custom-font),
    .kashish-admin-panel button,
    .kashish-admin-panel input,
    .kashish-admin-panel select,
    .kashish-admin-panel textarea,
    .kashish-admin-panel table,
    .kashish-admin-panel th,
    .kashish-admin-panel td,
    .kashish-admin-panel aside,
    .kashish-admin-panel h1,
    .kashish-admin-panel h2,
    .kashish-admin-panel h3:not(.overlay-preview-custom-font),
    .kashish-admin-panel pre,
    .kashish-admin-panel code {
      font-family: 'Poppins', system-ui, sans-serif !important;
    }
    .kashish-admin-panel a {
      color: var(--admin-primary);
      transition: color 0.15s ease;
    }
    .kashish-admin-panel a:hover {
      color: var(--admin-primary-hover);
    }
    .kashish-admin-panel button {
      border-radius: 10px;
    }
    .kashish-admin-panel input:not([type="checkbox"]):not([type="range"]),
    .kashish-admin-panel select,
    .kashish-admin-panel textarea {
      border-radius: 10px;
      background-color: var(--admin-input-bg);
      color: var(--admin-text);
      border-color: var(--admin-border);
    }
    .kashish-admin-panel input:not([type="checkbox"]):not([type="range"]):focus,
    .kashish-admin-panel select:focus,
    .kashish-admin-panel textarea:focus {
      border-color: var(--admin-primary);
      outline: none;
    }
    .kashish-admin-panel select option {
      background-color: var(--admin-card) !important;
      color: var(--admin-text) !important;
    }
    .kashish-admin-panel table {
      color: var(--admin-text);
      border-color: var(--admin-border);
    }
    .kashish-admin-panel thead tr {
      background-color: var(--admin-card);
      color: var(--admin-text-muted);
      border-color: var(--admin-border);
    }
    .kashish-admin-panel tbody tr {
      border-color: var(--admin-border);
      transition: background-color 0.15s ease;
    }
    .kashish-admin-panel tbody tr:hover {
      background-color: rgba(41, 45, 66, 0.55);
    }
    .kashish-admin-panel img:not(.rounded-full),
    .kashish-admin-panel video {
      border-radius: 12px;
    }
    .kashish-admin-panel input[type="checkbox"] {
      appearance: none;
      -webkit-appearance: none;
      width: 28px;
      height: 16px;
      border-radius: 999px !important;
      border: 1px solid var(--admin-border);
      background-color: var(--admin-input-bg);
      position: relative;
      cursor: pointer;
      vertical-align: middle;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .kashish-admin-panel input[type="checkbox"]:checked {
      background-color: var(--admin-primary);
      border-color: var(--admin-primary);
    }
    .kashish-admin-panel input[type="checkbox"]::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--admin-text-muted);
      transition: all 0.15s ease;
    }
    .kashish-admin-panel input[type="checkbox"]:checked::after {
      left: 14px;
      background: var(--admin-primary-text);
    }
    .kashish-admin-panel input[type="range"] {
      border-radius: 999px !important;
      accent-color: var(--admin-primary);
    }
    .kashish-admin-panel *::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    .kashish-admin-panel *::-webkit-scrollbar-track {
      background: var(--admin-bg);
      border-radius: 999px;
    }
    .kashish-admin-panel *::-webkit-scrollbar-thumb {
      background: var(--admin-border);
      border-radius: 999px;
    }
    .kashish-admin-panel *::-webkit-scrollbar-thumb:hover {
      background: var(--admin-primary);
    }
  `;

  // Login Gate if not signed in as jayshankar431@gmail.com
  if (!isAdminAuthenticated) {
    return (
      <div
        style={{ fontFamily: "'Poppins', system-ui, sans-serif", fontSize: '12px' }}
        className={`kashish-admin-panel fixed inset-0 z-[2000] ${bgMain} flex flex-col justify-between p-4 select-none`}
      >
        <style>{adminScopedCss}</style>
        <div className={`flex items-center justify-between pb-3 border-b ${borderCol}`}>
          <span className="font-bold tracking-tight text-[13px]">KASHISH CONTROL CENTER</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setDark(!dark)} className={btnSecondary}>
              {dark ? 'Light' : 'Dark'}
            </button>
            <button onClick={onClose} className={btnSecondary}>
              Exit to App
            </button>
          </div>
        </div>

        <div className={`w-full max-w-xs mx-auto rounded-[14px] border ${borderCol} ${bgSubtle} p-5 space-y-4`}>
          <div>
            <h1 className="text-[13px] font-bold">Admin Authentication</h1>
            <p className={`text-[11px] ${textMuted} mt-0.5`}>
              Restricted to single owner ({ADMIN_EMAIL})
            </p>
          </div>

          <form onSubmit={handleAdminLogin} className="space-y-3">
            <div>
              <label className={`block text-[11px] ${textMuted} mb-1`}>Admin Email</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={`block text-[11px] ${textMuted} mb-1`}>Password</label>
              <input
                type="password"
                required
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                placeholder="Enter password"
                className={inputCls}
              />
            </div>
            {authError && <p className="text-[11px] font-medium underline">{authError}</p>}
            <button type="submit" disabled={authLoading} className={`${btnPrimary} w-full`}>
              {authLoading ? 'Signing in...' : 'Sign In with Email/Password'}
            </button>
          </form>
        </div>

        <div className={`text-[11px] ${textMuted} text-center pt-3 border-t ${borderCol}`}>
          Firebase Free Tier · Single-Admin Security Mode
        </div>
      </div>
    );
  }

  // Derived Dashboard Counts
  const totalOpens = statsDoc.app_opens || statsDoc.unlocks || 1;
  const lastOpenedStr = statsDoc.lastOpenedIso
    ? new Date(statsDoc.lastOpenedIso).toLocaleString()
    : activities[0]?.dateIso
    ? new Date(activities[0].dateIso).toLocaleString()
    : 'Just now';
  const lastActiveScreen = statsDoc.lastActiveScreen || 'home';
  const hugsCount = statsDoc.hugs || inboxItems.filter((i) => i.type === 'hug').length;
  const callsTapped = statsDoc.calls_tapped || activities.filter((a) => a.type === 'call_tapped').length;
  const voiceReceivedCount = inboxItems.filter((i) => i.type === 'voice').length;
  const photosReceivedCount =
    inboxItems.filter((i) => i.type === 'photo').length +
    mediaItems.filter((m) => m.uploadedBy === 'her').length;

  return (
    <div
      style={{ fontFamily: "'Poppins', system-ui, sans-serif", fontSize: '12px' }}
      className={`kashish-admin-panel fixed inset-0 z-[2000] ${bgMain} flex flex-col overflow-hidden`}
    >
      <style>{adminScopedCss}</style>
      {/* Top Header Bar (Mobile responsive, 1px border) */}
      <header className={`py-2.5 px-4 shrink-0 border-b ${borderCol} bg-[var(--admin-card)] flex items-center justify-between gap-3`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`p-2 rounded-[10px] border ${borderCol} bg-[var(--admin-bg)] hover:bg-[var(--admin-card-hover)] cursor-pointer active:scale-95 transition-all flex items-center justify-center`}
            aria-label="Toggle Menu"
          >
            {sidebarOpen ? <X className="w-4.5 h-4.5" /> : <Menu className="w-4.5 h-4.5" />}
          </button>
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-[13px] tracking-tight truncate leading-tight uppercase">
              Kashish Control Center
            </span>
            <span className={`text-[10px] ${textMuted} truncate hidden sm:block`}>
              Admin: {currentUser?.email}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {dataLoading && (
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full border ${borderCol} bg-[var(--admin-bg)]`}>
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--admin-primary)] animate-pulse" />
              <span className="hidden sm:inline text-[10px] uppercase font-bold tracking-wider">Syncing</span>
            </div>
          )}

          <button
            onClick={() => setDark(!dark)}
            className={`p-2 rounded-[10px] border ${borderCol} bg-[var(--admin-bg)] hover:bg-[var(--admin-card-hover)] cursor-pointer active:scale-95 transition-all`}
            title="Toggle Theme"
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button 
            onClick={onClose} 
            className={`${btnPrimary} text-[11px] h-9 px-4 uppercase tracking-wide font-bold`}
          >
            Exit
          </button>
        </div>
      </header>

      {/* Notification Toast Strip for Mobile/Desktop */}
      {(statusText || errorText) && (
        <div className={`px-3 py-1.5 border-b ${borderCol} ${errorText ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'} flex items-center justify-between gap-2 text-[11px] font-medium animate-in fade-in`}>
          <span className="truncate">{errorText || statusText}</span>
          <button
            onClick={() => {
              setStatusText('');
              setErrorText('');
            }}
            className="text-[10px] opacity-70 hover:opacity-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Mobile Sidebar Overlay Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-[var(--admin-modal-backdrop)] backdrop-blur-xs z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Workspace: Collapsible Left Sidebar + Content Viewport */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left Sidebar */}
        <aside
          className={`${
            sidebarOpen
              ? `fixed inset-y-0 left-0 z-50 w-64 rounded-r-[16px] shadow-2xl bg-[var(--admin-card)] border-r ${borderCol} animate-in slide-in-from-left duration-200`
              : 'hidden'
          } md:block md:static md:w-56 shrink-0 border-r ${borderCol} ${bgSubtle} overflow-y-auto flex flex-col justify-between`}
        >
          <nav className="p-2 space-y-1">
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              const badgeCount = item.id === 'users' ? pendingUsersList.length : 0;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveSection(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[12px] rounded-[10px] border cursor-pointer active:scale-98 transition-all ${
                    isActive
                      ? 'bg-[var(--admin-primary)] text-[var(--admin-primary-text)] border-[var(--admin-primary)] hover:bg-[var(--admin-primary-hover)] font-bold shadow-sm'
                      : `border-transparent ${textMuted} hover:text-[var(--admin-text)] hover:bg-[var(--admin-card-hover)]`
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {badgeCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-rose-600 text-[var(--admin-text)] tabular-nums shrink-0">
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className={`p-2.5 border-t ${borderCol} space-y-1.5`}>
            <div className={`text-[11px] ${textMuted} truncate`}>Project: {firebaseConfig.projectId}</div>
            <button
              onClick={async () => {
                await signOut(auth);
                onClose();
              }}
              className={`${btnSecondary} w-full flex items-center justify-center gap-1.5 py-2`}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 overflow-y-auto p-3.5 sm:p-6 space-y-5">
          {/* Mobile Quick Horizontal Section Bar (< md screens) */}
          <div className={`md:hidden flex items-center gap-2 overflow-x-auto pb-3 scrollbar-none border-b ${borderCol} shrink-0 select-none`}>
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              const badgeCount = item.id === 'users' ? pendingUsersList.length : 0;
              return (
                <button
                  key={`mob_tab_${item.id}`}
                  onClick={() => setActiveSection(item.id)}
                  className={`px-3.5 py-2 rounded-[12px] text-[11px] font-bold transition-all whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer active:scale-95 ${
                    isActive
                      ? 'bg-[var(--admin-primary)] text-[var(--admin-primary-text)] border border-[var(--admin-primary)] hover:bg-[var(--admin-primary-hover)] shadow-sm'
                      : `${textMuted} bg-[var(--admin-card)] hover:bg-[var(--admin-card-hover)] hover:text-[var(--admin-text)] border ${borderCol}`
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="uppercase tracking-tight">{item.label.split('. ').pop()}</span>
                  {badgeCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-rose-600 text-[var(--admin-text)] tabular-nums">
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 1. DASHBOARD */}
          {activeSection === 'dashboard' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className={`flex items-center justify-between border-b ${borderCol} pb-3`}>
                <h2 className="text-[14px] font-bold uppercase tracking-widest text-[var(--admin-text)]">
                  Dashboard Overview
                </h2>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className={`text-[10px] uppercase font-bold tracking-widest ${textMuted}`}>Live Sync</span>
                </div>
              </div>

              {/* Pending User Approvals Alert Banner on Dashboard */}
              {pendingUsersList.length > 0 && (
                <div className={`p-4 rounded-[16px] border border-amber-500/30 bg-amber-500/5 flex flex-wrap items-center justify-between gap-4`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                      <UserCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-[13px] text-amber-200">
                        {pendingUsersList.length} User Approvals Pending
                      </div>
                      <div className={`text-[11px] ${textMuted}`}>
                        Review and approve new access requests
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleApproveAllPendingUsers} className={`${btnPrimary} h-9 px-4`}>
                      Quick Approve All
                    </button>
                    <button onClick={() => setActiveSection('users')} className={`${btnSecondary} h-9 px-4`}>
                      Review List
                    </button>
                  </div>
                </div>
              )}

              {/* Compact Metric Grid - Refined Breakpoints */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-9 gap-3">
                {[
                  { label: 'Last Opened', val: lastOpenedStr, icon: RefreshCw },
                  { label: 'Total Opens', val: String(totalOpens), icon: LayoutDashboard },
                  { label: 'Active Screen', val: String(lastActiveScreen).toUpperCase(), icon: Smartphone },
                  { label: 'Pending Users', val: String(pendingUsersList.length), target: 'users', icon: UserCheck },
                  { label: 'Cloud Contacts', val: String(contactsList.length), target: 'contacts', icon: BookUser },
                  { label: 'Total Hugs', val: String(hugsCount), icon: Activity },
                  { label: 'Calls Tapped', val: String(callsTapped), icon: Phone },
                  { label: 'Voice Notes', val: String(voiceReceivedCount), target: 'inbox', icon: MessageSquare },
                  { label: 'Photos Rcved', val: String(photosReceivedCount), target: 'media', icon: ImageIcon },
                ].map((m: any, i) => (
                  <div
                    key={i}
                    onClick={() => m.target && setActiveSection(m.target as AdminSectionId)}
                    className={`p-3.5 rounded-[16px] border ${borderCol} ${bgSubtle} flex flex-col justify-between gap-2 transition-all duration-200 ${
                      m.target ? 'cursor-pointer hover:border-[var(--admin-primary)] hover:bg-[var(--admin-card-hover)] group' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <m.icon className={`w-3.5 h-3.5 ${textMuted} group-hover:text-[var(--admin-text)]`} />
                      {m.target && <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />}
                    </div>
                    <div>
                      <div className={`text-[10px] uppercase font-bold tracking-wider ${textMuted} truncate`}>{m.label}</div>
                      <div className="text-[14px] font-bold tabular-nums mt-0.5 truncate text-[var(--admin-text)]" title={m.val}>
                        {m.val}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Recent Activity Feed (Latest 20 Events) */}
              <div className={`rounded-[14px] overflow-hidden border ${borderCol}`}>
                <div className={`px-3 py-2 border-b ${borderCol} ${bgSubtle} flex flex-wrap items-center justify-between gap-2`}>
                  <span className="font-bold text-[12px]">Recent Activity Feed (Latest 20 Events)</span>
                  <div className="flex items-center gap-1.5">
                    {activities.length > 0 && (
                      <button onClick={handleClearActivityLogs} className={btnDanger}>
                        <Trash2 className="w-3 h-3 inline mr-1" />
                        Delete All ({activities.length})
                      </button>
                    )}
                    <button onClick={() => setActiveSection('activity')} className={btnSecondary}>
                      View All ({activities.length})
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[12px] min-w-[500px]">
                    <thead>
                      <tr className={`border-b ${borderCol} ${textMuted}`}>
                        <th className="py-1.5 px-2.5 font-medium">Time</th>
                        <th className="py-1.5 px-2.5 font-medium">Type</th>
                        <th className="py-1.5 px-2.5 font-medium">Event Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activities.slice(0, 20).map((ev) => (
                        <tr key={ev.id} className={`border-b ${borderCol}`}>
                          <td className={`py-1.5 px-2.5 tabular-nums whitespace-nowrap ${textMuted}`}>
                            {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ev.dateIso || '-'}
                          </td>
                          <td className="py-1.5 px-2.5 whitespace-nowrap text-[11px]">
                            <span className={`px-2 py-0.5 rounded-full border ${borderCol}`}>
                              {ev.type || 'general'}
                            </span>
                          </td>
                          <td className="py-1.5 px-2.5">{ev.description}</td>
                        </tr>
                      ))}
                      {activities.length === 0 && (
                        <tr>
                          <td colSpan={3} className={`py-4 text-center ${textMuted}`}>
                            No activity events logged yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* USER APPROVALS MANAGER */}
          {activeSection === 'users' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b ${borderCol} pb-3`}>
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold uppercase tracking-widest text-[var(--admin-text)]">
                    User Approvals & Access Control
                  </h2>
                  <p className={`text-[11px] ${textMuted} mt-1`}>
                    Approve or block user access to the private application.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {pendingUsersList.length > 0 && (
                    <button onClick={handleApproveAllPendingUsers} className={`${btnPrimary} h-9 px-4`}>
                      <Check className="w-4 h-4 mr-2" />
                      Approve {pendingUsersList.length} Pending
                    </button>
                  )}
                  {usersList.some((u) => !isUserAdminAccount(u)) && (
                    <button
                      onClick={handleDeleteAllNonAdminUsers}
                      className={`${btnDanger} h-9 px-4 opacity-80 hover:opacity-100`}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete All
                    </button>
                  )}
                </div>
              </div>

              {/* Summary Counts & Filter Controls */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      { id: 'all', label: `All (${usersList.length})` },
                      { id: 'pending', label: `Pending (${pendingUsersList.length})` },
                      {
                        id: 'approved',
                        label: `Approved (${usersList.filter((u) => getUserStatus(u) === 'approved').length})`,
                      },
                      {
                        id: 'rejected',
                        label: `Blocked (${usersList.filter((u) => getUserStatus(u) === 'rejected').length})`,
                      },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setUserFilter(tab.id)}
                      className={`${userFilter === tab.id ? btnPrimary : btnSecondary} px-4 py-2 uppercase tracking-tighter font-bold text-[10px]`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="w-full sm:w-72 relative">
                  <Search className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${textMuted}`} />
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className={`${inputCls} pl-9 h-10`}
                  />
                </div>
              </div>

              {/* Users Table */}
              <div className={`rounded-[14px] overflow-hidden border ${borderCol} overflow-x-auto`}>
                <table className="w-full text-left border-collapse text-[12px] min-w-[550px]">
                  <thead>
                    <tr className={`border-b ${borderCol} ${bgSubtle} ${textMuted}`}>
                      <th className="py-2 px-3 font-medium">User / Email</th>
                      <th className="py-2 px-3 font-medium">Sign-In Method</th>
                      <th className="py-2 px-3 font-medium">Registered</th>
                      <th className="py-2 px-3 font-medium">Status</th>
                      <th className="py-2 px-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsersList.map((u) => {
                      const status = getUserStatus(u);
                      const isAdminAcc = isUserAdminAccount(u);
                      return (
                        <tr key={u.id} className={`border-b ${borderCol}`}>
                          <td className="py-2 px-3">
                            <div className="font-bold">
                              {u.displayName || 'User'}{' '}
                              {isAdminAcc && (
                                <span className="ml-1 text-[10px] font-bold text-emerald-500">· ADMIN</span>
                              )}
                            </div>
                            <div className={`text-[11px] ${textMuted}`}>{u.email || u.id}</div>
                          </td>
                          <td className={`py-2 px-3 text-[11px] ${textMuted}`}>
                            {u.authMethod || 'google'}
                          </td>
                          <td className={`py-2 px-3 tabular-nums whitespace-nowrap text-[11px] ${textMuted}`}>
                            {u.createdAt ? new Date(u.createdAt).toLocaleString() : 'Existing User'}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {status === 'approved' ? (
                              <span className="font-bold text-emerald-500">✓ Approved</span>
                            ) : status === 'rejected' ? (
                              <span className="font-bold text-rose-500">✕ Blocked</span>
                            ) : (
                              <span className="font-bold text-amber-500">⏳ Pending Approval</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            {isAdminAcc ? (
                              <span className={`text-[11px] ${textMuted}`}>Owner Account</span>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                {status !== 'approved' && (
                                  <button onClick={() => handleApproveUser(u)} className={btnPrimary}>
                                    <Check className="w-3 h-3 inline mr-1" />
                                    Approve
                                  </button>
                                )}
                                {status !== 'rejected' && (
                                  <button onClick={() => handleRejectUser(u)} className={btnDanger}>
                                    {status === 'approved' ? 'Revoke / Block' : 'Reject'}
                                  </button>
                                )}
                                {status !== 'pending' && (
                                  <button onClick={() => handleSetPendingUser(u)} className={btnSecondary}>
                                    Set Pending
                                  </button>
                                )}
                                <button onClick={() => handleDeleteUserRecord(u)} className={btnDanger}>
                                  <Trash2 className="w-3 h-3 inline" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredUsersList.length === 0 && (
                      <tr>
                        <td colSpan={5} className={`py-6 text-center ${textMuted}`}>
                          No users found matching your filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 2. ACTIVITY TRACKER */}
          {activeSection === 'activity' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b ${borderCol} pb-3`}>
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold uppercase tracking-widest text-[var(--admin-text)]">
                    2. Activity Tracker
                  </h2>
                  <p className={`text-[11px] ${textMuted} mt-1`}>
                    Monitor live app interactions and user engagement logs.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button onClick={exportActivityCsv} className={`${btnPrimary} h-9 px-4`}>
                    <Download className="w-4 h-4 mr-2" />
                    Export Log ({filteredActivities.length})
                  </button>
                  <button
                    onClick={handleClearActivityLogs}
                    disabled={activities.length === 0}
                    className={`${btnDanger} h-9 px-4 opacity-80 hover:opacity-100 disabled:opacity-30`}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Wipe Logs
                  </button>
                </div>
              </div>

              {/* Filter Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className={`block text-[10px] uppercase font-bold tracking-wider ${textMuted} ml-1`}>
                    Filter Date
                  </label>
                  <input
                    type="date"
                    value={actDateFilter}
                    onChange={(e) => setActDateFilter(e.target.value)}
                    className={`${inputCls} h-10`}
                  />
                </div>
                <div className="space-y-1">
                  <label className={`block text-[10px] uppercase font-bold tracking-wider ${textMuted} ml-1`}>
                    Event Type
                  </label>
                  <select
                    value={actTypeFilter}
                    onChange={(e) => setActTypeFilter(e.target.value)}
                    className={`${inputCls} h-10`}
                  >
                    <option value="all">All Activities</option>
                    <option value="app_opened">App Opened</option>
                    <option value="section_visited">Section Visited</option>
                    <option value="media_viewed">Media View</option>
                    <option value="game_played">Game Session</option>
                    <option value="hug_sent">Hug Sent</option>
                    <option value="call_tapped">Call Event</option>
                    <option value="voice_note">Voice Note</option>
                    <option value="letter_opened">Letter Read</option>
                  </select>
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label className={`block text-[10px] uppercase font-bold tracking-wider ${textMuted} ml-1`}>
                    Search Descriptions
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${textMuted}`} />
                      <input
                        type="text"
                        placeholder="Keyword search..."
                        value={actSearch}
                        onChange={(e) => setActSearch(e.target.value)}
                        className={`${inputCls} pl-9 h-10`}
                      />
                    </div>
                    {(actDateFilter || actTypeFilter !== 'all' || actSearch) && (
                      <button
                        onClick={() => {
                          setActDateFilter('');
                          setActTypeFilter('all');
                          setActSearch('');
                        }}
                        className={`${btnSecondary} h-10 px-4 font-bold text-[10px] uppercase tracking-tighter`}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Log Table */}
              <div className={`rounded-[14px] overflow-hidden border ${borderCol} overflow-x-auto`}>
                <table className="w-full text-left border-collapse text-[12px] min-w-[550px]">
                  <thead>
                    <tr className={`border-b ${borderCol} ${bgSubtle} ${textMuted}`}>
                      <th className="py-1.5 px-2.5 font-medium">Timestamp</th>
                      <th className="py-1.5 px-2.5 font-medium">Type</th>
                      <th className="py-1.5 px-2.5 font-medium">Description</th>
                      <th className="py-1.5 px-2.5 font-medium">Device</th>
                      <th className="py-1.5 px-2.5 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActivities.map((ev) => (
                      <tr key={ev.id} className={`border-b ${borderCol}`}>
                        <td className={`py-1.5 px-2.5 tabular-nums whitespace-nowrap ${textMuted}`}>
                          {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ev.dateIso || '-'}
                        </td>
                        <td className="py-1.5 px-2.5 text-[11px] whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full border ${borderCol}`}>{ev.type}</span>
                        </td>
                        <td className="py-1.5 px-2.5">{ev.description}</td>
                        <td className={`py-1.5 px-2.5 text-[11px] ${textMuted}`}>
                          {ev.deviceId || '-'}
                        </td>
                        <td className="py-1.5 px-2.5 text-right">
                          <button
                            onClick={() =>
                              askConfirm('Delete this log entry?', async () => {
                                setActivities((prev) => prev.filter((x) => x.id !== ev.id));
                                notifyStatus('Activity log deleted.');
                                await deleteDoc(doc(db, 'activity', ev.id));
                              })
                            }
                            className={btnDanger}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredActivities.length === 0 && (
                      <tr>
                        <td colSpan={5} className={`py-6 text-center ${textMuted}`}>
                          No matching activity logs.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. MEDIA MANAGER */}
          {activeSection === 'media' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b ${borderCol} pb-3`}>
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold uppercase tracking-widest text-[var(--admin-text)]">
                    3. Media Manager
                  </h2>
                  <p className={`text-[11px] ${textMuted} mt-1`}>
                    Manage photos and videos across all app galleries.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <div className={`flex items-center rounded-lg border ${borderCol} p-1 bg-[var(--admin-card)]`}>
                    <button
                      onClick={() => setMediaViewMode('grid')}
                      className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${
                        mediaViewMode === 'grid'
                          ? 'bg-[var(--admin-primary)] text-[var(--admin-primary-text)] shadow-sm'
                          : `${textMuted} hover:text-[var(--admin-text)]`
                      }`}
                    >
                      Grid
                    </button>
                    <button
                      onClick={() => setMediaViewMode('list')}
                      className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${
                        mediaViewMode === 'list'
                          ? 'bg-[var(--admin-primary)] text-[var(--admin-primary-text)] shadow-sm'
                          : `${textMuted} hover:text-[var(--admin-text)]`
                      }`}
                    >
                      List
                    </button>
                  </div>
                  {selectedMediaIds.length > 0 && (
                    <button onClick={handleBulkDeleteMedia} className={`${btnDanger} h-9 px-4`}>
                      Delete ({selectedMediaIds.length})
                    </button>
                  )}
                  {mediaItems.length > 0 && (
                    <button
                      onClick={handleDeleteAllMedia}
                      className={`${btnDanger} h-9 px-4 opacity-80 hover:opacity-100`}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Wipe All
                    </button>
                  )}
                </div>
              </div>

              {/* Upload Bar (Cloudinary 25GB Free Storage + Firestore Fallback + Direct URL) */}
              <div className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-3`}>
                {/* Storage Engine Status & Quick Cloudinary Setup Toggle */}
                <div className={`flex flex-wrap items-center justify-between gap-2 pb-2 border-b ${borderCol}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${borderCol}`}>
                      {isCloudinaryReady
                        ? `CLOUDINARY ACTIVE (${cloudNameInput.trim()})`
                        : 'FIRESTORE FREE MODE (ADD CLOUDINARY PRESET FOR HD VIDEOS)'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] border ${borderCol}`}>
                      {isCloudinaryDeleteReady
                        ? 'AUTO-DELETE FROM CLOUDINARY: ON'
                        : 'AUTO-DELETE FROM CLOUDINARY: ADD API KEY/SECRET'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCloudinaryBox(!showCloudinaryBox)}
                    className={btnSecondary}
                  >
                    {showCloudinaryBox ? 'Hide Cloudinary Setup' : '⚡ Cloudinary & Auto-Delete Setup'}
                  </button>
                </div>

                {/* Collapsible Cloudinary Config Box right inside Media Manager */}
                {(showCloudinaryBox || !isCloudinaryReady) && (
                  <form
                    onSubmit={handleSaveAndTestCloudinary}
                    className={`p-2.5 rounded-[14px] border ${borderCol} ${bgMain} space-y-2`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-bold text-[11px]">
                        Cloudinary Free Storage + Permanent Auto-Delete Setup
                      </span>
                      <span className={`text-[10px] ${textMuted}`}>
                        For Auto-Delete from Cloudinary: Copy <b>API Key</b> & <b>API Secret</b> from Cloudinary Dashboard → Settings → API Keys
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
                      <div>
                        <label className={`block text-[10px] ${textMuted} mb-0.5`}>
                          Cloud Name
                        </label>
                        <input
                          type="text"
                          placeholder="dsfcu9y1h"
                          value={cloudNameInput}
                          onChange={(e) => setCloudNameInput(e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={`block text-[10px] ${textMuted} mb-0.5`}>
                          Unsigned Upload Preset
                        </label>
                        <input
                          type="text"
                          placeholder="Unsigned Upload Preset Name"
                          value={uploadPresetInput}
                          onChange={(e) => setUploadPresetInput(e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={`block text-[10px] ${textMuted} mb-0.5`}>
                          API Key (For Cloudinary Delete)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. 123456789012345"
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={`block text-[10px] ${textMuted} mb-0.5`}>
                          API Secret (For Cloudinary Delete)
                        </label>
                        <input
                          type="password"
                          placeholder="Your Cloudinary API Secret"
                          value={apiSecretInput}
                          onChange={(e) => setApiSecretInput(e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <button type="submit" disabled={testingCloudinary} className={btnPrimary}>
                        {testingCloudinary ? 'Testing & Saving...' : 'Save & Test'}
                      </button>
                    </div>
                    {cloudinaryStatusMsg && (
                      <div className={`text-[11px] pt-1 ${textMuted}`}>{cloudinaryStatusMsg}</div>
                    )}
                  </form>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Assign Category</label>
                    <select
                      value={uploadCategory}
                      onChange={(e) => setUploadCategory(e.target.value)}
                      className={inputCls}
                    >
                      {MEDIA_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={`block text-[11px] ${textMuted} mb-1`}>
                      Upload Photos / Videos (Multiple · {isCloudinaryReady ? 'Uploads to Cloudinary CDN' : 'Uploads to Free Firestore Storage'})
                    </label>
                    <input
                      type="file"
                      multiple
                      accept="image/*,video/*"
                      disabled={isUploadingMedia}
                      onChange={handleMultipleMediaUpload}
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Or Add Direct Link */}
                <form onSubmit={handleAddDirectUrlMedia} className={`pt-2 border-t ${borderCol} grid grid-cols-1 sm:grid-cols-5 gap-2 items-end`}>
                  <div className="sm:col-span-2">
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Or Paste Direct Image/Video URL (Cloudinary / Link)</label>
                    <input
                      type="text"
                      placeholder="https://..."
                      value={directMediaUrl}
                      onChange={(e) => setDirectMediaUrl(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Title / Caption</label>
                    <input
                      type="text"
                      placeholder="Memory title"
                      value={directMediaName}
                      onChange={(e) => setDirectMediaName(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Media Type</label>
                    <select
                      value={directMediaType}
                      onChange={(e) => setDirectMediaType(e.target.value as 'image' | 'video')}
                      className={inputCls}
                    >
                      <option value="image">Photo / Image</option>
                      <option value="video">Video</option>
                    </select>
                  </div>
                  <button type="submit" className={btnPrimary}>
                    + Add URL
                  </button>
                </form>

                {isUploadingMedia && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span>
                        {isCloudinaryReady
                          ? `Uploading directly to Cloudinary (${cloudNameInput.trim()})...`
                          : 'Compressing & saving to Firestore...'}
                      </span>
                      <span className="tabular-nums">{uploadProgress}%</span>
                    </div>
                    <div className={`w-full h-1.5 rounded-full overflow-hidden border ${borderCol}`}>
                      <div
                        style={{ width: `${uploadProgress}%` }}
                        className="h-full rounded-full bg-[var(--admin-primary)]"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Filter Tabs (including Her Uploads) */}
              <div className="flex flex-wrap gap-1.5">
                {['all', ...MEDIA_CATEGORIES, 'her_only'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setMediaCategoryFilter(cat)}
                    className={`${mediaCategoryFilter === cat ? btnPrimary : btnSecondary} !rounded-full`}
                  >
                    {cat === 'all'
                      ? `All (${mediaItems.length})`
                      : cat === 'her_only'
                      ? `Uploaded By Her (${mediaItems.filter((m) => m.uploadedBy === 'her').length})`
                      : cat}
                  </button>
                ))}
              </div>

              {/* Media Items Display */}
              {(() => {
                const filtered = mediaItems.filter((m) => {
                  if (mediaCategoryFilter === 'all') return true;
                  if (mediaCategoryFilter === 'her_only') return m.uploadedBy === 'her';
                  return m.category === mediaCategoryFilter;
                });

                if (filtered.length === 0) {
                  return <div className={`p-6 rounded-[14px] border ${borderCol} text-center ${textMuted}`}>No media items in this filter.</div>;
                }

                if (mediaViewMode === 'grid') {
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                      {filtered.map((item) => {
                        const checked = selectedMediaIds.includes(item.id);
                        return (
                          <div key={item.id} className={`rounded-[12px] border ${borderCol} p-2 flex flex-col justify-between gap-2`}>
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-1">
                                <label className="flex items-center gap-1.5 text-[11px] truncate cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      if (e.target.checked) setSelectedMediaIds([...selectedMediaIds, item.id]);
                                      else setSelectedMediaIds(selectedMediaIds.filter((id) => id !== item.id));
                                    }}
                                  />
                                  <span className="truncate font-medium" title={item.name}>
                                    {item.name || 'Untitled'}
                                  </span>
                                </label>
                                <span className={`px-2 py-0.5 rounded-full border ${borderCol} text-[10px] ${textMuted} shrink-0`}>
                                  {item.views || 0} views
                                </span>
                              </div>

                              <div
                                onClick={() => setPreviewMedia(item)}
                                className={`aspect-video w-full rounded-[12px] border ${borderCol} overflow-hidden flex items-center justify-center cursor-pointer ${bgSubtle}`}
                              >
                                {item.type === 'video' ? (
                                  <video src={item.url} className="w-full h-full object-cover rounded-[12px]" />
                                ) : (
                                  <img src={item.url} alt={item.name} className="w-full h-full object-cover rounded-[12px]" />
                                )}
                              </div>

                              {renamingId === item.id ? (
                                <div className="flex gap-1">
                                  <input
                                    type="text"
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    className={inputCls}
                                  />
                                  <button
                                    onClick={() => {
                                      const newName = renameValue.trim();
                                      setMediaItems((prev) =>
                                        prev.map((m) => (m.id === item.id ? { ...m, name: newName } : m))
                                      );
                                      setRenamingId(null);
                                      notifyStatus('Renamed.');
                                      void updateDoc(doc(db, 'media', item.id), { name: newName }).catch(
                                        (err: any) => notifyStatus(`Rename failed: ${err.message}`, true)
                                      );
                                    }}
                                    className={btnPrimary}
                                  >
                                    Save
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className={`px-2 py-0.5 rounded-full border ${borderCol} text-[10px] ${textMuted}`}>
                                    {item.uploadedBy === 'her' ? 'Her Upload' : item.category || 'Gallery'}
                                  </span>
                                  <button
                                    onClick={() => {
                                      setRenamingId(item.id);
                                      setRenameValue(item.name || '');
                                    }}
                                    className="underline cursor-pointer"
                                  >
                                    Rename
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className={`flex items-center justify-between gap-1 pt-1 border-t ${borderCol}`}>
                              <select
                                value={item.category || 'Gallery'}
                                onChange={(e) => {
                                  const newCat = e.target.value;
                                  setMediaItems((prev) =>
                                    prev.map((m) => (m.id === item.id ? { ...m, category: newCat } : m))
                                  );
                                  notifyStatus(`Moved to ${newCat}`);
                                  void updateDoc(doc(db, 'media', item.id), { category: newCat }).catch(() => {});
                                  if (newCat === 'Home photo') {
                                    void setDoc(doc(db, 'content', 'main'), { lockPhotoUrl: item.url }, { merge: true }).catch(() => {});
                                  }
                                }}
                                className={`text-[11px] px-1.5 py-0.5 rounded-[10px] border ${borderCol} bg-[var(--admin-input-bg)] text-[var(--admin-text)]`}
                              >
                                {MEDIA_CATEGORIES.map((c) => (
                                  <option key={c} value={c} className="bg-[var(--admin-card)] text-[var(--admin-text)]">
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <button onClick={() => handleDeleteSingleMedia(item)} className={btnDanger}>
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                return (
                  <div className={`rounded-[14px] overflow-hidden border ${borderCol} overflow-x-auto`}>
                    <table className="w-full text-left border-collapse text-[12px] min-w-[500px]">
                      <thead>
                        <tr className={`border-b ${borderCol} ${bgSubtle} ${textMuted}`}>
                          <th className="py-1.5 px-2.5">Sel</th>
                          <th className="py-1.5 px-2.5">Name</th>
                          <th className="py-1.5 px-2.5">Category</th>
                          <th className="py-1.5 px-2.5">Source</th>
                          <th className="py-1.5 px-2.5">Views</th>
                          <th className="py-1.5 px-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((item) => (
                          <tr key={item.id} className={`border-b ${borderCol}`}>
                            <td className="py-1.5 px-2.5">
                              <input
                                type="checkbox"
                                checked={selectedMediaIds.includes(item.id)}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedMediaIds([...selectedMediaIds, item.id]);
                                  else setSelectedMediaIds(selectedMediaIds.filter((id) => id !== item.id));
                                }}
                              />
                            </td>
                            <td className="py-1.5 px-2.5 font-medium">{item.name}</td>
                            <td className="py-1.5 px-2.5">
                              <span className={`px-2 py-0.5 rounded-full border ${borderCol} text-[10px]`}>
                                {item.category}
                              </span>
                            </td>
                            <td className="py-1.5 px-2.5">
                              <span className={`px-2 py-0.5 rounded-full border ${borderCol} text-[10px]`}>
                                {item.uploadedBy === 'her' ? 'Her' : 'Admin'}
                              </span>
                            </td>
                            <td className="py-1.5 px-2.5 tabular-nums">{item.views || 0}</td>
                            <td className="py-1.5 px-2.5 text-right space-x-1">
                              <button onClick={() => setPreviewMedia(item)} className={btnSecondary}>
                                Preview
                              </button>
                              <button
                                onClick={() => {
                                  setRenamingId(item.id);
                                  setRenameValue(item.name || '');
                                  setMediaViewMode('grid');
                                }}
                                className={btnSecondary}
                              >
                                Rename
                              </button>
                              <button onClick={() => handleDeleteSingleMedia(item)} className={btnDanger}>
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}

          {/* 4. INBOX (FROM HER) */}
          {activeSection === 'inbox' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b ${borderCol} pb-3`}>
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold uppercase tracking-widest text-[var(--admin-text)]">
                    4. Inbox From Her
                  </h2>
                  <p className={`text-[11px] ${textMuted} mt-1`}>
                    View voice notes, photos, and hugs received from her app.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <div className={`px-3 py-1.5 rounded-full border ${borderCol} bg-[var(--admin-card)] text-[10px] font-bold uppercase tracking-widest ${textMuted}`}>
                    {inboxItems.length} Total Items
                  </div>
                  {inboxItems.length > 0 && (
                    <button
                      onClick={handleDeleteAllInbox}
                      className={`${btnDanger} h-9 px-4 opacity-80 hover:opacity-100`}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Wipe Inbox
                    </button>
                  )}
                </div>
              </div>

              {replyTarget && (
                <form onSubmit={handleSendInboxReply} className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-2`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[12px]">
                      Reply to {replyTarget.type} ({new Date(replyTarget.createdAt).toLocaleString()})
                    </span>
                    <button type="button" onClick={() => setReplyTarget(null)} className={btnSecondary}>
                      Cancel
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Notification Title"
                    value={replyTitle}
                    onChange={(e) => setReplyTitle(e.target.value)}
                    className={inputCls}
                  />
                  <textarea
                    rows={2}
                    placeholder="Write your reply notification message..."
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    className={inputCls}
                  />
                  <button type="submit" className={btnPrimary}>
                    Send Reply Notification
                  </button>
                </form>
              )}

              <div className={`rounded-[14px] overflow-hidden border ${borderCol} overflow-x-auto`}>
                <table className="w-full text-left border-collapse text-[12px] min-w-[550px]">
                  <thead>
                    <tr className={`border-b ${borderCol} ${bgSubtle} ${textMuted}`}>
                      <th className="py-1.5 px-2.5">Status</th>
                      <th className="py-1.5 px-2.5">Type</th>
                      <th className="py-1.5 px-2.5">Time</th>
                      <th className="py-1.5 px-2.5">Content / Media</th>
                      <th className="py-1.5 px-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inboxItems.map((item) => (
                      <tr key={item.id} className={`border-b ${borderCol}`}>
                        <td className="py-1.5 px-2.5 text-[11px]">
                          <span className={`px-2 py-0.5 rounded-full border ${borderCol}`}>
                            {item.read ? 'READ' : 'UNREAD'}
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5 font-bold uppercase text-[11px]">
                          <span className={`px-2 py-0.5 rounded-full border ${borderCol}`}>
                            {item.type}
                          </span>
                        </td>
                        <td className={`py-1.5 px-2.5 tabular-nums whitespace-nowrap ${textMuted}`}>
                          {item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}
                        </td>
                        <td className="py-1.5 px-2.5">
                          <div className="flex items-center gap-2">
                            <span>{item.caption}</span>
                            {item.type === 'voice' && item.mediaUrl && (
                              <button onClick={() => togglePlayInboxAudio(item)} className={btnSecondary}>
                                {playingAudioId === item.id ? 'Pause Audio' : 'Play Voice'}
                              </button>
                            )}
                            {item.type === 'photo' && item.mediaUrl && (
                              <button
                                onClick={() => setPreviewMedia({ url: item.mediaUrl, name: item.caption, type: 'image' })}
                                className={btnSecondary}
                              >
                                View Photo
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 px-2.5 text-right whitespace-nowrap space-x-1">
                          <button
                            onClick={() => {
                              const nextRead = !item.read;
                              setInboxItems((prev) =>
                                prev.map((x) => (x.id === item.id ? { ...x, read: nextRead } : x))
                              );
                              void updateDoc(doc(db, 'inbox', item.id), { read: nextRead }).catch(() => {});
                            }}
                            className={btnSecondary}
                          >
                            {item.read ? 'Mark Unread' : 'Mark Read'}
                          </button>
                          {item.mediaUrl && (
                            <button
                              type="button"
                              onClick={() => void handleDownloadInboxMedia(item)}
                              className={btnSecondary}
                            >
                              Download
                            </button>
                          )}
                          <button onClick={() => setReplyTarget(item)} className={btnPrimary}>
                            Reply
                          </button>
                          <button
                            onClick={() =>
                              askConfirm('Delete this inbox item permanently from App & Storage?', () => {
                                setInboxItems((prev) => prev.filter((x) => x.id !== item.id));
                                notifyStatus('Inbox item deleted.');
                                void (async () => {
                                  try {
                                    await deleteDoc(doc(db, 'inbox', item.id));
                                    if (item.mediaUrl || item.storagePath) {
                                      const delRes = await deleteFirestoreMediaChunks(
                                        item.storagePath || item.mediaUrl,
                                        item.mediaUrl,
                                        item.type
                                      );
                                      if (delRes?.cloudinaryDeleted) {
                                        notifyStatus('Inbox item deleted from App & Cloudinary!');
                                      }
                                    }
                                  } catch (err: any) {
                                    notifyStatus(`Delete error: ${err.message}`, true);
                                  }
                                })();
                              })
                            }
                            className={btnDanger}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {inboxItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className={`py-6 text-center ${textMuted}`}>
                          Inbox is empty. Voice notes, photos, and hugs from her appear here live.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5. NOTIFICATION SENDER */}
          {activeSection === 'notifications' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b ${borderCol} pb-3`}>
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold uppercase tracking-widest text-[var(--admin-text)]">
                    5. Notification Sender
                  </h2>
                  <p className={`text-[11px] ${textMuted} mt-1`}>
                    Push live alerts and reminders directly to her Android phone.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <div className={`px-3 py-1.5 rounded-full border ${borderCol} bg-[var(--admin-card)] text-[10px] font-bold uppercase tracking-widest ${textMuted}`}>
                    {notificationsList.length} History
                  </div>
                </div>
              </div>

              <form onSubmit={handleSendNotification} className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-3`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Title *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Thinking of you"
                      value={notifTitle}
                      onChange={(e) => setNotifTitle(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Optional Image URL</label>
                    <input
                      type="text"
                      placeholder="https://..."
                      value={notifImage}
                      onChange={(e) => setNotifImage(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>

                <div>
                  <label className={`block text-[11px] ${textMuted} mb-1`}>Message *</label>
                  <textarea
                    rows={2}
                    required
                    placeholder="Notification body text..."
                    value={notifMessage}
                    onChange={(e) => setNotifMessage(e.target.value)}
                    className={inputCls}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Notification Sound</label>
                    <div className="flex gap-1.5">
                      <select
                        value={notifSoundUrl}
                        onChange={(e) => setNotifSoundUrl(e.target.value)}
                        className={inputCls}
                      >
                        {allAvailableSounds.map((s, i) => (
                          <option key={i} value={s.url}>
                            {s.name}
                          </option>
                        ))}
                        <option value="silent">Silent (Vibration Only)</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void handlePreviewSoundUrl(notifSoundUrl)}
                        className={btnSecondary}
                      >
                        {previewingSoundUrl === notifSoundUrl && notifSoundUrl !== 'silent' ? '⏸ Stop' : '▶ Test'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Upload Custom Sound (MP3 / Audio)</label>
                    <input
                      type="file"
                      accept="audio/*"
                      disabled={uploadingSound}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        await handleUploadCustomSoundFile(file, 'notif');
                        e.target.value = '';
                      }}
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Schedule (Leave blank to Send Now)</label>
                    <input
                      type="datetime-local"
                      value={notifScheduleTime}
                      onChange={(e) => setNotifScheduleTime(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Configurable Notification Action Buttons (Up to 3) */}
                <div className={`p-2.5 rounded-[12px] border ${borderCol} space-y-2`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-bold">
                        Notification Action Buttons (Optional · Up to 3)
                      </div>
                      <div className={`text-[10px] ${textMuted}`}>
                        Appears both in the in-app notification banner and in Android system notifications.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {notifButtons.length < 3 && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setNotifButtons([
                                ...notifButtons,
                                { label: 'Call Me Now 📞', action: 'call_now', payload: callNumberInput || '9817905531' },
                              ])
                            }
                            className={btnSecondary}
                          >
                            + Call Button
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setNotifButtons([
                                ...notifButtons,
                                { label: 'Open Gallery ✨', action: 'open_section', payload: 'gallery' },
                              ])
                            }
                            className={btnSecondary}
                          >
                            + Section Button
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setNotifButtons([
                                ...notifButtons,
                                { label: 'Keep in Heart 💖', action: 'dismiss', payload: '' },
                              ])
                            }
                            className={btnSecondary}
                          >
                            + Custom Button
                          </button>
                        </>
                      )}
                      {notifButtons.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setNotifButtons([])}
                          className={btnDanger}
                        >
                          Clear All Buttons
                        </button>
                      )}
                    </div>
                  </div>

                  {notifButtons.map((btn, idx) => (
                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 items-center">
                      <input
                        type="text"
                        placeholder="Button Label (e.g. Call Me Now 📞)"
                        value={btn.label}
                        onChange={(e) => {
                          const next = [...notifButtons];
                          next[idx] = { ...next[idx], label: e.target.value };
                          setNotifButtons(next);
                        }}
                        className={inputCls}
                      />
                      <select
                        value={btn.action}
                        onChange={(e) => {
                          const next = [...notifButtons];
                          const newAction = e.target.value as PopupButtonAction;
                          next[idx] = {
                            ...next[idx],
                            action: newAction,
                            payload:
                              newAction === 'call_now'
                                ? callNumberInput || '9817905531'
                                : newAction === 'open_section'
                                ? 'gallery'
                                : '',
                          };
                          setNotifButtons(next);
                        }}
                        className={inputCls}
                      >
                        <option value="call_now">Call Now (Direct Phone Call)</option>
                        <option value="open_section">Open App Section</option>
                        <option value="open_url">Open External Link</option>
                        <option value="dismiss">Dismiss Notification</option>
                      </select>
                      <div className="flex gap-1">
                        {btn.action === 'open_section' ? (
                          <select
                            value={btn.payload || 'home'}
                            onChange={(e) => {
                              const next = [...notifButtons];
                              next[idx] = { ...next[idx], payload: e.target.value };
                              setNotifButtons(next);
                            }}
                            className={inputCls}
                          >
                            <option value="home">Home</option>
                            <option value="gallery">Gallery</option>
                            <option value="secret-letter">Secret Letter</option>
                            <option value="games">Games</option>
                            <option value="cute-pic">Cute Pic</option>
                            <option value="name-game">Name Game</option>
                          </select>
                        ) : (
                          <input
                            type="text"
                            placeholder={
                              btn.action === 'call_now'
                                ? 'Phone number (e.g. 9817905531)'
                                : btn.action === 'open_url'
                                ? 'https://...'
                                : 'No payload needed'
                            }
                            value={btn.payload || ''}
                            onChange={(e) => {
                              const next = [...notifButtons];
                              next[idx] = { ...next[idx], payload: e.target.value };
                              setNotifButtons(next);
                            }}
                            className={inputCls}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => setNotifButtons(notifButtons.filter((_, i) => i !== idx))}
                          className={btnDanger}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Target Recipient Selector (Send to All vs Particular User / Username) */}
                <div className={`p-3 rounded-[12px] border ${borderCol} space-y-2.5`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-bold">
                        🎯 Send Notification To (Target Recipient)
                      </div>
                      <div className={`text-[10px] ${textMuted}`}>
                        Choose whether to send to all users or a particular username. Each user's response will appear with their name.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setNotifTargetMode('ALL')}
                        className={
                          notifTargetMode === 'ALL'
                            ? `${btnPrimary} ring-1 ring-pink-400/50`
                            : btnSecondary
                        }
                      >
                        🌍 Send to All Users
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNotifTargetMode('USER');
                          if (!notifTargetUser && selectableTargetUsers.length > 0) {
                            setNotifTargetUser(selectableTargetUsers[0].username);
                          }
                        }}
                        className={
                          notifTargetMode === 'USER'
                            ? `${btnPrimary} ring-1 ring-pink-400/50`
                            : btnSecondary
                        }
                      >
                        👤 Particular User (Username)
                      </button>
                    </div>
                  </div>

                  {notifTargetMode === 'USER' && (
                    <div className="space-y-2 pt-1">
                      {selectableTargetUsers.length > 0 && (
                        <div>
                          <div className={`text-[10px] ${textMuted} mb-1`}>
                            Select from Registered / Active Users:
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {selectableTargetUsers.map((u) => {
                              const isSelected =
                                notifTargetUser.trim().toLowerCase() === u.username.toLowerCase() ||
                                (u.email && notifTargetUser.trim().toLowerCase() === u.email.toLowerCase());
                              return (
                                <button
                                  key={u.id + u.email}
                                  type="button"
                                  onClick={() => setNotifTargetUser(u.username)}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                                    isSelected
                                      ? 'bg-[var(--admin-primary)]/20 border-[var(--admin-primary)] text-[var(--admin-text)] shadow-sm'
                                      : `${borderCol} ${textMuted} hover:text-[var(--admin-text)]`
                                  }`}
                                >
                                  <span>👤 {u.username}</span>
                                  {u.email && (
                                    <span className="text-[9.5px] opacity-70">({u.email})</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <div>
                        <label className={`block text-[10px] ${textMuted} mb-1`}>
                          Or Enter Particular Username / Email Directly:
                        </label>
                        <input
                          type="text"
                          placeholder="Enter username or email (e.g. Kashish)"
                          value={notifTargetUser}
                          onChange={(e) => setNotifTargetUser(e.target.value)}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <button type="submit" className={btnPrimary}>
                  {notifScheduleTime
                    ? `Schedule Notification (${
                        notifTargetMode === 'ALL'
                          ? 'To: All Users'
                          : `To: ${notifTargetUser.trim() || 'Select User'}`
                      })`
                    : `Send Notification Now (${
                        notifTargetMode === 'ALL'
                          ? 'To: All Users'
                          : `To: ${notifTargetUser.trim() || 'Select User'}`
                      })`}
                </button>
              </form>

              {/* Notification History */}
              <div className={`rounded-[14px] overflow-hidden border ${borderCol} overflow-x-auto`}>
                <div className={`px-3 py-1.5 border-b ${borderCol} ${bgSubtle} flex items-center justify-between gap-2`}>
                  <span className="font-bold text-[12px]">
                    Notification History & User Responses ({notificationsList.length})
                  </span>
                  {notificationsList.length > 0 && (
                    <button
                      onClick={handleDeleteAllNotifications}
                      className={`${btnDanger} text-rose-400`}
                    >
                      <Trash2 className="w-3.5 h-3.5 inline mr-1" />
                      Delete All Notifications ({notificationsList.length})
                    </button>
                  )}
                </div>
                <table className="w-full text-left border-collapse text-[12px] min-w-[540px]">
                  <thead>
                    <tr className={`border-b ${borderCol} ${textMuted}`}>
                      <th className="py-1.5 px-2.5">Time & Target</th>
                      <th className="py-1.5 px-2.5">Title, Message & Buttons</th>
                      <th className="py-1.5 px-2.5">User Responses (Who Selected What)</th>
                      <th className="py-1.5 px-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notificationsList.map((n) => {
                      const isBroadcast = !n.targetUser || String(n.targetUser).toUpperCase() === 'ALL';
                      const targetDisplay = isBroadcast
                        ? 'All Users'
                        : n.targetUserName || n.targetUser;
                      const parsedResponses = parseClickedActionResponses(
                        n.clickedAction,
                        n.clickedLabel,
                        n.seenAt,
                        targetDisplay
                      );

                      return (
                        <tr key={n.id} className={`border-b ${borderCol}`}>
                          <td className={`py-2 px-2.5 tabular-nums whitespace-nowrap align-top ${textMuted}`}>
                            <div>{n.createdAt ? new Date(n.createdAt).toLocaleString() : '-'}</div>
                            <div className="mt-1">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                  isBroadcast
                                    ? 'bg-sky-500/15 border-sky-400/40 text-sky-300'
                                    : 'bg-pink-500/20 border-pink-400/50 text-pink-300'
                                }`}
                              >
                                {isBroadcast ? '🌍 Sent to: All Users' : `👤 Sent to: ${targetDisplay}`}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-2.5 align-top">
                            <div className="font-bold">{n.title}</div>
                            <div className={textMuted}>{n.message}</div>
                            {Array.isArray(n.buttons) && n.buttons.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {n.buttons.map((b: any, bi: number) => {
                                  const chosenByUsers = parsedResponses.filter(
                                    (r) => r.label === b.label || r.action === b.action
                                  );
                                  return (
                                    <span
                                      key={bi}
                                      className={`px-1.5 py-0.5 rounded text-[10px] border ${
                                        chosenByUsers.length > 0
                                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 font-bold'
                                          : borderCol
                                      }`}
                                    >
                                      {b.label} ({b.action})
                                      {chosenByUsers.length > 0 &&
                                        ` ✓ (${chosenByUsers.map((u) => u.userName).join(', ')})`}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-2.5 text-[11px] align-top space-y-1.5">
                            <div>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] border ${borderCol}`}>
                                {n.seen ? 'SEEN / DELIVERED' : n.status?.toUpperCase() || 'SENT'}
                              </span>
                            </div>
                            {parsedResponses.length > 0 ? (
                              <div className="space-y-1">
                                {parsedResponses.map((resp, ri) => (
                                  <div
                                    key={ri}
                                    className="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-[10.5px]"
                                  >
                                    <span className="font-extrabold text-[var(--admin-text)]">
                                      👤 {resp.userName}:
                                    </span>{' '}
                                    <span className="font-bold">✅ Chose "{resp.label}"</span>
                                    <span className="opacity-75"> ({resp.action})</span>
                                    {resp.timestamp && (
                                      <span className="block text-[9.5px] text-emerald-200/70">
                                        {new Date(resp.timestamp).toLocaleTimeString()}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className={`text-[10px] ${textMuted}`}>
                                No button clicked yet
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-2.5 text-right space-x-1 align-top whitespace-nowrap">
                            <button
                              onClick={() => {
                                notifyStatus(`Notification resent to ${targetDisplay}.`);
                                void addDoc(collection(db, 'notifications'), {
                                  title: n.title,
                                  message: n.message,
                                  imageUrl: n.imageUrl || '',
                                  soundUrl: n.soundUrl || '',
                                  buttons: Array.isArray(n.buttons) ? n.buttons : [],
                                  targetUser: n.targetUser || 'ALL',
                                  targetUserName: n.targetUserName || 'All Users',
                                  targetUserEmail: n.targetUserEmail || '',
                                  createdAt: Date.now(),
                                  status: 'sent',
                                  seen: false,
                                }).catch((err: any) => notifyStatus(`Resend error: ${err.message}`, true));
                              }}
                              className={btnSecondary}
                            >
                              Resend
                            </button>
                            <button
                              onClick={() =>
                                askConfirm('Delete notification from history?', () => {
                                  setNotificationsList((prev) => prev.filter((x) => x.id !== n.id));
                                  notifyStatus('Notification deleted.');
                                  void deleteDoc(doc(db, 'notifications', n.id)).catch(() => {});
                                })
                              }
                              className={btnDanger}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. OVERLAY POPUP SENDER (Truecaller Style) */}
          {activeSection === 'overlays' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b ${borderCol} pb-3`}>
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold uppercase tracking-widest text-[var(--admin-text)] leading-tight">
                    6. Overlay Popup Sender
                  </h2>
                  <p className={`text-[10px] ${textMuted} mt-1 uppercase tracking-tighter`}>
                    SYSTEM_ALERT_WINDOW + WakeLock (Truecaller Style)
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <div className={`px-3 py-1.5 rounded-full border ${borderCol} bg-[var(--admin-card)] text-[10px] font-bold uppercase tracking-widest ${textMuted}`}>
                    {overlaysList.length} History
                  </div>
                </div>
              </div>
                <button
                  type="button"
                  onClick={() => {
                    const effectiveUser =
                      ovTargetMode === 'USER'
                        ? ovTargetUser.trim() || selectableTargetUsers[0]?.username || editRecipientName.trim() || 'Kashish'
                        : '';
                    if (ovTargetMode === 'USER' && !ovTargetUser.trim()) {
                      setOvTargetUser(effectiveUser);
                    }
                    const targetMeta = resolveTargetMetadata(ovTargetMode, effectiveUser);
                    const now = Date.now();
                    const pendingOld = overlaysList.filter(
                      (ov) =>
                        !ov.dismissed &&
                        (!ov.scheduledFor || ov.scheduledFor <= now) &&
                        (targetMeta.targetUser === 'ALL' || (ov.targetUser || 'ALL') === targetMeta.targetUser)
                    );
                    void Promise.all(
                      pendingOld.map((oldOv) => {
                        const hasExistingResponse =
                          Boolean(oldOv.clickedAction) && oldOv.clickedAction !== 'replaced_by_new_overlay';
                        return updateDoc(
                          doc(db, 'overlays', oldOv.id),
                          hasExistingResponse
                            ? { dismissed: true }
                            : {
                                dismissed: true,
                                clickedAction: 'replaced_by_new_overlay',
                                seenAt: now,
                              }
                        ).catch(() => {});
                      })
                    );
                    notifyStatus(`Instant Truecaller Wakeup + Overlay popup sent to ${targetMeta.targetUserName}!`);
                    void addDoc(collection(db, 'overlays'), {
                      title: ovTitle.trim() || 'Thinking of You, Kashish 💖',
                      message:
                        ovMessage.trim() ||
                        'Just wanted to remind you how special you are to me right now!',
                      imageUrl: ovImage.trim(),
                      theme: ovTheme,
                      fontStyle: ovFontStyle,
                      soundUrl: ovSoundUrl || '',
                      buttons: ovButtons.slice(0, 3),
                      targetUser: targetMeta.targetUser,
                      targetUserName: targetMeta.targetUserName,
                      targetUserEmail: targetMeta.targetUserEmail,
                      targetUserUid: targetMeta.targetUserUid,
                      createdAt: Date.now(),
                      scheduledFor: null,
                      status: 'sent',
                      dismissed: false,
                    }).catch((err: any) => notifyStatus(`Overlay error: ${err.message}`, true));
                  }}
                  className={btnPrimary}
                >
                  ⚡ Send Instant Truecaller Wakeup Popup (
                  {ovTargetMode === 'ALL'
                    ? 'To: All Users'
                    : `To: ${ovTargetUser.trim() || selectableTargetUsers[0]?.username || 'Kashish'}`}
                  )
                </button>

              {/* Android Truecaller Permissions & Background Service Live Status */}
              <div className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-2.5`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-[12px]">
                    Android APK Truecaller Overlay & Lockscreen Wakeup Status
                  </div>
                  <span className={`text-[11px] ${textMuted}`}>
                    {deviceStatusDoc.deviceModel
                      ? `Phone: ${deviceStatusDoc.deviceModel} · Synced ${
                          deviceStatusDoc.updatedAt
                            ? new Date(Number(deviceStatusDoc.updatedAt)).toLocaleTimeString()
                            : 'Live'
                        }`
                      : 'Waiting for Android APK first launch (Located in /android-app)'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    {
                      label: '1. Display Over Other Apps',
                      sub: 'SYSTEM_ALERT_WINDOW (Instagram/WhatsApp)',
                      ok: Boolean(deviceStatusDoc.overlay),
                    },
                    {
                      label: '2. Lockscreen Light-Up',
                      sub: 'USE_FULL_SCREEN_INTENT + WakeLock',
                      ok: deviceStatusDoc.fullScreenIntent !== false && Boolean(deviceStatusDoc.deviceModel),
                    },
                    {
                      label: '3. 24/7 Background Service',
                      sub: 'Firestore overlays Watcher',
                      ok: Boolean(deviceStatusDoc.backgroundServiceRunning),
                    },
                    {
                      label: '4. Battery Unrestricted',
                      sub: 'No background kill on lock',
                      ok: Boolean(deviceStatusDoc.batteryUnrestricted),
                    },
                  ].map((item, idx) => (
                    <div key={idx} className={`p-2.5 rounded-[10px] border ${borderCol} ${bgMain}`}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-[11px] truncate">{item.label}</span>
                        <span className="text-[10px] font-bold">
                          {item.ok ? '✅ ACTIVE' : '⏳ PENDING'}
                        </span>
                      </div>
                      <div className={`text-[10px] ${textMuted} mt-0.5 truncate`}>{item.sub}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <form onSubmit={handleSendOverlay} className={`lg:col-span-2 p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-3`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className={`block text-[11px] ${textMuted} mb-1`}>Popup Title *</label>
                      <input
                        type="text"
                        required
                        value={ovTitle}
                        onChange={(e) => setOvTitle(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={`block text-[11px] ${textMuted} mb-1`}>Optional Image / Avatar URL</label>
                      <input
                        type="text"
                        placeholder="https://..."
                        value={ovImage}
                        onChange={(e) => setOvImage(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Message Text *</label>
                    <textarea
                      rows={2}
                      required
                      value={ovMessage}
                      onChange={(e) => setOvMessage(e.target.value)}
                      className={inputCls}
                    />
                  </div>

                  {/* Theme & Font Selectors */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className={`block text-[11px] ${textMuted} mb-1`}>Popup Theme</label>
                      <select
                        value={ovTheme}
                        onChange={(e) => setOvTheme(e.target.value as OverlayThemeId)}
                        className={inputCls}
                      >
                        {(Object.keys(OVERLAY_THEMES) as OverlayThemeId[]).map((tKey) => (
                          <option key={tKey} value={tKey}>
                            {OVERLAY_THEMES[tKey].name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-[11px] ${textMuted} mb-1`}>Typography / Font Style</label>
                      <select
                        value={ovFontStyle}
                        onChange={(e) => setOvFontStyle(e.target.value as OverlayFontId)}
                        className={inputCls}
                      >
                        {(Object.keys(OVERLAY_FONTS) as OverlayFontId[]).map((fKey) => (
                          <option key={fKey} value={fKey}>
                            {OVERLAY_FONTS[fKey].name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Custom Overlay Notification Sound & Audio Uploader */}
                  <div className={`p-2.5 rounded-[12px] border ${borderCol} space-y-2`}>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-[11px] font-bold">
                        🔊 Custom Overlay Popup Sound (Plays on Her Screen When Popup Appears)
                      </span>
                      <span className={`text-[10px] ${textMuted}`}>
                        Automatically stops as soon as she taps any button or closes the popup
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
                      <div>
                        <label className={`block text-[11px] ${textMuted} mb-1`}>Select Popup Sound</label>
                        <div className="flex gap-1.5">
                          <select
                            value={ovSoundUrl}
                            onChange={(e) => setOvSoundUrl(e.target.value)}
                            className={inputCls}
                          >
                            {allAvailableSounds.map((s, i) => (
                              <option key={i} value={s.url}>
                                {s.name}
                              </option>
                            ))}
                            <option value="silent">🔇 Silent (Heartbeat Vibration Only · No Sound)</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void handlePreviewSoundUrl(ovSoundUrl)}
                            className={btnSecondary}
                          >
                            {previewingSoundUrl === ovSoundUrl && ovSoundUrl !== 'silent' ? '⏸ Stop' : '▶ Test'}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className={`block text-[11px] ${textMuted} mb-1`}>
                          Upload Custom Sound / Voice / Song Clip (MP3, WAV, M4A)
                        </label>
                        <input
                          type="file"
                          accept="audio/*"
                          disabled={uploadingSound}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            await handleUploadCustomSoundFile(file, 'overlay');
                            e.target.value = '';
                          }}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Configurable Buttons (Up to 3) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className={`text-[11px] font-bold ${textMuted}`}>
                        Configurable Buttons (Up to 3)
                      </label>
                      {ovButtons.length < 3 && (
                        <button
                          type="button"
                          onClick={() =>
                            setOvButtons([...ovButtons, { label: 'Dismiss', action: 'dismiss', payload: '' }])
                          }
                          className={btnSecondary}
                        >
                          + Add Button
                        </button>
                      )}
                    </div>

                    {ovButtons.map((btn, idx) => (
                      <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 items-center">
                        <input
                          type="text"
                          placeholder="Button Label"
                          value={btn.label}
                          onChange={(e) => {
                            const next = [...ovButtons];
                            next[idx] = { ...next[idx], label: e.target.value };
                            setOvButtons(next);
                          }}
                          className={inputCls}
                        />
                        <select
                          value={btn.action}
                          onChange={(e) => {
                            const next = [...ovButtons];
                            next[idx] = { ...next[idx], action: e.target.value as PopupButtonAction };
                            setOvButtons(next);
                          }}
                          className={inputCls}
                        >
                          <option value="call_now">Call Now</option>
                          <option value="dismiss">Dismiss</option>
                          <option value="open_section">Open Section</option>
                          <option value="open_url">Open Link</option>
                        </select>
                        <div className="flex gap-1">
                          <input
                            type="text"
                            placeholder={
                              btn.action === 'call_now'
                                ? 'Phone number'
                                : btn.action === 'open_section'
                                ? 'gallery / games'
                                : btn.action === 'open_url'
                                ? 'https://...'
                                : 'No payload needed'
                            }
                            value={btn.payload || ''}
                            onChange={(e) => {
                              const next = [...ovButtons];
                              next[idx] = { ...next[idx], payload: e.target.value };
                              setOvButtons(next);
                            }}
                            className={inputCls}
                          />
                          <button
                            type="button"
                            onClick={() => setOvButtons(ovButtons.filter((_, i) => i !== idx))}
                            className={btnDanger}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Target Recipient Selector (Send to All vs Particular User / Username) */}
                  <div className={`p-3 rounded-[12px] border ${borderCol} space-y-2.5`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-bold">
                          🎯 Send Overlay Popup To (Target Recipient)
                        </div>
                        <div className={`text-[10px] ${textMuted}`}>
                          Choose All Users or a Particular Username. Responses show each user's name and selected option immediately!
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setOvTargetMode('ALL')}
                          className={
                            ovTargetMode === 'ALL'
                              ? `${btnPrimary} ring-1 ring-pink-400/50`
                              : btnSecondary
                          }
                        >
                          🌍 Send to All Users
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOvTargetMode('USER');
                            if (!ovTargetUser && selectableTargetUsers.length > 0) {
                              setOvTargetUser(selectableTargetUsers[0].username);
                            }
                          }}
                          className={
                            ovTargetMode === 'USER'
                              ? `${btnPrimary} ring-1 ring-pink-400/50`
                              : btnSecondary
                          }
                        >
                          👤 Particular User (Username)
                        </button>
                      </div>
                    </div>

                    {ovTargetMode === 'USER' && (
                      <div className="space-y-2 pt-1">
                        {selectableTargetUsers.length > 0 && (
                          <div>
                            <div className={`text-[10px] ${textMuted} mb-1`}>
                              Select from Registered / Active Users:
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {selectableTargetUsers.map((u) => {
                                const isSelected =
                                  ovTargetUser.trim().toLowerCase() === u.username.toLowerCase() ||
                                  (u.email && ovTargetUser.trim().toLowerCase() === u.email.toLowerCase());
                                return (
                                  <button
                                    key={u.id + u.email}
                                    type="button"
                                    onClick={() => setOvTargetUser(u.username)}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                                      isSelected
                                        ? 'bg-[var(--admin-primary)]/20 border-[var(--admin-primary)] text-[var(--admin-text)] shadow-sm'
                                        : `${borderCol} ${textMuted} hover:text-[var(--admin-text)]`
                                    }`}
                                  >
                                    <span>👤 {u.username}</span>
                                    {u.email && (
                                      <span className="text-[9.5px] opacity-70">({u.email})</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div>
                          <label className={`block text-[10px] ${textMuted} mb-1`}>
                            Or Enter Particular Username / Email Directly:
                          </label>
                          <input
                            type="text"
                            placeholder="Enter username or email (e.g. Kashish)"
                            value={ovTargetUser}
                            onChange={(e) => setOvTargetUser(e.target.value)}
                            className={inputCls}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                    <div>
                      <label className={`block text-[11px] ${textMuted} mb-1`}>Schedule (Optional)</label>
                      <input
                        type="datetime-local"
                        value={ovScheduleTime}
                        onChange={(e) => setOvScheduleTime(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <button type="submit" className={btnPrimary}>
                      {ovScheduleTime
                        ? `Schedule Overlay (${
                            ovTargetMode === 'ALL'
                              ? 'To: All Users'
                              : `To: ${ovTargetUser.trim() || 'Select User'}`
                          })`
                        : `Send Live Overlay Now (${
                            ovTargetMode === 'ALL'
                              ? 'To: All Users'
                              : `To: ${ovTargetUser.trim() || 'Select User'}`
                          })`}
                    </button>
                  </div>
                </form>

                {/* Live Romantic Preview Box */}
                {(() => {
                  const pTheme = OVERLAY_THEMES[ovTheme] || OVERLAY_THEMES['velvet-rose'];
                  const pFont = OVERLAY_FONTS[ovFontStyle] || OVERLAY_FONTS['romantic-serif'];
                  const isLight = ovTheme === 'soft-blush';
                  return (
                    <div className={`p-3 rounded-[14px] border ${borderCol} flex flex-col justify-between`}>
                      <div className={`text-[11px] font-bold uppercase ${textMuted} mb-2`}>
                        Live Romantic Overlay Preview ({pTheme.name})
                      </div>
                      <div
                        style={{
                          background: pTheme.cardBg,
                          borderColor: pTheme.border,
                        }}
                        className="rounded-[20px] border p-4 space-y-3 my-auto text-center"
                      >
                        <div
                          style={{ color: pTheme.kickerText }}
                          className="text-[10px] uppercase tracking-widest font-semibold"
                        >
                          ♥ A Special Note For Kashish ♥
                        </div>
                        {ovImage ? (
                          <img
                            src={ovImage}
                            alt=""
                            style={{ borderColor: pTheme.border }}
                            className="w-16 h-16 rounded-full object-cover mx-auto border-2"
                          />
                        ) : (
                          <div
                            style={{
                              background: pTheme.iconBadge,
                              borderColor: pTheme.border,
                              color: pTheme.kickerText,
                            }}
                            className="w-12 h-12 rounded-full border mx-auto flex items-center justify-center text-base"
                          >
                            ♥
                          </div>
                        )}
                        <h3
                          style={{
                            fontFamily: pFont.titleFont,
                            fontSize: '21px',
                            color: pTheme.titleText,
                          }}
                          className="overlay-preview-custom-font font-bold leading-tight"
                        >
                          {ovTitle || 'Title'}
                        </h3>
                        <div
                          style={{
                            background: pTheme.quoteBg,
                            borderColor: pTheme.border,
                          }}
                          className="rounded-[14px] border px-3 py-2.5"
                        >
                          <div
                            style={{
                              fontFamily: pFont.bodyFont,
                              fontSize: ovFontStyle === 'handwriting' ? '17px' : '12.5px',
                              color: pTheme.bodyText,
                            }}
                            className="overlay-preview-custom-font whitespace-pre-wrap leading-relaxed"
                          >
                            {ovMessage || 'Message'}
                          </div>
                        </div>
                        <div className="space-y-1.5 pt-1">
                          {ovButtons.map((b, i) => (
                            <div
                              key={i}
                              style={
                                i === 0
                                  ? { background: pTheme.primaryBtn, color: 'var(--admin-text)' }
                                  : {
                                      background: pTheme.secondaryBtn,
                                      color: isLight ? '#4a0e27' : '#fce7f3',
                                      borderColor: pTheme.border,
                                    }
                              }
                              className={`py-2 px-3 text-center text-[11px] font-semibold rounded-[12px] ${
                                i === 0 ? '' : 'border'
                              }`}
                            >
                              {b.label} ({b.action})
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className={`text-[10px] ${textMuted} mt-2 flex items-center justify-between gap-2`}>
                        <span>Triggers immediately on her screen with this exact theme & font.</span>
                        <span className="font-semibold">🔊 {getSoundLabel(ovSoundUrl)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Overlay History */}
              <div className={`rounded-[14px] overflow-hidden border ${borderCol} overflow-x-auto`}>
                <div className={`px-3 py-1.5 border-b ${borderCol} ${bgSubtle} flex items-center justify-between gap-2`}>
                  <span className="font-bold text-[12px]">
                    Overlay History & Her Chosen Options ({overlaysList.length})
                  </span>
                  {overlaysList.length > 0 && (
                    <button
                      onClick={handleDeleteAllOverlays}
                      className={`${btnDanger} text-rose-400`}
                    >
                      <Trash2 className="w-3.5 h-3.5 inline mr-1" />
                      Delete All Overlays ({overlaysList.length})
                    </button>
                  )}
                </div>
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead>
                    <tr className={`border-b ${borderCol} ${textMuted}`}>
                      <th className="py-1.5 px-2.5">Created & Target</th>
                      <th className="py-1.5 px-2.5">Title, Message & Options Given</th>
                      <th className="py-1.5 px-2.5">User Responses (Who Selected What)</th>
                      <th className="py-1.5 px-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overlaysList.map((o) => {
                      const btns: { label: string; action: string; payload?: string }[] =
                        Array.isArray(o.buttons) && o.buttons.length > 0
                          ? o.buttons
                          : [
                              { label: 'Call Jay Now 📞', action: 'call_now' },
                              { label: 'Keep in My Heart 💖', action: 'dismiss' },
                            ];

                      const isBroadcast = !o.targetUser || String(o.targetUser).toUpperCase() === 'ALL';
                      const targetDisplay = isBroadcast
                        ? 'All Users'
                        : o.targetUserName || o.targetUser;

                      const rawClicked = String(o.clickedAction || '').trim();
                      const isReplaced = rawClicked === 'replaced_by_new_overlay';
                      const parsedResponses = parseClickedActionResponses(
                        o.clickedAction,
                        o.clickedLabel,
                        o.seenAt,
                        targetDisplay
                      );

                      return (
                        <tr key={o.id} className={`border-b ${borderCol}`}>
                          <td className={`py-2 px-2.5 tabular-nums whitespace-nowrap align-top ${textMuted}`}>
                            <div>{o.createdAt ? new Date(o.createdAt).toLocaleString() : '-'}</div>
                            <div className="mt-1">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                  isBroadcast
                                    ? 'bg-sky-500/15 border-sky-400/40 text-sky-300'
                                    : 'bg-pink-500/20 border-pink-400/50 text-pink-300'
                                }`}
                              >
                                {isBroadcast ? '🌍 Sent to: All Users' : `👤 Sent to: ${targetDisplay}`}
                              </span>
                            </div>
                            {o.seenAt && (
                              <div className="text-[10px] text-pink-400 mt-1">
                                Last Response: {new Date(Number(o.seenAt)).toLocaleTimeString()}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-2.5 align-top space-y-1.5">
                            <div>
                              <div className="font-bold">{o.title}</div>
                              <div className={textMuted}>{o.message}</div>
                              <div className={`text-[10px] ${textMuted} mt-0.5`}>
                                🔊 Sound: {getSoundLabel(o.soundUrl)}
                              </div>
                            </div>

                            {/* Options Given on this Overlay */}
                            <div className="pt-0.5">
                              <div className={`text-[10px] font-semibold ${textMuted} mb-1`}>
                                Options Given on Overlay:
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {btns.map((b, bi) => {
                                  const usersWhoChoseThis = parsedResponses.filter(
                                    (r) =>
                                      r.action !== 'closed_x' &&
                                      (r.label === b.label ||
                                        (!r.label && r.action === b.action) ||
                                        (r.label === r.action && r.action === b.action))
                                  );
                                  const isThisChosen = usersWhoChoseThis.length > 0;
                                  return (
                                    <span
                                      key={bi}
                                      className={`px-2 py-0.5 rounded-lg text-[10px] font-medium border flex items-center gap-1 ${
                                        isThisChosen
                                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 font-bold shadow-sm'
                                          : `${borderCol} ${textMuted}`
                                      }`}
                                    >
                                      <span>
                                        {bi + 1}. {b.label}
                                      </span>
                                      <span className="opacity-70">({b.action})</span>
                                      {isThisChosen && (
                                        <span className="ml-0.5 px-1.5 py-0.2 rounded bg-emerald-500 text-[var(--admin-primary-text)] text-[9px] font-extrabold">
                                          ✓ {usersWhoChoseThis.map((u) => u.userName).join(', ')}
                                        </span>
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                          <td className="py-2 px-2.5 text-[11px] align-top">
                            {parsedResponses.length > 0 ? (
                              <div className="space-y-1.5">
                                {parsedResponses.map((resp, ri) => {
                                  const isClosed = resp.action === 'closed_x';
                                  const matchedBtn =
                                    !isClosed
                                      ? btns.find(
                                          (b) => b.label === resp.label || b.action === resp.action
                                        )
                                      : null;
                                  const displayChoice =
                                    resp.label && resp.label !== resp.action
                                      ? resp.label
                                      : matchedBtn?.label || resp.label || resp.action;

                                  return (
                                    <div
                                      key={ri}
                                      className={`p-2 rounded-xl border ${
                                        isClosed
                                          ? 'bg-amber-500/15 border-amber-400/40 text-amber-200'
                                          : 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                                      }`}
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-1">
                                        <span className="font-extrabold text-[var(--admin-text)] text-[11.5px]">
                                          👤 {resp.userName}
                                        </span>
                                        {resp.timestamp && (
                                          <span className="text-[9.5px] opacity-80">
                                            {new Date(resp.timestamp).toLocaleTimeString()}
                                          </span>
                                        )}
                                      </div>
                                      <div className="font-bold text-[11px] mt-0.5">
                                        {isClosed
                                          ? '✕ Closed Popup (No option selected)'
                                          : `💖 Selected: "${displayChoice}"`}
                                      </div>
                                      {!isClosed && resp.action && (
                                        <div className="text-[9.5px] opacity-80 mt-0.5">
                                          Action Triggered: <span className="font-semibold">{resp.action}</span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : isReplaced ? (
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border ${borderCol} ${textMuted}`}>
                                ⏭️ Auto-Dismissed (Replaced by New Overlay)
                              </span>
                            ) : o.dismissed ? (
                              <span className={`px-2 py-0.5 rounded-full border ${borderCol}`}>
                                DISMISSED
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-pink-500/15 border border-pink-400/40 text-pink-300 font-semibold">
                                ⏳ Pending (Waiting for {isBroadcast ? 'user response' : `${targetDisplay}'s choice`})
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2.5 text-right space-x-1 align-top whitespace-nowrap">
                            <button
                              onClick={() => {
                                const now = Date.now();
                                const resendTarget = o.targetUser || 'ALL';
                                const pendingOld = overlaysList.filter(
                                  (ov) =>
                                    !ov.dismissed &&
                                    (!ov.scheduledFor || ov.scheduledFor <= now) &&
                                    (resendTarget === 'ALL' || (ov.targetUser || 'ALL') === resendTarget)
                                );
                                void Promise.all(
                                  pendingOld.map((oldOv) => {
                                    const hasExistingResponse =
                                      Boolean(oldOv.clickedAction) &&
                                      oldOv.clickedAction !== 'replaced_by_new_overlay';
                                    return updateDoc(
                                      doc(db, 'overlays', oldOv.id),
                                      hasExistingResponse
                                        ? { dismissed: true }
                                        : {
                                            dismissed: true,
                                            clickedAction: 'replaced_by_new_overlay',
                                            seenAt: now,
                                          }
                                    ).catch(() => {});
                                  })
                                );
                                notifyStatus(`Overlay resent to ${targetDisplay}.`);
                                void addDoc(collection(db, 'overlays'), {
                                  title: o.title,
                                  message: o.message,
                                  imageUrl: o.imageUrl || '',
                                  theme: o.theme || ovTheme,
                                  fontStyle: o.fontStyle || ovFontStyle,
                                  soundUrl:
                                    o.soundUrl !== undefined
                                      ? o.soundUrl
                                      : ovSoundUrl === 'silent'
                                      ? ''
                                      : ovSoundUrl,
                                  buttons: o.buttons || [],
                                  targetUser: o.targetUser || 'ALL',
                                  targetUserName: o.targetUserName || 'All Users',
                                  targetUserEmail: o.targetUserEmail || '',
                                  targetUserUid: o.targetUserUid || '',
                                  createdAt: Date.now(),
                                  status: 'sent',
                                  dismissed: false,
                                }).catch((err: any) => notifyStatus(`Resend error: ${err.message}`, true));
                              }}
                              className={btnSecondary}
                            >
                              Resend
                            </button>
                            <button
                              onClick={() =>
                                askConfirm('Delete this overlay record?', () => {
                                  setOverlaysList((prev) => prev.filter((x) => x.id !== o.id));
                                  notifyStatus('Overlay record deleted.');
                                  void deleteDoc(doc(db, 'overlays', o.id)).catch(() => {});
                                })
                              }
                              className={btnDanger}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 8. CONTENT EDITOR */}
          {activeSection === 'content' && (
            <div className="space-y-4">
              <div className={`flex items-center justify-between border-b ${borderCol} pb-2`}>
                <h2 className="text-[13px] font-bold uppercase tracking-wider">8. Live Content Editor</h2>
                <button onClick={handleSaveContentEditor} className={btnPrimary}>
                  Save All Content Live
                </button>
              </div>

              {/* Core Info & Countdown Date */}
              <div className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} grid grid-cols-1 sm:grid-cols-3 gap-2.5`}>
                <div>
                  <label className={`block text-[11px] ${textMuted} mb-1`}>Recipient Name</label>
                  <input
                    type="text"
                    value={editRecipientName}
                    onChange={(e) => setEditRecipientName(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={`block text-[11px] ${textMuted} mb-1`}>
                    Countdown Date (17 December · YYYY-MM-DD)
                  </label>
                  <input
                    type="date"
                    value={editCountdownDate}
                    onChange={(e) => setEditCountdownDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={`block text-[11px] ${textMuted} mb-1`}>Home Welcome Message</label>
                  <input
                    type="text"
                    value={editHomeMessage}
                    onChange={(e) => setEditHomeMessage(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Secret Letter */}
              <div className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-1.5`}>
                <label className="block font-bold text-[12px]">Secret Letter Content</label>
                <textarea
                  rows={4}
                  value={editSecretLetter}
                  onChange={(e) => setEditSecretLetter(e.target.value)}
                  placeholder="Write her secret letter message..."
                  className={inputCls}
                />
              </div>

              {/* Name Meanings (K-A-S-H-I-S-H) */}
              <div className={`p-3 rounded-[14px] border ${borderCol} space-y-2`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-[12px]">Name Meanings (K-A-S-H-I-S-H)</div>
                  {editNameMeanings.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDeleteAllNameMeanings}
                      className={`${btnDanger} text-[11px] text-rose-400`}
                    >
                      <Trash2 className="w-3 h-3 inline mr-1" />
                      Clear All Letters
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {editNameMeanings.map((nm, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                      <input
                        type="text"
                        value={nm.char}
                        onChange={(e) => {
                          const next = [...editNameMeanings];
                          next[idx] = { ...next[idx], char: e.target.value };
                          setEditNameMeanings(next);
                        }}
                        className={`${inputCls} col-span-2 sm:col-span-1 text-center font-bold`}
                      />
                      <input
                        type="text"
                        value={nm.title}
                        onChange={(e) => {
                          const next = [...editNameMeanings];
                          next[idx] = { ...next[idx], title: e.target.value };
                          setEditNameMeanings(next);
                        }}
                        className={`${inputCls} col-span-4 sm:col-span-3`}
                      />
                      <input
                        type="text"
                        value={nm.desc}
                        onChange={(e) => {
                          const next = [...editNameMeanings];
                          next[idx] = { ...next[idx], desc: e.target.value };
                          setEditNameMeanings(next);
                        }}
                        className={`${inputCls} col-span-6 sm:col-span-8`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Game Compliments / Wheel Content */}
              <div className={`p-3 rounded-[14px] border ${borderCol} space-y-2`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-[12px]">
                    Game Content / Spin Wheel Compliments ({editCompliments.length})
                  </div>
                  {editCompliments.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDeleteAllCompliments}
                      className={`${btnDanger} text-[11px] text-rose-400`}
                    >
                      <Trash2 className="w-3 h-3 inline mr-1" />
                      Delete All Compliments ({editCompliments.length})
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {editCompliments.map((c, idx) => (
                    <div key={idx} className="flex gap-1.5">
                      <input
                        type="text"
                        value={c}
                        onChange={(e) => {
                          const next = [...editCompliments];
                          next[idx] = e.target.value;
                          setEditCompliments(next);
                        }}
                        className={inputCls}
                      />
                      <button
                        onClick={() => setEditCompliments(editCompliments.filter((_, i) => i !== idx))}
                        className={btnDanger}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5 pt-1">
                  <input
                    type="text"
                    placeholder="Add new game compliment / prompt..."
                    value={newCompliment}
                    onChange={(e) => setNewCompliment(e.target.value)}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newCompliment.trim()) return;
                      setEditCompliments([...editCompliments, newCompliment.trim()]);
                      setNewCompliment('');
                    }}
                    className={btnSecondary}
                  >
                    + Add
                  </button>
                </div>
              </div>

              <button onClick={handleSaveContentEditor} className={btnPrimary}>
                Save All Content Changes
              </button>
            </div>
          )}

          {/* 10. APP CONTROL */}
          {activeSection === 'control' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b ${borderCol} pb-3`}>
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold uppercase tracking-widest text-[var(--admin-text)]">
                    9. Remote App Control
                  </h2>
                  <p className={`text-[11px] ${textMuted} mt-1`}>
                    Toggle features and manage remote lock/maintenance modes.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <div className={`px-3 py-1.5 rounded-full border ${maintMode ? 'border-amber-500/50 bg-amber-500/10 text-amber-400' : `${borderCol} bg-[var(--admin-card)] ${textMuted}`} text-[10px] font-bold uppercase tracking-widest`}>
                    {maintMode ? '⚠️ Maintenance On' : '✅ App Online'}
                  </div>
                </div>
              </div>

              <div className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-3`}>
                <div className="font-bold text-[12px]">Toggle App Features On / Off Remotely</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { label: 'Games Section', val: featGames, set: setFeatGames },
                    { label: 'Gallery Upload', val: featGalleryUpload, set: setFeatGalleryUpload },
                    { label: 'Send Hug Button', val: featHug, set: setFeatHug },
                    { label: 'Direct Call Button', val: featCall, set: setFeatCall },
                    { label: 'Voice Note Button', val: featVoiceNote, set: setFeatVoiceNote },
                  ].map((f, i) => (
                    <label
                      key={i}
                      className={`p-2 rounded-[12px] border ${borderCol} flex items-center justify-between cursor-pointer`}
                    >
                      <span>{f.label}</span>
                      <input
                        type="checkbox"
                        checked={f.val}
                        onChange={(e) => f.set(e.target.checked)}
                      />
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>
                      Direct Call Phone Number
                    </label>
                    <input
                      type="text"
                      value={callNumberInput}
                      onChange={(e) => setCallNumberInput(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>
                      Entry Lock Password (Optional Override)
                    </label>
                    <input
                      type="text"
                      value={lockPasswordInput}
                      onChange={(e) => setLockPasswordInput(e.target.value)}
                      placeholder="Leave empty for Firebase Auth"
                      className={inputCls}
                    />
                  </div>
                </div>

                <div className={`pt-2 border-t ${borderCol} space-y-2.5`}>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={maintMode}
                        onChange={(e) => setMaintMode(e.target.checked)}
                      />
                      <span>Maintenance Mode (Shows maintenance / update screen to her)</span>
                    </label>

                    <label className="flex items-center gap-2 font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={forceLockMode}
                        onChange={(e) => setForceLockMode(e.target.checked)}
                      />
                      <span>Force Lock Screen Immediately</span>
                    </label>
                  </div>

                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Maintenance Message</label>
                    <input
                      type="text"
                      value={maintMessage}
                      onChange={(e) => setMaintMessage(e.target.value)}
                      placeholder="e.g. New update available! Please download the updated app below to continue."
                      className={inputCls}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className={`block text-[11px] ${textMuted}`}>
                          Maintenance Screen Link (Updated APK Link — Optional)
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setMaintLinkUrl(
                              'https://github.com/sivam1100-creator/Kashish-World/releases/download/latest-apk/Kashishhh.apk'
                            )
                          }
                          className="text-[10px] text-pink-400 hover:underline font-bold cursor-pointer"
                        >
                          + Fill GitHub Release APK Link
                        </button>
                      </div>
                      <input
                        type="text"
                        value={maintLinkUrl}
                        onChange={(e) => setMaintLinkUrl(e.target.value)}
                        placeholder="https://github.com/.../releases/download/latest-apk/Kashishhh.apk"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={`block text-[11px] ${textMuted} mb-1`}>
                        Link Button Text (Shown when link is added)
                      </label>
                      <input
                        type="text"
                        value={maintLinkLabel}
                        onChange={(e) => setMaintLinkLabel(e.target.value)}
                        placeholder="Download Updated App (Kashishhh.apk) 💖"
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>

                <button onClick={handleSaveAppControl} className={btnPrimary}>
                  Save App Control Settings
                </button>
              </div>

              {/* Mandatory APK Force Update & GitHub Release Gate */}
              <div className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-3`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-[12px] text-pink-400">
                      📲 Mandatory APK Update & GitHub Release Gate
                    </div>
                    <div className={`text-[11px] ${textMuted}`}>
                      Whenever a new release is published or Force Update is enabled, the app displays a mandatory update prompt until the latest APK is installed.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="px-2 py-1 rounded-lg bg-pink-500/15 border border-pink-500/30 font-semibold">
                      Her Installed APK: v{deviceStatusDoc?.appVersion || '3.0.0'}{deviceStatusDoc?.appVersionCode ? ` (#${deviceStatusDoc.appVersionCode})` : ''}
                    </span>
                    <span className="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold">
                      Latest Release: v{liveCiApkMeta?.version || apkLatestVer}{liveCiApkMeta?.versionCode ? ` (#${liveCiApkMeta.versionCode})` : ''}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className={`p-2.5 rounded-[12px] border ${borderCol} flex items-center justify-between gap-2 cursor-pointer`}>
                    <div>
                      <div className="font-bold text-[11px]">Force Update Required</div>
                      <div className={`text-[10px] ${textMuted}`}>Blocks app if version is older</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={apkUpdateReq}
                      onChange={(e) => setApkUpdateReq(e.target.checked)}
                    />
                  </label>

                  <label className={`p-2.5 rounded-[12px] border ${borderCol} flex items-center justify-between gap-2 cursor-pointer`}>
                    <div>
                      <div className="font-bold text-[11px]">Auto-Update on GitHub Release</div>
                      <div className={`text-[10px] ${textMuted}`}>Auto-prompts on new CI APK</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={apkAutoPush}
                      onChange={(e) => setApkAutoPush(e.target.checked)}
                    />
                  </label>

                  <label className={`p-2.5 rounded-[12px] border ${borderCol} flex items-center justify-between gap-2 cursor-pointer`}>
                    <div>
                      <div className="font-bold text-[11px]">Test / Show on Website Too</div>
                      <div className={`text-[10px] ${textMuted}`}>Preview update gate on web</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={apkApplyWeb}
                      onChange={(e) => setApkApplyWeb(e.target.checked)}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label className={`block text-[11px] ${textMuted}`}>
                        Required Latest APK Version
                      </label>
                      <button
                        type="button"
                        onClick={async () => {
                          const info = await fetchLatestReleaseApkInfo();
                          if (info) {
                            setLiveCiApkMeta(info);
                            setApkLatestVer(info.version);
                            setApkUrlInput(info.apkUrl);
                            notifyStatus(`Synced version v${info.version} from GitHub Releases!`);
                          } else {
                            notifyStatus('Could not fetch GitHub Release version right now.', true);
                          }
                        }}
                        className="text-[10px] text-pink-400 hover:underline font-bold cursor-pointer"
                      >
                        ↻ Sync from GitHub Release
                      </button>
                    </div>
                    <input
                      type="text"
                      value={apkLatestVer}
                      onChange={(e) => setApkLatestVer(e.target.value)}
                      placeholder="3.0.45"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>
                      Direct APK Download URL (GitHub Release Kashishhh.apk)
                    </label>
                    <input
                      type="text"
                      value={apkUrlInput}
                      onChange={(e) => setApkUrlInput(e.target.value)}
                      placeholder="https://github.com/sivam1100-creator/Kashish-World/releases/download/latest-apk/Kashishhh.apk"
                      className={inputCls}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>
                      Update Screen Title
                    </label>
                    <input
                      type="text"
                      value={apkTitleInput}
                      onChange={(e) => setApkTitleInput(e.target.value)}
                      placeholder="New Update Available for Kashishhh 💖"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>
                      Update Message / What's New
                    </label>
                    <input
                      type="text"
                      value={apkNotesInput}
                      onChange={(e) => setApkNotesInput(e.target.value)}
                      placeholder="A new version of your special app is ready! Please download & install the update below."
                      className={inputCls}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={handleSaveAppControl} className={btnPrimary}>
                    Save Update Gate Settings
                  </button>
                  <button
                    type="button"
                    onClick={handleForcePushApkUpdateAndNotify}
                    className={btnSecondary}
                  >
                    🚀 Force Push Update & Send Push Alert to Her Phone
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 11. SETTINGS & SETUP */}
          {activeSection === 'settings' && (
            <div className="space-y-4">
              <div className={`border-b ${borderCol} pb-2`}>
                <h2 className="text-[13px] font-bold uppercase tracking-wider">
                  11. Settings, Backup & Firebase Rules
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Change Admin Password */}
                <div className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-2`}>
                  <div className="font-bold text-[12px]">Change Admin Password</div>
                  <input
                    type="password"
                    placeholder="New password (min 6 chars)"
                    value={newAdminPassword}
                    onChange={(e) => setNewAdminPassword(e.target.value)}
                    className={inputCls}
                  />
                  <button
                    onClick={async () => {
                      if (!auth.currentUser || newAdminPassword.length < 6) {
                        notifyStatus('Password must be at least 6 characters.', true);
                        return;
                      }
                      try {
                        await updatePassword(auth.currentUser, newAdminPassword);
                        setNewAdminPassword('');
                        notifyStatus('Admin password updated.');
                      } catch (err: any) {
                        notifyStatus(`Password error: ${err.message}`, true);
                      }
                    }}
                    className={btnPrimary}
                  >
                    Update Password
                  </button>
                </div>

                {/* Data Backup & Clear Logs */}
                <div className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-2`}>
                  <div className="font-bold text-[12px]">Backup & Maintenance</div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button onClick={handleExportFullBackupJson} className={btnPrimary}>
                      <Download className="w-3 h-3 inline mr-1" />
                      Backup All Data (JSON Export)
                    </button>
                    <button onClick={handleClearActivityLogs} className={btnDanger}>
                      Clear All Activity Logs
                    </button>
                  </div>
                </div>
              </div>

              {/* Cloudinary Free Storage Configuration in Settings */}
              <form
                onSubmit={handleSaveAndTestCloudinary}
                className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-2.5`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-[12px]">
                    Cloudinary Free Storage (25 GB Free Tier · Upload + Permanent Delete)
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${borderCol}`}>
                    {isCloudinaryReady
                      ? `CONNECTED: ${cloudNameInput.trim()} (${isCloudinaryDeleteReady ? 'UPLOAD + DELETE' : 'UPLOAD ONLY'})`
                      : 'FIRESTORE FALLBACK MODE'}
                  </span>
                </div>
                <p className={`text-[11px] ${textMuted}`}>
                  <b>Upload</b> uses your Unsigned Upload Preset (`Unsigned Upload Preset Name`). To also <b>permanently delete files from Cloudinary</b> when you click Delete in the Admin Panel, paste your <b>API Key</b> and <b>API Secret</b> (found in <b>Cloudinary Dashboard → Settings ⚙️ → API Keys</b>).
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Cloudinary Cloud Name</label>
                    <input
                      type="text"
                      value={cloudNameInput}
                      onChange={(e) => setCloudNameInput(e.target.value)}
                      placeholder="dsfcu9y1h"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Unsigned Upload Preset</label>
                    <input
                      type="text"
                      value={uploadPresetInput}
                      onChange={(e) => setUploadPresetInput(e.target.value)}
                      placeholder="Unsigned Upload Preset Name"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>API Key (For Delete)</label>
                    <input
                      type="text"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="e.g. 123456789012345"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>API Secret (For Delete)</label>
                    <input
                      type="password"
                      value={apiSecretInput}
                      onChange={(e) => setApiSecretInput(e.target.value)}
                      placeholder="Your Cloudinary API Secret"
                      className={inputCls}
                    />
                  </div>
                  <button type="submit" disabled={testingCloudinary} className={btnPrimary}>
                    {testingCloudinary ? 'Testing & Saving...' : 'Save & Test'}
                  </button>
                </div>
                {cloudinaryStatusMsg && (
                  <div className={`text-[11px] ${textMuted}`}>{cloudinaryStatusMsg}</div>
                )}
              </form>

              {/* Complete Setup & Security Rules Reference */}
              <div className={`p-3 rounded-[14px] border ${borderCol} space-y-2`}>
                <div className="font-bold text-[12px]">
                  Firebase Configuration & 100% Free-Tier (Firestore + Cloudinary) Setup
                </div>
                <p className={`text-[11px] ${textMuted}`}>
                  Config keys are located in <code>src/firebase.ts</code> (Project: <b>{firebaseConfig.projectId}</b>, Admin: <b>{ADMIN_EMAIL}</b>).
                  Firebase Storage is <b>NOT required</b> — all photos, voice notes, and sounds are automatically compressed/chunked and stored 100% free inside Firestore!
                </p>
                <pre className={`p-2.5 rounded-[14px] border ${borderCol} ${bgSubtle} text-[11px] overflow-x-auto`}>
{`// firestore.rules (Paste in Firebase Console -> Firestore -> Rules)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.email == '${ADMIN_EMAIL}';
    }
    function isSignedIn() { return request.auth != null; }

    match /media/{id} {
      allow read: if isSignedIn();
      allow create: if isAdmin() || (isSignedIn() && request.resource.data.uploadedBy == 'her');
      allow update: if isAdmin() || (isSignedIn() && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['views', 'likes']));
      allow delete: if isAdmin();
    }
    match /sections/{id} { allow read: if isSignedIn(); allow write: if isAdmin(); }
    match /content/{id} { allow read: if isSignedIn(); allow write: if isAdmin(); }
    match /inbox/{id} {
      allow read: if isAdmin() || (isSignedIn() && resource.data.senderUid == request.auth.uid);
      allow create: if isSignedIn();
      allow update, delete: if isAdmin();
    }
    match /activity/{id} { allow read, update, delete: if isAdmin(); allow create: if isSignedIn(); }
    match /notifications/{id} { allow read: if true; allow update: if isAdmin() || request.resource.data.diff(resource.data).affectedKeys().hasOnly(['seen', 'seenAt']); allow create, delete: if isAdmin(); }
    match /overlays/{id} { allow read: if true; allow update: if isAdmin() || request.resource.data.diff(resource.data).affectedKeys().hasOnly(['dismissed', 'clickedAction', 'seenAt']); allow create, delete: if isAdmin(); }
    match /settings/{id} { allow read: if isSignedIn() || id == 'device_status'; allow create, update: if isAdmin() || id == 'device_status' || (isSignedIn() && id == 'stats'); allow delete: if isAdmin(); }
    match /users/{userId} {
      allow read: if isAdmin() || (isSignedIn() && request.auth.uid == userId);
      allow create: if isAdmin() || (isSignedIn() && request.auth.uid == userId && request.resource.data.get('approved', false) == false);
      allow update: if isAdmin() || (isSignedIn() && request.auth.uid == userId && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['approved', 'status', 'role']));
      allow delete: if isAdmin();
    }
  }
}`}
                </pre>
              </div>
            </div>
          )}

          {/* 12. CONTACTS CLOUD VAULT */}
          {activeSection === 'contacts' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b ${borderCol} pb-3`}>
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold uppercase tracking-widest text-[var(--admin-text)] flex items-center gap-2">
                    <BookUser className={`w-5 h-5 ${textMuted}`} />
                    12. Contacts Cloud Vault
                  </h2>
                  <p className={`text-[11px] ${textMuted} mt-1`}>
                    Safely back up her phone contacts to your private cloud.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <div className={`px-3 py-1.5 rounded-full border ${borderCol} bg-[var(--admin-card)] text-[10px] font-bold uppercase tracking-widest ${textMuted}`}>
                    {contactsList.length} Contacts Synced
                  </div>
                </div>
              </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={handleManualSyncContacts}
                    disabled={syncingContacts}
                    className={btnPrimary}
                    title="Read contacts from Kashish's Android phone and sync to cloud"
                  >
                    <RefreshCw className={`w-3 h-3 inline mr-1 ${syncingContacts ? 'animate-spin' : ''}`} />
                    {syncingContacts ? 'Syncing...' : 'Sync Device Contacts'}
                  </button>

                  <button
                    onClick={handleExportVcf}
                    disabled={contactsList.length === 0}
                    className={btnSecondary}
                    title="Download contacts as standard vCard 3.0 file"
                  >
                    <Download className="w-3 h-3 inline mr-1" />
                    Export VCF (.vcf)
                  </button>

                  <button
                    onClick={handleExportCsv}
                    disabled={contactsList.length === 0}
                    className={btnSecondary}
                    title="Download contacts as CSV spreadsheet"
                  >
                    <Download className="w-3 h-3 inline mr-1" />
                    Export CSV (.csv)
                  </button>

                  {contactsList.length > 0 && (
                    <button
                      onClick={handleDeleteAllContacts}
                      className={btnDanger}
                      title="Permanently wipe all contacts from cloud vault"
                    >
                      <Trash2 className="w-3 h-3 inline mr-1" />
                      Delete All ({contactsList.length})
                    </button>
                  )}
                </div>

              {/* Information / Sync Status Info Box */}
              <div className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} flex flex-wrap items-center justify-between gap-2`}>
                <div className="space-y-0.5">
                  <div className="text-[12px] font-semibold flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5" />
                    Automatic Background Cloud Sync Enabled
                  </div>
                  <p className={`text-[11px] ${textMuted}`}>
                    Whenever Kashish opens her Android app, her phone contacts are automatically read and safely backed up to this private Firestore vault. You can also trigger a manual sync or export them anytime.
                  </p>
                </div>
                <div className={`text-[11px] ${textMuted} font-mono shrink-0`}>
                  Collection: <span className="underline">contacts</span>
                </div>
              </div>

              {/* Filter, Search & Sort Toolbar */}
              <div className={`p-2.5 rounded-[14px] border ${borderCol} ${bgSubtle} flex flex-wrap items-center justify-between gap-2`}>
                <div className="flex-1 min-w-[200px] relative">
                  <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${textMuted}`} />
                  <input
                    type="text"
                    value={contactsSearch}
                    onChange={(e) => {
                      setContactsSearch(e.target.value);
                      try {
                        localStorage.setItem('kashish_admin_contacts_search', e.target.value);
                      } catch {}
                    }}
                    placeholder="Search contacts by name, number, or email..."
                    className={`${inputCls} pl-8`}
                  />
                  {contactsSearch && (
                    <button
                      onClick={() => {
                        setContactsSearch('');
                        try {
                          localStorage.removeItem('kashish_admin_contacts_search');
                        } catch {}
                      }}
                      className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] ${textMuted} hover:text-[var(--admin-text)]`}
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <label className={`text-[11px] ${textMuted} whitespace-nowrap`}>Sort by:</label>
                  <select
                    value={contactsSort}
                    onChange={(e) => {
                      const val = e.target.value as 'name' | 'recent';
                      setContactsSort(val);
                      try {
                        localStorage.setItem('kashish_admin_contacts_sort', val);
                      } catch {}
                    }}
                    className={`px-2 py-1 text-[12px] rounded-[10px] border ${borderCol} bg-[var(--admin-input-bg)] text-[var(--admin-text)]`}
                  >
                    <option value="name">Name (A → Z)</option>
                    <option value="recent">Recently Synced</option>
                  </select>
                  <span className={`text-[11px] ${textMuted} whitespace-nowrap`}>
                    Showing {filteredContacts.length} of {contactsList.length}
                  </span>
                </div>
              </div>

              {/* Contacts Grid / Table List */}
              {filteredContacts.length === 0 ? (
                <div className={`p-8 rounded-[14px] border ${borderCol} ${bgSubtle} text-center space-y-2`}>
                  <BookUser className={`w-8 h-8 mx-auto ${textMuted}`} />
                  <div className="text-[13px] font-bold">
                    {contactsList.length === 0 ? 'No Phone Contacts Synced Yet' : 'No Matching Contacts Found'}
                  </div>
                  <p className={`text-[11px] ${textMuted} max-w-md mx-auto`}>
                    {contactsList.length === 0
                      ? 'When Kashish opens the app on her phone with contacts permission granted, her contacts will automatically appear here. You can also tap "Sync Device Contacts" above.'
                      : 'Try adjusting your search query or sorting method.'}
                  </p>
                  {contactsList.length === 0 && (
                    <button onClick={handleManualSyncContacts} disabled={syncingContacts} className={`${btnPrimary} mt-2`}>
                      <RefreshCw className={`w-3 h-3 inline mr-1 ${syncingContacts ? 'animate-spin' : ''}`} />
                      Trigger Sync Now
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {filteredContacts.map((c) => {
                    const initials = (c.name || 'U')
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p: string) => p[0]?.toUpperCase())
                      .join('') || '#';
                    const isCopied = copiedNumber === (c.cleanNumber || c.phoneNumber);
                    const cleanPhone = (c.cleanNumber || c.phoneNumber || '').replace(/[^\d+]/g, '');

                    return (
                      <div
                        key={c.id}
                        className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} flex flex-col justify-between gap-2.5 transition-colors hover:border-[var(--admin-primary)]`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0">
                            {/* Avatar */}
                            <div
                              className={`w-9 h-9 shrink-0 rounded-full border ${borderCol} bg-[var(--admin-bg)] text-[var(--admin-text)] flex items-center justify-center font-bold text-[12px] tracking-tight`}
                            >
                              {initials}
                            </div>

                            <div className="min-w-0">
                              <div className="font-bold text-[12px] flex items-center gap-1.5 truncate">
                                <span className="truncate">{c.name || 'Unnamed Contact'}</span>
                                {c.starred && (
                                  <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
                                )}
                              </div>

                              {/* Phone Number */}
                              <div className="text-[12px] font-mono tabular-nums text-[var(--admin-text)] mt-0.5 flex items-center gap-1.5">
                                <Phone className="w-3 h-3 shrink-0 text-emerald-400" />
                                <span className="truncate">{c.phoneNumber || c.cleanNumber || 'No number'}</span>
                              </div>

                              {/* Optional Emails */}
                              {Array.isArray(c.emails) && c.emails.length > 0 && (
                                <div className={`text-[11px] ${textMuted} flex items-center gap-1 truncate mt-0.5`}>
                                  <Mail className="w-3 h-3 shrink-0" />
                                  <span className="truncate">{c.emails.join(', ')}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Delete Contact Button */}
                          <button
                            onClick={() => handleDeleteContact(c)}
                            title="Delete this contact"
                            className={`p-1.5 rounded-[8px] border ${borderCol} bg-[var(--admin-bg)] hover:bg-[var(--admin-card-hover)] text-[var(--admin-text-muted)] hover:text-red-400`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Bottom Row: Actions & Metadata */}
                        <div className={`pt-2 border-t ${borderCol} flex flex-wrap items-center justify-between gap-1.5 text-[11px]`}>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleCopyNumber(c.phoneNumber || c.cleanNumber || '')}
                              className={`px-2 py-0.5 rounded-[8px] border ${borderCol} text-[11px] flex items-center gap-1 ${
                                isCopied ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : btnSecondary
                              }`}
                              title="Copy phone number"
                            >
                              {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              <span>{isCopied ? 'Copied!' : 'Copy'}</span>
                            </button>

                            {cleanPhone && (
                              <a
                                href={`tel:${cleanPhone}`}
                                className={`px-2 py-0.5 rounded-[8px] border ${borderCol} ${btnSecondary} flex items-center gap-1`}
                                title="Call directly"
                              >
                                <Phone className="w-3 h-3" />
                                <span>Call</span>
                              </a>
                            )}

                            {cleanPhone && (
                              <a
                                href={`https://wa.me/${cleanPhone.replace('+', '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`px-2 py-0.5 rounded-[8px] border ${borderCol} ${btnSecondary} flex items-center gap-1`}
                                title="Chat on WhatsApp"
                              >
                                <MessageSquare className="w-3 h-3" />
                                <span>WA</span>
                              </a>
                            )}
                          </div>

                          <div className={`text-[10px] ${textMuted} truncate font-mono`} title={c.deviceModel || 'Android'}>
                            {c.deviceModel ? c.deviceModel.split(' ')[0] : 'Device'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Media Preview Modal */}
      {previewMedia && (
        <div className="fixed inset-0 z-[2100] bg-[var(--admin-modal-backdrop)] backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`max-w-lg w-full rounded-[14px] border ${borderCol} bg-[var(--admin-card)] text-[var(--admin-text)] p-3 space-y-2 shadow-2xl`}>
            <div className="flex items-center justify-between">
              <span className="font-bold truncate">{previewMedia.name || 'Preview'}</span>
              <button onClick={() => setPreviewMedia(null)} className={btnSecondary}>
                Close
              </button>
            </div>
            <div className={`max-h-[70vh] rounded-[12px] overflow-hidden flex items-center justify-center bg-[var(--admin-bg)] border ${borderCol}`}>
              {previewMedia.type === 'video' ? (
                <video src={previewMedia.url} controls autoPlay className="max-h-[68vh] w-auto rounded-[12px]" />
              ) : (
                <img src={previewMedia.url} alt="" className="max-h-[68vh] w-auto object-contain rounded-[12px]" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog Modal before any Delete */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[2200] bg-[var(--admin-modal-backdrop)] backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`max-w-xs w-full rounded-[14px] border ${borderCol} bg-[var(--admin-card)] text-[var(--admin-text)] p-4 space-y-3 shadow-2xl`}>
            <div className="font-bold text-[13px]">Confirm Action</div>
            <p className={`text-[12px] ${textMuted}`}>{confirmDialog.message}</p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setConfirmDialog(null)} className={btnSecondary}>
                Cancel
              </button>
              <button
                onClick={async () => {
                  const fn = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  await fn();
                }}
                className={btnPrimary}
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
