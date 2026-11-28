import type React from 'react';
import { flushSync } from 'react-dom';

export type AppThemeId = 'default' | 'glass' | 'liquid-glass' | 'light' | 'pastel';

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
      if (saved === 'liquid-glass') return 'liquid-glass';
      if (saved === 'glass') return 'glass';
      if (saved === 'light') return 'light';
      if (saved === 'pastel') return 'pastel';
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
    root.style.colorScheme = theme === 'light' || theme === 'pastel' ? 'light' : 'dark';
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      const colorMap: Record<AppThemeId, string> = {
        default: '#140c1e',
        glass: '#070312',
        'liquid-glass': '#030d1e',
        light: '#fff5f8',
        pastel: '#F8F5FF',
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
