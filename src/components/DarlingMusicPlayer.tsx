import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  Music,
  Search,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Volume1,
  VolumeX,
  X,
  Loader2,
  Clock,
  ChevronDown,
  ChevronUp,
  Tv,
  Film,
  Heart,
  Disc3,
  Repeat,
  Shuffle,
  Sliders,
  Timer,
  ArrowLeft,
  ArrowUpLeft,
  Maximize2,
  Minimize2,
  Check,
  Settings2,
  Compass,
  Sparkles,
  ListMusic,
  Zap,
  Menu,
  Home,
  Library,
  Plus,
  Trash2,
  FileText,
  User,
  FolderPlus,
  Moon,
  RotateCcw,
  Repeat1,
} from 'lucide-react';
import { MusicSearchOverlay } from './MusicSearchOverlay';
import {
  loadUserFavorites,
  saveUserFavorites,
  loadUserFavoriteTracks,
  saveUserFavoriteTracks,
  QUICK_PICKS_TRACKS,
  ALL_DISCOVERY_TRACKS,
  resolveCanonicalTrack,
  getCachedRelatedTracks,
  fetchNextRelatedTracksBatch,
  RELATED_MOOD_CHIPS,
  recordTrackPlayEvent,
  recordTrackListenDuration,
  getVibeMatchedQuickPicks,
} from '../services/musicDiscoveryData';
import {
  YouTubeTrack,
  searchYouTubeSongs,
  searchYouTubeVideos,
  getCachedSearchEntry,
  getCachedVideoSearchEntry,
  refreshSearchInBackground,
  findEmbeddableAlternative,
  getKnownPlayableVideoId,
  preloadNextTrackResources,
  formatDuration,
  loadUserRecentPlayedTracks,
  loadUserLastPlayedTrack,
  saveUserLastPlayedTrack,
  loadUserLastSearch,
  saveUserLastSearch,
  loadUserRecentSearches,
  saveUserRecentSearch,
  removeUserRecentSearch,
  normalizeSquareThumbnail,
  getHighResThumbnailUrl,
  getInstantSuggestions,
  getSuggestedSongsForQuery,
  fetchYouTubeSuggestions,
} from '../services/youtubeSearch';
import {
  triggerHaptic,
  showNativeToast,
  logNativeActivity,
  hasNativeExoPlayer,
  fetchNativeLyricsAsync,
} from '../androidBridge';
import type { NavTab } from './Navbar';

export interface EqBandSettings {
  bass: number; // -12 to +12 dB (100 Hz lowshelf)
  mid: number; // -12 to +12 dB (1000 Hz peaking)
  treble: number; // -12 to +12 dB (8000 Hz highshelf)
}

export const EQ_PRESETS: Record<string, EqBandSettings> = {
  Flat: { bass: 0, mid: 0, treble: 0 },
  'Bass Boost': { bass: 7, mid: 1, treble: 2 },
  Vocal: { bass: -2, mid: 6, treble: 3 },
  Acoustic: { bass: 3, mid: 2, treble: 5 },
  Club: { bass: 6, mid: 3, treble: 4 },
  'Lo-Fi Warm': { bass: 5, mid: -1, treble: -4 },
};

export interface PlaybackTelemetryEntry {
  videoId: string;
  title: string;
  artist: string;
  tapToPlayerReadyMs: number | null;
  tapToFirstAudioMs: number | null;
  bufferingInterruptions: number;
  timestamp: number;
}

export interface SearchTelemetryEntry {
  query: string;
  responseTimeMs: number;
  source: 'cold' | 'warm' | 'cache' | 'background_refresh';
  resultCount: number;
  timestamp: number;
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
    __kashishConsumeMusicPlayerBack?: () => boolean;
    __kashishMusicMetrics?: {
      playerPrewarmedAtMs: number | null;
      searches: SearchTelemetryEntry[];
      playbacks: PlaybackTelemetryEntry[];
    };
  }
}

function ensureMetricsStore() {
  if (typeof window === 'undefined') return null;
  if (!window.__kashishMusicMetrics) {
    window.__kashishMusicMetrics = {
      playerPrewarmedAtMs: null,
      searches: [],
      playbacks: [],
    };
  }
  return window.__kashishMusicMetrics;
}

function updateMediaSessionPosition(positionSec: number, durationSec: number, playbackRate = 1) {
  if (
    typeof navigator === 'undefined' ||
    !('mediaSession' in navigator) ||
    typeof navigator.mediaSession.setPositionState !== 'function'
  ) {
    return;
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  const safePos = Math.max(0, Math.min(durationSec, Number.isFinite(positionSec) ? positionSec : 0));
  try {
    navigator.mediaSession.setPositionState({
      duration: durationSec,
      playbackRate: playbackRate > 0 ? playbackRate : 1,
      position: safePos,
    });
  } catch {
    // Ignore unsupported browser errors
  }
}

const squareArtworkDataCache = new Map<string, string>();
const squareArtworkPendingSet = new Set<string>();

function cropImageElementToSquareDataUrl(img: HTMLImageElement): string | null {
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w <= 120 || h <= 90) return null;
    // Strip 4:3 black letterbox bars present in YouTube hqdefault (480x360) / sddefault (640x480)
    const isFourByThree = w > h && Math.abs(w * 3 - h * 4) <= 12;
    const activeH = isFourByThree ? Math.max(1, Math.floor((w * 9) / 16)) : h;
    const size = Math.max(1, Math.min(w, activeH));
    const sx = Math.max(0, Math.floor((w - size) / 2));
    const sy = Math.max(0, Math.floor((h - size) / 2));

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, sx, sy, size, size, 0, 0, 512, 512);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return dataUrl && dataUrl.startsWith('data:image/') ? dataUrl : null;
  } catch {
    return null;
  }
}

function ensureSquareArtworkForTrack(
  videoId: string,
  rawThumbnail: string | undefined,
  onReady?: (squareDataUrl: string) => void
): void {
  if (!videoId || typeof window === 'undefined' || typeof document === 'undefined') return;
  const existing = squareArtworkDataCache.get(videoId);
  if (existing) {
    onReady?.(existing);
    return;
  }
  if (squareArtworkPendingSet.has(videoId)) return;
  squareArtworkPendingSet.add(videoId);

  const candidates = [
    ...(rawThumbnail && (rawThumbnail.includes('googleusercontent.com') || rawThumbnail.includes('ggpht.com'))
      ? [rawThumbnail.replace(/=w\d+-h\d+[^&?]*/, '=w512-h512-l90-rj')]
      : []),
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hq720.jpg`,
    `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];

  let idx = 0;
  const tryNext = () => {
    if (idx >= candidates.length) {
      squareArtworkPendingSet.delete(videoId);
      return;
    }
    const url = candidates[idx++];
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      if (img.naturalWidth <= 120 || img.naturalHeight <= 90) {
        tryNext();
        return;
      }
      const dataUrl = cropImageElementToSquareDataUrl(img);
      squareArtworkPendingSet.delete(videoId);
      if (dataUrl) {
        squareArtworkDataCache.set(videoId, dataUrl);
        onReady?.(dataUrl);
      }
    };
    img.onerror = () => {
      tryNext();
    };
    img.src = url;
  };

  tryNext();
}

function buildMediaArtworkList(rawThumbnail: string | undefined, videoId: string): MediaImage[] {
  const cachedSquareData = videoId ? squareArtworkDataCache.get(videoId) : undefined;
  const sizes = [96, 128, 192, 256, 384, 512];
  if (cachedSquareData) {
    return sizes.map((sz) => ({
      src: cachedSquareData,
      sizes: `${sz}x${sz}`,
      type: 'image/jpeg',
    }));
  }

  const primary = normalizeSquareThumbnail(rawThumbnail, videoId);
  const toAbsolute = (url: string) => {
    try {
      if (typeof window !== 'undefined' && !url.startsWith('http://') && !url.startsWith('https://')) {
        return new URL(url, window.location.href).href;
      }
    } catch {}
    return url;
  };
  const absPrimary = toAbsolute(primary);

  if (
    absPrimary.includes('googleusercontent.com') ||
    absPrimary.includes('ggpht.com')
  ) {
    return sizes.map((sz) => ({
      src: absPrimary.replace(/=w\d+-h\d+[^&?]*/i, `=w${sz}-h${sz}-l90-rj`),
      sizes: `${sz}x${sz}`,
      type: 'image/jpeg',
    }));
  }

  return sizes.map((sz) => ({
    src: absPrimary,
    sizes: `${sz}x${sz}`,
    type: 'image/jpeg',
  }));
}

/**
 * Top-level HTML5 carrier <audio> element.
 * Playing continuous audible-frequency audio with micro-amplitude (~ -74 dBFS) in the top-level
 * browsing context ensures Android OS AudioFlinger, MediaSessionCompat, and Chromium MediaSessionImpl
 * register active playback and publish the media notification panel with lock-screen playback controls.
 * CRITICAL: The audio element must have an active DOM layout geometry (not display: none),
 * and must be unlocked synchronously within user touch/click gestures.
 */
let sharedCarrierAudio: HTMLAudioElement | null = null;
function getTopLevelAudioCarrier(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (sharedCarrierAudio) return sharedCarrierAudio;
  try {
    // CRITICAL FOR ANDROID CHROME / WEBVIEW MEDIASESSION CONTROLS:
    // 1. Chromium's MediaSessionImpl::IsControllable() strictly requires duration >= 5.0 seconds
    //    (kMinimumDurationForControllableMedia = 5s). Any <audio> shorter than 5s is treated as an
    //    uncontrollable sound effect and hides Play/Pause/Next/Prev controls in the Android notification!
    // 2. Chromium's AudioPowerMonitor requires signal power > -72 dBFS or it marks the stream silent.
    //    A 28 Hz sub-bass wave with 16-bit amplitude 80 (~ -52 dBFS) is completely inaudible on phone
    //    speakers/earpieces while keeping Android AudioFlinger & Chromium MediaSession 100% active.
    const sampleRate = 8000;
    const durationSeconds = 30; // 30 seconds (> 5s Chromium controllable media requirement)
    const numSamples = sampleRate * durationSeconds;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    const twoPiF = (2 * Math.PI * 28) / sampleRate;
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.round(Math.sin(i * twoPiF) * 80);
      view.setInt16(44 + i * 2, sample, true);
    }
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.id = 'kashish-media-session-carrier';
    audio.src = url;
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 1.0;
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('aria-hidden', 'true');
    // Note: Must not use display: none because Chromium skips media notifications for display:none elements
    audio.style.cssText =
      'position: fixed; left: 0px; bottom: 0px; width: 2px; height: 2px; opacity: 0.001; pointer-events: none; z-index: -9999;';
    document.body.appendChild(audio);
    sharedCarrierAudio = audio;
    return audio;
  } catch {
    return null;
  }
}

/**
 * Synchronously triggers carrier audio playback during a user tap or gesture.
 */
function primeAndPlayAudioCarrier(): void {
  try {
    const carrier = getTopLevelAudioCarrier();
    if (carrier && carrier.paused) {
      const p = carrier.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    }
  } catch {}
}

/**
 * Re-asserts top-level HTML5 <audio> carrier ownership of Chromium's MediaSessionService
 * AFTER the cross-origin YouTube <iframe> begins playing so Android shows the top-level
 * document's Previous / Play-Pause / Next / Seek controls in the system notification.
 */
function reclaimTopLevelAudioCarrier(): void {
  try {
    const carrier = getTopLevelAudioCarrier();
    if (!carrier) return;
    if (!carrier.paused) {
      carrier.pause();
    }
    const p = carrier.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {});
    }
  } catch {}
}

/**
 * Singleton top-level HTML5 <audio> element for direct YouTube Music audio stream playback.
 */
let sharedNativeAudio: HTMLAudioElement | null = null;
function getTopLevelNativeAudioElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (sharedNativeAudio) return sharedNativeAudio;
  try {
    const audio = document.createElement('audio');
    audio.id = 'kashish-native-music-audio';
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('referrerpolicy', 'no-referrer');
    audio.setAttribute('aria-hidden', 'true');
    audio.style.cssText =
      'position: fixed; left: 0px; bottom: 0px; width: 2px; height: 2px; opacity: 0.001; pointer-events: none; z-index: -9999;';
    document.body.appendChild(audio);
    sharedNativeAudio = audio;
    return audio;
  } catch {
    return null;
  }
}

interface WebAudioEqGraph {
  ctx: AudioContext;
  bassFilter: BiquadFilterNode;
  midFilter: BiquadFilterNode;
  trebleFilter: BiquadFilterNode;
  preampGain: GainNode;
}

let sharedEqGraph: WebAudioEqGraph | null = null;

function ensureWebAudioEqGraph(): WebAudioEqGraph | null {
  if (typeof window === 'undefined') return null;
  if (sharedEqGraph) {
    if (sharedEqGraph.ctx.state === 'suspended') {
      sharedEqGraph.ctx.resume().catch(() => {});
    }
    return sharedEqGraph;
  }
  const nativeAudio = getTopLevelNativeAudioElement();
  if (!nativeAudio) return null;

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx: AudioContext = new AudioCtx();
    const source = ctx.createMediaElementSource(nativeAudio);

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 100;

    const midFilter = ctx.createBiquadFilter();
    midFilter.type = 'peaking';
    midFilter.Q.value = 1.0;
    midFilter.frequency.value = 1000;

    const trebleFilter = ctx.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 8000;

    const preampGain = ctx.createGain();
    preampGain.gain.value = 1.0;

    source.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    trebleFilter.connect(preampGain);
    preampGain.connect(ctx.destination);

    sharedEqGraph = {
      ctx,
      bassFilter,
      midFilter,
      trebleFilter,
      preampGain,
    };
    return sharedEqGraph;
  } catch {
    return null;
  }
}

/**
 * Computes a smooth, distortion-free preamp / loudness contour multiplier (0.45x to 1.00x,
 * centered at 0.80x for Flat 0dB) from the 3-band EQ settings so that both Web Audio DSP
 * and cross-origin YouTube IFrame playback respond audibly across the entire -12dB to +12dB
 * range without clipping at default 90% master volume.
 */
function computeEqLoudnessMultiplier(bands: EqBandSettings): number {
  const weightedDb = bands.bass * 0.44 + bands.mid * 0.34 + bands.treble * 0.22;
  // Map weightedDb (-12..+12) around 0.80 reference gain so boosts up to +12dB scale smoothly up to 1.00x
  // and cuts down to -12dB attenuate smoothly down to 0.45x.
  if (weightedDb >= 0) {
    return Math.min(1.05, 0.8 + (weightedDb / 12) * 0.22);
  }
  return Math.max(0.45, 0.8 + (weightedDb / 12) * 0.35);
}

function applyEqualizerToWebAudio(bands: EqBandSettings, presetName = 'Custom'): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.AndroidApp?.setEqualizerBands === 'function') {
      window.AndroidApp.setEqualizerBands(
        Math.round(bands.bass),
        Math.round(bands.mid),
        Math.round(bands.treble),
        presetName
      );
    }
  } catch {}

  const graph = ensureWebAudioEqGraph();
  if (!graph) return false;
  try {
    if (graph.ctx.state === 'suspended') {
      graph.ctx.resume().catch(() => {});
    }
    const now = graph.ctx.currentTime;
    graph.bassFilter.gain.setTargetAtTime(bands.bass, now, 0.015);
    graph.midFilter.gain.setTargetAtTime(bands.mid, now, 0.015);
    graph.trebleFilter.gain.setTargetAtTime(bands.treble, now, 0.015);
    // Headroom protection when heavy boost is active
    const maxBoost = Math.max(0, bands.bass, bands.mid, bands.treble);
    const headroomGain = maxBoost > 6 ? Math.pow(10, -((maxBoost - 6) * 0.35) / 20) : 1.0;
    graph.preampGain.gain.setTargetAtTime(headroomGain, now, 0.015);
    return true;
  } catch {
    return false;
  }
}

function resolveStreamUrlForTrack(videoId: string): string {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.AndroidApp?.resolveYouTubeAudioStream === 'function'
    ) {
      const rawJson = window.AndroidApp.resolveYouTubeAudioStream(videoId);
      if (rawJson) {
        const parsed = JSON.parse(rawJson);
        if (parsed && typeof parsed.url === 'string' && parsed.url.startsWith('http')) {
          return parsed.url;
        }
      }
    }
  } catch {}
  return `/api/ytmusic/stream?videoId=${encodeURIComponent(videoId)}`;
}

interface ProgressBarProps {
  getPlaybackMetrics: () => { currentTime: number; duration: number };
  onSeekTo: (seconds: number) => void;
  isPlaying: boolean;
  trackId: string | null;
  fallbackDurationSec?: number;
  accentColor?: string;
  accentGradient?: string;
  trackBg?: string;
  textColor?: string;
  variant?: 'standard' | 'top-edge' | 'apple';
}

/**
 * Isolated progress scrubber component so 1-second time ticks never re-render
 * the search results list or parent card, while keeping Media Session position synced.
 * Includes seek-target lock protection so YouTube IFrame seek latency never causes
 * the scrubber to snap back to the old position after dragging or clicking.
 */
const PlayerProgressBar = memo(
  ({
    getPlaybackMetrics,
    onSeekTo,
    isPlaying,
    trackId,
    fallbackDurationSec = 0,
    accentColor = '#ff0033',
    accentGradient,
    trackBg = 'rgba(255,255,255,0.18)',
    textColor = '#a3a3a3',
    variant = 'standard',
  }: ProgressBarProps) => {
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(fallbackDurationSec);
    const [isSeeking, setIsSeeking] = useState(false);

    const barContainerRef = useRef<HTMLDivElement | null>(null);
    const isDraggingRef = useRef<boolean>(false);
    // Prevent stale getCurrentTime() values from snapping the scrubber back right after a seek commit
    const seekTargetRef = useRef<number | null>(null);
    const seekCommitTimestampRef = useRef<number>(0);

    const lastMediaSessionSyncRef = useRef<number>(0);
    const lastSyncedPosRef = useRef<number>(-1);

    useEffect(() => {
      isDraggingRef.current = false;
      seekTargetRef.current = null;
      seekCommitTimestampRef.current = 0;
      lastMediaSessionSyncRef.current = 0;
      lastSyncedPosRef.current = -1;
      setIsSeeking(false);
      setCurrentTime(0);
      setDuration(fallbackDurationSec || 0);
    }, [trackId, fallbackDurationSec]);

    useEffect(() => {
      const updateProgress = () => {
        if (isDraggingRef.current) return;
        if (
          typeof document !== 'undefined' &&
          document.hidden
        ) {
          return;
        }
        if (typeof window !== 'undefined' && (window as any).__kashishAppInBackground === true) {
          return;
        }
        try {
          const { currentTime: cur, duration: dur } = getPlaybackMetrics();
          const effectiveDur = dur > 0 ? dur : fallbackDurationSec;

          if (seekTargetRef.current !== null) {
            const elapsedSinceSeek = performance.now() - seekCommitTimestampRef.current;
            const drift = Math.abs(cur - seekTargetRef.current);
            if (drift <= 1.8 || elapsedSinceSeek > 3000) {
              // Player has caught up to the seek target (or 3s lock window expired)
              seekTargetRef.current = null;
              setCurrentTime(cur);
            } else {
              // Keep showing the committed seek position while YouTube IFrame buffer catches up
              setCurrentTime(seekTargetRef.current);
            }
          } else {
            setCurrentTime(cur);
          }

          if (effectiveDur > 0) {
            setDuration(effectiveDur);
            // Throttle mediaSession position updates to once every 4 seconds or when drift > 2.5s
            // to avoid spamming the Android OS MediaSession Binder and crashing notification
            const now = performance.now();
            const pos = seekTargetRef.current !== null ? seekTargetRef.current : cur;
            if (
              now - lastMediaSessionSyncRef.current > 4000 ||
              Math.abs(pos - lastSyncedPosRef.current) > 2.5
            ) {
              lastMediaSessionSyncRef.current = now;
              lastSyncedPosRef.current = pos;
              updateMediaSessionPosition(pos, effectiveDur);
            }
          }
        } catch {
          // Ignore transient player state errors
        }
      };

      updateProgress();
      if (!isPlaying) return;
      const interval = window.setInterval(updateProgress, 400);
      const onBgState = (e: Event) => {
        const detail = (e as CustomEvent)?.detail;
        if (detail && detail.backgrounded === false) {
          updateProgress();
        }
      };
      window.addEventListener('kashish-app-background-state', onBgState);
      return () => {
        window.clearInterval(interval);
        window.removeEventListener('kashish-app-background-state', onBgState);
      };
    }, [isPlaying, getPlaybackMetrics, fallbackDurationSec]);

    const computeSecondsFromClientX = useCallback(
      (clientX: number): number => {
        const el = barContainerRef.current;
        const effectiveDur = duration > 0 ? duration : fallbackDurationSec;
        if (!el || effectiveDur <= 0) return 0;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return Math.round(ratio * effectiveDur * 2) / 2;
      },
      [duration, fallbackDurationSec]
    );

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const effectiveDur = duration > 0 ? duration : fallbackDurationSec;
      if (!trackId || effectiveDur <= 0) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      isDraggingRef.current = true;
      setIsSeeking(true);
      const nextSec = computeSecondsFromClientX(e.clientX);
      seekTargetRef.current = nextSec;
      setCurrentTime(nextSec);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      e.stopPropagation();
      const nextSec = computeSecondsFromClientX(e.clientX);
      seekTargetRef.current = nextSec;
      setCurrentTime(nextSec);
    };

    const commitPointerSeek = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      e.stopPropagation();
      try {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {}
      isDraggingRef.current = false;
      const seekToSec = computeSecondsFromClientX(e.clientX);
      seekTargetRef.current = seekToSec;
      seekCommitTimestampRef.current = performance.now();
      setCurrentTime(seekToSec);
      setIsSeeking(false);
      onSeekTo(seekToSec);
      const effectiveDur = duration > 0 ? duration : fallbackDurationSec;
      if (effectiveDur > 0) {
        updateMediaSessionPosition(seekToSec, effectiveDur);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      const effectiveDur = duration > 0 ? duration : fallbackDurationSec;
      if (!trackId || effectiveDur <= 0) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const delta = e.key === 'ArrowRight' ? 5 : -5;
        const seekToSec = Math.max(0, Math.min(effectiveDur, currentTime + delta));
        seekTargetRef.current = seekToSec;
        seekCommitTimestampRef.current = performance.now();
        setCurrentTime(seekToSec);
        onSeekTo(seekToSec);
        updateMediaSessionPosition(seekToSec, effectiveDur);
      }
    };

    const effectiveDur = duration > 0 ? duration : fallbackDurationSec;
    const progressPercent = effectiveDur > 0 ? Math.min(100, (currentTime / effectiveDur) * 100) : 0;
    const progressRatio = Math.max(0, Math.min(1, progressPercent / 100));

    if (variant === 'top-edge') {
      return (
        <div
          ref={barContainerRef}
          role="slider"
          tabIndex={!trackId || effectiveDur <= 0 ? -1 : 0}
          aria-label="Seek song playback position"
          aria-valuemin={0}
          aria-valuemax={Math.round(effectiveDur || 100)}
          aria-valuenow={Math.round(currentTime)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={commitPointerSeek}
          onPointerCancel={commitPointerSeek}
          onKeyDown={handleKeyDown}
          className={`absolute left-0 right-0 -top-2 h-4 flex items-center z-30 select-none touch-none ${
            !trackId || effectiveDur <= 0 ? 'cursor-default' : 'cursor-pointer group'
          }`}
        >
          <div
            style={{ backgroundColor: trackBg }}
            className="w-full h-[3px] group-hover:scale-y-150 origin-center transition-transform overflow-hidden relative"
          >
            <div
              style={{
                transform: `scaleX(${progressRatio}) translateZ(0)`,
                transformOrigin: 'left center',
                background: accentGradient || accentColor,
                willChange: 'transform',
              }}
              className={`w-full h-full ${isSeeking ? '' : 'transition-transform duration-150 ease-linear'}`}
            />
          </div>
          {trackId && effectiveDur > 0 && (
            <div
              style={{
                transform: `translate3d(${progressPercent}%, 0, 0)`,
                willChange: 'transform',
              }}
              className={`absolute inset-x-0 top-1/2 -translate-y-1/2 pointer-events-none ${
                isSeeking ? '' : 'transition-transform duration-150 ease-linear'
              }`}
            >
              <div
                style={{
                  background: accentGradient || accentColor,
                }}
                className={`-ml-1.5 w-3 h-3 rounded-full shadow-md transition-[transform,opacity] ${
                  isSeeking
                    ? 'scale-125 opacity-100'
                    : 'scale-0 opacity-0 group-hover:scale-100 group-hover:opacity-100'
                }`}
              />
            </div>
          )}
        </div>
      );
    }

    if (variant === 'apple') {
      const remainingSec = Math.max(0, effectiveDur - currentTime);
      return (
        <div className="w-full flex flex-col gap-1.5 select-none">
          <div
            ref={barContainerRef}
            role="slider"
            tabIndex={!trackId || effectiveDur <= 0 ? -1 : 0}
            aria-label="Seek song playback position"
            aria-valuemin={0}
            aria-valuemax={Math.round(effectiveDur || 100)}
            aria-valuenow={Math.round(currentTime)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={commitPointerSeek}
            onPointerCancel={commitPointerSeek}
            onKeyDown={handleKeyDown}
            className={`relative w-full flex items-center h-5 select-none touch-none ${
              !trackId || effectiveDur <= 0 ? 'cursor-default opacity-60' : 'cursor-pointer group'
            }`}
          >
            <div
              style={{ backgroundColor: trackBg }}
              className={`w-full h-[6px] rounded-full overflow-hidden origin-center transition-transform duration-200 ${
                isSeeking ? 'scale-y-[1.45]' : 'group-hover:scale-y-[1.25]'
              }`}
            >
              <div
                style={{
                  transform: `scaleX(${progressRatio}) translateZ(0)`,
                  transformOrigin: 'left center',
                  background: accentGradient || accentColor,
                  willChange: 'transform',
                }}
                className={`w-full h-full rounded-full ${isSeeking ? '' : 'transition-transform duration-150 ease-linear'}`}
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-tight tabular-nums px-0.5">
            <span style={{ color: textColor }}>
              {formatDuration(currentTime) || '0:00'}
            </span>
            <span className="px-2 py-0.5 rounded-[5px] bg-white/12 text-white/80 text-[9px] font-bold tracking-wider uppercase">
              Lossless
            </span>
            <span style={{ color: textColor }}>
              {effectiveDur > 0 ? `-${formatDuration(remainingSec) || '0:00'}` : '--:--'}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2.5 w-full">
        <span
          style={{ color: textColor }}
          className="text-[11px] font-mono tabular-nums w-9 text-right shrink-0"
        >
          {formatDuration(currentTime) || '0:00'}
        </span>
        <div
          ref={barContainerRef}
          role="slider"
          tabIndex={!trackId || effectiveDur <= 0 ? -1 : 0}
          aria-label="Seek song playback position"
          aria-valuemin={0}
          aria-valuemax={Math.round(effectiveDur || 100)}
          aria-valuenow={Math.round(currentTime)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={commitPointerSeek}
          onPointerCancel={commitPointerSeek}
          onKeyDown={handleKeyDown}
          className={`relative flex-1 flex items-center h-6 select-none touch-none ${
            !trackId || effectiveDur <= 0 ? 'cursor-default opacity-60' : 'cursor-pointer group'
          }`}
        >
          <div
            style={{ backgroundColor: trackBg }}
            className="w-full h-1 group-hover:scale-y-125 origin-center rounded-full overflow-hidden transition-transform"
          >
            <div
              style={{
                transform: `scaleX(${progressRatio}) translateZ(0)`,
                transformOrigin: 'left center',
                background: accentGradient || accentColor,
                willChange: 'transform',
              }}
              className={`w-full h-full rounded-full ${isSeeking ? '' : 'transition-transform duration-150 ease-linear'}`}
            />
          </div>
          {trackId && effectiveDur > 0 && (
            <div
              style={{
                transform: `translate3d(${progressPercent}%, 0, 0)`,
                willChange: 'transform',
              }}
              className={`absolute inset-x-0 top-1/2 -translate-y-1/2 pointer-events-none ${
                isSeeking ? '' : 'transition-transform duration-150 ease-linear'
              }`}
            >
              <div
                style={{
                  background: accentGradient || accentColor,
                }}
                className={`-ml-1.5 w-3 h-3 rounded-full shadow-md transition-transform ${
                  isSeeking ? 'scale-125' : 'scale-90 group-hover:scale-110'
                }`}
              />
            </div>
          )}
        </div>
        <span
          style={{ color: textColor }}
          className="text-[11px] font-mono tabular-nums w-9 shrink-0"
        >
          {effectiveDur > 0 ? formatDuration(effectiveDur) : '--:--'}
        </span>
      </div>
    );
  }
);

/**
 * Isolated time readout (`1:24 / 3:45`) for the bottom player bar left controls
 * so 1-second ticks never re-render the rest of the player tree.
 */
const PlayerTimeReadout = memo(
  ({
    getPlaybackMetrics,
    isPlaying,
    trackId,
    fallbackDurationSec = 0,
  }: {
    getPlaybackMetrics: () => { currentTime: number; duration: number };
    isPlaying: boolean;
    trackId: string | null;
    fallbackDurationSec?: number;
  }) => {
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(fallbackDurationSec);

    useEffect(() => {
      setCurrentTime(0);
      setDuration(fallbackDurationSec || 0);
    }, [trackId, fallbackDurationSec]);

    useEffect(() => {
      const tick = () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (typeof window !== 'undefined' && (window as any).__kashishAppInBackground === true) return;
        try {
          const { currentTime: cur, duration: dur } = getPlaybackMetrics();
          setCurrentTime(cur);
          if (dur > 0) setDuration(dur);
        } catch {}
      };
      tick();
      if (!isPlaying) return;
      const id = window.setInterval(tick, 500);
      return () => window.clearInterval(id);
    }, [isPlaying, getPlaybackMetrics]);

    const effectiveDur = duration > 0 ? duration : fallbackDurationSec;
    return (
      <span className="hidden sm:inline-block text-xs font-mono tabular-nums text-neutral-400 whitespace-nowrap select-none">
        {formatDuration(currentTime) || '0:00'} /{' '}
        {effectiveDur > 0 ? formatDuration(effectiveDur) : '--:--'}
      </span>
    );
  }
);

export interface UserPlaylist {
  id: string;
  name: string;
  createdAt: number;
  tracks: YouTubeTrack[];
}

function loadUserPlaylists(userId: string): UserPlaylist[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw =
      window.localStorage.getItem(`kashish_ytm_playlists_v1_${userId || 'guest'}`) ||
      window.localStorage.getItem('kashish_ytm_playlists_v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.tracks)
    );
  } catch {
    return [];
  }
}

function saveUserPlaylists(userId: string, playlists: UserPlaylist[]): void {
  if (typeof window === 'undefined') return;
  try {
    const json = JSON.stringify(playlists);
    window.localStorage.setItem(`kashish_ytm_playlists_v1_${userId || 'guest'}`, json);
    window.localStorage.setItem('kashish_ytm_playlists_v1', json);
  } catch {}
}

export interface ParsedLyricLine {
  timeSec: number;
  text: string;
}

export interface TrackLyricsData {
  videoId: string;
  syncedLines: ParsedLyricLine[];
  plainLyrics: string | null;
  source: string;
}

const lyricsCache = new Map<string, TrackLyricsData>();

function parseLrcLyrics(lrc: string): ParsedLyricLine[] {
  const lines = lrc.split(/\r?\n/);
  const parsed: ParsedLyricLine[] = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/;
  for (const rawLine of lines) {
    const match = rawLine.match(timeRegex);
    if (!match) continue;
    const mins = parseInt(match[1], 10) || 0;
    const secs = parseInt(match[2], 10) || 0;
    const msStr = match[3] || '0';
    const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10) || 0;
    const text = rawLine.replace(/\[.*?\]/g, '').trim();
    if (text) {
      parsed.push({
        timeSec: mins * 60 + secs + ms / 1000,
        text,
      });
    }
  }
  return parsed;
}

