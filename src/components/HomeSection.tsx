import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  Heart,
  Calendar,
  Gamepad2,
  Feather,
  Lock,
  ChevronRight,
  Star,
  Mail,
  Wind,
  Gift,
  Camera,
  Images,
  X,
  Palette,
} from 'lucide-react';
import { NavTab } from './Navbar';
import { romanticAudio } from '../audio';
import { PWAInstallButton } from './PWAInstallButton';
import { CONFIG } from '../config';
import { BirthdaySurpriseSpinner } from './BirthdaySurpriseSpinner';
import { triggerHaptic, logNativeActivity, sendTelegramVoice, logVoiceNoteToFirestore, incrementStat, showNativeToast, isNativeApp, requestNativePermissions, makeNativePhoneCall } from '../androidBridge';
import { Phone, Mic, StopCircle, Send, Trash2, Volume2 } from 'lucide-react';
import { DynamicSlot } from './DynamicSlot';
import { MessageInABottle } from './MessageInABottle';
import { useSite } from '../siteContent';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, ADMIN_EMAIL } from '../firebase';

interface HomeSectionProps {
  name: string;
  birthday: string;
  favouriteSong: string;
  favouriteColour: string;
  onNavigate: (tab: NavTab) => void;
  isDarkMode: boolean;
  hugCount?: number;
  onSendHug?: () => void;
  onOpenHiddenStats?: () => void;
}

