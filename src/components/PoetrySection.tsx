import React, { useState, useEffect } from 'react';
import { Feather, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { romanticAudio } from '../audio';
import { useSite } from '../siteContent';
import { DynamicSlot } from './DynamicSlot';

interface PoetrySectionProps {
  name: string;
  isDarkMode: boolean;
}

export const PoetrySection: React.FC<PoetrySectionProps> = ({ name, isDarkMode }) => {
  const site = useSite();
  const poems = site.poems.map((p) => ({
    title: p.title,
    lines: p.lines.map((l) => l.split('{name}').join(name)),
  }));

  const [activePoemIdx, setActivePoemIdx] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  const safeIdx = Math.min(activePoemIdx, Math.max(0, poems.length - 1));
  const fullText = (poems[safeIdx]?.lines || []).join('\n');

  useEffect(() => {
    setDisplayedText('');
    setIsTyping(true);
    let index = 0;

    const timer = setInterval(() => {
      index++;
      setDisplayedText(fullText.slice(0, index));
      if (index >= fullText.length) {
        clearInterval(timer);
        setIsTyping(false);
      }
    }, 35);

    return () => clearInterval(timer);
  }, [activePoemIdx, fullText]);

  const nextPoem = () => {
    romanticAudio.playChime();
    setActivePoemIdx((activePoemIdx + 1) % poems.length);
  };

  const prevPoem = () => {
    romanticAudio.playChime();
    setActivePoemIdx((activePoemIdx - 1 + poems.length) % poems.length);
  };

  const replay = () => {
    romanticAudio.playChime();
    setDisplayedText('');
    setIsTyping(true);
    let index = 0;
    const timer = setInterval(() => {
      index++;
      setDisplayedText(fullText.slice(0, index));
      if (index >= fullText.length) {
        clearInterval(timer);
        setIsTyping(false);
      }
    }, 35);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12 max-w-xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-1">
        <h2
          style={{ color: 'var(--text)' }}
          className="font-serif text-3xl sm:text-4xl font-bold flex items-center justify-center gap-2"
        >
          <Feather className="w-6 h-6 text-[var(--accent)]" />
          <span>Poetry Corner</span>
        </h2>
        <p
          style={{ color: 'var(--text-soft)' }}
          className="text-xs sm:text-sm italic font-medium"
        >
          "Words woven softly from the quiet corners of the heart."
        </p>
      </div>

      {/* Poem Selector Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none justify-center">
        {poems.map((poem, i) => (
          <button
            key={i}
            onClick={() => setActivePoemIdx(i)}
            style={{
              backgroundColor: activePoemIdx === i ? 'var(--accent)' : 'var(--card)',
              color: activePoemIdx === i ? 'var(--accent-text)' : 'var(--text)',
              borderColor: 'var(--card-border)',
              boxShadow: activePoemIdx === i ? '0 4px 12px rgba(214, 51, 108, 0.3)' : 'none',
            }}
            className="min-h-[48px] px-4 py-2.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border cursor-pointer touch-manipulation"
          >
            Poem {i + 1}
          </button>
        ))}
      </div>

      {/* Parchment Poem Card */}
      <div
        style={{
          backgroundColor: 'var(--card-solid)',
          borderColor: 'var(--card-border)',
          boxShadow: '0 8px 30px var(--shadow-color)',
        }}
        className="relative p-5 sm:p-10 rounded-3xl border transition-all min-h-[340px] flex flex-col justify-between overflow-hidden"
      >
        <div className="space-y-4">
          <h3
            style={{ color: 'var(--accent)' }}
            className="font-serif text-2xl sm:text-3xl font-bold tracking-wide"
          >
            {poems[safeIdx]?.title}
          </h3>

          {/* Lines in clean Poppins 600 for exceptional legibility */}
          <div
            style={{ color: 'var(--text)' }}
            className="font-sans font-semibold text-base sm:text-lg leading-relaxed whitespace-pre-line tracking-wide"
          >
            {displayedText}
            {isTyping && <span className="inline-block w-1.5 h-5 bg-[var(--accent)] ml-1 animate-pulse" />}
          </div>
        </div>

        {/* Bottom Poem Controls */}
        <div
          style={{ borderColor: 'var(--card-border)' }}
          className="flex items-center justify-between pt-6 border-t mt-6 gap-2"
        >
          <div className="flex items-center gap-2">
            <button
              onClick={prevPoem}
              aria-label="Previous poem"
              style={{
                backgroundColor: 'var(--card-subtle)',
                color: 'var(--text)',
                borderColor: 'var(--card-border)',
              }}
              className="min-h-[48px] min-w-[48px] rounded-full border flex items-center justify-center cursor-pointer hover:border-[var(--accent)] touch-manipulation"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={nextPoem}
              aria-label="Next poem"
              style={{
                backgroundColor: 'var(--card-subtle)',
                color: 'var(--text)',
                borderColor: 'var(--card-border)',
              }}
              className="min-h-[48px] min-w-[48px] rounded-full border flex items-center justify-center cursor-pointer hover:border-[var(--accent)] touch-manipulation"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <button
            onClick={replay}
            style={{
              backgroundColor: 'var(--card-subtle)',
              color: 'var(--accent)',
              borderColor: 'var(--card-border)',
            }}
            className="min-h-[48px] px-4 py-2.5 rounded-full border text-xs font-bold hover:bg-[var(--card-border)] flex items-center gap-1.5 cursor-pointer touch-manipulation"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Replay Typing</span>
          </button>
        </div>
      </div>

      {/* Dynamic Slot: Poetry Bottom */}
      <DynamicSlot slotId="poetry_bottom" isDarkMode={isDarkMode} />
    </div>
  );
};
