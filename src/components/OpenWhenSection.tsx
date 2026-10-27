import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Mail,
  Heart,
  Sparkles,
  Lock,
  Unlock,
  X,
  Compass,
  Smile,
  Send,
  Trophy,
  Moon,
  Sun,
  Cloud,
  Volume2
} from 'lucide-react';
import { romanticAudio } from '../audio';
import { triggerHaptic, showNativeToast, logNativeActivity } from '../androidBridge';
import { DynamicSlot } from './DynamicSlot';

export interface OpenWhenEnvelope {
  id: string;
  label: string;
  emoji: string;
  moodColor: string;
  letterText: string;
  surpriseType: string;
  unlockRule?: string;
  unlockMessage?: string;
}

interface OpenWhenSectionProps {
  name: string;
  envelopes: OpenWhenEnvelope[];
  isDarkMode: boolean;
  openedIds: string[];
  onOpenEnvelope: (id: string) => void;
  onSendHug?: () => void;
}

export const OpenWhenSection: React.FC<OpenWhenSectionProps> = ({
  name,
  envelopes,
  isDarkMode,
  openedIds,
  onOpenEnvelope,
  onSendHug,
}) => {
  const [selectedEnvelope, setSelectedEnvelope] = useState<OpenWhenEnvelope | null>(null);
  const [shakeId, setShakeId] = useState<string | null>(null);
  const [lockedNotice, setLockedNotice] = useState<string | null>(null);
  const [showPlane, setShowPlane] = useState(true);

  // Flight animation for paper plane on entrance
  useEffect(() => {
    const timer = setTimeout(() => setShowPlane(false), 2800);
    return () => clearTimeout(timer);
  }, []);

  // Check unlock rules
  const checkUnlock = (env: OpenWhenEnvelope): { canOpen: boolean; reason?: string } => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    if (env.unlockRule === 'midnight') {
      // 11:30 PM (23:30 = 1410 min) to 2:00 AM (120 min)
      const isMidnight = totalMinutes >= 1410 || totalMinutes <= 120;
      if (!isMidnight) {
        return {
          canOpen: false,
          reason: "This one only opens under the midnight sky (11:30 PM - 2:00 AM).",
        };
      }
    }

    if (env.unlockRule === 'morning') {
      // 5:00 AM (300 min) to 10:00 AM (600 min)
      const isMorning = totalMinutes >= 300 && totalMinutes <= 600;
      if (!isMorning) {
        return {
          canOpen: false,
          reason: "This one is waiting for the morning light (5:00 AM - 10:00 AM).",
        };
      }
    }

    if (env.unlockRule === 'readAllOthers') {
      // Must have opened at least 6 other envelopes
      const otherOpenedCount = openedIds.filter((id) => id !== env.id).length;
      if (otherOpenedCount < 6) {
        return {
          canOpen: false,
          reason: `This golden letter unlocks after you have opened at least 6 other envelopes! (${otherOpenedCount}/6 opened)`,
        };
      }
    }

    return { canOpen: true };
  };

  const handleEnvelopeClick = (env: OpenWhenEnvelope) => {
    // Open envelope directly
    triggerHaptic(40);
    romanticAudio.playChime();
    setLockedNotice(null);
    setSelectedEnvelope(env);

    if (!openedIds.includes(env.id)) {
      showNativeToast(`Opened: ${env.label} 💌`);
      logNativeActivity("💌 Kashish opened Secret Letter: " + env.label);
      onOpenEnvelope(env.id);
    } else {
      logNativeActivity("💌 Kashish opened Secret Letter: " + env.label);
    }
  };

  const closeLetter = () => {
    setSelectedEnvelope(null);
  };

  // Replace [NAME] and [MY NAME] in letter text
  const formatLetterText = (text: string) => {
    return text.replace(/\[NAME\]/g, name).replace(/\[MY NAME\]/g, 'Forever Yours');
  };

  return (
    <div className="space-y-8 animate-fade-in pb-16 relative overflow-hidden">
      {/* Paper Plane Flying Across on Section Mount */}
      {showPlane && (
        <div className="absolute top-12 -left-12 pointer-events-none z-30 animate-plane-fly flex items-center gap-1.5 opacity-90">
          <span className="text-2xl">✈️</span>
          <span className="text-[11px] font-bold text-[var(--accent)] bg-[var(--card)] px-2 py-0.5 rounded-full border border-[var(--card-border)] shadow-xs">
            Special Delivery for {name}
          </span>
        </div>
      )}

      {/* Header & Post Office Sign */}
      <div className="text-center space-y-1 relative z-10">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border border-[var(--card-border)] bg-[var(--card-subtle)] text-[var(--accent)] mb-1">
          <Mail className="w-3.5 h-3.5" />
          <span>Midnight Post Office</span>
        </div>
        <h2
          style={{ color: 'var(--text)' }}
          className="font-serif text-3xl sm:text-5xl font-bold tracking-tight"
        >
          Open When...
        </h2>
        <p
          style={{ color: 'var(--text-soft)' }}
          className="text-xs sm:text-sm font-semibold italic max-w-md mx-auto"
        >
          "12 sealed letters hanging on warm fairy lights, waiting for every tender moment."
        </p>
        <p
          style={{ color: 'var(--accent)' }}
          className="text-xs font-bold pt-1"
        >
          Opened {openedIds.length} of {envelopes.length} letters
        </p>
      </div>

      {/* Locked Rule Notification Banner */}
      {lockedNotice && (
        <div
          style={{
            backgroundColor: 'var(--card-solid)',
            borderColor: 'var(--accent)',
            boxShadow: '0 6px 20px var(--shadow-color)',
          }}
          className="max-w-md mx-auto p-3.5 rounded-2xl border-2 text-center text-xs font-bold text-[var(--text)] animate-shake"
        >
          <div className="flex items-center justify-center gap-2 text-[var(--accent)] mb-1">
            <Lock className="w-4 h-4" />
            <span>Gentle Notice</span>
          </div>
          <p>{lockedNotice}</p>
        </div>
      )}

      {/* Vintage Post Office Clothesline & Hanging Envelopes */}
      <div className="relative pt-6 pb-4">
        {/* Fairy Lights & Wire String */}
        <div className="relative w-full max-w-3xl mx-auto mb-6">
          {/* Wire String */}
          <div className="w-full h-0.5 bg-gradient-to-r from-amber-600/30 via-amber-600/70 to-amber-600/30 shadow-xs" />

          {/* Warm Fairy Light Bulbs across wire */}
          <div className="absolute -top-1.5 left-0 right-0 flex justify-between px-6 pointer-events-none">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={i}
                style={{
                  backgroundColor: i % 2 === 0 ? '#fde047' : '#f472b6',
                  boxShadow: '0 0 10px 2px rgba(253, 224, 71, 0.65)',
                }}
                className="w-3 h-3 rounded-full animate-sparkle"
              />
            ))}
          </div>
        </div>

        {/* 12 Hanging Envelopes Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6 max-w-4xl mx-auto px-2">
          {envelopes.map((env, idx) => {
            const isOpened = openedIds.includes(env.id);
            const isShaking = shakeId === env.id;
            const swayClass = idx % 2 === 0 ? 'animate-sway' : 'animate-sway-alt';

            return (
              <button
                type="button"
                key={env.id}
                onClick={() => handleEnvelopeClick(env)}
                aria-label={`${env.label}: ${isOpened ? 'opened letter' : env.unlockRule ? 'locked letter' : 'open letter'}`}
                className={`group relative flex w-full flex-col items-center border-0 bg-transparent p-0 text-left cursor-pointer select-none transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-2xl ${swayClass} ${
                  isShaking ? 'animate-shake' : 'hover:-translate-y-1'
                }`}
              >
                {/* Wooden Clothespin */}
                <div
                  style={{
                    backgroundColor: '#d97706',
                    borderColor: '#b45309',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  }}
                  className="w-3.5 h-6 rounded-xs border z-20 -mb-2 transform rotate-1"
                />

                {/* Envelope Body */}
                <div
                  style={{
                    backgroundColor: 'var(--card-solid)',
                    borderColor: env.moodColor,
                    boxShadow: '0 8px 20px var(--shadow-color)',
                  }}
                  className="w-full aspect-4/3 rounded-2xl border-2 p-3.5 flex flex-col justify-between relative overflow-hidden transition-colors duration-300 group-hover:scale-[1.02]"
                >
                  {/* Subtle envelope flap triangle watermark */}
                  <div
                    style={{
                      borderBottom: `1px solid ${env.moodColor}33`,
                      backgroundColor: `${env.moodColor}15`,
                      clipPath: 'polygon(0 0, 50% 100%, 100% 0)',
                    }}
                    className="absolute top-0 left-0 right-0 h-10 pointer-events-none"
                  />

                  {/* Top Bar: Stamp, Postmark & Emoji */}
                  <div className="flex items-start justify-between relative z-10">
                    <span className="text-xl">{env.emoji}</span>

                    {/* Vintage Postmark & Stamp */}
                    <div className="flex items-center gap-1.5 opacity-85 select-none">
                      {/* Circular Cancellation Postmark */}
                      <div
                        style={{
                          borderColor: `${env.moodColor}99`,
                          color: env.moodColor,
                        }}
                        className="w-6 h-6 rounded-full border border-dashed flex flex-col items-center justify-center text-[6px] font-bold leading-none"
                      >
                        <span>POST</span>
                        <span className="scale-75">17 DEC</span>
                      </div>

                      {/* Vintage Stamp with Perforated Edge */}
                      <div
                        style={{
                          borderColor: env.moodColor,
                          backgroundColor: `${env.moodColor}22`,
                          color: env.moodColor,
                        }}
                        className="w-6 h-7 rounded-xs border border-dashed flex items-center justify-center text-[10px] font-bold shadow-2xs"
                      >
                        ♥
                      </div>
                    </div>
                  </div>

                  {/* Middle Label in Caveat 700 */}
                  <div className="my-auto text-center relative z-10 px-1 py-1">
                    <p
                      style={{ color: 'var(--text)' }}
                      className="font-handwriting font-serif text-base sm:text-lg font-bold leading-snug tracking-wide"
                    >
                      {env.label}
                    </p>
                  </div>

                  {/* Bottom: Wax Seal & Status */}
                  <div className="flex items-center justify-between relative z-10 pt-1">
                    {/* Wax Seal */}
                    <div
                      style={{
                        backgroundColor: env.moodColor,
                        boxShadow: `0 2px 8px ${env.moodColor}60`,
                      }}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs border border-white/60 transition-transform group-hover:scale-110"
                    >
                      ♥
                    </div>

                    {/* Opened ribbon mark or Special badge */}
                    {isOpened ? (
                      <span
                        style={{
                          backgroundColor: 'var(--card-subtle)',
                          borderColor: 'var(--accent)',
                          color: 'var(--accent)',
                        }}
                        className="text-[9px] px-2 py-0.5 rounded-full font-bold border flex items-center gap-1 shadow-2xs"
                      >
                        <span>Opened</span>
                        <Heart className="w-2.5 h-2.5 fill-[var(--accent)]" />
                      </span>
                    ) : env.unlockRule ? (
                      <span
                        style={{
                          backgroundColor: 'var(--card-subtle)',
                          borderColor: env.moodColor,
                          color: env.moodColor,
                        }}
                        className="text-[9px] px-2 py-0.5 rounded-full font-bold border flex items-center gap-1 shadow-2xs"
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                        <span>Special</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Dynamic Slot: Open When Bottom */}
        <DynamicSlot slotId="open_when_bottom" isDarkMode={isDarkMode} />
      </div>

      {/* Opened Envelope Reading & Surprise Modal */}
      {selectedEnvelope && (
        <LetterModal
          name={name}
          envelope={selectedEnvelope}
          formattedText={formatLetterText(selectedEnvelope.letterText)}
          onClose={closeLetter}
          isDarkMode={isDarkMode}
          onSendHug={onSendHug}
        />
      )}
    </div>
  );
};