async function fetchTrackLyrics(
  track: YouTubeTrack,
  signal?: AbortSignal
): Promise<TrackLyricsData> {
  const cached = lyricsCache.get(track.videoId);
  if (cached) return cached;

  const cleanTitle = track.title
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/official\s*(video|audio|music\s*video|lyric\s*video)/gi, '')
    .replace(/full\s*video|lyrical\s*video/gi, '')
    .split('|')[0]
    .split('-')[0]
    .trim();
  const primaryArtist = (track.artist || '').split(',')[0].split('&')[0].trim();

  // 1. On Android APK, use native Kotlin 30-day disk-cached LRCLIB fetcher (instant on repeat plays)
  try {
    const nativeHit = await fetchNativeLyricsAsync(
      cleanTitle || track.title,
      primaryArtist,
      signal
    );
    if (nativeHit && (nativeHit.syncedLyrics || nativeHit.plainLyrics)) {
      const syncedLines = nativeHit.syncedLyrics ? parseLrcLyrics(nativeHit.syncedLyrics) : [];
      const plainLyrics =
        nativeHit.plainLyrics || syncedLines.map((l) => l.text).join('\n') || null;
      const result: TrackLyricsData = {
        videoId: track.videoId,
        syncedLines,
        plainLyrics,
        source: 'LRCLIB (Cached)',
      };
      lyricsCache.set(track.videoId, result);
      return result;
    }
  } catch {}

  try {
    const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(
      cleanTitle || track.title
    )}&artist_name=${encodeURIComponent(primaryArtist)}`;
    const res = await fetch(searchUrl, { signal });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        const best =
          list.find((item: any) => item?.syncedLyrics || item?.plainLyrics) || list[0];
        if (best && (best.syncedLyrics || best.plainLyrics)) {
          const syncedLines =
            typeof best.syncedLyrics === 'string' ? parseLrcLyrics(best.syncedLyrics) : [];
          const plainLyrics =
            typeof best.plainLyrics === 'string' && best.plainLyrics.trim()
              ? best.plainLyrics.trim()
              : syncedLines.map((l) => l.text).join('\n');
          const result: TrackLyricsData = {
            videoId: track.videoId,
            syncedLines,
            plainLyrics: plainLyrics || null,
            source: 'LRCLIB Music Catalog',
          };
          lyricsCache.set(track.videoId, result);
          return result;
        }
      }
    }

    // Secondary query by combined q parameter
    const fallbackRes = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanTitle} ${primaryArtist}`.trim())}`,
      { signal }
    );
    if (fallbackRes.ok) {
      const list = await fallbackRes.json();
      if (Array.isArray(list) && list.length > 0) {
        const best =
          list.find((item: any) => item?.syncedLyrics || item?.plainLyrics) || list[0];
        if (best && (best.syncedLyrics || best.plainLyrics)) {
          const syncedLines =
            typeof best.syncedLyrics === 'string' ? parseLrcLyrics(best.syncedLyrics) : [];
          const plainLyrics =
            typeof best.plainLyrics === 'string' && best.plainLyrics.trim()
              ? best.plainLyrics.trim()
              : syncedLines.map((l) => l.text).join('\n');
          const result: TrackLyricsData = {
            videoId: track.videoId,
            syncedLines,
            plainLyrics: plainLyrics || null,
            source: 'LRCLIB Music Catalog',
          };
          lyricsCache.set(track.videoId, result);
          return result;
        }
      }
    }
  } catch {
    // Fall through to structured fallback
  }

  const fallbackResult: TrackLyricsData = {
    videoId: track.videoId,
    syncedLines: [],
    plainLyrics: [
      `♪ ${track.title} ♪`,
      `Artist: ${track.artist}`,
      track.album ? `Album: ${track.album}` : '',
      '',
      ' Immerse in the melody — studio audio stream active.',
      'Synced word-by-word lyrics for this specific recording are not yet indexed,',
      'so enjoy the pure vocal & instrumental mix or switch to the Video view on the left.',
    ]
      .filter(Boolean)
      .join('\n'),
    source: 'YouTube Music Studio Metadata',
  };
  lyricsCache.set(track.videoId, fallbackResult);
  return fallbackResult;
}

const coverColorCache = new Map<string, string>();
const FALLBACK_AMBIENT_COLORS = [
  '225, 29, 72',   // Crimson Rose
  '190, 18, 60',   // Deep Ruby
  '124, 58, 237',  // Royal Violet
  '37, 99, 235',   // Cobalt Blue
  '13, 148, 136',  // Deep Teal
  '217, 119, 6',   // Warm Amber
  '220, 38, 38',   // YouTube Red
  '147, 51, 234',  // Velvet Purple
];

function getDeterministicRgbForTrack(videoId: string): string {
  let hash = 0;
  for (let i = 0; i < videoId.length; i++) {
    hash = (hash * 31 + videoId.charCodeAt(i)) | 0;
  }
  return FALLBACK_AMBIENT_COLORS[Math.abs(hash) % FALLBACK_AMBIENT_COLORS.length];
}

function extractDominantCoverColor(
  videoId: string,
  thumbnailUrl: string,
  onColor: (rgbString: string) => void
): void {
  if (!videoId) {
    onColor('255, 0, 51');
    return;
  }
  const cached = coverColorCache.get(videoId);
  if (cached) {
    onColor(cached);
    return;
  }
  const fallbackRgb = getDeterministicRgbForTrack(videoId);
  onColor(fallbackRgb);

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 24, 24);
        const data = ctx.getImageData(0, 0, 24, 24).data;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const brightness = (r + g + b) / 3;
          // Ignore near-black and near-white pixels for richer ambient color
          if (brightness > 28 && brightness < 235) {
            rSum += r;
            gSum += g;
            bSum += b;
            count++;
          }
        }
        if (count > 10) {
          const rAvg = Math.min(255, Math.round((rSum / count) * 1.15));
          const gAvg = Math.min(255, Math.round((gSum / count) * 1.15));
          const bAvg = Math.min(255, Math.round((bSum / count) * 1.15));
          const rgb = `${rAvg}, ${gAvg}, ${bAvg}`;
          coverColorCache.set(videoId, rgb);
          onColor(rgb);
        }
      } catch {
        // Canvas tainted by cross-origin policy — keep deterministic fallbackRgb
        coverColorCache.set(videoId, fallbackRgb);
      }
    };
    img.onerror = () => {
      coverColorCache.set(videoId, fallbackRgb);
    };
    img.src = normalizeSquareThumbnail(thumbnailUrl, videoId);
  } catch {
    coverColorCache.set(videoId, fallbackRgb);
  }
}

const verifiedThumbnailCache = new Map<string, string>();

interface HighResThumbnailProps {
  videoId: string;
  rawThumbnail?: string;
  alt: string;
  aspect?: 'square' | 'video';
  className?: string;
  loading?: 'eager' | 'lazy';
}

const HighResThumbnail = memo(
  ({
    videoId,
    rawThumbnail,
    alt,
    aspect = 'square',
    className = '',
    loading = 'eager',
  }: HighResThumbnailProps) => {
    const isGoogleCdn =
      Boolean(rawThumbnail) &&
      (rawThumbnail!.includes('googleusercontent.com') || rawThumbnail!.includes('ggpht.com'));

    const initialSrc = isGoogleCdn
      ? rawThumbnail!.replace(/=w\d+-h\d+[^&?]*/, '=w512-h512-l90-rj')
      : verifiedThumbnailCache.get(videoId) ||
        (videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : rawThumbnail || '');

    const [src, setSrc] = useState<string>(initialSrc);
    const [isLoaded, setIsLoaded] = useState<boolean>(() => verifiedThumbnailCache.has(videoId));
    const fallbackStepRef = useRef<number>(0);

    useEffect(() => {
      fallbackStepRef.current = 0;
      if (isGoogleCdn) {
        setSrc(rawThumbnail!.replace(/=w\d+-h\d+[^&?]*/, '=w512-h512-l90-rj'));
        setIsLoaded(true);
      } else {
        const cached = verifiedThumbnailCache.get(videoId);
        if (cached) {
          setSrc(cached);
          setIsLoaded(true);
        } else if (videoId) {
          setSrc(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
          setIsLoaded(false);
        }
      }
    }, [videoId, rawThumbnail, isGoogleCdn]);

    const handleStepDown = useCallback(() => {
      if (isGoogleCdn || !videoId) return;
      fallbackStepRef.current += 1;
      const step = fallbackStepRef.current;
      let nextSrc = '';
      if (step === 1) {
        nextSrc = `https://i.ytimg.com/vi/${videoId}/hq720.jpg`;
      } else if (step === 2) {
        nextSrc = `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`;
      } else if (step === 3) {
        nextSrc = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
      } else if (step === 4) {
        nextSrc = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      }
      if (nextSrc) {
        setSrc(nextSrc);
      }
    }, [videoId, isGoogleCdn]);

    const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      // YouTube returns a 120x90 placeholder when maxresdefault does not exist
      if (!isGoogleCdn && img.naturalWidth > 0 && img.naturalWidth <= 120 && fallbackStepRef.current === 0) {
        handleStepDown();
        return;
      }
      setIsLoaded(true);
      if (videoId && src) {
        verifiedThumbnailCache.set(videoId, src);
      }
    };

    return (
      <div className="absolute inset-0 w-full h-full overflow-hidden bg-black/40">
        {!isLoaded && (
          <div className="absolute inset-0 bg-white/5 animate-pulse pointer-events-none" />
        )}
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={handleLoad}
          onError={handleStepDown}
          className={`absolute inset-0 w-full h-full object-cover object-center block transition-opacity duration-200 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          } ${className}`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center',
          }}
        />
      </div>
    );
  }
);

interface MemoSongRowProps {
  song: YouTubeTrack;
  idx: number;
  isCurrent: boolean;
  isRowPlaying: boolean;
  isFav: boolean;
  queueContext: YouTubeTrack[];
  queueLabel: string;
  showPlaylistRemoveId?: string;
  showQueueControls?: boolean;
  totalInQueue?: number;
  onPreCue: (track: YouTubeTrack) => void;
  onSelect: (
    track: YouTubeTrack,
    context: YouTubeTrack[],
    label: string,
    keepQueue?: boolean
  ) => void;
  onToggleFavorite: (track: YouTubeTrack) => void;
  onOpenPlaylistModal: (track: YouTubeTrack) => void;
  onAddToQueue: (track: YouTubeTrack) => void;
  onRemoveFromPlaylist: (playlistId: string, videoId: string) => void;
  onMoveQueueItem: (index: number, direction: 'up' | 'down') => void;
  onRemoveFromQueue: (videoId: string) => void;
}

