import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Heart, Play, Pause, Square, Sparkles, RotateCcw, Wind } from 'lucide-react';
import { CONFIG } from '../config';
import { DynamicSlot } from './DynamicSlot';

interface BreatheSectionProps {
  name: string;
  isDarkMode: boolean;
}

type Phase = 'inhale' | 'hold' | 'exhale';

// Smooth cubic-bezier(0.37, 0, 0.63, 1) approximation (sinusoidal ease-in-out)
const easeInOut = (t: number): number => {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
};

export const BreatheSection: React.FC<BreatheSectionProps> = ({ name, isDarkMode }) => {
  const breatheConfig = CONFIG.breatheConfig || {
    introText: 'Sit comfortably. Relax your shoulders. There is no rush.',
    defaultDurationMinutes: 3,
    defaultModeId: 'calm',
    modes: [
      { id: 'calm', name: 'Calm', inhale: 4, hold: 2, exhale: 6, description: 'Inhale 4s · Hold 2s · Exhale 6s' },
      { id: 'easy', name: 'Easy', inhale: 4, hold: 0, exhale: 4, description: 'Inhale 4s · Exhale 4s' },
      { id: 'deep-rest', name: 'Deep Rest', inhale: 4, hold: 4, exhale: 8, description: 'Inhale 4s · Hold 4s · Exhale 8s' },
    ],
    calmMessages: [
      'You did beautifully. Carry this calm with you.',
      'Your mind is peaceful, your heart is light.',
      'Remember: you are allowed to slow down anytime.',
      'Every gentle breath is a little hug for your soul.',
      'The world can wait while you take care of you.',
      'Soft heart, quiet mind. You are doing so well.',
      'Peace begins with this very moment.',
      'Breathe in love, breathe out everything else.',
    ],
  };

  // User Options
  const [selectedModeId, setSelectedModeId] = useState<string>(breatheConfig.defaultModeId || 'calm');
  const [selectedDuration, setSelectedDuration] = useState<number>(breatheConfig.defaultDurationMinutes || 3);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false);
  const [hapticsEnabled, setHapticsEnabled] = useState<boolean>(false);

  // Session State
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [completedMessage, setCompletedMessage] = useState<string>('');

  // Real-time animation display states (synced via requestAnimationFrame)
  const [currentPhase, setCurrentPhase] = useState<Phase>('inhale');
  const [secondsRemainingInPhase, setSecondsRemainingInPhase] = useState<number>(4);
  const [totalSecondsLeft, setTotalSecondsLeft] = useState<number>(selectedDuration * 60);
  const [heartScale, setHeartScale] = useState<number>(1.0);
  const [ringScale, setRingScale] = useState<number>(1.0);
  const [ringOpacity, setRingOpacity] = useState<number>(0.3);

  // Session stats for this visit (displayed only on screen, not sent anywhere)
  const [minutesBreathedToday, setMinutesBreathedToday] = useState<number>(0);

  // Accessibility: prefers-reduced-motion
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
  }, []);

  const currentMode = breatheConfig.modes.find((m) => m.id === selectedModeId) || breatheConfig.modes[0];

  // RAF references
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const totalPausedDurationRef = useRef<number>(0);
  const lastPhaseRef = useRef<Phase>('inhale');

  // Web Audio API for gentle phase change tone
  const playGentleTone = useCallback((phaseType: Phase) => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Soft frequencies: G4 (392Hz) for inhale, A4 (440Hz) for hold, E4 (329Hz) for exhale
      const freq = phaseType === 'inhale' ? 392 : phaseType === 'hold' ? 440 : 329.63;

      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.7);
    } catch {
      // Safe fallback if audio blocked
    }
  }, [soundEnabled]);

  // Haptics helper
  const triggerHaptic = useCallback(() => {
    if (!hapticsEnabled || typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
    try {
      navigator.vibrate(35);
    } catch {
      // Safe fallback
    }
  }, [hapticsEnabled]);

  // Handle Session End / Completion
  const handleCompleteSession = useCallback((actualSecondsRun: number) => {
    setIsRunning(false);
    setIsPaused(false);
    setIsCompleted(true);

    const minutesDone = Math.max(1, Math.round(actualSecondsRun / 60));
    setMinutesBreathedToday((prev) => prev + minutesDone);

    const messages = breatheConfig.calmMessages;
    const randomMsg = messages[Math.floor(Math.random() * messages.length)];
    setCompletedMessage(randomMsg);

    // Play subtle soft triad chime
    if (soundEnabled) {
      setTimeout(() => playGentleTone('hold'), 150);
      setTimeout(() => playGentleTone('inhale'), 450);
    }
  }, [breatheConfig.calmMessages, playGentleTone, soundEnabled]);

  // Main RAF Animation Loop
  const animate = useCallback((timestamp: number) => {
    if (!startTimeRef.current) {
      startTimeRef.current = timestamp;
    }

    const totalSessionSeconds = selectedDuration * 60;
    const totalElapsedSec = (timestamp - startTimeRef.current - totalPausedDurationRef.current) / 1000;

    // Check if session completed
    if (totalElapsedSec >= totalSessionSeconds) {
      handleCompleteSession(totalSessionSeconds);
      return;
    }

    const remainingSessionSec = Math.max(0, Math.ceil(totalSessionSeconds - totalElapsedSec));
    setTotalSecondsLeft(remainingSessionSec);

    // Calculate breathing cycle timing
    const { inhale, hold, exhale } = currentMode;
    const cycleDuration = inhale + hold + exhale;
    const timeInCycle = totalElapsedSec % cycleDuration;

    let phase: Phase;
    let phaseElapsed: number;
    let phaseDuration: number;

    if (timeInCycle < inhale) {
      phase = 'inhale';
      phaseElapsed = timeInCycle;
      phaseDuration = inhale;
    } else if (timeInCycle < inhale + hold) {
      phase = 'hold';
      phaseElapsed = timeInCycle - inhale;
      phaseDuration = hold;
    } else {
      phase = 'exhale';
      phaseElapsed = timeInCycle - (inhale + hold);
      phaseDuration = exhale;
    }

    // Trigger haptics and soft tone when phase changes
    if (phase !== lastPhaseRef.current) {
      lastPhaseRef.current = phase;
      triggerHaptic();
      playGentleTone(phase);
    }

    setCurrentPhase(phase);
    const remainingPhaseSec = Math.max(1, Math.ceil(phaseDuration - phaseElapsed));
    setSecondsRemainingInPhase(remainingPhaseSec);

    // Compute Fluid Scale and Ring Animations
    const progress = Math.min(1, Math.max(0, phaseElapsed / phaseDuration));
    const eased = easeInOut(progress);

    let scale = 1.0;
    let rScale = 1.0;
    let rOpacity = 0.2;

    if (phase === 'inhale') {
      scale = 1.0 + 0.38 * eased;
      rScale = 1.0 + 0.55 * eased;
      rOpacity = 0.2 + 0.45 * eased;
    } else if (phase === 'hold') {
      scale = 1.38;
      rScale = 1.55;
      rOpacity = 0.65;
    } else {
      // Exhale
      scale = 1.38 - 0.38 * eased;
      rScale = 1.55 - 0.55 * eased;
      rOpacity = 0.65 - 0.45 * eased;
    }

    if (reducedMotion) {
      setHeartScale(1.0);
      setRingScale(1.0);
      setRingOpacity(rOpacity);
    } else {
      setHeartScale(scale);
      setRingScale(rScale);
      setRingOpacity(rOpacity);
    }

    rafRef.current = requestAnimationFrame(animate);
  }, [currentMode, handleCompleteSession, playGentleTone, reducedMotion, selectedDuration, triggerHaptic]);

  // Start Session
  const handleStart = () => {
    setIsRunning(true);
    setIsPaused(false);
    setIsCompleted(false);
    startTimeRef.current = performance.now();
    pauseTimeRef.current = 0;
    totalPausedDurationRef.current = 0;
    lastPhaseRef.current = 'inhale';
    triggerHaptic();
    playGentleTone('inhale');
    rafRef.current = requestAnimationFrame(animate);
  };

  // Pause Session
  const handlePause = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    pauseTimeRef.current = performance.now();
    setIsPaused(true);
  };

  // Resume Session
  const handleResume = () => {
    if (pauseTimeRef.current > 0) {
      totalPausedDurationRef.current += performance.now() - pauseTimeRef.current;
    }
    setIsPaused(false);
    rafRef.current = requestAnimationFrame(animate);
  };

  // End Session Early
  const handleEndEarly = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const elapsed = startTimeRef.current
      ? (performance.now() - startTimeRef.current - totalPausedDurationRef.current) / 1000
      : 0;
    handleCompleteSession(elapsed);
  };

  // Restart / Reset
  const handleReset = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setIsRunning(false);
    setIsPaused(false);
    setIsCompleted(false);
    setHeartScale(1.0);
    setRingScale(1.0);
    setRingOpacity(0.3);
    setTotalSecondsLeft(selectedDuration * 60);
  };

  // VisibilityChange: Pause automatically when tab hidden or screen turns off
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isRunning && !isPaused) {
        handlePause();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isRunning, isPaused]);

  // Clean up RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const formatMinSec = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getPhaseInstruction = (phase: Phase): string => {
    switch (phase) {
      case 'inhale':
        return 'Breathe in...';
      case 'hold':
        return 'Hold gently...';
      case 'exhale':
        return 'Breathe out slowly...';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12 max-w-xl mx-auto px-2 select-none">
      {/* Header */}
      <div className="text-center space-y-1.5">
        <div className="inline-flex items-center justify-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-xs font-semibold text-rose-300">
          <Wind className="w-3.5 h-3.5 text-rose-400" />
          <span>A Quiet Place for You</span>
        </div>

        <h1
          style={{ fontFamily: "'Caveat', cursive", color: 'var(--text)' }}
          className="text-4xl sm:text-5xl font-bold tracking-wide"
        >
          Breathe With Me
        </h1>
        <p style={{ color: 'var(--text-soft)' }} className="text-xs sm:text-sm font-medium">
          A gentle rhythm made just for {name}. Let your shoulders relax.
        </p>
      </div>

      {/* Main Breathing Sanctuary Card */}
      <section
        style={{
          backgroundColor: isDarkMode ? '#1a0d24' : '#fff5f8',
          borderColor: 'var(--card-border)',
          boxShadow: '0 8px 30px var(--shadow-color)',
        }}
        className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border backdrop-blur-md transition-colors text-center"
      >
        {/* Soft Background Aurora Glow Shift */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40 animate-pulse"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(244, 114, 182, 0.25) 0%, rgba(251, 191, 36, 0.15) 45%, transparent 70%)',
            filter: 'blur(30px)',
          }}
        />

        {/* ========================================================
            VIEW 1: BEFORE STARTING (Configuration & Begin)
            ======================================================== */}
        {!isRunning && !isCompleted && (
          <div className="relative z-10 space-y-6">
            {/* Friendly Intro Text */}
            <div className="p-4 rounded-2xl bg-black/20 border border-rose-500/15">
              <p style={{ color: 'var(--text)' }} className="font-sans text-sm font-semibold leading-relaxed">
                "{breatheConfig.introText}"
              </p>
            </div>

            {/* Breathing Mode Selection (Chips) */}
            <div className="space-y-2 text-left">
              <span style={{ color: 'var(--text-soft)' }} className="text-xs font-semibold uppercase tracking-wider block">
                Choose Rhythm:
              </span>
              <div className="grid grid-cols-3 gap-2">
                {breatheConfig.modes.map((mode) => {
                  const isSelected = selectedModeId === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setSelectedModeId(mode.id)}
                      className={`min-h-[48px] px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border flex flex-col items-center justify-center ${
                        isSelected
                          ? 'bg-rose-500 text-white border-rose-400 shadow-md shadow-rose-500/30 scale-102'
                          : 'bg-white/5 border-rose-500/20 text-rose-200/80 hover:bg-white/10'
                      }`}
                    >
                      <span>{mode.name}</span>
                      <span className="text-[10px] opacity-75 font-normal mt-0.5">
                        {mode.inhale}-{mode.hold ? `${mode.hold}-` : ''}{mode.exhale}s
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-rose-300/70 text-center font-medium mt-1">
                {currentMode.description}
              </p>
            </div>

            {/* Duration Selection (Chips) */}
            <div className="space-y-2 text-left">
              <span style={{ color: 'var(--text-soft)' }} className="text-xs font-semibold uppercase tracking-wider block">
                Session Length:
              </span>
              <div className="grid grid-cols-3 gap-2">
                {[1, 3, 5].map((mins) => {
                  const isSelected = selectedDuration === mins;
                  return (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => {
                        setSelectedDuration(mins);
                        setTotalSecondsLeft(mins * 60);
                      }}
                      className={`min-h-[48px] px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer border flex items-center justify-center ${
                        isSelected
                          ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white border-rose-400 shadow-md shadow-rose-500/30'
                          : 'bg-white/5 border-rose-500/20 text-rose-200/80 hover:bg-white/10'
                      }`}
                    >
                      <span>{mins} {mins === 1 ? 'Minute' : 'Minutes'}</span>
                    </button>
                  );
                })}
              </div>
            </div>


            {/* Start Button */}
            <button
              type="button"
              onClick={handleStart}
              className="theme-btn-accent w-full min-h-[52px] rounded-2xl text-base font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-rose-600/30 active:scale-98 transition-transform"
            >
              <Play className="w-5 h-5 fill-white" />
              <span>Begin Breathing</span>
            </button>
          </div>
        )}

        {/* ========================================================
            VIEW 2: ACTIVE SESSION (Fluid Glowing Heart Guide)
            ======================================================== */}
        {isRunning && (
          <div className="relative z-10 py-4 space-y-6 flex flex-col items-center">
            {/* Top Phase Header & Remaining Session Timer */}
            <div className="flex items-center justify-between w-full px-2 text-xs font-semibold">
              <span className="text-rose-300/80">
                Mode: <strong>{currentMode.name}</strong>
              </span>
              <span className="tabular-nums font-mono px-2.5 py-1 rounded-full bg-black/30 text-rose-200 border border-rose-500/20">
                {formatMinSec(totalSecondsLeft)}
              </span>
            </div>

            {/* Big Center Heart Visual with Ripple Rings */}
            <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center my-2">
              {/* Soft Expanding / Contracting Ripple Ring */}
              <div
                className="absolute inset-0 rounded-full border-2 border-rose-400 pointer-events-none"
                style={{
                  transform: `scale(${ringScale})`,
                  opacity: ringOpacity,
                  filter: 'blur(2px)',
                  boxShadow: '0 0 25px rgba(244, 114, 182, 0.45)',
                  willChange: 'transform, opacity',
                }}
              />

              {/* Inner Warm Halo */}
              <div
                className="absolute w-44 h-44 rounded-full pointer-events-none"
                style={{
                  background:
                    currentPhase === 'hold'
                      ? 'radial-gradient(circle, rgba(251, 191, 36, 0.5) 0%, rgba(244, 114, 182, 0.3) 50%, transparent 75%)'
                      : 'radial-gradient(circle, rgba(244, 114, 182, 0.4) 0%, rgba(225, 29, 72, 0.25) 50%, transparent 75%)',
                  transform: `scale(${heartScale * 1.1})`,
                  filter: 'blur(20px)',
                  willChange: 'transform',
                }}
              />

              {/* Glowing Beating Heart SVG Container */}
              <div
                className="relative z-20 flex items-center justify-center"
                style={{
                  transform: `scale(${heartScale})`,
                  willChange: 'transform',
                  filter:
                    currentPhase === 'hold'
                      ? 'drop-shadow(0 0 28px rgba(251, 191, 36, 0.85))'
                      : 'drop-shadow(0 0 24px rgba(244, 114, 182, 0.85))',
                }}
              >
                <Heart className="w-28 h-28 sm:w-32 sm:h-32 text-rose-500 fill-rose-500" />
              </div>
            </div>

            {/* Big Instruction Text & Countdown Number */}
            <div className="space-y-1 text-center">
              <h2
                style={{ color: 'var(--text)' }}
                className="font-sans font-semibold text-2xl sm:text-3xl tracking-tight transition-all"
              >
                {getPhaseInstruction(currentPhase)}
              </h2>

              <p className="font-mono text-xl sm:text-2xl font-bold tabular-nums text-rose-300">
                {secondsRemainingInPhase}
              </p>
            </div>

            {/* Controls: Pause / Resume & End Button */}
            <div className="flex items-center justify-center gap-3 w-full pt-2">
              {isPaused ? (
                <button
                  type="button"
                  onClick={handleResume}
                  className="min-h-[48px] px-6 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>Resume</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePause}
                  className="min-h-[48px] px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-rose-100 font-bold text-sm border border-rose-400/30 transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                >
                  <Pause className="w-4 h-4 fill-white" />
                  <span>Pause</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleEndEarly}
                className="min-h-[48px] px-5 py-2.5 rounded-full bg-black/40 hover:bg-rose-950/60 text-rose-300 hover:text-rose-100 font-semibold text-xs border border-rose-500/20 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Square className="w-3.5 h-3.5 fill-rose-400 text-rose-400" />
                <span>End</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================
            VIEW 3: SESSION COMPLETED (Gentle Calm Message & Stats)
            ======================================================== */}
        {isCompleted && (
          <div className="relative z-10 py-6 space-y-6 text-center animate-fade-in">
            {/* Glowing Celebration Badge */}
            <div className="w-20 h-20 mx-auto rounded-full bg-rose-500/20 border-2 border-rose-400/40 flex items-center justify-center shadow-lg shadow-rose-500/20">
              <Sparkles className="w-10 h-10 text-amber-300 animate-spin-slow" />
            </div>

            <div className="space-y-2">
              <h2
                style={{ fontFamily: "'Caveat', cursive", color: 'var(--text)' }}
                className="text-3xl sm:text-4xl font-bold"
              >
                Quiet Peace Restored ✨
              </h2>
              <p
                style={{ color: 'var(--text-soft)' }}
                className="font-serif italic text-base sm:text-lg max-w-md mx-auto leading-relaxed"
              >
                "{completedMessage}"
              </p>
            </div>

            {/* Display how many minutes breathed today (on screen only) */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-black/30 border border-rose-500/20 text-xs font-semibold text-rose-200">
              <Heart className="w-4 h-4 text-rose-400 fill-rose-500" />
              <span>Minutes breathed today: <strong>{minutesBreathedToday} min</strong></span>
            </div>

            {/* Breathe Again Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleReset}
                className="theme-btn-accent min-h-[48px] px-8 py-3 rounded-full text-sm font-bold flex items-center justify-center gap-2 mx-auto cursor-pointer shadow-lg active:scale-95 transition-transform"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Breathe Again</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Dynamic Slot: Breathe Bottom */}
      <DynamicSlot slotId="breathe_bottom" isDarkMode={isDarkMode} />
    </div>
  );
};
