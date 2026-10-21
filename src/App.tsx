import React, { useState, useEffect, useRef } from 'react';
import { useSite } from './siteContent';
import { romanticAudio } from './audio';
import { BackgroundEffects } from './components/BackgroundEffects';
import { NostalgicLockScreen } from './components/NostalgicLockScreen';
import { Navbar, NavTab } from './components/Navbar';
import { HomeSection } from './components/HomeSection';
import { GamesSection } from './components/GamesSection';
import { PoetrySection } from './components/PoetrySection';
import { SecretLetterSection } from './components/SecretLetterSection';
import { NameGameSection } from './components/NameGameSection';
import { CutePicSection } from './components/CutePicSection';
import { LastPageSection } from './components/LastPageSection';
import { OpenWhenSection } from './components/OpenWhenSection';
import { BreatheSection } from './components/BreatheSection';
import { GallerySection } from './components/GallerySection';
import { loadProgress, saveProgress, resetProgress, UserProgressData } from './storage';
import {
  triggerHaptic,
  showNativeToast,
  logNativeActivity,
  incrementStat,
  trackSectionVisit,
  isNativeApp,
  getInstalledAppVersion,
  isVersionOlder,
  openApkDownloadUrl,
} from './androidBridge';
import { Heart, Home, Music, Download, Sparkles, RefreshCw } from 'lucide-react';
import { DynamicSlot } from './components/DynamicSlot';
import { onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, ADMIN_EMAIL } from './firebase';
import { AdminPanel } from './components/AdminPanel';
import { LiveOverlaysAndNotifications } from './components/LiveOverlaysAndNotifications';

