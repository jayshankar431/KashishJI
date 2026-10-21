import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, orderBy, limit, updateDoc } from 'firebase/firestore';
import { onIdTokenChanged } from 'firebase/auth';
import { Heart, Phone, Sparkles, ExternalLink, X } from 'lucide-react';
import { auth, db } from '../firebase';
import {
  makeNativePhoneCall,
  showNativeToast,
  triggerHaptic,
  resolveFirestoreMediaUrl,
  triggerNativeSystemOverlay,
  syncNativeAuthToken,
  canDrawOverlays,
} from '../androidBridge';
import type { NavTab } from './Navbar';

interface LiveOverlaysAndNotificationsProps {
  onNavigate: (tab: NavTab) => void;
  defaultCallNumber: string;
}

export type OverlayThemeId = 'velvet-rose' | 'golden-letter' | 'soft-blush' | 'starlight-night';
export type OverlayFontId = 'romantic-serif' | 'handwriting' | 'calligraphy' | 'modern-poppins';

export const OVERLAY_THEMES: Record<
  OverlayThemeId,
  {
    name: string;
    cardBg: string;
    border: string;
    glow: string;
    kickerText: string;
    titleText: string;
    bodyText: string;
    quoteBg: string;
    primaryBtn: string;
    secondaryBtn: string;
    iconBadge: string;
    closeBtn: string;
  }
> = {
  'velvet-rose': {
    name: 'Velvet Rose & Gold',
    cardBg: 'linear-gradient(165deg, #260e36 0%, #150722 52%, #2b0f2e 100%)',
    border: 'rgba(244, 114, 182, 0.36)',
    glow: '0 24px 60px rgba(244, 63, 94, 0.32), 0 0 0 1px rgba(244, 114, 182, 0.22)',
    kickerText: '#f9a8d4',
    titleText: '#fff1f2',
    bodyText: '#fce7f3',
    quoteBg: 'rgba(255, 255, 255, 0.045)',
    primaryBtn: 'linear-gradient(135deg, #f43f5e 0%, #db2777 100%)',
    secondaryBtn: 'rgba(255, 255, 255, 0.08)',
    iconBadge: 'rgba(244, 63, 94, 0.18)',
    closeBtn: 'rgba(255, 255, 255, 0.08)',
  },
  'golden-letter': {
    name: 'Golden Candlelight',
    cardBg: 'linear-gradient(165deg, #261509 0%, #160b04 55%, #2b1708 100%)',
    border: 'rgba(251, 191, 36, 0.38)',
    glow: '0 24px 60px rgba(245, 158, 11, 0.28), 0 0 0 1px rgba(251, 191, 36, 0.22)',
    kickerText: '#fcd34d',
    titleText: '#fffbeb',
    bodyText: '#fef3c7',
    quoteBg: 'rgba(251, 191, 36, 0.06)',
    primaryBtn: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    secondaryBtn: 'rgba(251, 191, 36, 0.1)',
    iconBadge: 'rgba(245, 158, 11, 0.2)',
    closeBtn: 'rgba(251, 191, 36, 0.1)',
  },
  'soft-blush': {
    name: 'Soft Sakura Blush',
    cardBg: 'linear-gradient(165deg, #fff5f8 0%, #ffe6f0 55%, #fff0f5 100%)',
    border: 'rgba(214, 51, 108, 0.28)',
    glow: '0 24px 60px rgba(214, 51, 108, 0.22), 0 0 0 1px rgba(214, 51, 108, 0.16)',
    kickerText: '#be185d',
    titleText: '#4a0e27',
    bodyText: '#5c1634',
    quoteBg: 'rgba(214, 51, 108, 0.06)',
    primaryBtn: 'linear-gradient(135deg, #e11d48 0%, #be185d 100%)',
    secondaryBtn: 'rgba(214, 51, 108, 0.09)',
    iconBadge: 'rgba(225, 29, 72, 0.12)',
    closeBtn: 'rgba(214, 51, 108, 0.1)',
  },
  'starlight-night': {
    name: 'Midnight Starlight',
    cardBg: 'linear-gradient(165deg, #111827 0%, #1e1b4b 55%, #191332 100%)',
    border: 'rgba(196, 181, 253, 0.34)',
    glow: '0 24px 60px rgba(139, 92, 246, 0.3), 0 0 0 1px rgba(196, 181, 253, 0.2)',
    kickerText: '#c4b5fd',
    titleText: '#f5f3ff',
    bodyText: '#ede9fe',
    quoteBg: 'rgba(196, 181, 253, 0.06)',
    primaryBtn: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
    secondaryBtn: 'rgba(255, 255, 255, 0.08)',
    iconBadge: 'rgba(139, 92, 246, 0.2)',
    closeBtn: 'rgba(255, 255, 255, 0.08)',
  },
};

