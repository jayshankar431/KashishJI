import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Heart, Sparkles, Send, X, Waves, Compass, RotateCcw, Check } from 'lucide-react';
import { useSite, DEFAULT_BOTTLE_MESSAGES, BottleMessage } from '../siteContent';
import { romanticAudio } from '../audio';
import { triggerHaptic, logNativeActivity, incrementStat, showNativeToast } from '../androidBridge';
import { addDoc, collection } from 'firebase/firestore';
import { auth, db } from '../firebase';

interface FloatingBottleInstance {
  instanceId: string;
  note: BottleMessage;
  startY: number; // viewportvh percentage (18 to 74)
  direction: 'ltr' | 'rtl';
  durationSec: number;
  createdAt: number;
  herWish?: string;
}

interface MessageInABottleProps {
  recipientName: string;
  isDarkMode: boolean;
}

export const MessageInABottle: React.FC<MessageInABottleProps> = ({
  recipientName,
  isDarkMode,
}) => {
  const site = useSite();
  const availableNotes: BottleMessage[] =
    Array.isArray(site.bottleMessages) && site.bottleMessages.length > 0
      ? site.bottleMessages
      : DEFAULT_BOTTLE_MESSAGES;

  const [floatingBottles, setFloatingBottles] = useState<FloatingBottleInstance[]>([]);
  const [activeNote, setActiveNote] = useState<{
    note: BottleMessage;
    herWish?: string;
  } | null>(null);
  const [openedIds, setOpenedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('kashish_opened_bottle_ids');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [wishInput, setWishInput] = useState<string>('');
  const [replyText, setReplyText] = useState<string>('');
  const [isSendingReply, setIsSendingReply] = useState<boolean>(false);
  const [replySentSuccess, setReplySentSuccess] = useState<boolean>(false);
  const lastPickedIndexRef = useRef<number>(-1);

  // Lock viewport scroll when secret scroll modal is open
  useEffect(() => {
    if (!activeNote) return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [activeNote]);

  // Clean up bottles that finished drifting across the screen after their duration
  useEffect(() => {
    if (floatingBottles.length === 0) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setFloatingBottles((prev) =>
        prev.filter((b) => now - b.createdAt < (b.durationSec + 2) * 1000)
      );
    }, 1500);
    return () => clearInterval(interval);
  }, [floatingBottles.length]);

  const pickNextSecretNote = useCallback((): BottleMessage => {
    const unread = availableNotes.filter((n) => !openedIds.includes(n.id));
    const pool = unread.length > 0 ? unread : availableNotes;
    let nextIdx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && nextIdx === lastPickedIndexRef.current) {
      nextIdx = (nextIdx + 1) % pool.length;
    }
    lastPickedIndexRef.current = nextIdx;
    return pool[nextIdx] || availableNotes[0];
  }, [availableNotes, openedIds]);

  const handleDropBottle = () => {
    triggerHaptic(40);
    romanticAudio.playChime();

    const chosenNote = pickNextSecretNote();
    const trimmedWish = wishInput.trim();
    if (trimmedWish) {
      setWishInput('');
    }

    const randomY = Math.floor(24 + Math.random() * 46); // 24vh to 70vh
    const direction: 'ltr' | 'rtl' = Math.random() > 0.4 ? 'ltr' : 'rtl';
    const durationSec = 18 + Math.floor(Math.random() * 6); // 18-23 seconds smooth float across screen

    const newBottle: FloatingBottleInstance = {
      instanceId: `flt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      note: chosenNote,
      startY: randomY,
      direction,
      durationSec,
      createdAt: Date.now(),
      herWish: trimmedWish || undefined,
    };

    setFloatingBottles((prev) => [...prev.slice(-4), newBottle]);
    void logNativeActivity(
      trimmedWish
        ? `🍾 ${recipientName} dropped a Message in a Bottle with a wish: "${trimmedWish}"`
        : `🍾 ${recipientName} dropped a Message in a Bottle onto the screen!`
    );
    void incrementStat('bottles_dropped');
  };

  const handleTapFloatingBottle = (bottle: FloatingBottleInstance) => {
    triggerHaptic(55);
    romanticAudio.playChime();

    // Remove tapped bottle from screen
    setFloatingBottles((prev) => prev.filter((b) => b.instanceId !== bottle.instanceId));
    setReplyText('');
    setReplySentSuccess(false);
    setActiveNote({
      note: bottle.note,
      herWish: bottle.herWish,
    });

    // Record note as discovered
    if (!openedIds.includes(bottle.note.id)) {
      const nextOpened = [...openedIds, bottle.note.id];
      setOpenedIds(nextOpened);
      try {
        localStorage.setItem('kashish_opened_bottle_ids', JSON.stringify(nextOpened));
      } catch {}
    }

    void logNativeActivity(
      `💌 ${recipientName} uncorked Message in a Bottle: "${bottle.note.title}"`,
      false,
      'letter_opened'
    );
    void incrementStat('bottles_opened');
  };

  const handleSendBottleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || isSendingReply || !activeNote) return;

    const cleanReply = replyText.trim();
    setIsSendingReply(true);
    triggerHaptic(40);

    try {
      await addDoc(collection(db, 'inbox'), {
        type: 'bottle_note',
        caption: `🍾 Reply to Bottle "${activeNote.note.title}": ${cleanReply}`,
        mediaUrl: '',
        createdAt: Date.now(),
        dateIso: new Date().toISOString(),
        read: false,
        senderEmail: auth.currentUser?.email || 'kashish',
        senderUid: auth.currentUser?.uid || '',
      });
      await logNativeActivity(
        `🍾 ${recipientName} sent back a Message in a Bottle: "${cleanReply}"`
      );
      setReplySentSuccess(true);
      setReplyText('');
      showNativeToast('Your bottle message drifted to Jay! 💖');
    } catch {
      showNativeToast('Could not send reply right now. Please try again.');
    } finally {
      setIsSendingReply(false);
    }
  };

  const formatMessageBody = (rawText: string) => {
    return rawText.replace(/\{name\}/gi, recipientName || 'Kashish');
  };

  const discoveredCount = availableNotes.filter((n) => openedIds.includes(n.id)).length;

  return (
    <>
      {/* Home Sanctuary Card for Message in a Bottle */}
      <section
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--card-border)',
          boxShadow: '0 8px 28px var(--shadow-color)',
        }}
        className="relative overflow-hidden rounded-3xl border p-5 sm:p-7 transition-all"
      >
        {/* Subtle Starlight Water Wave Backdrop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-28 opacity-25"
          style={{
            background: isDarkMode
              ? 'radial-gradient(ellipse at 50% 100%, rgba(244, 63, 94, 0.28), rgba(56, 189, 248, 0.12) 60%, transparent 80%)'
              : 'radial-gradient(ellipse at 50% 100%, rgba(244, 63, 94, 0.18), rgba(56, 189, 248, 0.1) 60%, transparent 80%)',
          }}
        />

        <div className="relative z-10 flex flex-col gap-5">
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3.5">
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(244, 63, 94, 0.18), rgba(14, 165, 233, 0.18))',
                  borderColor: 'var(--card-border)',
                  color: 'var(--accent)',
                }}
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl border flex items-center justify-center shrink-0 shadow-sm"
              >
                <Waves className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2
                    style={{ color: 'var(--text)' }}
                    className="font-serif text-lg sm:text-xl font-bold"
                  >
                    Message in a Bottle
                  </h2>
                  <span
                    style={{ color: 'var(--text-soft)' }}
                    className="text-xs font-medium"
                  >
                    · {discoveredCount} of {availableNotes.length} notes discovered
                  </span>
                </div>
                <p
                  style={{ color: 'var(--text-soft)' }}
                  className="text-xs sm:text-sm font-medium mt-0.5 leading-relaxed"
                >
                  Drop a virtual bottle onto the screen, watch it drift across the current, and tap it to uncork a secret romantic note written for you.
                </p>
              </div>
            </div>

            {floatingBottles.length > 0 && (
              <div
                style={{ color: 'var(--accent)' }}
                className="text-xs font-bold flex items-center gap-1.5 shrink-0"
              >
                <Compass className="w-4 h-4 animate-spin" style={{ animationDuration: '6s' }} />
                <span>
                  {floatingBottles.length} bottle{floatingBottles.length > 1 ? 's' : ''} drifting on screen — tap to open!
                </span>
              </div>
            )}
          </div>

          {/* Interactive Drop Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1">
              <input
                type="text"
                value={wishInput}
                onChange={(e) => setWishInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleDropBottle();
                  }
                }}
                placeholder="Whisper a wish into the bottle before dropping (optional)..."
                style={{
                  backgroundColor: 'var(--card-subtle)',
                  borderColor: 'var(--card-border)',
                  color: 'var(--text)',
                }}
                className="w-full px-4 py-3 rounded-2xl border text-xs sm:text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={handleDropBottle}
              style={{
                background: 'linear-gradient(135deg, #ec4899 0%, #e11d48 55%, #be123c 100%)',
                boxShadow: '0 6px 20px rgba(225, 29, 72, 0.35)',
              }}
              className="px-5 py-3 rounded-2xl text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer shrink-0 min-h-[44px]"
            >
              <Sparkles className="w-4 h-4" />
              <span>Drop a Bottle on Screen</span>
            </button>
          </div>
        </div>
      </section>

      {/* Portaled Floating Bottles Drifting Across the Screen */}
      {floatingBottles.length > 0 &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[1350] pointer-events-none overflow-hidden select-none">
            <style>{`
              @keyframes bottleFloatLTR {
                0% {
                  transform: translate3d(-160px, 0px, 0) rotate(-6deg);
                  opacity: 0;
                }
                8% {
                  opacity: 1;
                }
                25% {
                  transform: translate3d(25vw, -18px, 0) rotate(5deg);
                }
                50% {
                  transform: translate3d(52vw, 14px, 0) rotate(-4deg);
                }
                75% {
                  transform: translate3d(78vw, -12px, 0) rotate(6deg);
                }
                92% {
                  opacity: 1;
                }
                100% {
                  transform: translate3d(calc(100vw + 180px), 6px, 0) rotate(-5deg);
                  opacity: 0;
                }
              }
              @keyframes bottleFloatRTL {
                0% {
                  transform: translate3d(calc(100vw + 160px), 0px, 0) rotate(6deg);
                  opacity: 0;
                }
                8% {
                  opacity: 1;
                }
                25% {
                  transform: translate3d(74vw, -16px, 0) rotate(-5deg);
                }
                50% {
                  transform: translate3d(48vw, 15px, 0) rotate(4deg);
                }
                75% {
                  transform: translate3d(22vw, -14px, 0) rotate(-6deg);
                }
                92% {
                  opacity: 1;
                }
                100% {
                  transform: translate3d(-180px, 8px, 0) rotate(5deg);
                  opacity: 0;
                }
              }
            `}</style>

            {floatingBottles.map((bottle) => (
              <div
                key={bottle.instanceId}
                style={{
                  top: `${bottle.startY}vh`,
                  left: 0,
                  animation: `${
                    bottle.direction === 'ltr' ? 'bottleFloatLTR' : 'bottleFloatRTL'
                  } ${bottle.durationSec}s cubic-bezier(0.35, 0.05, 0.65, 0.95) forwards`,
                }}
                className="absolute pointer-events-auto"
              >
                <button
                  type="button"
                  onClick={() => handleTapFloatingBottle(bottle)}
                  aria-label="Tap floating bottle to reveal secret note"
                  className="group relative flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border border-rose-300/50 bg-[#1a0b26]/90 backdrop-blur-md text-white shadow-[0_10px_30px_rgba(244,63,94,0.45)] hover:scale-110 active:scale-95 transition-transform cursor-pointer touch-manipulation"
                >
                  {/* Luminous Glass Bottle SVG with Rolled Scroll & Wax Seal */}
                  <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
                    <span className="absolute inset-0 rounded-full bg-rose-500/30 animate-ping" />
                    <svg
                      viewBox="0 0 64 64"
                      className="w-9 h-9 drop-shadow-[0_2px_8px_rgba(244,63,94,0.6)]"
                      fill="none"
                    >
                      {/* Cork */}
                      <rect
                        x="27"
                        y="6"
                        width="10"
                        height="7"
                        rx="2"
                        fill="#d97706"
                        stroke="#fef3c7"
                        strokeWidth="1.2"
                      />
                      {/* Bottle Neck */}
                      <path
                        d="M25 13H39V20L45 27V52C45 55.3137 42.3137 58 39 58H25C21.6863 58 19 55.3137 19 52V27L25 20V13Z"
                        fill="url(#bottleGlassGrad)"
                        stroke="#f9a8d4"
                        strokeWidth="2"
                      />
                      {/* Rolled Parchment Scroll Inside */}
                      <rect
                        x="25"
                        y="27"
                        width="14"
                        height="22"
                        rx="3"
                        fill="#fef3c7"
                        stroke="#f59e0b"
                        strokeWidth="1.2"
                      />
                      {/* Wax Heart Seal on Scroll */}
                      <circle cx="32" cy="38" r="4" fill="#e11d48" />
                      {/* Water Ripple Highlight */}
                      <path
                        d="M15 54C21 51 27 57 33 54C39 51 45 57 50 54"
                        stroke="#7dd3fc"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <defs>
                        <linearGradient id="bottleGlassGrad" x1="19" y1="13" x2="45" y2="58" gradientUnits="userSpaceOnUse">
                          <stop stopColor="rgba(255, 255, 255, 0.35)" />
                          <stop offset="0.5" stopColor="rgba(244, 114, 182, 0.25)" />
                          <stop offset="1" stopColor="rgba(56, 189, 248, 0.35)" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>

                  <div className="text-left pr-1">
                    <div className="text-xs font-serif font-bold text-pink-100 flex items-center gap-1">
                      <span>Tap to Uncork</span>
                      <Heart className="w-3 h-3 text-rose-400 fill-rose-400 animate-pulse" />
                    </div>
                    <div className="text-[10px] text-pink-200/80 max-w-[140px] truncate">
                      {bottle.herWish ? `Wish: "${bottle.herWish}"` : 'Secret Note Inside'}
                    </div>
                  </div>
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}

      {/* Uncorked Secret Romantic Scroll Modal (Portaled to document.body) */}
      {activeNote &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={() => setActiveNote(null)}
            className="fixed inset-0 z-[1500] w-screen h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-fade-in select-none"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: isDarkMode
                  ? 'linear-gradient(165deg, #24102c 0%, #16091e 60%, #100617 100%)'
                  : 'linear-gradient(165deg, #fff9fb 0%, #fff0f5 60%, #fde8ef 100%)',
                borderColor: isDarkMode ? 'rgba(244, 114, 182, 0.35)' : 'rgba(225, 29, 72, 0.25)',
                color: isDarkMode ? '#fdf2f8' : '#3b0a24',
              }}
              className="relative w-full max-w-lg max-h-[88dvh] overflow-y-auto overscroll-contain rounded-3xl border p-6 sm:p-8 shadow-[0_0_60px_rgba(244,63,94,0.3)] flex flex-col justify-between gap-5"
            >
              {/* Top Bar */}
              <div className="flex items-center justify-between gap-2 border-b border-rose-500/20 pb-3.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-rose-400">
                  <Waves className="w-4 h-4" />
                  <span>Uncorked Message in a Bottle</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveNote(null)}
                  aria-label="Close secret note"
                  className="p-2 rounded-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Her Dropped Wish (if she typed one) */}
              {activeNote.herWish && (
                <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 px-4 py-2.5 text-xs italic">
                  <span className="font-semibold not-italic text-rose-400">Your cast wish: </span>
                  &ldquo;{activeNote.herWish}&rdquo;
                </div>
              )}

              {/* Secret Romantic Scroll Content */}
              <div className="space-y-4 my-1 text-center sm:text-left">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <div className="w-8 h-8 rounded-full bg-rose-500/20 border border-rose-400/40 flex items-center justify-center text-rose-400 shrink-0">
                    <Heart className="w-4 h-4 fill-rose-400" />
                  </div>
                  <h3 className="font-serif text-xl sm:text-2xl font-bold leading-snug">
                    {activeNote.note.title}
                  </h3>
                </div>

                <div
                  style={{
                    backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.75)',
                    borderColor: isDarkMode ? 'rgba(244, 114, 182, 0.2)' : 'rgba(225, 29, 72, 0.15)',
                  }}
                  className="rounded-2xl border p-5 sm:p-6 shadow-inner"
                >
                  <p className="font-serif text-sm sm:text-base leading-relaxed whitespace-pre-line">
                    {formatMessageBody(activeNote.note.message)}
                  </p>

                  {activeNote.note.signature && (
                    <div className="mt-4 pt-3 border-t border-rose-500/15 text-right font-script text-lg sm:text-xl text-rose-400">
                      — {activeNote.note.signature}
                    </div>
                  )}
                </div>
              </div>

              {/* Send a Whisper Back in a Bottle to Admin */}
              <form onSubmit={handleSendBottleReply} className="space-y-2.5 pt-1">
                <label className="block text-xs font-semibold opacity-80">
                  Send a secret whisper back to Jay in this bottle:
                </label>
                {replySentSuccess ? (
                  <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/30 px-4 py-3 text-xs font-semibold text-emerald-400 flex items-center justify-center gap-2">
                    <Check className="w-4 h-4" />
                    <span>Your secret whisper has drifted safely to Jay&apos;s inbox!</span>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Write a sweet note back..."
                      style={{
                        backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.06)' : '#ffffff',
                        borderColor: isDarkMode ? 'rgba(244, 114, 182, 0.25)' : 'rgba(225, 29, 72, 0.25)',
                      }}
                      className="flex-1 px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm focus:outline-none focus:border-rose-400"
                    />
                    <button
                      type="submit"
                      disabled={!replyText.trim() || isSendingReply}
                      className="px-4 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{isSendingReply ? 'Sending...' : 'Send Back'}</span>
                    </button>
                  </div>
                )}
              </form>

              {/* Footer Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-2 border-t border-rose-500/15">
                <button
                  type="button"
                  onClick={() => {
                    setActiveNote(null);
                    handleDropBottle();
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Drop Another Bottle</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveNote(null)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  Keep in My Heart
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
