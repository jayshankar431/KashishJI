import React from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Palette, Sparkles, Check, Moon, Sun, Layers, X, Heart } from 'lucide-react';
import { romanticAudio } from '../audio';
import { triggerHaptic, logNativeActivity } from '../androidBridge';

export type AppThemeId = 'default' | 'glass' | 'light';
export type ThemeOriginSource =
  | React.MouseEvent<HTMLElement>
  | HTMLElement
  | { x: number; y: number }
  | null
  | undefined;

export function getSavedTheme(): AppThemeId {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem('kashishTheme');
      if (saved === 'glass') return 'glass';
      if (saved === 'light') return 'light';
      if (saved === 'default' || saved === 'dark') return 'default';
    }
  } catch {
    // Safe fallback if localStorage is blocked or unavailable
  }
  return 'default';
}

export function applyThemeToDocument(theme: AppThemeId): void {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      const colorMap: Record<AppThemeId, string> = {
        default: '#140c1e',
        glass: '#070312',
        light: '#fff5f8',
      };
      metaThemeColor.setAttribute('content', colorMap[theme] || '#140c1e');
    }
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('kashishTheme', theme);
    }
  } catch {
    // Safe fallback if localStorage is blocked
  }
}

interface ViewTransitionHandle {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition: () => void;
}

let activeViewTransition: ViewTransitionHandle | null = null;
let fallbackSmoothTimer: number | null = null;

function resolveOriginCoordinates(origin?: ThemeOriginSource): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 0, y: 0 };

  if (origin && typeof origin === 'object') {
    if ('clientX' in origin && typeof origin.clientX === 'number') {
      // Keyboard activation on a button fires clientX=0, clientY=0; use element center in that case
      if (origin.clientX === 0 && origin.clientY === 0 && origin.currentTarget) {
        const rect = origin.currentTarget.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      return { x: origin.clientX, y: origin.clientY };
    }
    if ('getBoundingClientRect' in origin && typeof origin.getBoundingClientRect === 'function') {
      const rect = origin.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    if ('x' in origin && 'y' in origin && typeof origin.x === 'number' && typeof origin.y === 'number') {
      return { x: origin.x, y: origin.y };
    }
  }

  const toggleBtn = document.getElementById('kashish-theme-toggle-btn');
  if (toggleBtn) {
    const rect = toggleBtn.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }

  return { x: Math.max(24, window.innerWidth - 48), y: 28 };
}

/**
 * Coordinates a Telegram-style circular reveal (when View Transitions API is supported)
 * or a synchronized 280ms color crossfade fallback. Handles rapid repeated toggles cleanly
 * and respects prefers-reduced-motion.
 */
export function transitionThemeChange(
  nextTheme: AppThemeId,
  onStateUpdate: (theme: AppThemeId) => void,
  origin?: ThemeOriginSource
): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    applyThemeToDocument(nextTheme);
    onStateUpdate(nextTheme);
    return;
  }

  const root = document.documentElement;
  const currentAttr = root.getAttribute('data-theme') as AppThemeId | null;
  if (currentAttr === nextTheme) {
    applyThemeToDocument(nextTheme);
    onStateUpdate(nextTheme);
    return;
  }

  // Cancel any in-flight transition cleanly so rapid toggles never get stuck
  if (activeViewTransition) {
    try {
      activeViewTransition.skipTransition();
    } catch {}
    activeViewTransition = null;
  }
  if (fallbackSmoothTimer !== null) {
    window.clearTimeout(fallbackSmoothTimer);
    fallbackSmoothTimer = null;
  }

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    root.removeAttribute('data-theme-vt');
    root.removeAttribute('data-theme-transition');
    applyThemeToDocument(nextTheme);
    onStateUpdate(nextTheme);
    return;
  }

  const docWithVT = document as Document & {
    startViewTransition?: (callback: () => void) => ViewTransitionHandle;
  };

  if (typeof docWithVT.startViewTransition === 'function') {
    const { x, y } = resolveOriginCoordinates(origin);
    const maxRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    root.setAttribute('data-theme-vt', 'active');
    root.removeAttribute('data-theme-transition');

    try {
      const vt = docWithVT.startViewTransition(() => {
        flushSync(() => {
          applyThemeToDocument(nextTheme);
          onStateUpdate(nextTheme);
        });
      });

      activeViewTransition = vt;

      vt.ready
        .then(() => {
          root.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${Math.ceil(maxRadius)}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 300,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              pseudoElement: '::view-transition-new(root)',
            }
          );
        })
        .catch(() => {
          // Safe ignore if transition was skipped by a rapid toggle
        });

      vt.finished
        .finally(() => {
          if (activeViewTransition === vt) {
            activeViewTransition = null;
            root.removeAttribute('data-theme-vt');
          }
        })
        .catch(() => {});

      return;
    } catch {
      root.removeAttribute('data-theme-vt');
    }
  }

  // Fallback: coordinated smooth CSS variable crossfade
  root.setAttribute('data-theme-transition', 'smooth');
  applyThemeToDocument(nextTheme);
  onStateUpdate(nextTheme);

  fallbackSmoothTimer = window.setTimeout(() => {
    root.removeAttribute('data-theme-transition');
    fallbackSmoothTimer = null;
  }, 320);
}