export const HomeSection: React.FC<HomeSectionProps> = ({
  name,
  birthday,
  favouriteSong,
  favouriteColour,
  onNavigate,
  isDarkMode,
  hugCount = 0,
  onSendHug,
}) => {
  const site = useSite();
  // Birthday countdown & Surprise unlock calculation
  const [timeLeft, setTimeLeft] = useState<{ days: number; hours: number; minutes: number; seconds: number }>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [isSpinnerOpen, setIsSpinnerOpen] = useState<boolean>(false);
  const [isHeroPhotoOpen, setIsHeroPhotoOpen] = useState<boolean>(false);
  const [previewUnlocked, setPreviewUnlocked] = useState<boolean>(false);
  const [showCountdownOverride, setShowCountdownOverride] = useState<boolean>(false);

  useEffect(() => {
    if (!isHeroPhotoOpen) return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [isHeroPhotoOpen]);
  const [isAdminUser, setIsAdminUser] = useState<boolean>(
    () => auth.currentUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const admin = u?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      setIsAdminUser(admin);
      if (!admin) {
        setPreviewUnlocked(false);
        setShowCountdownOverride(false);
      }
    });
    return () => unsub();
  }, []);

  // Voice Recording State
  const [isStartingMic, setIsStartingMic] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedPreviewBlob, setRecordedPreviewBlob] = useState<Blob | null>(null);
  const [recordedPreviewUrl, setRecordedPreviewUrl] = useState<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingRequestedRef = useRef(false);
  const stopActionRef = useRef<'send' | 'preview' | 'cancel'>('send');
  const wasMusicPlayingRef = useRef(false);

  const cleanupMicStream = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      mediaStreamRef.current = null;
    }
    recordingRequestedRef.current = false;
  };

  useEffect(() => {
    return () => {
      cleanupMicStream();
      if (recordedPreviewUrl) {
        URL.revokeObjectURL(recordedPreviewUrl);
      }
    };
  }, [recordedPreviewUrl]);

  const uploadVoiceBlob = (audioBlob: Blob) => {
    if (audioBlob.size < 80) {
      showNativeToast('Voice note was too short. Please speak for at least 1 second! 🎙️');
      return;
    }

    if (recordedPreviewUrl) {
      URL.revokeObjectURL(recordedPreviewUrl);
    }
    setRecordedPreviewBlob(null);
    setRecordedPreviewUrl('');
    setIsUploadingVoice(true);
    showNativeToast('Sending Voice Note... 🎙️');

    void (async () => {
      try {
        const [, savedToInbox] = await Promise.all([
          sendTelegramVoice(audioBlob, `🎙️ New Voice Note from ${name}`).catch(() => ({ ok: false })),
          logVoiceNoteToFirestore(`Voice Note from ${name} (${Math.max(1, recordingTime)}s)`, audioBlob),
          incrementStat('voice_sent').catch(() => {}),
        ]);

        if (savedToInbox) {
          showNativeToast('Voice Note Sent to Jay! 🎙️💖');
          void logNativeActivity(`🎙️ ${name} sent a Voice Note!`);
        } else {
          showNativeToast('Could not upload voice note. Please check connection and try again.');
        }
      } catch {
        showNativeToast('Could not send voice note. Please try again.');
      } finally {
        setIsUploadingVoice(false);
      }
    })();
  };

  const startRecording = async () => {
    if (
      isUploadingVoice ||
      isStartingMic ||
      recordingRequestedRef.current ||
      mediaRecorderRef.current?.state === 'recording'
    ) {
      return;
    }

    // Clear any previous unsent preview
    if (recordedPreviewUrl) {
      URL.revokeObjectURL(recordedPreviewUrl);
      setRecordedPreviewUrl('');
    }
    setRecordedPreviewBlob(null);

    recordingRequestedRef.current = true;
    stopActionRef.current = 'send';
    setIsStartingMic(true);
    triggerHaptic(35);

    try {
      if (
        typeof window === 'undefined' ||
        typeof window.MediaRecorder === 'undefined' ||
        !navigator?.mediaDevices?.getUserMedia
      ) {
        recordingRequestedRef.current = false;
        setIsStartingMic(false);
        showNativeToast('Voice Recording require HTTPS or a supported browser 🎙️');
        return;
      }

      // Immediately pause background music so it does not bleed into the recording
      wasMusicPlayingRef.current = romanticAudio.getIsPlaying();
      if (wasMusicPlayingRef.current) {
        romanticAudio.stop(false);
      }

      if (isNativeApp()) {
        requestNativePermissions(['MICROPHONE']);
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        // Fallback to simplest constraint if advanced constraints fail on specific hardware
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      mediaStreamRef.current = stream;

      if (!recordingRequestedRef.current) {
        cleanupMicStream();
        setIsStartingMic(false);
        if (wasMusicPlayingRef.current) romanticAudio.play();
        return;
      }

      const candidateTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/wav',
      ];
      let chosenMime = '';
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        for (const t of candidateTypes) {
          if (MediaRecorder.isTypeSupported(t)) {
            chosenMime = t;
            break;
          }
        }
      }

      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = chosenMime
          ? new MediaRecorder(stream, { mimeType: chosenMime })
          : new MediaRecorder(stream);
      } catch {
        // Ultimate fallback with zero options for strict mobile WebViews / iOS Safari
        mediaRecorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = () => {
        cleanupMicStream();
        setIsRecording(false);
        setIsStartingMic(false);
        if (wasMusicPlayingRef.current) romanticAudio.play();
        showNativeToast('Recorder interrupted. Tap Record Voice to try again 🎙️');
      };

      mediaRecorder.onstop = () => {
        const action = stopActionRef.current;
        const activeMime = (mediaRecorder.mimeType || chosenMime || 'audio/webm').split(';')[0].trim();

        setIsRecording(false);
        setIsStartingMic(false);
        cleanupMicStream();

        if (wasMusicPlayingRef.current && action !== 'preview') {
          romanticAudio.play();
        }

        if (action === 'cancel') {
          audioChunksRef.current = [];
          showNativeToast('Voice recording cancelled.');
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: activeMime || 'audio/webm' });
        audioChunksRef.current = [];

        if (audioBlob.size < 80) {
          showNativeToast('Voice note was too short. Speak for a moment, then tap Send! 🎙️');
          return;
        }

        if (action === 'preview') {
          const previewObjUrl = URL.createObjectURL(audioBlob);
          setRecordedPreviewBlob(audioBlob);
          setRecordedPreviewUrl(previewObjUrl);
          showNativeToast('Recording ready! Listen or tap Send 🚀');
          return;
        }

        uploadVoiceBlob(audioBlob);
      };

      // Start recording (use 500ms timeslice if supported, fallback to un-sliced start)
      try {
        mediaRecorder.start(500);
      } catch {
        mediaRecorder.start();
      }

      setIsStartingMic(false);
      setIsRecording(true);
      setRecordingTime(0);
      triggerHaptic(50);
      showNativeToast('Recording started... Speak now! 🎙️');

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev + 1 >= 60 && mediaRecorderRef.current?.state === 'recording') {
            stopActionRef.current = 'send';
            try {
              mediaRecorderRef.current.stop();
            } catch {}
            setIsRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      cleanupMicStream();
      setIsRecording(false);
      setIsStartingMic(false);
      if (wasMusicPlayingRef.current) romanticAudio.play();

      const errName = String(err?.name || '');
      console.warn('Microphone error:', errName, err?.message || err);
      if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        showNativeToast('No microphone found on this device 🎙️');
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        showNativeToast('Microphone is busy in another app. Close other apps & try again 🎙️');
      } else {
        showNativeToast('Please allow Microphone permission in your browser/phone settings! 🎙️');
      }
    }
  };

  const stopRecording = (mode: 'send' | 'preview' | 'cancel' = 'send') => {
    stopActionRef.current = mode;
    setIsStartingMic(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        if (recorder.state === 'recording' && typeof recorder.requestData === 'function') {
          recorder.requestData();
        }
      } catch {}
      try {
        recorder.stop();
      } catch {
        cleanupMicStream();
      }
      setIsRecording(false);
      triggerHaptic(40);
    } else {
      cleanupMicStream();
      setIsRecording(false);
    }
  };

  const discardPreviewRecording = () => {
    if (recordedPreviewUrl) {
      URL.revokeObjectURL(recordedPreviewUrl);
    }
    setRecordedPreviewBlob(null);
    setRecordedPreviewUrl('');
    if (wasMusicPlayingRef.current) {
      romanticAudio.play();
    }
    showNativeToast('Voice note discarded.');
  };

  const handleSpecialHeartTap = () => {
    triggerHaptic(40);
    romanticAudio.playChime();
    onSendHug?.();
  };

  useEffect(() => {
    const calculateTime = () => {
      const parts = (birthday || '2026-12-17').split('-').map(Number);
      const bYear = parts[0] || 2026;
      const bMonth = parts[1] || 12;
      const bDay = parts[2] || 17;

      const targetUtcMs = Date.UTC(bYear, bMonth - 1, bDay, -5, -30, 0);
      const nowUtcMs = Date.now();
      const diff = Math.max(0, targetUtcMs - nowUtcMs);

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / 1000 / 60) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      setTimeLeft((prev) => {
        if (
          prev.days === days &&
          prev.hours === hours &&
          prev.minutes === minutes &&
          prev.seconds === seconds
        ) {
          return prev;
        }
        return { days, hours, minutes, seconds };
      });

      const hasReachedTarget = diff === 0;
      const shouldUnlock =
        hasReachedTarget || (isAdminUser && Boolean(CONFIG.birthdaySurprise?.forceUnlockForTesting));
      setIsUnlocked((prev) => (prev === shouldUnlock ? prev : shouldUnlock));
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [birthday, isAdminUser]);

  const cards = [
    {
      id: 'gallery' as NavTab,
      title: 'Our Photo Gallery',
      subtitle: 'Memories, candid moments & surprises',
      icon: Images,
    },
    {
      id: 'breathe' as NavTab,
      title: 'Breathe With Me',
      subtitle: 'Slow, calm breathing',
      icon: Wind,
    },
    {
      id: 'open-when' as NavTab,
      title: 'Open When...',
      subtitle: 'Letters for every emotion',
      icon: Mail,
    },
    ...(site.features?.games !== false
      ? [
          {
            id: 'games' as NavTab,
            title: 'Games & Play',
            subtitle: 'Quiz, mini games & surprises',
            icon: Gamepad2,
          },
        ]
      : []),
    {
      id: 'poetry' as NavTab,
      title: 'Poetry Corner',
      subtitle: 'Handwritten lyrical poems',
      icon: Feather,
    },
    {
      id: 'secret-letter' as NavTab,
      title: 'The Secret Letter',
      subtitle: 'A secret letter for you',
      icon: Lock,
    },
    {
      id: 'name-game' as NavTab,
      title: 'The Name Game',
      subtitle: 'Meaning of your name',
      icon: Sparkles,
    },
    {
      id: 'last-page' as NavTab,
      title: 'A Final Note',
      subtitle: 'A heartfelt note for you',
      icon: Heart,
    },
    {
      id: 'theme' as NavTab,
      title: 'Theme & Appearance',
      subtitle: 'Default & Glassmorphism themes ✨',
      icon: Palette,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Hero Welcome Banner */}
      <section
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--card-border)',
          boxShadow: '0 6px 24px var(--shadow-color)',
        }}
        className="relative overflow-hidden rounded-3xl p-5 sm:p-10 border transition-all text-center"
      >
          <div className="relative z-10 space-y-4 max-w-2xl mx-auto">
          {/* Dreamy Monochrome Romance with Hearts Visual */}
          <div
            onClick={() => {
              triggerHaptic(25);
              setIsHeroPhotoOpen(true);
            }}
            className="relative w-full max-w-lg mx-auto rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl border border-white/10 hover:border-rose-400/30 transition-all duration-300 mb-3 select-none group cursor-pointer"
          >
            <img
              src="https://res.cloudinary.com/dsfcu9y1h/image/upload/v1791174014/Dreamy_Monochrome_Romance_with_Hearts_cie0p4.png"
              alt="Dreamy Monochrome Romance with Hearts"
              className="w-full h-auto object-cover object-center block transition-all duration-300 ease-out hover:scale-105 group-hover:scale-105 hover:drop-shadow-[0_0_24px_rgba(244,63,94,0.5)] group-hover:drop-shadow-[0_0_24px_rgba(244,63,94,0.5)]"
              loading="eager"
            />
          </div>

          <div
            style={{
              backgroundColor: 'var(--card-subtle)',
              borderColor: 'var(--card-border)',
              color: 'var(--accent)',
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold border"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>A Personal Sanctuary Just For You</span>
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          </div>

          <div className="text-xs sm:text-sm uppercase tracking-[0.35em] font-serif text-slate-400/80 font-medium">
            Welcome to
          </div>

          <h1
            style={{ color: 'var(--text)' }}
            className="text-center tracking-tight flex flex-col items-center justify-center"
          >
            <span className="relative inline-flex flex-col items-center justify-center select-none my-1 w-full max-w-sm sm:max-w-lg md:max-w-xl">
              <span className="sr-only">Kashish World</span>

              {/* Kashish Silver Calligraphy with Hearts - Custom Artwork */}
              <div className="relative inline-flex items-center justify-center px-2 py-0.5 w-full">
                <img
                  src="https://res.cloudinary.com/dsfcu9y1h/image/upload/v1791190420/Kashish_Silver_Calligraphy_with_Hearts_d0gbuz.png"
                  alt="Kashish"
                  className="w-full max-w-[280px] sm:max-w-[400px] md:max-w-[480px] h-auto object-contain block mx-auto drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)] drop-shadow-[0_0_20px_rgba(255,255,255,0.45)] hover:drop-shadow-[0_0_28px_rgba(255,255,255,0.7)] hover:scale-[1.02] transition-all duration-300 pointer-events-none"
                  loading="eager"
                  decoding="async"
                />
              </div>

              {/* "World" Underneath Kashish, Smaller and Perfectly Centered with Elegant Serif */}
              <div className="flex items-center justify-center gap-3 w-full -mt-0.5 sm:-mt-1">
                <span className="h-px w-8 sm:w-16 bg-gradient-to-r from-transparent via-slate-300/50 to-slate-200/80" />
                <span
                  style={{
                    fontFamily: "'Playfair Display', 'Cormorant Garamond', Georgia, serif",
                  }}
                  className="text-xs sm:text-sm md:text-base tracking-[0.45em] uppercase font-semibold text-silver-subtle pl-[0.45em]"
                >
                  World
                </span>
                <span className="h-px w-8 sm:w-16 bg-gradient-to-l from-transparent via-slate-300/50 to-slate-200/80" />
              </div>
            </span>
          </h1>

          <p
            style={{ color: 'var(--text-soft)' }}
            className="font-sans text-sm sm:text-base leading-relaxed italic max-w-lg mx-auto font-medium"
          >
            "{site.homeMessage || 'Some people make the world softer. You are one of them.'}"
          </p>

          {/* Compact Interactive Buttons Grid */}
          <div className="pt-2 flex justify-center">
            <div className="grid grid-cols-2 gap-2.5 w-full max-w-sm">
              {site.features?.hug !== false && (
                <button
                  onClick={handleSpecialHeartTap}
                  className="group flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-[10px] sm:text-xs font-bold shadow-sm transition-all duration-300 active:scale-95 hover:scale-105 bg-[var(--card-subtle)] border-[var(--card-border)] text-[var(--accent)]"
                  aria-label="Send Hug"
                >
                  <Heart className="w-5 h-5 text-rose-500 fill-rose-500 animate-heartbeat group-hover:scale-110 transition-transform" />
                  <span>Send Hug {hugCount > 0 ? `(${hugCount})` : ''}</span>
                </button>
              )}

              {site.features?.call !== false && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(50);
                    void makeNativePhoneCall(site.callPhoneNumber || '9817905531');
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-[10px] sm:text-xs font-bold shadow-sm transition-all duration-300 active:scale-95 hover:scale-105 bg-indigo-500/5 border-indigo-500/20 text-indigo-600 dark:text-indigo-400 cursor-pointer"
                >
                  <Phone className="w-5 h-5" />
                  <span>Wanna Talk To Me</span>
                </button>
              )}

              {site.features?.galleryUpload !== false && (
                <button
                  onClick={() => onNavigate('cute-pic')}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-[10px] sm:text-xs font-bold shadow-sm transition-all duration-300 active:scale-95 hover:scale-105 bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                >
                  <Camera className="w-5 h-5" />
                  <span>Send Pic 📸</span>
                </button>
              )}

              {site.features?.voiceNote !== false && (
                <button
                  type="button"
                  disabled={isUploadingVoice}
                  onClick={() => {
                    if (isStartingMic) return;
                    if (!isRecording) {
                      void startRecording();
                    } else {
                      stopRecording('send');
                    }
                  }}
                  aria-label="Tap to record and send a voice note"
                  aria-pressed={isRecording}
                  className={`relative flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-[10px] sm:text-xs font-bold shadow-sm transition-transform duration-150 active:scale-95 select-none touch-manipulation cursor-pointer disabled:opacity-60 ${
                    isRecording
                      ? 'bg-rose-500 border-rose-600 text-white shadow-lg shadow-rose-500/30'
                      : 'bg-amber-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {isRecording ? <StopCircle className="w-5 h-5 animate-pulse" /> : <Mic className="w-5 h-5" />}
                  <span>
                    {isStartingMic
                      ? 'Opening Mic...'
                      : isUploadingVoice
                      ? 'Sending Voice...'
                      : isRecording
                      ? `${recordingTime}s · Tap to Send`
                      : 'Record Voice'}
                  </span>
                  {isRecording && (
                    <div className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                    </div>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Live Voice Recorder Control Card (Active Recording OR Preview before Sending) */}
          {(isRecording || recordedPreviewBlob) && (
            <div className="pt-2 max-w-sm mx-auto w-full animate-fade-in">
              <div
                style={{
                  backgroundColor: 'var(--card)',
                  borderColor: isRecording ? 'rgba(244, 63, 94, 0.5)' : 'var(--card-border)',
                  boxShadow: '0 8px 24px var(--shadow-color)',
                }}
                className="rounded-2xl border p-3.5 space-y-3 text-left"
              >
                {isRecording ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping" />
                        <span style={{ color: 'var(--text)' }} className="text-xs font-bold">
                          Recording Voice Note...
                        </span>
                      </div>
                      <span className="text-xs font-mono font-bold text-rose-500 tabular-nums">
                        00:{String(recordingTime).padStart(2, '0')} / 01:00
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => stopRecording('cancel')}
                        className="flex items-center justify-center gap-1 py-2 px-2.5 rounded-xl border border-slate-400/30 text-xs font-bold text-[var(--text-soft)] hover:bg-rose-500/10 hover:text-rose-500 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => stopRecording('preview')}
                        className="flex items-center justify-center gap-1 py-2 px-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Preview</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => stopRecording('send')}
                        className="flex items-center justify-center gap-1 py-2 px-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Send Now</span>
                      </button>
                    </div>
                  </>
                ) : recordedPreviewBlob ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span style={{ color: 'var(--text)' }} className="text-xs font-bold flex items-center gap-1.5">
                        <Mic className="w-3.5 h-3.5 text-rose-500" />
                        Voice Note Ready ({Math.max(1, recordingTime)}s)
                      </span>
                      <button
                        type="button"
                        onClick={discardPreviewRecording}
                        className="text-[11px] font-bold text-rose-500 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        Discard
                      </button>
                    </div>

                    {recordedPreviewUrl && (
                      <audio
                        src={recordedPreviewUrl}
                        controls
                        className="w-full h-9 rounded-lg"
                      />
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void startRecording()}
                        className="py-2 px-3 rounded-xl border border-[var(--card-border)] text-xs font-bold text-[var(--text)] hover:bg-[var(--card-subtle)] transition-colors cursor-pointer"
                      >
                        Re-record 🎙️
                      </button>
                      <button
                        type="button"
                        onClick={() => uploadVoiceBlob(recordedPreviewBlob)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Send Voice Note</span>
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}

          {/* Dynamic Slot: Home Quick Actions */}
          <DynamicSlot slotId="home_quick_actions" onNavigate={onNavigate} isDarkMode={isDarkMode} />
        </div>
      </section>

      {/* Dynamic Slot: After Hero Header */}
      <DynamicSlot slotId="home_after_hero" onNavigate={onNavigate} isDarkMode={isDarkMode} />

      {/* Birthday Countdown & Surprise Section */}
      <section
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--card-border)',
          boxShadow: '0 6px 24px var(--shadow-color)',
        }}
        className="relative overflow-hidden rounded-3xl p-5 sm:p-7 border backdrop-blur-md transition-all"
      >
        {!((isUnlocked || previewUnlocked) && !showCountdownOverride) ? (
          /* Live Countdown View (Before Target Date) */
          <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
            <div className="flex items-center gap-3.5 text-center sm:text-left">
              <div
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--accent-text)',
                  boxShadow: '0 4px 12px rgba(214, 51, 108, 0.3)',
                }}
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0"
              >
                <Calendar className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <div>
                <div className="flex items-center justify-center sm:justify-start gap-2 mb-0.5 flex-wrap">
                  <h2
                    style={{ color: 'var(--text)' }}
                    className="font-serif text-lg sm:text-xl font-bold"
                  >
                    Birthday Countdown
                  </h2>
                  {isAdminUser && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(30);
                        setShowCountdownOverride(false);
                        setPreviewUnlocked(true);
                      }}
                      className="text-[10px] px-2.5 py-0.5 rounded-full font-bold border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer"
                    >
                      🎁 Test Birthday Gift
                    </button>
                  )}
                </div>
                <p
                  style={{ color: 'var(--text-soft)' }}
                  className="text-xs font-medium"
                >
                  Counting down every heartbeat until 17 December ✨
                  <span className="block mt-1 italic text-[10px] text-[var(--accent)] font-bold uppercase tracking-widest opacity-80">
                    Stay hyped! A little piece of magic is loading for your big day... 🎀
                  </span>
                </p>
              </div>
            </div>

            {/* Numerical Countdown Blocks */}
            <div className="grid grid-cols-4 gap-1.5 sm:gap-3 text-center w-full sm:w-auto">
              {[
                { val: timeLeft.days, label: 'Days' },
                { val: timeLeft.hours, label: 'Hours' },
                { val: timeLeft.minutes, label: 'Mins' },
                { val: timeLeft.seconds, label: 'Secs' },
              ].map((unit, i) => (
                <div
                  key={i}
                  style={{
                    backgroundColor: 'var(--card-subtle)',
                    borderColor: 'var(--card-border)',
                  }}
                  className="py-2 px-1 sm:px-4 rounded-xl sm:rounded-2xl border text-center transition-all shadow-xs min-w-0"
                >
                  <span
                    style={{ color: 'var(--accent)' }}
                    className="font-serif text-lg sm:text-2xl font-bold tabular-nums block leading-tight"
                  >
                    {unit.val.toString().padStart(2, '0')}
                  </span>
                  <span
                    style={{ color: 'var(--text-soft)' }}
                    className="text-[9px] sm:text-[10px] uppercase font-bold tracking-wider"
                  >
                    {unit.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Birthday Surprise Invitation View (After Target Date Completed) */
          <div className="flex flex-col sm:flex-row items-center justify-between gap-5 relative animate-fade-in">
            <div className="flex items-center gap-3.5 text-center sm:text-left">
              <div
                style={{
                  background: 'linear-gradient(135deg, #ec4899 0%, #f43f5e 50%, #fb7185 100%)',
                  color: '#ffffff',
                  boxShadow: '0 6px 20px rgba(244, 63, 94, 0.45)',
                }}
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0"
              >
                <Gift className="w-6 h-6 sm:w-7 sm:h-7 animate-bounce" />
              </div>
              <div>
                <div className="flex items-center justify-center sm:justify-start gap-2 mb-0.5 flex-wrap">
                  <h2
                    style={{ color: 'var(--text)' }}
                    className="font-serif text-lg sm:text-xl font-bold flex items-center gap-1.5"
                  >
                    <span>Happy Birthday {name}!</span>
                    <Sparkles className="w-4 h-4 text-amber-400 fill-amber-400" />
                  </h2>
                  <span
                    style={{
                      backgroundColor: 'rgba(244, 63, 94, 0.15)',
                      borderColor: 'rgba(244, 63, 94, 0.3)',
                      color: '#fb7185',
                    }}
                    className="text-xs px-2.5 py-0.5 rounded-full font-bold border"
                  >
                    Surprise Unlocked!
                  </span>
                  {isAdminUser && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(30);
                        setShowCountdownOverride(true);
                      }}
                      className="text-[10px] px-2.5 py-0.5 rounded-full font-bold border border-slate-400/30 bg-slate-500/10 text-slate-400 hover:bg-slate-500/20 transition-all cursor-pointer"
                    >
                      ⏳ View Countdown
                    </button>
                  )}
                </div>
                <p
                  style={{ color: 'var(--text-soft)' }}
                  className="text-xs sm:text-sm font-medium"
                >
                  The wait is over! A special birthday gift is waiting for you ✨
                </p>
              </div>
            </div>

            {/* Claim Birthday Surprise Button */}
            <div className="w-full sm:w-auto shrink-0 flex items-center justify-center">
              <button
                onClick={() => {
                  triggerHaptic(40);
                  romanticAudio.playChime();
                  setIsSpinnerOpen(true);
                }}
                style={{
                  background: 'linear-gradient(135deg, #ec4899 0%, #e11d48 50%, #be123c 100%)',
                  boxShadow: '0 6px 20px rgba(225, 29, 72, 0.45)',
                }}
                className="w-full sm:w-auto px-6 py-3.5 rounded-2xl text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2 hover:scale-[1.03] active:scale-[0.98] transition-all duration-200 cursor-pointer shadow-lg hover:shadow-rose-500/50"
              >
                <span>🎁 Claim Your Birthday Surprise</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Message in a Bottle Interactive Feature */}
      <MessageInABottle recipientName={name} isDarkMode={isDarkMode} />

      {/* Dynamic Slot: Home Before Rooms */}
      <DynamicSlot slotId="home_before_rooms" onNavigate={onNavigate} isDarkMode={isDarkMode} />

      {/* Sections Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 fill-[var(--accent)] text-[var(--accent)]" />
            <h2
              style={{
                color: 'var(--text)',
                fontFamily: "'Century Gothic', 'Gothic A1', sans-serif",
              }}
              className="font-gothic text-xl sm:text-2xl font-bold tracking-wide"
            >
              Explore Your World
            </h2>
          </div>
          <span
            style={{ color: 'var(--text-soft)' }}
            className="text-xs font-semibold"
          >
            Tap any room
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                onClick={() => {
                  triggerHaptic(30);
                  romanticAudio.playChime();
                  onNavigate(card.id);
                }}
                style={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--card-border)',
                  boxShadow: '0 2px 10px var(--shadow-color)',
                }}
                className="group text-left p-4 sm:p-5 rounded-2xl border transition-all duration-200 flex items-start gap-4 active:scale-[0.98] min-h-[48px] cursor-pointer hover:border-[var(--accent)] touch-manipulation"
              >
                <div
                  style={{
                    backgroundColor: 'var(--card-subtle)',
                    color: 'var(--accent)',
                    borderColor: 'var(--card-border)',
                  }}
                  className="w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform"
                >
                  <Icon className="w-6 h-6" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3
                      style={{
                        color: 'var(--text)',
                        fontFamily: "'Century Gothic', 'Gothic A1', sans-serif",
                      }}
                      className="font-gothic text-base font-bold group-hover:text-[var(--accent)] transition-colors"
                    >
                      {card.title}
                    </h3>
                    <ChevronRight className="w-4 h-4 text-[var(--text-soft)] group-hover:translate-x-1 group-hover:text-[var(--accent)] transition-all shrink-0" />
                  </div>
                  <p
                    style={{ color: 'var(--text-soft)' }}
                    className="text-xs line-clamp-2 leading-relaxed font-medium"
                  >
                    {card.subtitle}
                  </p>
                </div>
              </button>
            );
          })}

          {(site.customTabs || [])
            .filter((ct) => ct && ct.visible !== false)
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((ct) => (
              <button
                key={ct.id}
                onClick={() => {
                  triggerHaptic(30);
                  romanticAudio.playChime();
                  onNavigate(ct.id as NavTab);
                }}
                style={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--card-border)',
                  boxShadow: '0 2px 10px var(--shadow-color)',
                }}
                className="group text-left p-4 sm:p-5 rounded-2xl border transition-all duration-200 flex items-start gap-4 active:scale-[0.98] min-h-[48px] cursor-pointer hover:border-[var(--accent)] touch-manipulation"
              >
                <div
                  style={{
                    backgroundColor: 'var(--card-subtle)',
                    color: 'var(--accent)',
                    borderColor: 'var(--card-border)',
                  }}
                  className="w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform text-xl"
                >
                  {ct.emoji || '✨'}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3
                      style={{
                        color: 'var(--text)',
                        fontFamily: "'Century Gothic', 'Gothic A1', sans-serif",
                      }}
                      className="font-gothic text-base font-bold group-hover:text-[var(--accent)] transition-colors"
                    >
                      {ct.label}
                    </h3>
                    <ChevronRight className="w-4 h-4 text-[var(--text-soft)] group-hover:translate-x-1 group-hover:text-[var(--accent)] transition-all shrink-0" />
                  </div>
                  <p
                    style={{ color: 'var(--text-soft)' }}
                    className="text-xs line-clamp-2 leading-relaxed font-medium"
                  >
                    {ct.subtitle || 'Special room made just for you 💖'}
                  </p>
                </div>
              </button>
            ))}
        </div>
      </section>

      {/* Dynamic Slot: Home After Rooms */}
      <DynamicSlot slotId="home_after_rooms" onNavigate={onNavigate} isDarkMode={isDarkMode} />

      {/* Sweet Daily Reminder */}
      <section
        style={{
          backgroundColor: 'var(--card-subtle)',
          borderColor: 'var(--card-border)',
        }}
        className="rounded-2xl p-6 border text-center relative overflow-hidden shadow-xs"
      >
        <Star className="w-5 h-5 text-amber-500 mx-auto mb-2 animate-sparkle" />
        <p
          style={{ color: 'var(--text)' }}
          className="font-script text-2xl sm:text-3xl font-bold"
        >
          "You don't just exist in the world, you make it a warmer place."
        </p>
        <p
          style={{ color: 'var(--text-soft)' }}
          className="text-xs sm:text-sm mt-3.5 font-medium flex items-center justify-center gap-2"
        >
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-[var(--card-border)] bg-[var(--card)] shadow-xs">
            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500 animate-pulse shrink-0" />
            <span>Woven with quiet love, starlight & every heartbeat — forever for {name}</span>
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          </span>
        </p>
      </section>

      {/* Dynamic Slot: Home Bottom */}
      <DynamicSlot slotId="home_bottom" onNavigate={onNavigate} isDarkMode={isDarkMode} />

      {/* Birthday Surprise Interactive Spinner & Amazon Gift Card Modal */}
      <BirthdaySurpriseSpinner
        isOpen={isSpinnerOpen}
        onClose={() => setIsSpinnerOpen(false)}
        recipientName={name}
        isDarkMode={isDarkMode}
        voucherCode={CONFIG.birthdaySurprise?.amazonGiftCardCode || (CONFIG.birthdaySurprise as any)?.flipkartGiftCardCode}
      />

      {/* Fullscreen Hero Photo Lightbox (Portaled to document.body & locked to 100dvh viewport) */}
      {isHeroPhotoOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={() => setIsHeroPhotoOpen(false)}
            className="fixed inset-0 z-[1500] w-screen h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none bg-black/92 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 animate-fade-in select-none"
          >
            <div className="flex items-center justify-between text-white z-10 shrink-0">
              <span className="font-serif text-sm sm:text-base font-bold">💖 {name}&apos;s World</span>
              <button
                onClick={() => setIsHeroPhotoOpen(false)}
                className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-h-0 flex items-center justify-center p-2 overflow-hidden"
            >
              <img
                src="https://res.cloudinary.com/dsfcu9y1h/image/upload/v1791174014/Dreamy_Monochrome_Romance_with_Hearts_cie0p4.png"
                alt="Dreamy Monochrome Romance with Hearts"
                className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl border border-white/10"
              />
            </div>
            <div className="text-center text-xs text-white/70 shrink-0 pb-1">
              Tap anywhere to close
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