export default function App() {
  const site = useSite();
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    try {
      return (
        window.localStorage.getItem('kashish_unlocked_persist') === 'true' ||
        window.sessionStorage.getItem('kashishUnlocked') === 'true'
      );
    } catch {
      return false;
    }
  });
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(() => auth.currentUser);
  const [approvalStatus, setApprovalStatus] = useState<
    'loading' | 'approved' | 'pending' | 'rejected' | 'unauthenticated'
  >(() => {
    try {
      if (
        window.localStorage.getItem('kashish_unlocked_persist') === 'true' ||
        window.sessionStorage.getItem('kashishUnlocked') === 'true'
      ) {
        return 'approved';
      }
    } catch {}
    return 'loading';
  });
  const [isLoadingAssets, setIsLoadingAssets] = useState(true);
  const prevApprovalRef = useRef<string>(approvalStatus);

  // Sync unlock state with Firebase Authentication AND Real-Time Admin Approval Gate
  useEffect(() => {
    let unsubUserDoc: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }

      setAuthUser(user);

      if (!user) {
        setApprovalStatus('unauthenticated');
        prevApprovalRef.current = 'unauthenticated';
        setIsUnlocked(false);
        try {
          window.localStorage.removeItem('kashish_unlocked_persist');
          window.sessionStorage.removeItem('kashishUnlocked');
        } catch {}
        return;
      }

      // Admin is always automatically approved
      if (user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        setApprovalStatus('approved');
        prevApprovalRef.current = 'approved';
        setIsUnlocked(true);
        try {
          window.localStorage.setItem('kashish_unlocked_persist', 'true');
          window.sessionStorage.setItem('kashishUnlocked', 'true');
        } catch {}
        return;
      }

      // Non-admin user: Listen to real-time approval status in Firestore `users/{uid}`
      const userDocRef = doc(db, 'users', user.uid);
      unsubUserDoc = onSnapshot(
        userDocRef,
        (snap) => {
          if (!snap.exists()) {
            // Register user as pending if document doesn't exist yet
            setApprovalStatus('pending');
            prevApprovalRef.current = 'pending';
            setIsUnlocked(false);
            try {
              window.localStorage.removeItem('kashish_unlocked_persist');
              window.sessionStorage.removeItem('kashishUnlocked');
            } catch {}
            void setDoc(
              userDocRef,
              {
                uid: user.uid,
                email: user.email || '',
                displayName: user.displayName || user.email?.split('@')[0] || 'New User',
                photoURL: user.photoURL || '',
                authMethod: user.providerData?.[0]?.providerId || 'google',
                approved: false,
                status: 'pending',
                createdAt: Date.now(),
                lastLoginAt: serverTimestamp(),
              },
              { merge: true }
            ).catch(() => {});
            return;
          }

          const data = snap.data();
          const isApproved = data.approved === true || data.status === 'approved';
          if (isApproved) {
            const wasPending = prevApprovalRef.current === 'pending' || prevApprovalRef.current === 'rejected';
            setApprovalStatus('approved');
            prevApprovalRef.current = 'approved';
            setIsUnlocked(true);
            try {
              window.localStorage.setItem('kashish_unlocked_persist', 'true');
              window.sessionStorage.setItem('kashishUnlocked', 'true');
            } catch {}
            if (wasPending) {
              romanticAudio.playChime();
              showNativeToast(`Approved by Admin! Welcome to ${site.name}'s World 💖`);
            }
          } else {
            const nextStat = data.status === 'rejected' ? 'rejected' : 'pending';
            setApprovalStatus(nextStat);
            prevApprovalRef.current = nextStat;
            setIsUnlocked(false);
            romanticAudio.stop();
            try {
              window.localStorage.removeItem('kashish_unlocked_persist');
              window.sessionStorage.removeItem('kashishUnlocked');
            } catch {}
          }
        },
        () => {
          // If Firestore temporarily fails on startup, preserve existing approved session if already unlocked
          try {
            if (window.localStorage.getItem('kashish_unlocked_persist') === 'true') {
              setApprovalStatus('approved');
              setIsUnlocked(true);
              return;
            }
          } catch {}
          setApprovalStatus('pending');
          setIsUnlocked(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubUserDoc) unsubUserDoc();
    };
  }, [site.name]);

  // Preload key assets (fonts, lock photo) with a max 2.2s cap
  useEffect(() => {
    let isMounted = true;

    const preloadKeyAssets = async () => {
      const promises: Promise<any>[] = [];

      // 1. Wait for Google Fonts ready state
      if (typeof document !== 'undefined' && 'fonts' in document) {
        promises.push(document.fonts.ready.catch(() => {}));
      }

      // 2. Preload and decode lock screen photo
      if (site.lockPhotoUrl) {
        const img = new Image();
        img.src = site.lockPhotoUrl;
        if ('decode' in img) {
          promises.push(img.decode().catch(() => {}));
        }
      }

      // Never block UI for more than 2.2s
      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 2200));

      await Promise.race([Promise.all(promises), timeoutPromise]);

      if (isMounted) {
        setIsLoadingAssets(false);
      }
    };

    preloadKeyAssets();

    return () => {
      isMounted = false;
    };
  }, []);

  // Default to Dark Mode; restore light mode only if user previously saved it
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const savedTheme = window.localStorage.getItem('kashishTheme');
        return savedTheme === 'light' ? false : true;
      }
      return true;
    } catch {
      return true;
    }
  });
  const [isPlayingMusic, setIsPlayingMusic] = useState(false);
  const [isSecretLetterOpenInView, setIsSecretLetterOpenInView] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState<boolean>(() => {
    return typeof window !== 'undefined' && window.location.hash === '#admin';
  });
  const [liveApkMeta, setLiveApkMeta] = useState<{
    version?: string;
    apkUrl?: string;
    githubReleaseApkUrl?: string;
  } | null>(null);
  const [installedApkVer, setInstalledApkVer] = useState<string>(() => getInstalledAppVersion());

  // Poll /latest-apk.json and sync native installed APK version so any new GitHub push triggers mandatory update
  useEffect(() => {
    let active = true;
    const checkLatestBuild = async () => {
      try {
        setInstalledApkVer(getInstalledAppVersion());
        const res = await fetch(`/latest-apk.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (active && data && typeof data.version === 'string') {
          setLiveApkMeta(data);
        }
      } catch {}
    };

    void checkLatestBuild();
    const timer = window.setInterval(checkLatestBuild, 25000);
    const onPermSync = () => setInstalledApkVer(getInstalledAppVersion());
    window.addEventListener('kashish-permissions-updated', onPermSync);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('kashish-permissions-updated', onPermSync);
    };
  }, []);

  // Restore on-device progress safely from localStorage
  const [progress, setProgress] = useState<UserProgressData>(() => loadProgress());

  // Restore last visited section if valid
  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    const validTabs: NavTab[] = [
      'home',
      'gallery',
      'breathe',
      'open-when',
      'games',
      'cute-pic',
      'poetry',
      'secret-letter',
      'name-game',
      'last-page',
    ];
    if (progress.lastVisitedSection && validTabs.includes(progress.lastVisitedSection as NavTab)) {
      return progress.lastVisitedSection as NavTab;
    }
    return 'home';
  });

  // Automatically persist progress state on any change
  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  // Keep isPlayingMusic state 100% in sync with real audio playback & live Admin Music controls
  useEffect(() => {
    romanticAudio.init(site.musicUrl);
    const unsubscribe = romanticAudio.subscribe((playing) => {
      setIsPlayingMusic(playing);
    });
    return unsubscribe;
  }, [site.musicUrl]);

  useEffect(() => {
    if (typeof site.musicVolume === 'number' && !Number.isNaN(site.musicVolume)) {
      romanticAudio.setVolume(site.musicVolume);
    }
  }, [site.musicVolume]);

  const prevMusicSessionRef = useRef<number>(site.musicSessionId || 0);

  useEffect(() => {
    const targetUrl =
      activeTab === 'secret-letter' && isSecretLetterOpenInView && site.secretLetterMusicUrl
        ? site.secretLetterMusicUrl
        : site.musicUrl;

    const adminTriggeredChange =
      Boolean(site.musicSessionId) && site.musicSessionId !== prevMusicSessionRef.current;
    if (site.musicSessionId) {
      prevMusicSessionRef.current = site.musicSessionId;
    }

    if (site.musicEnabled === false) {
      if (romanticAudio.getIsPlaying()) {
        romanticAudio.stop();
      }
      return;
    }

    if (!targetUrl) return;

    if (adminTriggeredChange && isUnlocked) {
      // Admin just saved new music settings live — play/switch track immediately on both Site & APK
      romanticAudio.playTrack(targetUrl, true);
      return;
    }

    if (isUnlocked && romanticAudio.getIsPlaying() && romanticAudio.getCurrentUrl() !== targetUrl) {
      romanticAudio.playTrack(targetUrl);
    } else {
      romanticAudio.init(targetUrl);
    }
  }, [
    site.musicEnabled,
    site.musicUrl,
    site.musicSessionId,
    site.secretLetterMusicUrl,
    isUnlocked,
    activeTab,
    isSecretLetterOpenInView,
  ]);

  // Universal first-touch audio warmup to unblock AudioContext & media autoplay in Android WebView / browser
  useEffect(() => {
    const warmupAudio = () => {
      romanticAudio.resumeContext();
      ['click', 'touchstart', 'touchend', 'pointerdown', 'keydown'].forEach((evt) => {
        window.removeEventListener(evt, warmupAudio);
      });
    };

    ['click', 'touchstart', 'touchend', 'pointerdown', 'keydown'].forEach((evt) => {
      window.addEventListener(evt, warmupAudio, { once: true, passive: true });
    });

    return () => {
      ['click', 'touchstart', 'touchend', 'pointerdown', 'keydown'].forEach((evt) => {
        window.removeEventListener(evt, warmupAudio);
      });
    };
  }, []);

  // When unlocked, start background music on first user interaction ONCE (never override manual pause)
  const hasAutoStartedMusicRef = useRef(false);
  useEffect(() => {
    if (!isUnlocked || site.musicEnabled === false || hasAutoStartedMusicRef.current) return;

    if (romanticAudio.getIsPlaying()) {
      hasAutoStartedMusicRef.current = true;
      setIsPlayingMusic(true);
      return;
    }

    const startOnInteraction = () => {
      hasAutoStartedMusicRef.current = true;
      if (!romanticAudio.getIsPlaying() && !romanticAudio.isUserPaused() && site.musicEnabled !== false) {
        romanticAudio.play(site.musicUrl);
      }
      window.removeEventListener('pointerdown', startOnInteraction);
      window.removeEventListener('keydown', startOnInteraction);
    };

    window.addEventListener('pointerdown', startOnInteraction, { once: true, passive: true });
    window.addEventListener('keydown', startOnInteraction, { once: true, passive: true });

    return () => {
      window.removeEventListener('pointerdown', startOnInteraction);
      window.removeEventListener('keydown', startOnInteraction);
    };
  }, [isUnlocked, site.musicEnabled, site.musicUrl]);

  // Sync data-theme on <html> element and persist in localStorage + update theme-color meta tag
  useEffect(() => {
    const theme = isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('kashishTheme', theme);
      }
    } catch {
      // Safe fallback if storage blocked
    }

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', isDarkMode ? '#1a0d1f' : '#fff5f8');
    }
  }, [isDarkMode]);

  // Track visits and session duration on this device WITHOUT triggering 5-second full-app re-renders
  useEffect(() => {
    const sessionStartMs = Date.now();
    setProgress((prev) => ({
      ...prev,
      totalVisits: (prev.totalVisits || 0) + 1,
      lastActivityDate: new Date().toISOString(),
    }));

    const flushSessionDuration = () => {
      const elapsedSec = Math.max(1, Math.round((Date.now() - sessionStartMs) / 1000));
      try {
        const current = loadProgress();
        saveProgress({
          ...current,
          sessionDurationSeconds: (current.sessionDurationSeconds || 0) + elapsedSec,
          lastActivityDate: new Date().toISOString(),
        });
      } catch {}
    };

    window.addEventListener('pagehide', flushSessionDuration);

    // Fire-and-forget initial open tracking
    void incrementStat('app_opens');
    void trackSectionVisit('app_start');
    void logNativeActivity(`📱 <b>${site.name}'s World</b> opened!`, true);

    return () => {
      flushSessionDuration();
      window.removeEventListener('pagehide', flushSessionDuration);
    };
  }, []);

  const handleUnlock = () => {
    setIsUnlocked(true);
    setApprovalStatus('approved');
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('kashish_unlocked_persist', 'true');
        window.sessionStorage.setItem('kashishUnlocked', 'true');
      }
    } catch {}

    if (typeof window !== 'undefined') {
      window.history.replaceState({ tab: 'home', isUnlocked: true }, '', window.location.pathname);
      if (activeTab !== 'home') {
        window.history.pushState({ tab: activeTab, isUnlocked: true }, '', `#${activeTab}`);
      }
    }

    romanticAudio.play(site.musicUrl);

    void incrementStat('unlocks');
    void trackSectionVisit('home');
    void logNativeActivity(`🔓 <b>${site.name}</b> logged in & entered ${site.name}'s World!`, true);
  };

  const handleToggleMusic = () => {
    const targetUrl =
      activeTab === 'secret-letter' && isSecretLetterOpenInView && site.secretLetterMusicUrl
        ? site.secretLetterMusicUrl
        : site.musicUrl;
    const nowPlaying = romanticAudio.toggle(targetUrl);
    setIsPlayingMusic(nowPlaying);
    triggerHaptic(25);
  };

  const handleToggleDarkMode = () => {
    setIsDarkMode((prev) => !prev);
  };

  const handleLockAgain = async () => {
    try {
      await signOut(auth);
    } catch {}
    setIsUnlocked(false);
    setApprovalStatus('unauthenticated');
    setIsSecretLetterOpenInView(false);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('kashish_unlocked_persist');
        window.sessionStorage.removeItem('kashishUnlocked');
      }
    } catch {}
    romanticAudio.stop();
  };

  const handleTabSelect = (tab: NavTab, updateHistory = true) => {
    if (tab === activeTab) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (updateHistory && typeof window !== 'undefined') {
      if (tab === 'home') {
        window.history.pushState({ tab: 'home', isUnlocked: true }, '', window.location.pathname);
      } else {
        window.history.pushState({ tab, isUnlocked: true }, '', `#${tab}`);
      }
    }


    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    incrementStat(`visit_${tab}`);
    trackSectionVisit(tab);
    logNativeActivity(`🚶 ${site.name} moved to <b>${tab}</b> section`);

    // When navigating away from secret letter, resume main background music (Saiyaara)
    if (tab !== 'secret-letter') {
      setIsSecretLetterOpenInView(false);
      if (isPlayingMusic || romanticAudio.getIsPlaying()) {
        romanticAudio.playTrack(site.musicUrl);
      }
    } else {
      // If entering secret-letter and it's not yet unlocked with password, keep playing Saiyaara
      if (!isSecretLetterOpenInView && (isPlayingMusic || romanticAudio.getIsPlaying())) {
        romanticAudio.playTrack(site.musicUrl);
      }
    }

    setProgress((prev) => {
      const currentSections = prev.sectionsOpened || [];
      const updatedSections = currentSections.includes(tab)
        ? currentSections
        : [...currentSections, tab];
      return {
        ...prev,
        lastVisitedSection: tab,
        sectionsOpened: updatedSections,
        lastActivityDate: new Date().toISOString(),
      };
    });
  };

  const handleTabSelectRef = useRef(handleTabSelect);
  useEffect(() => {
    handleTabSelectRef.current = handleTabSelect;
  });

  // Android Hardware / Gesture Back Button listener (popstate)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Initialize root history state on mount
    const currentTab = activeTab;
    if (currentTab !== 'home') {
      window.history.replaceState({ tab: 'home', isUnlocked: true }, '', window.location.pathname);
      window.history.pushState({ tab: currentTab, isUnlocked: true }, '', `#${currentTab}`);
    } else {
      window.history.replaceState({ tab: 'home', isUnlocked: true }, '', window.location.pathname);
    }

    const handlePopState = (event: PopStateEvent) => {

      // 2. Identify destination tab from history state or URL hash
      const rawHash = window.location.hash.replace('#', '');
      const targetTab: NavTab = event.state?.tab || (rawHash ? (rawHash as NavTab) : 'home');

      // 3. Switch to target tab (e.g. Home) without pushing extra duplicate history
      handleTabSelectRef.current(targetTab, false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Digital Hug Action: Increments hug count and saves
  const handleSendHug = () => {
    triggerHaptic(40);
    showNativeToast(`Warm Hug Sent! 🫂💖`);
    logNativeActivity(`🫂 ${site.name} sent a warm hug!`);
    incrementStat('hugs');
    setProgress((prev) => ({
      ...prev,
      hugCount: prev.hugCount + 1,
      lastActivityDate: new Date().toISOString(),
    }));
  };

  // Envelope Open Tracker: Persists opened envelope IDs
  const handleOpenEnvelope = (id: string) => {
    triggerHaptic(40);
    logNativeActivity(`💌 ${site.name} opened an envelope: <b>${id}</b>`);
    setProgress((prev) => {
      if (prev.openedEnvelopes.includes(id)) return prev;
      return {
        ...prev,
        openedEnvelopes: [...prev.openedEnvelopes, id],
        lastActivityDate: new Date().toISOString(),
      };
    });
  };

  // Game Victory Tracker
  const handleGameWin = () => {
    triggerHaptic(50);
    showNativeToast("Mini-Game Won! 💖🏆");
    logNativeActivity(`🎮 ${site.name} completed a Mini-Game!`);
    setProgress((prev) => ({
      ...prev,
      games: {
        ...prev.games,
        played: (prev.games.played || 0) + 1,
        wins: prev.games.wins + 1,
      },
      lastActivityDate: new Date().toISOString(),
    }));
  };

  // High Score Tracker
  const handleUpdateHighScore = (game: string, score: number) => {
    if (game.toLowerCase().includes('quiz')) {
      logNativeActivity("🎮 Kashish completed the Quiz Game with score: " + score);
    } else {
      logNativeActivity("🎮 Kashish completed the " + game + " Game with score: " + score);
    }
    setProgress((prev) => {
      const current = prev.games.highScores[game] || 0;
      const nextScore = Math.max(current, score);
      return {
        ...prev,
        games: {
          ...prev.games,
          played: (prev.games.played || 0) + 1,
          highScores: {
            ...prev.games.highScores,
            [game]: nextScore,
          },
        },
        lastActivityDate: new Date().toISOString(),
      };
    });
  };

  // Secret Letter Unlock (triggered strictly upon entering correct password)
  const handleUnlockSecretLetter = () => {
    setIsSecretLetterOpenInView(true);
    triggerHaptic(40);
    showNativeToast("Letter Unlocked! 💌");
    logNativeActivity("💌 Kashish opened Secret Letter: A Letter For You");
    setProgress((prev) => ({
      ...prev,
      secretLetterOpened: true,
      lastActivityDate: new Date().toISOString(),
    }));
  };


  // Storage Settings: Toggle Save
  const handleToggleSaveEnabled = (enabled: boolean) => {
    setProgress((prev) => ({
      ...prev,
      saveEnabled: enabled,
    }));
  };



  return (
    <div
      style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}
      className="min-h-screen min-h-[100dvh] relative font-sans transition-colors duration-300 selection:bg-rose-200 selection:text-rose-900 overflow-x-clip"
    >
      {/* Background Floating Hearts, Rose Petals and Twinkling Stars */}
      <BackgroundEffects isDarkMode={isDarkMode} />

      {/* Heart-beat Loading Screen during initial asset preload & auth session restore */}
      {(isLoadingAssets || approvalStatus === 'loading') && (
        <div
          role="status"
          aria-label="Loading assets"
          style={{
            backgroundColor: isDarkMode ? '#12071a' : '#fff5f8',
            transition: 'opacity 0.4s cubic-bezier(0.65, 0, 0.35, 1)',
            transform: 'translateZ(0)',
          }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center select-none"
        >
          <div className="relative flex items-center justify-center">
            <div
              className="absolute w-36 h-36 rounded-full pointer-events-none opacity-40 animate-pulse"
              style={{
                background: 'radial-gradient(circle, rgba(244, 114, 182, 0.5) 0%, rgba(251, 191, 36, 0.25) 50%, transparent 70%)',
                filter: 'blur(20px)',
              }}
            />
            <Heart className="w-14 h-14 text-rose-500 fill-rose-500 animate-heartbeat drop-shadow-[0_0_16px_rgba(244,114,182,0.85)]" />
          </div>

          <p
            style={{ fontFamily: "'Caveat', cursive", color: 'var(--text)' }}
            className="text-2xl mt-4 font-bold tracking-wide"
          >
            Opening {site.name}'s World...
          </p>
        </div>
      )}

      {/* Mandatory APK Update Gate (Blocks app usage until she downloads & installs the latest APK) */}
      {(() => {
        const isAdminUser = auth.currentUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
        if (isAdminUser) return null;

        const runningInApk = isNativeApp();
        const shouldCheckDevice = runningInApk || site.apkApplyToWeb === true;
        if (!shouldCheckDevice) return null;

        const targetVersion =
          site.apkAutoUpdateOnPush && liveApkMeta?.version && isVersionOlder(site.apkLatestVersion || '3.0.0', liveApkMeta.version)
            ? liveApkMeta.version
            : site.apkLatestVersion || liveApkMeta?.version || '3.0.0';

        const isOutdatedByAutoPush =
          runningInApk &&
          site.apkAutoUpdateOnPush !== false &&
          Boolean(targetVersion) &&
          isVersionOlder(installedApkVer, targetVersion);

        const isForcedByAdmin =
          site.apkUpdateRequired === true &&
          (!runningInApk || isVersionOlder(installedApkVer, targetVersion));

        if (!isOutdatedByAutoPush && !isForcedByAdmin) return null;

        const downloadUrl =
          site.apkDownloadUrl?.trim() ||
          liveApkMeta?.apkUrl ||
          liveApkMeta?.githubReleaseApkUrl ||
          'https://kashishji.web.app/Kashishhh.apk';

        return (
          <div className="fixed inset-0 z-[1550] bg-[#12071a]/98 backdrop-blur-xl text-white flex flex-col items-center justify-center p-6 text-center select-none">
            <div className="max-w-md w-full rounded-3xl border border-pink-500/35 bg-gradient-to-b from-[#230e2e] to-[#16081f] p-6 sm:p-7 shadow-[0_0_50px_rgba(244,63,94,0.28)] space-y-5">
              <div className="relative mx-auto w-24 h-24 rounded-full p-1 bg-gradient-to-tr from-pink-500 via-rose-400 to-amber-300 shadow-lg">
                <img
                  src="/apple-touch-icon.png"
                  alt="Kashishhh"
                  className="w-full h-full rounded-full object-cover"
                />
                <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-rose-500 border-2 border-[#16081f] flex items-center justify-center shadow">
                  <Sparkles className="w-4 h-4 text-white" />
                </span>
              </div>

              <div className="space-y-1.5">
                <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-pink-500/20 text-pink-300 border border-pink-500/30">
                  Mandatory App Update Required
                </span>
                <h2 className="font-serif text-2xl sm:text-3xl font-bold text-white pt-1">
                  {site.apkUpdateTitle || 'New Update Available for Kashishhh 💖'}
                </h2>
                <p className="text-xs sm:text-sm text-pink-100/80 leading-relaxed">
                  {site.apkUpdateNotes ||
                    'A brand new version of your app is ready with new surprises, smoother performance & upgraded icons! Please download & install the update to continue.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 p-3 rounded-2xl bg-black/35 border border-white/10 text-xs">
                <div className="text-left">
                  <div className="text-pink-200/60 text-[10px] uppercase">Installed Version</div>
                  <div className="font-bold text-rose-300 text-sm">
                    {runningInApk ? `v${installedApkVer}` : 'Old Version'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-pink-200/60 text-[10px] uppercase">New Release Version</div>
                  <div className="font-bold text-emerald-300 text-sm">v{targetVersion}</div>
                </div>
              </div>

              <div className="space-y-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => openApkDownloadUrl(downloadUrl)}
                  className="w-full py-3.5 px-5 rounded-2xl font-bold text-sm sm:text-base text-white bg-gradient-to-r from-pink-500 via-rose-500 to-pink-600 shadow-[0_8px_25px_rgba(244,63,94,0.45)] flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-transform"
                >
                  <Download className="w-5 h-5" />
                  <span>Download & Install Update Now (v{targetVersion})</span>
                </button>

                {liveApkMeta?.githubReleaseApkUrl &&
                  liveApkMeta.githubReleaseApkUrl !== downloadUrl && (
                    <button
                      type="button"
                      onClick={() => openApkDownloadUrl(liveApkMeta.githubReleaseApkUrl!)}
                      className="w-full py-2.5 px-4 rounded-xl font-semibold text-xs text-pink-200 bg-white/5 border border-white/15 hover:bg-white/10 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Mirror Link: Download from GitHub Release</span>
                    </button>
                  )}

                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="w-full py-2 text-[11px] text-pink-200/70 hover:text-white flex items-center justify-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Already installed the new APK? Tap to Refresh</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Maintenance Mode Gate (for non-admin users) */}
      {site.maintenanceMode && auth.currentUser?.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase() && (
        <div className="fixed inset-0 z-[1400] bg-black/95 text-white flex flex-col items-center justify-center p-6 text-center space-y-3">
          <Heart className="w-10 h-10 text-rose-500 fill-rose-500" />
          <h2 className="font-serif text-2xl font-bold">{site.name}'s World</h2>
          <p className="text-sm text-neutral-300 max-w-md">{site.maintenanceMessage}</p>
        </div>
      )}

      {/* Lock Page: Mounts NostalgicLockScreen when locked, unapproved, or when forceLock is active for non-admin */}
      {!isUnlocked ||
      approvalStatus !== 'approved' ||
      (site.forceLock && authUser?.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) ? (
        <NostalgicLockScreen
          name={site.name}
          lockPhotoUrl={site.lockPhotoUrl}
          expectedPassword={site.entryPassword}
          expectedHash={site.entryLockHash}
          hintText={site.entryLockHint}
          placeholder={site.entryPlaceholder}
          onUnlock={handleUnlock}
          isDarkMode={isDarkMode}
          onToggleDarkMode={handleToggleDarkMode}
          approvalStatus={approvalStatus}
          currentUserEmail={authUser?.email}
          currentUserName={authUser?.displayName}
          onSignOutUser={handleLockAgain}
          onShowAdmin={() => setIsAdminOpen(true)}
        />
      ) : (
        /* Main Website: Created only after correct unlock */
        <div className="relative z-10 min-h-screen min-h-[100dvh] flex flex-col justify-between animate-fade-in overflow-x-clip">
          {/* Top Bar Navigation */}
          <Navbar
            name={site.name}
            activeTab={activeTab}
            onSelectTab={handleTabSelect}
            isDarkMode={isDarkMode}
            onToggleDarkMode={handleToggleDarkMode}
            isPlayingMusic={isPlayingMusic}
            onToggleMusic={handleToggleMusic}
            onReopenEnvelope={handleLockAgain}
            onShowAdmin={() => setIsAdminOpen(true)}
          />

          {/* Main Content Area with 60fps section cross-fade and small translate3d */}
          <main className="flex-1 max-w-4xl mx-auto w-full px-3 sm:px-6 pt-2 sm:pt-3 pb-6 sm:pb-8 overflow-x-clip">
            <div key={activeTab} className="section-fade-slide">
              {activeTab === 'home' && (
              <HomeSection
                name={site.name}
                birthday={site.birthday}
                favouriteSong={site.favouriteSong}
                favouriteColour={site.favouriteColour}
                onNavigate={handleTabSelect}
                isDarkMode={isDarkMode}
                hugCount={progress.hugCount}
                onSendHug={handleSendHug}
              />
            )}

            {activeTab === 'gallery' && (
              <GallerySection
                name={site.name}
                isDarkMode={isDarkMode}
                onBack={() => handleTabSelect('home')}
              />
            )}

            {activeTab === 'breathe' && (
              <BreatheSection name={site.name} isDarkMode={isDarkMode} />
            )}

            {activeTab === 'open-when' && (
              <OpenWhenSection
                name={site.name}
                envelopes={site.openWhen}
                isDarkMode={isDarkMode}
                openedIds={progress.openedEnvelopes}
                onOpenEnvelope={handleOpenEnvelope}
                onSendHug={handleSendHug}
              />
            )}

            {activeTab === 'games' && (
              <GamesSection
                name={site.name}
                compliments={site.compliments}
                isDarkMode={isDarkMode}
                onGameWin={handleGameWin}
                onUpdateHighScore={handleUpdateHighScore}
              />
            )}


            {activeTab === 'cute-pic' && (
              <CutePicSection onBack={() => handleTabSelect('home')} />
            )}

            {activeTab === 'poetry' && (
              <PoetrySection name={site.name} isDarkMode={isDarkMode} />
            )}

            {activeTab === 'secret-letter' && (
              <SecretLetterSection
                name={site.name}
                passwordHash=""
                passwordHint={site.passwordHint}
                personalMessage={site.personalMessage}
                isDarkMode={isDarkMode}
                onUnlockLetter={handleUnlockSecretLetter}
              />
            )}

            {activeTab === 'name-game' && (
              <NameGameSection name={site.name} isDarkMode={isDarkMode} />
            )}

            {activeTab === 'last-page' && (
              <LastPageSection
                name={site.name}
                personalMessage={site.personalMessage}
                isDarkMode={isDarkMode}
              />
            )}

            {activeTab.startsWith('custom_tab_') && (() => {
              const tabMeta = (site.customTabs || []).find((t) => t.id === activeTab);
              return (
                <div className="space-y-4 py-2">
                  {tabMeta && (
                    <div
                      style={{
                        backgroundColor: 'var(--card)',
                        borderColor: 'var(--card-border)',
                      }}
                      className="p-5 sm:p-6 rounded-3xl border text-center space-y-1.5 shadow-xs"
                    >
                      <div className="text-3xl mb-1">{tabMeta.emoji || '✨'}</div>
                      <h2 className="font-serif text-xl sm:text-2xl font-bold text-[var(--text)]">
                        {tabMeta.label}
                      </h2>
                      {tabMeta.subtitle && (
                        <p className="text-xs sm:text-sm text-[var(--text-soft)]">
                          {tabMeta.subtitle}
                        </p>
                      )}
                    </div>
                  )}
                  <DynamicSlot
                    slotId={activeTab}
                    onNavigate={handleTabSelect}
                    isDarkMode={isDarkMode}
                  />
                </div>
              );
            })()}

            {activeTab !== 'home' && (
              <div className="pt-10 pb-4 text-center">
                <button
                  onClick={() => handleTabSelect('home')}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-full border text-sm font-bold shadow-md cursor-pointer transition-transform active:scale-95 hover:scale-105"
                  style={{
                    backgroundColor: 'var(--card-subtle)',
                    borderColor: 'var(--card-border)',
                    color: 'var(--accent)',
                  }}
                >
                  <Home className="w-4 h-4" />
                  <span>Back to Home</span>
                </button>
              </div>
            )}
            </div>
          </main>

          {/* Real-Time Notifications & Truecaller-Style Overlay Popups */}
          <LiveOverlaysAndNotifications
            onNavigate={handleTabSelect}
            defaultCallNumber={site.callPhoneNumber || '9817905531'}
          />
        </div>
      )}

      {/* Full-Screen Kashish Control Center (mounted only when open for zero background overhead) */}
      {isAdminOpen && (
        <AdminPanel
          isOpen={isAdminOpen}
          onClose={() => setIsAdminOpen(false)}
        />
      )}
    </div>
  );
}