export const OVERLAY_FONTS: Record<
  OverlayFontId,
  {
    name: string;
    titleFont: string;
    bodyFont: string;
    titleSize: string;
    bodySize: string;
  }
> = {
  'romantic-serif': {
    name: 'Romantic Serif (Cormorant & Poppins)',
    titleFont: "'Cormorant Garamond', 'Playfair Display', Georgia, serif",
    bodyFont: "'Poppins', system-ui, sans-serif",
    titleSize: '26px',
    bodySize: '14.5px',
  },
  handwriting: {
    name: 'Love Diary Handwriting (Caveat)',
    titleFont: "'Caveat', 'Indie Flower', cursive",
    bodyFont: "'Caveat', 'Indie Flower', cursive",
    titleSize: '30px',
    bodySize: '21px',
  },
  calligraphy: {
    name: 'Royal Script (Great Vibes & Serif)',
    titleFont: "'Great Vibes', 'Dancing Script', cursive",
    bodyFont: "'Cormorant Garamond', 'Playfair Display', Georgia, serif",
    titleSize: '31px',
    bodySize: '17px',
  },
  'modern-poppins': {
    name: 'Clean Velvet Sans (Poppins)',
    titleFont: "'Poppins', system-ui, sans-serif",
    bodyFont: "'Poppins', system-ui, sans-serif",
    titleSize: '20px',
    bodySize: '14px',
  },
};

