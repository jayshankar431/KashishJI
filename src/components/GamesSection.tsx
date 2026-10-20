import React, { useState, useEffect, useRef } from 'react';
import {
  Heart,
  Sparkles,
  HelpCircle,
  RotateCw,
  Trophy,
  Smile,
  Flame,
  CheckCircle2,
  RefreshCw,
  Gift,
  Star,
  PartyPopper
} from 'lucide-react';
import { romanticAudio } from '../audio';
import { triggerHaptic, showNativeToast, logNativeActivity } from '../androidBridge';
import { DynamicSlot } from './DynamicSlot';

interface GamesSectionProps {
  name: string;
  compliments: string[];
  isDarkMode: boolean;
  onGameWin?: () => void;
  onUpdateHighScore?: (game: string, score: number) => void;
}

export const GamesSection: React.FC<GamesSectionProps> = ({
  name,
  compliments,
  isDarkMode,
  onGameWin,
  onUpdateHighScore,
}) => {
  const [activeGame, setActiveGame] = useState<
    'runaway' | 'quiz' | 'catch' | 'memory' | 'spin' | 'scratch' | 'meter' | 'truth-dare'
  >('runaway');

  const gameTabs = [
    { id: 'runaway', label: 'Be My Love? 💖' },
    { id: 'quiz', label: 'Heart Quiz' },
    { id: 'catch', label: 'Catch Hearts' },
    { id: 'memory', label: 'Memory Match' },
    { id: 'spin', label: 'Spin Wheel' },
    { id: 'scratch', label: 'Scratch Card' },
    { id: 'meter', label: 'Love Meter' },
    { id: 'truth-dare', label: 'Truth or Dare' },
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="text-center space-y-1">
        <h2
          style={{ color: 'var(--text)' }}
          className="font-serif text-2xl sm:text-3xl font-bold"
        >
          Playful Moments
        </h2>
        <p
          style={{ color: 'var(--text-soft)' }}
          className="text-xs sm:text-sm italic font-medium"
        >
          "Laughter is the shortest distance between two hearts."
        </p>
      </div>      {/* Game Selector Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none snap-x">
        {gameTabs.map((g) => {
          const isActive = activeGame === g.id;
          return (
            <button
              key={g.id}
              onClick={() => {
                setActiveGame(g.id as typeof activeGame);
                romanticAudio.playChime();
                if (g.id === 'quiz') {
                  logNativeActivity("🎮 Kashish is playing the Quiz Game");
                }
              }}
              style={{
                backgroundColor: isActive ? 'var(--accent)' : 'var(--card)',
                color: isActive ? 'var(--accent-text)' : 'var(--text)',
                borderColor: 'var(--card-border)',
                boxShadow: isActive ? '0 4px 12px rgba(214, 51, 108, 0.3)' : 'none',
              }}
              className="min-h-[48px] px-4 py-2.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all shrink-0 border cursor-pointer active:scale-95 touch-manipulation"
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {/* Active Game Container */}
      <div
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--card-border)',
          boxShadow: '0 6px 24px var(--shadow-color)',
        }}
        className="rounded-3xl p-4 sm:p-8 border shadow-sm transition-all min-h-[420px] flex flex-col justify-center overflow-hidden"
      >
        {activeGame === 'runaway' && (
          <RunawayButtonGame name={name} isDarkMode={isDarkMode} onGameWin={onGameWin} />
        )}
        {activeGame === 'quiz' && (
          <LoveQuizGame
            name={name}
            isDarkMode={isDarkMode}
            onGameWin={onGameWin}
            onUpdateHighScore={onUpdateHighScore}
          />
        )}
        {activeGame === 'catch' && (
          <CatchHeartsGame
            isDarkMode={isDarkMode}
            onGameWin={onGameWin}
            onUpdateHighScore={onUpdateHighScore}
          />
        )}
        {activeGame === 'memory' && (
          <MemoryMatchGame
            isDarkMode={isDarkMode}
            onGameWin={onGameWin}
            onUpdateHighScore={onUpdateHighScore}
          />
        )}
        {activeGame === 'spin' && <SpinWheelGame compliments={compliments} isDarkMode={isDarkMode} />}
        {activeGame === 'scratch' && <ScratchCardGame name={name} isDarkMode={isDarkMode} />}
        {activeGame === 'meter' && (
          <LoveMeterGame
            name={name}
            isDarkMode={isDarkMode}
            onUpdateHighScore={onUpdateHighScore}
          />
        )}
        {activeGame === 'truth-dare' && <TruthOrDareGame isDarkMode={isDarkMode} />}
      </div>

      {/* Dynamic Slot: Games Bottom */}
      <DynamicSlot slotId="games_bottom" isDarkMode={isDarkMode} />
    </div>
  );
};

/* =========================================================================
   1. BE MY LOVE? (RUNAWAY & SHRINKING PROPOSAL GAME)
   ========================================================================= */
