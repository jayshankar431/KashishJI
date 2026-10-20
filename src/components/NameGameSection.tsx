import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { romanticAudio } from '../audio';
import { DynamicSlot } from './DynamicSlot';
import { useSite, DEFAULT_NAME_MEANINGS } from '../siteContent';

interface NameGameSectionProps {
  name: string;
  isDarkMode: boolean;
}

export const NameGameSection: React.FC<NameGameSectionProps> = ({ name, isDarkMode }) => {
  const site = useSite();
  const letterAttributes =
    site.nameMeanings && site.nameMeanings.length > 0 ? site.nameMeanings : DEFAULT_NAME_MEANINGS;


  const [revealed, setRevealed] = useState<{ [key: number]: boolean }>({});

  const toggleLetter = (idx: number) => {
    romanticAudio.playChime();
    setRevealed((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const revealAll = () => {
    romanticAudio.playChime();
    const all: { [key: number]: boolean } = {};
    letterAttributes.forEach((_, i) => (all[i] = true));
    setRevealed(all);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12 max-w-xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-1">
        <h2
          style={{ color: 'var(--text)' }}
          className="font-serif text-3xl sm:text-4xl font-bold flex items-center justify-center gap-2"
        >
          <Sparkles className="w-6 h-6 text-amber-500" />
          <span>The Name Game</span>
        </h2>
        <p
          style={{ color: 'var(--text-soft)' }}
          className="text-xs sm:text-sm italic font-medium"
        >
          "Tap each letter of your name to reveal what you mean to the world."
        </p>
      </div>

      {/* Letters List */}
      <div className="space-y-3">
        {letterAttributes.map((item, idx) => {
          const isOpened = !!revealed[idx];

          return (
            <div
              key={idx}
              onClick={() => toggleLetter(idx)}
              style={{
                backgroundColor: isOpened ? 'var(--card-subtle)' : 'var(--card-solid)',
                borderColor: isOpened ? 'var(--accent)' : 'var(--card-border)',
                boxShadow: '0 4px 14px var(--shadow-color)',
              }}
              className="p-4 sm:p-5 rounded-2xl border transition-all duration-200 cursor-pointer select-none min-h-[56px] flex items-start gap-4 active:scale-[0.99] hover:border-[var(--accent)]"
            >
              {/* Big Letter Icon */}
              <div
                style={{
                  backgroundColor: isOpened ? 'var(--accent)' : 'var(--card-subtle)',
                  color: isOpened ? 'var(--accent-text)' : 'var(--accent)',
                  borderColor: 'var(--card-border)',
                }}
                className="w-12 h-12 rounded-xl border flex items-center justify-center font-serif text-2xl font-bold shrink-0 transition-transform shadow-xs"
              >
                {item.char}
              </div>

              {/* Reveal text */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3
                    style={{ color: 'var(--text)' }}
                    className="font-sans font-bold text-base sm:text-lg"
                  >
                    {isOpened ? item.title : `Letter ${item.char} · Tap to reveal`}
                  </h3>
                  {isOpened && <Sparkles className="w-4 h-4 text-amber-500 animate-sparkle" />}
                </div>

                <p
                  style={{ color: isOpened ? 'var(--text)' : 'var(--text-soft)' }}
                  className="text-xs sm:text-sm leading-relaxed font-semibold"
                >
                  {isOpened ? item.desc : 'Touch to uncover this golden quality...'}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-center pt-2">
        <button
          onClick={revealAll}
          style={{
            borderColor: 'var(--card-border)',
            color: 'var(--accent)',
            backgroundColor: 'var(--card-subtle)',
          }}
          className="min-h-[44px] px-6 py-2.5 rounded-full border text-xs font-bold hover:bg-[var(--card-border)] cursor-pointer"
        >
          Reveal All Letters ✨
        </button>
      </div>

      {/* Dynamic Slot: Name Game Bottom */}
      <DynamicSlot slotId="name_game_bottom" isDarkMode={isDarkMode} />
    </div>
  );
};