export const LiveOverlaysAndNotifications: React.FC<LiveOverlaysAndNotificationsProps> = ({
  onNavigate,
  defaultCallNumber,
}) => {
  const [activeNotif, setActiveNotif] = useState<any | null>(null);
  const [notifImgResolved, setNotifImgResolved] = useState<string>('');
  const [activeOverlay, setActiveOverlay] = useState<any | null>(null);
  const [overlayImgResolved, setOverlayImgResolved] = useState<string>('');
  const overlayAudioRef = React.useRef<HTMLAudioElement | null>(null);

  const stopOverlayAudio = () => {
    try {
      if (overlayAudioRef.current) {
        overlayAudioRef.current.pause();
        overlayAudioRef.current.currentTime = 0;
        overlayAudioRef.current = null;
      }
    } catch {}
  };

  useEffect(() => {
    const seenNotifIds = new Set<string>(
      JSON.parse(localStorage.getItem('kashish_seen_notifs') || '[]')
    );

    const qNotifs = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(5));
    const unsubNotifs = onSnapshot(
      qNotifs,
      (snap) => {
        const now = Date.now();
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (seenNotifIds.has(docSnap.id) || d.seen) return;
          if (d.scheduledFor && d.scheduledFor > now) return;

          // Only show notifications created within the last 24 hours
          if (d.createdAt && now - d.createdAt < 86400000) {
            seenNotifIds.add(docSnap.id);
            try {
              localStorage.setItem('kashish_seen_notifs', JSON.stringify(Array.from(seenNotifIds)));
            } catch {}

            setActiveNotif({ id: docSnap.id, ...d });
            triggerHaptic(60);

            if (d.soundUrl && d.soundUrl !== 'silent') {
              resolveFirestoreMediaUrl(d.soundUrl).then((playUrl) => {
                if (!playUrl) return;
                const audio = new Audio(playUrl);
                audio.volume = 0.85;
                audio.play().catch(() => {});
              });
            }

            if (typeof window !== 'undefined' && window.AndroidApp) {
              const buttonsJson = JSON.stringify(Array.isArray(d.buttons) ? d.buttons : []);
              if (window.AndroidApp.showNotificationWithButtons) {
                window.AndroidApp.showNotificationWithButtons(
                  d.title || 'New Message',
                  d.message || '',
                  buttonsJson,
                  docSnap.id
                );
              } else if (window.AndroidApp.showNotification) {
                window.AndroidApp.showNotification(d.title || 'New Message', d.message || '');
              }
            }

            updateDoc(doc(db, 'notifications', docSnap.id), {
              seen: true,
              seenAt: Date.now(),
            }).catch(() => {});
          }
        });
      },
      () => {}
    );

    const seenOverlayIds = new Set<string>(
      JSON.parse(localStorage.getItem('kashish_seen_overlays') || '[]')
    );

    const qOverlays = query(collection(db, 'overlays'), orderBy('createdAt', 'desc'), limit(5));
    const unsubOverlays = onSnapshot(
      qOverlays,
      (snap) => {
        const now = Date.now();
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (seenOverlayIds.has(docSnap.id) || d.dismissed) return;
          if (d.scheduledFor && d.scheduledFor > now) return;

          if (d.createdAt && now - d.createdAt < 86400000) {
            seenOverlayIds.add(docSnap.id);
            try {
              localStorage.setItem('kashish_seen_overlays', JSON.stringify(Array.from(seenOverlayIds)));
            } catch {}

            const fullOverlay = {
              id: docSnap.id,
              ...d,
              phoneNumber: defaultCallNumber,
            };

            // If running inside the Android APK and SYSTEM_ALERT_WINDOW is enabled (or app is in background),
            // also trigger the native Truecaller-style SYSTEM_ALERT_WINDOW + WakeLock popup!
            let nativeOverlayDispatched = false;
            if (typeof document !== 'undefined' && (document.hidden || canDrawOverlays())) {
              nativeOverlayDispatched = triggerNativeSystemOverlay(fullOverlay);
            }

            // Play custom overlay sound in Web / WebView if native system overlay isn't already playing it
            if (!nativeOverlayDispatched && d.soundUrl && d.soundUrl !== 'silent') {
              resolveFirestoreMediaUrl(d.soundUrl).then((playUrl) => {
                if (!playUrl) return;
                stopOverlayAudio();
                const audio = new Audio(playUrl);
                audio.volume = 0.9;
                overlayAudioRef.current = audio;
                audio.play().catch(() => {});
              });
            }

            setActiveOverlay(fullOverlay);
            triggerHaptic(80);
          }
        });
      },
      () => {}
    );

    const unsubToken = onIdTokenChanged(auth, async (user) => {
      if (user) {
        try {
          const token = await user.getIdToken();
          syncNativeAuthToken(token);
        } catch {}
      }
    });

    const handleNativeOpenSection = (e: Event) => {
      const customEv = e as CustomEvent<string>;
      if (customEv.detail) {
        onNavigate(customEv.detail as NavTab);
      }
    };
    window.addEventListener('kashish-open-section', handleNativeOpenSection);

    return () => {
      unsubNotifs();
      unsubOverlays();
      unsubToken();
      stopOverlayAudio();
      window.removeEventListener('kashish-open-section', handleNativeOpenSection);
    };
  }, [defaultCallNumber, onNavigate]);

  useEffect(() => {
    if (activeNotif?.imageUrl) {
      resolveFirestoreMediaUrl(activeNotif.imageUrl).then(setNotifImgResolved);
    } else {
      setNotifImgResolved('');
    }
  }, [activeNotif]);

  useEffect(() => {
    if (activeOverlay?.imageUrl) {
      resolveFirestoreMediaUrl(activeOverlay.imageUrl).then(setOverlayImgResolved);
    } else {
      setOverlayImgResolved('');
    }
  }, [activeOverlay]);

  const handleNotifButton = (btn: { label: string; action: string; payload?: string }) => {
    if (!activeNotif) return;
    const notifId = activeNotif.id;
    setActiveNotif(null);

    updateDoc(doc(db, 'notifications', notifId), {
      seen: true,
      clickedAction: btn.action,
      seenAt: Date.now(),
    }).catch(() => {});

    if (btn.action === 'call_now') {
      void makeNativePhoneCall(btn.payload || defaultCallNumber);
    } else if (btn.action === 'open_section') {
      const target = (btn.payload || 'home') as NavTab;
      onNavigate(target);
    } else if (btn.action === 'open_url' && btn.payload) {
      window.location.href = btn.payload;
    }
  };

  const handleOverlayButton = (btn: { label: string; action: string; payload?: string }) => {
    if (!activeOverlay) return;
    const overlayId = activeOverlay.id;
    stopOverlayAudio();
    setActiveOverlay(null);

    updateDoc(doc(db, 'overlays', overlayId), {
      dismissed: true,
      clickedAction: btn.action,
      seenAt: Date.now(),
    }).catch(() => {});

    if (btn.action === 'call_now') {
      void makeNativePhoneCall(btn.payload || defaultCallNumber);
    } else if (btn.action === 'open_section') {
      const target = (btn.payload || 'home') as NavTab;
      onNavigate(target);
      showNativeToast(`Opened ${target}`);
    } else if (btn.action === 'open_url' && btn.payload) {
      window.location.href = btn.payload;
    }
  };

  const getButtonIcon = (action?: string) => {
    if (action === 'call_now') return <Phone className="w-4 h-4 shrink-0" />;
    if (action === 'open_section') return <Sparkles className="w-4 h-4 shrink-0" />;
    if (action === 'open_url') return <ExternalLink className="w-4 h-4 shrink-0" />;
    return <Heart className="w-4 h-4 shrink-0 fill-current" />;
  };

  const themeKey: OverlayThemeId =
    activeOverlay?.theme && OVERLAY_THEMES[activeOverlay.theme as OverlayThemeId]
      ? (activeOverlay.theme as OverlayThemeId)
      : 'velvet-rose';
  const fontKey: OverlayFontId =
    activeOverlay?.fontStyle && OVERLAY_FONTS[activeOverlay.fontStyle as OverlayFontId]
      ? (activeOverlay.fontStyle as OverlayFontId)
      : 'romantic-serif';

  const currentTheme = OVERLAY_THEMES[themeKey];
  const currentFont = OVERLAY_FONTS[fontKey];
  const isLightBlush = themeKey === 'soft-blush';

  return (
    <>
      {/* Real-time Romantic Notification Banner (with optional Action Buttons) */}
      {activeNotif && (
        <div
          style={{
            background: 'linear-gradient(145deg, rgba(36, 14, 53, 0.96) 0%, rgba(22, 8, 36, 0.98) 100%)',
            borderColor: 'rgba(244, 114, 182, 0.38)',
            boxShadow: '0 18px 45px rgba(244, 63, 94, 0.28), 0 0 0 1px rgba(244, 114, 182, 0.18)',
          }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[1500] w-[92%] max-w-md text-pink-50 border p-4 rounded-[22px] backdrop-blur-xl flex flex-col gap-3 section-fade-slide"
        >
          <div className="flex items-center gap-3.5">
            {notifImgResolved ? (
              <img
                src={notifImgResolved}
                alt=""
                className="w-13 h-13 rounded-[14px] object-cover shrink-0 border border-pink-400/40"
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-rose-500/20 border border-pink-400/35 flex items-center justify-center shrink-0">
                <Heart className="w-5 h-5 text-rose-400 fill-rose-400 animate-heartbeat" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-pink-300/80 tracking-wide">
                A Note For You · Just Now
              </div>
              <div
                style={{ fontFamily: "'Cormorant Garamond', 'Playfair Display', Georgia, serif" }}
                className="text-[19px] font-bold text-white leading-tight truncate mt-0.5"
              >
                {activeNotif.title || 'Special Message'}
              </div>
              <div
                style={{ fontFamily: "'Poppins', system-ui, sans-serif" }}
                className="text-[13px] text-pink-100/90 mt-1 leading-snug break-words"
              >
                {activeNotif.message}
              </div>
            </div>

            <button
              onClick={() => setActiveNotif(null)}
              aria-label="Dismiss notification"
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-pink-200 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {Array.isArray(activeNotif.buttons) && activeNotif.buttons.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1 border-t border-pink-400/20">
              {activeNotif.buttons.slice(0, 3).map((btn: any, idx: number) => {
                const isPrimary = idx === 0;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleNotifButton(btn)}
                    style={
                      isPrimary
                        ? {
                            background: 'linear-gradient(135deg, #f43f5e 0%, #db2777 100%)',
                            color: '#ffffff',
                          }
                        : {
                            background: 'rgba(255, 255, 255, 0.09)',
                            color: '#fce7f3',
                            borderColor: 'rgba(244, 114, 182, 0.3)',
                          }
                    }
                    className={`flex-1 min-w-[110px] py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-transform active:scale-[0.98] ${
                      isPrimary ? 'border-0 shadow-sm' : 'border'
                    }`}
                  >
                    {getButtonIcon(btn.action)}
                    <span className="truncate">{btn.label || 'Open'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Romantic Live Overlay Popup */}
      {activeOverlay && (
        <div className="fixed inset-0 z-[1600] bg-[#0a0412]/80 backdrop-blur-md flex items-center justify-center p-4 section-fade-slide">
          <div
            style={{
              background: currentTheme.cardBg,
              borderColor: currentTheme.border,
              boxShadow: currentTheme.glow,
            }}
            className="relative w-full max-w-sm rounded-[28px] border overflow-hidden p-6 text-center space-y-4"
          >
            {/* Dismiss button in top-right */}
            <button
              onClick={() => {
                stopOverlayAudio();
                updateDoc(doc(db, 'overlays', activeOverlay.id), { dismissed: true }).catch(() => {});
                setActiveOverlay(null);
              }}
              aria-label="Close message"
              style={{
                background: currentTheme.closeBtn,
                color: currentTheme.kickerText,
              }}
              className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center hover:opacity-80 cursor-pointer transition-opacity"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Top Romantic Kicker */}
            <div
              style={{ color: currentTheme.kickerText, fontFamily: "'Poppins', system-ui, sans-serif" }}
              className="flex items-center justify-center gap-1.5 text-[11px] font-medium tracking-widest uppercase pt-1"
            >
              <Heart className="w-3 h-3 fill-current" />
              <span>A Special Note For Kashish</span>
              <Heart className="w-3 h-3 fill-current" />
            </div>

            {/* Avatar / Image or Beating Heart Emblem */}
            <div className="pt-1 flex justify-center">
              {overlayImgResolved ? (
                <div
                  style={{ borderColor: currentTheme.border }}
                  className="p-1 rounded-full border-2"
                >
                  <img
                    src={overlayImgResolved}
                    alt=""
                    className="w-24 h-24 rounded-full object-cover"
                  />
                </div>
              ) : (
                <div
                  style={{
                    background: currentTheme.iconBadge,
                    borderColor: currentTheme.border,
                  }}
                  className="w-16 h-16 rounded-full border flex items-center justify-center"
                >
                  <Heart
                    style={{ color: currentTheme.kickerText }}
                    className="w-8 h-8 fill-current animate-heartbeat"
                  />
                </div>
              )}
            </div>

            {/* Title */}
            <h3
              style={{
                fontFamily: currentFont.titleFont,
                fontSize: currentFont.titleSize,
                color: currentTheme.titleText,
              }}
              className="font-bold leading-tight px-2"
            >
              {activeOverlay.title || 'Thinking of You'}
            </h3>

            {/* Message Sanctuary Box */}
            <div
              style={{
                background: currentTheme.quoteBg,
                borderColor: currentTheme.border,
              }}
              className="rounded-[18px] border px-4 py-3.5"
            >
              <p
                style={{
                  fontFamily: currentFont.bodyFont,
                  fontSize: currentFont.bodySize,
                  color: currentTheme.bodyText,
                }}
                className="leading-relaxed whitespace-pre-wrap"
              >
                {activeOverlay.message}
              </p>
            </div>

            {/* Configurable Action Buttons */}
            <div
              style={{ fontFamily: "'Poppins', system-ui, sans-serif" }}
              className="pt-1.5 flex flex-col gap-2"
            >
              {Array.isArray(activeOverlay.buttons) && activeOverlay.buttons.length > 0 ? (
                activeOverlay.buttons.slice(0, 3).map((btn: any, idx: number) => {
                  const isPrimary = idx === 0;
                  return (
                    <button
                      key={idx}
                      onClick={() => handleOverlayButton(btn)}
                      style={
                        isPrimary
                          ? {
                              background: currentTheme.primaryBtn,
                              color: '#ffffff',
                              boxShadow: '0 8px 22px rgba(244, 63, 94, 0.32)',
                            }
                          : {
                              background: currentTheme.secondaryBtn,
                              color: isLightBlush ? '#4a0e27' : '#fce7f3',
                              borderColor: currentTheme.border,
                            }
                      }
                      className={`w-full py-3 px-4 rounded-[14px] text-[13.5px] font-semibold flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-[0.98] ${
                        isPrimary ? 'border-0' : 'border'
                      }`}
                    >
                      {getButtonIcon(btn.action)}
                      <span>{btn.label || 'Continue'}</span>
                    </button>
                  );
                })
              ) : (
                <button
                  onClick={() => {
                    stopOverlayAudio();
                    updateDoc(doc(db, 'overlays', activeOverlay.id), { dismissed: true }).catch(() => {});
                    setActiveOverlay(null);
                  }}
                  style={{
                    background: currentTheme.primaryBtn,
                    color: '#ffffff',
                    boxShadow: '0 8px 22px rgba(244, 63, 94, 0.32)',
                  }}
                  className="w-full py-3 px-4 rounded-[14px] text-[13.5px] font-semibold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Heart className="w-4 h-4 fill-current" />
                  <span>Keep in My Heart</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
