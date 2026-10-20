import React, { useState } from 'react';
import { Heart, Sparkles } from 'lucide-react';
import { romanticAudio } from '../audio';
import { triggerHaptic } from '../androidBridge';
import { DynamicSlot } from './DynamicSlot';

interface LastPageSectionProps {
  name: string;
  personalMessage: string;
  isDarkMode: boolean;
}

export const LastPageSection: React.FC<LastPageSectionProps> = ({
  name,
  personalMessage,
  isDarkMode,
}) => {
  const [heartCount, setHeartCount] = useState(0);
  const [burstHearts, setBurstHearts] = useState<{ id: number; x: number; y: number }[]>([]);

  const handleHeartTap = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (typeof window !== 'undefined' && window.AndroidApp?.vibrate) {
      window.AndroidApp.vibrate(40);
    } else {
      triggerHaptic(40);
    }

    if (typeof window !== 'undefined' && window.AndroidApp?.logActivity) {
      window.AndroidApp.logActivity("💖 Kashish tapped the Special Heart button!");
    }

    romanticAudio.playChime();
    setHeartCount((c) => c + 1);

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newHearts = Array.from({ length: 6 }).map(() => ({
      id: Math.random(),
      x: x + (Math.random() - 0.5) * 60,
      y: y + (Math.random() - 0.5) * 60,
    }));

    setBurstHearts((prev) => [...prev, ...newHearts]);

    setTimeout(() => {
      setBurstHearts((prev) => prev.slice(6));
    }, 1000);
  };

  return (
    <div className="space-y-8 animate-fade-in pb-16 max-w-xl mx-auto text-center">
      {/* Big Glowing Pulsating Heart */}
      <div className="relative py-6">
        <button
          onClick={handleHeartTap}
          aria-label="Tap to send warm hearts"
          className="group relative inline-flex items-center justify-center p-6 rounded-full transition-transform active:scale-90 cursor-pointer"
        >
          {/* Glowing halo */}
          <div
            style={{ backgroundColor: 'rgba(214, 51, 108, 0.25)' }}
            className="absolute inset-0 rounded-full blur-2xl animate-pulse"
          />

          {/* Heart icon */}
          <div
            style={{
              backgroundColor: 'var(--accent)',
              boxShadow: '0 10px 30px rgba(214, 51, 108, 0.45)',
            }}
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full flex items-center justify-center animate-heartbeat border-4 border-white/60"
          >
            <Heart className="w-12 h-12 sm:w-14 sm:h-14 text-white fill-white" />
          </div>

          {/* Heart burst floating particles */}
          {burstHearts.map((h) => (
            <div
              key={h.id}
              style={{ left: `${h.x}px`, top: `${h.y}px`, color: 'var(--accent)' }}
              className="absolute pointer-events-none animate-float"
            >
              <Heart className="w-5 h-5 fill-[var(--accent)] drop-shadow-sm" />
            </div>
          ))}
        </button>

        <p
          style={{ color: 'var(--accent)' }}
          className="text-xs mt-2 font-bold"
        >
          {heartCount > 0 ? `${heartCount} sweet heartbeats sent!` : 'Tap the glowing heart to send warm wishes'}
        </p>
      </div>

      {/* Title & Touching Message */}
      <div className="space-y-3">
        <h2
          style={{ color: 'var(--text)' }}
          className="font-serif text-3xl sm:text-5xl font-bold leading-tight"
        >
          Thank you for being you, {name}.
        </h2>
        <p
          style={{ color: 'var(--text)' }}
          className="font-serif text-2xl sm:text-3xl font-bold leading-relaxed"
        >
          "In a world where you can be anything, you chose to be kind, gentle, and utterly unforgettable."
        </p>
      </div>

      {/* Heartfelt card */}
      <div
        style={{
          backgroundColor: 'var(--card-solid)',
          borderColor: 'var(--card-border)',
          boxShadow: '0 8px 30px var(--shadow-color)',
        }}
        className="p-6 sm:p-8 rounded-3xl border text-left space-y-4 shadow-lg"
      >
        <div
          style={{ borderColor: 'var(--card-border)' }}
          className="flex items-center gap-2 border-b pb-3"
        >
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span
            style={{ color: 'var(--text)' }}
            className="font-sans text-sm font-bold"
          >
            A Forever Reminder
          </span>
        </div>

        <p
          style={{ color: 'var(--text)' }}
          className="text-sm sm:text-base leading-relaxed font-sans font-semibold"
        >
          Wherever your footsteps take you, whatever milestones you chase, know that there is someone who will always look at you with quiet admiration and genuine warmth.
        </p>

        <p
          style={{ color: 'var(--text-soft)' }}
          className="text-sm sm:text-base leading-relaxed font-sans font-semibold"
        >
          Never let the world harden the tenderness in your smile. You are one of the rare ones.
        </p>

        <div className="pt-2 text-right">
          <span
            style={{ color: 'var(--accent)' }}
            className="font-serif text-2xl sm:text-3xl font-bold"
          >
            With endless warmth & smiles ✨
          </span>
        </div>
      </div>

      {/* Dynamic Slot: Last Page Bottom */}
      <DynamicSlot slotId="last_page_bottom" isDarkMode={isDarkMode} />
    </div>
  );
};
