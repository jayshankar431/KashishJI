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
} from '../androidBridge';
import {
  useSite,
  useSiteOverrides,
  DEFAULT_NAME_MEANINGS,
  DEFAULT_POEMS,
  DEFAULT_SAVED_SOUNDS,
  NameLetterMeaning,
  Poem,
  PopupButtonAction,
  PopupButtonItem,
  SavedMusicTrack,
} from '../siteContent';
import { CONFIG } from '../config';
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
  Music,
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
  | 'sections'
  | 'content'
  | 'music'
  | 'control'
  | 'settings';

const SIDEBAR_ITEMS: { id: AdminSectionId; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'dashboard', label: '1. Dashboard', icon: LayoutDashboard },
  { id: 'users', label: 'User Approvals', icon: UserCheck },
  { id: 'activity', label: '2. Activity Tracker', icon: Activity },
  { id: 'media', label: '3. Media Manager', icon: ImageIcon },
  { id: 'inbox', label: '4. Inbox (From Her)', icon: Inbox },
  { id: 'notifications', label: '5. Notification Sender', icon: Bell },
  { id: 'overlays', label: '6. Overlay Popup Sender', icon: Layers },
  { id: 'sections', label: '7. Sections Manager', icon: FolderKanban },
  { id: 'content', label: '8. Content Editor', icon: FileEdit },
  { id: 'music', label: '9. Music Manager', icon: Music },
  { id: 'control', label: '10. App Control', icon: Sliders },
  { id: 'settings', label: '11. Settings & Rules', icon: Settings },
];

const MEDIA_CATEGORIES = ['Gallery', 'Secret Photos', 'Open When', 'Home photo', 'Uploads From Her'] as const;

