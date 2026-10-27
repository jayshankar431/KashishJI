import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Lock, Unlock, KeyRound, Heart, Sparkles, HelpCircle, ChevronDown } from 'lucide-react';
import { romanticAudio } from '../audio';
import { useSite } from '../siteContent';
import { triggerHaptic, showNativeToast, logNativeActivity } from '../androidBridge';
import { DynamicSlot } from './DynamicSlot';

interface SecretLetterSectionProps {
  name: string;
  passwordHash: string;
  passwordHint: string;
  personalMessage: string;
  isDarkMode: boolean;
  onUnlockLetter?: () => void;
}

export interface LetterLine {
  id: string;
  text: string;
  paragraphIndex: number;
  isParagraphStart: boolean;
  isParagraphEnd: boolean;
}

/**
 * Normalizes input by trimming, converting to lowercase, and stripping all spaces and hyphens.
 * Allows "Kashish143", "kashish143", "KASHISH143", "Kashish 143", etc.
 */
const normalizeInput = (str: string): string => {
  return str.trim().toLowerCase().replace(/[\s\-_]+/g, '');
};

/**
 * Computes SHA-256 hash using the Web Crypto API
 */
const computeSha256 = async (str: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Generates valid dynamic date passwords for the Secret Letter in MMYYDD format.
 * Format: Month (2 digits) + Year (last 2 digits) + Day (2 digits)
 * E.g., for 4 October 2026: Month: 10, Year: 26, Day: 04 => "102604"
 * Changes every single day automatically.
 * Supports local device date and IST (with adjacent timezone safety).
 */
export const getValidDatePasswords = (): string[] => {
  const passwords = new Set<string>();
  const now = new Date();

  let istDate = now;
  try {
    istDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  } catch {
    istDate = now;
  }

  const formatMMYYDD = (d: Date): string => {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}${yy}${dd}`;
  };

  [now, istDate].forEach((base) => {
    // Current date, plus previous & next day for midnight safety
    [-1, 0, 1].forEach((dayOffset) => {
      const d = new Date(base.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      passwords.add(formatMMYYDD(d));
    });
  });

  return Array.from(passwords);
};

export const SecretLetterSection: React.FC<SecretLetterSectionProps> = ({
  name,
  passwordHash,
  passwordHint,
  personalMessage,
  isDarkMode: _isDarkMode,
  onUnlockLetter,
}) => {
  const site = useSite();
  const [inputVal, setInputVal] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [isMelting, setIsMelting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showHint, setShowHint] = useState(false);

  // Divide the letter into individual visual lines for the one-line-at-a-time reveal
  const { greeting, lines } = useMemo(() => {
    const activeMessage =
      personalMessage && personalMessage.trim().length > 0
        ? personalMessage
        : site.personalMessage || '';

    const rawParagraphs = activeMessage
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    let extractedGreeting = `Dear ${name},`;
    let bodyParagraphs = rawParagraphs;

    if (rawParagraphs.length > 0 && rawParagraphs[0].toLowerCase().startsWith('dear')) {
      extractedGreeting = rawParagraphs[0];
      bodyParagraphs = rawParagraphs.slice(1);
    }

    const parsedLines: LetterLine[] = [];

    bodyParagraphs.forEach((paragraph, pIdx) => {
      // Split by explicit newlines first, then long sentences if needed
      const explicitLines = paragraph
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      const pLines: string[] = [];

      explicitLines.forEach((lineSegment) => {
        const rawSentences = lineSegment.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [lineSegment];
        rawSentences.forEach((sentence) => {
          const trimmed = sentence.trim();
          if (!trimmed) return;
          pLines.push(trimmed);
        });
      });

      pLines.forEach((lineText, lIdx) => {
        parsedLines.push({
          id: `dyn-${pIdx}-${lIdx}`,
          text: lineText,
          paragraphIndex: pIdx,
          isParagraphStart: lIdx === 0,
          isParagraphEnd: lIdx === pLines.length - 1,
        });
      });
    });

    return {
      greeting: extractedGreeting,
      lines: parsedLines,
    };
  }, [personalMessage, site.personalMessage, name]);

  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 60fps lightweight scroll transition effect: ONE LINE AT A TIME
  useEffect(() => {
    if (!isUnlocked || typeof window === 'undefined') return;

    let ticking = false;

    const updateLineTransitions = () => {
      ticking = false;
      const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const vh = window.innerHeight;
      const viewportCenter = vh * 0.48; // Optimal natural eye focus zone
      const focalHalfWidth = Math.max(135, Math.min(220, vh * 0.22)); // Zone where line enters/exits focus
      const plateauHalfWidth = 30; // Plateau where line remains in 100% full crisp focus

      lineRefs.current.forEach((el) => {
        if (!el) return;

        if (isReducedMotion) {
          el.style.opacity = '1';
          el.style.transform = 'none';
          return;
        }

        const rect = el.getBoundingClientRect();
        const elCenter = rect.top + rect.height / 2;
        const distFromCenter = Math.abs(elCenter - viewportCenter);

        let factor = 0;
        if (distFromCenter <= plateauHalfWidth) {
          factor = 1;
        } else if (distFromCenter < focalHalfWidth) {
          const t = (focalHalfWidth - distFromCenter) / (focalHalfWidth - plateauHalfWidth);
          // Soft cubic ease-in-out curve
          factor = t * t * (3 - 2 * t);
        }

        // Opacity: fades from 0.0 to 1.0 at center, and fades back to 0.0 when scrolling away
        const opacity = factor;

        // Upward motion:
        // Approaching from below: starts 20px lower and glides up smoothly to 0px
        // Leaving toward top: floats gently upward to -16px as it fades away
        const isBelow = elCenter > viewportCenter;
        const translateY = isBelow ? (1 - factor) * 20 : -(1 - factor) * 16;

        el.style.opacity = opacity.toFixed(3);
        el.style.transform = `translate3d(0, ${translateY.toFixed(1)}px, 0)`;
      });
    };

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateLineTransitions);
        ticking = true;
      }
    };

    // Calculate initial state as layout settles
    const timer1 = setTimeout(updateLineTransitions, 30);
    const timer2 = setTimeout(updateLineTransitions, 180);

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isUnlocked, lines]);

  const triggerLetterUnlock = () => {
    setIsMelting(true);
    setErrorMsg('');

    // Safe Android Bridge Haptic & Native Toast Notification
    triggerHaptic(40);
    showNativeToast("Letter Unlocked! 💌");
    logNativeActivity("💌 Kashish opened Secret Letter: A Letter For You");

    // Immediately dismiss mobile keyboard
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    romanticAudio.playChime();

    setTimeout(() => {
      setIsUnlocked(true);
      setIsMelting(false);
      onUnlockLetter?.();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 700);
  };

  // ⚡ Auto-unlock helper: If correct date password is typed, automatically open without requiring a tap!
  const checkAutoUnlock = (val: string) => {
    if (!val || isVerifying || isMelting || isUnlocked) return;
    const normalized = normalizeInput(val);
    if (!normalized) return;

    const validDatePasswords = getValidDatePasswords();
    if (validDatePasswords.includes(normalized)) {
      triggerLetterUnlock();
    }
  };

  // Watch inputVal in case of autofill or paste
  useEffect(() => {
    if (inputVal && !isUnlocked && !isMelting) {
      checkAutoUnlock(inputVal);
    }
  }, [inputVal, isUnlocked, isMelting]);

  const handleInputChange = (val: string) => {
    setInputVal(val);
    setErrorMsg('');
    checkAutoUnlock(val);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim() || isVerifying || isMelting || isUnlocked) return;

    setIsVerifying(true);
    try {
      const normalized = normalizeInput(inputVal);
      const validDatePasswords = getValidDatePasswords();

      const isMatch = validDatePasswords.includes(normalized);

      if (isMatch) {
        triggerLetterUnlock();
      } else {
        // Wrong password: lock shakes and displays failure message
        logNativeActivity(`⚠️ <b>Failed Unlock Attempt</b> on Secret Letter\nInput: <code>${inputVal}</code>`);
        setIsShaking(true);
        setErrorMsg('Incorrect password. Try again.');
        romanticAudio.playChime();
        setTimeout(() => setIsShaking(false), 500);
      }
    } catch {
      setIsShaking(true);
      setErrorMsg('Incorrect password. Try again.');
      setTimeout(() => setIsShaking(false), 500);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className={`space-y-6 animate-fade-in pb-20 mx-auto ${isUnlocked ? 'max-w-3xl' : 'max-w-xl'}`}>
      {/* Header */}
      <div className="text-center space-y-1">
        <h2
          style={{ color: 'var(--text)' }}
          className="font-serif text-3xl sm:text-4xl font-bold flex items-center justify-center gap-2"
        >
          {isUnlocked ? (
            <Unlock className="w-6 h-6 text-emerald-500" />
          ) : (
            <Lock className="w-6 h-6 text-[var(--accent)]" />
          )}
          <span>The Secret Letter</span>
        </h2>
        <p
          style={{ color: 'var(--text-soft)' }}
          className="text-xs sm:text-sm italic font-medium"
        >
          "Some letters are kept special so only the right soul can read them."
        </p>
      </div>

      {/* Conditional Rendering: Locked Envelope Screen vs Cinematic Unlocked Letter */}
      {!isUnlocked ? (
        <div
          style={{
            backgroundColor: 'var(--card-solid)',
            borderColor: 'var(--card-border)',
            boxShadow: '0 8px 30px var(--shadow-color)',
          }}
          className="p-6 sm:p-10 rounded-3xl border text-center space-y-6 transition-all"
        >
          {/* Lock Graphic */}
          <div
            style={{
              backgroundColor: 'var(--accent)',
              boxShadow: isMelting
                ? '0 0 40px 12px rgba(251, 191, 36, 0.85), 0 0 25px rgba(244, 63, 94, 0.9)'
                : '0 10px 25px rgba(214, 51, 108, 0.45)',
              transform: isMelting ? 'scale(1.15)' : 'scale(1)',
              transition: 'all 0.5s ease',
            }}
            className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center border-4 border-white/70 ${
              isShaking ? 'animate-shake' : isMelting ? 'animate-pulse' : 'animate-heartbeat'
            }`}
          >
            {isMelting ? (
              <Sparkles className="w-9 h-9 text-amber-200 animate-spin" />
            ) : (
              <Lock className="w-9 h-9 text-white" />
            )}
          </div>

          <div className="space-y-1">
            <h3
              style={{ color: 'var(--text)' }}
              className="font-serif text-2xl sm:text-3xl font-bold"
            >
              This letter is meant only for {name}
            </h3>
            <p
              style={{ color: 'var(--text-soft)' }}
              className="text-xs font-medium"
            >
              {isMelting
                ? 'Unlocking with a warm glow... ✨'
                : 'Enter the secret password to open the letter.'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 max-w-sm mx-auto">
            <div className="relative">
              <input
                type="password"
                value={inputVal}
                onChange={(e) => handleInputChange(e.target.value)}
                onInput={(e: React.FormEvent<HTMLInputElement>) => {
                  const val = (e.target as HTMLInputElement).value;
                  checkAutoUnlock(val);
                }}
                onPaste={(e: React.ClipboardEvent<HTMLInputElement>) => {
                  const pasted = e.clipboardData.getData('text');
                  if (pasted) {
                    checkAutoUnlock(pasted);
                  }
                }}
                disabled={isVerifying || isMelting}
                placeholder="Enter secret password..."
                autoComplete="off"
                style={{
                  backgroundColor: 'var(--card-subtle)',
                  borderColor: errorMsg ? '#ef4444' : 'var(--card-border)',
                  color: 'var(--text)',
                }}
                className="w-full px-4 py-3.5 pl-11 rounded-2xl border text-sm sm:text-base font-medium outline-hidden transition-all focus:ring-2 focus:ring-[var(--accent)] shadow-inner"
              />
              <KeyRound
                className="w-4 h-4 sm:w-5 sm:h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--accent)] pointer-events-none"
              />
            </div>

            {errorMsg && (
              <p
                role="alert"
                className="text-xs sm:text-sm text-rose-500 font-semibold animate-shake"
              >
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={!inputVal.trim() || isVerifying || isMelting}
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--accent-text)',
              }}
              className="w-full py-3.5 px-6 rounded-2xl font-bold text-sm sm:text-base shadow-md hover:opacity-95 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
            >
              {isVerifying || isMelting ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin text-amber-200" />
                  <span>Unlocking with care...</span>
                </>
              ) : (
                <>
                  <Heart className="w-4 h-4 fill-white" />
                  <span>Open Letter</span>
                </>
              )}
            </button>
          </form>

          {/* Password Hint */}
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => setShowHint((prev) => !prev)}
              style={{ color: 'var(--text-soft)' }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold hover:opacity-80 transition-opacity cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>{showHint ? 'Hide password hint' : 'Need a password hint?'}</span>
            </button>

            {showHint && (
              <div
                style={{
                  backgroundColor: 'var(--card-subtle)',
                  borderColor: 'var(--card-border)',
                  color: 'var(--text)',
                }}
                className="mt-3 p-3.5 sm:p-4 rounded-2xl border animate-fade-in text-center max-w-sm mx-auto shadow-xs flex flex-col items-center justify-center gap-1"
              >
                <div className="flex items-center justify-center gap-2 sm:gap-3 w-full px-1">
                  {/* Left Heart Flourish Line */}
                  <svg
                    className="w-10 sm:w-14 h-5 text-[var(--accent)] shrink-0 opacity-85"
                    viewBox="0 0 60 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 10 H22 L25 5 L28 15 L31 7 L34 12 L37 10 H42" />
                    <path d="M42 10 C42 6, 46 4, 49 7 C52 4, 56 6, 56 10 C56 14, 49 18, 49 18 C49 18, 42 14, 42 10 Z" fill="currentColor" fillOpacity="0.25" />
                  </svg>

                  {/* Stylish 'your day' in Heart Calligraphy Script */}
                  <span
                    className="font-heart-script text-2xl sm:text-3xl text-golden-letter tracking-wider select-none inline-block pb-0.5"
                    style={{
                      fontFamily: "'Great Vibes', 'Dancing Script', 'Sacramento', 'Caveat', cursive",
                      filter: 'drop-shadow(0 0 10px rgba(251, 191, 36, 0.45))',
                    }}
                  >
                    {passwordHint || 'your day'}
                  </span>

                  {/* Right Heart Flourish Line (mirrored) */}
                  <svg
                    className="w-10 sm:w-14 h-5 text-[var(--accent)] shrink-0 opacity-85 scale-x-[-1]"
                    viewBox="0 0 60 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 10 H22 L25 5 L28 15 L31 7 L34 12 L37 10 H42" />
                    <path d="M42 10 C42 6, 46 4, 49 7 C52 4, 56 6, 56 10 C56 14, 49 18, 49 18 C49 18, 42 14, 42 10 Z" fill="currentColor" fillOpacity="0.25" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Cinematic Unlocked Letter - Revealing One Line at a Time while scrolling */
        <div
          style={{
            backgroundColor: 'var(--card-solid)',
            borderColor: 'var(--card-border)',
            boxShadow: '0 16px 45px var(--shadow-color)',
          }}
          className="relative px-4 py-8 sm:px-10 sm:py-12 rounded-3xl border transition-all animate-scale-up"
        >
          {/* Top Decorative Header */}
          <div
            style={{ borderColor: 'var(--card-border)' }}
            className="flex items-center justify-between border-b pb-5"
          >
            <div className="flex items-center gap-2.5">
              <div
                style={{ backgroundColor: 'var(--accent)' }}
                className="w-8 h-8 rounded-full text-white flex items-center justify-center shadow-xs"
              >
                <Heart className="w-4 h-4 fill-white" />
              </div>
              <span
                style={{ color: 'var(--text)' }}
                className="font-serif text-lg sm:text-xl font-bold tracking-tight"
              >
                Written With Gentle Care
              </span>
            </div>
            <span
              style={{ color: 'var(--accent)' }}
              className="font-serif text-sm sm:text-base font-bold uppercase tracking-wider"
            >
              Purest Words
            </span>
          </div>

          {/* Letter Opening Greeting */}
          <div className="text-center pt-10 pb-8">
            <h3
              className="font-romantic text-4xl sm:text-5xl md:text-6xl font-bold tracking-wide italic text-golden-glow"
            >
              {greeting}
            </h3>
            <p
              style={{ color: 'var(--text-soft)' }}
              className="text-xs sm:text-sm font-sans font-medium mt-3 tracking-widest uppercase opacity-80 flex items-center justify-center gap-2"
            >
              <span>Scroll slowly to reveal each thought</span>
              <ChevronDown className="w-3.5 h-3.5 animate-bounce text-amber-400" />
            </p>
          </div>

          {/* Cinematic Scrolling Body: Revealed ONE LINE AT A TIME in Big Bold Gold */}
          <div className="my-8 sm:my-14">
            {lines.map((line, idx) => (
              <div
                key={line.id}
                ref={(el) => {
                  lineRefs.current[idx] = el;
                }}
                className={`cinematic-line-wrapper flex flex-col justify-center items-center text-center px-3 sm:px-6 select-text ${
                  line.isParagraphEnd && idx < lines.length - 1
                    ? 'min-h-[18vh] sm:min-h-[24vh] pb-10 sm:pb-14'
                    : 'min-h-[14vh] sm:min-h-[18vh] py-3 sm:py-4'
                }`}
                style={{
                  opacity: 0,
                  transform: 'translate3d(0, 20px, 0)',
                }}
              >
                <p
                  className="cinematic-line font-romantic text-2xl sm:text-3xl md:text-4xl lg:text-[2.65rem] font-bold leading-[1.5] sm:leading-[1.55] tracking-[0.01em] max-w-xl sm:max-w-3xl mx-auto text-golden-letter"
                >
                  {line.text}
                </p>

                {/* Delicate golden pause dot between paragraphs */}
                {line.isParagraphEnd && idx < lines.length - 1 && (
                  <div className="pt-6 pb-2 flex items-center justify-center opacity-40 select-none pointer-events-none">
                    <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Cinematic Handwriting Signature at the End */}
          <div
            style={{ borderColor: 'var(--card-border)' }}
            className="pt-16 pb-6 border-t text-center space-y-3"
          >
            <div className="flex justify-center">
              <div
                style={{ backgroundColor: 'rgba(251, 191, 36, 0.15)' }}
                className="w-12 h-12 rounded-full flex items-center justify-center border border-amber-400/30"
              >
                <Heart className="w-6 h-6 text-amber-400 fill-amber-400 animate-pulse drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
              </div>
            </div>

            <p
              className="font-handwriting text-3xl sm:text-4xl md:text-5xl font-bold tracking-wide text-golden-glow"
            >
              Forever Your Safe Harbor
            </p>
            <p
              className="font-romantic italic text-lg sm:text-xl md:text-2xl font-bold text-golden-letter opacity-90"
            >
              Always and unconditionally
            </p>

            {/* Dynamic Slot: Secret Letter Bottom */}
            <div className="pt-4 max-w-md mx-auto">
              <DynamicSlot slotId="secret_letter_bottom" isDarkMode={_isDarkMode} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