interface ThemeSectionProps {
  currentTheme: AppThemeId;
  onSelectTheme: (theme: AppThemeId, origin?: ThemeOriginSource) => void;
  recipientName?: string;
  compact?: boolean;
}

export const ThemeSection: React.FC<ThemeSectionProps> = ({
  currentTheme,
  onSelectTheme,
  recipientName = 'Kashish',
  compact = false,
}) => {
  const handleSelect = (
    theme: AppThemeId,
    label: string,
    origin?: ThemeOriginSource
  ) => {
    triggerHaptic(35);
    romanticAudio.playChime();
    onSelectTheme(theme, origin);
    void logNativeActivity(`🎨 ${recipientName} switched app theme to <b>${label}</b>`);
  };

  const themes: Array<{
    id: AppThemeId;
    title: string;
    badge: string;
    subtitle: string;
    icon: React.FC<{ className?: string }>;
    previewBg: string;
    previewCardBg: string;
    previewCardBorder: string;
    previewText: string;
    previewSubtext: string;
    previewAccent: string;
    isGlass?: boolean;
  }> = [
    {
      id: 'default',
      title: 'Default',
      badge: 'Current Look',
      subtitle: 'Deep romantic night diary with warm rose-gold & neon pink accents.',
      icon: Moon,
      previewBg: 'linear-gradient(145deg, #140c1e 0%, #24112b 60%, #1a0d1f 100%)',
      previewCardBg: 'rgba(30, 16, 46, 0.94)',
      previewCardBorder: 'rgba(244, 114, 182, 0.35)',
      previewText: '#fdf2f4',
      previewSubtext: '#f9a8d4',
      previewAccent: '#f43f5e',
    },
    {
      id: 'glass',
      title: 'Glassmorphism',
      badge: 'New · Dark Frosted Glass ✨',
      subtitle: 'Deep dark midnight background with ultra-frosted smoked crystal glass cards & glowing orbs.',
      icon: Layers,
      previewBg:
        'radial-gradient(circle at 22% 24%, rgba(244, 63, 94, 0.65) 0%, transparent 45%), radial-gradient(circle at 78% 72%, rgba(59, 130, 246, 0.6) 0%, transparent 48%), linear-gradient(135deg, #070312 0%, #090f26 45%, #190624 100%)',
      previewCardBg: 'rgba(18, 9, 36, 0.52)',
      previewCardBorder: 'rgba(255, 255, 255, 0.32)',
      previewText: '#ffffff',
      previewSubtext: 'rgba(244, 230, 255, 0.92)',
      previewAccent: '#ff4d79',
      isGlass: true,
    },
    {
      id: 'light',
      title: 'Soft Blush',
      badge: 'Daylight',
      subtitle: 'Gentle sakura pink & warm ivory daylight look with crisp berry typography.',
      icon: Sun,
      previewBg: 'linear-gradient(145deg, #fff5f8 0%, #ffe4ee 60%, #fff0f5 100%)',
      previewCardBg: 'rgba(255, 255, 255, 0.95)',
      previewCardBorder: '#f3c6d6',
      previewText: '#3a1226',
      previewSubtext: '#6b3a52',
      previewAccent: '#d6336c',
    },
  ];

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6 animate-fade-in pb-10'}>
      {/* Header Banner */}
      <section
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--card-border)',
          boxShadow: '0 8px 28px var(--shadow-color)',
        }}
        className="rounded-3xl p-5 sm:p-7 border text-center space-y-2 relative overflow-hidden"
      >
        <div
          style={{
            backgroundColor: 'var(--card-subtle)',
            borderColor: 'var(--card-border)',
            color: 'var(--accent)',
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold border"
        >
          <Palette className="w-3.5 h-3.5" />
          <span>Theme & Appearance</span>
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
        </div>

        <h2
          style={{ color: 'var(--text)' }}
          className="font-serif text-2xl sm:text-3xl font-bold tracking-tight"
        >
          Choose Your World&apos;s Look
        </h2>

        <p
          style={{ color: 'var(--text-soft)' }}
          className="text-xs sm:text-sm max-w-lg mx-auto font-medium leading-relaxed"
        >
          Tap any theme card below to switch instantly. Your favourite look is automatically saved on your phone.
        </p>
      </section>

      {/* Theme Preview Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {themes.map((t) => {
          const Icon = t.icon;
          const isSelected = currentTheme === t.id;

          return (
            <button
              key={t.id}
              type="button"
              onClick={(e) => handleSelect(t.id, t.title, e)}
              aria-pressed={isSelected}
              style={{
                backgroundColor: 'var(--card)',
                borderColor: isSelected ? 'var(--accent)' : 'var(--card-border)',
                boxShadow: isSelected
                  ? '0 10px 30px rgba(244, 63, 94, 0.28), 0 0 0 2px var(--accent)'
                  : '0 6px 20px var(--shadow-color)',
              }}
              className="group text-left rounded-3xl p-4 sm:p-5 border transition-colors duration-300 flex flex-col justify-between gap-4 cursor-pointer active:scale-[0.98] hover:scale-[1.01] w-full"
            >
              {/* Visual Theme Preview Miniature */}
              <div
                style={{ background: t.previewBg }}
                className="relative w-full h-36 sm:h-40 rounded-2xl p-3.5 overflow-hidden border border-white/20 flex flex-col justify-between shadow-inner"
              >
                {/* Decorative glowing orbs inside Glassmorphism preview */}
                {t.isGlass && (
                  <>
                    <div
                      className="absolute -top-6 -left-6 w-24 h-24 rounded-full pointer-events-none"
                      style={{
                        background: 'radial-gradient(circle, rgba(244,63,94,0.75) 0%, transparent 70%)',
                        filter: 'blur(12px)',
                      }}
                    />
                    <div
                      className="absolute -bottom-6 -right-6 w-28 h-28 rounded-full pointer-events-none"
                      style={{
                        background: 'radial-gradient(circle, rgba(59,130,246,0.75) 0%, transparent 70%)',
                        filter: 'blur(12px)',
                      }}
                    />
                  </>
                )}

                {/* Mini Top Navbar Mockup */}
                <div
                  style={{
                    backgroundColor: t.previewCardBg,
                    borderColor: t.previewCardBorder,
                    backdropFilter: t.isGlass ? 'blur(12px) saturate(160%)' : undefined,
                    WebkitBackdropFilter: t.isGlass ? 'blur(12px) saturate(160%)' : undefined,
                  }}
                  className="relative z-10 rounded-xl px-3 py-1.5 border flex items-center justify-between"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      style={{ backgroundColor: t.previewAccent }}
                      className="w-2.5 h-2.5 rounded-full inline-block"
                    />
                    <span
                      style={{ color: t.previewText }}
                      className="text-[10px] font-bold tracking-wide"
                    >
                      {recipientName}&apos;s World
                    </span>
                  </div>
                  <span
                    style={{
                      backgroundColor: t.previewAccent,
                      color: '#ffffff',
                    }}
                    className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                  >
                    {t.badge}
                  </span>
                </div>

                {/* Mini Content Card Mockup */}
                <div
                  style={{
                    backgroundColor: t.previewCardBg,
                    borderColor: t.previewCardBorder,
                    backdropFilter: t.isGlass ? 'blur(14px) saturate(160%)' : undefined,
                    WebkitBackdropFilter: t.isGlass ? 'blur(14px) saturate(160%)' : undefined,
                  }}
                  className="relative z-10 rounded-xl p-2.5 border space-y-1.5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-1 flex-1">
                      <div
                        style={{ backgroundColor: t.previewText, opacity: 0.9 }}
                        className="h-2 w-24 rounded-full"
                      />
                      <div
                        style={{ backgroundColor: t.previewSubtext, opacity: 0.7 }}
                        className="h-1.5 w-32 rounded-full"
                      />
                    </div>
                    <div
                      style={{ backgroundColor: t.previewAccent }}
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-white shadow-xs shrink-0"
                    >
                      <Heart className="w-3.5 h-3.5 fill-white" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Theme Info & Active Status */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      style={{
                        backgroundColor: 'var(--card-subtle)',
                        borderColor: 'var(--card-border)',
                        color: 'var(--accent)',
                      }}
                      className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0"
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3
                        style={{ color: 'var(--text)' }}
                        className="font-serif text-lg font-bold leading-tight"
                      >
                        {t.title}
                      </h3>
                      <span
                        style={{ color: 'var(--accent)' }}
                        className="text-[11px] font-bold"
                      >
                        {t.badge}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: isSelected ? 'var(--accent)' : 'var(--card-subtle)',
                      borderColor: isSelected ? 'var(--accent)' : 'var(--card-border)',
                      color: isSelected ? '#ffffff' : 'var(--text-soft)',
                    }}
                    className="px-3 py-1.5 rounded-full border text-xs font-bold flex items-center gap-1 shrink-0 transition-all"
                  >
                    {isSelected ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Active</span>
                      </>
                    ) : (
                      <span>Apply</span>
                    )}
                  </div>
                </div>

                <p
                  style={{ color: 'var(--text-soft)' }}
                  className="text-xs leading-relaxed font-medium"
                >
                  {t.subtitle}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Live Interactive Glass & Theme Preview Bar */}
      {!compact && (
        <section
          style={{
            backgroundColor: 'var(--card)',
            borderColor: 'var(--card-border)',
            boxShadow: '0 6px 24px var(--shadow-color)',
          }}
          className="rounded-3xl p-5 sm:p-6 border space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3
                style={{ color: 'var(--text)' }}
                className="font-serif text-lg sm:text-xl font-bold flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Live Theme Elements Preview</span>
              </h3>
              <p
                style={{ color: 'var(--text-soft)' }}
                className="text-xs font-medium"
              >
                Cards, inputs, dropdowns, and buttons automatically adapt to your selected theme.
              </p>
            </div>
            <span
              style={{
                backgroundColor: 'var(--card-subtle)',
                borderColor: 'var(--card-border)',
                color: 'var(--text)',
              }}
              className="self-start sm:self-auto px-3 py-1 rounded-full border text-xs font-bold"
            >
              Active: {currentTheme === 'glass' ? 'Glassmorphism ✨' : currentTheme === 'light' ? 'Soft Blush ☀️' : 'Default 🌙'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              readOnly
              value={`✨ ${recipientName}'s Glass Input`}
              aria-label="Theme input preview"
              style={{
                backgroundColor: 'var(--card-subtle)',
                borderColor: 'var(--card-border)',
                color: 'var(--text)',
              }}
              className="w-full px-4 py-2.5 rounded-2xl border text-xs sm:text-sm font-semibold focus:outline-none"
            />

            <select
              aria-label="Theme dropdown preview"
              value={currentTheme}
              onChange={(e) => {
                const next = e.target.value as AppThemeId;
                handleSelect(
                  next,
                  next === 'glass' ? 'Glassmorphism' : next === 'light' ? 'Soft Blush' : 'Default',
                  e.currentTarget
                );
              }}
              style={{
                backgroundColor: 'var(--card-subtle)',
                borderColor: 'var(--card-border)',
                color: 'var(--text)',
              }}
              className="w-full px-4 py-2.5 rounded-2xl border text-xs sm:text-sm font-semibold cursor-pointer focus:outline-none"
            >
              <option value="default">🌙 Default Theme (Current Look)</option>
              <option value="glass">✨ Glassmorphism Theme (Frosted Glass)</option>
              <option value="light">☀️ Soft Blush Theme (Daylight)</option>
            </select>

            <button
              type="button"
              onClick={(e) =>
                handleSelect(
                  currentTheme === 'glass' ? 'default' : 'glass',
                  currentTheme === 'glass' ? 'Default' : 'Glassmorphism',
                  e
                )
              }
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--accent-text)',
              }}
              className="w-full px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              <Palette className="w-4 h-4" />
              <span>
                {currentTheme === 'glass' ? 'Switch to Default' : 'Try Glassmorphism ✨'}
              </span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