const MemoSongRow = memo(
  ({
    song,
    idx,
    isCurrent,
    isRowPlaying,
    isFav,
    queueContext,
    queueLabel,
    showPlaylistRemoveId,
    showQueueControls,
    totalInQueue,
    onPreCue,
    onSelect,
    onToggleFavorite,
    onOpenPlaylistModal,
    onAddToQueue,
    onRemoveFromPlaylist,
    onMoveQueueItem,
    onRemoveFromQueue,
  }: MemoSongRowProps) => (
    <div
      onMouseEnter={() => onPreCue(song)}
      onTouchStart={() => onPreCue(song)}
      onClick={() => onSelect(song, queueContext, queueLabel, Boolean(showQueueControls))}
      style={{
        backgroundColor: isCurrent ? 'var(--ytm-accent-soft)' : 'transparent',
        borderColor: isCurrent ? 'var(--ytm-accent)' : 'transparent',
      }}
      className="cv-row-auto group flex items-center gap-3 px-2.5 sm:px-3 py-2 rounded-xl border transition-transform cursor-pointer select-none hover:opacity-95 active:scale-[0.97]"
    >
      {/* Thumbnail with play overlay */}
      <div
        style={{ backgroundColor: 'var(--ytm-surface-elevated)' }}
        className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-lg overflow-hidden shrink-0"
      >
        <HighResThumbnail
          videoId={song.videoId}
          rawThumbnail={song.thumbnail}
          alt={song.title}
          aspect="square"
          loading="lazy"
          className="w-full h-full object-cover"
        />
        <div
          className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity ${
            isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {isRowPlaying ? (
            <div className="flex items-end gap-0.5 h-3.5">
              <span style={{ backgroundColor: 'var(--ytm-accent)' }} className="w-0.5 h-2 rounded-full animate-pulse" />
              <span style={{ backgroundColor: 'var(--ytm-accent)' }} className="w-0.5 h-3.5 rounded-full animate-bounce" />
              <span style={{ backgroundColor: 'var(--ytm-accent)' }} className="w-0.5 h-2.5 rounded-full animate-pulse" />
            </div>
          ) : (
            <Play className="w-4 h-4 text-white fill-white ml-0.5" />
          )}
        </div>
      </div>

      {/* Title & Artist */}
      <div className="min-w-0 flex-1">
        <p
          style={{ color: isCurrent ? 'var(--ytm-accent)' : 'var(--ytm-text)' }}
          className="text-xs sm:text-sm font-semibold truncate"
        >
          {song.title}
        </p>
        <p
          style={{ color: 'var(--ytm-text-muted)' }}
          className="text-[11px] sm:text-xs truncate"
        >
          {song.artist}
          {song.album ? ` • ${song.album}` : ''}
        </p>
      </div>

      {/* Duration */}
      {song.durationText && !showQueueControls && (
        <span
          style={{ color: 'var(--ytm-text-muted)' }}
          className="hidden sm:inline-block text-xs font-mono tabular-nums shrink-0"
        >
          {song.durationText}
        </span>
      )}

      {/* Action Buttons */}
      <div
        className="flex items-center gap-0.5 sm:gap-1 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onToggleFavorite(song)}
          style={{ color: isFav ? 'var(--ytm-accent)' : 'var(--ytm-text-muted)' }}
          className="p-2 rounded-full transition-colors cursor-pointer active:scale-[0.97]"
          title={isFav ? 'Remove from Liked songs' : 'Add to Liked songs'}
          aria-label="Like song"
        >
          <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
        </button>

        <button
          type="button"
          onClick={() => onOpenPlaylistModal(song)}
          style={{ color: 'var(--ytm-text-muted)' }}
          className="p-2 rounded-full transition-colors cursor-pointer active:scale-[0.97]"
          title="Save to playlist"
          aria-label="Save to playlist"
        >
          <Plus className="w-4 h-4" />
        </button>

        {!showQueueControls && (
          <button
            type="button"
            onClick={() => onAddToQueue(song)}
            style={{ color: 'var(--ytm-text-muted)' }}
            className="hidden sm:inline-flex p-2 rounded-full transition-colors cursor-pointer active:scale-[0.97]"
            title="Add to Up Next queue"
            aria-label="Add to Up Next queue"
          >
            <ListMusic className="w-4 h-4" />
          </button>
        )}

        {showPlaylistRemoveId && (
          <button
            type="button"
            onClick={() => onRemoveFromPlaylist(showPlaylistRemoveId, song.videoId)}
            style={{ color: 'var(--ytm-text-muted)' }}
            className="p-2 rounded-full transition-colors cursor-pointer active:scale-[0.97]"
            title="Remove from playlist"
            aria-label="Remove from playlist"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        {showQueueControls && (
          <>
            <button
              type="button"
              disabled={idx === 0}
              onClick={() => onMoveQueueItem(idx, 'up')}
              style={{ color: 'var(--ytm-text-muted)' }}
              className="p-1.5 rounded-lg disabled:opacity-25 cursor-pointer active:scale-[0.97]"
              title="Move up"
              aria-label="Move track up"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={idx === (totalInQueue || 1) - 1}
              onClick={() => onMoveQueueItem(idx, 'down')}
              style={{ color: 'var(--ytm-text-muted)' }}
              className="p-1.5 rounded-lg disabled:opacity-25 cursor-pointer active:scale-[0.97]"
              title="Move down"
              aria-label="Move track down"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onRemoveFromQueue(song.videoId)}
              style={{ color: 'var(--ytm-text-muted)' }}
              className="p-1.5 rounded-lg cursor-pointer active:scale-[0.97]"
              title="Remove from queue"
              aria-label="Remove track from queue"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
);

interface MemoTrackCardProps {
  song: YouTubeTrack;
  isCurrent: boolean;
  isRowPlaying: boolean;
  isFav: boolean;
  queueContext: YouTubeTrack[];
  queueLabel: string;
  forceSongCatalog?: boolean;
  variant: 'carousel' | 'grid';
  onPreCue: (track: YouTubeTrack) => void;
  onSelect: (track: YouTubeTrack, context: YouTubeTrack[], label: string) => void;
  onToggleFavorite: (track: YouTubeTrack) => void;
}

const MemoTrackCard = memo(
  ({
    song,
    isCurrent,
    isRowPlaying,
    isFav,
    queueContext,
    queueLabel,
    forceSongCatalog = false,
    variant,
    onPreCue,
    onSelect,
    onToggleFavorite,
  }: MemoTrackCardProps) => {
    const isCarousel = variant === 'carousel';
    return (
      <div
        onMouseEnter={() => onPreCue(song)}
        onTouchStart={() => onPreCue(song)}
        onClick={() =>
          onSelect(
            forceSongCatalog
              ? { ...song, mediaType: 'song', catalogSource: 'youtube_music' }
              : song,
            queueContext,
            queueLabel
          )
        }
        style={{
          backgroundColor: 'var(--ytm-surface)',
          borderColor: isCurrent ? 'var(--ytm-accent)' : 'var(--ytm-border)',
        }}
        className={
          isCarousel
            ? 'snap-start group w-[142px] min-w-[142px] max-w-[142px] sm:w-[172px] sm:min-w-[172px] sm:max-w-[172px] shrink-0 rounded-2xl p-2.5 sm:p-3 border transition-transform cursor-pointer flex flex-col justify-between overflow-hidden shadow-xs active:scale-[0.97]'
            : 'cv-card-auto group rounded-2xl border p-2.5 transition-transform cursor-pointer flex flex-col overflow-hidden shadow-xs active:scale-[0.97]'
        }
      >
        <div
          style={{ backgroundColor: 'var(--ytm-surface-elevated)' }}
          className={`relative w-full aspect-square rounded-xl overflow-hidden ${isCarousel ? 'mb-2.5 shadow-sm' : 'mb-2'} shrink-0`}
        >
          <HighResThumbnail
            videoId={song.videoId}
            rawThumbnail={song.thumbnail}
            alt={song.title}
            aspect="square"
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          <div
            className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${
              isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <div
              style={{ backgroundColor: 'var(--ytm-accent)' }}
              className="w-10 h-10 rounded-full text-white flex items-center justify-center shadow-lg transform group-hover:scale-105 transition-transform"
            >
              {isRowPlaying ? (
                <Pause className={`${isCarousel ? 'w-5 h-5' : 'w-4.5 h-4.5'} fill-white`} />
              ) : (
                <Play className={`${isCarousel ? 'w-5 h-5' : 'w-4.5 h-4.5'} fill-white ml-0.5`} />
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(song);
            }}
            className={`absolute top-2 right-2 w-7 h-7 rounded-full text-white flex items-center justify-center transition-transform active:scale-[0.97] ${
              isCarousel
                ? 'bg-black/60 opacity-0 group-hover:opacity-100 hover:scale-110'
                : 'bg-black/55'
            }`}
            aria-label="Like track"
          >
            <Heart
              className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`}
              style={{ color: isFav ? 'var(--ytm-accent)' : '#ffffff' }}
            />
          </button>
        </div>
        <div className="min-w-0 w-full overflow-hidden">
          <p
            style={{ color: isCurrent ? 'var(--ytm-accent)' : 'var(--ytm-text)' }}
            className={
              isCarousel
                ? 'block text-xs sm:text-sm font-bold truncate whitespace-nowrap'
                : 'text-xs sm:text-sm font-bold truncate leading-snug'
            }
          >
            {song.title}
          </p>
          <p
            style={{ color: 'var(--ytm-text-muted)' }}
            className={
              isCarousel
                ? 'block text-[11px] truncate whitespace-nowrap mt-0.5'
                : 'text-[11px] truncate mt-0.5'
            }
          >
            {song.artist}
          </p>
        </div>
      </div>
    );
  }
);

interface DarlingMusicPlayerProps {
  activeTab: NavTab;
  recipientName?: string;
  userId?: string;
  currentTheme?: string;
}

export const DarlingMusicPlayer: React.FC<DarlingMusicPlayerProps> = ({
  activeTab,
  recipientName = 'Darling',
  userId = 'guest',
  currentTheme = 'default',
}) => {
  const isLightTheme = currentTheme === 'light' || currentTheme === 'pastel';
  const [slotElement, setSlotElement] = useState<HTMLElement | null>(null);
  const [isFullSearchOpen, setIsFullSearchOpen] = useState<boolean>(false);

  // User-scoped initial state: restore this specific user's last search, recent searches, and last played song
  const [searchQuery, setSearchQuery] = useState<string>(
    () => loadUserLastSearch(userId)?.query || ''
  );
  const [tracks, setTracks] = useState<YouTubeTrack[]>(
    () => loadUserLastSearch(userId)?.results || []
  );
  const [videoTracks, setVideoTracks] = useState<YouTubeTrack[]>(
    () => loadUserLastSearch(userId)?.videoResults || []
  );
  const [activeResultSection, setActiveResultSection] = useState<'discover' | 'songs' | 'videos'>('songs');
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    loadUserRecentSearches(userId)
  );
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => loadUserFavorites(userId));
  const [favoriteTracks, setFavoriteTracks] = useState<YouTubeTrack[]>(() =>
    loadUserFavoriteTracks(userId)
  );

  const handleToggleFavorite = useCallback((track: YouTubeTrack) => {
    triggerHaptic(20);
    const canonical = resolveCanonicalTrack(track);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      const isRemoving = next.has(canonical.videoId);
      if (isRemoving) {
        next.delete(canonical.videoId);
        setStatusNotice(`Removed "${canonical.title}" from favorites`);
      } else {
        next.add(canonical.videoId);
        setStatusNotice(`Added "${canonical.title}" to favorites ❤️`);
      }
      saveUserFavorites(userId, next);
      setFavoriteTracks((prevTracks) => {
        const filtered = prevTracks.filter((t) => t.videoId !== canonical.videoId);
        const nextTracks = isRemoving ? filtered : [canonical, ...filtered];
        saveUserFavoriteTracks(userId, nextTracks);
        return nextTracks;
      });
      return next;
    });
  }, [userId]);
  const [currentTrack, setCurrentTrack] = useState<YouTubeTrack | null>(() => {
    const saved = loadUserLastPlayedTrack(userId);
    return saved ? resolveCanonicalTrack(saved) : null;
  });
  const [recentPlayedTracks, setRecentPlayedTracks] = useState<YouTubeTrack[]>(() =>
    loadUserRecentPlayedTracks(userId).map((t) => resolveCanonicalTrack(t))
  );

  const [isSearching, setIsSearching] = useState(false);
  const [isSearchingVideos, setIsSearchingVideos] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isListExpanded, setIsListExpanded] = useState<boolean>(false);
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [volume, setVolume] = useState<number>(90);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showVideoViewport, setShowVideoViewport] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [isMiniExpanded, setIsMiniExpanded] = useState<boolean>(false);

  const [repeatMode, setRepeatMode] = useState<'off' | 'one' | 'all'>(() => {
    if (typeof window === 'undefined') return 'off';
    try {
      const saved =
        window.localStorage.getItem(`kashish_music_repeat_mode_v1_${userId || 'guest'}`) ??
        window.localStorage.getItem('kashish_music_repeat_mode_v1');
      if (saved === 'off' || saved === 'one' || saved === 'all') {
        return saved;
      }
    } catch {}
    return 'off';
  });
  const [isShuffle, setIsShuffle] = useState<boolean>(false);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
  const [isSleepMenuOpen, setIsSleepMenuOpen] = useState<boolean>(false);
  const [isEqMenuOpen, setIsEqMenuOpen] = useState<boolean>(false);
  const [activeEqPreset, setActiveEqPreset] = useState<string>(() => {
    if (typeof window === 'undefined') return 'Flat';
    try {
      const raw = window.localStorage.getItem(`kashish_music_eq_v2_${userId || 'guest'}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.preset === 'string') return parsed.preset;
      }
    } catch {}
    return 'Flat';
  });
  const [eqBands, setEqBands] = useState<EqBandSettings>(() => {
    if (typeof window === 'undefined') return EQ_PRESETS['Flat'];
    try {
      const raw = window.localStorage.getItem(`kashish_music_eq_v2_${userId || 'guest'}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed?.bands &&
          typeof parsed.bands.bass === 'number' &&
          typeof parsed.bands.mid === 'number' &&
          typeof parsed.bands.treble === 'number'
        ) {
          return {
            bass: Math.max(-12, Math.min(12, parsed.bands.bass)),
            mid: Math.max(-12, Math.min(12, parsed.bands.mid)),
            treble: Math.max(-12, Math.min(12, parsed.bands.treble)),
          };
        }
      }
    } catch {}
    return EQ_PRESETS['Flat'];
  });
  const eqBandsRef = useRef<EqBandSettings>(eqBands);

  // Quality Toggle Button State (Default OFF = Low Quality / Data Saver; ON = High Quality with glow)
  const [isHighQuality, setIsHighQuality] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(`kashish_music_quality_hq_v1_${userId || 'guest'}`) === '1';
    } catch {
      return false;
    }
  });
  const isHighQualityRef = useRef<boolean>(isHighQuality);

  // Library / Active Queue Modal State
  const [isLibraryQueueOpen, setIsLibraryQueueOpen] = useState<boolean>(false);
  const [libraryTab, setLibraryTab] = useState<'queue' | 'favorites' | 'history'>('queue');

  // Explicit Active Playback Queue Synchronization State & Refs
  const [customQueue, setCustomQueue] = useState<YouTubeTrack[]>([]);
  const customQueueRef = useRef<YouTubeTrack[]>([]);
  const [activeQueueLabel, setActiveQueueLabel] = useState<string>('RELATED');
  const activeQueueLabelRef = useRef<string>('RELATED');
  const relatedTracksRef = useRef<YouTubeTrack[]>([]);
  const relatedMoodFilterRef = useRef<string>('context');

  // Track listening duration & playback watchdog refs
  const trackListenStartPerfRef = useRef<number | null>(null);
  const playbackWatchdogTimerRef = useRef<number | null>(null);

  const preFadeVolumeRef = useRef<number>(90);
  const isSleepFadingRef = useRef<boolean>(false);

  const handleToggleRepeat = () => {
    triggerHaptic(15);
    setRepeatMode((prev) => {
      const next: 'off' | 'one' | 'all' =
        prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off';
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(`kashish_music_repeat_mode_v1_${userId || 'guest'}`, next);
          window.localStorage.setItem('kashish_music_repeat_mode_v1', next);
        } catch {}
      }
      return next;
    });
  };

  const handleToggleShuffle = () => {
    triggerHaptic(15);
    setIsShuffle((prev) => !prev);
  };

  // Minimal Custom Kashish Video Player State & Controls
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const [isVideoFullscreen, setIsVideoFullscreen] = useState<boolean>(false);
  const [showVideoControls, setShowVideoControls] = useState<boolean>(true);
  const [isVideoQualityOpen, setIsVideoQualityOpen] = useState<boolean>(false);
  const [selectedQuality, setSelectedQuality] = useState<string>('Auto (HD)');
  const videoControlsTimerRef = useRef<number | null>(null);

  const resetVideoControlsTimer = useCallback(() => {
    setShowVideoControls(true);
    if (videoControlsTimerRef.current) {
      window.clearTimeout(videoControlsTimerRef.current);
    }
    videoControlsTimerRef.current = window.setTimeout(() => {
      setShowVideoControls((prev) => {
        if (!userWantPlayingRef.current) return true;
        return false;
      });
    }, 4500);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    triggerHaptic(15);
    const container = videoContainerRef.current;
    if (!container) return;
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen().then(() => {
          setIsVideoFullscreen(true);
        }).catch(() => {
          setIsVideoFullscreen((prev) => !prev);
        });
      } else if ((container as any).webkitRequestFullscreen) {
        try {
          (container as any).webkitRequestFullscreen();
          setIsVideoFullscreen(true);
        } catch {
          setIsVideoFullscreen((prev) => !prev);
        }
      } else {
        setIsVideoFullscreen((prev) => !prev);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
      setIsVideoFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsVideoFullscreen(Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      if (videoControlsTimerRef.current) {
        window.clearTimeout(videoControlsTimerRef.current);
      }
    };
  }, []);

  // Active playback backend: 'exo' (Native Android Media3 ExoPlayer), 'native' (Web HTML5 Audio), or 'yt' (YouTube IFrame)
  const playbackBackendRef = useRef<'native' | 'yt' | 'exo'>('yt');
  const loadedNativeVideoIdRef = useRef<string | null>(null);
  const loadedExoVideoIdRef = useRef<string | null>(null);
  const exoMetricsRef = useRef<{ videoId: string; currentTime: number; duration: number; state: string }>({
    videoId: '',
    currentTime: 0,
    duration: 0,
    state: 'idle',
  });

  // Official YouTube IFrame Player API singleton refs
  const playerRef = useRef<any>(null);
  const isPlayerReadyRef = useRef<boolean>(false);
  const isInitializingPlayerRef = useRef<boolean>(false);
  const loadedVideoIdInPlayerRef = useRef<string | null>(null);
  const userWantPlayingRef = useRef<boolean>(false);
  const volumeRef = useRef<number>(volume);
  const isMutedRef = useRef<boolean>(isMuted);
  const showVideoViewportRef = useRef<boolean>(showVideoViewport);

  const pendingTrackRef = useRef<YouTubeTrack | null>(null);
  const currentTrackRef = useRef<YouTubeTrack | null>(currentTrack);
  const tracksRef = useRef<YouTubeTrack[]>(tracks);
  const videoTracksRef = useRef<YouTubeTrack[]>(videoTracks);
  const activeResultSectionRef = useRef<'discover' | 'songs' | 'videos'>(activeResultSection);
  const userIdRef = useRef<string>(userId);
  const triedEmbedIdsRef = useRef<Set<string>>(new Set());
  const searchAbortRef = useRef<AbortController | null>(null);
  const activeSearchQueryRef = useRef<string>('');
  const debounceTimerRef = useRef<number | null>(null);
  const hasCompletedNetworkSearchRef = useRef<boolean>(false);

  // Real playback timing measurement refs (using performance.now())
  const tapTimestampRef = useRef<number | null>(null);
  const tapToReadyRecordedRef = useRef<number | null>(null);
  const firstAudioReachedRef = useRef<boolean>(false);
  const activeTelemetryEntryRef = useRef<PlaybackTelemetryEntry | null>(null);
  const lastPlayInitiatedAtRef = useRef<number>(0);
  const nativeNotifiedPlayingKeyRef = useRef<string | null>(null);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    videoTracksRef.current = videoTracks;
  }, [videoTracks]);

  useEffect(() => {
    customQueueRef.current = customQueue;
  }, [customQueue]);

  useEffect(() => {
    activeQueueLabelRef.current = activeQueueLabel;
  }, [activeQueueLabel]);

  useEffect(() => {
    isHighQualityRef.current = isHighQuality;
  }, [isHighQuality]);

  // Apply 3-Band Equalizer to Android Hardware DSP, Web Audio API graph, and YouTube IFrame preamp contour immediately
  useEffect(() => {
    eqBandsRef.current = eqBands;
    applyEqualizerToWebAudio(eqBands, activeEqPreset);
    if (playerRef.current && isPlayerReadyRef.current && !isMutedRef.current) {
      try {
        const eqMult = computeEqLoudnessMultiplier(eqBands);
        const scaledVol = Math.max(0, Math.min(100, Math.round(volumeRef.current * eqMult)));
        playerRef.current.setVolume(scaledVol);
      } catch {}
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          `kashish_music_eq_v2_${userIdRef.current || 'guest'}`,
          JSON.stringify({ preset: activeEqPreset, bands: eqBands })
        );
      } catch {}
    }
  }, [eqBands, activeEqPreset]);

  const switchActiveTrackToWebAudioEqRef = useRef<() => void>(() => {});

  const handleSelectEqPreset = useCallback((presetName: string) => {
    triggerHaptic(15);
    ensureWebAudioEqGraph();
    const presetBands = EQ_PRESETS[presetName] || EQ_PRESETS.Flat;
    setActiveEqPreset(presetName);
    setEqBands({ ...presetBands });
    applyEqualizerToWebAudio(presetBands, presetName);
    if (presetName !== 'Flat') {
      switchActiveTrackToWebAudioEqRef.current();
    }
    showNativeToast(`Equalizer: ${presetName} active 🎚️`);
  }, []);

  const handleEqBandChange = useCallback((band: keyof EqBandSettings, dbValue: number) => {
    ensureWebAudioEqGraph();
    const clamped = Math.max(-12, Math.min(12, Math.round(dbValue)));
    setActiveEqPreset('Custom');
    setEqBands((prev) => {
      const next = { ...prev, [band]: clamped };
      applyEqualizerToWebAudio(next, 'Custom');
      return next;
    });
    switchActiveTrackToWebAudioEqRef.current();
  }, []);

  // Toggle Low Quality (Data Saver, glow OFF) vs High Quality (HD Audio/Video, glow ON)
  const handleToggleHighQuality = useCallback(() => {
    triggerHaptic(15);
    setIsHighQuality((prev) => {
      const next = !prev;
      isHighQualityRef.current = next;
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            `kashish_music_quality_hq_v1_${userIdRef.current || 'guest'}`,
            next ? '1' : '0'
          );
        } catch {}
      }
      if (playerRef.current && isPlayerReadyRef.current) {
        try {
          const targetQuality = next ? 'hd720' : showVideoViewportRef.current ? 'medium' : 'small';
          playerRef.current.setPlaybackQuality?.(targetQuality);
          playerRef.current.setPlaybackQualityRange?.(
            targetQuality,
            next ? 'hd1080' : targetQuality
          );
        } catch {}
      }
      setStatusNotice(next ? 'High Quality enabled ✨' : 'Data Saver / Standard Quality active');
      return next;
    });
  }, []);

  // Prefetch search result thumbnails instantly so images load with zero delay
  useEffect(() => {
    for (const t of tracks) {
      if (t.thumbnail) {
        const img = new Image();
        img.src = normalizeSquareThumbnail(t.thumbnail, t.videoId);
      }
    }
    for (const v of videoTracks) {
      if (v.videoId) {
        const img = new Image();
        img.src = `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`;
      }
    }
  }, [tracks, videoTracks]);

  // Pre-warm only the track's thumbnail artwork on hover/touchStart.
  // NEVER call cueVideoById on the singleton YouTube player during hover/scroll,
  // because cueVideoById immediately stops active playback and desynchronizes loadedVideoIdInPlayerRef from currentTrack!
  const handlePreCueTrack = useCallback((track: YouTubeTrack) => {
    if (!track?.videoId) return;
    const canonical = resolveCanonicalTrack(track);
    if (canonical.thumbnail) {
      const img = new Image();
      img.src = canonical.thumbnail;
    }
  }, []);

  useEffect(() => {
    activeResultSectionRef.current = activeResultSection;
  }, [activeResultSection]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    showVideoViewportRef.current = showVideoViewport;
  }, [showVideoViewport]);

  // Isolate search history and playback state when userId changes (e.g. sign-in / sign-out / account switch)
  useEffect(() => {
    if (userIdRef.current === userId) return;
    userIdRef.current = userId;

    // Pause any active playback from previous user session
    userWantPlayingRef.current = false;
    setIsPlaying(false);
    setIsBuffering(false);
    const nativeAudio = getTopLevelNativeAudioElement();
    if (nativeAudio) {
      try {
        nativeAudio.pause();
        nativeAudio.removeAttribute('src');
        loadedNativeVideoIdRef.current = null;
      } catch {}
    }
    if (hasNativeExoPlayer()) {
      try {
        window.AndroidApp?.nativeStopTrack?.();
        loadedExoVideoIdRef.current = null;
        exoMetricsRef.current = { videoId: '', currentTime: 0, duration: 0, state: 'idle' };
      } catch {}
    }
    if (playerRef.current && isPlayerReadyRef.current) {
      try {
        playerRef.current.stopVideo?.();
        loadedVideoIdInPlayerRef.current = null;
      } catch {}
    }

    const savedPlayed = loadUserLastPlayedTrack(userId);
    const savedSearch = loadUserLastSearch(userId);
    const savedRecent = loadUserRecentSearches(userId);
    const savedRecentPlayed = loadUserRecentPlayedTracks(userId).map((t) =>
      resolveCanonicalTrack(t)
    );

    const canonicalPlayed = savedPlayed ? resolveCanonicalTrack(savedPlayed) : null;
    currentTrackRef.current = canonicalPlayed;
    setCurrentTrack(canonicalPlayed);
    setSearchQuery(savedSearch?.query || '');
    setTracks(savedSearch?.results || []);
    setVideoTracks(savedSearch?.videoResults || []);
    setRecentSearches(savedRecent);
    setRecentPlayedTracks(savedRecentPlayed);
    setFavoriteIds(loadUserFavorites(userId));
    setFavoriteTracks(loadUserFavoriteTracks(userId));
    setSearchError(null);
    setStatusNotice(null);
    if (typeof window !== 'undefined') {
      try {
        const savedRepeat =
          window.localStorage.getItem(`kashish_music_repeat_mode_v1_${userId || 'guest'}`) ??
          window.localStorage.getItem('kashish_music_repeat_mode_v1');
        if (savedRepeat === 'off' || savedRepeat === 'one' || savedRepeat === 'all') {
          setRepeatMode(savedRepeat);
        } else {
          setRepeatMode('off');
        }
      } catch {
        setRepeatMode('off');
      }
    }
  }, [userId]);

  // Locate #darling-player-slot whenever Melodies (or inline slot) mounts
  useEffect(() => {
    if (activeTab !== 'melodies') {
      setSlotElement(null);
      return;
    }
    const findSlot = () => {
      const el = document.getElementById('darling-player-slot');
      if (el) {
        setSlotElement(el);
        return true;
      }
      return false;
    };

    if (!findSlot()) {
      const raf = window.requestAnimationFrame(() => {
        findSlot();
      });
      return () => window.cancelAnimationFrame(raf);
    }
  }, [activeTab]);

  // Unified playback metrics getter for progress scrubber and Media Session
  const getPlaybackMetrics = useCallback((): { currentTime: number; duration: number } => {
    if (playbackBackendRef.current === 'exo') {
      const m = exoMetricsRef.current;
      const cur = Number.isFinite(m.currentTime) ? m.currentTime : 0;
      const dur =
        Number.isFinite(m.duration) && m.duration > 0
          ? m.duration
          : currentTrackRef.current?.durationSeconds || 0;
      return { currentTime: cur, duration: dur };
    }
    if (playbackBackendRef.current === 'native') {
      const nativeAudio = getTopLevelNativeAudioElement();
      if (nativeAudio && loadedNativeVideoIdRef.current) {
        const cur = Number.isFinite(nativeAudio.currentTime) ? nativeAudio.currentTime : 0;
        const dur =
          Number.isFinite(nativeAudio.duration) && nativeAudio.duration > 0
            ? nativeAudio.duration
            : currentTrackRef.current?.durationSeconds || 0;
        return { currentTime: cur, duration: dur };
      }
    }
    const p = playerRef.current;
    if (p && isPlayerReadyRef.current && typeof p.getCurrentTime === 'function') {
      try {
        const cur = p.getCurrentTime() || 0;
        const dur = p.getDuration() || currentTrackRef.current?.durationSeconds || 0;
        return { currentTime: cur, duration: dur };
      } catch {}
    }
    return { currentTime: 0, duration: currentTrackRef.current?.durationSeconds || 0 };
  }, []);

  // Seek handler for Native ExoPlayer, HTML5 <audio>, and YouTube IFrame Player API + MediaSession position sync
  const handleSeekTo = useCallback((seconds: number) => {
    const safeSec = Math.max(0, seconds);
    let effectiveDur = currentTrackRef.current?.durationSeconds || 0;

    if (playbackBackendRef.current === 'exo') {
      try {
        window.AndroidApp?.nativeSeekTrack?.(safeSec);
        exoMetricsRef.current.currentTime = safeSec;
        if (exoMetricsRef.current.duration > 0) {
          effectiveDur = exoMetricsRef.current.duration;
        }
        if (effectiveDur > 0) {
          updateMediaSessionPosition(safeSec, effectiveDur);
        }
      } catch {}
    } else if (playbackBackendRef.current === 'native') {
      const nativeAudio = getTopLevelNativeAudioElement();
      if (nativeAudio && loadedNativeVideoIdRef.current) {
        try {
          nativeAudio.currentTime = safeSec;
          if (Number.isFinite(nativeAudio.duration) && nativeAudio.duration > 0) {
            effectiveDur = nativeAudio.duration;
          }
          if (effectiveDur > 0) {
            updateMediaSessionPosition(safeSec, effectiveDur);
          }
        } catch {}
      }
    } else {
      const p = playerRef.current;
      if (p && isPlayerReadyRef.current && typeof p.seekTo === 'function') {
        try {
          p.seekTo(safeSec, true);
          const dur = typeof p.getDuration === 'function' ? p.getDuration() : 0;
          if (dur > 0) effectiveDur = dur;
          if (effectiveDur > 0) {
            updateMediaSessionPosition(safeSec, effectiveDur);
          }
        } catch {}
      }
    }

    if (! userWantPlayingRef.current) {
      const track = currentTrackRef.current;
      if (track) {
        try {
          const thumbUrl = normalizeSquareThumbnail(track.thumbnail, track.videoId);
          window.AndroidApp?.updateMusicNotificationWithPosition?.(
            track.title,
            track.artist,
            thumbUrl,
            false,
            Math.max(0, Math.floor(safeSec)),
            Math.max(0, Math.floor(effectiveDur))
          );
          window.AndroidApp?.abandonAudioFocus?.();
        } catch {}
      }
    }
  }, []);

  const bindMediaSessionHandlersRef = useRef<() => void>(() => {});

  const applyMediaMetadata = useCallback(
    (track: YouTubeTrack | null, playing: boolean) => {
      if (!track) {
        nativeNotifiedPlayingKeyRef.current = null;
        try {
          if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
            navigator.mediaSession.metadata = null;
            navigator.mediaSession.playbackState = 'none';
          }
          window.AndroidApp?.dismissMusicNotification?.();
          window.AndroidApp?.abandonAudioFocus?.();
        } catch {}
        return;
      }

      const toAbsolute = (url: string) => {
        try {
          if (typeof window !== 'undefined' && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:')) {
            return new URL(url, window.location.href).href;
          }
        } catch {}
        return url;
      };
      const hasNativeAndroidBridge =
        typeof window !== 'undefined' && Boolean(window.AndroidApp);
      const nativeHttpThumb = toAbsolute(
        verifiedThumbnailCache.get(track.videoId) ||
          normalizeSquareThumbnail(track.thumbnail, track.videoId)
      );
      const artworkList = buildMediaArtworkList(track.thumbnail, track.videoId);
      const { currentTime, duration } = getPlaybackMetrics();
      const effectiveDur =
        duration > 0
          ? duration
          : track.durationSeconds && track.durationSeconds > 0
          ? track.durationSeconds
          : 215;

      // Ensure 1:1 512x512 square cover art is generated for Web MediaSession
      if (!hasNativeAndroidBridge && !squareArtworkDataCache.has(track.videoId)) {
        ensureSquareArtworkForTrack(track.videoId, track.thumbnail, () => {
          if (currentTrackRef.current?.videoId === track.videoId) {
            try {
              if (
                typeof navigator !== 'undefined' &&
                'mediaSession' in navigator &&
                typeof (window as any).MediaMetadata !== 'undefined'
              ) {
                navigator.mediaSession.metadata = new window.MediaMetadata({
                  title: track.title,
                  artist: track.artist,
                  album: track.album || `Kashish's World · Melodies for ${recipientName}`,
                  artwork: buildMediaArtworkList(track.thumbnail, track.videoId),
                });
              }
            } catch {}
          }
        });
      }

      if (
        typeof navigator !== 'undefined' &&
        'mediaSession' in navigator &&
        typeof window !== 'undefined' &&
        typeof (window as any).MediaMetadata !== 'undefined'
      ) {
        try {
          bindMediaSessionHandlersRef.current();
          navigator.mediaSession.metadata = new window.MediaMetadata({
            title: track.title,
            artist: track.artist,
            album: track.album || `Kashish's World · Melodies for ${recipientName}`,
            artwork: artworkList,
          });
          navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
          updateMediaSessionPosition(currentTime, effectiveDur);
        } catch {}
      }

      // Keep native Android notification panel and lock-screen media controls active
      try {
        if (!playing) {
          nativeNotifiedPlayingKeyRef.current = null;
          if (typeof window.AndroidApp?.updateMusicNotificationWithPosition === 'function') {
            window.AndroidApp.updateMusicNotificationWithPosition(
              track.title,
              track.artist,
              nativeHttpThumb,
              false,
              Math.max(0, Math.floor(currentTime || 0)),
              Math.max(1, Math.floor(effectiveDur))
            );
          } else {
            window.AndroidApp?.updateMusicNotification?.(
              track.title,
              track.artist,
              nativeHttpThumb,
              false
            );
          }
          window.AndroidApp?.abandonAudioFocus?.();
        } else {
          nativeNotifiedPlayingKeyRef.current = track.videoId;
          if (typeof window.AndroidApp?.updateMusicNotificationWithPosition === 'function') {
            window.AndroidApp.updateMusicNotificationWithPosition(
              track.title,
              track.artist,
              nativeHttpThumb,
              true,
              Math.max(0, Math.floor(currentTime || 0)),
              Math.max(1, Math.floor(effectiveDur))
            );
          } else {
            window.AndroidApp?.updateMusicNotification?.(
              track.title,
              track.artist,
              nativeHttpThumb,
              true
            );
          }
        }
      } catch {}
    },
    [getPlaybackMetrics, recipientName]
  );

  // Update Media Session & Native Android notification whenever currentTrack or isPlaying changes
  useEffect(() => {
    applyMediaMetadata(currentTrack, isPlaying);
  }, [currentTrack, isPlaying, applyMediaMetadata]);

  // Automatically drop YouTube video stream decoding to 'small' while the app is in the background
  // so 0% GPU/CPU is wasted decoding high-res video frames while heavy foreground apps are running
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleBgTransition = (e: Event) => {
      const isBg = Boolean((e as CustomEvent)?.detail?.backgrounded);
      const p = playerRef.current;
      if (!p || !isPlayerReadyRef.current) return;
      try {
        if (isBg) {
          p.setPlaybackQuality?.('small');
          p.setPlaybackQualityRange?.('small', 'small');
        } else {
          const restoredQuality = isHighQualityRef.current
            ? 'hd720'
            : showVideoViewportRef.current
            ? 'default'
            : 'small';
          p.setPlaybackQuality?.(restoredQuality);
          p.setPlaybackQualityRange?.(restoredQuality, isHighQualityRef.current ? 'hd1080' : restoredQuality);
        }
      } catch {}
    };
    window.addEventListener('kashish-app-background-state', handleBgTransition);
    return () => {
      window.removeEventListener('kashish-app-background-state', handleBgTransition);
    };
  }, []);

  // Lightweight background MediaSession position sync (without re-sending full metadata/bitmaps every 4s)
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    let lastKnownDur = 0;

    const syncTick = () => {
      const tr = currentTrackRef.current;
      if (!tr || !userWantPlayingRef.current) return;
      const { currentTime, duration } = getPlaybackMetrics();
      const effectiveDur =
        duration > 0
          ? duration
          : tr.durationSeconds && tr.durationSeconds > 0
          ? tr.durationSeconds
          : 215;

      updateMediaSessionPosition(currentTime, effectiveDur);

      const durJustResolved = duration > 0 && lastKnownDur === 0;
      if (durJustResolved) {
        lastKnownDur = duration;
        applyMediaMetadata(tr, true);
      }
    };

    const timerId = window.setInterval(syncTick, 3000);
    return () => window.clearInterval(timerId);
  }, [isPlaying, currentTrack, getPlaybackMetrics, applyMediaMetadata]);

  // Pause helper (used by UI, Media Session, and voice note recording event)
  const pausePlayback = useCallback(() => {
    userWantPlayingRef.current = false;
    nativeNotifiedPlayingKeyRef.current = null;
    setIsPlaying(false);
    setIsBuffering(false);

    if (hasNativeExoPlayer()) {
      try {
        window.AndroidApp?.nativePauseTrack?.();
      } catch {}
    }

    const nativeAudio = getTopLevelNativeAudioElement();
    if (nativeAudio && !nativeAudio.paused) {
      try {
        nativeAudio.pause();
      } catch {}
    }

    const carrier = getTopLevelAudioCarrier();
    if (carrier && !carrier.paused) {
      try {
        carrier.pause();
      } catch {}
    }

    if (playerRef.current && isPlayerReadyRef.current) {
      try {
        playerRef.current.pauseVideo?.();
      } catch {}
    }

    try {
      window.AndroidApp?.abandonAudioFocus?.();
    } catch {}

    if (currentTrackRef.current) {
      applyMediaMetadata(currentTrackRef.current, false);
    }
  }, [applyMediaMetadata]);

  // Listen for voice-recording start or external audio blocks so music pauses cleanly
  useEffect(() => {
    const onExternalPauseRequest = () => {
      pausePlayback();
    };
    window.addEventListener('kashish-pause-darling-player', onExternalPauseRequest);
    return () => {
      window.removeEventListener('kashish-pause-darling-player', onExternalPauseRequest);
    };
  }, [pausePlayback]);

  // Load Official YouTube IFrame Player API once and initialize singleton player
  const ensureYouTubePlayer = useCallback(() => {
    if (playerRef.current || isInitializingPlayerRef.current || typeof window === 'undefined') {
      return;
    }

    const createPlayerInstance = () => {
      if (
        playerRef.current ||
        isInitializingPlayerRef.current ||
        !window.YT ||
        !window.YT.Player
      ) {
        return;
      }
      const wrapperEl = document.getElementById('kashish-yt-iframe-wrapper');
      if (!wrapperEl) return;

      let hostEl = document.getElementById('kashish-yt-iframe-target');
      if (!hostEl) {
        hostEl = document.createElement('div');
        hostEl.id = 'kashish-yt-iframe-target';
        hostEl.className = 'w-full h-full';
        wrapperEl.appendChild(hostEl);
      }

      isInitializingPlayerRef.current = true;
      const shouldAutoplayInitial = Boolean(
        pendingTrackRef.current && userWantPlayingRef.current
      );
      const initialVideoId =
        pendingTrackRef.current?.videoId ||
        currentTrackRef.current?.videoId ||
        tracksRef.current[0]?.videoId ||
        'Umqb9KENgmk';

      const playerVars: Record<string, any> = {
        autoplay: shouldAutoplayInitial ? 1 : 0,
        controls: 0,
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        fs: 0,
        iv_load_policy: 3,
        disablekb: 1,
        enablejsapi: 1,
      };
      if (typeof window !== 'undefined' && window.location.origin.startsWith('http')) {
        playerVars.origin = window.location.origin;
      }

      const playerConfig: Record<string, any> = {
        height: '200',
        width: '200',
        videoId: initialVideoId,
        playerVars,
        events: {
          onReady: (event: any) => {
            isPlayerReadyRef.current = true;
            isInitializingPlayerRef.current = false;

            const store = ensureMetricsStore();
            if (store && store.playerPrewarmedAtMs === null) {
              store.playerPrewarmedAtMs = Math.round(performance.now());
            }

            try {
              const iframeEl = event?.target?.getIframe?.() as HTMLIFrameElement | undefined;
              if (iframeEl) {
                iframeEl.style.width = '100%';
                iframeEl.style.height = '100%';
                iframeEl.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
              }
            } catch {}

            try {
              const eqMult = computeEqLoudnessMultiplier(eqBandsRef.current);
              const initialVol = Math.max(
                0,
                Math.min(100, Math.round(volumeRef.current * eqMult))
              );
              event.target.setVolume(initialVol);
              if (isMutedRef.current) {
                event.target.mute();
              }
              const targetQuality = isHighQualityRef.current
                ? 'hd720'
                : showVideoViewportRef.current
                ? 'default'
                : 'small';

              if (pendingTrackRef.current && userWantPlayingRef.current) {
                const trackToPlay = pendingTrackRef.current;
                pendingTrackRef.current = null;
                if (tapTimestampRef.current !== null && tapToReadyRecordedRef.current === null) {
                  const readyDelta = Math.round(performance.now() - tapTimestampRef.current);
                  tapToReadyRecordedRef.current = readyDelta;
                  if (activeTelemetryEntryRef.current) {
                    activeTelemetryEntryRef.current.tapToPlayerReadyMs = readyDelta;
                  }
                }
                const playableId = getKnownPlayableVideoId(trackToPlay.videoId);
                loadedVideoIdInPlayerRef.current = playableId;
                event.target.loadVideoById({
                  videoId: playableId,
                  suggestedQuality: targetQuality,
                });
                event.target.playVideo();
              } else if (currentTrackRef.current && !userWantPlayingRef.current) {
                // Pre-cue the restored last-played track without autoplaying
                const playableId = getKnownPlayableVideoId(currentTrackRef.current.videoId);
                loadedVideoIdInPlayerRef.current = playableId;
                event.target.cueVideoById({
                  videoId: playableId,
                  suggestedQuality: 'small',
                });
              } else if (!userWantPlayingRef.current) {
                loadedVideoIdInPlayerRef.current = initialVideoId;
                event.target.cueVideoById({
                  videoId: initialVideoId,
                  suggestedQuality: 'small',
                });
              }
            } catch {}
          },
          onStateChange: (event: any) => {
            const state = event.data;
            // YT.PlayerState: PLAYING = 1, PAUSED = 2, BUFFERING = 3, ENDED = 0, CUED = 5
            if (state === 1) {
              if (playbackWatchdogTimerRef.current) {
                window.clearTimeout(playbackWatchdogTimerRef.current);
                playbackWatchdogTimerRef.current = null;
              }
              if (!firstAudioReachedRef.current) {
                firstAudioReachedRef.current = true;
                if (tapTimestampRef.current !== null) {
                  const firstAudioMs = Math.round(performance.now() - tapTimestampRef.current);
                  if (activeTelemetryEntryRef.current) {
                    activeTelemetryEntryRef.current.tapToFirstAudioMs = firstAudioMs;
                  }
                }
              }
              try {
                const isBg =
                  typeof window !== 'undefined' && (window as any).__kashishAppInBackground === true;
                const targetQuality = isBg
                  ? 'small'
                  : isHighQualityRef.current
                  ? 'hd720'
                  : showVideoViewportRef.current
                  ? 'default'
                  : 'small';
                event.target?.setPlaybackQuality?.(targetQuality);
              } catch {}
              const hasNativeBridge =
                typeof window !== 'undefined' && Boolean(window.AndroidApp);
              if (!hasNativeBridge) {
                reclaimTopLevelAudioCarrier();
              }
              setIsPlaying(true);
              setIsBuffering(false);
              setStatusNotice(null);
              if (currentTrackRef.current) {
                applyMediaMetadata(currentTrackRef.current, true);
              }
              if (!hasNativeBridge) {
                // Re-assert top-level MediaSession ownership on mobile web browsers after YouTube iframe claims internal focus
                for (const delay of [150, 550, 1200]) {
                  window.setTimeout(() => {
                    if (userWantPlayingRef.current && currentTrackRef.current) {
                      reclaimTopLevelAudioCarrier();
                      applyMediaMetadata(currentTrackRef.current, true);
                    }
                  }, delay);
                }
              }
            } else if (state === 2) {
              // If the user still wants music playing and the video viewport is hidden (or app is minimized/backgrounded),
              // YouTube's iframe auto-paused on background transition — resume immediately!
              const isBackgrounded =
                typeof document !== 'undefined' &&
                (document.visibilityState === 'hidden' ||
                  document.hidden ||
                  !document.hasFocus());
              if (
                userWantPlayingRef.current &&
                (!showVideoViewportRef.current || isBackgrounded)
              ) {
                try {
                  event.target?.playVideo?.();
                } catch {}
                return;
              }
              userWantPlayingRef.current = false;
              const carrier = getTopLevelAudioCarrier();
              if (carrier && !carrier.paused) {
                try {
                  carrier.pause();
                } catch {}
              }
              setIsPlaying(false);
              setIsBuffering(false);
              if (currentTrackRef.current) {
                applyMediaMetadata(currentTrackRef.current, false);
              }
            } else if (state === 3) {
              setIsBuffering(true);
              if (firstAudioReachedRef.current && activeTelemetryEntryRef.current) {
                activeTelemetryEntryRef.current.bufferingInterruptions += 1;
              }
            } else if (state === 0) {
              if (playbackWatchdogTimerRef.current) {
                window.clearTimeout(playbackWatchdogTimerRef.current);
                playbackWatchdogTimerRef.current = null;
              }
              setIsPlaying(false);
              setIsBuffering(false);
              playNextTrackRef.current();
            }
          },
          onError: async (event: any) => {
            if (playbackBackendRef.current !== 'yt') return;
            if (playbackWatchdogTimerRef.current) {
              window.clearTimeout(playbackWatchdogTimerRef.current);
              playbackWatchdogTimerRef.current = null;
            }
            const errCode = event?.data;
            const failedTrack = currentTrackRef.current;
            if (failedTrack && errCode !== undefined) {
              if (loadedVideoIdInPlayerRef.current) {
                triedEmbedIdsRef.current.add(loadedVideoIdInPlayerRef.current);
              }
              triedEmbedIdsRef.current.add(failedTrack.videoId);
              setStatusNotice('Switching to playable version...');
              setIsBuffering(true);

              // Search for a verified embeddable alternative matching the exact failedTrack title & artist
              const altTrack = await findEmbeddableAlternative(
                failedTrack,
                triedEmbedIdsRef.current
              );
              // Guard against race condition if the user selected another track while awaiting
              if (currentTrackRef.current?.videoId !== failedTrack.videoId) {
                return;
              }
              if (altTrack && playerRef.current && isPlayerReadyRef.current) {
                triedEmbedIdsRef.current.add(altTrack.videoId);
                loadedVideoIdInPlayerRef.current = altTrack.videoId;
                lastPlayInitiatedAtRef.current = performance.now();
                try {
                  playerRef.current.loadVideoById({
                    videoId: altTrack.videoId,
                    suggestedQuality: isHighQualityRef.current
                      ? 'hd720'
                      : showVideoViewportRef.current
                      ? 'default'
                      : 'small',
                  });
                  playerRef.current.playVideo();
                  setStatusNotice(null);
                  return;
                } catch {}
              }
            }
            if (failedTrack?.videoId) {
              setVerifiedVideoMap((prev) => ({ ...prev, [failedTrack.videoId]: false }));
            }
            setIsBuffering(false);
            setIsPlaying(false);
            setStatusNotice('This track restricts embedded playback. Try another result from the Videos tab.');
          },
        },
      };

      loadedVideoIdInPlayerRef.current = initialVideoId;
      playerRef.current = new window.YT.Player('kashish-yt-iframe-target', playerConfig);
    };

    if (window.YT && window.YT.Player) {
      createPlayerInstance();
      return;
    }

    const existingScript = document.getElementById('youtube-iframe-api-script');
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevCallback === 'function') prevCallback();
      createPlayerInstance();
    };

    if (!existingScript) {
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    }
  }, [applyMediaMetadata]);

  // Pre-warm singleton YouTube IFrame Player immediately on mount
  useEffect(() => {
    ensureYouTubePlayer();
  }, [ensureYouTubePlayer]);

  // Helper to start or switch to YouTube IFrame Player for a track (with instant playable ID lookup + stall watchdog)
  const startYouTubeIframePlayback = useCallback(
    (track: YouTubeTrack, startSeconds = 0) => {
      playbackBackendRef.current = 'yt';
      if (hasNativeExoPlayer()) {
        try {
          window.AndroidApp?.nativePauseTrack?.();
        } catch {}
      }
      const nativeAudio = getTopLevelNativeAudioElement();
      if (nativeAudio && !nativeAudio.paused) {
        try {
          nativeAudio.pause();
        } catch {}
      }

      const carrier = getTopLevelAudioCarrier();
      if (carrier && carrier.paused) {
        carrier.play().catch(() => {});
      }

      const playableVideoId = getKnownPlayableVideoId(track.videoId);
      const targetQuality = isHighQualityRef.current
        ? 'hd720'
        : showVideoViewportRef.current
        ? 'default'
        : 'small';

      if (playerRef.current && isPlayerReadyRef.current) {
        loadedVideoIdInPlayerRef.current = playableVideoId;
        try {
          playerRef.current.loadVideoById({
            videoId: playableVideoId,
            startSeconds: startSeconds > 0 ? startSeconds : 0,
            suggestedQuality: targetQuality,
          });
          playerRef.current.playVideo();
        } catch {
          pendingTrackRef.current = track;
        }
      } else {
        pendingTrackRef.current = track;
        ensureYouTubePlayer();
      }

      // Clear any previous watchdog and arm a 4.5s stall recovery watchdog
      if (playbackWatchdogTimerRef.current) {
        window.clearTimeout(playbackWatchdogTimerRef.current);
      }
      playbackWatchdogTimerRef.current = window.setTimeout(async () => {
        if (
          !userWantPlayingRef.current ||
          currentTrackRef.current?.videoId !== track.videoId ||
          firstAudioReachedRef.current
        ) {
          return;
        }
        try {
          const st = playerRef.current?.getPlayerState?.();
          // If still UNSTARTED (-1) or CUED (5) after 4.5s, resolve an embeddable alternative
          if (st === -1 || st === 5 || st === undefined) {
            triedEmbedIdsRef.current.add(playableVideoId);
            triedEmbedIdsRef.current.add(track.videoId);
            const altTrack = await findEmbeddableAlternative(track, triedEmbedIdsRef.current);
            if (
              altTrack &&
              userWantPlayingRef.current &&
              currentTrackRef.current?.videoId === track.videoId &&
              playerRef.current &&
              isPlayerReadyRef.current
            ) {
              triedEmbedIdsRef.current.add(altTrack.videoId);
              loadedVideoIdInPlayerRef.current = altTrack.videoId;
              playerRef.current.loadVideoById({
                videoId: altTrack.videoId,
                suggestedQuality: targetQuality,
              });
              playerRef.current.playVideo();
            }
          }
        } catch {}
      }, 4500);

      for (const delayMs of [90, 320]) {
        window.setTimeout(() => {
          if (!userWantPlayingRef.current || currentTrackRef.current?.videoId !== track.videoId) {
            return;
          }
          primeAndPlayAudioCarrier();
          if (playerRef.current && isPlayerReadyRef.current) {
            try {
              const st = playerRef.current.getPlayerState?.();
              if (st !== 1 && st !== 3) {
                playerRef.current.playVideo?.();
              }
            } catch {}
          }
        }, delayMs);
      }
    },
    [ensureYouTubePlayer]
  );

  // Primary Native Media3 ExoPlayer (on Android APK Song Mode) or Web HTML5 <audio> + BiquadFilterNode EQ playback
  // (Automatically falls back to YouTube IFrame Player for Video Mode or if direct stream is unavailable)
  const startNativeAudioStreamWithEqFallback = useCallback(
    (track: YouTubeTrack, startSeconds = 0) => {
      const bands = eqBandsRef.current;

      // 1. On Android APK in Song Mode: use Native Media3 ExoPlayer (150MB disk cache, 60s anti-stutter buffer, real hardware EQ)
      if (hasNativeExoPlayer() && !showVideoViewportRef.current) {
        const playableVideoId = getKnownPlayableVideoId(track.videoId);
        if (playerRef.current && isPlayerReadyRef.current) {
          try {
            playerRef.current.pauseVideo?.();
          } catch {}
        }
        const nativeAudio = getTopLevelNativeAudioElement();
        if (nativeAudio && !nativeAudio.paused) {
          try {
            nativeAudio.pause();
          } catch {}
        }
        const carrier = getTopLevelAudioCarrier();
        if (carrier && !carrier.paused) {
          try {
            carrier.pause();
          } catch {}
        }

        playbackBackendRef.current = 'exo';
        loadedExoVideoIdRef.current = playableVideoId;
        exoMetricsRef.current = {
          videoId: playableVideoId,
          currentTime: startSeconds > 0 ? startSeconds : 0,
          duration: track.durationSeconds || 0,
          state: 'buffering',
        };

        try {
          const targetVol = isMutedRef.current ? 0 : Math.max(0, Math.min(1, volumeRef.current / 100));
          window.AndroidApp?.nativeSetVolume?.(targetVol);
          window.AndroidApp?.setEqualizerBands?.(bands.bass, bands.mid, bands.treble, 'Custom');
          const thumbUrl = normalizeSquareThumbnail(track.thumbnail, track.videoId);
          window.AndroidApp?.nativePlayTrack?.(
            playableVideoId,
            track.title,
            track.artist,
            thumbUrl,
            startSeconds > 0 ? startSeconds : 0
          );
        } catch {
          startYouTubeIframePlayback(track, startSeconds);
          return;
        }

        if (playbackWatchdogTimerRef.current) {
          window.clearTimeout(playbackWatchdogTimerRef.current);
        }
        playbackWatchdogTimerRef.current = window.setTimeout(() => {
          if (
            playbackBackendRef.current === 'exo' &&
            userWantPlayingRef.current &&
            currentTrackRef.current?.videoId === track.videoId &&
            !firstAudioReachedRef.current &&
            exoMetricsRef.current.state !== 'playing'
          ) {
            try {
              window.AndroidApp?.nativePauseTrack?.();
            } catch {}
            startYouTubeIframePlayback(track, startSeconds);
          }
        }, 7000);
        return;
      }

      const hasAndroidHardwareEq =
        typeof window !== 'undefined' && typeof window.AndroidApp?.setEqualizerBands === 'function';
      const isStaticFirebaseHost =
        typeof window !== 'undefined' &&
        (window.location.hostname.endsWith('.web.app') ||
          window.location.hostname.endsWith('.firebaseapp.com'));
      const isEqNonFlat = bands.bass !== 0 || bands.mid !== 0 || bands.treble !== 0;

      // Use YouTube IFrame when Video mode is visible, or on older Android APKs without ExoPlayer,
      // or when EQ is Flat, or on static hosts without `/api/ytmusic/stream`
      if (showVideoViewportRef.current || hasAndroidHardwareEq || !isEqNonFlat || isStaticFirebaseHost) {
        startYouTubeIframePlayback(track, startSeconds);
        return;
      }

      const nativeAudio = getTopLevelNativeAudioElement();
      if (!nativeAudio) {
        startYouTubeIframePlayback(track, startSeconds);
        return;
      }

      ensureWebAudioEqGraph();
      applyEqualizerToWebAudio(bands);

      if (playerRef.current && isPlayerReadyRef.current) {
        try {
          playerRef.current.pauseVideo?.();
        } catch {}
      }

      const playableVideoId = getKnownPlayableVideoId(track.videoId);
      playbackBackendRef.current = 'native';
      loadedNativeVideoIdRef.current = playableVideoId;
      nativeAudio.volume = isMutedRef.current ? 0 : Math.max(0, Math.min(1, volumeRef.current / 100));
      nativeAudio.muted = isMutedRef.current;

      const streamUrl = `/api/ytmusic/stream?videoId=${encodeURIComponent(playableVideoId)}`;
      if (nativeAudio.src !== new URL(streamUrl, window.location.origin).href) {
        nativeAudio.src = streamUrl;
      }

      const applyStartSeek = () => {
        if (startSeconds > 0) {
          try {
            nativeAudio.currentTime = startSeconds;
          } catch {}
        }
      };

      if (nativeAudio.readyState >= 1) {
        applyStartSeek();
      } else {
        nativeAudio.addEventListener('loadedmetadata', applyStartSeek, { once: true });
      }

      if (playbackWatchdogTimerRef.current) {
        window.clearTimeout(playbackWatchdogTimerRef.current);
      }
      playbackWatchdogTimerRef.current = window.setTimeout(() => {
        if (
          playbackBackendRef.current === 'native' &&
          userWantPlayingRef.current &&
          currentTrackRef.current?.videoId === track.videoId &&
          nativeAudio.paused
        ) {
          startYouTubeIframePlayback(track, startSeconds);
        }
      }, 2800);

      nativeAudio.play().catch(() => {
        if (userWantPlayingRef.current && currentTrackRef.current?.videoId === track.videoId) {
          startYouTubeIframePlayback(track, startSeconds);
        }
      });
    },
    [startYouTubeIframePlayback]
  );

  useEffect(() => {
    switchActiveTrackToWebAudioEqRef.current = () => {
      const cur = currentTrackRef.current;
      if (!cur || !userWantPlayingRef.current || showVideoViewportRef.current) return;
      if (playbackBackendRef.current === 'yt') {
        const hasAndroidHardwareEq =
          typeof window !== 'undefined' && typeof window.AndroidApp?.setEqualizerBands === 'function';
        const isStaticFirebaseHost =
          typeof window !== 'undefined' &&
          (window.location.hostname.endsWith('.web.app') ||
            window.location.hostname.endsWith('.firebaseapp.com'));
        if (!hasAndroidHardwareEq && !isStaticFirebaseHost) {
          const { currentTime } = getPlaybackMetrics();
          startNativeAudioStreamWithEqFallback(cur, currentTime);
        }
      }
    };
  }, [getPlaybackMetrics, startNativeAudioStreamWithEqFallback]);

  // Bind event listeners to the singleton top-level <audio> element once
  useEffect(() => {
    const nativeAudio = getTopLevelNativeAudioElement();
    if (!nativeAudio) return;

    const onPlaying = () => {
      if (playbackBackendRef.current !== 'native') return;
      if (!firstAudioReachedRef.current) {
        firstAudioReachedRef.current = true;
        if (tapTimestampRef.current !== null) {
          const firstAudioMs = Math.round(performance.now() - tapTimestampRef.current);
          if (activeTelemetryEntryRef.current) {
            activeTelemetryEntryRef.current.tapToFirstAudioMs = firstAudioMs;
          }
        }
      }
      // Pause carrier if native audio is actively playing
      if (sharedCarrierAudio && !sharedCarrierAudio.paused) {
        try {
          sharedCarrierAudio.pause();
        } catch {}
      }
      setIsPlaying(true);
      setIsBuffering(false);
      setStatusNotice(null);
      if (currentTrackRef.current) {
        applyMediaMetadata(currentTrackRef.current, true);
      }
    };

    const onPause = () => {
      if (playbackBackendRef.current !== 'native') return;
      if (nativeAudio.ended) return;
      setIsPlaying(false);
      setIsBuffering(false);
      if (currentTrackRef.current) {
        applyMediaMetadata(currentTrackRef.current, false);
      }
    };

    const onWaiting = () => {
      if (playbackBackendRef.current !== 'native') return;
      if (userWantPlayingRef.current) {
        setIsBuffering(true);
      }
    };

    const onLoadedMetadata = () => {
      if (playbackBackendRef.current !== 'native') return;
      if (currentTrackRef.current) {
        applyMediaMetadata(currentTrackRef.current, !nativeAudio.paused);
      }
    };

    const onEnded = () => {
      if (playbackBackendRef.current !== 'native') return;
      setIsPlaying(false);
      setIsBuffering(false);
      playNextTrackRef.current();
    };

    const onError = () => {
      if (playbackBackendRef.current !== 'native') return;
      const cur = currentTrackRef.current;
      if (cur && userWantPlayingRef.current) {
        // Automatic seamless fallback to YouTube IFrame Player if direct stream is unavailable
        startYouTubeIframePlayback(cur, 0);
      }
    };

    nativeAudio.addEventListener('playing', onPlaying);
    nativeAudio.addEventListener('pause', onPause);
    nativeAudio.addEventListener('waiting', onWaiting);
    nativeAudio.addEventListener('loadedmetadata', onLoadedMetadata);
    nativeAudio.addEventListener('ended', onEnded);
    nativeAudio.addEventListener('error', onError);

    return () => {
      nativeAudio.removeEventListener('playing', onPlaying);
      nativeAudio.removeEventListener('pause', onPause);
      nativeAudio.removeEventListener('waiting', onWaiting);
      nativeAudio.removeEventListener('loadedmetadata', onLoadedMetadata);
      nativeAudio.removeEventListener('ended', onEnded);
      nativeAudio.removeEventListener('error', onError);
    };
  }, [applyMediaMetadata, startYouTubeIframePlayback]);

  // Listen for Native Android Media3 ExoPlayer state, position, ended & fallback error events
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onNativeAudioState = (e: Event) => {
      if (playbackBackendRef.current !== 'exo') return;
      const detail = (e as CustomEvent)?.detail;
      if (!detail || typeof detail !== 'object') return;
      const vid = String(detail.videoId || '');
      if (vid && loadedExoVideoIdRef.current && vid !== loadedExoVideoIdRef.current) {
        return;
      }
      const nextState = String(detail.state || 'idle');
      const curSec = Number(detail.currentTime);
      const durSec = Number(detail.duration);

      exoMetricsRef.current = {
        videoId: vid || exoMetricsRef.current.videoId,
        currentTime: Number.isFinite(curSec) ? curSec : exoMetricsRef.current.currentTime,
        duration:
          Number.isFinite(durSec) && durSec > 0 ? durSec : exoMetricsRef.current.duration,
        state: nextState,
      };

      if (nextState === 'playing') {
        if (playbackWatchdogTimerRef.current) {
          window.clearTimeout(playbackWatchdogTimerRef.current);
          playbackWatchdogTimerRef.current = null;
        }
        if (!firstAudioReachedRef.current) {
          firstAudioReachedRef.current = true;
          if (tapTimestampRef.current !== null) {
            const firstAudioMs = Math.round(performance.now() - tapTimestampRef.current);
            if (activeTelemetryEntryRef.current) {
              activeTelemetryEntryRef.current.tapToFirstAudioMs = firstAudioMs;
            }
          }
        }
        if (sharedCarrierAudio && !sharedCarrierAudio.paused) {
          try {
            sharedCarrierAudio.pause();
          } catch {}
        }
        setIsPlaying(true);
        setIsBuffering(false);
        setStatusNotice(null);
      } else if (nextState === 'buffering') {
        if (userWantPlayingRef.current) {
          setIsBuffering(true);
        }
      } else if (nextState === 'paused') {
        setIsPlaying(false);
        setIsBuffering(false);
      } else if (nextState === 'ended') {
        setIsPlaying(false);
        setIsBuffering(false);
        playNextTrackRef.current();
      } else if (nextState === 'error') {
        const cur = currentTrackRef.current;
        if (cur && userWantPlayingRef.current) {
          startYouTubeIframePlayback(cur, exoMetricsRef.current.currentTime || 0);
        }
      }
    };

    window.addEventListener('kashish-native-audio-state', onNativeAudioState);
    return () => {
      window.removeEventListener('kashish-native-audio-state', onNativeAudioState);
    };
  }, [startYouTubeIframePlayback]);

  const handleSelectTrack = useCallback(
    (
      incomingTrack: YouTubeTrack,
      contextQueue?: YouTubeTrack[],
      contextLabel?: string,
      preserveQueueOrder = false
    ) => {
      const tapStartPerf = performance.now();
      lastPlayInitiatedAtRef.current = tapStartPerf;
      triggerHaptic(25);
      userWantPlayingRef.current = true;
      primeAndPlayAudioCarrier();

      // Resolve against canonical registry first so any known Discovery track has 100% verified metadata & videoId
      const canonicalTrack = resolveCanonicalTrack(incomingTrack);

      // Unified track object linking ID, title, artist, album, and normalized square thumbnail atomically
      const unifiedTrack: YouTubeTrack = {
        ...canonicalTrack,
        thumbnail: normalizeSquareThumbnail(canonicalTrack.thumbnail, canonicalTrack.videoId),
        title: canonicalTrack.title || 'Untitled Track',
        artist: canonicalTrack.artist || 'Kashish Melodies',
      };

      // Synchronize the active playback queue:
      // 1) Preserve an explicit user list ONLY for custom playlists, Liked Songs, History, Videos, or in-queue navigation.
      const isExplicitUserCollection = Boolean(
        preserveQueueOrder ||
          (contextLabel &&
            (contextLabel.startsWith('PLAYLIST_') ||
              contextLabel === 'LIKED_SONGS' ||
              contextLabel === 'HISTORY' ||
              contextLabel === 'VIDEOS'))
      );

      if (isExplicitUserCollection && contextQueue && contextQueue.length > 0) {
        const hasTrack = contextQueue.some((t) => t.videoId === unifiedTrack.videoId);
        const nextQueue = hasTrack ? contextQueue : [unifiedTrack, ...contextQueue];
        customQueueRef.current = nextQueue;
        setCustomQueue(nextQueue);
        const label = contextLabel || activeQueueLabelRef.current || 'RELATED';
        activeQueueLabelRef.current = label;
        setActiveQueueLabel(label);
      } else if (
        unifiedTrack.mediaType === 'video' &&
        videoTracksRef.current.some((v) => v.videoId === unifiedTrack.videoId)
      ) {
        customQueueRef.current = videoTracksRef.current;
        setCustomQueue(videoTracksRef.current);
        activeQueueLabelRef.current = 'VIDEOS';
        setActiveQueueLabel('VIDEOS');
      } else {
        // 2) Whenever a song is selected from Search, Quick Picks, Listen Again, or Suggestions,
        //    seed Up Next strictly with vibe-matched similar songs for the playing song (never raw search results).
        const immediateRelated = getCachedRelatedTracks(
          unifiedTrack,
          'context',
          userIdRef.current
        ).tracks;
        const merged = [
          unifiedTrack,
          ...immediateRelated.filter((t) => t.videoId !== unifiedTrack.videoId),
        ];
        customQueueRef.current = merged;
        setCustomQueue(merged);
        activeQueueLabelRef.current = 'RELATED';
        setActiveQueueLabel('RELATED');
      }

      const resolvedPlayableId = getKnownPlayableVideoId(unifiedTrack.videoId);

      // If tapping the exact song that is already loaded in Native ExoPlayer, toggle play/pause immediately
      if (
        playbackBackendRef.current === 'exo' &&
        hasNativeExoPlayer() &&
        currentTrackRef.current?.videoId === unifiedTrack.videoId &&
        (loadedExoVideoIdRef.current === unifiedTrack.videoId ||
          loadedExoVideoIdRef.current === resolvedPlayableId)
      ) {
        if (exoMetricsRef.current.state === 'playing') {
          pausePlayback();
        } else {
          try {
            window.AndroidApp?.nativeResumeTrack?.();
            setIsPlaying(true);
            setIsBuffering(false);
          } catch {}
        }
        return;
      }

      // If tapping the exact song that is already loaded in the YouTube player, toggle play/pause immediately
      if (
        playbackBackendRef.current === 'yt' &&
        currentTrackRef.current?.videoId === unifiedTrack.videoId &&
        (loadedVideoIdInPlayerRef.current === unifiedTrack.videoId ||
          loadedVideoIdInPlayerRef.current === resolvedPlayableId) &&
        playerRef.current &&
        isPlayerReadyRef.current
      ) {
        try {
          const state = playerRef.current.getPlayerState?.();
          if (state === 1) {
            pausePlayback();
            return;
          }
          nativeNotifiedPlayingKeyRef.current = null;
          applyMediaMetadata(unifiedTrack, true);
          const carrier = getTopLevelAudioCarrier();
          if (carrier && carrier.paused) {
            carrier.play().catch(() => {});
          }
          setIsBuffering(true);
          playerRef.current.playVideo();
          return;
        } catch {}
      }

      // Record listening duration for the previous track before switching (for personalized skip/affinity learning)
      if (currentTrackRef.current && trackListenStartPerfRef.current !== null) {
        const listenedSec = (tapStartPerf - trackListenStartPerfRef.current) / 1000;
        recordTrackListenDuration(userIdRef.current, currentTrackRef.current, listenedSec);
      }
      trackListenStartPerfRef.current = tapStartPerf;
      recordTrackPlayEvent(userIdRef.current, unifiedTrack);

      // Persist as the current user's last actually PLAYED song
      saveUserLastPlayedTrack(userIdRef.current, unifiedTrack);
      setRecentPlayedTracks(
        loadUserRecentPlayedTracks(userIdRef.current).map((t) => resolveCanonicalTrack(t))
      );

      tapTimestampRef.current = tapStartPerf;
      tapToReadyRecordedRef.current = null;
      firstAudioReachedRef.current = false;

      const telemetryEntry: PlaybackTelemetryEntry = {
        videoId: unifiedTrack.videoId,
        title: unifiedTrack.title,
        artist: unifiedTrack.artist,
        tapToPlayerReadyMs: 0,
        tapToFirstAudioMs: null,
        bufferingInterruptions: 0,
        timestamp: Date.now(),
      };
      activeTelemetryEntryRef.current = telemetryEntry;
      const store = ensureMetricsStore();
      if (store) {
        store.playbacks.push(telemetryEntry);
      }

      // Update both ref and state synchronously so all downstream handlers read the exact selected track immediately
      currentTrackRef.current = unifiedTrack;
      setCurrentTrack(unifiedTrack);
      setIsBuffering(true);
      setStatusNotice(null);
      triedEmbedIdsRef.current.clear();
      triedEmbedIdsRef.current.add(unifiedTrack.videoId);

      // Post native notification + immediately abandon competing Java AudioFocus BEFORE starting WebView media
      nativeNotifiedPlayingKeyRef.current = null;
      applyMediaMetadata(unifiedTrack, true);

      // Start playback synchronously inside the user's click/tap gesture (uses Web Audio EQ stream when Equalizer is active on Web, or YouTube IFrame + Android Hardware EQ)
      startNativeAudioStreamWithEqFallback(unifiedTrack, 0);

      void logNativeActivity(
        `🎵 ${recipientName} played song: <b>${unifiedTrack.title}</b> (${unifiedTrack.artist})`
      );
    },
    [applyMediaMetadata, pausePlayback, recipientName, startNativeAudioStreamWithEqFallback]
  );

  // Resume helper (used by UI and Media Session)
  const resumePlayback = useCallback(() => {
    const cur = currentTrackRef.current;
    if (!cur) return;
    lastPlayInitiatedAtRef.current = performance.now();
    userWantPlayingRef.current = true;
    nativeNotifiedPlayingKeyRef.current = null;
    applyMediaMetadata(cur, true);

    primeAndPlayAudioCarrier();

    const playableId = getKnownPlayableVideoId(cur.videoId);
    if (playbackBackendRef.current === 'exo' && hasNativeExoPlayer()) {
      if (
        loadedExoVideoIdRef.current === cur.videoId ||
        loadedExoVideoIdRef.current === playableId
      ) {
        try {
          window.AndroidApp?.nativeResumeTrack?.();
          setIsPlaying(true);
          return;
        } catch {}
      }
    }

    if (playbackBackendRef.current === 'native') {
      const nativeAudio = getTopLevelNativeAudioElement();
      if (
        nativeAudio &&
        (loadedNativeVideoIdRef.current === cur.videoId ||
          loadedNativeVideoIdRef.current === playableId)
      ) {
        ensureWebAudioEqGraph();
        applyEqualizerToWebAudio(eqBandsRef.current);
        nativeAudio.play().catch(() => {
          startYouTubeIframePlayback(cur, nativeAudio.currentTime || 0);
        });
        setIsPlaying(true);
        return;
      }
    }

    if (
      playerRef.current &&
      isPlayerReadyRef.current &&
      (loadedVideoIdInPlayerRef.current === cur.videoId ||
        loadedVideoIdInPlayerRef.current === playableId)
    ) {
      try {
        playerRef.current.playVideo();
        setIsPlaying(true);
        return;
      } catch {}
    }

    handleSelectTrack(cur);
  }, [applyMediaMetadata, handleSelectTrack, startYouTubeIframePlayback]);

  const getActivePlaybackQueue = useCallback((): YouTubeTrack[] => {
    const cur = currentTrackRef.current;
    const explicitQueue = customQueueRef.current;
    const videos = videoTracksRef.current;

    // 1. If the explicit active queue (including RELATED queue) contains the current track,
    //    return it in its exact preserved order so queue index (1/N, 2/N, 3/N) and Next/Prev work seamlessly!
    if (cur && explicitQueue.length > 0 && explicitQueue.some((t) => t.videoId === cur.videoId)) {
      return explicitQueue;
    }

    // 2. Otherwise if we have related tracks for the playing song, build a related queue
    if (cur && relatedTracksRef.current.length > 0) {
      const others = relatedTracksRef.current.filter((t) => t.videoId !== cur.videoId);
      return [cur, ...others];
    }

    // 3. Otherwise match against Videos or Discovery
    if (cur) {
      if (cur.mediaType === 'video' && videos.some((v) => v.videoId === cur.videoId)) {
        return videos;
      }
      if (ALL_DISCOVERY_TRACKS.some((d) => d.videoId === cur.videoId)) {
        return ALL_DISCOVERY_TRACKS;
      }
    }

    if (explicitQueue.length > 0) {
      return explicitQueue;
    }
    if (activeResultSectionRef.current === 'videos' && videos.length > 0) {
      return videos;
    }
    return ALL_DISCOVERY_TRACKS;
  }, []);

  const playNextTrack = useCallback(() => {
    const list = getActivePlaybackQueue();
    const cur = currentTrackRef.current;
    if (!list.length) {
      if (cur) handleSelectTrack(cur);
      return;
    }
    if (repeatMode === 'one' && cur) {
      handleSelectTrack(cur, list, activeQueueLabelRef.current, true);
      return;
    }
    if (!cur) {
      handleSelectTrack(list[0], list, activeQueueLabelRef.current, true);
      return;
    }
    const idx = list.findIndex((t) => t.videoId === cur.videoId);
    let nextIdx = 0;
    if (isShuffle && list.length > 1) {
      do {
        nextIdx = Math.floor(Math.random() * list.length);
      } while (nextIdx === idx && list.length > 1);
    } else {
      nextIdx = idx >= 0 ? idx + 1 : 0;
      if (nextIdx >= list.length) {
        if (repeatMode === 'off') {
          pausePlayback();
          return;
        }
        nextIdx = 0;
      }
    }
    handleSelectTrack(list[nextIdx], list, activeQueueLabelRef.current, true);
  }, [getActivePlaybackQueue, handleSelectTrack, repeatMode, isShuffle, pausePlayback]);

  const playPrevTrack = useCallback(() => {
    const list = getActivePlaybackQueue();
    const cur = currentTrackRef.current;
    if (!list.length) {
      if (cur) handleSelectTrack(cur);
      return;
    }
    if (!cur) {
      handleSelectTrack(list[0], list, activeQueueLabelRef.current, true);
      return;
    }
    const { currentTime } = getPlaybackMetrics();
    const idx = list.findIndex((t) => t.videoId === cur.videoId);
    // If more than 4 seconds into the song (or at the very first song in the queue), restart from 0:00
    if (currentTime > 4 && idx <= 0) {
      handleSeekTo(0);
      return;
    }
    const prevIdx = idx > 0 ? idx - 1 : list.length - 1;
    handleSelectTrack(list[prevIdx], list, activeQueueLabelRef.current, true);
  }, [getActivePlaybackQueue, getPlaybackMetrics, handleSeekTo, handleSelectTrack]);

  const playNextTrackRef = useRef(playNextTrack);
  useEffect(() => {
    playNextTrackRef.current = playNextTrack;
  }, [playNextTrack]);

  // Register Media Session action handlers for Android System Media Notification Shade & Lock-Screen
  const bindMediaSessionHandlers = useCallback(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      [
        'play',
        () => {
          resumePlayback();
        },
      ],
      [
        'pause',
        () => {
          pausePlayback();
        },
      ],
      [
        'previoustrack',
        () => {
          playPrevTrack();
        },
      ],
      [
        'nexttrack',
        () => {
          playNextTrack();
        },
      ],
      [
        'seekbackward',
        (details) => {
          const offset = details.seekOffset || 10;
          const { currentTime } = getPlaybackMetrics();
          handleSeekTo(Math.max(0, currentTime - offset));
        },
      ],
      [
        'seekforward',
        (details) => {
          const offset = details.seekOffset || 10;
          const { currentTime, duration } = getPlaybackMetrics();
          handleSeekTo(
            duration > 0 ? Math.min(duration, currentTime + offset) : currentTime + offset
          );
        },
      ],
      [
        'seekto',
        (details) => {
          if (typeof details.seekTime === 'number') {
            handleSeekTo(details.seekTime);
          }
        },
      ],
      [
        'stop',
        () => {
          pausePlayback();
        },
      ],
    ];

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported action in this browser
      }
    }
  }, [getPlaybackMetrics, handleSeekTo, pausePlayback, playNextTrack, playPrevTrack, resumePlayback]);

  useEffect(() => {
    bindMediaSessionHandlersRef.current = bindMediaSessionHandlers;
    bindMediaSessionHandlers();
  }, [bindMediaSessionHandlers]);

  // Listen for Native Android Notification / Lock-Screen media control events
  useEffect(() => {
    const onNativeMediaAction = (e: Event) => {
      const action = (e as CustomEvent<string>).detail || '';
      if (action === 'play') {
        resumePlayback();
      } else if (action === 'pause') {
        // Ignore spurious AUDIOFOCUS_LOSS pause callbacks emitted by older APK builds right after playback starts
        if (performance.now() - lastPlayInitiatedAtRef.current < 1500) {
          return;
        }
        pausePlayback();
      } else if (action === 'toggle') {
        if (userWantPlayingRef.current) {
          pausePlayback();
        } else {
          resumePlayback();
        }
      } else if (action === 'next') {
        playNextTrack();
      } else if (action === 'prev') {
        playPrevTrack();
      } else if (action.startsWith('seek:')) {
        const sec = Number(action.slice(5));
        if (Number.isFinite(sec)) {
          handleSeekTo(sec);
        }
      }
    };
    window.addEventListener('kashish-native-media-action', onNativeMediaAction);
    return () => window.removeEventListener('kashish-native-media-action', onNativeMediaAction);
  }, [handleSeekTo, pausePlayback, playNextTrack, playPrevTrack, resumePlayback]);

  // Keep playback state synchronized across page visibility changes WITHOUT causing a pause/play stutter
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!userWantPlayingRef.current || !currentTrackRef.current) return;

      if (playbackBackendRef.current === 'exo') {
        // Native Media3 ExoPlayer handles background playback in hardware with 0 WebView involvement
        return;
      }

      if (playbackBackendRef.current === 'native') {
        const nativeAudio = getTopLevelNativeAudioElement();
        if (nativeAudio && nativeAudio.paused && !nativeAudio.ended) {
          nativeAudio.play().catch(() => {});
        }
        return;
      }

      primeAndPlayAudioCarrier();

      if (playerRef.current && isPlayerReadyRef.current) {
        try {
          const state = playerRef.current.getPlayerState?.();
          // IMPORTANT: Never call playVideo() if state === 1 (PLAYING) or state === 3 (BUFFERING),
          // because calling playVideo() while already playing causes a brief audio cutout on minimize!
          if (state !== 1 && state !== 3 && userWantPlayingRef.current) {
            playerRef.current.playVideo?.();
          }
        } catch {}
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Guarantee that any initial user tap or touch synchronously unlocks the top-level carrier audio element
  useEffect(() => {
    const unlockOnGesture = () => {
      if (userWantPlayingRef.current) {
        primeAndPlayAudioCarrier();
      }
    };
    window.addEventListener('touchstart', unlockOnGesture, { passive: true });
    window.addEventListener('click', unlockOnGesture, { passive: true });
    return () => {
      window.removeEventListener('touchstart', unlockOnGesture);
      window.removeEventListener('click', unlockOnGesture);
    };
  }, []);

  const handleTogglePlayPause = useCallback(() => {
    triggerHaptic(20);
    if (!currentTrack) {
      const initialTrack =
        activeResultSection === 'discover'
          ? QUICK_PICKS_TRACKS[0]
          : activeResultSection === 'videos' && videoTracks.length > 0
            ? videoTracks[0]
            : tracks.length > 0
              ? tracks[0]
              : videoTracks.length > 0
                ? videoTracks[0]
                : QUICK_PICKS_TRACKS[0];
      handleSelectTrack(initialTrack);
      return;
    }

    if (isPlaying) {
      pausePlayback();
    } else {
      primeAndPlayAudioCarrier();
      resumePlayback();
    }
  }, [activeResultSection, currentTrack, handleSelectTrack, isPlaying, pausePlayback, resumePlayback, tracks, videoTracks]);

  const applyDirectVolume = useCallback((nextVol: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextVol)));
    setVolume(clamped);
    volumeRef.current = clamped;
    setIsMuted(clamped === 0);
    if (hasNativeExoPlayer()) {
      try {
        window.AndroidApp?.nativeSetVolume?.(clamped / 100);
      } catch {}
    }
    const nativeAudio = getTopLevelNativeAudioElement();
    if (nativeAudio) {
      nativeAudio.volume = clamped / 100;
      if (clamped > 0 && nativeAudio.muted) {
        nativeAudio.muted = false;
      }
    }
    if (playerRef.current && isPlayerReadyRef.current) {
      try {
        const eqMult = computeEqLoudnessMultiplier(eqBandsRef.current);
        const scaledVol = Math.max(0, Math.min(100, Math.round(clamped * eqMult)));
        playerRef.current.setVolume(scaledVol);
        if (clamped > 0 && playerRef.current.isMuted?.()) {
          playerRef.current.unMute();
        }
      } catch {}
    }
  }, []);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVol = Number(e.target.value);
    if (!isSleepFadingRef.current && nextVol > 0) {
      preFadeVolumeRef.current = nextVol;
    }
    applyDirectVolume(nextVol);
  };

  const handleSelectSleepTimer = useCallback(
    (minutes: number | null) => {
      triggerHaptic(15);
      setIsSleepMenuOpen(false);

      if (minutes === null) {
        if (isSleepFadingRef.current) {
          applyDirectVolume(preFadeVolumeRef.current);
        }
        isSleepFadingRef.current = false;
        setSleepTimerMinutes(null);
        setSleepRemainingSec(null);
        setStatusNotice(null);
        showNativeToast('Sleep Timer turned off');
        return;
      }

      if (isSleepFadingRef.current) {
        applyDirectVolume(preFadeVolumeRef.current);
      } else if (volumeRef.current > 0) {
        preFadeVolumeRef.current = volumeRef.current;
      }
      isSleepFadingRef.current = false;
      const totalSec = minutes * 60;
      setSleepTimerMinutes(minutes);
      setSleepRemainingSec(totalSec);
      setStatusNotice(null);
      showNativeToast(`Sleep Timer set for ${minutes}m · Gradual fade-out active 🌙`);
    },
    [applyDirectVolume]
  );

  const sleepEndTimeMsRef = useRef<number | null>(null);

  // 1-second countdown ticker while Sleep Timer is active (skips intermediate React re-renders when app is backgrounded and >35s remain)
  useEffect(() => {
    if (sleepRemainingSec === null || sleepRemainingSec <= 0) {
      sleepEndTimeMsRef.current = null;
      return;
    }
    if (sleepEndTimeMsRef.current === null && sleepTimerMinutes) {
      sleepEndTimeMsRef.current = Date.now() + sleepRemainingSec * 1000;
    }
    const timer = window.setInterval(() => {
      const targetMs = sleepEndTimeMsRef.current;
      const nextRemaining = targetMs
        ? Math.max(0, Math.round((targetMs - Date.now()) / 1000))
        : null;
      const inBg = typeof window !== 'undefined' && Boolean((window as any).__kashishAppInBackground);
      if (inBg && nextRemaining !== null && nextRemaining > 35) {
        return;
      }
      setSleepRemainingSec((prev) => {
        if (nextRemaining !== null) return nextRemaining;
        return prev !== null && prev > 0 ? prev - 1 : null;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sleepRemainingSec !== null && sleepRemainingSec > 0, sleepTimerMinutes]);

  // Gradual volume reduction during the final fade window and auto-pause at 0s
  useEffect(() => {
    if (sleepRemainingSec === null) return;

    const totalConfiguredSec = (sleepTimerMinutes || 5) * 60;
    const fadeWindowSec = Math.min(30, Math.max(15, Math.floor(totalConfiguredSec * 0.25)));

    if (sleepRemainingSec > 0 && sleepRemainingSec <= fadeWindowSec) {
      if (!isSleepFadingRef.current) {
        isSleepFadingRef.current = true;
        if (volumeRef.current > 0) {
          preFadeVolumeRef.current = volumeRef.current;
        }
      }
      const startVol = preFadeVolumeRef.current > 0 ? preFadeVolumeRef.current : 80;
      const fadedVol = Math.max(1, Math.round((startVol * sleepRemainingSec) / fadeWindowSec));
      applyDirectVolume(fadedVol);
      setStatusNotice(`Sleep Timer: Lowering volume (${sleepRemainingSec}s left)...`);
    } else if (sleepRemainingSec === 0) {
      pausePlayback();
      const restoreVol = preFadeVolumeRef.current > 0 ? preFadeVolumeRef.current : 80;
      applyDirectVolume(restoreVol);
      isSleepFadingRef.current = false;
      setSleepTimerMinutes(null);
      setSleepRemainingSec(null);
      setStatusNotice('Sleep Timer ended — playback paused 🌙');
      showNativeToast('Sleep Timer ended — playback paused 🌙');
    }
  }, [sleepRemainingSec, sleepTimerMinutes, applyDirectVolume, pausePlayback]);

  const handleToggleMute = () => {
    triggerHaptic(15);
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (hasNativeExoPlayer()) {
      try {
        const nextVol = nextMuted ? 0 : (volume === 0 ? 80 : volume) / 100;
        window.AndroidApp?.nativeSetVolume?.(nextVol);
      } catch {}
    }
    const nativeAudio = getTopLevelNativeAudioElement();
    if (nativeAudio) {
      nativeAudio.muted = nextMuted;
      if (!nextMuted && volume === 0) {
        nativeAudio.volume = 0.8;
      }
    }
    if (playerRef.current && isPlayerReadyRef.current) {
      try {
        if (nextMuted) {
          playerRef.current.mute();
        } else {
          playerRef.current.unMute();
          if (volume === 0) {
            setVolume(80);
            playerRef.current.setVolume(80);
          }
        }
      } catch {}
    }
  };

  // Toggle video viewport seamlessly without interrupting playback (hands off between ExoPlayer <-> YouTube IFrame)
  const handleToggleVideoViewport = () => {
    triggerHaptic(15);
    const nextShow = !showVideoViewport;
    setShowVideoViewport(nextShow);
    showVideoViewportRef.current = nextShow;

    if (
      nextShow &&
      (playbackBackendRef.current === 'native' || playbackBackendRef.current === 'exo') &&
      currentTrackRef.current
    ) {
      const { currentTime } = getPlaybackMetrics();
      if (playbackBackendRef.current === 'exo') {
        try {
          window.AndroidApp?.nativePauseTrack?.();
        } catch {}
      }
      startYouTubeIframePlayback(currentTrackRef.current, currentTime);
      return;
    }

    if (
      !nextShow &&
      hasNativeExoPlayer() &&
      playbackBackendRef.current === 'yt' &&
      currentTrackRef.current &&
      userWantPlayingRef.current
    ) {
      const { currentTime } = getPlaybackMetrics();
      startNativeAudioStreamWithEqFallback(currentTrackRef.current, currentTime);
      return;
    }

    if (playerRef.current && isPlayerReadyRef.current) {
      try {
        playerRef.current.setPlaybackQuality?.(
          isHighQualityRef.current ? 'hd720' : nextShow ? 'default' : 'small'
        );
      } catch {}
    }
  };

  // ==================== YOUTUBE MUSIC NAVIGATION, PLAYLISTS, MOODS & NOW PLAYING STATE ====================
  const [ytmView, setYtmView] = useState<'home' | 'explore' | 'library' | 'liked' | 'playlist' | 'search'>('home');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState<boolean>(false);
  const [nowPlayingTab, setNowPlayingTab] = useState<'upnext' | 'lyrics' | 'related'>('upnext');
  const [isAppleSheetDrawerOpen, setIsAppleSheetDrawerOpen] = useState<boolean>(false);
  const [isKashishHubOpen, setIsKashishHubOpen] = useState<boolean>(false);
  const [kashishHubTab, setKashishHubTab] = useState<'playlists' | 'liked' | 'history' | 'queue'>('playlists');
  const [verifiedVideoMap, setVerifiedVideoMap] = useState<Record<string, boolean>>({});

  // Home Mood Chips state (Relax, Workout, Focus, Party + All, Romantic, Lo-Fi, Punjabi)
  const [homeMood, setHomeMood] = useState<string>('All');
  const [moodTracksCache, setMoodTracksCache] = useState<Record<string, YouTubeTrack[]>>({});
  const [isLoadingMood, setIsLoadingMood] = useState<boolean>(false);

  // User Playlists state persisted in localStorage
  const [playlists, setPlaylists] = useState<UserPlaylist[]>(() => loadUserPlaylists(userId));
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState<boolean>(false);
  const [newPlaylistName, setNewPlaylistName] = useState<string>('');
  const [trackForPlaylistModal, setTrackForPlaylistModal] = useState<YouTubeTrack | null>(null);

  useEffect(() => {
    setPlaylists(loadUserPlaylists(userId));
  }, [userId]);

  const handleCreatePlaylist = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      const trimmed = newPlaylistName.trim();
      if (!trimmed) return;
      triggerHaptic(20);
      const newPl: UserPlaylist = {
        id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: trimmed,
        createdAt: Date.now(),
        tracks: trackForPlaylistModal ? [resolveCanonicalTrack(trackForPlaylistModal)] : [],
      };
      setPlaylists((prev) => {
        const next = [newPl, ...prev];
        saveUserPlaylists(userId, next);
        return next;
      });
      setNewPlaylistName('');
      setIsCreatePlaylistOpen(false);
      if (trackForPlaylistModal) {
        showNativeToast(`Added "${trackForPlaylistModal.title}" to "${trimmed}"`);
        setTrackForPlaylistModal(null);
      } else {
        showNativeToast(`Playlist "${trimmed}" created`);
        setSelectedPlaylistId(newPl.id);
        setYtmView('playlist');
      }
    },
    [newPlaylistName, trackForPlaylistModal, userId]
  );

  const handleDeletePlaylist = useCallback(
    (playlistId: string) => {
      triggerHaptic(20);
      setPlaylists((prev) => {
        const target = prev.find((p) => p.id === playlistId);
        const next = prev.filter((p) => p.id !== playlistId);
        saveUserPlaylists(userId, next);
        if (target) showNativeToast(`Deleted playlist "${target.name}"`);
        return next;
      });
      if (selectedPlaylistId === playlistId) {
        setSelectedPlaylistId(null);
        setYtmView('library');
      }
    },
    [selectedPlaylistId, userId]
  );

  const handleAddTrackToPlaylist = useCallback(
    (playlistId: string, track: YouTubeTrack) => {
      triggerHaptic(15);
      const canonical = resolveCanonicalTrack(track);
      setPlaylists((prev) => {
        const next = prev.map((pl) => {
          if (pl.id !== playlistId) return pl;
          if (pl.tracks.some((t) => t.videoId === canonical.videoId)) {
            showNativeToast(`Already in "${pl.name}"`);
            return pl;
          }
          showNativeToast(`Added to "${pl.name}"`);
          return { ...pl, tracks: [...pl.tracks, canonical] };
        });
        saveUserPlaylists(userId, next);
        return next;
      });
      setTrackForPlaylistModal(null);
    },
    [userId]
  );

  const handleRemoveTrackFromPlaylist = useCallback(
    (playlistId: string, videoId: string) => {
      triggerHaptic(15);
      setPlaylists((prev) => {
        const next = prev.map((pl) => {
          if (pl.id !== playlistId) return pl;
          return { ...pl, tracks: pl.tracks.filter((t) => t.videoId !== videoId) };
        });
        saveUserPlaylists(userId, next);
        return next;
      });
    },
    [userId]
  );

  // Queue Reorder & Remove Handlers (Up Next tab)
  const handleRemoveFromQueue = useCallback(
    (videoIdToRemove: string) => {
      triggerHaptic(15);
      const currentList = getActivePlaybackQueue();
      const nextList = currentList.filter((t) => t.videoId !== videoIdToRemove);
      customQueueRef.current = nextList;
      setCustomQueue(nextList);
      showNativeToast('Removed from queue');
    },
    [getActivePlaybackQueue]
  );

  const handleMoveQueueItem = useCallback(
    (index: number, direction: 'up' | 'down') => {
      triggerHaptic(10);
      const currentList = [...getActivePlaybackQueue()];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= currentList.length) return;
      const temp = currentList[index];
      currentList[index] = currentList[targetIndex];
      currentList[targetIndex] = temp;
      customQueueRef.current = currentList;
      setCustomQueue(currentList);
    },
    [getActivePlaybackQueue]
  );

  const handleAddTrackToQueue = useCallback(
    (track: YouTubeTrack) => {
      triggerHaptic(15);
      const canonical = resolveCanonicalTrack(track);
      const currentList = getActivePlaybackQueue();
      if (currentList.some((t) => t.videoId === canonical.videoId)) {
        showNativeToast(`"${canonical.title}" is already in Up Next`);
        return;
      }
      const nextList = [...currentList, canonical];
      customQueueRef.current = nextList;
      setCustomQueue(nextList);
      showNativeToast(`Added "${canonical.title}" to Up Next`);
    },
    [getActivePlaybackQueue]
  );

  // Keyboard Shortcuts (Space = play/pause, Left/Right arrows = prev/next or Shift+arrows = seek)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === ' ' || key === 'k') {
        e.preventDefault();
        if (userWantPlayingRef.current) {
          pausePlayback();
        } else {
          primeAndPlayAudioCarrier();
          resumePlayback();
        }
      } else if (key === 'n') {
        e.preventDefault();
        playNextTrack();
      } else if (key === 'p') {
        e.preventDefault();
        playPrevTrack();
      } else if (key === 'm') {
        e.preventDefault();
        handleToggleMute();
      } else if (key === 'l') {
        e.preventDefault();
        if (currentTrackRef.current) {
          handleToggleFavorite(currentTrackRef.current);
        }
      } else if (key === 'escape') {
        if (trackForPlaylistModal) {
          setTrackForPlaylistModal(null);
        } else if (isCreatePlaylistOpen) {
          setIsCreatePlaylistOpen(false);
        } else if (isNowPlayingOpen) {
          setIsNowPlayingOpen(false);
        }
      } else if (key === 'arrowright') {
        e.preventDefault();
        if (e.shiftKey) {
          const { currentTime, duration } = getPlaybackMetrics();
          handleSeekTo(duration > 0 ? Math.min(duration, currentTime + 5) : currentTime + 5);
        } else {
          playNextTrack();
        }
      } else if (key === 'arrowleft') {
        e.preventDefault();
        if (e.shiftKey) {
          const { currentTime } = getPlaybackMetrics();
          handleSeekTo(Math.max(0, currentTime - 5));
        } else {
          playPrevTrack();
        }
      } else if (key === 'arrowup') {
        e.preventDefault();
        setVolume((v) => {
          const next = Math.min(100, v + 10);
          volumeRef.current = next;
          if (playerRef.current && isPlayerReadyRef.current) {
            try {
              const eqMult = computeEqLoudnessMultiplier(eqBandsRef.current);
              playerRef.current.setVolume(Math.min(100, Math.round(next * eqMult)));
            } catch {}
          }
          return next;
        });
      } else if (key === 'arrowdown') {
        e.preventDefault();
        setVolume((v) => {
          const next = Math.max(0, v - 10);
          volumeRef.current = next;
          if (playerRef.current && isPlayerReadyRef.current) {
            try {
              const eqMult = computeEqLoudnessMultiplier(eqBandsRef.current);
              playerRef.current.setVolume(Math.max(0, Math.round(next * eqMult)));
            } catch {}
          }
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    getActivePlaybackQueue,
    getPlaybackMetrics,
    handleSeekTo,
    handleToggleFavorite,
    isCreatePlaylistOpen,
    isNowPlayingOpen,
    pausePlayback,
    playNextTrack,
    playPrevTrack,
    resumePlayback,
    trackForPlaylistModal,
  ]);

  const runSearch = useCallback(async (queryText: string, saveToRecent = true) => {
    const trimmed = queryText.trim();
    if (!trimmed) {
      if (searchAbortRef.current) searchAbortRef.current.abort();
      activeSearchQueryRef.current = '';
      setIsSearching(false);
      setIsSearchingVideos(false);
      setSearchError(null);
      return;
    }

    const normalized = trimmed.toLowerCase();

    // Always open Search view & Songs section by default whenever a search is performed
    setYtmView('search');
    setIsNowPlayingOpen(false);
    setActiveResultSection('songs');
    activeResultSectionRef.current = 'songs';
    setShowVideoViewport(false);
    showVideoViewportRef.current = false;
    setIsListExpanded(true);

    if (saveToRecent) {
      const updatedRecent = saveUserRecentSearch(userIdRef.current, trimmed);
      setRecentSearches(updatedRecent);
    }

    // 1. Check synchronous memory/session cache first for instant 0-network response
    const cacheStartPerf = performance.now();
    const cachedSongsEntry = getCachedSearchEntry(trimmed);
    const cachedVideosEntry = getCachedVideoSearchEntry(trimmed);

    if (
      cachedSongsEntry &&
      cachedSongsEntry.tracks.length > 0 &&
      cachedVideosEntry &&
      cachedVideosEntry.tracks.length > 0
    ) {
      const cacheElapsedMs = Math.round(performance.now() - cacheStartPerf);
      if (searchAbortRef.current) searchAbortRef.current.abort();
      activeSearchQueryRef.current = '';
      setTracks(cachedSongsEntry.tracks);
      setVideoTracks(cachedVideosEntry.tracks);
      saveUserLastSearch(
        userIdRef.current,
        trimmed,
        cachedSongsEntry.tracks,
        cachedVideosEntry.tracks
      );
      setIsSearching(false);
      setIsSearchingVideos(false);
      setSearchError(null);
      setIsListExpanded(true);

      ensureMetricsStore()?.searches.push({
        query: trimmed,
        responseTimeMs: cacheElapsedMs,
        source: 'cache',
        resultCount: cachedSongsEntry.tracks.length + cachedVideosEntry.tracks.length,
        timestamp: Date.now(),
      });

      if (cachedSongsEntry.isStale || cachedVideosEntry.isStale) {
        const bgStart = performance.now();
        void refreshSearchInBackground(trimmed).then(({ songs, videos }) => {
          const nextSongs = songs && songs.length > 0 ? songs : cachedSongsEntry.tracks;
          const nextVideos = videos && videos.length > 0 ? videos : cachedVideosEntry.tracks;
          setTracks(nextSongs);
          setVideoTracks(nextVideos);
          saveUserLastSearch(userIdRef.current, trimmed, nextSongs, nextVideos);
          ensureMetricsStore()?.searches.push({
            query: trimmed,
            responseTimeMs: Math.round(performance.now() - bgStart),
            source: 'background_refresh',
            resultCount: nextSongs.length + nextVideos.length,
            timestamp: Date.now(),
          });
        });
      }
      return;
    }

    // 2. Avoid aborting & restarting if the exact same search query is already in flight
    if (activeSearchQueryRef.current === normalized && searchAbortRef.current) {
      return;
    }

    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;
    activeSearchQueryRef.current = normalized;
    setIsSearching(true);
    setIsSearchingVideos(true);
    setSearchError(null);
    setIsListExpanded(true);

    const isColdSearch = !hasCompletedNetworkSearchRef.current;
    const searchStartPerf = performance.now();

    let resolvedSongs: YouTubeTrack[] = cachedSongsEntry?.tracks || [];
    let resolvedVideos: YouTubeTrack[] = cachedVideosEntry?.tracks || [];
    let songsFailed = false;
    let videosFailed = false;
    let lastErrMessage = '';

    if (resolvedSongs.length > 0) {
      setTracks(resolvedSongs);
      setIsSearching(false);
    }
    if (resolvedVideos.length > 0) {
      setVideoTracks(resolvedVideos);
      setIsSearchingVideos(false);
    }

    const songsTask =
      resolvedSongs.length > 0
        ? Promise.resolve(resolvedSongs)
        : searchYouTubeSongs(trimmed, controller.signal)
            .then((res) => {
              if (!controller.signal.aborted) {
                resolvedSongs = res;
                setTracks(res);
                setIsSearching(false);
              }
              return res;
            })
            .catch((err) => {
              if (err?.name !== 'AbortError' && !controller.signal.aborted) {
                songsFailed = true;
                lastErrMessage = err?.message || '';
                resolvedSongs = [];
                setTracks([]);
                setIsSearching(false);
              }
              return [] as YouTubeTrack[];
            });

    const videosTask =
      resolvedVideos.length > 0
        ? Promise.resolve(resolvedVideos)
        : searchYouTubeVideos(trimmed, controller.signal)
            .then((res) => {
              if (!controller.signal.aborted) {
                resolvedVideos = res;
                setVideoTracks(res);
                setIsSearchingVideos(false);
              }
              return res;
            })
            .catch((err) => {
              if (err?.name !== 'AbortError' && !controller.signal.aborted) {
                videosFailed = true;
                if (!lastErrMessage) lastErrMessage = err?.message || '';
                resolvedVideos = [];
                setVideoTracks([]);
                setIsSearchingVideos(false);
              }
              return [] as YouTubeTrack[];
            });

    await Promise.all([songsTask, videosTask]);

    if (controller.signal.aborted) return;

    const elapsedMs = Math.round(performance.now() - searchStartPerf);
    hasCompletedNetworkSearchRef.current = true;
    activeSearchQueryRef.current = '';
    setIsSearching(false);
    setIsSearchingVideos(false);

    if (resolvedSongs.length === 0 && resolvedVideos.length === 0 && (songsFailed || videosFailed)) {
      setSearchError(
        lastErrMessage || 'No Songs or Videos found. Tap Retry or try another search.'
      );
    } else {
      setSearchError(null);
    }

    if (resolvedSongs.length > 0 || resolvedVideos.length > 0) {
      saveUserLastSearch(userIdRef.current, trimmed, resolvedSongs, resolvedVideos);
    }

    ensureMetricsStore()?.searches.push({
      query: trimmed,
      responseTimeMs: elapsedMs,
      source: isColdSearch ? 'cold' : 'warm',
      resultCount: resolvedSongs.length + resolvedVideos.length,
      timestamp: Date.now(),
    });
  }, []);

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    const trimmed = val.trim();
    if (!trimmed) {
      if (searchAbortRef.current) searchAbortRef.current.abort();
      activeSearchQueryRef.current = '';
      setIsSearching(false);
      setIsSearchingVideos(false);
      setSearchError(null);
      return;
    }

    setYtmView('search');
    setActiveResultSection('songs');
    activeResultSectionRef.current = 'songs';
    setShowVideoViewport(false);
    showVideoViewportRef.current = false;
    setIsListExpanded(true);

    // Serve cached queries immediately without waiting for debounce
    const cachedSongs = getCachedSearchEntry(trimmed);
    const cachedVideos = getCachedVideoSearchEntry(trimmed);
    if (
      cachedSongs &&
      cachedSongs.tracks.length > 0 &&
      cachedVideos &&
      cachedVideos.tracks.length > 0
    ) {
      if (searchAbortRef.current) searchAbortRef.current.abort();
      activeSearchQueryRef.current = '';
      setTracks(cachedSongs.tracks);
      setVideoTracks(cachedVideos.tracks);
      setIsSearching(false);
      setIsSearchingVideos(false);
      setSearchError(null);
      setIsListExpanded(true);
      return;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      void runSearch(val, false);
    }, 260);
  };

  // Update instant & live YouTube autocomplete suggestions when typing or focusing search bar
  useEffect(() => {
    const instant = getInstantSuggestions(searchQuery, recentSearches, 6);
    setSearchSuggestions(instant);

    const trimmed = searchQuery.trim();
    if (!trimmed || !isSearchFocused) {
      if (suggestAbortRef.current) suggestAbortRef.current.abort();
      return;
    }

    if (suggestAbortRef.current) {
      suggestAbortRef.current.abort();
    }
    const controller = new AbortController();
    suggestAbortRef.current = controller;

    const timer = window.setTimeout(() => {
      void fetchYouTubeSuggestions(trimmed, recentSearches, controller.signal, 6).then((list) => {
        if (!controller.signal.aborted && list.length > 0) {
          setSearchSuggestions(list);
        }
      });
    }, 90);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, recentSearches, isSearchFocused]);

  // Close search suggestions when tapping outside the search container
  useEffect(() => {
    if (!isSearchFocused) return;
    const handlePointerDownOutside = (e: PointerEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDownOutside);
    return () => document.removeEventListener('pointerdown', handlePointerDownOutside);
  }, [isSearchFocused]);

  const handleSelectSuggestion = (suggestionText: string) => {
    triggerHaptic(20);
    setSearchQuery(suggestionText);
    setIsSearchFocused(false);
    setYtmView('search');
    setIsNowPlayingOpen(false);
    setActiveResultSection('songs');
    activeResultSectionRef.current = 'songs';
    setShowVideoViewport(false);
    showVideoViewportRef.current = false;
    setIsListExpanded(true);
    searchInputRef.current?.blur();
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    void runSearch(suggestionText, true);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearchFocused(false);
    setYtmView('search');
    setIsNowPlayingOpen(false);
    setActiveResultSection('songs');
    activeResultSectionRef.current = 'songs';
    setShowVideoViewport(false);
    showVideoViewportRef.current = false;
    setIsListExpanded(true);
    searchInputRef.current?.blur();
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    void runSearch(searchQuery, true);
  };

  const handleRecentQueryTap = (recentQuery: string) => {
    triggerHaptic(20);
    setSearchQuery(recentQuery);
    setIsSearchFocused(false);
    setYtmView('search');
    setIsNowPlayingOpen(false);
    setActiveResultSection('songs');
    activeResultSectionRef.current = 'songs';
    setShowVideoViewport(false);
    showVideoViewportRef.current = false;
    setIsListExpanded(true);
    searchInputRef.current?.blur();
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    void runSearch(recentQuery, true);
  };

  const handleRemoveRecentQuery = (e: React.MouseEvent, queryToRemove: string) => {
    e.stopPropagation();
    triggerHaptic(15);
    const next = removeUserRecentSearch(userIdRef.current, queryToRemove);
    setRecentSearches(next);
  };

  // Mood Chips Filtering & Dynamic YouTube Music Songs Catalog Fetch for Home Page
  const HOME_MOOD_CHIPS = [
    { id: 'All', label: 'All', query: 'Top Hindi Bollywood romantic hit songs Arijit Singh Pritam' },
    { id: 'Romantic', label: 'Romantic', query: 'Romantic bollywood love songs Arijit Singh Pritam' },
    { id: 'Relax', label: 'Relax', query: 'Relaxing soulful hindi acoustic melody songs' },
    { id: 'Sad', label: 'Sad', query: 'Sad emotional hindi heartbreak songs Arijit Singh' },
    { id: 'Lo-Fi', label: 'Lo-Fi', query: 'Bollywood lofi chill slowed reverb hindi songs' },
    { id: 'Punjabi', label: 'Punjabi', query: 'Top punjabi hit songs Diljit Dosanjh Karan Aujla AP Dhillon' },
    { id: 'Party', label: 'Party', query: 'Bollywood punjabi party dance chartbuster songs' },
    { id: 'Workout', label: 'Workout', query: 'High energy bollywood punjabi workout motivation songs' },
    { id: 'Focus', label: 'Focus', query: 'Peaceful sufi acoustic hindi focus songs' },
  ];

  useEffect(() => {
    if (moodTracksCache[homeMood] && moodTracksCache[homeMood].length > 0) {
      setIsLoadingMood(false);
      return;
    }
    const chip = HOME_MOOD_CHIPS.find((c) => c.id === homeMood);
    if (!chip || !chip.query) return;

    // For 'All', adapt query dynamically to current song's artist/vibe if user already picked a track
    let effectiveQuery = chip.query;
    if (homeMood === 'All' && currentTrack?.artist) {
      const cleanArtist = currentTrack.artist.split(/[,&]/)[0]?.trim();
      if (cleanArtist && cleanArtist.length >= 3 && !/youtube|music artist/i.test(cleanArtist)) {
        effectiveQuery = `${cleanArtist} top hindi hit songs`;
      }
    }

    const controller = new AbortController();
    setIsLoadingMood(true);
    void searchYouTubeSongs(effectiveQuery, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted && res.length > 0) {
          setMoodTracksCache((prev) => ({ ...prev, [homeMood]: res }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingMood(false);
        }
      });

    return () => controller.abort();
  }, [homeMood, moodTracksCache, currentTrack?.artist]);

  const getFilteredHomePools = useCallback((): {
    listenAgain: YouTubeTrack[];
    quickPicks: YouTubeTrack[];
  } => {
    const activeSeedTrack =
      currentTrack ||
      recentPlayedTracks[0] ||
      QUICK_PICKS_TRACKS[0];

    const fetchedForMood = moodTracksCache[homeMood] || [];
    const vibeQuickPicks = getVibeMatchedQuickPicks(
      homeMood,
      activeSeedTrack,
      fetchedForMood,
      userId
    );

    if (homeMood === 'All') {
      const baseListenAgain =
        recentPlayedTracks.length > 0
          ? recentPlayedTracks
          : vibeQuickPicks.slice(0, 12);
      return {
        listenAgain: baseListenAgain,
        quickPicks: vibeQuickPicks,
      };
    }

    return {
      listenAgain: vibeQuickPicks.slice(0, 10),
      quickPicks: vibeQuickPicks,
    };
  }, [currentTrack, homeMood, moodTracksCache, recentPlayedTracks, userId]);

  const isMelodiesPage = activeTab === 'melodies';
  const filteredPool =
    activeResultSection === 'discover'
      ? QUICK_PICKS_TRACKS
      : activeResultSection === 'videos'
        ? videoTracks
        : tracks;
  const displayTrack: YouTubeTrack =
    currentTrack ||
    filteredPool[0] ||
    QUICK_PICKS_TRACKS[0];

  // Dynamic Now Playing Cover Ambient Color
  const [coverAmbientRgb, setCoverAmbientRgb] = useState<string>(() =>
    getDeterministicRgbForTrack(displayTrack.videoId)
  );
  useEffect(() => {
    extractDominantCoverColor(
      displayTrack.videoId,
      displayTrack.thumbnail,
      setCoverAmbientRgb
    );
  }, [displayTrack.videoId, displayTrack.thumbnail]);

  // Determine whether an official/playable video is available for displayTrack
  useEffect(() => {
    const vid = displayTrack?.videoId;
    if (!vid) return;
    if (
      displayTrack.mediaType === 'video' ||
      displayTrack.catalogSource === 'youtube_video' ||
      videoTracks.some((v) => v.videoId === vid)
    ) {
      setVerifiedVideoMap((prev) => (prev[vid] === true ? prev : { ...prev, [vid]: true }));
      return;
    }
    if (verifiedVideoMap[vid] !== undefined) return;

    let cancelled = false;
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      if (cancelled) return;
      // Valid YouTube videos serve a 320x180 mqdefault frame (120x90 is YouTube's missing/deleted placeholder)
      const hasValidVideoStream = img.naturalWidth > 120 && img.naturalHeight > 90;
      setVerifiedVideoMap((prev) => ({
        ...prev,
        [vid]: hasValidVideoStream,
      }));
    };
    img.onerror = () => {
      if (cancelled) return;
      setVerifiedVideoMap((prev) => ({ ...prev, [vid]: false }));
    };
    img.src = `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;

    return () => {
      cancelled = true;
    };
  }, [displayTrack.videoId, displayTrack.mediaType, displayTrack.catalogSource, videoTracks, verifiedVideoMap]);

  // Show the Song | Video toggle ONLY when the currently playing track is genuinely a Video song.
  // For audio-only Songs, keep it hidden completely.
  const isVideoAvailableForCurrentTrack = Boolean(
    displayTrack?.videoId &&
      (displayTrack.mediaType === 'video' || displayTrack.catalogSource === 'youtube_video')
  );

  useEffect(() => {
    if (!isVideoAvailableForCurrentTrack && showVideoViewport) {
      setShowVideoViewport(false);
      showVideoViewportRef.current = false;
    }
  }, [isVideoAvailableForCurrentTrack, showVideoViewport]);

  // Real Lyrics Fetcher for Now Playing Lyrics Tab
  const [lyricsData, setLyricsData] = useState<TrackLyricsData | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState<boolean>(false);

  useEffect(() => {
    if (!displayTrack?.videoId) return;
    const cached = lyricsCache.get(displayTrack.videoId);
    if (cached) {
      setLyricsData(cached);
      setIsLoadingLyrics(false);
      return;
    }
    const controller = new AbortController();
    setIsLoadingLyrics(true);
    void fetchTrackLyrics(displayTrack, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setLyricsData(res);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingLyrics(false);
        }
      });
    return () => controller.abort();
  }, [displayTrack.videoId, displayTrack.title, displayTrack.artist]);

  // ==================== DYNAMIC "MORE LIKE THIS" RELATED SONGS STATE ====================
  const [relatedMoodFilter, setRelatedMoodFilter] = useState<string>('context');
  useEffect(() => {
    relatedMoodFilterRef.current = relatedMoodFilter;
  }, [relatedMoodFilter]);

  const [relatedTracks, setRelatedTracks] = useState<YouTubeTrack[]>(() =>
    getCachedRelatedTracks(displayTrack, 'context', userId).tracks
  );
  useEffect(() => {
    relatedTracksRef.current = relatedTracks;
  }, [relatedTracks]);

  const [hasMoreRelated, setHasMoreRelated] = useState<boolean>(true);
  const [isLoadingRelated, setIsLoadingRelated] = useState<boolean>(false);
  const [isMoreLikeThisOpen, setIsMoreLikeThisOpen] = useState<boolean>(false);

  const relatedAbortRef = useRef<AbortController | null>(null);
  const isLoadingMoreRelatedRef = useRef<boolean>(false);
  const hasMoreRelatedRef = useRef<boolean>(true);
  const displayTrackRef = useRef<YouTubeTrack>(displayTrack);
  const relatedScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const relatedSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    displayTrackRef.current = displayTrack;
  }, [displayTrack]);

  // Helper to merge newly loaded related tracks into the active RELATED queue
  const syncRelatedTracksToActiveQueue = useCallback(
    (seedTrack: YouTubeTrack, incomingRelated: YouTubeTrack[]) => {
      if (!incomingRelated.length) return;
      if (activeQueueLabelRef.current !== 'RELATED' && customQueueRef.current.length > 1) {
        return;
      }
      const existing = customQueueRef.current;
      const existingContainsSeed = existing.some((t) => t.videoId === seedTrack.videoId);

      if (existingContainsSeed && existing.length > 1) {
        const seen = new Set(existing.map((t) => t.videoId));
        const additions = incomingRelated.filter((t) => !seen.has(t.videoId));
        if (additions.length > 0) {
          const merged = [...existing, ...additions];
          customQueueRef.current = merged;
          setCustomQueue(merged);
        }
      } else {
        const merged = [
          seedTrack,
          ...incomingRelated.filter((t) => t.videoId !== seedTrack.videoId),
        ];
        customQueueRef.current = merged;
        setCustomQueue(merged);
        activeQueueLabelRef.current = 'RELATED';
        setActiveQueueLabel('RELATED');
      }
    },
    []
  );

  // Automatically update "MORE LIKE THIS" recommendations whenever the current/display song or mood filter changes
  useEffect(() => {
    const contextTrack = displayTrack;
    if (!contextTrack?.videoId) return;

    if (relatedAbortRef.current) {
      relatedAbortRef.current.abort();
    }
    isLoadingMoreRelatedRef.current = false;

    const cached = getCachedRelatedTracks(contextTrack, relatedMoodFilter, userId);
    setRelatedTracks(cached.tracks);
    setHasMoreRelated(cached.hasMore);
    hasMoreRelatedRef.current = cached.hasMore;

    if (cached.tracks.length > 0) {
      syncRelatedTracksToActiveQueue(contextTrack, cached.tracks);
    }

    if (cached.cursorIndex > 0 && cached.tracks.length >= 12) {
      setIsLoadingRelated(false);
      return;
    }

    const controller = new AbortController();
    relatedAbortRef.current = controller;
    isLoadingMoreRelatedRef.current = true;
    setIsLoadingRelated(true);

    void fetchNextRelatedTracksBatch(contextTrack, controller.signal, relatedMoodFilter, userId)
      .then((res) => {
        if (
          controller.signal.aborted ||
          displayTrackRef.current.videoId !== contextTrack.videoId ||
          relatedMoodFilterRef.current !== relatedMoodFilter
        ) {
          return;
        }
        setRelatedTracks(res.tracks);
        setHasMoreRelated(res.hasMore);
        hasMoreRelatedRef.current = res.hasMore;
        if (res.tracks.length > 0) {
          syncRelatedTracksToActiveQueue(contextTrack, res.tracks);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (
          !controller.signal.aborted &&
          displayTrackRef.current.videoId === contextTrack.videoId &&
          relatedMoodFilterRef.current === relatedMoodFilter
        ) {
          isLoadingMoreRelatedRef.current = false;
          setIsLoadingRelated(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [displayTrack.videoId, relatedMoodFilter, userId, syncRelatedTracksToActiveQueue]);

  const loadMoreRelatedTracks = useCallback(async () => {
    if (isLoadingMoreRelatedRef.current || !hasMoreRelatedRef.current) return;
    const contextTrack = displayTrackRef.current;
    const activeMood = relatedMoodFilterRef.current;
    if (!contextTrack?.videoId) return;

    const controller = new AbortController();
    relatedAbortRef.current = controller;
    isLoadingMoreRelatedRef.current = true;
    setIsLoadingRelated(true);

    try {
      const res = await fetchNextRelatedTracksBatch(
        contextTrack,
        controller.signal,
        activeMood,
        userIdRef.current
      );
      if (
        !controller.signal.aborted &&
        displayTrackRef.current.videoId === contextTrack.videoId &&
        relatedMoodFilterRef.current === activeMood
      ) {
        setRelatedTracks(res.tracks);
        setHasMoreRelated(res.hasMore);
        hasMoreRelatedRef.current = res.hasMore;
        if (res.tracks.length > 0) {
          syncRelatedTracksToActiveQueue(contextTrack, res.tracks);
        }
      }
    } catch {
      // Ignore abort or transient network errors
    } finally {
      if (
        !controller.signal.aborted &&
        displayTrackRef.current.videoId === contextTrack.videoId &&
        relatedMoodFilterRef.current === activeMood
      ) {
        isLoadingMoreRelatedRef.current = false;
        setIsLoadingRelated(false);
      }
    }
  }, []);

  const handleRelatedListScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) {
        void loadMoreRelatedTracks();
      }
    },
    [loadMoreRelatedTracks]
  );

  // ==================== PHASE 7: INTELLIGENT NEXT-TRACK PRELOADING ====================
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    const queue = getActivePlaybackQueue();
    if (queue.length < 2) return;

    const curIdx = queue.findIndex((t) => t.videoId === currentTrack.videoId);
    let nextIdx = curIdx >= 0 ? curIdx + 1 : 0;
    if (nextIdx >= queue.length) {
      if (repeatMode === 'off') return;
      nextIdx = 0;
    }
    const nextTrack = queue[nextIdx];
    if (!nextTrack || nextTrack.videoId === currentTrack.videoId) return;

    const preloadController = new AbortController();
    const timer = window.setTimeout(() => {
      void preloadNextTrackResources(nextTrack, isHighQuality, preloadController.signal);
    }, 2200);

    return () => {
      window.clearTimeout(timer);
      preloadController.abort();
    };
  }, [
    currentTrack,
    isPlaying,
    isHighQuality,
    repeatMode,
    isShuffle,
    customQueue,
    tracks,
    videoTracks,
    getActivePlaybackQueue,
  ]);

  // ==================== PHASE 5: BACK BUTTON & BROWSER HISTORY SUB-VIEW NAVIGATION ====================
  const pushSubViewHistoryEntry = useCallback((subViewName: string) => {
    if (typeof window === 'undefined') return;
    try {
      window.history.pushState(
        { tab: 'melodies', isUnlocked: true, kashishMusicSubView: subViewName },
        '',
        '#melodies'
      );
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__kashishConsumeMusicPlayerBack = () => {
      if (activeTab !== 'melodies') return false;
      if (trackForPlaylistModal) {
        setTrackForPlaylistModal(null);
        return true;
      }
      if (isCreatePlaylistOpen) {
        setIsCreatePlaylistOpen(false);
        return true;
      }
      if (isEqMenuOpen) {
        setIsEqMenuOpen(false);
        return true;
      }
      if (isSleepMenuOpen) {
        setIsSleepMenuOpen(false);
        return true;
      }
      if (isKashishHubOpen) {
        setIsKashishHubOpen(false);
        return true;
      }
      if (isVideoFullscreen) {
        setIsVideoFullscreen(false);
        return true;
      }
      if (isNowPlayingOpen && isAppleSheetDrawerOpen) {
        setIsAppleSheetDrawerOpen(false);
        return true;
      }
      if (isNowPlayingOpen) {
        setIsNowPlayingOpen(false);
        return true;
      }
      if (isFullSearchOpen) {
        setIsFullSearchOpen(false);
        return true;
      }
      if (isMoreLikeThisOpen) {
        setIsMoreLikeThisOpen(false);
        return true;
      }
      if (isLibraryQueueOpen) {
        setIsLibraryQueueOpen(false);
        return true;
      }
      if (isSearchFocused) {
        setIsSearchFocused(false);
        searchInputRef.current?.blur();
        return true;
      }
      if (ytmView !== 'home') {
        setYtmView('home');
        return true;
      }
      return false;
    };
    return () => {
      window.__kashishConsumeMusicPlayerBack = undefined;
    };
  }, [
    activeTab,
    isAppleSheetDrawerOpen,
    isCreatePlaylistOpen,
    isEqMenuOpen,
    isFullSearchOpen,
    isKashishHubOpen,
    isLibraryQueueOpen,
    isMoreLikeThisOpen,
    isNowPlayingOpen,
    isSearchFocused,
    isSleepMenuOpen,
    isVideoFullscreen,
    trackForPlaylistModal,
    ytmView,
  ]);

  const { listenAgain: homeListenAgain, quickPicks: homeQuickPicks } = getFilteredHomePools();
  const activeQueueList = getActivePlaybackQueue();
  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) || null;

  const ytmPalette = {
    shellBg: 'var(--ytm-bg)',
    shellBgImage: 'var(--bg-gradient)',
    shellBorder: 'var(--ytm-border)',
    shellShadow: 'var(--glass-shadow)',
    deckBg: 'var(--ytm-surface)',
    deckBorder: 'var(--ytm-border)',
    subBg: 'var(--ytm-surface-elevated)',
    inputBg: 'var(--ytm-input-bg)',
    accent: 'var(--ytm-accent)',
    accentHover: 'var(--accent-hover)',
    accentText: 'var(--ytm-accent-text)',
    accentGradient: 'linear-gradient(135deg, var(--ytm-accent) 0%, var(--accent-hover) 100%)',
    accentGlow: 'var(--ytm-accent-soft)',
    textPrimary: 'var(--ytm-text)',
    textSecondary: 'var(--ytm-text-muted)',
  };

  const handleOpenPlaylistModal = useCallback((song: YouTubeTrack) => {
    triggerHaptic(10);
    setTrackForPlaylistModal(song);
  }, []);

  // Notify BackgroundEffects to pause whenever any full-screen player/library/search overlay is open
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const paused =
      isMelodiesPage &&
      (isNowPlayingOpen || isKashishHubOpen || isFullSearchOpen || isSearchFocused);
    window.dispatchEvent(new CustomEvent('kashish-overlay-pause', { detail: { paused } }));
  }, [isMelodiesPage, isNowPlayingOpen, isKashishHubOpen, isFullSearchOpen, isSearchFocused]);

  const renderSongRow = useCallback(
    (
      song: YouTubeTrack,
      idx: number,
      queueContext: YouTubeTrack[],
      queueLabel: string,
      options?: {
        showPlaylistRemoveId?: string;
        showQueueControls?: boolean;
        totalInQueue?: number;
      }
    ) => {
      const isCurrent = displayTrack.videoId === song.videoId;
      const isFav = favoriteIds.has(song.videoId);
      return (
        <MemoSongRow
          key={`${queueLabel}-${song.videoId}-${idx}`}
          song={song}
          idx={idx}
          isCurrent={isCurrent}
          isRowPlaying={isCurrent && isPlaying}
          isFav={isFav}
          queueContext={queueContext}
          queueLabel={queueLabel}
          showPlaylistRemoveId={options?.showPlaylistRemoveId}
          showQueueControls={options?.showQueueControls}
          totalInQueue={options?.totalInQueue}
          onPreCue={handlePreCueTrack}
          onSelect={handleSelectTrack}
          onToggleFavorite={handleToggleFavorite}
          onOpenPlaylistModal={handleOpenPlaylistModal}
          onAddToQueue={handleAddTrackToQueue}
          onRemoveFromPlaylist={handleRemoveTrackFromPlaylist}
          onMoveQueueItem={handleMoveQueueItem}
          onRemoveFromQueue={handleRemoveFromQueue}
        />
      );
    },
    [
      displayTrack.videoId,
      favoriteIds,
      isPlaying,
      handlePreCueTrack,
      handleSelectTrack,
      handleToggleFavorite,
      handleOpenPlaylistModal,
      handleAddTrackToQueue,
      handleRemoveTrackFromPlaylist,
      handleMoveQueueItem,
      handleRemoveFromQueue,
    ]
  );

  return (
    <div
      style={
        isMelodiesPage
          ? {
              backgroundColor: 'var(--ytm-bg)',
              backgroundImage: 'var(--bg-gradient)',
              color: 'var(--ytm-text)',
            }
          : undefined
      }
      className={
        isMelodiesPage
          ? isNowPlayingOpen || isKashishHubOpen
            ? 'fixed inset-0 top-0 z-[130] w-screen h-[100dvh] pb-0 flex flex-col overflow-hidden select-none transition-colors duration-300'
            : isEqMenuOpen ||
                isSleepMenuOpen ||
                isCreatePlaylistOpen ||
                Boolean(trackForPlaylistModal)
              ? 'fixed inset-0 top-14 z-[130] w-full h-[calc(var(--stable-vh,100dvh)-3.5rem)] pb-[calc(3rem+env(safe-area-inset-bottom,0px))] flex flex-col overflow-hidden select-none transition-colors duration-300'
              : 'fixed inset-0 top-14 z-30 w-full h-[calc(var(--stable-vh,100dvh)-3.5rem)] pb-[calc(3rem+env(safe-area-inset-bottom,0px))] flex flex-col overflow-hidden select-none transition-colors duration-300'
          : 'fixed -top-[9999px] -left-[9999px] w-px h-px overflow-hidden opacity-0 pointer-events-none'
      }
    >
      {/* ==================== 1. YOUTUBE MUSIC TOP BAR (OPENS FULL-SCREEN 3-STAGE SEARCH) ==================== */}
      {isMelodiesPage && (
        <div
          ref={searchContainerRef}
          style={{
            backgroundColor: 'var(--ytm-bg)',
            borderColor: 'var(--ytm-border)',
          }}
          className="shrink-0 z-40 border-b transition-colors duration-300"
        >
          <header className="h-14 sm:h-16 px-2.5 sm:px-5 flex items-center justify-between gap-2 sm:gap-3">
            {/* Full-Width Search Trigger Button -> Opens Full-Screen 3-Stage Search Overlay */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic(15);
                setIsFullSearchOpen(true);
              }}
              style={{
                backgroundColor: 'var(--ytm-input-bg)',
                borderColor: 'var(--ytm-border)',
                color: 'var(--ytm-text-muted)',
              }}
              className="flex-1 min-w-0 h-10 sm:h-11 px-3.5 rounded-full border flex items-center gap-2.5 text-left cursor-pointer transition-colors hover:opacity-95 active:scale-[0.99]"
              aria-label="Open full-screen music search"
            >
              <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--ytm-accent)' }} />
              <span className="text-xs sm:text-sm font-medium truncate">
                {searchQuery.trim() ? searchQuery.trim() : 'Search songs, artists, albums...'}
              </span>
            </button>

            {/* Right: Equalizer, Sleep Timer & Kashish Logo Hub Icon */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {/* Equalizer Button */}
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(15);
                  setIsEqMenuOpen((prev) => !prev);
                  setIsSleepMenuOpen(false);
                  setIsKashishHubOpen(false);
                }}
                style={{
                  backgroundColor:
                    isEqMenuOpen || activeEqPreset !== 'Flat'
                      ? 'var(--ytm-accent-soft)'
                      : 'transparent',
                  color:
                    isEqMenuOpen || activeEqPreset !== 'Flat'
                      ? 'var(--ytm-accent)'
                      : 'var(--ytm-text-muted)',
                }}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                title={`Equalizer (${activeEqPreset})`}
                aria-label="Equalizer"
              >
                <Sliders className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
              </button>

              {/* Sleep Timer Button */}
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(15);
                  setIsSleepMenuOpen((prev) => !prev);
                  setIsEqMenuOpen(false);
                  setIsKashishHubOpen(false);
                }}
                style={{
                  backgroundColor:
                    sleepRemainingSec !== null ? 'var(--ytm-accent-soft)' : 'transparent',
                  color:
                    sleepRemainingSec !== null ? 'var(--ytm-accent)' : 'var(--ytm-text-muted)',
                }}
                className="h-10 px-2.5 rounded-full transition-colors cursor-pointer flex items-center justify-center gap-1"
                title="Sleep Timer"
                aria-label="Sleep Timer"
              >
                <Moon className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                {sleepRemainingSec !== null && (
                  <span className="hidden sm:inline text-[10px] font-mono font-bold">
                    {Math.ceil(sleepRemainingSec / 60)}m
                  </span>
                )}
              </button>

              {/* Kashish Library Logo Icon Button (Opens Full-Screen Music Library) */}
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(20);
                  setIsKashishHubOpen((prev) => !prev);
                  setIsSleepMenuOpen(false);
                  setIsEqMenuOpen(false);
                }}
                style={{
                  width: '38px',
                  height: '38px',
                  minWidth: '38px',
                  minHeight: '38px',
                  background: 'linear-gradient(135deg, var(--ytm-accent), #ec4899, #fbbf24)',
                }}
                className={`relative flex items-center justify-center rounded-full p-[1.5px] shadow-md cursor-pointer active:scale-90 transition-transform shrink-0 ${
                  isKashishHubOpen ? 'ring-2 ring-[var(--ytm-accent)] scale-105' : ''
                }`}
                title={`${recipientName}'s Music Library (Playlists, Liked Songs, History)`}
                aria-label={`${recipientName}'s Music Library`}
              >
                <span className="relative w-full h-full rounded-full overflow-hidden bg-gradient-to-br from-[#2d0a1a] to-[#12040a] flex items-center justify-center">
                  <Library className="w-4 h-4 text-amber-300 shrink-0" />
                  <img
                    src="/apple-touch-icon.png"
                    alt={`${recipientName} Library`}
                    width={38}
                    height={38}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                      position: 'absolute',
                      inset: 0,
                    }}
                    className="w-full h-full rounded-full object-cover"
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (!target.dataset.step) {
                        target.dataset.step = '1';
                        target.src = '/pwa-192x192.png';
                      } else if (target.dataset.step === '1') {
                        target.dataset.step = '2';
                        target.src = '/app-icon.png';
                      } else if (target.dataset.step === '2') {
                        target.dataset.step = '3';
                        target.src = '/assets/golden_gaze_logo.svg';
                      } else {
                        target.style.display = 'none';
                      }
                    }}
                  />
                </span>
                <span
                  style={{ backgroundColor: 'var(--ytm-accent)', borderColor: 'var(--ytm-bg)' }}
                  className="absolute -bottom-0.5 -right-0.5 z-10 w-4 h-4 rounded-full border flex items-center justify-center shadow"
                >
                  <Library className="w-2.5 h-2.5 text-white" />
                </span>
              </button>
            </div>
          </header>
        </div>
      )}

      {/* Status Notice Toast Banner */}
      {isMelodiesPage && statusNotice && (
        <div
          style={{
            backgroundColor: 'var(--ytm-surface)',
            borderColor: 'var(--ytm-border)',
            color: 'var(--ytm-text)',
          }}
          className="border-b px-4 py-1.5 flex items-center justify-between text-xs shrink-0 z-30"
        >
          <span className="truncate">{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            style={{ color: 'var(--ytm-text-muted)' }}
            className="ml-2 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ==================== 2. MIDDLE WORKSPACE: MAIN PAGE CONTENT ==================== */}
      <div className="relative flex-1 min-h-0 flex overflow-hidden">
        {/* MAIN SCROLLABLE CONTENT AREA */}
        {isMelodiesPage && (
          <main
            style={{ backgroundColor: 'transparent', color: 'var(--ytm-text)' }}
            className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden px-3 sm:px-6 lg:px-8 pt-3 sm:pt-5 pb-4 sm:pb-6 space-y-6"
          >
            {/* ==================== VIEW A: HOME PAGE ==================== */}
            {ytmView !== 'search' && (
              <div className="max-w-6xl mx-auto space-y-6 pb-2">
                {/* 1. Mood Chips Row + Kashish Library Hub Quick Chip */}
                <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden no-scrollbar touch-pan-x pb-1">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(16);
                      setIsKashishHubOpen(true);
                    }}
                    style={{
                      whiteSpace: 'nowrap',
                      backgroundColor: 'var(--ytm-surface)',
                      borderColor: 'var(--ytm-accent)',
                      color: 'var(--ytm-text)',
                    }}
                    className="pl-1.5 pr-3 py-1 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 flex items-center gap-2 border shadow-xs"
                  >
                    <span
                      style={{ width: '22px', height: '22px', minWidth: '22px', minHeight: '22px' }}
                      className="relative rounded-full overflow-hidden border border-amber-300/80 bg-[#1a0812] flex items-center justify-center shrink-0"
                    >
                      <Library className="w-3 h-3 text-amber-300" />
                      <img
                        src="/apple-touch-icon.png"
                        alt="Library"
                        width={22}
                        height={22}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                          position: 'absolute',
                          inset: 0,
                        }}
                        onError={(e) => {
                          const target = e.currentTarget;
                          if (!target.dataset.step) {
                            target.dataset.step = '1';
                            target.src = '/pwa-192x192.png';
                          } else if (target.dataset.step === '1') {
                            target.dataset.step = '2';
                            target.src = '/assets/golden_gaze_logo.svg';
                          } else {
                            target.style.display = 'none';
                          }
                        }}
                      />
                    </span>
                    <span>Library</span>
                  </button>
                  {HOME_MOOD_CHIPS.map((chip) => {
                    const isActive = homeMood === chip.id;
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic(12);
                          setHomeMood(chip.id);
                        }}
                        style={{
                          whiteSpace: 'nowrap',
                          backgroundColor: isActive
                            ? 'var(--ytm-chip-active-bg)'
                            : 'var(--ytm-chip-bg)',
                          color: isActive
                            ? 'var(--ytm-chip-active-text)'
                            : 'var(--ytm-chip-text)',
                          borderColor: isActive ? 'var(--ytm-chip-active-bg)' : 'var(--ytm-border)',
                        }}
                        className="px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-semibold whitespace-nowrap transition-all cursor-pointer shrink-0"
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                  {isLoadingMood && (
                    <div
                      style={{ color: 'var(--ytm-text-muted)' }}
                      className="flex items-center gap-1.5 text-xs pl-2 shrink-0 whitespace-nowrap"
                    >
                      <Loader2
                        className="w-3.5 h-3.5 animate-spin shrink-0"
                        style={{ color: 'var(--ytm-accent)' }}
                      />
                      <span className="whitespace-nowrap">Updating...</span>
                    </div>
                  )}
                </div>

                {/* 2. "Listen again" Horizontal Scroll Row */}
                <section className="space-y-3">
                  <div className="flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        style={{ color: 'var(--ytm-text-muted)' }}
                        className="text-[11px] font-semibold uppercase tracking-wider truncate"
                      >
                        {homeMood === 'All' ? 'Jump back in' : `${homeMood} mix`}
                      </p>
                      <h2
                        style={{ color: 'var(--ytm-text)' }}
                        className="text-lg sm:text-2xl font-extrabold tracking-tight truncate"
                      >
                        Listen again
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (homeListenAgain.length > 0) {
                          handleSelectTrack(
                            homeListenAgain[0],
                            homeListenAgain,
                            `LISTEN_AGAIN_${homeMood.toUpperCase()}`,
                            true
                          );
                        }
                      }}
                      style={{
                        borderColor: 'var(--ytm-border)',
                        color: 'var(--ytm-text)',
                        backgroundColor: 'var(--ytm-surface)',
                      }}
                      className="px-3 py-1 rounded-full border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                    >
                      Play all
                    </button>
                  </div>

                  <div className="-mx-3 px-3 sm:mx-0 sm:px-0 flex items-stretch gap-3 sm:gap-4 overflow-x-auto overflow-y-hidden pb-2 no-scrollbar touch-pan-x snap-x snap-mandatory scroll-pl-3 sm:scroll-pl-0">
                    {homeListenAgain.map((item) => {
                      const isCurrent = displayTrack.videoId === item.videoId;
                      return (
                        <MemoTrackCard
                          key={`listen-again-${item.videoId}`}
                          song={item}
                          isCurrent={isCurrent}
                          isRowPlaying={isCurrent && isPlaying}
                          isFav={favoriteIds.has(item.videoId)}
                          queueContext={homeListenAgain}
                          queueLabel={`LISTEN_AGAIN_${homeMood.toUpperCase()}`}
                          variant="carousel"
                          onPreCue={handlePreCueTrack}
                          onSelect={handleSelectTrack}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      );
                    })}
                  </div>
                </section>

                {/* 3. "Quick picks" Responsive Thumbnail Grid */}
                <section className="space-y-3">
                  <div className="flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        style={{ color: 'var(--ytm-text-muted)' }}
                        className="text-[11px] font-semibold uppercase tracking-wider truncate"
                      >
                        Start radio from a song
                      </p>
                      <h2
                        style={{ color: 'var(--ytm-text)' }}
                        className="text-lg sm:text-2xl font-extrabold tracking-tight truncate"
                      >
                        Quick picks
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (homeQuickPicks.length > 0) {
                          handleSelectTrack(
                            homeQuickPicks[0],
                            homeQuickPicks,
                            `QUICK_PICKS_${homeMood.toUpperCase()}`,
                            true
                          );
                        }
                      }}
                      style={{
                        borderColor: 'var(--ytm-border)',
                        color: 'var(--ytm-text)',
                        backgroundColor: 'var(--ytm-surface)',
                      }}
                      className="px-3 py-1 rounded-full border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                    >
                      Play all
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {isLoadingMood && !(moodTracksCache[homeMood]?.length) ? (
                      Array.from({ length: 8 }).map((_, idx) => (
                        <div
                          key={`qp-skel-${idx}`}
                          style={{
                            backgroundColor: 'var(--ytm-surface)',
                            borderColor: 'var(--ytm-border)',
                          }}
                          className="rounded-2xl border p-2.5 animate-pulse flex flex-col"
                        >
                          <div
                            style={{ backgroundColor: 'var(--ytm-surface-elevated)' }}
                            className="w-full aspect-square rounded-xl mb-2"
                          />
                          <div
                            style={{ backgroundColor: 'var(--ytm-surface-elevated)' }}
                            className="h-3.5 w-3/4 rounded mb-1.5"
                          />
                          <div
                            style={{ backgroundColor: 'var(--ytm-surface-elevated)' }}
                            className="h-2.5 w-1/2 rounded"
                          />
                        </div>
                      ))
                    ) : (
                      homeQuickPicks.map((song) => {
                        const isCurrent = displayTrack.videoId === song.videoId;
                        return (
                          <MemoTrackCard
                            key={`quick-pick-grid-${song.videoId}`}
                            song={song}
                            isCurrent={isCurrent}
                            isRowPlaying={isCurrent && isPlaying}
                            isFav={favoriteIds.has(song.videoId)}
                            queueContext={homeQuickPicks}
                            queueLabel={`QUICK_PICKS_${homeMood.toUpperCase()}`}
                            forceSongCatalog
                            variant="grid"
                            onPreCue={handlePreCueTrack}
                            onSelect={handleSelectTrack}
                            onToggleFavorite={handleToggleFavorite}
                          />
                        );
                      })
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* ==================== VIEW D: FALLBACK SEARCH RESULTS ==================== */}
            {ytmView === 'search' && (
              <div className="max-w-6xl mx-auto space-y-5 pb-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setYtmView('home')}
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                        color: 'var(--ytm-text)',
                      }}
                      className="px-3 py-1.5 rounded-full border text-xs font-bold cursor-pointer transition-colors"
                    >
                      ← Back
                    </button>
                    <div>
                      <p
                        style={{ color: 'var(--ytm-text-muted)' }}
                        className="text-[11px] font-semibold uppercase tracking-wider"
                      >
                        Music Catalog
                      </p>
                      <h2
                        style={{ color: 'var(--ytm-text)' }}
                        className="text-lg sm:text-xl font-extrabold"
                      >
                        {searchQuery.trim()
                          ? `Results for "${searchQuery.trim()}"`
                          : 'Featured Search Results'}
                      </h2>
                    </div>
                  </div>

                  {/* Songs vs Videos Tab Switcher */}
                  <div
                    style={{
                      backgroundColor: 'var(--ytm-surface)',
                      borderColor: 'var(--ytm-border)',
                    }}
                    className="flex items-center gap-2 p-1 rounded-full border"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveResultSection('songs');
                        activeResultSectionRef.current = 'songs';
                      }}
                      style={{
                        backgroundColor:
                          activeResultSection !== 'videos' ? 'var(--ytm-accent)' : 'transparent',
                        color:
                          activeResultSection !== 'videos'
                            ? 'var(--ytm-accent-text)'
                            : 'var(--ytm-text-muted)',
                      }}
                      className="px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Music className="w-3.5 h-3.5" />
                      <span>Songs ({tracks.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveResultSection('videos');
                        activeResultSectionRef.current = 'videos';
                      }}
                      style={{
                        backgroundColor:
                          activeResultSection === 'videos' ? 'var(--ytm-accent)' : 'transparent',
                        color:
                          activeResultSection === 'videos'
                            ? 'var(--ytm-accent-text)'
                            : 'var(--ytm-text-muted)',
                      }}
                      className="px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Film className="w-3.5 h-3.5" />
                      <span>Videos ({videoTracks.length})</span>
                    </button>
                  </div>
                </div>

                {searchError && (
                  <div
                    style={{
                      backgroundColor: 'var(--ytm-surface)',
                      borderColor: 'var(--ytm-accent)',
                      color: 'var(--ytm-text)',
                    }}
                    className="p-4 rounded-2xl border flex items-center justify-between gap-3 text-xs"
                  >
                    <span>{searchError}</span>
                    <button
                      type="button"
                      onClick={() => void runSearch(searchQuery || 'Bollywood hits', false)}
                      style={{
                        backgroundColor: 'var(--ytm-accent)',
                        color: 'var(--ytm-accent-text)',
                      }}
                      className="px-3 py-1.5 rounded-full font-bold flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Retry</span>
                    </button>
                  </div>
                )}

                {activeResultSection === 'videos' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {videoTracks.map((vid) => {
                      const isCurrent = displayTrack.videoId === vid.videoId;
                      return (
                        <div
                          key={`vid-${vid.videoId}`}
                          onClick={() => {
                            setShowVideoViewport(true);
                            showVideoViewportRef.current = true;
                            setIsNowPlayingOpen(true);
                            handleSelectTrack(
                              { ...vid, mediaType: 'video', catalogSource: 'youtube_video' },
                              videoTracks,
                              'VIDEOS'
                            );
                          }}
                          style={{
                            backgroundColor: 'var(--ytm-surface)',
                            borderColor: isCurrent ? 'var(--ytm-accent)' : 'var(--ytm-border)',
                          }}
                          className="group rounded-2xl border p-2.5 transition-all cursor-pointer"
                        >
                          <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black mb-2.5">
                            <HighResThumbnail
                              videoId={vid.videoId}
                              rawThumbnail={vid.thumbnail}
                              alt={vid.title}
                              aspect="video"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            <div className="absolute inset-0 bg-black/35 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <div
                                style={{ backgroundColor: 'var(--ytm-accent)' }}
                                className="w-10 h-10 rounded-full text-white flex items-center justify-center shadow-lg"
                              >
                                <Play className="w-5 h-5 fill-white ml-0.5" />
                              </div>
                            </div>
                            {vid.durationText && (
                              <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-white">
                                {vid.durationText}
                              </span>
                            )}
                          </div>
                          <p
                            style={{ color: 'var(--ytm-text)' }}
                            className="text-xs sm:text-sm font-bold truncate"
                          >
                            {vid.title}
                          </p>
                          <p
                            style={{ color: 'var(--ytm-text-muted)' }}
                            className="text-[11px] truncate mt-0.5"
                          >
                            {vid.artist}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    style={{
                      backgroundColor: 'var(--ytm-surface)',
                      borderColor: 'var(--ytm-border)',
                    }}
                    className="border rounded-2xl p-2 sm:p-3 space-y-0.5"
                  >
                    {tracks.map((song, idx) =>
                      renderSongRow(song, idx, tracks, 'SEARCH_RESULTS')
                    )}
                  </div>
                )}
              </div>
            )}
          </main>
        )}

        {/* ==================== 3. YOUTUBE MUSIC / APPLE MUSIC UNIFIED FULL-SCREEN EXPANDED PLAYER ==================== */}
        <div
          style={
            isMelodiesPage && isNowPlayingOpen
              ? {
                  background: isLightTheme
                    ? `radial-gradient(120% 90% at 50% 0%, rgba(${coverAmbientRgb}, 0.28) 0%, rgba(${coverAmbientRgb}, 0.12) 48%, transparent 100%), var(--ytm-bg)`
                    : `radial-gradient(120% 90% at 50% 0%, rgba(${coverAmbientRgb}, 0.68) 0%, rgba(${coverAmbientRgb}, 0.34) 45%, rgba(12, 12, 16, 0.96) 100%), linear-gradient(180deg, rgba(${coverAmbientRgb}, 0.42) 0%, var(--ytm-bg) 100%)`,
                  color: 'var(--ytm-text)',
                }
              : undefined
          }
          className={
            isMelodiesPage && isNowPlayingOpen
              ? 'fixed inset-0 z-[130] w-screen h-[var(--stable-vh,100dvh)] pt-[max(0.5rem,env(safe-area-inset-top,0px))] pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] flex flex-col overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] opacity-100 translate-y-0 pointer-events-auto backdrop-blur-3xl will-change-[opacity,transform]'
              : 'fixed -top-[9999px] -left-[9999px] w-px h-px opacity-0 translate-y-6 pointer-events-none overflow-hidden z-[-1] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]'
          }
        >
          {/* Single Continuous Full-Screen Player Container */}
          <div className="w-full max-w-xl mx-auto flex-1 min-h-0 flex flex-col justify-between overflow-hidden px-4 sm:px-8 pt-1.5 pb-2">
            {/* TOP BAR: Minimize Chevron + Smart Song | Video Toggle Pill (Video Tracks Only) + Actions */}
            {isMelodiesPage && isNowPlayingOpen && (
              <div className="w-full flex flex-col items-center shrink-0 pb-1 z-20">
                {/* Sheet Grabber Handle */}
                <button
                  type="button"
                  onClick={() => setIsNowPlayingOpen(false)}
                  aria-label="Minimize Now Playing"
                  className="py-1 px-6 cursor-pointer group focus:outline-none"
                >
                  <div
                    style={{ backgroundColor: 'var(--ytm-text-muted)', opacity: 0.45 }}
                    className="w-10 h-1.5 rounded-full group-hover:opacity-80 transition-opacity"
                  />
                </button>

                <div className="w-full flex items-center justify-between gap-2 mt-0.5">
                  <button
                    type="button"
                    onClick={() => setIsNowPlayingOpen(false)}
                    style={{
                      backgroundColor: 'var(--ytm-surface)',
                      borderColor: 'var(--ytm-border)',
                      color: 'var(--ytm-text)',
                    }}
                    className="w-9 h-9 rounded-full border flex items-center justify-center cursor-pointer transition-all active:scale-90 shrink-0"
                    title="Minimize player"
                    aria-label="Minimize player"
                  >
                    <ChevronDown className="w-5 h-5" />
                  </button>

                  {/* Smart Song | Video Toggle Pill — ONLY rendered when a video song is playing */}
                  {isVideoAvailableForCurrentTrack ? (
                    <div
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="flex items-center backdrop-blur-md border rounded-full p-1 shadow-lg"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (showVideoViewport) handleToggleVideoViewport();
                        }}
                        style={{
                          backgroundColor: !showVideoViewport
                            ? 'var(--ytm-chip-active-bg)'
                            : 'transparent',
                          color: !showVideoViewport
                            ? 'var(--ytm-chip-active-text)'
                            : 'var(--ytm-text-muted)',
                        }}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer"
                      >
                        <Music className="w-3.5 h-3.5" />
                        <span>Song</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!showVideoViewport) handleToggleVideoViewport();
                        }}
                        style={{
                          backgroundColor: showVideoViewport
                            ? 'var(--ytm-chip-active-bg)'
                            : 'transparent',
                          color: showVideoViewport
                            ? 'var(--ytm-chip-active-text)'
                            : 'var(--ytm-text-muted)',
                        }}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer"
                      >
                        <Film className="w-3.5 h-3.5" />
                        <span>Video</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1" />
                  )}

                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(15);
                        ensureWebAudioEqGraph();
                        setIsEqMenuOpen(true);
                      }}
                      style={
                        activeEqPreset !== 'Flat'
                          ? {
                              backgroundColor: 'var(--ytm-accent-soft)',
                              color: 'var(--ytm-accent)',
                              borderColor: 'var(--ytm-accent)',
                            }
                          : {
                              backgroundColor: 'var(--ytm-surface)',
                              color: 'var(--ytm-text)',
                              borderColor: 'var(--ytm-border)',
                            }
                      }
                      className="relative w-9 h-9 rounded-full border flex items-center justify-center cursor-pointer transition-all active:scale-90 shrink-0"
                      title={`Studio Equalizer (${activeEqPreset})`}
                      aria-label="Studio Equalizer"
                    >
                      <Sliders className="w-4 h-4" />
                      {activeEqPreset !== 'Flat' && (
                        <span
                          style={{ backgroundColor: 'var(--ytm-accent)' }}
                          className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white/60"
                        />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setTrackForPlaylistModal(displayTrack)}
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                        color: 'var(--ytm-text)',
                      }}
                      className="w-9 h-9 rounded-full border flex items-center justify-center cursor-pointer transition-all active:scale-90 shrink-0"
                      title="Add to playlist"
                      aria-label="Add to playlist"
                    >
                      <Plus className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(20);
                        setIsKashishHubOpen(true);
                      }}
                      style={{ width: '36px', height: '36px', minWidth: '36px', minHeight: '36px' }}
                      className="relative flex items-center justify-center rounded-full p-[1.5px] bg-gradient-to-tr from-[#ff0033] via-pink-500 to-amber-300 shadow-[0_0_12px_rgba(255,0,51,0.4)] cursor-pointer active:scale-90 transition-transform shrink-0"
                      title={`${recipientName}'s Music Library`}
                      aria-label={`${recipientName}'s Music Library`}
                    >
                      <span className="relative w-full h-full rounded-full overflow-hidden bg-gradient-to-br from-[#2d0a1a] to-[#12040a] flex items-center justify-center">
                        <Library className="w-4 h-4 text-amber-300 shrink-0" />
                        <img
                          src="/apple-touch-icon.png"
                          alt={`${recipientName} Library`}
                          width={36}
                          height={36}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                            position: 'absolute',
                            inset: 0,
                          }}
                          className="w-full h-full rounded-full object-cover"
                          onError={(e) => {
                            const target = e.currentTarget;
                            if (!target.dataset.step) {
                              target.dataset.step = '1';
                              target.src = '/pwa-192x192.png';
                            } else if (target.dataset.step === '1') {
                              target.dataset.step = '2';
                              target.src = '/app-icon.png';
                            } else if (target.dataset.step === '2') {
                              target.dataset.step = '3';
                              target.src = '/assets/golden_gaze_logo.svg';
                            } else {
                              target.style.display = 'none';
                            }
                          }}
                        />
                      </span>
                      <span
                        style={{ backgroundColor: 'var(--ytm-accent)' }}
                        className="absolute -bottom-0.5 -right-0.5 z-10 w-3.5 h-3.5 rounded-full border border-black/40 flex items-center justify-center"
                      >
                        <Library className="w-2 h-2 text-white" />
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 1. PERSISTENT SINGLETON YOUTUBE IFRAME CONTAINER — NEVER UNMOUNTS */}
            <div
              ref={videoContainerRef}
              onMouseMove={resetVideoControlsTimer}
              onTouchStart={resetVideoControlsTimer}
              onClick={resetVideoControlsTimer}
              className={
                isMelodiesPage && isNowPlayingOpen && showVideoViewport && isVideoAvailableForCurrentTrack && displayTrack
                  ? `relative w-full aspect-video ${
                      isVideoFullscreen
                        ? 'fixed inset-0 z-50 w-screen h-screen max-h-none rounded-none'
                        : isAppleSheetDrawerOpen
                        ? 'max-h-[18dvh] rounded-2xl shadow-xl my-1'
                        : 'max-h-[32dvh] sm:max-h-[36dvh] rounded-2xl shadow-[0_24px_50px_rgba(0,0,0,0.45)] my-1.5'
                    } overflow-hidden bg-black shrink-0 mx-auto group select-none transition-all duration-300`
                  : 'fixed -top-[9999px] -left-[9999px] w-px h-px opacity-0 pointer-events-none overflow-hidden z-[-1]'
              }
            >
              <div
                id="kashish-yt-iframe-wrapper"
                style={
                  isMelodiesPage && isNowPlayingOpen && showVideoViewport && isVideoAvailableForCurrentTrack && displayTrack
                    ? {
                        position: 'absolute',
                        top: '-14%',
                        left: '-2%',
                        width: '104%',
                        height: '128%',
                      }
                    : {
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                      }
                }
                className="overflow-hidden pointer-events-none"
              />

              {isMelodiesPage && isNowPlayingOpen && showVideoViewport && isVideoAvailableForCurrentTrack && displayTrack && (
                <>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      resetVideoControlsTimer();
                      setIsVideoQualityOpen(false);
                      handleTogglePlayPause();
                    }}
                    className="absolute inset-0 z-10 cursor-pointer"
                    aria-label="Toggle video playback"
                  />
                  {isBuffering && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 pointer-events-none">
                      <Loader2 className="w-8 h-8 text-white animate-spin" />
                    </div>
                  )}
                  <div
                    className={`absolute bottom-3 right-3 z-20 flex items-center gap-2 transition-opacity ${
                      showVideoControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFullscreen();
                      }}
                      className="p-2 rounded-full bg-black/75 text-white hover:bg-black cursor-pointer"
                      title="Toggle Fullscreen"
                    >
                      {isVideoFullscreen ? (
                        <Minimize2 className="w-4 h-4" />
                      ) : (
                        <Maximize2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 2A. MAIN ARTWORK & CONTROLS SCREEN (WHEN UP NEXT / LYRICS / RELATED DRAWER IS CLOSED) */}
            {isMelodiesPage && isNowPlayingOpen && !isAppleSheetDrawerOpen && (
              <div className="flex-1 min-h-0 flex flex-col justify-evenly py-1 overflow-hidden">
                {/* Responsive 1:1 Square Album Artwork */}
                {(!showVideoViewport || !isVideoAvailableForCurrentTrack) && (
                  <div className="w-full flex items-center justify-center my-auto py-1">
                    <div
                      onClick={handleTogglePlayPause}
                      style={{ backgroundColor: 'var(--ytm-surface)' }}
                      className={`relative w-[min(76vw,36dvh)] sm:w-[min(76vw,40dvh)] max-w-[320px] aspect-square rounded-[24px] overflow-hidden cursor-pointer transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                        isPlaying
                          ? isLightTheme
                            ? 'scale-100 shadow-[0_22px_48px_rgba(0,0,0,0.22)] ring-1 ring-black/10'
                            : 'scale-100 shadow-[0_24px_50px_rgba(0,0,0,0.72)] ring-1 ring-white/15'
                          : isLightTheme
                          ? 'scale-[0.88] opacity-90 shadow-[0_12px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5'
                          : 'scale-[0.88] opacity-90 shadow-[0_12px_28px_rgba(0,0,0,0.45)] ring-1 ring-white/10'
                      }`}
                    >
                      <HighResThumbnail
                        videoId={displayTrack.videoId}
                        rawThumbnail={displayTrack.thumbnail}
                        alt={displayTrack.title}
                        aspect="square"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                )}

                {/* Track Title, Artist & Action Buttons */}
                <div className="w-full flex items-center justify-between gap-3 pt-1">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <h2
                      style={{ color: 'var(--ytm-text)' }}
                      className="block text-lg sm:text-2xl font-bold tracking-tight truncate whitespace-nowrap"
                    >
                      {displayTrack.title}
                    </h2>
                    <p
                      style={{ color: 'var(--ytm-text-muted)' }}
                      className="block text-xs sm:text-base font-medium truncate whitespace-nowrap mt-0.5"
                    >
                      {displayTrack.artist}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleFavorite(displayTrack)}
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                        color: 'var(--ytm-text)',
                      }}
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border backdrop-blur-md flex items-center justify-center cursor-pointer active:scale-90 transition-all"
                      title="Favorite song"
                      aria-label="Favorite song"
                    >
                      <Heart
                        className={`w-4.5 h-4.5 ${
                          favoriteIds.has(displayTrack.videoId)
                            ? 'fill-[#fa2d48] text-[#fa2d48]'
                            : ''
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTrackForPlaylistModal(displayTrack)}
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                        color: 'var(--ytm-text)',
                      }}
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border backdrop-blur-md flex items-center justify-center cursor-pointer active:scale-90 transition-all"
                      title="Add to playlist"
                      aria-label="Add to playlist"
                    >
                      <FolderPlus className="w-4.5 h-4.5" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar Scrubber */}
                <div className="w-full pt-1">
                  <PlayerProgressBar
                    variant="apple"
                    getPlaybackMetrics={getPlaybackMetrics}
                    onSeekTo={handleSeekTo}
                    isPlaying={isPlaying}
                    trackId={displayTrack.videoId}
                    fallbackDurationSec={displayTrack.durationSeconds || 215}
                    accentColor={isLightTheme ? 'var(--ytm-accent)' : 'rgba(255,255,255,0.95)'}
                    trackBg={isLightTheme ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.22)'}
                    textColor={isLightTheme ? 'rgba(26,16,20,0.68)' : 'rgba(255,255,255,0.68)'}
                  />
                </div>

                {/* Transport Controls */}
                <div className="w-full flex items-center justify-between px-2 sm:px-6 py-1">
                  <button
                    type="button"
                    onClick={handleToggleShuffle}
                    style={{
                      backgroundColor: isShuffle ? 'var(--ytm-accent-soft)' : 'transparent',
                      color: isShuffle ? 'var(--ytm-accent)' : 'var(--ytm-text-muted)',
                    }}
                    className="p-2 rounded-full transition-all cursor-pointer active:scale-90"
                    title={isShuffle ? 'Shuffle On' : 'Shuffle Off'}
                    aria-label="Toggle shuffle"
                  >
                    <Shuffle className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={playPrevTrack}
                    style={{ color: 'var(--ytm-text)' }}
                    className="p-2.5 rounded-full active:scale-90 transition-all cursor-pointer"
                    title="Previous"
                    aria-label="Previous track"
                  >
                    <SkipBack className="w-7 h-7 sm:w-8 sm:h-8 fill-current" />
                  </button>

                  <button
                    type="button"
                    onClick={handleTogglePlayPause}
                    style={{
                      backgroundColor: isLightTheme ? 'var(--ytm-accent)' : 'rgba(255,255,255,0.14)',
                      color: isLightTheme ? 'var(--ytm-accent-text)' : '#ffffff',
                    }}
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all cursor-pointer"
                    title={isPlaying ? 'Pause' : 'Play'}
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isBuffering ? (
                      <Loader2 className="w-8 h-8 animate-spin" />
                    ) : isPlaying ? (
                      <Pause className="w-8 h-8 sm:w-9 sm:h-9 fill-current" />
                    ) : (
                      <Play className="w-8 h-8 sm:w-9 sm:h-9 fill-current ml-1" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={playNextTrack}
                    style={{ color: 'var(--ytm-text)' }}
                    className="p-2.5 rounded-full active:scale-90 transition-all cursor-pointer"
                    title="Next"
                    aria-label="Next track"
                  >
                    <SkipForward className="w-7 h-7 sm:w-8 sm:h-8 fill-current" />
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleRepeat}
                    style={{
                      backgroundColor: repeatMode !== 'off' ? 'var(--ytm-accent-soft)' : 'transparent',
                      color: repeatMode !== 'off' ? 'var(--ytm-accent)' : 'var(--ytm-text-muted)',
                    }}
                    className="p-2 rounded-full transition-all cursor-pointer active:scale-90"
                    title={`Repeat: ${repeatMode}`}
                    aria-label="Toggle repeat mode"
                  >
                    {repeatMode === 'one' ? (
                      <Repeat1 className="w-5 h-5" />
                    ) : (
                      <Repeat className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* 2B. COMPACT HEADER + INTEGRATED UP NEXT / LYRICS / RELATED VIEW (WHEN DRAWER IS OPEN) */}
            {isMelodiesPage && isNowPlayingOpen && isAppleSheetDrawerOpen && (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden pt-1">
                {/* Compact Mini-Header (Tap thumbnail/title to return to full Artwork view) */}
                <div
                  style={{ borderColor: 'var(--ytm-border)' }}
                  className="w-full flex items-center justify-between gap-3 pb-2.5 border-b shrink-0"
                >
                  <button
                    type="button"
                    onClick={() => setIsAppleSheetDrawerOpen(false)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer group"
                    title="Return to full artwork player"
                  >
                    <div
                      style={{ backgroundColor: 'var(--ytm-surface)' }}
                      className="relative w-11 h-11 rounded-xl overflow-hidden shadow-md ring-1 ring-black/10 shrink-0 group-hover:scale-105 transition-transform"
                    >
                      <HighResThumbnail
                        videoId={displayTrack.videoId}
                        rawThumbnail={displayTrack.thumbnail}
                        alt={displayTrack.title}
                        aspect="square"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <p
                        style={{ color: 'var(--ytm-text)' }}
                        className="block text-sm sm:text-base font-bold truncate whitespace-nowrap"
                      >
                        {displayTrack.title}
                      </p>
                      <p
                        style={{ color: 'var(--ytm-text-muted)' }}
                        className="block text-xs truncate whitespace-nowrap"
                      >
                        {displayTrack.artist}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleTogglePlayPause}
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                        color: 'var(--ytm-text)',
                      }}
                      className="w-9 h-9 rounded-full border flex items-center justify-center cursor-pointer active:scale-90 transition-all"
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isBuffering ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isPlaying ? (
                        <Pause className="w-4 h-4 fill-current" />
                      ) : (
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={playNextTrack}
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                        color: 'var(--ytm-text)',
                      }}
                      className="w-9 h-9 rounded-full border flex items-center justify-center cursor-pointer active:scale-90 transition-all"
                      aria-label="Next track"
                    >
                      <SkipForward className="w-4 h-4 fill-current" />
                    </button>
                  </div>
                </div>

                {/* Scrollable Content Area inside Unified Player */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden pt-2">
                  {/* Tab 1: UP NEXT Queue (Vibe-Matched Radio) */}
                  {nowPlayingTab === 'upnext' && (
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                      <div className="shrink-0 py-1.5 text-xs flex items-center justify-between">
                        <span
                          style={{ color: 'var(--ytm-text)' }}
                          className="font-bold tracking-tight"
                        >
                          Up Next • {activeQueueList.length}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleToggleShuffle}
                            style={{
                              backgroundColor: isShuffle
                                ? 'var(--ytm-chip-active-bg)'
                                : 'var(--ytm-surface)',
                              color: isShuffle
                                ? 'var(--ytm-chip-active-text)'
                                : 'var(--ytm-text-muted)',
                            }}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Shuffle className="w-3 h-3" />
                            <span>Shuffle</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleToggleRepeat}
                            style={{
                              backgroundColor:
                                repeatMode !== 'off'
                                  ? 'var(--ytm-chip-active-bg)'
                                  : 'var(--ytm-surface)',
                              color:
                                repeatMode !== 'off'
                                  ? 'var(--ytm-chip-active-text)'
                                  : 'var(--ytm-text-muted)',
                            }}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            {repeatMode === 'one' ? (
                              <Repeat1 className="w-3 h-3" />
                            ) : (
                              <Repeat className="w-3 h-3" />
                            )}
                            <span>Repeat</span>
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y py-1.5 pb-4 space-y-1">
                        {activeQueueList.map((song, idx) =>
                          renderSongRow(song, idx, activeQueueList, activeQueueLabel, {
                            showQueueControls: true,
                            totalInQueue: activeQueueList.length,
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tab 2: LYRICS */}
                  {nowPlayingTab === 'lyrics' && (
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y py-3 pb-6 space-y-4">
                      {isLoadingLyrics ? (
                        <div
                          style={{ color: 'var(--ytm-text-muted)' }}
                          className="h-40 flex flex-col items-center justify-center gap-2"
                        >
                          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--ytm-accent)' }} />
                          <span className="text-xs">Loading lyrics for {displayTrack.title}...</span>
                        </div>
                      ) : lyricsData?.plainLyrics ? (
                        <div className="space-y-3">
                          <div
                            style={{
                              color: 'var(--ytm-text-muted)',
                              borderColor: 'var(--ytm-border)',
                            }}
                            className="flex items-center justify-between gap-2 text-[11px] border-b pb-2"
                          >
                            <span className="truncate">{displayTrack.title}</span>
                            <span className="whitespace-nowrap shrink-0">
                              Source: {lyricsData.source}
                            </span>
                          </div>
                          <pre
                            style={{ color: 'var(--ytm-text)' }}
                            className="whitespace-pre-wrap font-sans text-lg sm:text-xl font-bold leading-relaxed tracking-tight"
                          >
                            {lyricsData.plainLyrics}
                          </pre>
                        </div>
                      ) : (
                        <div
                          style={{ color: 'var(--ytm-text-muted)' }}
                          className="h-40 flex flex-col items-center justify-center text-center text-sm font-medium"
                        >
                          Lyrics unavailable for this track.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab 3: RELATED SONGS */}
                  {nowPlayingTab === 'related' && (
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                      <div className="shrink-0 py-1.5 flex items-center gap-1.5 overflow-x-auto overflow-y-hidden no-scrollbar touch-pan-x">
                        {RELATED_MOOD_CHIPS.map((chip) => {
                          const active = relatedMoodFilter === chip.id;
                          return (
                            <button
                              key={chip.id}
                              type="button"
                              onClick={() => setRelatedMoodFilter(chip.id)}
                              style={{
                                whiteSpace: 'nowrap',
                                backgroundColor: active
                                  ? 'var(--ytm-chip-active-bg)'
                                  : 'var(--ytm-chip-bg)',
                                color: active
                                  ? 'var(--ytm-chip-active-text)'
                                  : 'var(--ytm-chip-text)',
                              }}
                              className="px-3 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors flex items-center gap-1 shrink-0"
                            >
                              <span className="shrink-0">{chip.emoji}</span>
                              <span className="whitespace-nowrap">{chip.name}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div
                        ref={relatedScrollContainerRef}
                        onScroll={handleRelatedListScroll}
                        className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y py-1.5 pb-4 space-y-1"
                      >
                        {relatedTracks.map((song, idx) =>
                          renderSongRow(song, idx, [displayTrack, ...relatedTracks], 'RELATED')
                        )}

                        {isLoadingRelated && (
                          <div
                            style={{ color: 'var(--ytm-text-muted)' }}
                            className="py-3 flex items-center justify-center gap-2 text-xs"
                          >
                            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--ytm-accent)' }} />
                            <span>Finding more related songs...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. YOUTUBE MUSIC BOTTOM TAB BAR (UP NEXT | LYRICS | RELATED) */}
            {isMelodiesPage && isNowPlayingOpen && (
              <div
                style={{ borderColor: 'var(--ytm-border)' }}
                className="w-full grid grid-cols-3 gap-2 pt-2 pb-1 shrink-0 border-t z-20"
              >
                {/* Up Next Button */}
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    if (isAppleSheetDrawerOpen && nowPlayingTab === 'upnext') {
                      setIsAppleSheetDrawerOpen(false);
                    } else {
                      setNowPlayingTab('upnext');
                      setIsAppleSheetDrawerOpen(true);
                    }
                  }}
                  style={{
                    backgroundColor:
                      isAppleSheetDrawerOpen && nowPlayingTab === 'upnext'
                        ? 'var(--ytm-chip-active-bg)'
                        : 'var(--ytm-surface)',
                    color:
                      isAppleSheetDrawerOpen && nowPlayingTab === 'upnext'
                        ? 'var(--ytm-chip-active-text)'
                        : 'var(--ytm-text)',
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                  title="Up Next Queue"
                  aria-label="Toggle Up Next Queue"
                >
                  <ListMusic className="w-4 h-4 shrink-0" />
                  <span>Up Next</span>
                </button>

                {/* Lyrics Button */}
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    if (isAppleSheetDrawerOpen && nowPlayingTab === 'lyrics') {
                      setIsAppleSheetDrawerOpen(false);
                    } else {
                      setNowPlayingTab('lyrics');
                      setIsAppleSheetDrawerOpen(true);
                    }
                  }}
                  style={{
                    backgroundColor:
                      isAppleSheetDrawerOpen && nowPlayingTab === 'lyrics'
                        ? 'var(--ytm-chip-active-bg)'
                        : 'var(--ytm-surface)',
                    color:
                      isAppleSheetDrawerOpen && nowPlayingTab === 'lyrics'
                        ? 'var(--ytm-chip-active-text)'
                        : 'var(--ytm-text)',
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                  title="Lyrics"
                  aria-label="Toggle Lyrics"
                >
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>Lyrics</span>
                </button>

                {/* Related Tracks Button */}
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    if (isAppleSheetDrawerOpen && nowPlayingTab === 'related') {
                      setIsAppleSheetDrawerOpen(false);
                    } else {
                      setNowPlayingTab('related');
                      setIsAppleSheetDrawerOpen(true);
                    }
                  }}
                  style={{
                    backgroundColor:
                      isAppleSheetDrawerOpen && nowPlayingTab === 'related'
                        ? 'var(--ytm-chip-active-bg)'
                        : 'var(--ytm-surface)',
                    color:
                      isAppleSheetDrawerOpen && nowPlayingTab === 'related'
                        ? 'var(--ytm-chip-active-text)'
                        : 'var(--ytm-text)',
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                  title="Related Songs"
                  aria-label="Toggle Related Songs"
                >
                  <Compass className="w-4 h-4 shrink-0" />
                  <span>Related</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ==================== 4. FLOATING PILL MINI-PLAYER (THEME-ADAPTIVE) ==================== */}
      {isMelodiesPage && !isNowPlayingOpen && (
        <footer
          onClick={() => setIsNowPlayingOpen(true)}
          style={{
            background: isLightTheme
              ? `linear-gradient(90deg, rgba(${coverAmbientRgb}, 0.16) 0%, var(--ytm-surface-elevated) 65%)`
              : `linear-gradient(90deg, rgba(${coverAmbientRgb}, 0.28) 0%, var(--ytm-surface-elevated) 65%)`,
            borderColor: 'var(--ytm-border)',
            color: 'var(--ytm-text)',
          }}
          className="relative h-14 sm:h-16 mx-2 mb-1 sm:mx-3 sm:mb-1.5 rounded-2xl backdrop-blur-2xl border shadow-lg px-3 sm:px-4 flex items-center justify-between gap-2.5 sm:gap-4 shrink-0 z-40 cursor-pointer transition-all duration-200 ease-out overflow-hidden"
        >
          {/* Thin Subtle Progress Bar at the Top Edge of the Mini-Player Pill */}
          <PlayerProgressBar
            variant="top-edge"
            getPlaybackMetrics={getPlaybackMetrics}
            onSeekTo={handleSeekTo}
            isPlaying={isPlaying}
            trackId={displayTrack.videoId}
            fallbackDurationSec={displayTrack.durationSeconds || 215}
            accentColor="var(--ytm-accent)"
            trackBg={isLightTheme ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.14)'}
          />

          {/* LEFT: Rounded Album Art + Song Title & Artist */}
          <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
            <div
              style={{ backgroundColor: 'var(--ytm-surface)' }}
              className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-xl overflow-hidden shadow-md ring-1 ring-black/10 shrink-0"
            >
              <HighResThumbnail
                videoId={displayTrack.videoId}
                rawThumbnail={displayTrack.thumbnail}
                alt={displayTrack.title}
                aspect="square"
                className="w-full h-full object-cover"
              />
            </div>

            <div className="min-w-0 flex-1 overflow-hidden">
              <p
                style={{ color: 'var(--ytm-text)' }}
                className="block text-xs sm:text-sm font-bold truncate whitespace-nowrap"
              >
                {displayTrack.title}
              </p>
              <p
                style={{ color: 'var(--ytm-text-muted)' }}
                className="block text-[11px] sm:text-xs truncate whitespace-nowrap"
              >
                {displayTrack.artist}
              </p>
            </div>
          </div>

          {/* RIGHT: Clean Controls (Favorite, Play/Pause, Next) */}
          <div
            className="flex items-center gap-1 sm:gap-2 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => handleToggleFavorite(displayTrack)}
              style={{ color: 'var(--ytm-text-muted)' }}
              className="p-2 rounded-full transition-colors cursor-pointer"
              title="Favorite song"
              aria-label="Like current song"
            >
              <Heart
                className={`w-4 h-4 sm:w-5 sm:h-5 ${
                  favoriteIds.has(displayTrack.videoId)
                    ? 'fill-[#fa2d48] text-[#fa2d48]'
                    : ''
                }`}
              />
            </button>

            <button
              type="button"
              onClick={handleTogglePlayPause}
              style={{ color: 'var(--ytm-text)' }}
              className="p-2 rounded-full active:scale-90 transition-all cursor-pointer"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isBuffering ? (
                <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
              ) : (
                <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={playNextTrack}
              style={{ color: 'var(--ytm-text)' }}
              className="p-2 rounded-full active:scale-90 transition-all cursor-pointer"
              title="Next (Right Arrow)"
              aria-label="Next track"
            >
              <SkipForward className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
            </button>
          </div>
        </footer>
      )}

      {/* ==================== 6. MODALS & POPOVERS (PLAYLISTS, EQUALIZER, SLEEP TIMER) ==================== */}
      {/* Create Playlist Modal */}
      {isMelodiesPage && isCreatePlaylistOpen && (
        <div
          onClick={() => setIsCreatePlaylistOpen(false)}
          style={{ backgroundColor: 'var(--ytm-backdrop)' }}
          className="fixed inset-0 z-[170] backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--ytm-sheet-bg)',
              borderColor: 'var(--ytm-border)',
              color: 'var(--ytm-text)',
            }}
            className="w-full max-w-sm rounded-2xl border p-5 space-y-4 shadow-2xl liquid-sheet-in"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">New playlist</h3>
              <button
                type="button"
                onClick={() => setIsCreatePlaylistOpen(false)}
                style={{ color: 'var(--ytm-text-muted)' }}
                className="cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreatePlaylist} className="space-y-4">
              <input
                type="text"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="Playlist title (e.g. Late Night Vibes)"
                autoFocus
                style={{
                  backgroundColor: 'var(--ytm-input-bg)',
                  borderColor: 'var(--ytm-border)',
                  color: 'var(--ytm-text)',
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border text-sm outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreatePlaylistOpen(false)}
                  style={{ color: 'var(--ytm-text-muted)' }}
                  className="px-4 py-2 rounded-full text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newPlaylistName.trim()}
                  style={{
                    backgroundColor: 'var(--ytm-accent)',
                    color: 'var(--ytm-accent-text)',
                  }}
                  className="px-5 py-2 rounded-full disabled:opacity-40 text-xs font-bold cursor-pointer"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Save Track to Playlist Modal */}
      {isMelodiesPage && trackForPlaylistModal && (
        <div
          onClick={() => setTrackForPlaylistModal(null)}
          style={{ backgroundColor: 'var(--ytm-backdrop)' }}
          className="fixed inset-0 z-[170] backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--ytm-sheet-bg)',
              borderColor: 'var(--ytm-border)',
              color: 'var(--ytm-text)',
            }}
            className="w-full max-w-sm rounded-2xl border p-5 space-y-4 shadow-2xl liquid-sheet-in"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-base font-bold">Save to playlist</h3>
                <p style={{ color: 'var(--ytm-text-muted)' }} className="text-xs truncate">
                  {trackForPlaylistModal.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTrackForPlaylistModal(null)}
                style={{ color: 'var(--ytm-text-muted)' }}
                className="cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5">
              {playlists.length === 0 ? (
                <p style={{ color: 'var(--ytm-text-muted)' }} className="text-xs py-3 text-center">
                  No custom playlists yet. Create one below!
                </p>
              ) : (
                playlists.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => handleAddTrackToPlaylist(pl.id, trackForPlaylistModal)}
                    style={{
                      backgroundColor: 'var(--ytm-surface)',
                      borderColor: 'var(--ytm-border)',
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border flex items-center justify-between text-left transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ListMusic
                        className="w-4 h-4 shrink-0"
                        style={{ color: 'var(--ytm-accent)' }}
                      />
                      <span className="text-xs sm:text-sm font-semibold truncate">
                        {pl.name}
                      </span>
                    </div>
                    <span style={{ color: 'var(--ytm-text-muted)' }} className="text-[11px]">
                      {pl.tracks.length} songs
                    </span>
                  </button>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setIsCreatePlaylistOpen(true);
              }}
              style={{
                backgroundColor: 'var(--ytm-accent)',
                color: 'var(--ytm-accent-text)',
              }}
              className="w-full py-2.5 rounded-full text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New playlist</span>
            </button>
          </div>
        </div>
      )}

      {/* 3-Band Equalizer Modal (Defaults to Flat on fresh install) */}
      {isMelodiesPage && isEqMenuOpen && (
        <div
          onClick={() => setIsEqMenuOpen(false)}
          style={{ backgroundColor: 'var(--ytm-backdrop)' }}
          className="fixed inset-0 z-[170] backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--ytm-sheet-bg)',
              borderColor: 'var(--ytm-border)',
              color: 'var(--ytm-text)',
            }}
            className="w-full max-w-md rounded-2xl border p-5 space-y-4 shadow-2xl liquid-sheet-in"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4" style={{ color: 'var(--ytm-accent)' }} />
                <div>
                  <h3 className="text-base font-bold leading-tight">Studio Equalizer</h3>
                  <p style={{ color: 'var(--ytm-text-muted)' }} className="text-[11px]">
                    Active:{' '}
                    <span style={{ color: 'var(--ytm-accent)' }} className="font-semibold">
                      {activeEqPreset}
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeEqPreset !== 'Flat' && (
                  <button
                    type="button"
                    onClick={() => handleSelectEqPreset('Flat')}
                    style={{
                      backgroundColor: 'var(--ytm-surface)',
                      color: 'var(--ytm-text)',
                      borderColor: 'var(--ytm-border)',
                    }}
                    className="px-2.5 py-1 rounded-full border text-[11px] font-semibold cursor-pointer"
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsEqMenuOpen(false)}
                  style={{ color: 'var(--ytm-text-muted)' }}
                  className="cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {Object.keys(EQ_PRESETS).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleSelectEqPreset(preset)}
                  style={{
                    backgroundColor:
                      activeEqPreset === preset ? 'var(--ytm-accent)' : 'var(--ytm-surface)',
                    color:
                      activeEqPreset === preset
                        ? 'var(--ytm-accent-text)'
                        : 'var(--ytm-text-muted)',
                    borderColor:
                      activeEqPreset === preset ? 'var(--ytm-accent)' : 'var(--ytm-border)',
                  }}
                  className="px-3 py-1 rounded-full border text-xs font-semibold cursor-pointer transition-colors"
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="space-y-3 pt-1">
              {(
                [
                  { key: 'bass', label: 'Bass (100 Hz)' },
                  { key: 'mid', label: 'Mid (1 kHz)' },
                  { key: 'treble', label: 'Treble (8 kHz)' },
                ] as const
              ).map((b) => (
                <div key={b.key} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--ytm-text-muted)' }} className="font-medium">
                      {b.label}
                    </span>
                    <span style={{ color: 'var(--ytm-accent)' }} className="font-mono font-bold">
                      {eqBands[b.key] > 0 ? `+${eqBands[b.key]}` : eqBands[b.key]} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={eqBands[b.key]}
                    onChange={(e) => handleEqBandChange(b.key, Number(e.target.value))}
                    style={{ accentColor: 'var(--ytm-accent)' }}
                    className="w-full h-1.5 rounded-lg cursor-pointer"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sleep Timer Modal */}
      {isMelodiesPage && isSleepMenuOpen && (
        <div
          onClick={() => setIsSleepMenuOpen(false)}
          style={{ backgroundColor: 'var(--ytm-backdrop)' }}
          className="fixed inset-0 z-[170] backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--ytm-sheet-bg)',
              borderColor: 'var(--ytm-border)',
              color: 'var(--ytm-text)',
            }}
            className="w-full max-w-xs rounded-2xl border p-5 space-y-3 shadow-2xl liquid-sheet-in"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Moon className="w-4 h-4" style={{ color: 'var(--ytm-accent)' }} />
                <h3 className="text-base font-bold">Sleep Timer</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSleepMenuOpen(false)}
                style={{ color: 'var(--ytm-text-muted)' }}
                className="cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[5, 15, 30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => handleSelectSleepTimer(mins)}
                  style={{
                    backgroundColor:
                      sleepTimerMinutes === mins ? 'var(--ytm-accent)' : 'var(--ytm-surface)',
                    color:
                      sleepTimerMinutes === mins
                        ? 'var(--ytm-accent-text)'
                        : 'var(--ytm-text)',
                    borderColor:
                      sleepTimerMinutes === mins ? 'var(--ytm-accent)' : 'var(--ytm-border)',
                  }}
                  className="py-2 rounded-xl text-xs font-bold border cursor-pointer transition-colors"
                >
                  {mins} minutes
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleSelectSleepTimer(null)}
                style={{
                  backgroundColor: 'var(--ytm-surface)',
                  color: 'var(--ytm-text-muted)',
                  borderColor: 'var(--ytm-border)',
                }}
                className="py-2 rounded-xl text-xs font-bold border cursor-pointer"
              >
                Off
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 7. FULL-SCREEN KASHISH MUSIC LIBRARY (EDGE-TO-EDGE TOP TO BOTTOM) ==================== */}
      {isMelodiesPage && isKashishHubOpen && (
        <div
          style={{
            backgroundColor: 'var(--ytm-bg)',
            color: 'var(--ytm-text)',
            paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))',
            paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))',
          }}
          className="fixed inset-0 z-[165] w-screen h-[var(--stable-vh,100dvh)] flex flex-col overflow-hidden liquid-overlay-in"
        >
          {/* Sticky Top Header */}
          <div
            style={{
              backgroundColor: 'var(--ytm-surface-elevated)',
              borderColor: 'var(--ytm-border)',
            }}
            className="w-full border-b backdrop-blur-xl shrink-0"
          >
            <div className="max-w-3xl mx-auto px-3 sm:px-5 pt-2.5 pb-3">
              <div className="flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(10);
                      setIsKashishHubOpen(false);
                    }}
                    style={{
                      backgroundColor: 'var(--ytm-surface)',
                      borderColor: 'var(--ytm-border)',
                      color: 'var(--ytm-text)',
                    }}
                    className="w-9 h-9 rounded-full border flex items-center justify-center cursor-pointer active:scale-90 transition-transform shrink-0"
                    aria-label="Back from Library"
                    title="Back"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>

                  <div
                    style={{ width: '40px', height: '40px', minWidth: '40px', minHeight: '40px' }}
                    className="relative flex items-center justify-center rounded-full p-[1.5px] bg-gradient-to-tr from-[#ff0033] via-pink-500 to-amber-300 shadow-[0_0_14px_rgba(255,0,51,0.35)] shrink-0"
                  >
                    <div className="relative w-full h-full rounded-full overflow-hidden bg-gradient-to-br from-[#2d0a1a] to-[#12040a] flex items-center justify-center">
                      <Library className="w-4 h-4 text-amber-300 shrink-0" />
                      <img
                        src="/apple-touch-icon.png"
                        alt={recipientName}
                        width={40}
                        height={40}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                          position: 'absolute',
                          inset: 0,
                        }}
                        className="w-full h-full rounded-full object-cover"
                        onError={(e) => {
                          const target = e.currentTarget;
                          if (!target.dataset.step) {
                            target.dataset.step = '1';
                            target.src = '/pwa-192x192.png';
                          } else if (target.dataset.step === '1') {
                            target.dataset.step = '2';
                            target.src = '/app-icon.png';
                          } else if (target.dataset.step === '2') {
                            target.dataset.step = '3';
                            target.src = '/assets/golden_gaze_logo.svg';
                          } else {
                            target.style.display = 'none';
                          }
                        }}
                      />
                    </div>
                    <span
                      style={{ backgroundColor: 'var(--ytm-accent)' }}
                      className="absolute -bottom-0.5 -right-0.5 z-10 w-4 h-4 rounded-full border border-black/40 flex items-center justify-center shadow"
                    >
                      <Library className="w-2.5 h-2.5 text-white" />
                    </span>
                  </div>
                  <div className="min-w-0">
                    <h3
                      style={{ color: 'var(--ytm-text)' }}
                      className="text-sm sm:text-base font-extrabold truncate"
                    >
                      {recipientName}&apos;s Music Library
                    </h3>
                    <p
                      style={{ color: 'var(--ytm-text-muted)' }}
                      className="text-[11px] truncate"
                    >
                      Playlists • Liked Songs • History • Up Next
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleToggleHighQuality}
                    style={{
                      backgroundColor: isHighQuality
                        ? 'var(--ytm-accent)'
                        : 'var(--ytm-surface)',
                      color: isHighQuality
                        ? 'var(--ytm-accent-text)'
                        : 'var(--ytm-text-muted)',
                      borderColor: isHighQuality
                        ? 'var(--ytm-accent)'
                        : 'var(--ytm-border)',
                    }}
                    className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider border cursor-pointer transition-all"
                  >
                    {isHighQuality ? 'HD ON' : 'HD OFF'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsKashishHubOpen(false)}
                    style={{
                      backgroundColor: 'var(--ytm-surface)',
                      borderColor: 'var(--ytm-border)',
                      color: 'var(--ytm-text-muted)',
                    }}
                    className="w-8 h-8 rounded-full border flex items-center justify-center cursor-pointer"
                    aria-label="Close Music Library"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* 4-Tab Segmented Bar: Playlists | Liked | History | Queue */}
              <div
                style={{
                  backgroundColor: 'var(--ytm-surface)',
                  borderColor: 'var(--ytm-border)',
                }}
                className="grid grid-cols-4 gap-1 p-1 rounded-2xl mt-3 border"
              >
                {[
                  {
                    id: 'playlists' as const,
                    label: 'Playlists',
                    count: playlists.length,
                    icon: ListMusic,
                  },
                  {
                    id: 'liked' as const,
                    label: 'Liked',
                    count: favoriteTracks.length,
                    icon: Heart,
                  },
                  {
                    id: 'history' as const,
                    label: 'History',
                    count: recentPlayedTracks.length,
                    icon: Clock,
                  },
                  {
                    id: 'queue' as const,
                    label: 'Queue',
                    count: activeQueueList.length,
                    icon: Music,
                  },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const active = kashishHubTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        triggerHaptic(10);
                        setKashishHubTab(tab.id);
                      }}
                      style={{
                        backgroundColor: active ? 'var(--ytm-accent)' : 'transparent',
                        color: active ? 'var(--ytm-accent-text)' : 'var(--ytm-text-muted)',
                      }}
                      className="py-2 px-1.5 rounded-xl text-[11px] font-bold flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-1">
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{tab.label}</span>
                      </div>
                      <span className="text-[9px] font-mono opacity-85">{tab.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Full-Height Scrollable Body Content */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="max-w-3xl mx-auto p-3.5 sm:p-5 space-y-3 pb-10">
              {/* TAB 1: PLAYLISTS */}
              {kashishHubTab === 'playlists' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span
                      style={{ color: 'var(--ytm-text-muted)' }}
                      className="text-xs font-bold"
                    >
                      Your Custom Playlists ({playlists.length})
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setIsKashishHubOpen(false);
                          setTrackForPlaylistModal(displayTrack);
                        }}
                        style={{
                          backgroundColor: 'var(--ytm-surface)',
                          borderColor: 'var(--ytm-border)',
                          color: 'var(--ytm-text)',
                        }}
                        className="px-2.5 py-1.5 rounded-full border text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <FolderPlus
                          className="w-3.5 h-3.5"
                          style={{ color: 'var(--ytm-accent)' }}
                        />
                        <span>Save Current Song</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsKashishHubOpen(false);
                          setIsCreatePlaylistOpen(true);
                        }}
                        style={{
                          backgroundColor: 'var(--ytm-accent)',
                          color: 'var(--ytm-accent-text)',
                        }}
                        className="px-3 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>New Playlist</span>
                      </button>
                    </div>
                  </div>

                  {playlists.length === 0 ? (
                    <div
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="py-12 px-4 text-center rounded-2xl border space-y-2"
                    >
                      <ListMusic
                        className="w-8 h-8 mx-auto opacity-80"
                        style={{ color: 'var(--ytm-accent)' }}
                      />
                      <p style={{ color: 'var(--ytm-text)' }} className="text-sm font-bold">
                        No playlists created yet
                      </p>
                      <p style={{ color: 'var(--ytm-text-muted)' }} className="text-xs">
                        Create your own custom playlists to organize your favorite tracks.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {playlists.map((pl) => (
                        <div
                          key={pl.id}
                          style={{
                            backgroundColor: 'var(--ytm-surface)',
                            borderColor: 'var(--ytm-border)',
                          }}
                          className="rounded-2xl border p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <h4
                                style={{ color: 'var(--ytm-text)' }}
                                className="text-sm font-bold truncate"
                              >
                                {pl.name}
                              </h4>
                              <p
                                style={{ color: 'var(--ytm-text-muted)' }}
                                className="text-[11px]"
                              >
                                {pl.tracks.length} {pl.tracks.length === 1 ? 'song' : 'songs'}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {pl.tracks.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleSelectTrack(pl.tracks[0], pl.tracks, `PLAYLIST_${pl.name}`);
                                    setIsKashishHubOpen(false);
                                  }}
                                  style={{
                                    backgroundColor: 'var(--ytm-accent)',
                                    color: 'var(--ytm-accent-text)',
                                  }}
                                  className="px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  <Play className="w-3 h-3 fill-current" />
                                  <span>Play</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeletePlaylist(pl.id)}
                                style={{ color: 'var(--ytm-text-muted)' }}
                                className="p-1.5 rounded-full cursor-pointer"
                                title="Delete playlist"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {pl.tracks.length > 0 && (
                            <div className="pt-1 space-y-0.5 max-h-60 overflow-y-auto">
                              {pl.tracks.map((song, idx) =>
                                renderSongRow(song, idx, pl.tracks, `PLAYLIST_${pl.name}`, {
                                  showPlaylistRemoveId: pl.id,
                                })
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: LIKED SONGS */}
              {kashishHubTab === 'liked' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      style={{ color: 'var(--ytm-text-muted)' }}
                      className="text-xs font-bold"
                    >
                      Liked Songs ({favoriteTracks.length})
                    </span>
                    {favoriteTracks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          handleSelectTrack(favoriteTracks[0], favoriteTracks, 'LIKED_SONGS');
                          setIsKashishHubOpen(false);
                        }}
                        style={{
                          backgroundColor: 'var(--ytm-accent)',
                          color: 'var(--ytm-accent-text)',
                        }}
                        className="px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Play All</span>
                      </button>
                    )}
                  </div>

                  {favoriteTracks.length === 0 ? (
                    <div
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="py-12 px-4 text-center rounded-2xl border space-y-2"
                    >
                      <Heart
                        className="w-8 h-8 mx-auto opacity-80"
                        style={{ color: 'var(--ytm-accent)' }}
                      />
                      <p style={{ color: 'var(--ytm-text)' }} className="text-sm font-bold">
                        No liked songs yet
                      </p>
                      <p style={{ color: 'var(--ytm-text-muted)' }} className="text-xs">
                        Tap the heart icon on any song to save it to your Liked Songs.
                      </p>
                    </div>
                  ) : (
                    <div
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="rounded-2xl border p-1.5 space-y-0.5"
                    >
                      {favoriteTracks.map((song, idx) =>
                        renderSongRow(song, idx, favoriteTracks, 'LIKED_SONGS')
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: SONG HISTORY (RECENTLY PLAYED) */}
              {kashishHubTab === 'history' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      style={{ color: 'var(--ytm-text-muted)' }}
                      className="text-xs font-bold"
                    >
                      Recently Played History ({recentPlayedTracks.length})
                    </span>
                    {recentPlayedTracks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          handleSelectTrack(recentPlayedTracks[0], recentPlayedTracks, 'HISTORY');
                          setIsKashishHubOpen(false);
                        }}
                        style={{
                          backgroundColor: 'var(--ytm-accent)',
                          color: 'var(--ytm-accent-text)',
                        }}
                        className="px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Play All</span>
                      </button>
                    )}
                  </div>

                  {recentPlayedTracks.length === 0 ? (
                    <div
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="py-12 px-4 text-center rounded-2xl border space-y-2"
                    >
                      <Clock
                        className="w-8 h-8 mx-auto opacity-80"
                        style={{ color: 'var(--ytm-accent)' }}
                      />
                      <p style={{ color: 'var(--ytm-text)' }} className="text-sm font-bold">
                        No listening history yet
                      </p>
                      <p style={{ color: 'var(--ytm-text-muted)' }} className="text-xs">
                        Songs you play will automatically appear here in your listening history.
                      </p>
                    </div>
                  ) : (
                    <div
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="rounded-2xl border p-1.5 space-y-0.5"
                    >
                      {recentPlayedTracks.map((song, idx) =>
                        renderSongRow(song, idx, recentPlayedTracks, 'HISTORY')
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: PLAYING NEXT QUEUE */}
              {kashishHubTab === 'queue' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      style={{ color: 'var(--ytm-text-muted)' }}
                      className="text-xs font-bold"
                    >
                      Playing Next Queue ({activeQueueList.length})
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleToggleShuffle}
                        style={{
                          backgroundColor: isShuffle
                            ? 'var(--ytm-accent)'
                            : 'var(--ytm-surface)',
                          color: isShuffle
                            ? 'var(--ytm-accent-text)'
                            : 'var(--ytm-text-muted)',
                          borderColor: isShuffle
                            ? 'var(--ytm-accent)'
                            : 'var(--ytm-border)',
                        }}
                        className="px-2.5 py-1 rounded-full border text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Shuffle className="w-3 h-3" />
                        <span>Shuffle</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleToggleRepeat}
                        style={{
                          backgroundColor:
                            repeatMode !== 'off'
                              ? 'var(--ytm-accent)'
                              : 'var(--ytm-surface)',
                          color:
                            repeatMode !== 'off'
                              ? 'var(--ytm-accent-text)'
                              : 'var(--ytm-text-muted)',
                          borderColor:
                            repeatMode !== 'off'
                              ? 'var(--ytm-accent)'
                              : 'var(--ytm-border)',
                        }}
                        className="px-2.5 py-1 rounded-full border text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Repeat className="w-3 h-3" />
                        <span>Repeat: {repeatMode}</span>
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: 'var(--ytm-surface)',
                      borderColor: 'var(--ytm-border)',
                    }}
                    className="rounded-2xl border p-1.5 space-y-0.5"
                  >
                    {activeQueueList.map((song, idx) =>
                      renderSongRow(song, idx, activeQueueList, activeQueueLabel, {
                        showQueueControls: true,
                        totalInQueue: activeQueueList.length,
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 8. FULL-SCREEN 3-STAGE YOUTUBE MUSIC SEARCH OVERLAY ==================== */}
      <MusicSearchOverlay
        isOpen={isMelodiesPage && isFullSearchOpen}
        initialQuery={searchQuery}
        recentSearches={recentSearches}
        currentTrackId={displayTrack.videoId}
        isPlaying={isPlaying}
        favoriteIds={favoriteIds}
        onClose={() => setIsFullSearchOpen(false)}
        onAddRecentSearch={(q) => {
          const trimmed = q.trim();
          if (!trimmed) return;
          setSearchQuery(trimmed);
          const next = saveUserRecentSearch(userIdRef.current, trimmed);
          setRecentSearches(next);
        }}
        onRemoveRecentSearch={(q) => {
          const next = removeUserRecentSearch(userIdRef.current, q);
          setRecentSearches(next);
        }}
        onClearRecentSearches={() => {
          recentSearches.forEach((item) => {
            removeUserRecentSearch(userIdRef.current, item);
          });
          setRecentSearches([]);
        }}
        onPlaySong={(song) => {
          setIsFullSearchOpen(false);
          setShowVideoViewport(false);
          showVideoViewportRef.current = false;
          setIsNowPlayingOpen(true);
          handleSelectTrack(
            { ...song, mediaType: 'song', catalogSource: 'youtube_music' },
            [],
            'SEARCH_RESULTS'
          );
        }}
        onPlayVideo={(video) => {
          setIsFullSearchOpen(false);
          setShowVideoViewport(true);
          showVideoViewportRef.current = true;
          setIsNowPlayingOpen(true);
          handleSelectTrack(
            { ...video, mediaType: 'video', catalogSource: 'youtube_video' },
            [video],
            'VIDEOS'
          );
        }}
        onToggleFavorite={handleToggleFavorite}
      />
    </div>
  );
};
