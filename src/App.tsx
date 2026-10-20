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
import { triggerHaptic, showNativeToast, logNativeActivity, incrementStat, trackSectionVisit } from './androidBridge';
import { Heart, Home, Music } from 'lucide-react';
import { DynamicSlot } from './components/DynamicSlot';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, ADMIN_EMAIL } from './firebase';
import { AdminPanel } from './components/AdminPanel';
import { LiveOverlaysAndNotifications } from './components/LiveOverlaysAndNotifications';

export default function App() {
  const site = useSite();
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage.getItem('kashishUnlocked') === 'true';
      }
      return false;
    } catch {
      return false;
    }
  });
  const [isLoadingAssets, setIsLoadingAssets] = useState(true);

  // Sync unlock state with Firebase Authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setIsUnlocked(true);
        try {
          window.sessionStorage.setItem('kashishUnlocked', 'true');
        } catch {}
      } else {
        setIsUnlocked(false);
        try {
          window.sessionStorage.removeItem('kashishUnlocked');
        } catch {}
      }
    });
    return () => unsubscribe();
  }, []);

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

  useEffect(() => {
    if (site.musicEnabled === false) {
      if (romanticAudio.getIsPlaying()) {
        romanticAudio.stop();
      }
    } else if (isUnlocked && site.musicUrl) {
      const targetUrl =
        activeTab === 'secret-letter' && isSecretLetterOpenInView && site.secretLetterMusicUrl
          ? site.secretLetterMusicUrl
          : site.musicUrl;
      if (romanticAudio.getIsPlaying() && romanticAudio.getCurrentUrl() !== targetUrl) {
        romanticAudio.playTrack(targetUrl);
      }
    }
  }, [site.musicEnabled, site.musicUrl, site.secretLetterMusicUrl, isUnlocked, activeTab, isSecretLetterOpenInView]);

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
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
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
    setIsSecretLetterOpenInView(false);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
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

      {/* Heart-beat Loading Screen during initial asset preload (max 2.2s) */}
      {isLoadingAssets && (
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

      {/* Maintenance Mode Gate (for non-admin users) */}
      {site.maintenanceMode && auth.currentUser?.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase() && (
        <div className="fixed inset-0 z-[1400] bg-black/95 text-white flex flex-col items-center justify-center p-6 text-center space-y-3">
          <Heart className="w-10 h-10 text-rose-500 fill-rose-500" />
          <h2 className="font-serif text-2xl font-bold">{site.name}'s World</h2>
          <p className="text-sm text-neutral-300 max-w-md">{site.maintenanceMessage}</p>
        </div>
      )}

      {/* Lock Page: Mounts NostalgicLockScreen when locked or when forceLock is active for non-admin */}
      {!isUnlocked || (site.forceLock && auth.currentUser?.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) ? (
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

          {/* Floating Music Indicator Pill on desktop / tablet */}
          <div className="fixed bottom-6 right-4 z-30 hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md bg-white/80 dark:bg-[#1a0f2b]/80 border border-rose-200 dark:border-rose-900 shadow-sm text-xs text-rose-600 dark:text-rose-300 pointer-events-none">
            <Music className="w-3.5 h-3.5 animate-bounce" />
            <span>{isPlayingMusic ? 'Music playing' : 'Music muted'}</span>
          </div>

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