interface ThemeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: AppThemeId;
  onSelectTheme: (theme: AppThemeId, origin?: ThemeOriginSource) => void;
  recipientName?: string;
}

export const ThemeModal: React.FC<ThemeModalProps> = ({
  isOpen,
  onClose,
  currentTheme,
  onSelectTheme,
  recipientName = 'Kashish',
}) => {
  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1400] bg-black/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--card-solid)',
          borderColor: 'var(--card-border)',
          color: 'var(--text)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.55)',
        }}
        className="glass-surface relative w-full max-w-3xl rounded-3xl border p-4 sm:p-6 max-h-[90dvh] overflow-y-auto space-y-4 my-auto"
      >
        <div className="flex items-center justify-between border-b border-[var(--card-border)] pb-3">
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-[var(--accent)]" />
            <h3 className="font-serif text-xl sm:text-2xl font-bold">
              Theme Settings
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Theme Settings"
            style={{
              backgroundColor: 'var(--card-subtle)',
              borderColor: 'var(--card-border)',
              color: 'var(--text)',
            }}
            className="min-h-[40px] min-w-[40px] p-2 rounded-full border flex items-center justify-center cursor-pointer active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <ThemeSection
          currentTheme={currentTheme}
          onSelectTheme={onSelectTheme}
          recipientName={recipientName}
          compact
        />
      </div>
    </div>,
    document.body
  );
};