const RunawayButtonGame: React.FC<{
  name: string;
  isDarkMode: boolean;
  onGameWin?: () => void;
}> = ({ name, onGameWin }) => {
  // CONFIG: Change hint messages and max attempts here
  const MAX_ATTEMPTS = 12;
  const noHints = [
    "Take your time... but I think you already know the answer 😉",
    "Oops! Wrong button, cutie. Try the big one 😄",
    "Hey, what are you doing? Press YES please 🙈",
    "Oho! Just agree already, please? 🥺",
    "Come on, you're making me blush 😳",
    "Even the hearts are saying yes now 💗",
    "Be honest, your finger slipped, right? 😏",
    "See? The YES button is growing because it believes in us 💪",
    "I'll share my dessert with you if you press YES 🍰",
    "The No button is getting scared of you 😭",
    "Last warning: the YES button is about to take over 😤",
    "Okay okay... the No button is almost gone 🫣",
    "No more No. Destiny has spoken: it's YES 💖",
  ];

  const [attemptCount, setAttemptCount] = useState(0);
  const [hasAgreed, setHasAgreed] = useState(false);
  const [noPos, setNoPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hasMovedInitial, setHasMovedInitial] = useState(false);
  const [popHearts, setPopHearts] = useState<{ id: number; left: number }[]>([]);
  const [isShaking, setIsShaking] = useState(false);
  
  const arenaRef = useRef<HTMLDivElement>(null);
  const lastDodgeRef = useRef<number>(0);

  const dodgeNo = (e?: React.SyntheticEvent) => {
    if (attemptCount >= MAX_ATTEMPTS || hasAgreed) return;
    
    // 400ms cooldown to prevent double counts from touch + hover
    const now = Date.now();
    if (now - lastDodgeRef.current < 400) return;
    lastDodgeRef.current = now;

    if (e) {
      // Prevent actual clicking/pressing on mobile
      if ('preventDefault' in e) e.preventDefault();
    }

    const nextCount = attemptCount + 1;
    setAttemptCount(nextCount);
    setIsShaking(true);
    romanticAudio.playChime();

    // Random positioning logic
    const arena = arenaRef.current;
    if (arena) {
      const arenaWidth = arena.clientWidth;
      const arenaHeight = arena.clientHeight;
      const padding = 20;
      const btnWidth = 80;
      const btnHeight = 44;

      // Calculate restricted area (where the Yes button is)
      // The Yes button is in the center
      const yesSize = 150 * (1 + nextCount * 0.12);
      const yesSafeZone = yesSize / 2 + 30;
      const centerX = arenaWidth / 2;
      const centerY = arenaHeight / 2;

      let newX = noPos.x;
      let newY = noPos.y;
      let attempts = 0;

      // Try to find a spot that doesn't overlap the Yes button
      while (attempts < 15) {
        newX = padding + Math.random() * (arenaWidth - btnWidth - padding * 2);
        newY = padding + Math.random() * (arenaHeight - btnHeight - padding * 2);
        
        const distFromCenter = Math.sqrt(Math.pow(newX + btnWidth/2 - centerX, 2) + Math.pow(newY + btnHeight/2 - centerY, 2));
        if (distFromCenter > yesSafeZone) break;
        attempts++;
      }

      setNoPos({ x: newX, y: newY });
      setHasMovedInitial(true);
    }

    // Pop heart effect
    const newHeart = { id: Date.now(), left: Math.random() * 80 + 10 };
    setPopHearts(prev => [...prev, newHeart]);
    setTimeout(() => {
      setPopHearts(prev => prev.filter(h => h.id !== newHeart.id));
    }, 1000);
    
    setTimeout(() => setIsShaking(false), 500);
  };

  const handleYes = () => {
    setHasAgreed(true);
    if (typeof window !== 'undefined' && window.AndroidApp?.vibrate) {
      window.AndroidApp.vibrate(50);
    } else {
      triggerHaptic(50);
    }
    showNativeToast("Officially Mine! 💍💑💖");
    logNativeActivity("🎮 Kashish completed the Proposal Game with YES, I WILL! 💍💖");
    romanticAudio.playChime();
    onGameWin?.();
  };

  const resetGame = () => {
    setAttemptCount(0);
    setHasAgreed(false);
    setHasMovedInitial(false);
    setNoPos({ x: 0, y: 0 });
  };

  const isFinalState = attemptCount >= MAX_ATTEMPTS;
  const yesScale = 1 + attemptCount * 0.12;
  const noScale = Math.max(0.2, 1 - attemptCount * 0.08);

  return (
    <div className="text-center space-y-6 relative py-4 w-full max-w-full overflow-hidden">
      {!hasAgreed ? (
        <>
          <div className="space-y-3 px-2">
            <span
              style={{ color: 'var(--accent)' }}
              className="text-xs uppercase tracking-widest font-bold inline-flex items-center gap-1.5"
            >
              <Heart className="w-3.5 h-3.5 fill-[var(--accent)]" />
              The Most Special Question
            </span>
            <h3
              style={{ color: 'var(--text)' }}
              className="font-serif text-2xl sm:text-3xl font-bold leading-tight"
            >
              Will you be mine, {name}? 💖
            </h3>
            
            {/* Hint Message with Shake/Fade */}
            <div className={`min-h-[44px] flex items-center justify-center transition-all duration-300 ${isShaking ? 'animate-shake' : ''}`}>
              <p
                style={{ color: 'var(--text-soft)' }}
                className="text-sm font-medium max-w-xs mx-auto leading-tight"
              >
                {noHints[Math.min(attemptCount, noHints.length - 1)]}
              </p>
            </div>
          </div>

          {/* Game Arena with Fixed Height */}
          <div 
            ref={arenaRef}
            className="relative w-full h-[280px] sm:h-[320px] bg-rose-50/10 dark:bg-rose-950/5 rounded-3xl overflow-hidden flex flex-col items-center justify-center"
          >
            {/* YES Button */}
            <button
              onClick={handleYes}
              style={{
                transform: `scale(${isFinalState ? 1 : yesScale})`,
                backgroundColor: 'var(--accent)',
                color: 'var(--accent-text)',
                width: isFinalState ? 'calc(100% - 32px)' : 'auto',
                height: isFinalState ? 'calc(100% - 32px)' : 'auto',
                maxWidth: isFinalState ? '100%' : '180px',
                zIndex: 10,
              }}
              className={`px-8 py-3 rounded-3xl font-bold text-base sm:text-lg transition-all duration-500 cursor-pointer shadow-lg active:scale-95 touch-manipulation flex items-center justify-center ${isFinalState ? 'animate-pulse shadow-rose-500/50' : 'hover:scale-105'}`}
            >
              YES, I WILL! 🥰💍
              {popHearts.map(h => (
                <Heart 
                  key={h.id} 
                  className="absolute top-0 w-6 h-6 fill-rose-400 text-rose-400 animate-float-up pointer-events-none"
                  style={{ left: `${h.left}%` }}
                />
              ))}
            </button>

            {/* NO Button (Runaway) */}
            {!isFinalState && (
              <button
                onPointerEnter={() => dodgeNo()}
                onTouchStart={(e) => dodgeNo(e)}
                onClick={(e) => dodgeNo(e)}
                onFocus={() => dodgeNo()}
                style={{
                  position: hasMovedInitial ? 'absolute' : 'relative',
                  left: hasMovedInitial ? `${noPos.x}px` : 'auto',
                  top: hasMovedInitial ? `${noPos.y}px` : 'auto',
                  transform: `scale(${noScale})`,
                  marginTop: hasMovedInitial ? 0 : '16px',
                  zIndex: 20,
                  transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  opacity: attemptCount >= MAX_ATTEMPTS ? 0 : 1,
                  pointerEvents: attemptCount >= MAX_ATTEMPTS ? 'none' : 'auto',
                }}
                className="min-h-[44px] min-w-[80px] px-5 py-2 rounded-full border border-[var(--card-border)] bg-[var(--card-solid)] font-bold text-xs text-[var(--text)] cursor-pointer shadow-sm touch-manipulation"
              >
                No 🙈
              </button>
            )}
          </div>
        </>
      ) : (
        /* CELEBRATION STATE */
        <div className="space-y-6 py-8 animate-fade-in text-center">
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-rose-500 blur-3xl opacity-20 rounded-full animate-pulse" />
            <div
              style={{
                backgroundColor: 'var(--card-subtle)',
                borderColor: 'var(--card-border)',
              }}
              className="w-24 h-24 rounded-full border-2 text-[var(--accent)] flex items-center justify-center mx-auto animate-heartbeat shadow-2xl relative z-10"
            >
              <Heart className="w-12 h-12 fill-[var(--accent)] text-[var(--accent)]" />
            </div>
            <PartyPopper className="absolute -top-4 -left-4 w-8 h-8 text-amber-500 animate-bounce" />
            <Sparkles className="absolute -bottom-4 -right-4 w-8 h-8 text-rose-400 animate-pulse" />
          </div>
          
          <div className="space-y-2">
            <h3
              style={{ color: 'var(--accent)' }}
              className="font-serif text-3xl sm:text-4xl font-bold animate-slide-up"
            >
              Officially Mine! 💍💑💖
            </h3>
            <p
              style={{ color: 'var(--text)' }}
              className="font-script text-2xl sm:text-3xl max-w-md mx-auto leading-relaxed font-bold"
            >
              "I knew it. You just made my whole world brighter. I promise to cherish you forever, {name}."
            </p>
          </div>

          <div className="pt-4 flex flex-col items-center gap-4">
            <div className="flex gap-2">
              <Star className="w-5 h-5 text-amber-400 fill-amber-400 animate-spin-slow" />
              <Star className="w-5 h-5 text-amber-400 fill-amber-400 animate-spin-slow" />
              <Star className="w-5 h-5 text-amber-400 fill-amber-400 animate-spin-slow" />
            </div>
            <button
              onClick={resetGame}
              style={{
                borderColor: 'var(--card-border)',
                color: 'var(--accent)',
                backgroundColor: 'var(--card-subtle)',
              }}
              className="min-h-[48px] px-8 py-2.5 rounded-full border text-sm font-bold hover:bg-[var(--card-border)] transition-all cursor-pointer shadow-sm active:scale-95"
            >
              Play Again 💘
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/* =========================================================================
   2. LOVE & FRIENDSHIP QUIZ (5 QUESTIONS)
   ========================================================================= */
const LoveQuizGame: React.FC<{
  name: string;
  isDarkMode: boolean;
  onGameWin?: () => void;
  onUpdateHighScore?: (game: string, score: number) => void;
}> = ({ name, onGameWin, onUpdateHighScore }) => {
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [isFinished, setIsFinished] = useState(false);

  const questions = [
    {
      q: `What is the most charming thing about you, ${name}?`,
      options: [
        'Your bright laughter that lights up a room',
        'Your gentle kindness towards everyone',
        'The quiet warmth in your eyes',
        'Literally all of the above! 🌸',
      ],
    },
    {
      q: 'If we were spending a cozy quiet evening together, what would we do?',
      options: [
        'Listen to our favorite music and talk for hours',
        'Watch a comforting movie with warm treats',
        'Stargaze from a rooftop wrapped in blankets',
        'Share stories and laugh until our cheeks hurt',
      ],
    },
    {
      q: 'What secret superpower do you bring into my life?',
      options: [
        'Making a bad day turn sunny in one second',
        'Bringing calm whenever life feels chaotic',
        'Making my heart smile without saying a word',
        'Being genuinely unforgettable',
      ],
    },
    {
      q: 'Which dessert perfectly matches your personality?',
      options: [
        'Warm chocolate cake with strawberries',
        'Sweet honey glazed cinnamon roll',
        'Vanilla ice cream on a sunny afternoon',
        'Cotton candy in a pastel pink dream',
      ],
    },
    {
      q: 'How rare is someone like you in this big universe?',
      options: [
        'One in a million',
        'One in eight billion',
        'A once-in-a-lifetime shooting star',
        'Infinite and truly irreplaceable ✨',
      ],
    },
  ];

  const handleSelect = (idx: number) => {
    // Native phone vibration on submitting quiz option
    triggerHaptic(40);

    romanticAudio.playChime();
    const updated = [...selectedAnswers, idx];
    setSelectedAnswers(updated);

    if (currentQ < questions.length - 1) {
      setCurrentQ(currentQ + 1);
    } else {
      setIsFinished(true);
      const score = 100;
      showNativeToast("Quiz Complete! 💖✨");
      logNativeActivity("🎮 Kashish completed the Quiz Game with score: " + score);
      onGameWin?.();
      onUpdateHighScore?.('quiz', score);
    }
  };

  const restart = () => {
    setCurrentQ(0);
    setSelectedAnswers([]);
    setIsFinished(false);
  };

  return (
    <div className="space-y-6 max-w-lg mx-auto py-2">
      {!isFinished ? (
        <>
          <div className="flex items-center justify-between text-xs font-bold">
            <span style={{ color: 'var(--accent)' }}>
              Question {currentQ + 1} of {questions.length}
            </span>
            <span style={{ color: 'var(--text-soft)' }}>Heart Connection Quiz</span>
          </div>

          <div
            style={{ backgroundColor: 'var(--card-subtle)' }}
            className="w-full h-2 rounded-full overflow-hidden border border-[var(--card-border)]"
          >
            <div
              style={{
                backgroundColor: 'var(--accent)',
                width: `${((currentQ + 1) / questions.length) * 100}%`,
              }}
              className="h-full transition-all duration-300"
            />
          </div>

          <h3
            style={{ color: 'var(--text)' }}
            className="font-serif text-lg sm:text-xl font-bold"
          >
            {questions[currentQ].q}
          </h3>

          <div className="space-y-2.5">
            {questions[currentQ].options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleSelect(i)}
                style={{
                  backgroundColor: 'var(--card-solid)',
                  borderColor: 'var(--card-border)',
                  color: 'var(--text)',
                }}
                className="w-full min-h-[48px] p-3 text-left rounded-2xl border text-xs sm:text-sm font-semibold transition-all active:scale-[0.99] flex items-center gap-3 cursor-pointer hover:border-[var(--accent)] hover:bg-[var(--card-subtle)] shadow-xs"
              >
                <span
                  style={{
                    backgroundColor: 'var(--card-subtle)',
                    color: 'var(--accent)',
                    borderColor: 'var(--card-border)',
                  }}
                  className="w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold shrink-0"
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span>{opt}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="text-center space-y-4 py-4 animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/30">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3
            style={{ color: 'var(--text)' }}
            className="font-serif text-2xl font-bold"
          >
            Quiz Result: 100% Soul Match!
          </h3>
          <p
            style={{ color: 'var(--text)' }}
            className="font-script text-2xl leading-relaxed font-bold"
          >
            "Every single answer pointed to the same truth: You are a rare blessing, and having you in my life makes everything brighter."
          </p>
          <button
            onClick={restart}
            className="theme-btn-accent min-h-[44px] px-6 py-2.5 rounded-full text-xs font-bold active:scale-95 cursor-pointer"
          >
            Take It Again
          </button>
        </div>
      )}
    </div>
  );
};

/* =========================================================================
   3. CATCH THE HEARTS (FALLING HEARTS)
   ========================================================================= */
const CatchHeartsGame: React.FC<{
  isDarkMode: boolean;
  onGameWin?: () => void;
  onUpdateHighScore?: (game: string, score: number) => void;
}> = ({ isDarkMode, onGameWin, onUpdateHighScore }) => {
  const [score, setScore] = useState(0);
  const [gameStarted, setGameStarted] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number; speed: number; size: number }[]>([]);

  useEffect(() => {
    if (!gameStarted || unlocked) return;

    const interval = setInterval(() => {
      setHearts((prev) => {
        if (prev.length >= 6) return prev;
        return [
          ...prev,
          {
            id: Math.random(),
            x: Math.random() * 85 + 5,
            y: 0,
            speed: Math.random() * 1.5 + 1.2,
            size: Math.random() * 12 + 24,
          },
        ];
      });
    }, 900);

    const fallTimer = setInterval(() => {
      setHearts((prev) =>
        prev
          .map((h) => ({ ...h, y: h.y + h.speed }))
          .filter((h) => h.y < 100)
      );
    }, 40);

    return () => {
      clearInterval(interval);
      clearInterval(fallTimer);
    };
  }, [gameStarted, unlocked]);

  const catchHeart = (id: number) => {
    // Native phone vibration on popping a heart
    triggerHaptic(40);

    romanticAudio.playChime();
    setHearts((prev) => prev.filter((h) => h.id !== id));
    setScore((s) => {
      const newScore = s + 1;
      onUpdateHighScore?.('catchHearts', newScore);
      if (newScore >= 10) {
        setUnlocked(true);
        showNativeToast("Heart Catcher Master! 💖");
        logNativeActivity("🎮 Kashish completed the Catch Hearts Game with score: " + newScore);
        onGameWin?.();
      }
      return newScore;
    });
  };

  return (
    <div className="text-center space-y-4">
      <div className="flex items-center justify-between text-xs font-bold">
        <span style={{ color: 'var(--accent)' }}>Hearts Caught: {score} / 10</span>
        <span style={{ color: 'var(--text-soft)' }}>Catch 10 to unlock the secret</span>
      </div>

      {!gameStarted && !unlocked && (
        <div className="py-12 space-y-4">
          <Heart className="w-12 h-12 fill-[var(--accent)] text-[var(--accent)] mx-auto animate-heartbeat" />
          <h3
            style={{ color: 'var(--text)' }}
            className="font-serif text-xl font-bold"
          >
            Catch The Falling Hearts
          </h3>
          <p
            style={{ color: 'var(--text-soft)' }}
            className="text-xs max-w-xs mx-auto font-medium"
          >
            Tap the hearts as they flutter down from the sky!
          </p>
          <button
            onClick={() => setGameStarted(true)}
            className="theme-btn-accent min-h-[48px] px-6 py-2.5 rounded-full text-xs font-bold cursor-pointer"
          >
            Start Game
          </button>
        </div>
      )}

      {gameStarted && !unlocked && (
        <div
          style={{
            backgroundColor: 'var(--card-subtle)',
            borderColor: 'var(--card-border)',
          }}
          className="relative h-64 sm:h-72 w-full rounded-2xl border overflow-hidden select-none touch-none"
        >
          {hearts.map((h) => {
            const touchSize = Math.max(48, h.size);
            return (
              <button
                key={h.id}
                onClick={() => catchHeart(h.id)}
                onTouchStart={() => catchHeart(h.id)}
                style={{
                  left: `${h.x}%`,
                  top: `${h.y}%`,
                  width: `${touchSize}px`,
                  height: `${touchSize}px`,
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer active:scale-125 transition-transform touch-manipulation min-h-[48px] min-w-[48px]"
              >
                <Heart
                  style={{ width: `${h.size}px`, height: `${h.size}px` }}
                  className="text-[var(--accent)] fill-[var(--accent)] drop-shadow-sm pointer-events-none"
                />
              </button>
            );
          })}
        </div>
      )}

      {unlocked && (
        <div className="space-y-4 py-8 animate-fade-in">
          <Trophy className="w-12 h-12 text-amber-500 mx-auto" />
          <h3
            style={{ color: 'var(--accent)' }}
            className="font-serif text-2xl font-bold"
          >
            Surprise Unlocked! 🎉
          </h3>
          <p
            style={{ color: 'var(--text)' }}
            className="font-script text-xl sm:text-2xl max-w-sm mx-auto leading-relaxed font-bold"
          >
            "You caught 10 hearts in the sky... just like how you effortlessly captured my heart without even trying!"
          </p>
          <button
            onClick={() => {
              setScore(0);
              setUnlocked(false);
              setGameStarted(true);
            }}
            style={{
              borderColor: 'var(--card-border)',
              color: 'var(--accent)',
              backgroundColor: 'var(--card-subtle)',
            }}
            className="min-h-[48px] px-6 py-2.5 rounded-full border text-xs font-bold cursor-pointer"
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  );
};

/* =========================================================================
   4. MEMORY MATCH CARDS (8 PAIRS)
   ========================================================================= */
const MemoryMatchGame: React.FC<{
  isDarkMode: boolean;
  onGameWin?: () => void;
  onUpdateHighScore?: (game: string, score: number) => void;
}> = ({ isDarkMode, onGameWin, onUpdateHighScore }) => {
  const symbols = ['🌹', '💫', '💌', '🧸', '🍓', '🌙', '🎀', '🧁'];
  const [cards, setCards] = useState<
    { id: number; symbol: string; isFlipped: boolean; isMatched: boolean }[]
  >([]);
  const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [won, setWon] = useState(false);

  const initGame = () => {
    const deck = [...symbols, ...symbols]
      .sort(() => Math.random() - 0.5)
      .map((sym, i) => ({
        id: i,
        symbol: sym,
        isFlipped: false,
        isMatched: false,
      }));
    setCards(deck);
    setFlippedIndices([]);
    setMoves(0);
    setWon(false);
  };

  useEffect(() => {
    initGame();
  }, []);

  const handleCardClick = (idx: number) => {
    if (cards[idx].isFlipped || cards[idx].isMatched || flippedIndices.length === 2) return;

    romanticAudio.playChime();
    const newCards = [...cards];
    newCards[idx].isFlipped = true;
    setCards(newCards);

    const newFlipped = [...flippedIndices, idx];
    setFlippedIndices(newFlipped);

    if (newFlipped.length === 2) {
      setMoves((m) => m + 1);
      const [first, second] = newFlipped;
      if (newCards[first].symbol === newCards[second].symbol) {
        newCards[first].isMatched = true;
        newCards[second].isMatched = true;
        setCards(newCards);
        setFlippedIndices([]);

        triggerHaptic(40);

        if (newCards.every((c) => c.isMatched)) {
          setWon(true);
          showNativeToast("Memory Match Won! 🌸✨");
          logNativeActivity("🎮 Kashish completed the Memory Match Game in " + (moves + 1) + " moves");
          onGameWin?.();
          onUpdateHighScore?.('memoryMatch', 1);
        }
      } else {
        setTimeout(() => {
          newCards[first].isFlipped = false;
          newCards[second].isFlipped = false;
          setCards([...newCards]);
          setFlippedIndices([]);
        }, 800);
      }
    }
  };

  return (
    <div className="space-y-4 text-center max-w-sm mx-auto">
      <div className="flex items-center justify-between text-xs font-bold">
        <span style={{ color: 'var(--accent)' }}>Moves: {moves}</span>
        <button
          onClick={initGame}
          style={{ color: 'var(--text-soft)' }}
          className="flex items-center gap-1 hover:text-[var(--accent)] min-h-[48px] px-3 cursor-pointer font-bold touch-manipulation"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
      </div>

      {!won ? (
        <div className="grid grid-cols-4 gap-2">
          {cards.map((card, i) => (
            <button
              key={card.id}
              onClick={() => handleCardClick(i)}
              style={{
                backgroundColor: card.isFlipped || card.isMatched ? 'var(--card-subtle)' : 'var(--card-solid)',
                borderColor: card.isFlipped || card.isMatched ? 'var(--accent)' : 'var(--card-border)',
                color: 'var(--text)',
              }}
              className="h-14 sm:h-20 rounded-2xl border text-xl sm:text-2xl flex items-center justify-center transition-all duration-300 min-h-[48px] min-w-[48px] cursor-pointer shadow-xs active:scale-95 touch-manipulation select-none"
            >
              {card.isFlipped || card.isMatched ? card.symbol : '💖'}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3 py-6 animate-fade-in">
          <Sparkles className="w-10 h-10 text-amber-500 mx-auto" />
          <h3
            style={{ color: 'var(--text)' }}
            className="font-serif text-xl font-bold"
          >
            You Won in {moves} moves!
          </h3>
          <p
            style={{ color: 'var(--text)' }}
            className="font-script text-xl font-bold"
          >
            "Your memory is as brilliant as your pure heart!"
          </p>
          <button
            onClick={initGame}
            className="theme-btn-accent min-h-[48px] px-6 py-2 rounded-full text-xs font-bold cursor-pointer touch-manipulation"
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  );
};

/* =========================================================================
   5. SPIN WHEEL (COMPLIMENTS & SWEET DATE IDEAS)
   ========================================================================= */
const SpinWheelGame: React.FC<{ compliments: string[]; isDarkMode: boolean }> = ({ isDarkMode }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [selectedResult, setSelectedResult] = useState<string | null>(null);

  const items = [
    'Your smile melts hearts',
    'Late night stargazing',
    'Warmest cozy hug',
    'Ice cream date',
    'Your laugh is melody',
    'Handwritten letter',
    'Sunset beach walk',
    'Endless warm memories',
  ];

  const colors = [
    '#d6336c', '#9c36b5', '#e64980', '#be4bdb',
    '#7950f2', '#f03e3e', '#e03131', '#ae3ec9',
  ];

  const drawWheel = (angle: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const center = size / 2;
    const radius = center - 8;
    const sliceAngle = (2 * Math.PI) / items.length;

    ctx.clearRect(0, 0, size, size);

    items.forEach((item, i) => {
      const start = angle + i * sliceAngle;
      const end = start + sliceAngle;

      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Text with shadow for readability
      ctx.save();
      ctx.translate(center, center);
      ctx.rotate(start + sliceAngle / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 4;
      ctx.fillText(item.slice(0, 16), radius - 18, 4);
      ctx.restore();
    });

    // Center hub
    ctx.beginPath();
    ctx.arc(center, center, 20, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#d6336c';
    ctx.lineWidth = 3;
    ctx.stroke();
  };

  useEffect(() => {
    drawWheel(0);
  }, []);

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    setSelectedResult(null);
    romanticAudio.playChime();

    let currentAngle = 0;
    const totalSpins = 4 + Math.random() * 4;
    const duration = 3000;
    const startTime = performance.now();

    const animateSpin = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      currentAngle = ease * (totalSpins * 2 * Math.PI);

      drawWheel(currentAngle);

      if (progress < 1) {
        requestAnimationFrame(animateSpin);
      } else {
        setSpinning(false);
        const normalized = (2 * Math.PI - (currentAngle % (2 * Math.PI))) % (2 * Math.PI);
        const sliceAngle = (2 * Math.PI) / items.length;
        const index = Math.floor(normalized / sliceAngle);
        setSelectedResult(items[index]);
      }
    };

    requestAnimationFrame(animateSpin);
  };

  return (
    <div className="space-y-4 text-center max-w-xs mx-auto">
      <div className="relative inline-block max-w-full">
        <canvas
          ref={canvasRef}
          width={280}
          height={280}
          style={{ borderColor: 'var(--card-border)' }}
          className="rounded-full shadow-lg border-2 max-w-[250px] sm:max-w-[280px] w-full h-auto aspect-square"
        />
        {/* Pointer indicator */}
        <div className="absolute top-1/2 -right-3 -translate-y-1/2 w-0 h-0 border-y-8 border-y-transparent border-r-14 border-r-[var(--accent)] z-10" />
      </div>

      <div>
        <button
          onClick={spin}
          disabled={spinning}
          className="theme-btn-accent min-h-[48px] px-6 py-3 rounded-full text-xs font-bold active:scale-95 disabled:opacity-50 cursor-pointer touch-manipulation"
        >
          {spinning ? 'Spinning with Magic...' : 'Spin the Wheel! ✨'}
        </button>
      </div>

      {selectedResult && (
        <div
          style={{
            backgroundColor: 'var(--card-subtle)',
            borderColor: 'var(--card-border)',
          }}
          className="p-4 rounded-2xl border animate-fade-in shadow-xs"
        >
          <span
            style={{ color: 'var(--accent)' }}
            className="text-[10px] uppercase tracking-widest font-bold block mb-1"
          >
            The Wheel Decided:
          </span>
          <p
            style={{ color: 'var(--text)' }}
            className="font-serif text-lg font-bold"
          >
            "{selectedResult}"
          </p>
        </div>
      )}
    </div>
  );
};

/* =========================================================================
   6. SCRATCH CARD (CANVAS TOUCH SCRATCH)
   ========================================================================= */
const ScratchCardGame: React.FC<{ name: string; isDarkMode: boolean }> = ({ name, isDarkMode }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scratchedPercent, setScratchedPercent] = useState(0);

  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.globalCompositeOperation = 'source-over';
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#d6336c');
    grad.addColorStop(0.5, '#e64980');
    grad.addColorStop(1, '#be4bdb');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 3;
    ctx.fillText('✨ Scratch here with your finger ✨', canvas.width / 2, canvas.height / 2 + 5);

    setScratchedPercent(0);
  };

  useEffect(() => {
    initCanvas();
  }, []);

  const scratch = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();

    setScratchedPercent((p) => Math.min(p + 3, 100));
  };

  return (
    <div className="space-y-4 text-center max-w-xs mx-auto w-full">
      <p
        style={{ color: 'var(--text-soft)' }}
        className="text-xs font-medium"
      >
        Rub the card with your finger to reveal a secret note
      </p>

      <div
        style={{ borderColor: 'var(--card-border)' }}
        className="relative w-full max-w-[280px] sm:max-w-xs h-40 sm:h-44 mx-auto rounded-2xl overflow-hidden shadow-md border-2"
      >
        {/* Hidden Message Layer */}
        <div
          style={{
            backgroundColor: 'var(--card-solid)',
            color: 'var(--text)',
          }}
          className="absolute inset-0 p-4 flex flex-col items-center justify-center text-center"
        >
          <Heart className="w-6 h-6 fill-[var(--accent)] text-[var(--accent)] mb-1 animate-heartbeat" />
          <p
            style={{ color: 'var(--accent)' }}
            className="font-serif text-sm font-bold"
          >
            For {name}
          </p>
          <p
            style={{ color: 'var(--text)' }}
            className="font-script text-lg leading-snug mt-1 font-bold"
          >
            "Behind every mystery, you are the most wonderful thought on my mind."
          </p>
        </div>

        {/* Scratchable Canvas Layer */}
        <canvas
          ref={canvasRef}
          width={288}
          height={176}
          onMouseMove={(e) => e.buttons === 1 && scratch(e.clientX, e.clientY)}
          onTouchMove={(e) => scratch(e.touches[0].clientX, e.touches[0].clientY)}
          className="absolute inset-0 cursor-pointer touch-none w-full h-full"
        />
      </div>

      <button
        onClick={initCanvas}
        style={{
          borderColor: 'var(--card-border)',
          color: 'var(--accent)',
          backgroundColor: 'var(--card-subtle)',
        }}
        className="min-h-[48px] px-6 py-2.5 rounded-full border text-xs font-bold hover:bg-[var(--card-border)] cursor-pointer touch-manipulation"
      >
        Reset Foil
      </button>
    </div>
  );
};

/* =========================================================================
   7. LOVE & FRIENDSHIP METER
   ========================================================================= */
const LoveMeterGame: React.FC<{
  name: string;
  isDarkMode: boolean;
  onUpdateHighScore?: (game: string, score: number) => void;
}> = ({ name, onUpdateHighScore }) => {
  const [percent, setPercent] = useState(0);
  const [calculating, setCalculating] = useState(false);

  const calculate = () => {
    setCalculating(true);
    setPercent(0);
    romanticAudio.playChime();

    let p = 0;
    const timer = setInterval(() => {
      p += 4;
      if (p >= 100) {
        p = 100;
        clearInterval(timer);
        setCalculating(false);
        onUpdateHighScore?.('loveMeter', 100);
      }
      setPercent(p);
    }, 45);
  };

  return (
    <div className="space-y-6 text-center max-w-sm mx-auto py-4">
      <div className="space-y-1">
        <h3
          style={{ color: 'var(--text)' }}
          className="font-serif text-xl font-bold"
        >
          Cosmic Connection Meter
        </h3>
        <p
          style={{ color: 'var(--text-soft)' }}
          className="text-xs font-medium"
        >
          Calculating the harmony between our souls...
        </p>
      </div>

      {/* Animated Circular / Gauge Display */}
      <div className="relative w-40 h-40 mx-auto flex items-center justify-center">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="42"
            style={{ stroke: 'var(--card-subtle)' }}
            className="fill-none stroke-[8]"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            style={{ stroke: 'var(--accent)' }}
            className="fill-none stroke-[8] transition-all duration-100"
            strokeDasharray="264"
            strokeDashoffset={264 - (264 * percent) / 100}
            strokeLinecap="round"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            style={{ color: 'var(--text)' }}
            className="font-serif text-3xl font-bold tabular-nums"
          >
            {percent}%
          </span>
          <span
            style={{ color: 'var(--text-soft)' }}
            className="text-[10px] uppercase font-bold tracking-wider"
          >
            Harmony
          </span>
        </div>
      </div>

      {percent === 100 && (
        <div className="animate-fade-in space-y-1">
          <p
            style={{ color: 'var(--accent)' }}
            className="font-serif text-sm font-bold"
          >
            Celestial Match: 100% Unconditional!
          </p>
          <p
            style={{ color: 'var(--text)' }}
            className="text-xs italic font-medium"
          >
            "Both mathematics and destiny agree: you are completely treasured."
          </p>
        </div>
      )}

      <button
        onClick={calculate}
        disabled={calculating}
        className="theme-btn-accent min-h-[44px] px-6 py-2.5 rounded-full text-xs font-bold active:scale-95 disabled:opacity-50 cursor-pointer"
      >
        {calculating ? 'Analyzing Stars...' : 'Calculate Connection 💕'}
      </button>
    </div>
  );
};

/* =========================================================================
   8. TRUTH OR DARE (SWEET & HARMLESS)
   ========================================================================= */
const TruthOrDareGame: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => {
  const [current, setCurrent] = useState<{ type: 'Truth' | 'Dare'; text: string } | null>(null);

  const truths = [
    "What was your first impression of me?",
    "What is the one thing that always makes you smile?",
    "If we could go anywhere right now, where would it be?",
    "What is your favorite memory of us talking?",
    "What is a song that reminds you of me?",
    "What is your favorite quality in a person?",
  ];

  const dares = [
    "Send me a voice note saying 'Good Morning'!",
    "Tell me a joke that will make me laugh.",
    "Choose a song for me to listen to right now.",
    "Describe me using only three emojis.",
    "Send me the last photo you took (if it's not too private!).",
    "Tell me one thing you've never told anyone else.",
  ];

  const pick = (type: 'Truth' | 'Dare') => {
    const list = type === 'Truth' ? truths : dares;
    const text = list[Math.floor(Math.random() * list.length)];
    setCurrent({ type, text });
    romanticAudio.playChime();
  };

  return (
    <div className="space-y-6 text-center max-w-sm mx-auto py-4">
      <div className="space-y-1">
        <h3
          style={{ color: 'var(--text)' }}
          className="font-serif text-xl font-bold"
        >
          Truth or Dare
        </h3>
        <p
          style={{ color: 'var(--text-soft)' }}
          className="text-xs font-medium"
        >
          Pick a side for a sweet surprise!
        </p>
      </div>

      {!current ? (
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => pick('Truth')}
            className="h-32 rounded-3xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-[#1a0f2b] flex flex-col items-center justify-center gap-2 hover:border-rose-400 transition-all cursor-pointer shadow-sm group"
          >
            <HelpCircle className="w-8 h-8 text-rose-500 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-rose-600 dark:text-rose-400">Truth</span>
          </button>
          <button
            onClick={() => pick('Dare')}
            className="h-32 rounded-3xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-[#1a0f2b] flex flex-col items-center justify-center gap-2 hover:border-rose-400 transition-all cursor-pointer shadow-sm group"
          >
            <Flame className="w-8 h-8 text-rose-500 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-rose-600 dark:text-rose-400">Dare</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4 animate-scale-up">
          <div
            style={{
              backgroundColor: 'var(--card-subtle)',
              borderColor: 'var(--card-border)',
            }}
            className="p-6 rounded-3xl border-2 shadow-sm"
          >
            <span
              style={{ color: 'var(--accent)' }}
              className="text-[10px] uppercase tracking-widest font-bold block mb-2"
            >
              {current.type} Challenge:
            </span>
            <p
              style={{ color: 'var(--text)' }}
              className="font-serif text-lg font-bold leading-relaxed"
            >
              "{current.text}"
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrent(null)}
              className="flex-1 theme-btn-accent min-h-[44px] rounded-full text-xs font-bold cursor-pointer"
            >
              Done! ✨
            </button>
            <button
              onClick={() => pick(current.type)}
              className="flex-1 min-h-[44px] rounded-full border border-[var(--card-border)] text-[var(--text)] text-xs font-bold hover:bg-[var(--card-subtle)] cursor-pointer"
            >
              New One
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