export const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose }) => {
  const site = useSite();

  // Theme & Layout State
  const [dark, setDark] = useState<boolean>(true);
  const [activeSection, setActiveSection] = useState<AdminSectionId>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

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
  const [sectionsList, setSectionsList] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
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

  // Section 5: Notification Sender State
  const [notifTitle, setNotifTitle] = useState<string>('');
  const [notifMessage, setNotifMessage] = useState<string>('');
  const [notifImage, setNotifImage] = useState<string>('');
  const [notifSoundUrl, setNotifSoundUrl] = useState<string>(DEFAULT_SAVED_SOUNDS[0].url);
  const [notifScheduleTime, setNotifScheduleTime] = useState<string>('');
  const [notifButtons, setNotifButtons] = useState<PopupButtonItem[]>([
    { label: 'Call Me Now 📞', action: 'call_now', payload: '9817905531' },
    { label: 'Open Our Gallery ✨', action: 'open_section', payload: 'gallery' },
  ]);
  const [customSounds, setCustomSounds] = useState<{ id?: string; name: string; url: string }[]>(() => {
    const saved = site.savedSounds || [];
    const defaultUrls = new Set(DEFAULT_SAVED_SOUNDS.map((d) => d.url));
    return saved.filter((s) => s.url && !defaultUrls.has(s.url));
  });
  const [uploadingSound, setUploadingSound] = useState<boolean>(false);
  const [previewingSoundUrl, setPreviewingSoundUrl] = useState<string>('');

  // Section 6: Overlay Popup Sender State
  const [ovTitle, setOvTitle] = useState<string>('Thinking of You, Kashish');
  const [ovMessage, setOvMessage] = useState<string>('Just wanted to remind you how special you are to me. Tap below whenever you want to talk!');
  const [ovImage, setOvImage] = useState<string>('');
  const [ovTheme, setOvTheme] = useState<OverlayThemeId>('velvet-rose');
  const [ovFontStyle, setOvFontStyle] = useState<OverlayFontId>('romantic-serif');
  const [ovSoundUrl, setOvSoundUrl] = useState<string>(DEFAULT_SAVED_SOUNDS[0].url);
  const [ovScheduleTime, setOvScheduleTime] = useState<string>('');
  const [ovButtons, setOvButtons] = useState<PopupButtonItem[]>([
    { label: 'Call Me Now', action: 'call_now', payload: '9817905531' },
    { label: 'Open Our Gallery', action: 'open_section', payload: 'gallery' },
    { label: 'Keep in My Heart', action: 'dismiss', payload: '' },
  ]);
  const [deviceStatusDoc, setDeviceStatusDoc] = useState<Record<string, any>>({});

  // Section 7: Sections Manager State
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [secTitle, setSecTitle] = useState<string>('');
  const [secIcon, setSecIcon] = useState<string>('💌');
  const [secContent, setSecContent] = useState<string>('');
  const [secImageUrl, setSecImageUrl] = useState<string>('');
  const [secAudioUrl, setSecAudioUrl] = useState<string>('');
  const [secVideoUrl, setSecVideoUrl] = useState<string>('');
  const [secVisible, setSecVisible] = useState<boolean>(true);

  // Section 8: Content Editor State
  const [editRecipientName, setEditRecipientName] = useState<string>(site.name);
  const [editCountdownDate, setEditCountdownDate] = useState<string>(site.birthday || '2026-12-17');
  const [editHomeMessage, setEditHomeMessage] = useState<string>(site.homeMessage || '');
  const [editSecretLetter, setEditSecretLetter] = useState<string>(site.personalMessage || '');
  const [editNameMeanings, setEditNameMeanings] = useState<NameLetterMeaning[]>(
    site.nameMeanings?.length ? site.nameMeanings : DEFAULT_NAME_MEANINGS
  );
  const [editPoems, setEditPoems] = useState<Poem[]>(site.poems?.length ? site.poems : DEFAULT_POEMS);
  const [editCompliments, setEditCompliments] = useState<string[]>(site.compliments || []);
  const [newCompliment, setNewCompliment] = useState<string>('');
  const [newPoemTitle, setNewPoemTitle] = useState<string>('');
  const [newPoemLines, setNewPoemLines] = useState<string>('');

  // Section 9: Music Manager State
  const rawOverrides = useSiteOverrides();
  const [musicTracks, setMusicTracks] = useState<SavedMusicTrack[]>(() => {
    const defaultTrack: SavedMusicTrack = {
      id: 'default_saiyaara',
      name: 'Saiyaara Sad BGM (Default)',
      url: CONFIG.musicUrl,
    };
    const saved = Array.isArray(site.savedMusicTracks) ? site.savedMusicTracks : [];
    const filtered = saved.filter((t) => t && t.url && t.url !== CONFIG.musicUrl);
    return [defaultTrack, ...filtered];
  });
  const [selectedMusicUrl, setSelectedMusicUrl] = useState<string>(
    rawOverrides.musicUrl || site.musicUrl || CONFIG.musicUrl
  );
  const [musicVol, setMusicVol] = useState<number>(site.musicVolume ?? 0.9);
  const [musicOn, setMusicOn] = useState<boolean>(site.musicEnabled !== false);
  const [uploadingMusic, setUploadingMusic] = useState<boolean>(false);
  const [musicUploadPct, setMusicUploadPct] = useState<number>(0);

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
    if (site.poems?.length) setEditPoems(site.poems);
    if (site.compliments?.length) setEditCompliments(site.compliments);
    const defaultTrack: SavedMusicTrack = {
      id: 'default_saiyaara',
      name: 'Saiyaara Sad BGM (Default)',
      url: CONFIG.musicUrl,
    };
    const saved = Array.isArray(site.savedMusicTracks) ? site.savedMusicTracks : [];
    const filtered = saved.filter((t) => t && t.url && t.url !== CONFIG.musicUrl);
    setMusicTracks([defaultTrack, ...filtered]);
    setSelectedMusicUrl(rawOverrides.musicUrl || site.musicUrl || CONFIG.musicUrl);
    setMusicVol(site.musicVolume ?? 0.9);
    setMusicOn(site.musicEnabled !== false);
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

    const unsubSections = onSnapshot(
      query(collection(db, 'sections'), orderBy('order', 'asc')),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setSectionsList(list);
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

    const unsubDeviceStatus = onSnapshot(
      doc(db, 'settings', 'device_status'),
      (snap) => {
        if (snap.exists()) setDeviceStatusDoc(snap.data());
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
      unsubSections();
      unsubUsers();
      unsubDeviceStatus();
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
    const playUrl = await resolveFirestoreMediaUrl(rawUrl);
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
      soundUrl: notifSoundUrl === 'silent' ? '' : notifSoundUrl,
      buttons: cleanedButtons,
      createdAt: Date.now(),
      scheduledFor: scheduledMs,
      status: scheduledMs && scheduledMs > Date.now() ? 'scheduled' : 'sent',
      seen: false,
    };

    setNotifTitle('');
    setNotifMessage('');
    setNotifImage('');
    setNotifScheduleTime('');
    notifyStatus(scheduledMs ? 'Notification scheduled.' : 'Notification sent live!');

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
    const now = Date.now();
    const scheduledMs = ovScheduleTime ? new Date(ovScheduleTime).getTime() : null;
    const isImmediate = !scheduledMs || scheduledMs <= now;

    // If sending a new overlay right now, auto-dismiss any older pending overlays that haven't received a response
    if (isImmediate && overlaysList.length > 0) {
      const pendingOldOverlays = overlaysList.filter(
        (ov) => !ov.dismissed && (!ov.scheduledFor || ov.scheduledFor <= now)
      );
      await Promise.all(
        pendingOldOverlays.map((oldOv) =>
          updateDoc(doc(db, 'overlays', oldOv.id), {
            dismissed: true,
            clickedAction: 'replaced_by_new_overlay',
            seenAt: now,
          }).catch(() => {})
        )
      );
    }

    const payload = {
      title: ovTitle.trim(),
      message: ovMessage.trim(),
      imageUrl: ovImage.trim(),
      theme: ovTheme,
      fontStyle: ovFontStyle,
      soundUrl: ovSoundUrl === 'silent' ? '' : ovSoundUrl,
      buttons: ovButtons.slice(0, 3),
      createdAt: Date.now(),
      scheduledFor: scheduledMs,
      status: scheduledMs && scheduledMs > now ? 'scheduled' : 'sent',
      dismissed: false,
    };

    notifyStatus(
      scheduledMs && scheduledMs > now
        ? 'Overlay scheduled.'
        : 'New overlay sent! (Any previous pending overlay was automatically dismissed)'
    );
    void addDoc(collection(db, 'overlays'), payload).catch((err: any) =>
      notifyStatus(`Overlay error: ${err.message}`, true)
    );
  };

  // Section 7: Save / Reorder Sections
  const handleSaveSection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!secTitle.trim()) {
      notifyStatus('Section title is required.', true);
      return;
    }
    const payload = {
      title: secTitle.trim(),
      icon: secIcon.trim() || '💌',
      content: secContent,
      imageUrl: secImageUrl.trim(),
      audioUrl: secAudioUrl.trim(),
      videoUrl: secVideoUrl.trim(),
      visible: secVisible,
      updatedAt: Date.now(),
    };
    const editId = editingSectionId;

    setEditingSectionId(null);
    setSecTitle('');
    setSecIcon('💌');
    setSecContent('');
    setSecImageUrl('');
    setSecAudioUrl('');
    setSecVideoUrl('');
    setSecVisible(true);
    notifyStatus(editId ? 'Section updated.' : 'New section created.');

    if (editId) {
      void updateDoc(doc(db, 'sections', editId), payload).catch((err: any) =>
        notifyStatus(`Save section error: ${err.message}`, true)
      );
    } else {
      void addDoc(collection(db, 'sections'), {
        ...payload,
        order: sectionsList.length,
        createdAt: Date.now(),
      }).catch((err: any) => notifyStatus(`Save section error: ${err.message}`, true));
    }
  };

  const handleMoveSection = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= sectionsList.length) return;
    const itemA = sectionsList[index];
    const itemB = sectionsList[targetIdx];

    // Optimistic reorder in UI
    const nextList = [...sectionsList];
    nextList[index] = itemB;
    nextList[targetIdx] = itemA;
    setSectionsList(nextList);
    notifyStatus('Order updated.');

    void Promise.all([
      updateDoc(doc(db, 'sections', itemA.id), { order: targetIdx }),
      updateDoc(doc(db, 'sections', itemB.id), { order: index }),
    ]).catch((err: any) => notifyStatus(`Reorder failed: ${err.message}`, true));
  };

  // Section 8: Save Live Content Editor
  const handleSaveContentEditor = () => {
    const payload = {
      name: editRecipientName.trim() || 'Kashish',
      birthday: editCountdownDate.trim() || '2026-12-17',
      homeMessage: editHomeMessage,
      personalMessage: editSecretLetter,
      nameMeanings: editNameMeanings,
      poems: editPoems,
      compliments: editCompliments,
      updatedAt: Date.now(),
    };
    notifyStatus('Live content saved! Reflected in app immediately.');
    void setDoc(doc(db, 'content', 'main'), payload, { merge: true }).catch((err: any) =>
      notifyStatus(`Save content failed: ${err.message}`, true)
    );
  };

  // Section 9: Save Music Settings
  const handleSaveMusicSettings = () => {
    const payload = {
      musicUrl: selectedMusicUrl,
      musicVolume: musicVol,
      musicEnabled: musicOn,
      updatedAt: Date.now(),
    };
    notifyStatus('Music settings updated in real time!');
    void setDoc(doc(db, 'settings', 'config'), payload, { merge: true }).catch((err: any) =>
      notifyStatus(`Music save error: ${err.message}`, true)
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

  // Strictly minimal monochrome palette (white / black / grey only, 1px borders, no glow/gradients/shadows/animations)
  const bgMain = dark ? 'bg-black text-neutral-100' : 'bg-white text-neutral-900';
  const bgSubtle = dark ? 'bg-neutral-950' : 'bg-neutral-50';
  const borderCol = dark ? 'border-neutral-800' : 'border-neutral-300';
  const textMuted = dark ? 'text-neutral-400' : 'text-neutral-500';
  const inputCls = `w-full px-2.5 py-1.5 text-[12px] rounded-[10px] border ${borderCol} ${
    dark ? 'bg-neutral-950 text-neutral-100' : 'bg-white text-neutral-900'
  } focus:outline-none focus:border-neutral-500`;
  const btnPrimary = `px-3 py-1.5 text-[12px] font-medium rounded-[10px] border cursor-pointer whitespace-nowrap ${
    dark
      ? 'bg-white text-black border-white hover:bg-neutral-200'
      : 'bg-black text-white border-black hover:bg-neutral-800'
  }`;
  const btnSecondary = `px-2.5 py-1 text-[12px] rounded-[10px] border ${borderCol} ${
    dark ? 'bg-neutral-950 text-neutral-200 hover:bg-neutral-900' : 'bg-white text-neutral-800 hover:bg-neutral-100'
  } cursor-pointer whitespace-nowrap`;
  const btnDanger = `px-2.5 py-1 text-[12px] rounded-[10px] border ${borderCol} ${
    dark ? 'text-neutral-300 hover:bg-neutral-900' : 'text-neutral-700 hover:bg-neutral-100'
  } cursor-pointer whitespace-nowrap`;

  const adminScopedCss = `
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
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
    .kashish-admin-panel button {
      border-radius: 10px;
    }
    .kashish-admin-panel input:not([type="checkbox"]):not([type="range"]),
    .kashish-admin-panel select,
    .kashish-admin-panel textarea {
      border-radius: 10px;
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
      border: 1px solid currentColor;
      position: relative;
      cursor: pointer;
      vertical-align: middle;
      flex-shrink: 0;
    }
    .kashish-admin-panel input[type="checkbox"]::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: currentColor;
      opacity: 0.45;
    }
    .kashish-admin-panel input[type="checkbox"]:checked::after {
      left: 14px;
      opacity: 1;
    }
    .kashish-admin-panel input[type="range"] {
      border-radius: 999px !important;
    }
    .kashish-admin-panel *::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    .kashish-admin-panel *::-webkit-scrollbar-track {
      border-radius: 999px;
    }
    .kashish-admin-panel *::-webkit-scrollbar-thumb {
      background: rgba(128, 128, 128, 0.45);
      border-radius: 999px;
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
      {/* Top Header Bar (1px border, flat minimal) */}
      <header className={`h-11 shrink-0 px-3 border-b ${borderCol} flex items-center justify-between gap-2`}>
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`md:hidden p-1.5 rounded-[10px] border ${borderCol} cursor-pointer`}
            aria-label="Toggle Menu"
          >
            {sidebarOpen ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}
          </button>
          <span className="font-bold text-[13px] tracking-tight truncate">KASHISH CONTROL CENTER</span>
          <span className={`hidden sm:inline text-[11px] ${textMuted}`}>
            · { currentUser?.email }
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {statusText && <span className="text-[11px] font-medium truncate max-w-[200px]">{statusText}</span>}
          {errorText && <span className="text-[11px] font-bold underline truncate max-w-[220px]">{errorText}</span>}
          {dataLoading && <span className={`text-[11px] ${textMuted}`}>Loading...</span>}

          <button
            onClick={() => setDark(!dark)}
            className={btnSecondary}
            title="Toggle Dark/Light"
          >
            {dark ? <Sun className="w-3.5 h-3.5 inline mr-1" /> : <Moon className="w-3.5 h-3.5 inline mr-1" />}
            <span>{dark ? 'Light' : 'Dark'}</span>
          </button>

          <button onClick={onClose} className={btnPrimary}>
            Back to App
          </button>
        </div>
      </header>

      {/* Main Workspace: Collapsible Left Sidebar + Content Viewport */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left Sidebar */}
        <aside
          className={`${
            sidebarOpen ? 'block absolute inset-y-0 left-0 z-40 w-56 rounded-r-[14px]' : 'hidden'
          } md:block md:static md:w-56 shrink-0 border-r ${borderCol} ${bgSubtle} overflow-y-auto flex flex-col justify-between`}
        >
          <nav className="p-2 space-y-0.5">
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
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left text-[12px] rounded-[10px] border cursor-pointer ${
                    isActive
                      ? dark
                        ? 'bg-white text-black border-white font-semibold'
                        : 'bg-black text-white border-black font-semibold'
                      : `border-transparent ${textMuted} hover:text-current`
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {badgeCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-rose-600 text-white tabular-nums shrink-0">
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
              className={`${btnSecondary} w-full flex items-center justify-center gap-1.5`}
            >
              <LogOut className="w-3 h-3" />
              <span>Sign Out</span>
            </button>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
          {/* 1. DASHBOARD */}
          {activeSection === 'dashboard' && (
            <div className="space-y-4">
              <div className={`flex items-center justify-between border-b ${borderCol} pb-2`}>
                <h2 className="text-[13px] font-bold uppercase tracking-wider">1. Dashboard Overview</h2>
                <span className={`text-[11px] ${textMuted}`}>Real-Time Firestore Sync</span>
              </div>

              {/* Pending User Approvals Alert Banner on Dashboard */}
              {pendingUsersList.length > 0 && (
                <div className={`p-3 rounded-[14px] border border-amber-500/50 bg-amber-500/10 space-y-2.5`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-[12px]">
                      ⏳ {pendingUsersList.length} New User(s) Waiting for Admin Approval
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={handleApproveAllPendingUsers} className={btnPrimary}>
                        Approve All ({pendingUsersList.length})
                      </button>
                      <button onClick={() => setActiveSection('users')} className={btnSecondary}>
                        Manage All Users
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {pendingUsersList.map((u) => (
                      <div
                        key={u.id}
                        className={`p-2 rounded-[10px] border ${borderCol} ${bgMain} flex flex-wrap items-center justify-between gap-2`}
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-[12px] truncate">
                            {u.displayName || 'New User'} · <span className="font-normal">{u.email}</span>
                          </div>
                          <div className={`text-[11px] ${textMuted}`}>
                            Method: {u.authMethod || 'google'} · Requested:{' '}
                            {u.createdAt ? new Date(u.createdAt).toLocaleString() : 'Just now'}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => handleApproveUser(u)} className={btnPrimary}>
                            <Check className="w-3 h-3 inline mr-1" />
                            Approve
                          </button>
                          <button onClick={() => handleRejectUser(u)} className={btnDanger}>
                            Reject / Block
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Compact Metric Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {[
                  { label: 'Last Opened', val: lastOpenedStr },
                  { label: 'Total Opens', val: String(totalOpens) },
                  { label: 'Active Screen', val: String(lastActiveScreen).toUpperCase() },
                  { label: 'Pending Users', val: String(pendingUsersList.length) },
                  { label: 'Hugs Count', val: String(hugsCount) },
                  { label: 'Calls Tapped', val: String(callsTapped) },
                  { label: 'Voice Notes', val: String(voiceReceivedCount) },
                  { label: 'Photos Received', val: String(photosReceivedCount) },
                ].map((m, i) => (
                  <div key={i} className={`p-2.5 rounded-[14px] border ${borderCol} ${bgSubtle}`}>
                    <div className={`text-[11px] ${textMuted} truncate`}>{m.label}</div>
                    <div className="text-[13px] font-bold tabular-nums mt-1 truncate" title={m.val}>
                      {m.val}
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
                  <table className="w-full text-left border-collapse text-[12px]">
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
            <div className="space-y-4">
              <div className={`flex flex-wrap items-center justify-between gap-2 border-b ${borderCol} pb-2`}>
                <div>
                  <h2 className="text-[13px] font-bold uppercase tracking-wider">
                    User Approvals & Access Control
                  </h2>
                  <p className={`text-[11px] ${textMuted}`}>
                    New users who sign up with Google or Email cannot enter the app until you Approve them here.
                  </p>
                </div>
                {pendingUsersList.length > 0 && (
                  <button onClick={handleApproveAllPendingUsers} className={btnPrimary}>
                    <Check className="w-3.5 h-3.5 inline mr-1" />
                    Approve All Pending ({pendingUsersList.length})
                  </button>
                )}
              </div>

              {/* Summary Counts & Filter Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'all', label: `All Users (${usersList.length})` },
                      { id: 'pending', label: `Pending Approval (${pendingUsersList.length})` },
                      {
                        id: 'approved',
                        label: `Approved (${usersList.filter((u) => getUserStatus(u) === 'approved').length})`,
                      },
                      {
                        id: 'rejected',
                        label: `Blocked / Rejected (${usersList.filter((u) => getUserStatus(u) === 'rejected').length})`,
                      },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setUserFilter(tab.id)}
                      className={userFilter === tab.id ? btnPrimary : btnSecondary}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="w-full sm:w-64">
                  <input
                    type="text"
                    placeholder="Search user name or email..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Users Table */}
              <div className={`rounded-[14px] overflow-hidden border ${borderCol} overflow-x-auto`}>
                <table className="w-full text-left border-collapse text-[12px]">
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
            <div className="space-y-3">
              <div className={`flex flex-wrap items-center justify-between gap-2 border-b ${borderCol} pb-2`}>
                <h2 className="text-[13px] font-bold uppercase tracking-wider">2. Activity Tracker</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={exportActivityCsv} className={btnPrimary}>
                    <Download className="w-3 h-3 inline mr-1" />
                    Export CSV ({filteredActivities.length})
                  </button>
                  <button
                    onClick={handleClearActivityLogs}
                    disabled={activities.length === 0}
                    className={`${btnDanger} disabled:opacity-40`}
                  >
                    <Trash2 className="w-3 h-3 inline mr-1" />
                    Delete All ({activities.length})
                  </button>
                </div>
              </div>

              {/* Filter Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <div>
                  <label className={`block text-[11px] ${textMuted} mb-1`}>Filter by Date</label>
                  <input
                    type="date"
                    value={actDateFilter}
                    onChange={(e) => setActDateFilter(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={`block text-[11px] ${textMuted} mb-1`}>Filter by Type</label>
                  <select
                    value={actTypeFilter}
                    onChange={(e) => setActTypeFilter(e.target.value)}
                    className={inputCls}
                  >
                    <option value="all">All Event Types</option>
                    <option value="app_opened">App Opened</option>
                    <option value="section_visited">Section Visited</option>
                    <option value="media_viewed">Photo / Video Viewed</option>
                    <option value="game_played">Game Played</option>
                    <option value="hug_sent">Hug Sent</option>
                    <option value="call_tapped">Call Tapped</option>
                    <option value="voice_note">Voice Note</option>
                    <option value="letter_opened">Letter Opened</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={`block text-[11px] ${textMuted} mb-1`}>Search Events</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="Search description or type..."
                      value={actSearch}
                      onChange={(e) => setActSearch(e.target.value)}
                      className={inputCls}
                    />
                    {(actDateFilter || actTypeFilter !== 'all' || actSearch) && (
                      <button
                        onClick={() => {
                          setActDateFilter('');
                          setActTypeFilter('all');
                          setActSearch('');
                        }}
                        className={btnSecondary}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Log Table */}
              <div className={`rounded-[14px] overflow-hidden border ${borderCol} overflow-x-auto`}>
                <table className="w-full text-left border-collapse text-[12px]">
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
            <div className="space-y-4">
              <div className={`flex flex-wrap items-center justify-between gap-2 border-b ${borderCol} pb-2`}>
                <h2 className="text-[13px] font-bold uppercase tracking-wider">3. Media Manager</h2>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setMediaViewMode('grid')}
                    className={mediaViewMode === 'grid' ? btnPrimary : btnSecondary}
                  >
                    Grid View
                  </button>
                  <button
                    onClick={() => setMediaViewMode('list')}
                    className={mediaViewMode === 'list' ? btnPrimary : btnSecondary}
                  >
                    List View
                  </button>
                  {selectedMediaIds.length > 0 && (
                    <button onClick={handleBulkDeleteMedia} className={btnDanger}>
                      Delete Selected ({selectedMediaIds.length})
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
                        className={`h-full rounded-full ${dark ? 'bg-white' : 'bg-black'}`}
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

                            <div className="flex items-center justify-between gap-1 pt-1 border-t border-neutral-800/40">
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
                                className={`text-[11px] px-1.5 py-0.5 rounded-[10px] border ${borderCol} bg-transparent`}
                              >
                                {MEDIA_CATEGORIES.map((c) => (
                                  <option key={c} value={c} className="bg-black text-white">
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
                    <table className="w-full text-left border-collapse text-[12px]">
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
            <div className="space-y-4">
              <div className={`flex items-center justify-between border-b ${borderCol} pb-2`}>
                <h2 className="text-[13px] font-bold uppercase tracking-wider">
                  4. Inbox From Her ({inboxItems.length})
                </h2>
                <span className={`text-[11px] ${textMuted}`}>Voice notes, photos, and hugs</span>
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
                <table className="w-full text-left border-collapse text-[12px]">
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
            <div className="space-y-4">
              <div className={`border-b ${borderCol} pb-2`}>
                <h2 className="text-[13px] font-bold uppercase tracking-wider">5. Notification Sender</h2>
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
                            <option value="poetry">Poetry</option>
                            <option value="secret-letter">Secret Letter</option>
                            <option value="open-when">Open When</option>
                            <option value="games">Games</option>
                            <option value="breathe">Breathe</option>
                            <option value="cute-pic">Cute Pic</option>
                            <option value="name-game">Name Game</option>
                            <option value="last-page">Last Page</option>
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

                <button type="submit" className={btnPrimary}>
                  {notifScheduleTime ? 'Schedule Notification' : 'Send Notification Now'}
                </button>
              </form>

              {/* Notification History */}
              <div className={`rounded-[14px] overflow-hidden border ${borderCol} overflow-x-auto`}>
                <div className={`px-3 py-1.5 border-b ${borderCol} ${bgSubtle} font-bold text-[12px]`}>
                  Notification History ({notificationsList.length})
                </div>
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead>
                    <tr className={`border-b ${borderCol} ${textMuted}`}>
                      <th className="py-1.5 px-2.5">Time</th>
                      <th className="py-1.5 px-2.5">Title, Message & Buttons</th>
                      <th className="py-1.5 px-2.5">Status</th>
                      <th className="py-1.5 px-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notificationsList.map((n) => (
                      <tr key={n.id} className={`border-b ${borderCol}`}>
                        <td className={`py-1.5 px-2.5 tabular-nums whitespace-nowrap ${textMuted}`}>
                          {n.createdAt ? new Date(n.createdAt).toLocaleString() : '-'}
                        </td>
                        <td className="py-1.5 px-2.5">
                          <div className="font-bold">{n.title}</div>
                          <div className={textMuted}>{n.message}</div>
                          {Array.isArray(n.buttons) && n.buttons.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {n.buttons.map((b: any, bi: number) => (
                                <span
                                  key={bi}
                                  className={`px-1.5 py-0.5 rounded text-[10px] border ${borderCol}`}
                                >
                                  {b.label} ({b.action})
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 px-2.5 text-[11px] space-y-1">
                          <div>
                            <span className={`px-2 py-0.5 rounded-full border ${borderCol}`}>
                              {n.seen ? 'SEEN' : n.status?.toUpperCase() || 'SENT'}
                            </span>
                          </div>
                          {(n.clickedLabel || n.clickedAction) && (
                            <div className="text-[10px] font-bold text-emerald-400">
                              ✅ Chose: "{n.clickedLabel || n.clickedAction}"
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 px-2.5 text-right space-x-1 whitespace-nowrap">
                          <button
                            onClick={() => {
                              notifyStatus('Notification resent.');
                              void addDoc(collection(db, 'notifications'), {
                                title: n.title,
                                message: n.message,
                                imageUrl: n.imageUrl || '',
                                soundUrl: n.soundUrl || '',
                                buttons: Array.isArray(n.buttons) ? n.buttons : [],
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
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. OVERLAY POPUP SENDER (Truecaller Style) */}
          {activeSection === 'overlays' && (
            <div className="space-y-4">
              <div className={`flex flex-wrap items-center justify-between gap-2 border-b ${borderCol} pb-2`}>
                <div>
                  <h2 className="text-[13px] font-bold uppercase tracking-wider">
                    6. Overlay Popup Sender (Truecaller Style · SYSTEM_ALERT_WINDOW + WakeLock)
                  </h2>
                  <p className={`text-[11px] ${textMuted}`}>
                    Displays over Instagram/WhatsApp via SYSTEM_ALERT_WINDOW and lights up the locked screen via USE_FULL_SCREEN_INTENT + WakeLock.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const now = Date.now();
                    const pendingOld = overlaysList.filter(
                      (ov) => !ov.dismissed && (!ov.scheduledFor || ov.scheduledFor <= now)
                    );
                    await Promise.all(
                      pendingOld.map((oldOv) =>
                        updateDoc(doc(db, 'overlays', oldOv.id), {
                          dismissed: true,
                          clickedAction: 'replaced_by_new_overlay',
                          clickedLabel: 'Replaced by Newer Overlay',
                          seenAt: now,
                        }).catch(() => {})
                      )
                    );
                    notifyStatus('Instant Truecaller Wakeup + Overlay popup sent!');
                    void addDoc(collection(db, 'overlays'), {
                      title: ovTitle.trim() || 'Thinking of You, Kashish 💖',
                      message:
                        ovMessage.trim() ||
                        'Just wanted to remind you how special you are to me right now!',
                      imageUrl: ovImage.trim(),
                      theme: ovTheme,
                      fontStyle: ovFontStyle,
                      soundUrl: ovSoundUrl === 'silent' ? '' : ovSoundUrl,
                      buttons: ovButtons.slice(0, 3),
                      createdAt: Date.now(),
                      scheduledFor: null,
                      status: 'sent',
                      dismissed: false,
                    }).catch((err: any) => notifyStatus(`Overlay error: ${err.message}`, true));
                  }}
                  className={btnPrimary}
                >
                  ⚡ Send Instant Truecaller Wakeup Popup
                </button>
              </div>

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
                                ? 'gallery / poetry / games'
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
                      {ovScheduleTime ? 'Schedule Overlay Popup' : 'Send Live Overlay Now'}
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
                                  ? { background: pTheme.primaryBtn, color: '#ffffff' }
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
                <div className={`px-3 py-1.5 border-b ${borderCol} ${bgSubtle} font-bold text-[12px]`}>
                  Overlay History & Her Chosen Options ({overlaysList.length})
                </div>
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead>
                    <tr className={`border-b ${borderCol} ${textMuted}`}>
                      <th className="py-1.5 px-2.5">Created</th>
                      <th className="py-1.5 px-2.5">Title, Message & Options Given</th>
                      <th className="py-1.5 px-2.5">Option Chosen by Her</th>
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

                      const isReplaced = o.clickedAction === 'replaced_by_new_overlay';
                      const isClosedX = o.clickedAction === 'closed_x';

                      // Match which button she chose from the options given
                      const matchedBtn =
                        !isReplaced && !isClosedX && (o.clickedLabel || o.clickedAction)
                          ? btns.find(
                              (b) =>
                                (o.clickedLabel && b.label === o.clickedLabel) ||
                                (!o.clickedLabel && b.action === o.clickedAction)
                            )
                          : null;

                      const chosenOptionText =
                        !isReplaced && !isClosedX
                          ? o.clickedLabel && o.clickedLabel !== o.clickedAction
                            ? o.clickedLabel
                            : matchedBtn?.label || o.clickedAction || ''
                          : '';

                      return (
                        <tr key={o.id} className={`border-b ${borderCol}`}>
                          <td className={`py-2 px-2.5 tabular-nums whitespace-nowrap align-top ${textMuted}`}>
                            <div>{o.createdAt ? new Date(o.createdAt).toLocaleString() : '-'}</div>
                            {o.seenAt && (
                              <div className="text-[10px] text-pink-400 mt-0.5">
                                Responded: {new Date(Number(o.seenAt)).toLocaleTimeString()}
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
                                  const isThisChosen =
                                    !isReplaced &&
                                    !isClosedX &&
                                    ((o.clickedLabel && b.label === o.clickedLabel) ||
                                      (!o.clickedLabel &&
                                        o.clickedAction &&
                                        b.action === o.clickedAction &&
                                        matchedBtn?.label === b.label));
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
                                        <span className="ml-0.5 px-1 py-0.2 rounded bg-emerald-500 text-black text-[9px] font-extrabold">
                                          ✓ CHOSEN
                                        </span>
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                          <td className="py-2 px-2.5 text-[11px] align-top">
                            {chosenOptionText ? (
                              <div className="space-y-1">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-bold">
                                  💖 Chose: "{chosenOptionText}"
                                </span>
                                {o.clickedAction && (
                                  <div className={`text-[10px] ${textMuted}`}>
                                    Action Triggered: <span className="font-semibold">{o.clickedAction}</span>
                                  </div>
                                )}
                              </div>
                            ) : isClosedX ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-400/40 text-amber-300 font-semibold">
                                ✕ Closed Popup (No option selected)
                              </span>
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
                                ⏳ Pending (Waiting for her choice)
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2.5 text-right space-x-1 align-top whitespace-nowrap">
                            <button
                              onClick={async () => {
                                const now = Date.now();
                                const pendingOld = overlaysList.filter(
                                  (ov) => !ov.dismissed && (!ov.scheduledFor || ov.scheduledFor <= now)
                                );
                                await Promise.all(
                                  pendingOld.map((oldOv) =>
                                    updateDoc(doc(db, 'overlays', oldOv.id), {
                                      dismissed: true,
                                      clickedAction: 'replaced_by_new_overlay',
                                      clickedLabel: 'Replaced by Newer Overlay',
                                      seenAt: now,
                                    }).catch(() => {})
                                  )
                                );
                                notifyStatus('Overlay resent.');
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

          {/* 7. SECTIONS MANAGER */}
          {activeSection === 'sections' && (
            <div className="space-y-4">
              <div className={`flex items-center justify-between border-b ${borderCol} pb-2`}>
                <h2 className="text-[13px] font-bold uppercase tracking-wider">
                  7. Sections Manager (Open When Cards & Dynamic Cards)
                </h2>
                <span className={`text-[11px] ${textMuted}`}>
                  Empty or hidden sections stay hidden in app automatically
                </span>
              </div>

              <form onSubmit={handleSaveSection} className={`p-3 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-2.5`}>
                <div className="font-bold text-[12px]">
                  {editingSectionId ? 'Edit Section' : 'Add New Section'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div className="sm:col-span-2">
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Title (e.g. Open When You Miss Me)</label>
                    <input
                      type="text"
                      required
                      value={secTitle}
                      onChange={(e) => setSecTitle(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Icon / Emoji</label>
                    <input
                      type="text"
                      value={secIcon}
                      onChange={(e) => setSecIcon(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer text-[12px]">
                      <input
                        type="checkbox"
                        checked={secVisible}
                        onChange={(e) => setSecVisible(e.target.checked)}
                      />
                      <span>Visible in App</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className={`block text-[11px] ${textMuted} mb-1`}>Text Content / Letter</label>
                  <textarea
                    rows={3}
                    value={secContent}
                    onChange={(e) => setSecContent(e.target.value)}
                    placeholder="Write letter or section text..."
                    className={inputCls}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Image URL (Optional)</label>
                    <input
                      type="text"
                      value={secImageUrl}
                      onChange={(e) => setSecImageUrl(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Audio URL (Optional)</label>
                    <input
                      type="text"
                      value={secAudioUrl}
                      onChange={(e) => setSecAudioUrl(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-[11px] ${textMuted} mb-1`}>Video URL (Optional)</label>
                    <input
                      type="text"
                      value={secVideoUrl}
                      onChange={(e) => setSecVideoUrl(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button type="submit" className={btnPrimary}>
                    {editingSectionId ? 'Update Section' : 'Create Section'}
                  </button>
                  {editingSectionId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSectionId(null);
                        setSecTitle('');
                        setSecContent('');
                      }}
                      className={btnSecondary}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>

              <div className={`rounded-[14px] overflow-hidden border ${borderCol} overflow-x-auto`}>
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead>
                    <tr className={`border-b ${borderCol} ${bgSubtle} ${textMuted}`}>
                      <th className="py-1.5 px-2.5">Order</th>
                      <th className="py-1.5 px-2.5">Icon</th>
                      <th className="py-1.5 px-2.5">Title</th>
                      <th className="py-1.5 px-2.5">Status</th>
                      <th className="py-1.5 px-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionsList.map((s, idx) => {
                      const isEmpty = !s.content?.trim() && !s.imageUrl && !s.audioUrl && !s.videoUrl;
                      return (
                        <tr key={s.id} className={`border-b ${borderCol}`}>
                          <td className="py-1.5 px-2.5 whitespace-nowrap space-x-1">
                            <button onClick={() => handleMoveSection(idx, -1)} className={btnSecondary}>
                              ↑
                            </button>
                            <button onClick={() => handleMoveSection(idx, 1)} className={btnSecondary}>
                              ↓
                            </button>
                          </td>
                          <td className="py-1.5 px-2.5">{s.icon || '💌'}</td>
                          <td className="py-1.5 px-2.5 font-medium">{s.title}</td>
                          <td className="py-1.5 px-2.5 text-[11px]">
                            <span className={`px-2 py-0.5 rounded-full border ${borderCol}`}>
                              {isEmpty ? 'HIDDEN (EMPTY)' : s.visible === false ? 'HIDDEN' : 'VISIBLE'}
                            </span>
                          </td>
                          <td className="py-1.5 px-2.5 text-right space-x-1">
                            <button
                              onClick={() => {
                                const nextVis = s.visible === false;
                                setSectionsList((prev) =>
                                  prev.map((x) => (x.id === s.id ? { ...x, visible: nextVis } : x))
                                );
                                void updateDoc(doc(db, 'sections', s.id), { visible: nextVis }).catch(() => {});
                              }}
                              className={btnSecondary}
                            >
                              {s.visible === false ? 'Show' : 'Hide'}
                            </button>
                            <button
                              onClick={() => {
                                setEditingSectionId(s.id);
                                setSecTitle(s.title || '');
                                setSecIcon(s.icon || '💌');
                                setSecContent(s.content || '');
                                setSecImageUrl(s.imageUrl || '');
                                setSecAudioUrl(s.audioUrl || '');
                                setSecVideoUrl(s.videoUrl || '');
                                setSecVisible(s.visible !== false);
                              }}
                              className={btnSecondary}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() =>
                                askConfirm(`Delete section "${s.title}"?`, () => {
                                  setSectionsList((prev) => prev.filter((x) => x.id !== s.id));
                                  notifyStatus('Section deleted.');
                                  void deleteDoc(doc(db, 'sections', s.id)).catch(() => {});
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
                    {sectionsList.length === 0 && (
                      <tr>
                        <td colSpan={5} className={`py-6 text-center ${textMuted}`}>
                          No custom sections added yet.
                        </td>
                      </tr>
                    )}
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
                <div className="font-bold text-[12px]">Name Meanings (K-A-S-H-I-S-H)</div>
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

              {/* Poems Editor */}
              <div className={`p-3 rounded-[14px] border ${borderCol} space-y-3`}>
                <div className="font-bold text-[12px]">Poems ({editPoems.length})</div>
                <div className="space-y-2">
                  {editPoems.map((p, idx) => (
                    <div key={idx} className={`p-2.5 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-1.5`}>
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={p.title}
                          onChange={(e) => {
                            const next = [...editPoems];
                            next[idx] = { ...next[idx], title: e.target.value };
                            setEditPoems(next);
                          }}
                          className={inputCls}
                        />
                        <button
                          onClick={() =>
                            askConfirm(`Delete poem "${p.title}"?`, () => {
                              setEditPoems(editPoems.filter((_, i) => i !== idx));
                            })
                          }
                          className={btnDanger}
                        >
                          Remove
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        value={p.lines.join('\n')}
                        onChange={(e) => {
                          const next = [...editPoems];
                          next[idx] = { ...next[idx], lines: e.target.value.split('\n') };
                          setEditPoems(next);
                        }}
                        className={inputCls}
                      />
                    </div>
                  ))}
                </div>

                <div className={`p-2.5 rounded-[14px] border ${borderCol} space-y-2`}>
                  <div className="text-[11px] font-bold">Add New Poem</div>
                  <input
                    type="text"
                    placeholder="Poem Title"
                    value={newPoemTitle}
                    onChange={(e) => setNewPoemTitle(e.target.value)}
                    className={inputCls}
                  />
                  <textarea
                    rows={3}
                    placeholder="Poem lines (one per line)..."
                    value={newPoemLines}
                    onChange={(e) => setNewPoemLines(e.target.value)}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newPoemTitle.trim() || !newPoemLines.trim()) return;
                      setEditPoems([
                        ...editPoems,
                        { title: newPoemTitle.trim(), lines: newPoemLines.split('\n') },
                      ]);
                      setNewPoemTitle('');
                      setNewPoemLines('');
                    }}
                    className={btnSecondary}
                  >
                    + Add Poem to List
                  </button>
                </div>
              </div>

              {/* Game Compliments / Wheel Content */}
              <div className={`p-3 rounded-[14px] border ${borderCol} space-y-2`}>
                <div className="font-bold text-[12px]">
                  Game Content / Spin Wheel Compliments ({editCompliments.length})
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

          {/* 9. MUSIC MANAGER */}
          {activeSection === 'music' && (
            <div className="space-y-4">
              <div className={`border-b ${borderCol} pb-2 flex items-center justify-between`}>
                <h2 className="text-[13px] font-bold uppercase tracking-wider">
                  9. Music Manager (Live Sync on Website & Android APK)
                </h2>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${borderCol}`}>
                  {musicOn ? '🎵 MUSIC ON' : '🔇 MUSIC OFF'}
                </span>
              </div>

              <div className={`p-3.5 rounded-[14px] border ${borderCol} ${bgSubtle} space-y-3.5`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={musicOn}
                      onChange={async (e) => {
                        const nextOn = e.target.checked;
                        setMusicOn(nextOn);
                        await setDoc(
                          doc(db, 'settings', 'config'),
                          {
                            musicEnabled: nextOn,
                            musicSessionId: Date.now(),
                            updatedAt: Date.now(),
                          },
                          { merge: true }
                        ).catch(() => {});
                        notifyStatus(
                          nextOn
                            ? 'Background music enabled live on Website & APK!'
                            : 'Background music paused/disabled live on Website & APK!'
                        );
                      }}
                    />
                    <span>Background Music Enabled ({musicOn ? 'ON' : 'OFF'})</span>
                  </label>
                  <span className={`px-2.5 py-0.5 rounded-full border ${borderCol} text-[11px]`}>
                    Volume: {Math.round(musicVol * 100)}%
                  </span>
                </div>

                <div>
                  <label className={`block text-[11px] ${textMuted} mb-1`}>Default Volume</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={musicVol}
                    onChange={(e) => setMusicVol(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className={`block text-[11px] ${textMuted} mb-1`}>
                    Select Preset / Uploaded Track ({musicTracks.length} available)
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={selectedMusicUrl}
                      onChange={async (e) => {
                        const nextUrl = e.target.value;
                        setSelectedMusicUrl(nextUrl);
                        await setDoc(
                          doc(db, 'settings', 'config'),
                          {
                            musicUrl: nextUrl,
                            musicEnabled: true,
                            musicVolume: musicVol,
                            savedMusicTracks: musicTracks,
                            musicSessionId: Date.now(),
                            updatedAt: Date.now(),
                          },
                          { merge: true }
                        ).catch(() => {});
                        setMusicOn(true);
                        notifyStatus('Switched active song live on Website & APK!');
                      }}
                      className={inputCls}
                    >
                      {musicTracks.map((t) => (
                        <option key={t.id} value={t.url}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handlePreviewSoundUrl(selectedMusicUrl)}
                      className={btnSecondary}
                    >
                      {previewingSoundUrl === selectedMusicUrl ? 'Stop Preview' : '▶ Test Play'}
                    </button>
                  </div>
                </div>

                {/* Saved Music Tracks List with 1-Click Activate & Delete */}
                <div className={`p-2.5 rounded-[12px] border ${borderCol} space-y-1.5`}>
                  <div className="text-[11px] font-bold">Saved Music Library (Synced in Firestore)</div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {musicTracks.map((t) => {
                      const isSelected = selectedMusicUrl === t.url;
                      const isDefault = t.id === 'default_saiyaara' || t.url === CONFIG.musicUrl;
                      return (
                        <div
                          key={t.id}
                          className={`p-2 rounded-[10px] border ${
                            isSelected ? 'border-pink-500/60 bg-pink-500/10' : borderCol
                          } flex items-center justify-between gap-2 text-[11px]`}
                        >
                          <div className="truncate font-medium">
                            {isSelected ? '🎶 ' : '🎵 '}
                            {t.name}
                            {isSelected && (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300 text-[10px] font-bold">
                                ACTIVE ON SITE & APK
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handlePreviewSoundUrl(t.url)}
                              className={btnSecondary}
                            >
                              {previewingSoundUrl === t.url ? 'Stop' : 'Play'}
                            </button>
                            {!isSelected && (
                              <button
                                type="button"
                                onClick={async () => {
                                  setSelectedMusicUrl(t.url);
                                  setMusicOn(true);
                                  await setDoc(
                                    doc(db, 'settings', 'config'),
                                    {
                                      musicUrl: t.url,
                                      musicEnabled: true,
                                      musicVolume: musicVol,
                                      savedMusicTracks: musicTracks,
                                      musicSessionId: Date.now(),
                                      updatedAt: Date.now(),
                                    },
                                    { merge: true }
                                  ).catch(() => {});
                                  notifyStatus(`"${t.name}" is now playing on Website & APK!`);
                                }}
                                className={btnPrimary}
                              >
                                Use Song
                              </button>
                            )}
                            {!isDefault && (
                              <button
                                type="button"
                                onClick={() => {
                                  askConfirm(`Delete song "${t.name}"?`, async () => {
                                    await deleteFirestoreMediaChunks(t.storagePath || t.url, t.url, 'audio');
                                    const nextTracks = musicTracks.filter((x) => x.id !== t.id);
                                    setMusicTracks(nextTracks);
                                    const nextUrl =
                                      selectedMusicUrl === t.url ? CONFIG.musicUrl : selectedMusicUrl;
                                    setSelectedMusicUrl(nextUrl);
                                    await setDoc(
                                      doc(db, 'settings', 'config'),
                                      {
                                        musicUrl: nextUrl,
                                        savedMusicTracks: nextTracks,
                                        musicSessionId: Date.now(),
                                        updatedAt: Date.now(),
                                      },
                                      { merge: true }
                                    ).catch(() => {});
                                    notifyStatus(`Deleted "${t.name}".`);
                                  });
                                }}
                                className={btnDanger}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className={`block text-[11px] ${textMuted} mb-1`}>
                    Active Background Music URL (Or Paste Direct MP3 Link)
                  </label>
                  <input
                    type="text"
                    value={selectedMusicUrl}
                    onChange={(e) => setSelectedMusicUrl(e.target.value)}
                    placeholder="https://... or upload an MP3 below"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={`block text-[11px] ${textMuted} mb-1`}>
                    Upload New Music File (MP3 / Audio — Auto-Saves & Activates on Site + APK)
                  </label>
                  <input
                    type="file"
                    accept="audio/*"
                    disabled={uploadingMusic}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploadingMusic(true);
                      setMusicUploadPct(10);
                      notifyStatus(`Uploading "${file.name}"...`);
                      try {
                        const res = await uploadFileToFirebaseStorage(
                          file,
                          'music',
                          file.name,
                          (pct) => setMusicUploadPct(pct)
                        );
                        const newTrack: SavedMusicTrack = {
                          id: `track_${Date.now()}`,
                          name: file.name,
                          url: res.url,
                          storagePath: res.storagePath,
                        };
                        const nextTracks = [...musicTracks, newTrack];
                        setMusicTracks(nextTracks);
                        setSelectedMusicUrl(res.url);
                        setMusicOn(true);
                        await setDoc(
                          doc(db, 'settings', 'config'),
                          {
                            musicUrl: res.url,
                            musicVolume: musicVol,
                            musicEnabled: true,
                            savedMusicTracks: nextTracks,
                            musicSessionId: Date.now(),
                            updatedAt: Date.now(),
                          },
                          { merge: true }
                        );
                        notifyStatus(
                          `Uploaded "${file.name}" & activated live on both Website and Android APK!`
                        );
                      } catch (err: any) {
                        notifyStatus(`Music upload error: ${err.message}`, true);
                      } finally {
                        setUploadingMusic(false);
                        setMusicUploadPct(0);
                        e.target.value = '';
                      }
                    }}
                    className={inputCls}
                  />
                  {uploadingMusic && (
                    <div className="text-[11px] text-pink-400 font-bold mt-1">
                      Uploading song... {musicUploadPct}%
                    </div>
                  )}
                </div>

                <button onClick={handleSaveMusicSettings} className={btnPrimary}>
                  Save & Apply Music Settings Live (Site + APK)
                </button>
              </div>
            </div>
          )}

          {/* 10. APP CONTROL */}
          {activeSection === 'control' && (
            <div className="space-y-4">
              <div className={`border-b ${borderCol} pb-2`}>
                <h2 className="text-[13px] font-bold uppercase tracking-wider">10. Remote App Control</h2>
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
                      Jab bhi nayi release aayegi ya aap Force Update ON karoge, app me mandatory update popup aayega jab tak wo naya `Kashishhh.apk` install na kar le.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="px-2 py-1 rounded-lg bg-pink-500/15 border border-pink-500/30 font-semibold">
                      Her Installed APK: v{deviceStatusDoc?.appVersion || '2.2.0'}
                    </span>
                    <span className="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold">
                      Latest Release: v{liveCiApkMeta?.version || apkLatestVer}
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
        </main>
      </div>

      {/* Media Preview Modal */}
      {previewMedia && (
        <div className="fixed inset-0 z-[2100] bg-black/80 flex items-center justify-center p-4">
          <div className={`max-w-lg w-full rounded-[14px] border ${borderCol} ${bgMain} p-3 space-y-2`}>
            <div className="flex items-center justify-between">
              <span className="font-bold truncate">{previewMedia.name || 'Preview'}</span>
              <button onClick={() => setPreviewMedia(null)} className={btnSecondary}>
                Close
              </button>
            </div>
            <div className="max-h-[70vh] rounded-[12px] overflow-hidden flex items-center justify-center bg-black">
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
        <div className="fixed inset-0 z-[2200] bg-black/75 flex items-center justify-center p-4">
          <div className={`max-w-xs w-full rounded-[14px] border ${borderCol} ${bgMain} p-4 space-y-3`}>
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