/* =========================================================================
   LETTER MODAL (Slide-out Parchment & Interactive Surprise)
   ========================================================================= */
interface LetterModalProps {
  name: string;
  envelope: OpenWhenEnvelope;
  formattedText: string;
  onClose: () => void;
  isDarkMode: boolean;
  onSendHug?: () => void;
}

const LetterModal: React.FC<LetterModalProps> = ({
  name,
  envelope,
  formattedText,
  onClose,
  isDarkMode,
  onSendHug,
}) => {
  const backdropRef = useRef<HTMLDivElement>(null);

  // Opening animation stages: 'cracking' -> 'open'
  const [openingStage, setOpeningStage] = useState<'cracking' | 'open'>('cracking');
  const [displayedBody, setDisplayedBody] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  // Lock background page scroll on mount and restore on unmount/close
  useEffect(() => {
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;

    // Prevent layout shift from scrollbar disappearing on desktop
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    // Lock background scrolling completely
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // Handle Escape key to close modal
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Prevent wheel chaining on backdrop
    const backdropEl = backdropRef.current;
    const preventBackdropWheel = (e: WheelEvent) => {
      if (e.target === backdropEl) {
        e.preventDefault();
      }
    };
    if (backdropEl) {
      backdropEl.addEventListener('wheel', preventBackdropWheel, { passive: false });
    }

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.paddingRight = originalPaddingRight;
      window.removeEventListener('keydown', handleKeyDown);
      if (backdropEl) {
        backdropEl.removeEventListener('wheel', preventBackdropWheel);
      }
    };
  }, [onClose]);

  // Split formattedText into body and signature
  // Most letters end with "[Signoff],\nForever Yours"
  const lines = formattedText.trim().split('\n');
  let bodyLines = lines;
  let signatureLines: string[] = [];

  if (lines.length >= 2) {
    const lastLine = lines[lines.length - 1];
    const secondLastLine = lines[lines.length - 2];
    if (secondLastLine.trim() === '' || lines.length > 3) {
      signatureLines = lines.slice(lines.length - 2);
      bodyLines = lines.slice(0, lines.length - 2);
    }
  }

  const fullBodyText = bodyLines.join('\n');
  const fullSignatureText = signatureLines.join('\n');

  // Trigger crack animation on mount, then open letter
  useEffect(() => {
    const timer = setTimeout(() => {
      setOpeningStage('open');
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Soft typewriter effect for letter body
  useEffect(() => {
    if (openingStage !== 'open') return;

    setDisplayedBody('');
    setIsTyping(true);
    let idx = 0;

    const timer = setInterval(() => {
      idx += 2;
      if (idx >= fullBodyText.length) {
        setDisplayedBody(fullBodyText);
        setIsTyping(false);
        clearInterval(timer);
      } else {
        setDisplayedBody(fullBodyText.slice(0, idx));
      }
    }, 22);

    return () => clearInterval(timer);
  }, [openingStage, fullBodyText]);

  const handleSkipTyping = () => {
    setDisplayedBody(fullBodyText);
    setIsTyping(false);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[1300] w-screen h-[100dvh] max-h-[100dvh] flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-sm animate-fade-in overflow-hidden select-none"
      style={{ overscrollBehavior: 'contain' }}
    >
      {openingStage === 'cracking' ? (
        /* Enchanting Wax Seal Cracking Animation */
        <div className="relative text-center p-8 rounded-3xl bg-[var(--card-solid)] border-2 border-[var(--accent)] shadow-2xl animate-scale-up space-y-4 max-w-sm w-full mx-auto">
          <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
            {/* Pulsing Sparkle Ring */}
            <div
              style={{ backgroundColor: `${envelope.moodColor}33` }}
              className="absolute inset-0 rounded-full animate-ping"
            />
            {/* Wax Seal with Crack */}
            <div
              style={{
                backgroundColor: envelope.moodColor,
                boxShadow: `0 0 25px ${envelope.moodColor}`,
              }}
              className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold shadow-xl border-2 border-white/70 relative overflow-hidden"
            >
              <Heart className="w-10 h-10 fill-white animate-heartbeat" />
              <Sparkles className="absolute top-1 right-2 w-4 h-4 text-amber-300 animate-spin" />
            </div>
          </div>
          <p
            style={{ color: 'var(--text)' }}
            className="font-handwriting font-serif text-2xl font-bold"
          >
            Breaking the wax seal... ✨
          </p>
          <p style={{ color: 'var(--text-soft)' }} className="text-xs font-semibold">
            Unfolding a letter written just for you.
          </p>
        </div>
      ) : (
        /* Parchment Letter & Surprise Container */
        <div
          style={{
            backgroundColor: 'var(--card-solid)',
            borderColor: envelope.moodColor,
            boxShadow: '0 20px 45px var(--shadow-color)',
            maxHeight: 'calc(100dvh - 32px)',
          }}
          className="relative w-full max-w-xl rounded-3xl border-2 flex flex-col overflow-hidden animate-scale-up my-auto"
        >
          {/* Modal Header: Fixed at top while content scrolls */}
          <div
            style={{
              borderColor: 'var(--card-border)',
              backgroundColor: 'var(--card-solid)',
            }}
            className="sticky top-0 z-20 flex items-center justify-between p-4 sm:p-5 border-b backdrop-blur-md shrink-0 select-none"
          >
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <span className="text-2xl shrink-0">{envelope.emoji}</span>
              <h3
                style={{ color: 'var(--text)' }}
                className="font-handwriting font-serif text-xl sm:text-3xl font-bold tracking-tight truncate"
              >
                {envelope.label}
              </h3>
            </div>

            <button
              onClick={onClose}
              aria-label="Close letter"
              style={{ color: 'var(--text-soft)' }}
              className="min-h-[48px] min-w-[48px] rounded-full flex items-center justify-center hover:text-[var(--accent)] hover:bg-[var(--card-subtle)] cursor-pointer shrink-0 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Scrollable Letter Content: Only this area scrolls with overscroll-contain */}
          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-7 space-y-4"
            style={{
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {envelope.unlockMessage && (
              <div
                style={{
                  backgroundColor: `${envelope.moodColor}15`,
                  borderColor: `${envelope.moodColor}40`,
                  color: 'var(--text-soft)',
                }}
                className="p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 mb-2"
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span>{envelope.unlockMessage}</span>
              </div>
            )}

            {/* Letter Body in clean, readable Poppins 600 */}
            <div
              onClick={handleSkipTyping}
              className="space-y-4 cursor-pointer"
              title="Click to reveal all text instantly"
            >
              <div
                style={{ color: 'var(--text)' }}
                className="font-sans font-semibold text-base sm:text-lg leading-relaxed whitespace-pre-line tracking-wide"
              >
                {displayedBody}
                {isTyping && (
                  <span
                    style={{ backgroundColor: envelope.moodColor }}
                    className="inline-block w-2 h-5 ml-1 animate-pulse"
                  />
                )}
              </div>

              {/* Handwritten Signature ONLY in Caveat 700 */}
              {(!isTyping || displayedBody.length > 50) && fullSignatureText && (
                <div
                  style={{ borderColor: 'var(--card-border)' }}
                  className="pt-4 border-t text-right space-y-0.5 animate-fade-in"
                >
                  <p
                    style={{ color: 'var(--accent)' }}
                    className="font-handwriting font-serif text-2xl sm:text-3xl font-bold tracking-wide"
                  >
                    {fullSignatureText}
                  </p>
                </div>
              )}
            </div>

            {/* Interactive Envelope Surprise Container */}
            <div
              style={{
                backgroundColor: 'var(--card-subtle)',
                borderColor: 'var(--card-border)',
              }}
              className="mt-4 p-5 rounded-2xl border-2"
            >
              {envelope.surpriseType === 'breathing' && <BreathingHeartSurprise />}
              {envelope.surpriseType === 'hug' && <VirtualHugSurprise onSendHug={onSendHug} />}
              {envelope.surpriseType === 'lullaby' && <LullabySurprise />}
              {envelope.surpriseType === 'bubbles' && <StressBubblesSurprise />}
              {envelope.surpriseType === 'compliments' && <ComplimentMachineSurprise />}
              {envelope.surpriseType === 'reasons' && <ReasonsYouAreLovedSurprise />}
              {envelope.surpriseType === 'certificate' && <CertificateSurprise name={name} />}
              {envelope.surpriseType === 'clouds' && <ScreamCloudsSurprise />}
              {envelope.surpriseType === 'midnight' && <MidnightSkySurprise />}
              {envelope.surpriseType === 'morning' && <MorningSunriseSurprise />}
              {envelope.surpriseType === 'compass' && <CompassSurprise />}
              {envelope.surpriseType === 'deepest' && <DeepestMessageSurprise name={name} />}
            </div>

            {/* Close Button: Puts envelope back on the string */}
            <div className="pt-5 text-center">
              <button
                onClick={onClose}
                className="theme-btn-accent min-h-[48px] px-8 py-2.5 rounded-full text-sm font-bold active:scale-95 cursor-pointer shadow-md"
              >
                Fold and Close Letter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

/* =========================================================================
   SURPRISE 1: BREATHING HEART (Slowly expands & contracts)
   ========================================================================= */
const BreathingHeartSurprise: React.FC = () => {
  const [phase, setPhase] = useState<'Inhale' | 'Exhale'>('Inhale');

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase((p) => (p === 'Inhale' ? 'Exhale' : 'Inhale'));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-center space-y-4 py-2">
      <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
        Gentle Breathing Companion
      </span>
      <div className="relative w-28 h-28 mx-auto flex items-center justify-center">
        {/* Pulsing Breathing Ring */}
        <div
          style={{
            backgroundColor: 'rgba(96, 165, 250, 0.25)',
            transform: phase === 'Inhale' ? 'scale(1.35)' : 'scale(0.85)',
            transition: 'transform 4s ease-in-out',
          }}
          className="absolute inset-0 rounded-full"
        />
        <Heart
          style={{
            color: '#60a5fa',
            fill: '#60a5fa',
            transform: phase === 'Inhale' ? 'scale(1.2)' : 'scale(0.9)',
            transition: 'transform 4s ease-in-out',
          }}
          className="w-14 h-14 drop-shadow-md"
        />
      </div>
      <p
        style={{ color: 'var(--text)' }}
        className="font-serif text-2xl font-bold"
      >
        {phase === 'Inhale' ? 'Breathe in slowly...' : 'Breathe out gently...'}
      </p>
    </div>
  );
};

/* =========================================================================
   SURPRISE 2: VIRTUAL HUG (Press, glow & haptic heartbeat)
   ========================================================================= */
const VirtualHugSurprise: React.FC<{ onSendHug?: () => void }> = ({ onSendHug }) => {
  const [isHolding, setIsHolding] = useState(false);
  const [hugCount, setHugCount] = useState(0);

  const startHug = () => {
    setIsHolding(true);
    setHugCount((c) => c + 1);
    onSendHug?.();

    // Haptic heartbeat vibration pattern if supported on mobile
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([100, 100, 150, 100, 200]);
      } catch {
        // Safe fallback
      }
    }
    romanticAudio.playChime();
  };

  const endHug = () => {
    setIsHolding(false);
  };

  return (
    <div className="text-center space-y-3 py-2">
      <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
        Virtual Hug Station
      </span>
      <div>
        <button
          onMouseDown={startHug}
          onMouseUp={endHug}
          onTouchStart={startHug}
          onTouchEnd={endHug}
          style={{
            backgroundColor: isHolding ? 'var(--accent)' : 'var(--card-solid)',
            borderColor: 'var(--card-border)',
            boxShadow: isHolding ? '0 0 30px rgba(244, 63, 94, 0.7)' : 'none',
            transform: isHolding ? 'scale(1.15)' : 'scale(1)',
          }}
          className="w-20 h-20 rounded-full border-2 flex items-center justify-center mx-auto transition-all duration-300 cursor-pointer select-none"
        >
          <Heart
            style={{
              color: isHolding ? '#ffffff' : 'var(--accent)',
              fill: isHolding ? '#ffffff' : 'var(--accent)',
            }}
            className="w-10 h-10 animate-heartbeat"
          />
        </button>
      </div>
      <p
        style={{ color: 'var(--text)' }}
        className="font-serif text-lg font-bold"
      >
        {isHolding
          ? 'Hug sent. Hold as long as you need.'
          : 'Press and hold for a warm hug.'}
      </p>
      {hugCount > 0 && (
        <span className="text-[11px] font-bold text-[var(--accent)] block">
          {hugCount} warm hugs sent so far 💕
        </span>
      )}
    </div>
  );
};

/* =========================================================================
   SURPRISE 3: LULLABY NIGHT SKY (Auto-scrolling starlit poem)
   ========================================================================= */
const LullabySurprise: React.FC = () => {
  const lullabyLines = [
    'The night has draped its quiet velvet shawl,',
    'And resting shadows soothe the world for all.',
    'Lay down your thoughts, let heavy worries cease,',
    'May gentle starlight cradle you in peace.',
    'Tomorrow waits with sunlight fresh and sweet,',
    'Where quiet dreams and gentle mornings meet.',
  ];

  return (
    <div className="text-center space-y-3 py-2 overflow-hidden">
      <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-indigo-400">
        <Moon className="w-4 h-4" />
        <span>Night Starlit Lullaby</span>
      </div>
      <div className="space-y-2 py-1">
        {lullabyLines.map((line, i) => (
          <p
            key={i}
            style={{ color: 'var(--text)' }}
            className="font-serif text-base sm:text-lg font-bold italic"
          >
            "{line}"
          </p>
        ))}
      </div>
    </div>
  );
};

/* =========================================================================
   SURPRISE 4: STRESS BUBBLES (Pop to reveal comforting words)
   ========================================================================= */
const StressBubblesSurprise: React.FC = () => {
  const [bubbles, setBubbles] = useState([
    { id: 1, word: 'Peace', popped: false },
    { id: 2, word: 'Breathe', popped: false },
    { id: 3, word: "You're Safe", popped: false },
    { id: 4, word: 'Gentle', popped: false },
    { id: 5, word: 'Softness', popped: false },
    { id: 6, word: 'No Rush', popped: false },
  ]);

  const popBubble = (id: number) => {
    romanticAudio.playChime();
    setBubbles((prev) =>
      prev.map((b) => (b.id === id ? { ...b, popped: true } : b))
    );
  };

  const resetBubbles = () => {
    setBubbles((prev) => prev.map((b) => ({ ...b, popped: false })));
  };

  return (
    <div className="text-center space-y-3 py-2">
      <div className="flex items-center justify-between text-xs font-bold">
        <span style={{ color: 'var(--accent)' }}>Tap bubbles to pop stress</span>
        <button
          onClick={resetBubbles}
          className="hover:underline text-[var(--text-soft)] cursor-pointer"
        >
          Reset
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {bubbles.map((b) => (
          <button
            key={b.id}
            onClick={() => !b.popped && popBubble(b.id)}
            style={{
              backgroundColor: b.popped ? 'var(--card-solid)' : '#34d399',
              color: b.popped ? 'var(--text)' : '#ffffff',
              borderColor: 'var(--card-border)',
            }}
            className={`min-h-[50px] p-2 rounded-2xl border font-bold text-xs transition-all cursor-pointer flex items-center justify-center ${
              b.popped ? 'scale-95 shadow-inner' : 'animate-float shadow-md hover:scale-105'
            }`}
          >
            {b.popped ? b.word : '🫧 Pop'}
          </button>
        ))}
      </div>
    </div>
  );
};

/* =========================================================================
   SURPRISE 5: COMPLIMENT MACHINE (Button giving warm affirmations)
   ========================================================================= */
const ComplimentMachineSurprise: React.FC = () => {
  const complimentsList = [
    "Your laugh genuinely makes the world brighter.",
    "You have a heart that makes everyone feel valued.",
    "Your kindness is a quiet superpower.",
    "The world is simply softer because you are here.",
    "You are capable of far more than you realize.",
    "Your presence brings an instant sense of calm.",
  ];

  const [currentCompliment, setCurrentCompliment] = useState(complimentsList[0]);

  const getNewCompliment = () => {
    romanticAudio.playChime();
    const next = complimentsList[Math.floor(Math.random() * complimentsList.length)];
    setCurrentCompliment(next);
  };

  return (
    <div className="text-center space-y-3 py-2">
      <span className="text-xs font-bold uppercase tracking-wider text-amber-500">
        Compliment Machine
      </span>
      <p
        style={{ color: 'var(--text)' }}
        className="font-serif text-lg font-bold min-h-[44px] flex items-center justify-center"
      >
        "{currentCompliment}"
      </p>
      <button
        onClick={getNewCompliment}
        className="theme-btn-accent min-h-[44px] px-6 py-2 rounded-full text-xs font-bold cursor-pointer active:scale-95"
      >
        Dispense New Smile ✨
      </button>
    </div>
  );
};

/* =========================================================================
   SURPRISE 6: 10 REASONS YOU ARE LOVED (Flip cards)
   ========================================================================= */
const ReasonsYouAreLovedSurprise: React.FC = () => {
  const reasons = [
    "Your pure and honest heart",
    "The radiant warmth in your smile",
    "How gently you treat others",
    "Your contagious sweet laughter",
    "Your quiet strength in hard times",
    "The rare comfort you bring",
    "Your sincerity and honesty",
    "The light you bring into every room",
    "How deeply thoughtful you are",
    "Simply because you are YOU",
  ];

  const [cardIdx, setCardIdx] = useState(0);

  const nextReason = () => {
    romanticAudio.playChime();
    setCardIdx((c) => (c + 1) % reasons.length);
  };

  return (
    <div className="text-center space-y-3 py-2">
      <div className="flex items-center justify-between text-xs font-bold">
        <span style={{ color: 'var(--accent)' }}>Reason {cardIdx + 1} of 10</span>
        <span style={{ color: 'var(--text-soft)' }}>Tap to flip</span>
      </div>
      <button
        onClick={nextReason}
        style={{
          backgroundColor: 'var(--card-solid)',
          borderColor: 'var(--card-border)',
          boxShadow: '0 4px 15px var(--shadow-color)',
        }}
        className="w-full min-h-[70px] p-4 rounded-2xl border text-center flex items-center justify-center cursor-pointer transition-transform active:scale-98"
      >
        <p
          style={{ color: 'var(--text)' }}
          className="font-serif text-xl font-bold"
        >
          "{reasons[cardIdx]}"
        </p>
      </button>
    </div>
  );
};

/* =========================================================================
   SURPRISE 7: CHAMPION CERTIFICATE (Confetti & Golden Award)
   ========================================================================= */
const CertificateSurprise: React.FC<{ name: string }> = ({ name }) => {
  return (
    <div className="text-center space-y-2 py-2">
      <div
        style={{
          backgroundColor: '#fffdf5',
          borderColor: '#f59e0b',
          boxShadow: '0 6px 20px rgba(245, 158, 11, 0.25)',
        }}
        className="p-5 rounded-2xl border-2 border-dashed text-slate-900 space-y-1"
      >
        <Trophy className="w-8 h-8 text-amber-500 mx-auto animate-bounce" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700 block">
          Official Certificate of Excellence
        </span>
        <h4 className="font-serif text-2xl font-bold text-amber-900">
          Champion of My Heart
        </h4>
        <p className="font-sans text-xs font-semibold text-slate-700">
          Proudly awarded to <strong className="text-amber-800">{name}</strong> for quiet bravery, persistence, and being utterly extraordinary.
        </p>
      </div>
    </div>
  );
};

/* =========================================================================
   SURPRISE 8: SCREAM INTO CLOUDS (Clouds float away, peace remains)
   ========================================================================= */
const ScreamCloudsSurprise: React.FC = () => {
  const [clouds, setClouds] = useState([
    { id: 1, text: 'Frustration', gone: false },
    { id: 2, text: 'Overthinking', gone: false },
    { id: 3, text: 'Heavy Pressure', gone: false },
  ]);

  const dispelCloud = (id: number) => {
    romanticAudio.playChime();
    setClouds((prev) =>
      prev.map((c) => (c.id === id ? { ...c, gone: true } : c))
    );
  };

  const allGone = clouds.every((c) => c.gone);

  return (
    <div className="text-center space-y-3 py-2">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
        Tap each cloud to release the storm
      </span>
      <div className="flex flex-wrap justify-center gap-2">
        {clouds.map((c) =>
          !c.gone ? (
            <button
              key={c.id}
              onClick={() => dispelCloud(c.id)}
              style={{
                backgroundColor: 'var(--card-subtle)',
                borderColor: 'var(--card-border)',
                color: 'var(--text)',
              }}
              className="px-4 py-2 rounded-full font-bold text-xs border flex items-center gap-1.5 cursor-pointer animate-float shadow-xs"
            >
              <Cloud className="w-4 h-4 text-[var(--accent)]" />
              <span>{c.text}</span>
            </button>
          ) : null
        )}
      </div>
      {allGone && (
        <p
          style={{ color: 'var(--accent)' }}
          className="font-serif text-lg font-bold animate-fade-in"
        >
          All clear now. Peace gently returns to your heart. ✨
        </p>
      )}
    </div>
  );
};

/* =========================================================================
   SURPRISE 9: MIDNIGHT SKY
   ========================================================================= */
const MidnightSkySurprise: React.FC = () => {
  return (
    <div className="text-center space-y-2 py-2">
      <div className="flex items-center justify-center gap-2 text-indigo-400 text-sm font-bold">
        <Moon className="w-5 h-5" />
        <span>The Midnight Sky</span>
      </div>
      <p
        style={{ color: 'var(--text)' }}
        className="font-serif text-lg font-bold"
      >
        "Even when the world is asleep, you are my favorite waking thought."
      </p>
    </div>
  );
};

/* =========================================================================
   SURPRISE 10: MORNING SUNRISE
   ========================================================================= */
const MorningSunriseSurprise: React.FC = () => {
  return (
    <div className="text-center space-y-2 py-2">
      <div className="flex items-center justify-center gap-2 text-amber-500 text-sm font-bold">
        <Sun className="w-5 h-5 animate-spin" />
        <span>Golden Morning Blessing</span>
      </div>
      <p
        style={{ color: 'var(--text)' }}
        className="font-serif text-lg font-bold"
      >
        "May your morning coffee be warm, and every step today feel light."
      </p>
    </div>
  );
};

/* =========================================================================
   SURPRISE 11: HEART COMPASS (Always points to "You are enough")
   ========================================================================= */
const CompassSurprise: React.FC = () => {
  const [needleAngle, setNeedleAngle] = useState(0);

  const spinCompass = () => {
    romanticAudio.playChime();
    setNeedleAngle((prev) => prev + 720);
  };

  return (
    <div className="text-center space-y-3 py-2">
      <span className="text-xs font-bold uppercase tracking-wider text-cyan-500">
        The Celestial Compass
      </span>
      <div
        style={{
          backgroundColor: 'var(--card-subtle)',
        }}
        className="relative w-28 h-28 mx-auto rounded-full border-4 border-amber-500 flex items-center justify-center shadow-md"
      >
        <span className="absolute top-1 text-[9px] font-bold text-amber-500">
          NORTH
        </span>
        {/* Needle */}
        <div
          style={{
            transform: `rotate(${needleAngle}deg)`,
            transition: 'transform 2.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
          className="w-1.5 h-16 bg-gradient-to-t from-slate-400 via-rose-500 to-rose-600 rounded-full relative"
        >
          <div className="absolute top-0 -left-1.5 w-0 h-0 border-x-6 border-x-transparent border-b-10 border-b-rose-600" />
        </div>
      </div>
      <p
        style={{ color: 'var(--text)' }}
        className="font-serif text-lg font-bold"
      >
        Compass reads: "You are enough."
      </p>
      <button
        onClick={spinCompass}
        className="theme-btn-accent min-h-[40px] px-5 py-1.5 rounded-full text-xs font-bold cursor-pointer"
      >
        Spin Compass
      </button>
    </div>
  );
};

/* =========================================================================
   SURPRISE 12: DEEPEST MESSAGE & PETAL SHOWER
   ========================================================================= */
const DeepestMessageSurprise: React.FC<{ name: string }> = ({ name }) => {
  return (
    <div className="text-center space-y-3 py-2">
      <div className="flex items-center justify-center gap-1.5 text-amber-500 font-bold text-sm">
        <Sparkles className="w-5 h-5" />
        <span>Golden Treasury Unlocked</span>
      </div>
      <p
        style={{ color: 'var(--text)' }}
        className="font-serif text-xl sm:text-2xl font-bold leading-relaxed"
      >
        "Thank you for reading every word. In every universe and every timeline, knowing you is my greatest blessing, {name}."
      </p>
      <span className="text-xs font-bold text-[var(--accent)] block">
        🌸 🌹 🌸 A shower of rose petals just for you 🌸 🌹 🌸
      </span>
    </div>
  );
};
