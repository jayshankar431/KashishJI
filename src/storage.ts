/**
 * Storage Controller for Kashish's World
 * Strictly on-device persistence using localStorage.
 * No external tracking, analytics, or server transmission.
 */


export interface UserProgressData {
  saveEnabled: boolean;
  hugCount: number;
  openedEnvelopes: string[];
  games: {
    played: number;
    wins: number;
    highScores: {
      catchHearts: number;
      memoryMatch: number;
      quiz: number;
      loveMeter: number;
      [key: string]: number;
    };
  };
  lastVisitedSection: string;
  seenMessages: string[];
  totalVisits: number;
  sessionDurationSeconds: number;
  sectionsOpened: string[];
  secretLetterOpened: boolean;
  specialInteractions: {
    bouquetInteractions: number;
    bottleInteractions: number;
    couponsInteractions: number;
  };
  lastActivityDate: string;
}

export const DEFAULT_PROGRESS: UserProgressData = {
  saveEnabled: true,
  hugCount: 0,
  openedEnvelopes: [],
  games: {
    played: 0,
    wins: 0,
    highScores: {
      catchHearts: 0,
      memoryMatch: 0,
      quiz: 0,
      loveMeter: 0,
    },
  },
  lastVisitedSection: 'home',
  seenMessages: [],
  totalVisits: 1,
  sessionDurationSeconds: 0,
  sectionsOpened: ['home'],
  secretLetterOpened: false,
  specialInteractions: {
    bouquetInteractions: 0,
    bottleInteractions: 0,
    couponsInteractions: 0,
  },
  lastActivityDate: new Date().toISOString(),
};

const STORAGE_KEY = 'kashishWorld';

/**
 * Loads progress from localStorage with complete safety fallbacks.
 */
export const loadProgress = (): UserProgressData => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_PROGRESS };
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROGRESS };

    const parsed = JSON.parse(raw);
    return {
      saveEnabled: parsed.saveEnabled ?? DEFAULT_PROGRESS.saveEnabled,
      hugCount: typeof parsed.hugCount === 'number' ? parsed.hugCount : DEFAULT_PROGRESS.hugCount,
      openedEnvelopes: Array.isArray(parsed.openedEnvelopes) ? parsed.openedEnvelopes : [],
      games: {
        played: typeof parsed.games?.played === 'number' ? parsed.games.played : 0,
        wins: typeof parsed.games?.wins === 'number' ? parsed.games.wins : 0,
        highScores: {
          catchHearts: parsed.games?.highScores?.catchHearts || 0,
          memoryMatch: parsed.games?.highScores?.memoryMatch || 0,
          quiz: parsed.games?.highScores?.quiz || 0,
          loveMeter: parsed.games?.highScores?.loveMeter || 0,
          ...(parsed.games?.highScores || {}),
        },
      },
      lastVisitedSection: parsed.lastVisitedSection || 'home',
      seenMessages: Array.isArray(parsed.seenMessages) ? parsed.seenMessages : [],
      totalVisits: typeof parsed.totalVisits === 'number' ? parsed.totalVisits : 1,
      sessionDurationSeconds: typeof parsed.sessionDurationSeconds === 'number' ? parsed.sessionDurationSeconds : 0,
      sectionsOpened:
        Array.isArray(parsed.sectionsOpened) && parsed.sectionsOpened.length > 0
          ? parsed.sectionsOpened
          : ['home'],
      secretLetterOpened: Boolean(parsed.secretLetterOpened),
      specialInteractions: {
        bouquetInteractions: parsed.specialInteractions?.bouquetInteractions || 0,
        bottleInteractions: parsed.specialInteractions?.bottleInteractions || 0,
        couponsInteractions: parsed.specialInteractions?.couponsInteractions || 0,
      },
      lastActivityDate: parsed.lastActivityDate || new Date().toISOString(),
    };
  } catch (err) {
    console.warn('LocalStorage is disabled or inaccessible:', err);
    return { ...DEFAULT_PROGRESS };
  }
};

/**
 * Saves progress to localStorage if user has saveEnabled.
 */
export const saveProgress = (data: UserProgressData): void => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!data.saveEnabled) {
      // If disabled, we still keep a minimal state or leave clean
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Unable to write to localStorage:', err);
  }
};

/**
 * Completely resets saved progress on the device.
 */
export const resetProgress = (): UserProgressData => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    console.warn('Unable to remove localStorage item:', err);
  }
  return { ...DEFAULT_PROGRESS };
};

/**
 * Computes SHA-256 hash using the Web Crypto API
 */
export const sha256 = async (str: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};
