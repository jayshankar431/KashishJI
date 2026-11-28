export type PerfTier = 'low' | 'high';

/**
 * Crisp GPU-composited liquid spring physics for modals, drawers, tabs, and cards.
 */
export const LIQUID_SPRING = {
  type: 'spring' as const,
  stiffness: 320,
  damping: 28,
  mass: 0.8,
};

let cachedPerfTier: PerfTier | null = null;

/**
 * Detects device performance tier once at startup and stamps
 * `document.documentElement.dataset.perf` to `"low"` or `"high"`.
 */
export function detectAndApplyPerfTier(): PerfTier {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'high';
  }

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const cores =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : undefined;

  const deviceMemory =
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === 'number'
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined;

  const isLow =
    prefersReducedMotion ||
    (cores !== undefined && cores > 0 && cores <= 4) ||
    (deviceMemory !== undefined && deviceMemory > 0 && deviceMemory <= 4);

  const tier: PerfTier = isLow ? 'low' : 'high';
  cachedPerfTier = tier;
  document.documentElement.dataset.perf = tier;
  return tier;
}

export function getPerfTier(): PerfTier {
  if (cachedPerfTier) return cachedPerfTier;
  if (typeof document !== 'undefined') {
    const existing = document.documentElement.dataset.perf;
    if (existing === 'low' || existing === 'high') {
      cachedPerfTier = existing;
      return existing;
    }
  }
  return detectAndApplyPerfTier();
}

export function isLowPerfDevice(): boolean {
  return getPerfTier() === 'low';
}
