import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  Gift,
  X,
  Copy,
  Check,
  RotateCw,
  Heart,
  ExternalLink,
  ChevronRight,
  PartyPopper,
  ShieldCheck,
} from 'lucide-react';
import { romanticAudio } from '../audio';
import { CONFIG } from '../config';
import { AmazonGiftCard3D } from './AmazonGiftCard3D';
import { triggerHaptic, showNativeToast, logNativeActivity } from '../androidBridge';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, ADMIN_EMAIL } from '../firebase';

export interface WheelSegment {
  amount: number;
  label: string;
  bgLight: string;
  bgDark: string;
  textLight: string;
  textDark: string;
}

// Exactly 10 distinct segments ranging from ₹10 to ₹2,000
// ₹300 is at index 4 (mandatory first-spin winner)
export const WHEEL_SEGMENTS: WheelSegment[] = [
  { amount: 10, label: '₹10', bgLight: '#fdf2f8', bgDark: '#3b0764', textLight: '#db2777', textDark: '#f472b6' },
  { amount: 50, label: '₹50', bgLight: '#eff6ff', bgDark: '#1e1b4b', textLight: '#2563eb', textDark: '#60a5fa' },
  { amount: 100, label: '₹100', bgLight: '#f0fdf4', bgDark: '#064e3b', textLight: '#059669', textDark: '#34d399' },
  { amount: 200, label: '₹200', bgLight: '#fefce8', bgDark: '#451a03', textLight: '#d97706', textDark: '#facc15' },
  { amount: 300, label: '₹300', bgLight: '#ffe4e6', bgDark: '#881337', textLight: '#e11d48', textDark: '#fb7185' }, // Winner!
  { amount: 500, label: '₹500', bgLight: '#faf5ff', bgDark: '#581c87', textLight: '#9333ea', textDark: '#c084fc' },
  { amount: 750, label: '₹750', bgLight: '#ecfeff', bgDark: '#164e63', textLight: '#0891b2', textDark: '#22d3ee' },
  { amount: 1000, label: '₹1,000', bgLight: '#fff7ed', bgDark: '#7c2d12', textLight: '#ea580c', textDark: '#fb923c' },
  { amount: 1500, label: '₹1,500', bgLight: '#f5f3ff', bgDark: '#312e81', textLight: '#7c3aed', textDark: '#a78bfa' },
  { amount: 2000, label: '₹2,000', bgLight: '#fdf4ff', bgDark: '#701a75', textLight: '#c026d3', textDark: '#e879f9' },
];

const CLAIMED_STORAGE_KEY = 'kashish_birthday_gift_claimed';
const SPINS_COUNT_STORAGE_KEY = 'kashish_birthday_spins_count';

// Safe localStorage helpers
const isGiftClaimed = (): boolean => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(CLAIMED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

const saveGiftClaimed = (): void => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(CLAIMED_STORAGE_KEY, 'true');
    window.localStorage.setItem('kashish_birthday_gift_claimed_at', new Date().toISOString());
  } catch {
    // Fail gracefully
  }
};

const getStoredSpinsCount = (): number => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 0;
    const raw = window.localStorage.getItem(SPINS_COUNT_STORAGE_KEY);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
};

const saveStoredSpinsCount = (count: number): void => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(SPINS_COUNT_STORAGE_KEY, count.toString());
  } catch {
    // Fail gracefully
  }
};

export const resetGiftClaimForTesting = (): void => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(CLAIMED_STORAGE_KEY);
      window.localStorage.removeItem(SPINS_COUNT_STORAGE_KEY);
      window.localStorage.removeItem('kashish_birthday_gift_claimed_at');
    }
  } catch {
    // Fail gracefully
  }
};

interface BirthdaySurpriseSpinnerProps {
  isOpen: boolean;
  onClose: () => void;
  recipientName: string;
  isDarkMode: boolean;
  voucherCode?: string;
}

