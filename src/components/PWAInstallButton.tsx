import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Heart,
  Share,
  PlusSquare,
  Sparkles,
  X,
  CheckCircle2,
  MoreVertical,
  Smartphone,
  ExternalLink,
  Download,
} from 'lucide-react';
import { useSite } from '../siteContent';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { isNativeApp } from '../androidBridge';

interface PWAInstallButtonProps {
  variant?: 'floating' | 'settings' | 'inline' | 'header';
  isUnlocked?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'floating',
  isUnlocked = true,
}) => {
  const site = useSite();
  // If running inside native Android APK app wrapper, hide all browser-specific install prompts
  if (isNativeApp() || !isUnlocked) {
    return null;
  }

  const {
    isInstalled,
    hasDeferredPrompt,
    isIOS,
    showIOSGuide,
    setShowIOSGuide,
    showChromeGuide,
    setShowChromeGuide,
    installSuccessMsg,
    isDismissed,
    handleDismiss,
    install,
  } = usePWAInstall();

  // Local state to display the dedicated App Install popup modal on click
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [activeGuideTab, setActiveGuideTab] = useState<'android' | 'ios'>(() => (isIOS ? 'ios' : 'android'));

  const anyModalOpen = isInstallModalOpen || showChromeGuide || showIOSGuide;
  useEffect(() => {
    if (!anyModalOpen) return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [anyModalOpen]);

  // If lock page is not unlocked yet, do not show button
  if (!isUnlocked) {
    return null;
  }

  // Settings / Inline variant when already installed
  if (isInstalled && (variant === 'settings' || variant === 'inline')) {
    return (
      <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-rose-200 text-xs font-semibold flex items-center gap-2.5 shadow-xs">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        <span>{site.name} is in your heart, and on your home screen 💗</span>
      </div>
    );
  }

  // Floating variant dismissed or already installed
  if ((isDismissed || isInstalled) && variant === 'floating') {
    return null;
  }

  const handleOpenDirect = () => {
    if (typeof window !== 'undefined') {
      window.open(window.location.href, '_blank', 'noopener,noreferrer');
    }
  };

  const handleHeaderClick = () => {
    // Show dedicated app install popup modal immediately upon clicking header download icon
    setIsInstallModalOpen(true);
  };

  const handleModalInstall = async () => {
    const res = await install();
    if (res) {
      setIsInstallModalOpen(false);
    } else if (isIOS) {
      setActiveGuideTab('ios');
    } else {
      setActiveGuideTab('android');
    }
  };

  return (
    <>
      {/* Toast Notification after successful installation */}
      {installSuccessMsg && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90%] p-4 rounded-2xl bg-gradient-to-r from-rose-950/95 via-purple-950/95 to-stone-900/95 border border-rose-500/40 shadow-2xl text-center animate-slide-down backdrop-blur-xl">
          <p className="text-rose-100 text-xs sm:text-sm font-serif font-bold flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>{installSuccessMsg}</span>
          </p>
        </div>
      )}

      {/* HEADER COMPACT DOWNLOAD BUTTON (Matching Music & Theme circular buttons) */}
      {variant === 'header' && (
        <button
          type="button"
          onClick={handleHeaderClick}
          title="Download & Install App"
          aria-label="Download & Install App"
          style={{
            backgroundColor: 'var(--card-subtle)',
            color: 'var(--text)',
            borderColor: 'var(--card-border)',
          }}
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border border-[var(--accent)]/40 hover:border-[var(--accent)] transition-all flex items-center justify-center relative cursor-pointer shadow-xs active:scale-95 shrink-0 group hover:shadow-[0_0_12px_rgba(244,63,94,0.35)]"
        >
          <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[var(--accent)] group-hover:scale-115 transition-transform" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-gradient-to-r from-amber-400 to-rose-400 rounded-full animate-ping" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full" />
        </button>
      )}

      {/* FLOATING BUTTON (Home Section) */}
      {variant === 'floating' && (
        <div className="fixed bottom-20 sm:bottom-24 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1 max-w-xs w-full px-4 animate-fade-in">
          <button
            onClick={handleHeaderClick}
            className="w-full min-h-[48px] px-5 py-2.5 rounded-full bg-gradient-to-r from-rose-500 via-pink-600 to-rose-500 text-white font-bold text-sm shadow-[0_0_25px_rgba(244,63,94,0.4)] border border-rose-300/40 hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer group"
            aria-label="Add app to home screen"
          >
            <Download className="w-4 h-4 text-white group-hover:animate-bounce shrink-0" />
            <span>{site.installButtonText || "Add to My Heart 💗"}</span>
            <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
          </button>

          <button
            onClick={handleDismiss}
            className="text-[11px] text-rose-300/70 hover:text-rose-100 transition-colors py-1 px-3 underline decoration-rose-400/40 cursor-pointer font-medium"
          >
            Maybe later
          </button>
        </div>
      )}

      {/* SETTINGS / INLINE BUTTON (Inside HiddenStatsModal or More Drawer) */}
      {(variant === 'settings' || variant === 'inline') && (
        <div className="space-y-1.5 w-full">
          <button
            onClick={handleHeaderClick}
            className="w-full min-h-[48px] px-4 py-3 rounded-2xl bg-gradient-to-r from-rose-500/20 via-pink-600/20 to-purple-600/20 border border-rose-500/30 text-rose-100 font-bold text-xs sm:text-sm shadow-xs hover:bg-rose-500/30 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer group"
          >
            <Download className="w-4 h-4 text-rose-400 group-hover:scale-110 transition-transform shrink-0" />
            <span>{site.installButtonText || "Add to My Heart 💗"}</span>
            <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
          </button>
          <p className="text-[10px] text-rose-300/60 text-center font-mono">
            Install on your home screen for quick offline access
          </p>
        </div>
      )}

      {/* 📲 COMPREHENSIVE APP INSTALL POPUP MODAL */}
      {isInstallModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[1500] w-screen h-[100dvh] max-h-[100dvh] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in overflow-hidden overscroll-none"
            onClick={() => setIsInstallModalOpen(false)}
          >
          <div
            className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#1e0f2b] via-[#160a24] to-[#0e051a] border border-rose-500/40 p-5 sm:p-6 shadow-2xl space-y-4 text-center relative overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setIsInstallModalOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full text-rose-300/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Close install modal"
            >
              <X className="w-5 h-5" />
            </button>

            {/* App Icon with glowing circular frame */}
            <div className="relative w-18 h-18 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-2xl bg-rose-500/20 blur-md animate-pulse" />
              <img
                src={site.appIconUrl}
                alt={`${site.name}'s World App Icon`}
                className="w-16 h-16 rounded-2xl border-2 border-rose-400/60 shadow-lg object-cover relative z-10"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (!target.dataset.triedSvg) {
                    target.dataset.triedSvg = 'true';
                    target.src = '/assets/golden_gaze_logo.svg';
                  }
                }}
              />
              <span className="absolute -bottom-1 -right-1 z-20 w-6 h-6 rounded-full bg-[var(--accent)] border-2 border-[#1e0f2b] flex items-center justify-center text-white shadow-xs">
                <Heart className="w-3 h-3 fill-white" />
              </span>
            </div>

            {/* App Header Info */}
            <div className="space-y-1">
              <h3 className="font-serif text-xl sm:text-2xl font-bold text-rose-100">
                Install {site.name}'s World
              </h3>
              <p className="text-xs text-rose-200/80 font-sans leading-relaxed">
                Fast, works offline, and opens full-screen just like a real phone app! 💗
              </p>
            </div>

            {/* Primary Action Button */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={handleModalInstall}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-rose-500 via-pink-600 to-rose-500 text-white font-bold text-sm shadow-lg shadow-rose-600/35 hover:brightness-110 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4 animate-bounce" />
                <span>Install to Home Screen</span>
                <Sparkles className="w-4 h-4 text-amber-200" />
              </button>

              <button
                type="button"
                onClick={handleOpenDirect}
                className="w-full h-9 rounded-2xl bg-white/5 border border-rose-500/20 text-rose-200 font-medium text-xs hover:bg-white/10 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in Chrome / Safari directly</span>
              </button>
            </div>

            {/* Device-Specific Step-by-Step Guide Tabs */}
            <div className="pt-2 text-left">
              <div className="flex border-b border-rose-500/20 mb-3 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setActiveGuideTab('android')}
                  className={`pb-2 px-3 flex-1 text-center transition-colors cursor-pointer ${
                    activeGuideTab === 'android'
                      ? 'border-b-2 border-rose-400 text-rose-100 font-bold'
                      : 'text-rose-300/50 hover:text-rose-200'
                  }`}
                >
                  Android / Chrome
                </button>
                <button
                  type="button"
                  onClick={() => setActiveGuideTab('ios')}
                  className={`pb-2 px-3 flex-1 text-center transition-colors cursor-pointer ${
                    activeGuideTab === 'ios'
                      ? 'border-b-2 border-rose-400 text-rose-100 font-bold'
                      : 'text-rose-300/50 hover:text-rose-200'
                  }`}
                >
                  iPhone / Safari
                </button>
              </div>

              {activeGuideTab === 'android' ? (
                <div className="space-y-2 bg-black/40 border border-rose-500/20 p-3 rounded-2xl text-[11px] sm:text-xs text-rose-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0 text-[10px]">
                      1
                    </div>
                    <p className="flex-1">
                      Tap <MoreVertical className="w-3.5 h-3.5 text-amber-300 inline" /> <strong>3 dots (Menu)</strong> in top right of Chrome.
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0 text-[10px]">
                      2
                    </div>
                    <p className="flex-1">
                      Select <Smartphone className="w-3.5 h-3.5 text-rose-400 inline" /> <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0 text-[10px]">
                      3
                    </div>
                    <p className="flex-1">
                      Tap <strong>Install</strong> — app icon adds to your phone drawer!
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 bg-black/40 border border-rose-500/20 p-3 rounded-2xl text-[11px] sm:text-xs text-rose-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0 text-[10px]">
                      1
                    </div>
                    <p className="flex-1">
                      Tap <Share className="w-3.5 h-3.5 text-blue-400 inline" /> <strong>Share</strong> button in Safari toolbar below.
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0 text-[10px]">
                      2
                    </div>
                    <p className="flex-1">
                      Scroll down & select <PlusSquare className="w-3.5 h-3.5 text-rose-400 inline" /> <strong>"Add to Home Screen"</strong>.
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0 text-[10px]">
                      3
                    </div>
                    <p className="flex-1">
                      Tap <strong>Add</strong> at top right ✨
                    </p>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsInstallModalOpen(false)}
              className="w-full py-2.5 text-xs text-rose-300/70 hover:text-white transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
          </div>,
          document.body
        )}

      {/* CHROME / ANDROID DIRECT MODAL FALLBACK */}
      {showChromeGuide &&
        !isInstallModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[1500] w-screen h-[100dvh] max-h-[100dvh] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in overflow-hidden overscroll-none"
            onClick={() => setShowChromeGuide(false)}
          >
          <div
            className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#1c0f2b] via-[#150a24] to-[#0e051a] border border-rose-500/40 p-6 shadow-2xl space-y-4 text-center relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowChromeGuide(false)}
              className="absolute top-4 right-4 p-2 rounded-full text-rose-300/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Close guide"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 mx-auto rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center">
              <Download className="w-7 h-7 text-rose-500 animate-pulse" />
            </div>

            <div className="space-y-1">
              <h3 className="font-serif text-xl font-bold text-rose-100">
                Install as Mobile App 💗
              </h3>
              <p className="text-xs text-rose-200/70 font-sans">
                Install this website as a native app on your phone's home screen!
              </p>
            </div>

            <div className="space-y-2 text-left bg-black/40 border border-rose-500/20 p-3.5 rounded-2xl text-xs text-rose-100 font-medium">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0 text-xs">
                  1
                </div>
                <p className="flex-1 flex items-center gap-1">
                  Tap <MoreVertical className="w-3.5 h-3.5 text-amber-300 shrink-0 inline" /> <strong>3 dots (Menu)</strong> in top right.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0 text-xs">
                  2
                </div>
                <p className="flex-1 flex items-center gap-1">
                  Select <Smartphone className="w-3.5 h-3.5 text-rose-400 shrink-0 inline" /> <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong>.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0 text-xs">
                  3
                </div>
                <p className="flex-1">
                  Tap <strong>Install</strong> — icon adds to your phone!
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <button
                onClick={handleOpenDirect}
                className="w-full h-11 rounded-full bg-gradient-to-r from-rose-500 to-pink-600 text-white font-bold text-xs shadow-lg shadow-rose-600/30 hover:brightness-110 active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open Direct Link in Chrome</span>
              </button>

              <button
                onClick={() => setShowChromeGuide(false)}
                className="w-full h-9 rounded-full bg-white/10 text-rose-200 font-semibold text-xs hover:bg-white/20 transition-all cursor-pointer"
              >
                Got it, thanks! 💖
              </button>
            </div>
          </div>
          </div>,
          document.body
        )}

      {/* IOS SAFARI DIRECT MODAL FALLBACK */}
      {showIOSGuide &&
        !isInstallModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[1500] w-screen h-[100dvh] max-h-[100dvh] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in overflow-hidden overscroll-none"
            onClick={() => setShowIOSGuide(false)}
          >
          <div
            className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#1c0f2b] via-[#150a24] to-[#0e051a] border border-rose-500/40 p-6 shadow-2xl space-y-5 text-center relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowIOSGuide(false)}
              className="absolute top-4 right-4 p-2 rounded-full text-rose-300/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Close guide"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 mx-auto rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center">
              <Download className="w-7 h-7 text-rose-500 animate-pulse" />
            </div>

            <div className="space-y-1">
              <h3 className="font-serif text-xl font-bold text-rose-100">
                Install on iPhone / Safari 💗
              </h3>
              <p className="text-xs text-rose-200/70 font-sans">
                Follow 3 quick steps to add Kashish to your home screen:
              </p>
            </div>

            <div className="space-y-3 text-left bg-black/40 border border-rose-500/20 p-4 rounded-2xl text-xs text-rose-100 font-medium">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0">
                  1
                </div>
                <p className="flex-1 flex items-center gap-1.5">
                  Tap the <Share className="w-4 h-4 text-blue-400 shrink-0 inline" /> <strong>Share</strong> button in Safari toolbar below.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0">
                  2
                </div>
                <p className="flex-1 flex items-center gap-1.5">
                  Scroll down & select <PlusSquare className="w-4 h-4 text-rose-400 shrink-0 inline" /> <strong>Add to Home Screen</strong>.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-300 font-bold shrink-0">
                  3
                </div>
                <p className="flex-1">
                  Tap <strong>Add</strong> at the top right ✨
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowIOSGuide(false)}
              className="w-full h-11 rounded-full bg-rose-600 text-white font-bold text-xs shadow-lg shadow-rose-600/30 hover:bg-rose-500 transition-all cursor-pointer"
            >
              Got it, thanks! 💖
            </button>
          </div>
          </div>,
          document.body
        )}
    </>
  );
};