export const BirthdaySurpriseSpinner: React.FC<BirthdaySurpriseSpinnerProps> = ({
  isOpen,
  onClose,
  recipientName,
  isDarkMode,
  voucherCode =
    (CONFIG.birthdaySurprise as any)?.amazonGiftCardCode ||
    CONFIG.birthdaySurprise?.flipkartGiftCardCode ||
    'YOUR_AMAZON_GIFT_CARD_CODE',
}) => {
  // Persistence state
  const [hasClaimedGift, setHasClaimedGift] = useState<boolean>(() => isGiftClaimed());
  const [spinsCount, setSpinsCount] = useState<number>(() => getStoredSpinsCount());

  // Wheel animation state (lightweight, GPU-accelerated 2D rotation)
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [isFluttering, setIsFluttering] = useState<boolean>(false);
  const [rotation, setRotation] = useState<number>(0);
  const [currentResult, setCurrentResult] = useState<string | null>(null);
  const [funMessage, setFunMessage] = useState<string | null>(null);

  // Timers & shared AudioContext ref for zero-lag audio ticks
  const timersRef = useRef<number[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Modals & feedback
  const [showGiftModal, setShowGiftModal] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isAdminUser, setIsAdminUser] = useState<boolean>(
    () => auth.currentUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setIsAdminUser(u?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase());
    });
    return () => unsub();
  }, []);

  // Lightweight sound effect using a single shared AudioContext
  const playWheelTick = () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(640, ctx.currentTime);
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.02);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.022);
    } catch {
      // Audio fallback silent
    }
  };

  // Reset testing state
  const handleResetForTesting = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    resetGiftClaimForTesting();
    setHasClaimedGift(false);
    setSpinsCount(0);
    setCurrentResult(null);
    setFunMessage(null);
    setRotation(0);
    setIsFluttering(false);
    romanticAudio.playChime();
  };

  // Sync state & lock background scroll on open
  useEffect(() => {
    if (!isOpen) return;
    setHasClaimedGift(isGiftClaimed());
    setSpinsCount(getStoredSpinsCount());

    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current = [];
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSpinning) {
        if (showGiftModal) {
          setShowGiftModal(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSpinning, showGiftModal, onClose]);

  if (!isOpen) return null;

  // Wheel math:
  // Center: (160, 160), radius R = 142
  // 10 slices, each 36 degrees
  // Slice i spans from [i * 36 deg, (i + 1) * 36 deg]
  // Center of slice i is (i + 0.5) * 36 deg measured clockwise from top (12 o'clock).
  // The fixed pointer is located at the top (12 o'clock = 0 deg).
  // When wheel rotates by R deg clockwise, the slice under the top pointer is the one
  // whose center satisfies: ((i + 0.5) * 36 + R) % 360 == 0.
  // Therefore, to land on targetIndex:
  // targetAngleMod360 = (360 - (targetIndex + 0.5) * 36) % 360.
  const handleSpin = () => {
    if (isSpinning) return;

    if (typeof window !== 'undefined' && window.AndroidApp?.vibrate) {
      window.AndroidApp.vibrate(40);
    } else {
      triggerHaptic(40);
    }

    setIsSpinning(true);
    setIsFluttering(true);
    setFunMessage(null);
    setCurrentResult(null);

    // Clear previous timeouts
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];

    // DETERMINISTIC FIRST SPIN RULE:
    // If gift has not been claimed, targetIndex MUST ALWAYS BE 4 (₹300).
    // Subsequent spins are just for fun and choose a random segment among the 10 amounts.
    const isFirstClaimSpin = !hasClaimedGift;
    const targetIndex = isFirstClaimSpin ? 4 : Math.floor(Math.random() * 10);

    // Segment center angle relative to wheel's unrotated 12 o'clock
    const segmentCenter = (targetIndex + 0.5) * 36;
    const targetAngleMod360 = (360 - segmentCenter + 360) % 360;

    // Subtle natural jitter for fun spins (within ±8 degrees of segment center; slice is 36 deg wide)
    const jitter = isFirstClaimSpin ? 0 : Math.random() * 16 - 8;

    // Calculate rotation delta from current rotation
    const currentAngleMod360 = ((rotation % 360) + 360) % 360;
    let angleDelta = (targetAngleMod360 + jitter - currentAngleMod360 + 360) % 360;
    if (angleDelta < 36) angleDelta += 360; // Guarantee at least a portion of a turn

    // Smooth, lightweight 5 revolutions over 2.4 seconds
    const fullSpins = 5 * 360;
    const newRotation = rotation + fullSpins + angleDelta;

    setRotation(newRotation);
    romanticAudio.playChime();

    // Sparse, lightweight acoustic ticks (only 10 ticks total instead of 30+)
    [120, 260, 420, 600, 820, 1080, 1380, 1700, 2020, 2280].forEach((t) => {
      timersRef.current.push(window.setTimeout(() => playWheelTick(), t));
    });

    // At 1.9s: Stop pointer bounce
    timersRef.current.push(
      window.setTimeout(() => {
        setIsFluttering(false);
      }, 1900)
    );

    // Final stop at 2.4 seconds
    timersRef.current.push(
      window.setTimeout(() => {
        setIsSpinning(false);
        setIsFluttering(false);

        const wonSegment = WHEEL_SEGMENTS[targetIndex];
        setCurrentResult(wonSegment.label);

        const nextCount = spinsCount + 1;
        setSpinsCount(nextCount);
        saveStoredSpinsCount(nextCount);

        if (isFirstClaimSpin) {
          // First spin: unlocks & claims the ₹300 Birthday Gift (ONLY ONCE!)
          setHasClaimedGift(true);
          saveGiftClaimed();
          setShowGiftModal(true);
          romanticAudio.playChime();

          void logNativeActivity(
            `🎉🎁 ${recipientName} spun the Birthday Wheel & claimed her ₹300 Amazon Gift Card!`,
            true
          );

          if (typeof window !== 'undefined' && window.AndroidApp?.vibrate) {
            window.AndroidApp.vibrate(60);
          } else {
            triggerHaptic(60);
          }
          if (typeof window !== 'undefined' && window.AndroidApp?.showToast) {
            window.AndroidApp.showToast("Birthday Surprise Unlocked! 🎁₹300");
          }
        } else {
          // Subsequent spins: Fun spin only, claim is already locked to ₹300!
          setFunMessage(
            `You landed on ${wonSegment.label}! 🎡 Only one gift claim is allowed (₹300 Gift Card already claimed 💝).`
          );
          if (typeof window !== 'undefined' && window.AndroidApp?.vibrate) {
            window.AndroidApp.vibrate(35);
          } else {
            triggerHaptic(35);
          }
          if (typeof window !== 'undefined' && window.AndroidApp?.showToast) {
            window.AndroidApp.showToast(`Fun Spin: ${wonSegment.label}! (₹300 Already Claimed 💝)`);
          }
        }
      }, 2400)
    );
  };

  const handleCopyCode = async () => {
    if (typeof window !== 'undefined' && window.AndroidApp?.vibrate) {
      window.AndroidApp.vibrate(40);
    } else {
      triggerHaptic(40);
    }
    if (typeof window !== 'undefined' && window.AndroidApp?.showToast) {
      window.AndroidApp.showToast("Gift Code Copied! 📋✨");
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(voucherCode);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = voucherCode;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setIsCopied(true);
      romanticAudio.playChime();
      setTimeout(() => setIsCopied(false), 2500);
    } catch {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    }
  };

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Birthday Surprise Spinner"
      className="fixed inset-0 z-[1450] w-screen h-[100dvh] max-h-[100dvh] flex items-center justify-center p-3 sm:p-4 bg-black/80 overflow-y-auto overscroll-contain"
    >
      {/* Modal Container */}
      <div
        style={{
          backgroundColor: isDarkMode ? '#13091e' : '#ffffff',
          borderColor: isDarkMode ? '#3b1854' : '#fbcfe8',
        }}
        className="relative w-full max-w-md rounded-3xl border p-5 sm:p-6 text-center shadow-xl my-auto"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isSpinning}
          aria-label="Close spinner"
          style={{
            backgroundColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
            color: isDarkMode ? '#e2e8f0' : '#475569',
          }}
          className="absolute top-4 right-4 p-2 rounded-full transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed z-20"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="space-y-1.5 mb-4 pr-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold border border-rose-400/30 bg-rose-500/10 text-rose-500">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span>Birthday Surprise Wheel</span>
            <Sparkles className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          </div>
          <h2
            style={{ color: isDarkMode ? '#f8fafc' : '#0f172a' }}
            className="text-xl sm:text-2xl font-serif font-bold tracking-tight"
          >
            Spin For {recipientName}'s Gift! 🎁
          </h2>
          <p
            style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}
            className="text-xs sm:text-sm font-medium"
          >
            {!hasClaimedGift
              ? 'Spin the wheel to unlock your special birthday surprise! (1 Claim Available)'
              : 'Your ₹300 Birthday Gift is claimed (1/1)! 💝 You can still spin for fun anytime.'}
          </p>
        </div>

        {/* Interactive Spinning Wheel Container (Pure 2D GPU-composited rotation) */}
        <div className="relative mx-auto my-2.5 w-[280px] h-[280px] sm:w-[310px] sm:h-[310px] flex items-center justify-center select-none">
          {/* Fixed Pointer Needle at TOP (12 o'clock) */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2.5 z-30 flex flex-col items-center pointer-events-none">
            <svg
              width="34"
              height="34"
              viewBox="0 0 36 36"
              fill="none"
              className={isFluttering ? 'scale-105 transition-transform duration-150' : 'transition-transform duration-150'}
            >
              <polygon
                points="18,34 6,4 30,4"
                fill="#e11d48"
                stroke="#ffffff"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <circle cx="18" cy="8" r="3.8" fill="#facc15" stroke="#ffffff" strokeWidth="1.2" />
            </svg>
          </div>

          {/* Wheel Wrapper */}
          <div className="relative w-full h-full flex items-center justify-center rounded-full shadow-lg">
            {/* SVG Rotating Wheel */}
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 320 320"
              style={{
                transform: `rotate(${rotation}deg) translateZ(0)`,
                transition: isSpinning
                  ? 'transform 2.4s cubic-bezier(0.15, 0.85, 0.25, 1)'
                  : 'none',
                transformOrigin: '50% 50%',
                willChange: isSpinning ? 'transform' : 'auto',
              }}
            >

            {/* 10 Wheel Segments */}
            {WHEEL_SEGMENTS.map((segment, index) => {
              const sliceAngle = 36;
              const startAngle = index * sliceAngle;
              const endAngle = (index + 1) * sliceAngle;
              const midAngle = (index + 0.5) * sliceAngle;

              const r = 142;
              const cx = 160;
              const cy = 160;

              // Convert angles (0 deg = 12 o'clock, clockwise) to SVG coordinates
              const x1 = cx + r * Math.sin((startAngle * Math.PI) / 180);
              const y1 = cy - r * Math.cos((startAngle * Math.PI) / 180);
              const x2 = cx + r * Math.sin((endAngle * Math.PI) / 180);
              const y2 = cy - r * Math.cos((endAngle * Math.PI) / 180);

              const pathData = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;

              // Text position along wedge radius (around 68% of radius)
              const textRadius = 96;
              const textX = cx + textRadius * Math.sin((midAngle * Math.PI) / 180);
              const textY = cy - textRadius * Math.cos((midAngle * Math.PI) / 180);

              const is300Winner = segment.amount === 300;

              return (
                <g key={segment.amount} className="transition-opacity">
                  {/* Segment Wedge */}
                  <path
                    d={pathData}
                    fill={isDarkMode ? segment.bgDark : segment.bgLight}
                    stroke={isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)'}
                    strokeWidth="1.2"
                  />

                  {/* Special shimmering border for ₹300 */}
                  {is300Winner && (
                    <path
                      d={pathData}
                      fill="none"
                      stroke="#fb7185"
                      strokeWidth="2.5"
                      strokeOpacity="0.75"
                    />
                  )}

                  {/* Segment Text Label */}
                  <text
                    x={textX.toFixed(2)}
                    y={textY.toFixed(2)}
                    fill={isDarkMode ? segment.textDark : segment.textLight}
                    fontSize={segment.amount >= 1000 ? '12' : '14'}
                    fontWeight="800"
                    fontFamily="'Century Gothic', 'Plus Jakarta Sans', system-ui, sans-serif"
                    dominantBaseline="middle"
                    textAnchor="middle"
                    transform={`rotate(${midAngle}, ${textX.toFixed(2)}, ${textY.toFixed(2)})`}
                    style={{
                      letterSpacing: '0.02em',
                      textShadow: isDarkMode
                        ? '0 1px 3px rgba(0,0,0,0.8)'
                        : '0 1px 2px rgba(255,255,255,0.8)',
                    }}
                  >
                    {segment.label}
                  </text>
                </g>
              );
            })}

            {/* Wheel Outer Rim */}
            <circle
              cx="160"
              cy="160"
              r="142"
              fill="none"
              stroke={isDarkMode ? '#e2e8f0' : '#f43f5e'}
              strokeWidth="5"
              strokeOpacity={isDarkMode ? '0.35' : '0.8'}
            />

            {/* Decorative Outer Pegs (10 dots at segment edges) */}
            {WHEEL_SEGMENTS.map((_, i) => {
              const pegAngle = i * 36;
              const pegRadius = 142;
              const pegX = 160 + pegRadius * Math.sin((pegAngle * Math.PI) / 180);
              const pegY = 160 - pegRadius * Math.cos((pegAngle * Math.PI) / 180);
              return (
                <circle
                  key={i}
                  cx={pegX.toFixed(2)}
                  cy={pegY.toFixed(2)}
                  r="3.5"
                  fill="#facc15"
                  stroke="#ffffff"
                  strokeWidth="1"
                />
              );
            })}

            {/* Center Cap Hub */}
            <circle
              cx="160"
              cy="160"
              r="28"
              fill={isDarkMode ? '#1e112a' : '#ffffff'}
              stroke={isDarkMode ? '#fb7185' : '#f43f5e'}
              strokeWidth="4"
            />
            <circle
              cx="160"
              cy="160"
              r="22"
              fill={isDarkMode ? '#3b0764' : '#fff1f2'}
            />
            {/* Center Icon */}
            <text
              x="160"
              y="163"
              fontSize="16"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none pointer-events-none"
            >
              💖
            </text>
          </svg>
          </div>
        </div>

        {/* Claimed Result & Refund Notice */}
        {(hasClaimedGift || funMessage) && (
          <div
            style={{
              backgroundColor: isDarkMode ? 'rgba(244, 63, 94, 0.12)' : '#fff1f2',
              borderColor: isDarkMode ? 'rgba(244, 63, 94, 0.25)' : '#fecdd3',
            }}
            className="my-3 p-3 rounded-2xl border text-xs sm:text-sm font-medium animate-fade-in space-y-1"
          >
            <div className="flex items-center justify-center gap-1.5 font-bold text-rose-500">
              <span>Claimed Gift Reward:</span>
              <span className="text-base font-extrabold">₹300</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30">
                1/1 Claimed 💝
              </span>
            </div>
            {funMessage && (
              <p
                style={{ color: isDarkMode ? '#fda4af' : '#be123c' }}
                className="text-xs font-semibold leading-snug"
              >
                {funMessage}
              </p>
            )}
            <p style={{ color: isDarkMode ? '#e2e8f0' : '#475569' }} className="leading-snug font-semibold">
              Other coupons have been refunded to Jay's account. 💳✨
            </p>
          </div>
        )}

        {/* Action Controls */}
        <div className="space-y-2.5 mt-4">
          <button
            onClick={handleSpin}
            disabled={isSpinning}
            style={{
              background: isSpinning
                ? 'linear-gradient(135deg, #475569 0%, #334155 100%)'
                : 'linear-gradient(135deg, #ec4899 0%, #e11d48 50%, #be123c 100%)',
              boxShadow: isSpinning ? 'none' : '0 6px 20px rgba(225, 29, 72, 0.45)',
            }}
            className="w-full py-3.5 px-6 rounded-2xl text-white font-bold text-base sm:text-lg flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-80 shadow-lg hover:scale-[1.01] active:scale-[0.99]"
          >
            {isSpinning ? (
              <>
                <RotateCw className="w-5 h-5 animate-spin" />
                <span>Spinning with Magic... ✨</span>
              </>
            ) : hasClaimedGift ? (
              <>
                <RotateCw className="w-5 h-5 text-amber-300" />
                <span>Spin Again (Just For Fun!) 🎡</span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 text-amber-300 fill-amber-300" />
                <span>SPIN NOW & CLAIM GIFT</span>
                <Sparkles className="w-5 h-5 text-amber-300 fill-amber-300" />
              </>
            )}
          </button>

          {/* Re-Open Gift Voucher Button (Always available after gift claimed) */}
          {hasClaimedGift && (
            <button
              onClick={() => {
                romanticAudio.playChime();
                setShowGiftModal(true);
              }}
              style={{
                backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                borderColor: isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
                color: isDarkMode ? '#f8fafc' : '#0f172a',
              }}
              className="w-full py-2.5 px-4 rounded-xl border text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 hover:border-rose-400/50 hover:text-rose-500 transition-all cursor-pointer"
            >
              <Gift className="w-4 h-4 text-rose-500" />
              <span>View Claimed ₹300 Gift Card 🎁</span>
            </button>
          )}

          {/* Footer Status & Reset for Testing */}
          <div
            style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}
            className="text-[11px] font-medium pt-1 flex flex-col items-center justify-center gap-1.5"
          >
            <div>
              Spins completed: <span className="font-bold tabular-nums">{spinsCount}</span>
              {hasClaimedGift && ' · 1 Birthday gift claimed 💝'}
            </div>

            {/* Test Reset Button: Strictly visible ONLY to Admin (jayshankar431@gmail.com) */}
            {isAdminUser && (hasClaimedGift || spinsCount > 0) && (
              <button
                type="button"
                onClick={handleResetForTesting}
                disabled={isSpinning}
                style={{
                  color: isDarkMode ? '#fda4af' : '#e11d48',
                  backgroundColor: isDarkMode ? 'rgba(244,63,94,0.1)' : 'rgba(244,63,94,0.06)',
                  borderColor: isDarkMode ? 'rgba(244,63,94,0.25)' : 'rgba(244,63,94,0.18)',
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-medium hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                title="Reset testing state so you can test the first-spin ₹300 reward again"
              >
                <RotateCw className="w-3 h-3 text-rose-500" />
                <span className="font-semibold">Reset Gift (Test Mode Only)</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 🎁 STAGE D: AMAZON GIFT CARD POPUP MODAL                                  */}
      {/* ========================================================================= */}
      {showGiftModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Amazon Gift Card Birthday Reward"
          className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-black/85"
        >
          <div
            style={{
              backgroundColor: isDarkMode ? '#12071d' : '#ffffff',
              borderColor: isDarkMode ? '#4c1d70' : '#fbcfe8',
            }}
            className="relative w-full max-w-sm sm:max-w-md rounded-3xl border p-5 sm:p-6 text-center shadow-2xl my-auto z-10 overflow-hidden"
          >
            {/* Close Cross */}
            <button
              onClick={() => setShowGiftModal(false)}
              aria-label="Close gift popup"
              style={{
                backgroundColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                color: isDarkMode ? '#e2e8f0' : '#475569',
              }}
              className="absolute top-4 right-4 p-2 rounded-full hover:scale-105 active:scale-95 transition-all cursor-pointer z-20"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Celebration Icon */}
            <div className="w-15 h-15 mx-auto mb-2.5 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-amber-300 p-0.5 shadow-lg shadow-amber-500/25 flex items-center justify-center">
              <div className="w-full h-full rounded-[14px] bg-white/20 backdrop-blur-xs flex items-center justify-center">
                <PartyPopper className="w-7 h-7 text-white drop-shadow-md" />
              </div>
            </div>

            {/* Mandatory Suggested Content */}
            <div className="space-y-1 mb-3">
              <h3
                style={{ color: isDarkMode ? '#f8fafc' : '#0f172a' }}
                className="text-2xl sm:text-3xl font-serif font-extrabold tracking-tight"
              >
                🎉 You Won ₹300!
              </h3>
              <p className="text-sm sm:text-base font-bold text-rose-500">
                Happy Birthday, my favourite person! ❤️
              </p>
              <p
                style={{ color: isDarkMode ? '#cbd5e1' : '#64748b' }}
                className="text-xs sm:text-sm font-medium italic"
              >
                "Your little surprise is waiting for you."
              </p>
              <div className="pt-1">
                <span className="inline-block px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  💳 Other coupons have been refunded to Jay's account
                </span>
              </div>
            </div>

            {/* Luxurious 3D Amazon-Inspired Gift Card */}
            <div className="mb-3.5">
              <AmazonGiftCard3D
                voucherCode={voucherCode}
                recipientName={recipientName}
                amount="₹300"
                isDarkMode={isDarkMode}
              />
            </div>

            {/* Copy Button */}
            <button
              onClick={handleCopyCode}
              style={{
                background: isCopied
                  ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)'
                  : 'linear-gradient(135deg, #d97706 0%, #f59e0b 50%, #ea580c 100%)',
                boxShadow: isCopied
                  ? '0 6px 20px rgba(16, 185, 129, 0.4)'
                  : '0 6px 22px rgba(245, 158, 11, 0.45)',
              }}
              className="w-full py-3 px-5 rounded-2xl text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer shadow-lg mb-3"
            >
              {isCopied ? (
                <>
                  <Check className="w-5 h-5 text-white" />
                  <span>Copied to Clipboard! 📋✨</span>
                </>
              ) : (
                <>
                  <Copy className="w-5 h-5 text-white" />
                  <span>Copy Gift Code</span>
                </>
              )}
            </button>

            {/* Redemption Instructions */}
            <div
              style={{
                backgroundColor: isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                borderColor: isDarkMode ? 'rgba(245, 158, 11, 0.2)' : 'rgba(0,0,0,0.06)',
                color: isDarkMode ? '#cbd5e1' : '#64748b',
              }}
              className="rounded-xl border p-3 text-[11px] text-left space-y-1 mb-3.5"
            >
              <div className="font-bold flex items-center gap-1 text-amber-400">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>How to Redeem on Amazon:</span>
              </div>
              <p className="leading-relaxed">
                1. Open the Amazon app or visit <b>amazon.in</b> (or amazon.com).
              </p>
              <p className="leading-relaxed">
                2. Navigate to <b>Amazon Pay → Add Gift Card</b> to your balance.
              </p>
              <p className="leading-relaxed">
                3. Paste or enter your gift card code and tap <b>'Add to your balance'</b>.
              </p>
              <p className="leading-relaxed">
                4. ₹300 will be instantly added to your Amazon Pay balance.
              </p>
            </div>

            {/* Close Button */}
            <button
              onClick={() => setShowGiftModal(false)}
              style={{
                backgroundColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                color: isDarkMode ? '#f8fafc' : '#0f172a',
              }}
              className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold hover:bg-rose-500/10 hover:text-rose-500 transition-all cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};
