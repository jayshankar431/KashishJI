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
  ArrowUpLeft,
  Maximize2,
  Minimize2,
  Check,
  Settings2,
  Compass,
  Sparkles,
} from 'lucide-react';
import { MusicDiscoveryView } from './MusicDiscoveryView';
import {
  loadUserFavorites,
  saveUserFavorites,
  QUICK_PICKS_TRACKS,
  ALL_DISCOVERY_TRACKS,
  resolveCanonicalTrack,
  getCachedRelatedTracks,
  fetchNextRelatedTracksBatch,
} from '../services/musicDiscoveryData';
import {
  YouTubeTrack,
  searchYouTubeSongs,
  searchYouTubeVideos,
  getCachedSearchEntry,
  getCachedVideoSearchEntry,
  refreshSearchInBackground,
  findEmbeddableAlternative,
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
  fetchYouTubeSuggestions,
} from '../services/youtubeSearch';
import { triggerHaptic, showNativeToast, logNativeActivity } from '../androidBridge';
import type { NavTab } from './Navbar';

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

function buildMediaArtworkList(rawThumbnail: string | undefined, videoId: string): MediaImage[] {
  const primary = normalizeSquareThumbnail(rawThumbnail, videoId);
  const sizes = [96, 128, 192, 256, 384, 512];

  if (
    primary.includes('googleusercontent.com') ||
    primary.includes('ggpht.com')
  ) {
    return sizes.map((sz) => ({
      src: primary.replace(/=w\d+-h\d+[^&?]*/i, `=w${sz}-h${sz}-l90-rj`),
      sizes: `${sz}x${sz}`,
      type: 'image/jpeg',
    }));
  }

  return sizes.map((sz) => ({
    src: primary,
    sizes: `${sz}x${sz}`,
    type: 'image/jpeg',
  }));
}

/**
 * Generates a 180-second looping 19 Hz sub-audible PCM WAV Blob URL in the top-level document
 * with -42.7 dBFS energy (well above Chromium's -72 dBFS AudioPowerMonitor silence threshold,
 * while remaining physically inaudible <20 Hz).
 * Used when playing video via the cross-origin YouTube iframe so Chromium's MediaSessionImpl
 * still registers an active audible top-level <audio> element and publishes `navigator.mediaSession`
 * controls to the Android notification panel and lock screen.
 */
let sharedCarrierAudio: HTMLAudioElement | null = null;
function getTopLevelAudioCarrier(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (sharedCarrierAudio) return sharedCarrierAudio;
  try {
    const sampleRate = 44100;
    const durationSeconds = 60;
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
    // 19 Hz sub-audible wave with 16-bit amplitude 240 (-42.7 dBFS > -72 dBFS Chromium threshold)
    // and volume = 1.0 so Chromium AudioPowerMonitor always marks is_silent = false.
    const twoPiF = (2 * Math.PI * 19) / sampleRate;
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.round(Math.sin(i * twoPiF) * 240);
      view.setInt16(44 + i * 2, sample, true);
    }
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.src = url;
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 1.0;
    audio.setAttribute('playsinline', 'true');
    audio.style.display = 'none';
    document.body.appendChild(audio);
    sharedCarrierAudio = audio;
    return audio;
  } catch {
    return null;
  }
}

/**
 * Singleton top-level HTML5 <audio> element for direct YouTube Music audio stream playback.
 * Playing audio directly in the top-level document guarantees:
 * 1) Zero audio cutout/stutter when minimizing the app or locking the phone screen (no video surface detach).
 * 2) Instant Android System Media Notification controller via `navigator.mediaSession`.
 */
let sharedNativeAudio: HTMLAudioElement | null = null;
function getTopLevelNativeAudioElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (sharedNativeAudio) return sharedNativeAudio;
  try {
    const audio = document.createElement('audio');
    audio.id = 'kashish-native-music-audio';
    audio.preload = 'auto';
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('referrerpolicy', 'no-referrer');
    audio.style.display = 'none';
    document.body.appendChild(audio);
    sharedNativeAudio = audio;
    return audio;
  } catch {
    return null;
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
}

/**
 * Isolated progress scrubber component so 1-second time ticks never re-render
 * the search results list or parent card, while keeping Media Session position synced.
 */
const PlayerProgressBar = memo(
  ({
    getPlaybackMetrics,
    onSeekTo,
    isPlaying,
    trackId,
    fallbackDurationSec = 0,
    accentColor = 'var(--accent)',
    accentGradient,
    trackBg = 'var(--card-border)',
    textColor = 'var(--text-soft)',
  }: ProgressBarProps) => {
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(fallbackDurationSec);
    const [isSeeking, setIsSeeking] = useState(false);

    useEffect(() => {
      setCurrentTime(0);
      setDuration(fallbackDurationSec || 0);
    }, [trackId, fallbackDurationSec]);

    useEffect(() => {
      if (!isPlaying || isSeeking) return;
      const updateProgress = () => {
        try {
          const { currentTime: cur, duration: dur } = getPlaybackMetrics();
          setCurrentTime(cur);
          const effectiveDur = dur > 0 ? dur : fallbackDurationSec;
          if (effectiveDur > 0) {
            setDuration(effectiveDur);
            updateMediaSessionPosition(cur, effectiveDur);
          }
        } catch {
          // Ignore transient player state errors
        }
      };

      updateProgress();
      const interval = window.setInterval(updateProgress, 1000);
      return () => window.clearInterval(interval);
    }, [isPlaying, isSeeking, getPlaybackMetrics, fallbackDurationSec]);

    const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextVal = Number(e.target.value);
      setCurrentTime(nextVal);
    };

    const handleSeekCommit = (
      e:
        | React.MouseEvent<HTMLInputElement>
        | React.TouchEvent<HTMLInputElement>
        | React.ChangeEvent<HTMLInputElement>
    ) => {
      const target = e.currentTarget as HTMLInputElement;
      const seekToSec = Number(target.value);
      setIsSeeking(false);
      onSeekTo(seekToSec);
      if (duration > 0) {
        updateMediaSessionPosition(seekToSec, duration);
      }
    };

    const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

    return (
      <div className="flex items-center gap-2 w-full">
        <span
          style={{ color: textColor }}
          className="text-[10px] font-mono tabular-nums w-8 text-right shrink-0"
        >
          {formatDuration(currentTime) || '0:00'}
        </span>
        <div className="relative flex-1 flex items-center h-4">
          <div
            style={{ backgroundColor: trackBg }}
            className="w-full h-1.5 rounded-full overflow-hidden"
          >
            <div
              style={{
                width: `${progressPercent}%`,
                background: accentGradient || accentColor,
              }}
              className="h-full rounded-full transition-all duration-200"
            />
          </div>
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 100}
            step={1}
            value={currentTime}
            disabled={!trackId || !duration}
            onMouseDown={() => setIsSeeking(true)}
            onTouchStart={() => setIsSeeking(true)}
            onChange={handleSeekChange}
            onMouseUp={handleSeekCommit}
            onTouchEnd={handleSeekCommit}
            aria-label="Seek song playback position"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
          />
        </div>
        <span
          style={{ color: textColor }}
          className="text-[10px] font-mono tabular-nums w-8 shrink-0"
        >
          {duration > 0 ? formatDuration(duration) : '--:--'}
        </span>
      </div>
    );
  }
);

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

interface DarlingMusicPlayerProps {
  activeTab: NavTab;
  recipientName?: string;
  userId?: string;
}

export const DarlingMusicPlayer: React.FC<DarlingMusicPlayerProps> = ({
  activeTab,
  recipientName = 'Darling',
  userId = 'guest',
}) => {
  const [slotElement, setSlotElement] = useState<HTMLElement | null>(null);

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

  const handleToggleFavorite = useCallback((track: YouTubeTrack) => {
    triggerHaptic(20);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(track.videoId)) {
        next.delete(track.videoId);
        setStatusNotice(`Removed "${track.title}" from favorites`);
      } else {
        next.add(track.videoId);
        setStatusNotice(`Added "${track.title}" to favorites ❤️`);
      }
      saveUserFavorites(userId, next);
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
  const [activeEqPreset, setActiveEqPreset] = useState<string>('Bass Boost');
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

  // Active playback backend: 'yt' (YouTube IFrame Player with top-level MediaSession audio carrier)
  const playbackBackendRef = useRef<'native' | 'yt'>('yt');
  const loadedNativeVideoIdRef = useRef<string | null>(null);

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

  // Seek handler for both Native HTML5 <audio> and YouTube IFrame Player API + MediaSession position sync
  const handleSeekTo = useCallback((seconds: number) => {
    const safeSec = Math.max(0, seconds);
    let effectiveDur = currentTrackRef.current?.durationSeconds || 0;

    if (playbackBackendRef.current === 'native') {
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

      const thumbUrl = normalizeSquareThumbnail(track.thumbnail, track.videoId);
      const artworkList = buildMediaArtworkList(track.thumbnail, track.videoId);
      const { currentTime, duration } = getPlaybackMetrics();
      const effectiveDur = duration > 0 ? duration : track.durationSeconds || 0;

      if (
        typeof navigator !== 'undefined' &&
        'mediaSession' in navigator &&
        typeof window !== 'undefined' &&
        typeof (window as any).MediaMetadata !== 'undefined'
      ) {
        try {
          navigator.mediaSession.metadata = new window.MediaMetadata({
            title: track.title,
            artist: track.artist,
            album: track.album || `Kashish's World · Melodies for ${recipientName}`,
            artwork: artworkList,
          });
          navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
          bindMediaSessionHandlersRef.current();

          if (effectiveDur > 0) {
            updateMediaSessionPosition(currentTime, effectiveDur);
          }
        } catch {}
      }

      // IMPORTANT FOR APK:
      // In older APK builds, `CallAndOverlayHelper.updateMusicNotification(..., isPlaying = true)`
      // calls `AudioManager.requestAudioFocus()`, which steals Android AudioFocus away from
      // Chromium WebView if called repeatedly while WebView is already playing!
      // Therefore:
      // 1) Only post the native `playing = true` notification once per track start/resume
      //    (before WebView playback begins), and IMMEDIATELY call `abandonAudioFocus()` on the
      //    next synchronous line so Chromium WebView's AudioFocusDelegate owns AudioFocus 100%.
      // 2) Always post `playing = false` on pause (which never requests AudioFocus).
      try {
        if (!playing) {
          nativeNotifiedPlayingKeyRef.current = null;
          if (typeof window.AndroidApp?.updateMusicNotificationWithPosition === 'function') {
            window.AndroidApp.updateMusicNotificationWithPosition(
              track.title,
              track.artist,
              thumbUrl,
              false,
              Math.max(0, Math.floor(currentTime || 0)),
              Math.max(0, Math.floor(effectiveDur || 0))
            );
          } else {
            window.AndroidApp?.updateMusicNotification?.(
              track.title,
              track.artist,
              thumbUrl,
              false
            );
          }
          window.AndroidApp?.abandonAudioFocus?.();
        } else if (nativeNotifiedPlayingKeyRef.current !== track.videoId) {
          nativeNotifiedPlayingKeyRef.current = track.videoId;
          if (typeof window.AndroidApp?.updateMusicNotificationWithPosition === 'function') {
            window.AndroidApp.updateMusicNotificationWithPosition(
              track.title,
              track.artist,
              thumbUrl,
              true,
              Math.max(0, Math.floor(currentTime || 0)),
              Math.max(0, Math.floor(effectiveDur || 0))
            );
          } else {
            window.AndroidApp?.updateMusicNotification?.(
              track.title,
              track.artist,
              thumbUrl,
              true
            );
          }
          window.AndroidApp?.abandonAudioFocus?.();
        }
      } catch {}
    },
    [getPlaybackMetrics, recipientName]
  );

  // Update Media Session & Native Android notification whenever currentTrack or isPlaying changes
  useEffect(() => {
    applyMediaMetadata(currentTrack, isPlaying);
  }, [currentTrack, isPlaying, applyMediaMetadata]);

  // Pause helper (used by UI, Media Session, and voice note recording event)
  const pausePlayback = useCallback(() => {
    userWantPlayingRef.current = false;
    nativeNotifiedPlayingKeyRef.current = null;
    setIsPlaying(false);
    setIsBuffering(false);

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
              event.target.setVolume(volumeRef.current);
              if (isMutedRef.current) {
                event.target.mute();
              }
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
                loadedVideoIdInPlayerRef.current = trackToPlay.videoId;
                event.target.loadVideoById({
                  videoId: trackToPlay.videoId,
                  suggestedQuality: showVideoViewportRef.current ? 'default' : 'small',
                });
                event.target.playVideo();
              } else if (currentTrackRef.current && !userWantPlayingRef.current) {
                // Pre-cue the restored last-played track without autoplaying
                loadedVideoIdInPlayerRef.current = currentTrackRef.current.videoId;
                event.target.cueVideoById({
                  videoId: currentTrackRef.current.videoId,
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
              if (!firstAudioReachedRef.current) {
                firstAudioReachedRef.current = true;
                if (tapTimestampRef.current !== null) {
                  const firstAudioMs = Math.round(performance.now() - tapTimestampRef.current);
                  if (activeTelemetryEntryRef.current) {
                    activeTelemetryEntryRef.current.tapToFirstAudioMs = firstAudioMs;
                  }
                }
              }
              const carrier = getTopLevelAudioCarrier();
              if (carrier && carrier.paused) {
                carrier.play().catch(() => {});
              }
              setIsPlaying(true);
              setIsBuffering(false);
              setStatusNotice(null);
              if (currentTrackRef.current) {
                applyMediaMetadata(currentTrackRef.current, true);
              }
            } else if (state === 2) {
              // If the user still wants music playing and the video viewport is hidden (or app is minimized),
              // YouTube's iframe auto-paused on background transition — resume immediately!
              if (
                userWantPlayingRef.current &&
                (!showVideoViewportRef.current ||
                  (typeof document !== 'undefined' &&
                    (document.visibilityState === 'hidden' ||
                      document.hidden ||
                      !document.hasFocus())))
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
              setIsPlaying(false);
              setIsBuffering(false);
              playNextTrackRef.current();
            }
          },
          onError: async (event: any) => {
            if (playbackBackendRef.current !== 'yt') return;
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
                    suggestedQuality: showVideoViewportRef.current ? 'default' : 'small',
                  });
                  playerRef.current.playVideo();
                  setStatusNotice(null);
                  return;
                } catch {}
              }
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

  // Helper to start or switch to YouTube IFrame Player for a track (used for Video viewport or fallback)
  const startYouTubeIframePlayback = useCallback(
    (track: YouTubeTrack, startSeconds = 0) => {
      playbackBackendRef.current = 'yt';
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

      if (playerRef.current && isPlayerReadyRef.current) {
        loadedVideoIdInPlayerRef.current = track.videoId;
        try {
          playerRef.current.loadVideoById({
            videoId: track.videoId,
            startSeconds: startSeconds > 0 ? startSeconds : 0,
            suggestedQuality: showVideoViewportRef.current ? 'default' : 'small',
          });
          playerRef.current.playVideo();
        } catch {
          pendingTrackRef.current = track;
        }
      } else {
        pendingTrackRef.current = track;
        ensureYouTubePlayer();
      }

      // If an older APK's Java updateMusicNotification briefly stole Android AudioFocus at t=0ms,
      // re-assert WebView playback at 90ms and 320ms after Java AudioFocus was abandoned.
      for (const delayMs of [90, 320]) {
        window.setTimeout(() => {
          if (!userWantPlayingRef.current || currentTrackRef.current?.videoId !== track.videoId) {
            return;
          }
          try {
            window.AndroidApp?.abandonAudioFocus?.();
          } catch {}
          const c = getTopLevelAudioCarrier();
          if (c && c.paused) {
            c.play().catch(() => {});
          }
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

  const handleSelectTrack = useCallback(
    (incomingTrack: YouTubeTrack) => {
      const tapStartPerf = performance.now();
      lastPlayInitiatedAtRef.current = tapStartPerf;
      triggerHaptic(25);
      userWantPlayingRef.current = true;

      // Resolve against canonical registry first so any known Discovery track has 100% verified metadata & videoId
      const canonicalTrack = resolveCanonicalTrack(incomingTrack);

      // Unified track object linking ID, title, artist, album, and normalized square thumbnail atomically
      const unifiedTrack: YouTubeTrack = {
        ...canonicalTrack,
        thumbnail: normalizeSquareThumbnail(canonicalTrack.thumbnail, canonicalTrack.videoId),
        title: canonicalTrack.title || 'Untitled Track',
        artist: canonicalTrack.artist || 'Kashish Melodies',
      };

      // Persist as the current user's last actually PLAYED song
      saveUserLastPlayedTrack(userIdRef.current, unifiedTrack);
      setRecentPlayedTracks(
        loadUserRecentPlayedTracks(userIdRef.current).map((t) => resolveCanonicalTrack(t))
      );

      // If tapping the exact song that is already loaded in the player, toggle play/pause immediately
      if (
        currentTrackRef.current?.videoId === unifiedTrack.videoId &&
        loadedVideoIdInPlayerRef.current === unifiedTrack.videoId &&
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

      // Start playback synchronously inside the user's click/tap gesture
      startYouTubeIframePlayback(unifiedTrack, 0);

      void logNativeActivity(
        `🎵 ${recipientName} played song: <b>${unifiedTrack.title}</b> (${unifiedTrack.artist})`
      );
    },
    [applyMediaMetadata, pausePlayback, recipientName, startYouTubeIframePlayback]
  );

  // Resume helper (used by UI and Media Session)
  const resumePlayback = useCallback(() => {
    const cur = currentTrackRef.current;
    if (!cur) return;
    lastPlayInitiatedAtRef.current = performance.now();
    userWantPlayingRef.current = true;
    nativeNotifiedPlayingKeyRef.current = null;
    applyMediaMetadata(cur, true);

    const carrier = getTopLevelAudioCarrier();
    if (carrier && carrier.paused) {
      carrier.play().catch(() => {});
    }

    if (
      playerRef.current &&
      isPlayerReadyRef.current &&
      loadedVideoIdInPlayerRef.current === cur.videoId
    ) {
      try {
        playerRef.current.playVideo();
        setIsPlaying(true);
        return;
      } catch {}
    }

    handleSelectTrack(cur);
  }, [applyMediaMetadata, handleSelectTrack]);

  const getActivePlaybackQueue = useCallback((): YouTubeTrack[] => {
    const cur = currentTrackRef.current;
    const songs = tracksRef.current;
    const videos = videoTracksRef.current;

    if (activeResultSectionRef.current === 'discover') {
      if (cur && ALL_DISCOVERY_TRACKS.some((d) => d.videoId === cur.videoId)) {
        return ALL_DISCOVERY_TRACKS;
      }
      if (!cur) {
        return ALL_DISCOVERY_TRACKS;
      }
    }

    if (cur) {
      if (cur.mediaType === 'video' && videos.some((v) => v.videoId === cur.videoId)) {
        return videos;
      }
      if (songs.some((s) => s.videoId === cur.videoId)) {
        return songs;
      }
      if (videos.some((v) => v.videoId === cur.videoId)) {
        return videos;
      }
      if (ALL_DISCOVERY_TRACKS.some((d) => d.videoId === cur.videoId)) {
        return ALL_DISCOVERY_TRACKS;
      }
    }

    if (activeResultSectionRef.current === 'videos' && videos.length > 0) {
      return videos;
    }
    if (activeResultSectionRef.current === 'discover') {
      return ALL_DISCOVERY_TRACKS;
    }
    return songs.length > 0 ? songs : (videos.length > 0 ? videos : ALL_DISCOVERY_TRACKS);
  }, []);

  const playNextTrack = useCallback(() => {
    const list = getActivePlaybackQueue();
    const cur = currentTrackRef.current;
    if (!list.length) {
      if (cur) handleSelectTrack(cur);
      return;
    }
    if (repeatMode === 'one' && cur) {
      handleSelectTrack(cur);
      return;
    }
    if (!cur) {
      handleSelectTrack(list[0]);
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
    handleSelectTrack(list[nextIdx]);
  }, [getActivePlaybackQueue, handleSelectTrack, repeatMode, isShuffle, pausePlayback]);

  const playPrevTrack = useCallback(() => {
    const list = getActivePlaybackQueue();
    const cur = currentTrackRef.current;
    if (!list.length) {
      if (cur) handleSelectTrack(cur);
      return;
    }
    if (!cur) {
      handleSelectTrack(list[0]);
      return;
    }
    const idx = list.findIndex((t) => t.videoId === cur.videoId);
    const prevIdx = idx > 0 ? idx - 1 : list.length - 1;
    handleSelectTrack(list[prevIdx]);
  }, [getActivePlaybackQueue, handleSelectTrack]);

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

      if (playbackBackendRef.current === 'native') {
        const nativeAudio = getTopLevelNativeAudioElement();
        if (nativeAudio && nativeAudio.paused && !nativeAudio.ended) {
          nativeAudio.play().catch(() => {});
        }
        return;
      }

      const carrier = getTopLevelAudioCarrier();
      if (carrier && carrier.paused) {
        carrier.play().catch(() => {});
      }

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
      resumePlayback();
    }
  }, [activeResultSection, currentTrack, handleSelectTrack, isPlaying, pausePlayback, resumePlayback, tracks, videoTracks]);

  const applyDirectVolume = useCallback((nextVol: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextVol)));
    setVolume(clamped);
    volumeRef.current = clamped;
    setIsMuted(clamped === 0);
    const nativeAudio = getTopLevelNativeAudioElement();
    if (nativeAudio) {
      nativeAudio.volume = clamped / 100;
      if (clamped > 0 && nativeAudio.muted) {
        nativeAudio.muted = false;
      }
    }
    if (playerRef.current && isPlayerReadyRef.current) {
      try {
        playerRef.current.setVolume(clamped);
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

  // 1-second countdown ticker while Sleep Timer is active
  useEffect(() => {
    if (sleepRemainingSec === null || sleepRemainingSec <= 0) return;
    const timer = window.setInterval(() => {
      setSleepRemainingSec((prev) => (prev !== null && prev > 0 ? prev - 1 : null));
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

  // Toggle video viewport seamlessly without interrupting the active YouTube IFrame Player
  const handleToggleVideoViewport = () => {
    triggerHaptic(15);
    const nextShow = !showVideoViewport;
    setShowVideoViewport(nextShow);
    showVideoViewportRef.current = nextShow;

    if (playerRef.current && isPlayerReadyRef.current) {
      try {
        playerRef.current.setPlaybackQuality?.(nextShow ? 'default' : 'small');
      } catch {}
    }
  };

  // Keyboard Shortcuts (Space, Arrow keys, N, P, M) with input protection
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
      } else if (key === 'arrowright') {
        e.preventDefault();
        const { currentTime, duration } = getPlaybackMetrics();
        handleSeekTo(duration > 0 ? Math.min(duration, currentTime + 5) : currentTime + 5);
      } else if (key === 'arrowleft') {
        e.preventDefault();
        const { currentTime } = getPlaybackMetrics();
        handleSeekTo(Math.max(0, currentTime - 5));
      } else if (key === 'arrowup') {
        e.preventDefault();
        setVolume((v) => {
          const next = Math.min(100, v + 10);
          volumeRef.current = next;
          if (playerRef.current && isPlayerReadyRef.current) {
            try {
              playerRef.current.setVolume(next);
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
              playerRef.current.setVolume(next);
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
    pausePlayback,
    playNextTrack,
    playPrevTrack,
    resumePlayback,
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

    // Always open Songs section by default whenever a search is performed
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

    // Always open Songs section by default whenever the user searches
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
      void runSearch(val, true);
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

  const totalResultsCount = tracks.length + videoTracks.length;

  // Synced with standard application theme CSS variables from index.css
  const activePalette = {
    shellBg: 'var(--bg)',
    shellBgImage: 'var(--bg-gradient)',
    shellBorder: 'var(--card-border)',
    shellShadow: 'var(--glass-shadow, 0 14px 38px var(--shadow-color))',
    deckBg: 'var(--card)',
    deckBorder: 'var(--card-border)',
    subBg: 'var(--card-subtle)',
    inputBg: 'var(--input-bg)',
    accent: 'var(--accent)',
    accentHover: 'var(--accent-hover)',
    accentText: 'var(--accent-text)',
    accentGradient: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
    accentGlow: 'var(--shadow-color)',
    textPrimary: 'var(--text)',
    textSecondary: 'var(--text-soft)',
  };

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

  // ==================== DYNAMIC "MORE LIKE THIS" RELATED SONGS STATE ====================
  const [relatedTracks, setRelatedTracks] = useState<YouTubeTrack[]>(() =>
    getCachedRelatedTracks(displayTrack).tracks
  );
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

  // Automatically update "MORE LIKE THIS" recommendations whenever the current/display song changes
  useEffect(() => {
    const contextTrack = displayTrack;
    if (!contextTrack?.videoId) return;

    if (relatedAbortRef.current) {
      relatedAbortRef.current.abort();
    }
    isLoadingMoreRelatedRef.current = false;

    const cached = getCachedRelatedTracks(contextTrack);
    setRelatedTracks(cached.tracks);
    setHasMoreRelated(cached.hasMore);
    hasMoreRelatedRef.current = cached.hasMore;

    // If we already fetched at least one network batch for this track, no need to re-fetch until user scrolls
    if (cached.cursorIndex > 0 && cached.tracks.length >= 12) {
      setIsLoadingRelated(false);
      return;
    }

    const controller = new AbortController();
    relatedAbortRef.current = controller;
    isLoadingMoreRelatedRef.current = true;
    setIsLoadingRelated(true);

    void fetchNextRelatedTracksBatch(contextTrack, controller.signal)
      .then((res) => {
        if (controller.signal.aborted || displayTrackRef.current.videoId !== contextTrack.videoId) {
          return;
        }
        setRelatedTracks(res.tracks);
        setHasMoreRelated(res.hasMore);
        hasMoreRelatedRef.current = res.hasMore;
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted && displayTrackRef.current.videoId === contextTrack.videoId) {
          isLoadingMoreRelatedRef.current = false;
          setIsLoadingRelated(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [displayTrack.videoId]);

  const loadMoreRelatedTracks = useCallback(async () => {
    if (isLoadingMoreRelatedRef.current || !hasMoreRelatedRef.current) return;
    const contextTrack = displayTrackRef.current;
    if (!contextTrack?.videoId) return;

    const controller = new AbortController();
    relatedAbortRef.current = controller;
    isLoadingMoreRelatedRef.current = true;
    setIsLoadingRelated(true);

    try {
      const res = await fetchNextRelatedTracksBatch(contextTrack, controller.signal);
      if (!controller.signal.aborted && displayTrackRef.current.videoId === contextTrack.videoId) {
        setRelatedTracks(res.tracks);
        setHasMoreRelated(res.hasMore);
        hasMoreRelatedRef.current = res.hasMore;
      }
    } catch {
      // Ignore abort or transient network errors
    } finally {
      if (!controller.signal.aborted && displayTrackRef.current.videoId === contextTrack.videoId) {
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

  // Continuous loading IntersectionObserver when the expanded "More Like This" view is open
  useEffect(() => {
    if (!isMoreLikeThisOpen) return;
    const sentinel = relatedSentinelRef.current;
    const root = relatedScrollContainerRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMoreRelatedTracks();
        }
      },
      {
        root,
        rootMargin: '280px',
        threshold: 0.01,
      }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isMoreLikeThisOpen, relatedTracks.length, loadMoreRelatedTracks]);

  return (
    <div
      style={
        isMelodiesPage
          ? {
              backgroundColor: activePalette.shellBg,
              backgroundImage: activePalette.shellBgImage,
              color: activePalette.textPrimary,
            }
          : undefined
      }
      className={
        isMelodiesPage
          ? `fixed inset-0 top-14 z-30 w-full h-[calc(100dvh-3.5rem)] overflow-hidden px-3 sm:px-6 pt-2.5 ${
              isSearchFocused ? 'pb-2' : 'pb-[82px]'
            } flex flex-col justify-between transition-colors duration-300 select-none`
          : ''
      }
    >
      {/* Dynamic Album Art Ambient Glow synced with Main App Theme */}
      {isMelodiesPage && displayTrack && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-6 right-1/2 translate-x-1/2 w-72 h-72 rounded-full opacity-20 blur-3xl transition-all duration-700"
          style={{
            backgroundImage: `url(${normalizeSquareThumbnail(
              displayTrack.thumbnail,
              displayTrack.videoId
            )})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}

      <div
        className={
          isMelodiesPage
            ? 'relative z-10 max-w-xl lg:max-w-6xl xl:max-w-7xl w-full mx-auto h-full flex flex-col justify-between gap-2 lg:gap-3.5 overflow-hidden'
            : ''
        }
      >
        {/* ==================== 1. TOP SECTION: PERSISTENT SEARCH BAR & SONGS / VIDEOS FILTER TOGGLE ==================== */}
        {isMelodiesPage && (
          <div ref={searchContainerRef} className="relative z-40 shrink-0 space-y-2">
            {/* Persistent Search Bar at the Very Top */}
            <form onSubmit={handleSearchSubmit} className="relative flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  style={{ color: activePalette.textSecondary }}
                  className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setIsSearchFocused(false);
                    }, 140);
                  }}
                  onChange={(e) => {
                    setIsSearchFocused(true);
                    handleSearchInputChange(e);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsSearchFocused(false);
                      searchInputRef.current?.blur();
                    }
                  }}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  placeholder="Search songs, singers, or videos..."
                  style={{
                    backgroundColor: activePalette.inputBg,
                    borderColor: isSearchFocused ? activePalette.accent : activePalette.deckBorder,
                    color: activePalette.textPrimary,
                  }}
                  className="w-full pl-9 pr-8 py-2.5 rounded-2xl border text-xs sm:text-sm outline-none transition-colors shadow-xs touch-manipulation"
                />
                {searchQuery && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
                      if (searchAbortRef.current) searchAbortRef.current.abort();
                      activeSearchQueryRef.current = '';
                      setSearchQuery('');
                      setIsSearching(false);
                      setIsSearchingVideos(false);
                      setSearchError(null);
                    }}
                    style={{ color: activePalette.textSecondary }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 cursor-pointer touch-manipulation"
                    aria-label="Clear search input"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={(isSearching && isSearchingVideos) || !searchQuery.trim()}
                style={{
                  background: activePalette.accentGradient,
                  color: activePalette.accentText,
                  boxShadow: `0 4px 12px ${activePalette.accentGlow}`,
                }}
                className="px-3.5 lg:px-5 py-2.5 rounded-2xl text-xs font-bold shrink-0 flex items-center gap-1.5 cursor-pointer active:scale-95 transition-transform disabled:opacity-60 touch-manipulation"
              >
                {isSearching || isSearchingVideos ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                <span>Search</span>
              </button>

              {/* Non-Hover, Non-Focus-Trapping Search Suggestions Dropdown */}
              {isSearchFocused && searchSuggestions.length > 0 && (
                <div
                  aria-label="Search suggestions"
                  style={{
                    backgroundColor: 'var(--card-solid, var(--card))',
                    borderColor: activePalette.deckBorder,
                    boxShadow: activePalette.shellShadow,
                  }}
                  className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-2xl border p-1.5 space-y-0.5 overflow-hidden backdrop-blur-xl touch-manipulation"
                >
                  <div className="flex items-center justify-between px-2.5 py-1">
                    <span
                      style={{ color: activePalette.textSecondary }}
                      className="text-[10px] font-bold uppercase tracking-wider"
                    >
                      {searchQuery.trim() ? 'Search Suggestions' : 'Suggested & Recent'}
                    </span>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        setIsSearchFocused(false);
                        searchInputRef.current?.blur();
                      }}
                      style={{ color: activePalette.textSecondary }}
                      className="text-[10px] font-semibold cursor-pointer touch-manipulation"
                    >
                      Close
                    </button>
                  </div>
                  {searchSuggestions.slice(0, 6).map((suggestion) => {
                    const isRecentItem = recentSearches.some(
                      (r) => r.toLowerCase() === suggestion.toLowerCase()
                    );
                    return (
                      <div
                        key={suggestion}
                        tabIndex={-1}
                        onClick={() => handleSelectSuggestion(suggestion)}
                        style={{
                          color: activePalette.textPrimary,
                          backgroundColor:
                            searchQuery.trim().toLowerCase() === suggestion.toLowerCase()
                              ? activePalette.subBg
                              : 'transparent',
                        }}
                        className="w-full px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 text-xs font-semibold active:opacity-80 cursor-pointer touch-manipulation"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {isRecentItem ? (
                            <Clock
                              className="w-3.5 h-3.5 shrink-0"
                              style={{ color: activePalette.accent }}
                            />
                          ) : (
                            <Search
                              className="w-3.5 h-3.5 shrink-0"
                              style={{ color: activePalette.textSecondary }}
                            />
                          )}
                          <span className="truncate">{suggestion}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isRecentItem && (
                            <button
                              type="button"
                              tabIndex={-1}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => handleRemoveRecentQuery(e, suggestion)}
                              style={{ color: activePalette.textSecondary }}
                              className="p-1 rounded-lg opacity-75 cursor-pointer touch-manipulation"
                              aria-label={`Remove ${suggestion}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerHaptic(10);
                              setSearchQuery(suggestion);
                            }}
                            style={{ color: activePalette.textSecondary }}
                            className="p-1 rounded-lg opacity-75 cursor-pointer touch-manipulation"
                            title="Fill search bar"
                            aria-label={`Fill search bar with ${suggestion}`}
                          >
                            <ArrowUpLeft className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </form>

            {/* Segmented Toggle Switch / Button Group for 'Songs', 'Videos', and 'Discover' Immediately Below Search Bar */}
            <div
              role="tablist"
              aria-label="Filter between Songs, Videos, and Discover"
              style={{
                backgroundColor: activePalette.deckBg,
                borderColor: activePalette.deckBorder,
              }}
              className="grid grid-cols-3 gap-1.5 sm:gap-2 p-1.5 rounded-2xl border shadow-xs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeResultSection === 'songs'}
                onClick={() => {
                  triggerHaptic(15);
                  if (activeResultSection === 'songs' && isListExpanded) {
                    setIsListExpanded(false);
                  } else {
                    setActiveResultSection('songs');
                    setShowVideoViewport(false);
                    showVideoViewportRef.current = false;
                    setIsListExpanded(true);
                  }
                }}
                style={{
                  background:
                    activeResultSection === 'songs'
                      ? activePalette.accentGradient
                      : activePalette.subBg,
                  color:
                    activeResultSection === 'songs'
                      ? activePalette.accentText
                      : activePalette.textPrimary,
                  borderColor:
                    activeResultSection === 'songs'
                      ? activePalette.accent
                      : activePalette.deckBorder,
                  boxShadow:
                    activeResultSection === 'songs'
                      ? `0 4px 14px ${activePalette.accentGlow}`
                      : 'none',
                }}
                className="py-2 px-2 sm:px-3 rounded-xl border text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
              >
                <Music className="w-3.5 h-3.5" />
                <span>Songs ({isSearching && tracks.length === 0 ? '...' : tracks.length})</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeResultSection === 'videos'}
                onClick={() => {
                  triggerHaptic(15);
                  if (activeResultSection === 'videos' && isListExpanded) {
                    setIsListExpanded(false);
                  } else {
                    setActiveResultSection('videos');
                    setIsListExpanded(true);
                  }
                }}
                style={{
                  background:
                    activeResultSection === 'videos'
                      ? activePalette.accentGradient
                      : activePalette.subBg,
                  color:
                    activeResultSection === 'videos'
                      ? activePalette.accentText
                      : activePalette.textPrimary,
                  borderColor:
                    activeResultSection === 'videos'
                      ? activePalette.accent
                      : activePalette.deckBorder,
                  boxShadow:
                    activeResultSection === 'videos'
                      ? `0 4px 14px ${activePalette.accentGlow}`
                      : 'none',
                }}
                className="py-2 px-2 sm:px-3 rounded-xl border text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
              >
                <Film className="w-3.5 h-3.5" />
                <span>
                  Videos ({isSearchingVideos && videoTracks.length === 0 ? '...' : videoTracks.length})
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeResultSection === 'discover'}
                onClick={() => {
                  triggerHaptic(15);
                  if (activeResultSection === 'discover' && isListExpanded) {
                    setIsListExpanded(false);
                  } else {
                    setActiveResultSection('discover');
                    setShowVideoViewport(false);
                    showVideoViewportRef.current = false;
                    setIsListExpanded(true);
                  }
                }}
                style={{
                  background:
                    activeResultSection === 'discover'
                      ? activePalette.accentGradient
                      : activePalette.subBg,
                  color:
                    activeResultSection === 'discover'
                      ? activePalette.accentText
                      : activePalette.textPrimary,
                  borderColor:
                    activeResultSection === 'discover'
                      ? activePalette.accent
                      : activePalette.deckBorder,
                  boxShadow:
                    activeResultSection === 'discover'
                      ? `0 4px 14px ${activePalette.accentGlow}`
                      : 'none',
                }}
                className="py-2 px-2 sm:px-3 rounded-xl border text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Discover</span>
              </button>
            </div>
          </div>
        )}

        {/* ==================== 2. MAIN STAGE: RESPONSIVE MOBILE SINGLE-DECK / DESKTOP 2-COLUMN STUDIO SPLIT ==================== */}
        <div
          className={
            isMelodiesPage
              ? 'relative z-10 flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-12 lg:gap-6 overflow-hidden'
              : ''
          }
        >
          {/* LEFT PANEL (Desktop Studio Deck + Singleton YouTube IFrame Host) */}
          <div
            style={
              isMelodiesPage
                ? {
                    backgroundColor: activePalette.deckBg,
                    borderColor: activePalette.deckBorder,
                    boxShadow: activePalette.shellShadow,
                  }
                : undefined
            }
            className={
              isMelodiesPage
                ? `${
                    isListExpanded
                      ? 'contents lg:relative lg:z-10 lg:flex'
                      : 'relative z-10 flex-1 min-h-0 flex'
                  } rounded-3xl border px-4 py-3 lg:p-5 flex-col justify-between overflow-hidden backdrop-blur-md lg:col-span-5 lg:h-full lg:min-h-0`
                : ''
            }
          >
            {/* Desktop Studio Header with Interactive Volume Control */}
            {isMelodiesPage && (
              <div
                style={{ borderColor: activePalette.deckBorder }}
                className="hidden lg:flex items-center justify-between gap-3 pb-2.5 mb-1 border-b shrink-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Disc3
                    className={`w-4 h-4 shrink-0 ${isPlaying ? 'animate-spin' : ''}`}
                    style={{ color: activePalette.accent }}
                  />
                  <span
                    style={{ color: activePalette.textPrimary }}
                    className="text-xs font-bold tracking-tight truncate"
                  >
                    Cantus Studio Deck
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleToggleMute}
                    style={{ color: activePalette.textSecondary }}
                    className="p-1 rounded-lg hover:opacity-80 cursor-pointer"
                    title={isMuted ? 'Unmute' : 'Mute'}
                    aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="w-3.5 h-3.5" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    aria-label="Master volume"
                    style={{ accentColor: activePalette.accent }}
                    className="w-20 h-1 rounded-lg cursor-pointer"
                  />
                  <span
                    style={{ color: activePalette.textSecondary }}
                    className="text-[10px] font-mono tabular-nums w-7 text-right"
                  >
                    {isMuted ? 0 : volume}%
                  </span>
                </div>
              </div>
            )}

            {/* Persistent Singleton YouTube IFrame Host Container — never moves in DOM */}
            <div
              ref={videoContainerRef}
              onMouseMove={resetVideoControlsTimer}
              onTouchStart={resetVideoControlsTimer}
              onClick={resetVideoControlsTimer}
              style={
                isMelodiesPage && showVideoViewport && displayTrack
                  ? { borderColor: activePalette.deckBorder }
                  : {
                      position: 'fixed',
                      top: '-9999px',
                      left: '-9999px',
                      width: '1px',
                      height: '1px',
                      opacity: 0,
                      pointerEvents: 'none',
                      zIndex: -1,
                    }
              }
              className={
                isMelodiesPage && showVideoViewport && displayTrack
                  ? !isListExpanded
                    ? `relative w-full aspect-video ${
                        isVideoFullscreen
                          ? 'fixed inset-0 z-50 w-screen h-screen max-h-none rounded-none border-0'
                          : 'max-h-[26dvh] lg:max-h-[25dvh] rounded-2xl border'
                      } overflow-hidden bg-black shadow-lg shrink-0 mx-auto group select-none`
                    : 'fixed -top-[9999px] -left-[9999px] w-[1px] h-[1px] opacity-0 pointer-events-none overflow-hidden z-[-1] lg:relative lg:top-auto lg:left-auto lg:w-full lg:h-auto lg:aspect-video lg:max-h-[25dvh] lg:opacity-100 lg:pointer-events-auto lg:rounded-2xl lg:border lg:bg-black lg:shadow-lg lg:shrink-0 lg:mx-auto lg:z-10 group select-none'
                  : 'fixed -top-[9999px] -left-[9999px] w-[1px] h-[1px] opacity-0 pointer-events-none overflow-hidden z-[-1]'
              }
            >
              <div
                id="kashish-yt-iframe-wrapper"
                style={
                  isMelodiesPage && showVideoViewport && displayTrack
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

              {/* Transparent Click Interceptor: Taps on video toggle playback and reset control visibility, while blocking native YouTube title/share/watch later/more videos popups */}
              {isMelodiesPage && showVideoViewport && displayTrack && (
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
              )}

              {/* Minimal Custom Kashish Video Player Interface */}
              {isMelodiesPage && showVideoViewport && displayTrack && (
                <>
                  {/* Top-Right Audio Switcher Badge */}
                  <div
                    className={`absolute top-2 right-2 z-20 transition-opacity duration-300 ${
                      showVideoControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleVideoViewport()}
                      className="px-2.5 py-1 rounded-full bg-black/75 hover:bg-black/90 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer backdrop-blur-xs border border-white/10 active:scale-95 transition-transform"
                      aria-label="Switch to audio artwork"
                      title="Switch to Audio Artwork"
                    >
                      <X className="w-3 h-3" />
                      <span>Audio View</span>
                    </button>
                  </div>

                  {/* Buffering Indicator Overlay */}
                  {isBuffering && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 pointer-events-none">
                      <Loader2 className="w-7 h-7 text-white animate-spin" />
                    </div>
                  )}

                  {/* Minimal Kashish Control Bar: ONLY Previous, Play/Pause, Next, Quality Selector Menu, Fullscreen */}
                  <div
                    className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center gap-2 sm:gap-3 px-3 py-1.5 rounded-full border backdrop-blur-md transition-all duration-300 pointer-events-auto ${
                      showVideoControls
                        ? 'opacity-100 translate-y-0'
                        : 'opacity-0 translate-y-2 pointer-events-none'
                    }`}
                    style={{
                      backgroundColor: 'rgba(10, 4, 18, 0.88)',
                      borderColor: 'rgba(255, 255, 255, 0.16)',
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65)',
                    }}
                  >
                    {/* 1. Previous Video */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerHaptic(15);
                        resetVideoControlsTimer();
                        setIsVideoQualityOpen(false);
                        playPrevTrack();
                      }}
                      className="p-1.5 rounded-full text-white/90 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
                      title="Previous Video"
                      aria-label="Previous Video"
                    >
                      <SkipBack className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>

                    {/* 2. Play / Pause (Kashish Custom - located cleanly in control bar, never in middle) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerHaptic(20);
                        resetVideoControlsTimer();
                        setIsVideoQualityOpen(false);
                        handleTogglePlayPause();
                      }}
                      style={{
                        background: activePalette.accentGradient,
                        color: '#ffffff',
                        boxShadow: `0 4px 14px ${activePalette.accentGlow}`,
                      }}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                      title={isPlaying ? 'Pause Video' : 'Play Video'}
                      aria-label={isPlaying ? 'Pause Video' : 'Play Video'}
                    >
                      {isBuffering ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isPlaying ? (
                        <Pause className="w-4 h-4 fill-current" />
                      ) : (
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      )}
                    </button>

                    {/* 3. Next Video */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerHaptic(15);
                        resetVideoControlsTimer();
                        setIsVideoQualityOpen(false);
                        playNextTrack();
                      }}
                      className="p-1.5 rounded-full text-white/90 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
                      title="Next Video"
                      aria-label="Next Video"
                    >
                      <SkipForward className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>

                    {/* Subtle Divider */}
                    <div className="w-px h-3.5 bg-white/20 my-auto" />

                    {/* 4. Quality Selector with Interactive Popover Menu */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          resetVideoControlsTimer();
                          setIsVideoQualityOpen((prev) => !prev);
                        }}
                        className={`px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold font-mono tracking-wide flex items-center gap-1 transition-all cursor-pointer ${
                          isVideoQualityOpen
                            ? 'bg-white text-black shadow-md'
                            : 'text-white/90 bg-white/10 hover:bg-white/20 hover:text-white border border-white/15'
                        }`}
                        title="Video Quality Menu"
                        aria-label="Video Quality Menu"
                        aria-expanded={isVideoQualityOpen}
                      >
                        <Settings2 className="w-3 h-3" />
                        <span>{selectedQuality.replace(' (HD)', '').replace(' FHD', '').replace(' HD', '').replace(' SD', '').replace(' Med', '')}</span>
                      </button>

                      {/* Quality Dropdown Popover */}
                      {isVideoQualityOpen && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-36 rounded-xl border border-white/20 bg-neutral-950/95 backdrop-blur-xl shadow-2xl p-1.5 flex flex-col gap-1 z-30 animate-in fade-in zoom-in-95 duration-150"
                        >
                          <div className="px-2 py-0.5 text-[9px] uppercase tracking-wider font-semibold text-white/50 border-b border-white/10">
                            Playback Quality
                          </div>
                          {[
                            { label: 'Auto (HD)', value: 'auto' },
                            { label: '1080p FHD', value: 'hd1080' },
                            { label: '720p HD', value: 'hd720' },
                            { label: '480p SD', value: 'large' },
                            { label: '360p Med', value: 'medium' },
                          ].map((opt) => {
                            const isSelected = selectedQuality === opt.label;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => {
                                  triggerHaptic(15);
                                  setSelectedQuality(opt.label);
                                  setIsVideoQualityOpen(false);
                                  resetVideoControlsTimer();
                                  try {
                                    if (playerRef.current && isPlayerReadyRef.current) {
                                      if (typeof playerRef.current.setPlaybackQuality === 'function') {
                                        playerRef.current.setPlaybackQuality(opt.value);
                                      }
                                      if (typeof playerRef.current.setPlaybackQualityRange === 'function') {
                                        playerRef.current.setPlaybackQualityRange(opt.value, opt.value);
                                      }
                                    }
                                  } catch {}
                                  setStatusNotice(`Video Quality: ${opt.label}`);
                                }}
                                className={`w-full flex items-center justify-between px-2 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'bg-white/20 text-white font-semibold'
                                    : 'text-white/70 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                <span>{opt.label}</span>
                                {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 5. Fullscreen Toggle Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        resetVideoControlsTimer();
                        setIsVideoQualityOpen(false);
                        handleToggleFullscreen();
                      }}
                      className="p-1.5 rounded-full text-white/90 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
                      title={isVideoFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                      aria-label={isVideoFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                    >
                      {isVideoFullscreen ? (
                        <Minimize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      ) : (
                        <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>

            {isMelodiesPage && (
              <div
                className={`${
                  isListExpanded ? 'hidden lg:flex' : 'flex'
                } flex-1 min-h-0 flex-col items-center justify-evenly text-center w-full max-w-md lg:max-w-none mx-auto overflow-hidden`}
              >
                {/* A. Square Album Artwork */}
                {!showVideoViewport && (
                  <div className="relative w-32 h-32 sm:w-44 sm:h-44 lg:w-44 lg:h-44 xl:w-48 xl:h-48 aspect-square rounded-3xl overflow-hidden shadow-xl border border-white/10 bg-black/40 shrink-0 group">
                    <HighResThumbnail
                      videoId={displayTrack.videoId}
                      rawThumbnail={displayTrack.thumbnail}
                      alt={displayTrack.title}
                      aspect="square"
                      className="transition-transform duration-700 group-hover:scale-105"
                    />
                    {isPlaying && (
                      <div className="absolute bottom-2 right-2 px-2 py-1 rounded-full bg-black/65 backdrop-blur-xs flex items-end gap-1 h-5 z-10">
                        <span className="w-1 h-2 bg-white rounded-full animate-pulse" />
                        <span
                          style={{ backgroundColor: activePalette.accent }}
                          className="w-1 h-3.5 rounded-full animate-bounce"
                        />
                        <span className="w-1 h-2.5 bg-white rounded-full animate-pulse" />
                      </div>
                    )}
                  </div>
                )}

                {/* B. Song Information & Favorite */}
                <div className="w-full px-4 py-1 shrink-0 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 text-left">
                    <h3
                      style={{ color: activePalette.textPrimary }}
                      className="text-sm sm:text-base font-bold tracking-tight truncate"
                      title={displayTrack.title}
                    >
                      {displayTrack.title}
                    </h3>
                    <p
                      style={{ color: activePalette.textSecondary }}
                      className="text-[11px] sm:text-xs font-medium truncate"
                    >
                      {displayTrack.artist}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleFavorite(displayTrack)}
                    className="p-2 rounded-full text-white/80 hover:text-white shrink-0 active:scale-90 transition-transform cursor-pointer"
                    title={favoriteIds.has(displayTrack.videoId) ? 'Favorited' : 'Add to Favorites'}
                    aria-label="Toggle favorite"
                  >
                    <Heart
                      className={`w-5 h-5 transition-colors ${
                        favoriteIds.has(displayTrack.videoId) ? 'fill-red-500 text-red-500' : 'text-white/70'
                      }`}
                    />
                  </button>
                </div>

                {/* C. Secondary Controls (Equalizer, Sleep Timer, Shuffle, Repeat, Video Toggle) */}
                <div className="flex items-center justify-center gap-2.5 w-full shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(15);
                      setIsEqMenuOpen((prev) => !prev);
                      setIsSleepMenuOpen(false);
                    }}
                    style={{
                      background: isEqMenuOpen ? activePalette.accentGradient : activePalette.subBg,
                      color: isEqMenuOpen ? '#ffffff' : activePalette.textSecondary,
                      borderColor: isEqMenuOpen ? activePalette.accent : activePalette.deckBorder,
                    }}
                    className="p-2.5 rounded-full border hover:opacity-90 active:scale-90 transition-all cursor-pointer relative"
                    title={`Equalizer: ${activeEqPreset}`}
                    aria-label="Equalizer"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    {activeEqPreset !== 'Flat' && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{ backgroundColor: activePalette.accent }} />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(15);
                      setIsSleepMenuOpen((prev) => !prev);
                      setIsEqMenuOpen(false);
                    }}
                    style={{
                      background:
                        sleepRemainingSec !== null
                          ? activePalette.accentGradient
                          : activePalette.subBg,
                      color:
                        sleepRemainingSec !== null ? '#ffffff' : activePalette.textSecondary,
                      borderColor:
                        isSleepMenuOpen || sleepRemainingSec !== null
                          ? activePalette.accent
                          : activePalette.deckBorder,
                    }}
                    className="p-2.5 rounded-full border hover:opacity-90 active:scale-90 transition-all cursor-pointer relative"
                    title={
                      sleepRemainingSec !== null
                        ? `Sleep Timer: ${formatDuration(sleepRemainingSec)} remaining`
                        : 'Set Sleep Timer'
                    }
                    aria-label="Sleep Timer"
                  >
                    <Timer className="w-3.5 h-3.5" />
                    {sleepRemainingSec !== null && (
                      <span className="absolute -bottom-1.5 -right-2 px-1 rounded bg-black/85 text-[8px] font-mono tabular-nums font-bold text-white">
                        {formatDuration(sleepRemainingSec)}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleShuffle}
                    style={{
                      background: isShuffle ? activePalette.accentGradient : activePalette.subBg,
                      color: isShuffle ? '#ffffff' : activePalette.textSecondary,
                      borderColor: activePalette.deckBorder,
                    }}
                    className="p-2.5 rounded-full border hover:opacity-90 active:scale-90 transition-all cursor-pointer relative"
                    title={`Shuffle: ${isShuffle ? 'ON' : 'OFF'}`}
                    aria-label="Toggle shuffle"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleRepeat}
                    style={{
                      background: repeatMode !== 'off' ? activePalette.accentGradient : activePalette.subBg,
                      color: repeatMode !== 'off' ? '#ffffff' : activePalette.textSecondary,
                      borderColor: activePalette.deckBorder,
                    }}
                    className="p-2.5 rounded-full border hover:opacity-90 active:scale-90 transition-all cursor-pointer relative"
                    title={`Repeat: ${repeatMode.toUpperCase()}`}
                    aria-label="Toggle repeat mode"
                  >
                    <Repeat className="w-3.5 h-3.5" />
                    <span className="absolute -bottom-1 -right-1 px-1 rounded bg-black/85 text-[8px] font-bold text-white uppercase">
                      {repeatMode === 'one' ? '1' : repeatMode === 'all' ? 'All' : 'Off'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleVideoViewport}
                    style={{
                      background: showVideoViewport ? activePalette.accentGradient : activePalette.subBg,
                      color: showVideoViewport ? '#ffffff' : activePalette.textSecondary,
                      borderColor: activePalette.deckBorder,
                    }}
                    className="p-2.5 rounded-full border hover:opacity-90 active:scale-90 transition-all cursor-pointer"
                    title={showVideoViewport ? 'Switch to Audio Artwork' : 'Watch Video'}
                    aria-label="Toggle video view"
                  >
                    <Tv className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Equalizer Preset Picker Strip */}
                {isEqMenuOpen && (
                  <div
                    style={{
                      backgroundColor: activePalette.subBg,
                      borderColor: activePalette.deckBorder,
                    }}
                    className="w-full px-2.5 py-1.5 rounded-2xl border flex items-center justify-between gap-1 shrink-0 animate-in fade-in duration-200"
                  >
                    <span
                      style={{ color: activePalette.textSecondary }}
                      className="text-[10px] font-bold shrink-0 pl-1"
                    >
                      EQ:
                    </span>
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      {(['Bass Boost', 'Vocal', 'Acoustic', 'Club', 'Flat'] as const).map((preset) => {
                        const isSelected = activeEqPreset === preset;
                        return (
                          <button
                            key={`eq-preset-${preset}`}
                            type="button"
                            onClick={() => {
                              triggerHaptic(15);
                              setActiveEqPreset(preset);
                              showNativeToast(`Equalizer: ${preset} profile active 🎚️`);
                            }}
                            style={{
                              background: isSelected ? activePalette.accentGradient : 'transparent',
                              color: isSelected ? '#ffffff' : activePalette.textPrimary,
                              borderColor: isSelected ? activePalette.accent : activePalette.deckBorder,
                            }}
                            className="px-2 py-0.5 rounded-lg border text-[10px] font-bold cursor-pointer active:scale-95 transition-transform"
                          >
                            {preset}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sleep Timer Duration Picker Strip */}
                {isSleepMenuOpen && (
                  <div
                    style={{
                      backgroundColor: activePalette.subBg,
                      borderColor: activePalette.deckBorder,
                    }}
                    className="w-full px-2.5 py-1.5 rounded-2xl border flex items-center justify-between gap-1 shrink-0"
                  >
                    <span
                      style={{ color: activePalette.textSecondary }}
                      className="text-[10px] font-bold shrink-0 pl-1"
                    >
                      Sleep:
                    </span>
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      {[1, 5, 15, 30, 45, 60].map((mins) => {
                        const isSelected = sleepTimerMinutes === mins && sleepRemainingSec !== null;
                        return (
                          <button
                            key={`sleep-${mins}`}
                            type="button"
                            onClick={() => handleSelectSleepTimer(mins)}
                            style={{
                              background: isSelected ? activePalette.accentGradient : 'transparent',
                              color: isSelected ? '#ffffff' : activePalette.textPrimary,
                              borderColor: isSelected ? activePalette.accent : activePalette.deckBorder,
                            }}
                            className="px-2 py-0.5 rounded-lg border text-[10px] font-mono tabular-nums font-bold cursor-pointer active:scale-95 transition-transform"
                          >
                            {mins}m
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => handleSelectSleepTimer(null)}
                        style={{
                          backgroundColor:
                            sleepRemainingSec === null ? activePalette.deckBg : 'transparent',
                          color: activePalette.textSecondary,
                          borderColor: activePalette.deckBorder,
                        }}
                        className="px-2 py-0.5 rounded-lg border text-[10px] font-bold cursor-pointer active:scale-95 transition-transform"
                      >
                        Off
                      </button>
                    </div>
                  </div>
                )}

                {/* D. Main Playback Controls (Previous, Large Play/Pause, Next) */}
                <div className="flex items-center justify-center gap-6 w-full shrink-0">
                  <button
                    type="button"
                    onClick={playPrevTrack}
                    style={{
                      backgroundColor: activePalette.subBg,
                      color: activePalette.textPrimary,
                      borderColor: activePalette.deckBorder,
                    }}
                    className="w-11 h-11 rounded-full border flex items-center justify-center hover:opacity-90 active:scale-90 transition-transform cursor-pointer shadow-xs"
                    aria-label="Previous track"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={handleTogglePlayPause}
                    style={{
                      background: activePalette.accentGradient,
                      color: '#ffffff',
                      boxShadow: `0 8px 24px ${activePalette.accentGlow}`,
                    }}
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center active:scale-95 hover:scale-105 transition-transform cursor-pointer shadow-xl"
                    aria-label={isPlaying ? 'Pause song' : 'Play song'}
                  >
                    {isBuffering ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : isPlaying ? (
                      <Pause className="w-6 h-6 fill-current" />
                    ) : (
                      <Play className="w-6 h-6 fill-current ml-0.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={playNextTrack}
                    style={{
                      backgroundColor: activePalette.subBg,
                      color: activePalette.textPrimary,
                      borderColor: activePalette.deckBorder,
                    }}
                    className="w-11 h-11 rounded-full border flex items-center justify-center hover:opacity-90 active:scale-90 transition-transform cursor-pointer shadow-xs"
                    aria-label="Next track"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                </div>

                {/* E. Wide Progress Bar & Queue Context */}
                <div className="w-full space-y-1 px-1 shrink-0">
                  <PlayerProgressBar
                    getPlaybackMetrics={getPlaybackMetrics}
                    onSeekTo={handleSeekTo}
                    isPlaying={isPlaying}
                    trackId={displayTrack.videoId}
                    fallbackDurationSec={displayTrack.durationSeconds}
                    accentColor={activePalette.accent}
                    accentGradient={activePalette.accentGradient}
                    trackBg={activePalette.subBg}
                    textColor={activePalette.textSecondary}
                  />
                  {(() => {
                    const activeQueue = getActivePlaybackQueue();
                    const currentIdx = activeQueue.findIndex(
                      (t) => t.videoId === displayTrack.videoId
                    );
                    const queuePos = currentIdx >= 0 ? currentIdx + 1 : 1;
                    const totalQueue = activeQueue.length > 0 ? activeQueue.length : 1;
                    const queueContextLabel =
                      activeResultSection === 'discover'
                        ? 'DISCOVER'
                        : activeResultSection === 'videos'
                        ? 'VIDEOS'
                        : 'SONGS';
                    return (
                      <div
                        style={{ color: activePalette.textSecondary }}
                        className="text-[10px] font-bold tracking-widest uppercase"
                      >
                        {queueContextLabel} – {queuePos} / {totalQueue}
                      </div>
                    );
                  })()}
                </div>

                {/* F. MORE LIKE THIS Section Below Progress Bar */}
                <div className="w-full px-1 shrink-0">
                  <div
                    style={{
                      backgroundColor: activePalette.subBg,
                      borderColor: activePalette.deckBorder,
                    }}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-2xl border"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkles
                        className="w-3.5 h-3.5 shrink-0"
                        style={{ color: activePalette.accent }}
                      />
                      <span
                        style={{ color: activePalette.textPrimary }}
                        className="text-[11px] sm:text-xs font-bold uppercase tracking-wider truncate"
                      >
                        MORE LIKE THIS
                      </span>
                      {isLoadingRelated && (
                        <Loader2
                          className="w-3 h-3 animate-spin shrink-0"
                          style={{ color: activePalette.accent }}
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(15);
                        setIsMoreLikeThisOpen(true);
                        if (
                          relatedTracks.length < 18 &&
                          hasMoreRelatedRef.current &&
                          !isLoadingMoreRelatedRef.current
                        ) {
                          void loadMoreRelatedTracks();
                        }
                      }}
                      style={{
                        background: activePalette.accentGradient,
                        color: activePalette.accentText,
                        boxShadow: `0 4px 12px ${activePalette.accentGlow}`,
                      }}
                      className="px-4 py-1.5 rounded-xl text-xs font-bold hover:opacity-95 active:scale-95 transition-all cursor-pointer shrink-0 flex items-center gap-1.5"
                      aria-label="Open full More Like This related songs list"
                    >
                      <span>More</span>
                    </button>
                  </div>
                </div>

                {statusNotice && (
                  <p className="text-[10px] font-medium text-amber-400 px-1 truncate shrink-0">
                    {statusNotice}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* RIGHT PANEL: Filtered Songs / Videos Library (Expandable on Mobile, Persistent Side-by-Side on Desktop) */}
          {isMelodiesPage && (
            <div
              style={{
                backgroundColor: activePalette.deckBg,
                borderColor: activePalette.deckBorder,
                boxShadow: activePalette.shellShadow,
              }}
              className={`${
                isListExpanded ? 'flex' : 'hidden lg:flex'
              } flex-1 min-h-0 rounded-3xl border px-4 py-3 lg:p-5 flex-col justify-between overflow-hidden backdrop-blur-md lg:col-span-7 lg:h-full`}
            >
              <div
                className="flex items-center justify-between gap-2 pb-2 lg:pb-3 mb-1.5 lg:mb-2 border-b shrink-0"
                style={{ borderColor: activePalette.deckBorder }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {activeResultSection === 'discover' ? (
                    <Compass className="w-4 h-4 shrink-0" style={{ color: activePalette.accent }} />
                  ) : activeResultSection === 'songs' ? (
                    <Music className="w-4 h-4 shrink-0" style={{ color: activePalette.accent }} />
                  ) : (
                    <Film className="w-4 h-4 shrink-0" style={{ color: activePalette.accent }} />
                  )}
                  <span
                    style={{ color: activePalette.textPrimary }}
                    className="text-xs lg:text-sm font-bold truncate"
                  >
                    {activeResultSection === 'discover'
                      ? 'Music Discovery'
                      : activeResultSection === 'songs'
                      ? `Filtered Songs (${tracks.length})`
                      : `Filtered Videos (${videoTracks.length})`}
                  </span>
                  {(isSearching || isSearchingVideos) && (
                    <Loader2
                      className="w-3.5 h-3.5 animate-spin shrink-0"
                      style={{ color: activePalette.accent }}
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(15);
                    setIsListExpanded(false);
                  }}
                  style={{
                    backgroundColor: activePalette.subBg,
                    color: activePalette.textPrimary,
                    borderColor: activePalette.deckBorder,
                  }}
                  className="px-2.5 py-1 rounded-xl border text-[11px] font-bold flex items-center gap-1 cursor-pointer active:scale-95"
                >
                  <Disc3
                    className={`w-3.5 h-3.5 ${isPlaying ? 'animate-spin' : ''}`}
                    style={{ color: activePalette.accent }}
                  />
                  <span>Cantus</span>
                </button>
              </div>

              <div className="flex-1 min-h-0 max-h-full flex flex-col justify-start gap-2 overflow-y-auto pr-1">
                {activeResultSection === 'discover' ? (
                  <MusicDiscoveryView
                    currentTrack={displayTrack}
                    isPlaying={isPlaying}
                    onSelectTrack={(t) => handleSelectTrack({ ...t, mediaType: 'song' })}
                    onPreCueTrack={handlePreCueTrack}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                    activePalette={activePalette}
                    recentPlayedTracks={recentPlayedTracks}
                    HighResThumbnailComponent={HighResThumbnail}
                  />
                ) : searchError && tracks.length === 0 && videoTracks.length === 0 ? (
                  <div
                    style={{
                      backgroundColor: activePalette.subBg,
                      borderColor: activePalette.deckBorder,
                    }}
                    className="p-4 rounded-2xl border text-center space-y-2"
                  >
                    <p style={{ color: activePalette.textSecondary }} className="text-xs">
                      {searchError}
                    </p>
                    <button
                      type="button"
                      onClick={() => void runSearch(searchQuery, false)}
                      style={{
                        background: activePalette.accentGradient,
                        color: '#ffffff',
                      }}
                      className="px-4 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
                    >
                      Retry Search
                    </button>
                  </div>
                ) : activeResultSection === 'songs' ? (
                  tracks.length > 0 ? (
                    tracks.map((track, idx) => {
                      const isSelected = currentTrack?.videoId === track.videoId;
                      return (
                        <button
                          key={`song-${track.videoId}`}
                          type="button"
                          onMouseEnter={() => handlePreCueTrack(track)}
                          onTouchStart={() => handlePreCueTrack(track)}
                          onClick={() => {
                            handleSelectTrack({ ...track, mediaType: 'song' });
                            setIsListExpanded(false);
                          }}
                          style={{
                            backgroundColor: isSelected ? activePalette.subBg : 'transparent',
                            borderColor: isSelected ? activePalette.accent : activePalette.deckBorder,
                          }}
                          className="w-full text-left p-2 lg:px-3 lg:py-2.5 rounded-2xl border flex items-center gap-3 hover:opacity-95 active:scale-[0.99] transition-all cursor-pointer group shrink-0"
                        >
                          <span
                            style={{
                              color: isSelected ? activePalette.accent : activePalette.textSecondary,
                            }}
                            className="hidden lg:inline-block text-[11px] font-mono tabular-nums w-5 text-right shrink-0"
                          >
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <div className="relative w-10 h-10 lg:w-11 lg:h-11 aspect-square rounded-xl overflow-hidden shrink-0 bg-black/30 border border-white/10">
                            <HighResThumbnail
                              videoId={track.videoId}
                              rawThumbnail={track.thumbnail}
                              alt={track.title}
                              aspect="square"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              style={{
                                color: isSelected ? activePalette.accent : activePalette.textPrimary,
                              }}
                              className="text-xs lg:text-sm font-bold truncate"
                            >
                              {track.title}
                            </p>
                            <p
                              style={{ color: activePalette.textSecondary }}
                              className="text-[11px] lg:text-xs truncate"
                            >
                              {track.artist}
                              {track.album ? ` · ${track.album}` : ''}
                            </p>
                          </div>
                          {track.durationText && (
                            <span
                              style={{ color: activePalette.textSecondary }}
                              className="text-[10px] lg:text-xs font-mono tabular-nums shrink-0"
                            >
                              {track.durationText}
                            </span>
                          )}
                        </button>
                      );
                    })
                  ) : !isSearching ? (
                    <div className="p-4 text-center space-y-2">
                      <p style={{ color: activePalette.textSecondary }} className="text-xs">
                        {videoTracks.length > 0
                          ? 'Songs mein nahi mila, Videos tab check karein!'
                          : 'Search any song above to start listening.'}
                      </p>
                    </div>
                  ) : null
                ) : videoTracks.length > 0 ? (
                  videoTracks.map((video, idx) => {
                    const isSelected = currentTrack?.videoId === video.videoId;
                    return (
                      <div
                        key={`video-${video.videoId}`}
                        onMouseEnter={() => handlePreCueTrack(video)}
                        onTouchStart={() => handlePreCueTrack(video)}
                        onClick={() => {
                          showVideoViewportRef.current = true;
                          setShowVideoViewport(true);
                          handleSelectTrack({
                            ...video,
                            mediaType: 'video',
                          });
                          setIsListExpanded(false);
                        }}
                        style={{
                          backgroundColor: isSelected ? activePalette.subBg : 'transparent',
                          borderColor: isSelected ? activePalette.accent : activePalette.deckBorder,
                        }}
                        className="w-full text-left p-2 lg:px-3 lg:py-2.5 rounded-2xl border flex items-center gap-3 hover:opacity-95 active:scale-[0.99] transition-all cursor-pointer group shrink-0"
                      >
                        <span
                          style={{
                            color: isSelected ? activePalette.accent : activePalette.textSecondary,
                          }}
                          className="hidden lg:inline-block text-[11px] font-mono tabular-nums w-5 text-right shrink-0"
                        >
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <div className="relative w-16 h-10 lg:w-20 lg:h-12 aspect-video rounded-xl overflow-hidden shrink-0 bg-black/30 border border-white/10">
                          <HighResThumbnail
                            videoId={video.videoId}
                            rawThumbnail={video.thumbnail}
                            alt={video.title}
                            aspect="video"
                          />
                          {video.durationText && (
                            <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/80 text-white text-[8px] font-mono z-10">
                              {video.durationText}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            style={{
                              color: isSelected ? activePalette.accent : activePalette.textPrimary,
                            }}
                            className="text-xs lg:text-sm font-bold truncate"
                          >
                            {video.title}
                          </p>
                          <p
                            style={{ color: activePalette.textSecondary }}
                            className="text-[11px] lg:text-xs truncate"
                          >
                            {video.artist}
                            {video.viewsText ? ` · ${video.viewsText}` : ''}
                          </p>
                        </div>
                        <span
                          style={{
                            backgroundColor: activePalette.subBg,
                            color: activePalette.accent,
                            borderColor: activePalette.deckBorder,
                          }}
                          className="px-2.5 py-1 rounded-xl border text-[10px] font-bold shrink-0 flex items-center gap-1"
                        >
                          <Tv className="w-3 h-3" />
                          <span>Watch</span>
                        </span>
                      </div>
                    );
                  })
                ) : !isSearchingVideos ? (
                  <p
                    style={{ color: activePalette.textSecondary }}
                    className="text-xs text-center py-4 opacity-80"
                  >
                    No videos found yet. Search any song or video title above.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* EXPANDED "MORE LIKE THIS" CONTINUOUS RELATED SONGS VIEW */}
        {isMelodiesPage && isMoreLikeThisOpen && (
          <div
            onClick={() => setIsMoreLikeThisOpen(false)}
            className="fixed inset-0 top-14 pb-[82px] z-50 flex items-center justify-center px-3 sm:px-6 py-2.5 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                backgroundColor: activePalette.deckBg,
                borderColor: activePalette.deckBorder,
                boxShadow: activePalette.shellShadow,
              }}
              className="w-full max-w-2xl h-full max-h-full rounded-3xl border p-3.5 sm:p-5 flex flex-col justify-between overflow-hidden backdrop-blur-xl"
            >
              {/* Modal Header */}
              <div
                style={{ borderColor: activePalette.deckBorder }}
                className="flex items-center justify-between gap-3 pb-3 mb-2 border-b shrink-0"
              >
                <div className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-1.5">
                    <Sparkles
                      className="w-4 h-4 shrink-0"
                      style={{ color: activePalette.accent }}
                    />
                    <h3
                      style={{ color: activePalette.textPrimary }}
                      className="text-xs sm:text-sm font-extrabold uppercase tracking-wider truncate"
                    >
                      More Like This
                    </h3>
                    <span
                      style={{
                        backgroundColor: activePalette.subBg,
                        color: activePalette.accent,
                        borderColor: activePalette.deckBorder,
                      }}
                      className="px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold shrink-0"
                    >
                      {relatedTracks.length} songs
                    </span>
                  </div>
                  <p
                    style={{ color: activePalette.textSecondary }}
                    className="text-[11px] truncate mt-0.5"
                  >
                    Based on <span className="font-semibold">{displayTrack.title}</span> ·{' '}
                    {displayTrack.artist}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(15);
                    setIsMoreLikeThisOpen(false);
                  }}
                  style={{
                    backgroundColor: activePalette.subBg,
                    color: activePalette.textPrimary,
                    borderColor: activePalette.deckBorder,
                  }}
                  className="p-2 rounded-full border hover:opacity-90 active:scale-90 transition-all cursor-pointer shrink-0"
                  aria-label="Close More Like This panel"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Continuous Infinite-Scroll Related Songs List */}
              <div
                ref={relatedScrollContainerRef}
                onScroll={handleRelatedListScroll}
                className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2"
              >
                {relatedTracks.map((song, idx) => {
                  const isCurrent = currentTrack?.videoId === song.videoId;
                  const isFav = favoriteIds.has(song.videoId);
                  return (
                    <div
                      key={`expanded-related-${song.videoId}`}
                      onClick={() => handleSelectTrack({ ...song, mediaType: 'song' })}
                      onMouseEnter={() => handlePreCueTrack(song)}
                      onTouchStart={() => handlePreCueTrack(song)}
                      style={{
                        backgroundColor: isCurrent ? activePalette.subBg : 'transparent',
                        borderColor: isCurrent ? activePalette.accent : activePalette.deckBorder,
                      }}
                      className="w-full text-left p-2 sm:px-3 sm:py-2.5 rounded-2xl border flex items-center gap-3 hover:bg-white/[0.04] active:scale-[0.99] transition-all cursor-pointer group"
                    >
                      <span
                        style={{
                          color: isCurrent ? activePalette.accent : activePalette.textSecondary,
                        }}
                        className="text-[10px] sm:text-[11px] font-mono tabular-nums w-6 text-right shrink-0"
                      >
                        {String(idx + 1).padStart(2, '0')}
                      </span>

                      <div className="relative w-10 h-10 sm:w-11 sm:h-11 aspect-square rounded-xl overflow-hidden shrink-0 bg-black/40 border border-white/10">
                        <HighResThumbnail
                          videoId={song.videoId}
                          rawThumbnail={song.thumbnail}
                          alt={song.title}
                          aspect="square"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          {isCurrent && isPlaying ? (
                            <Pause className="w-4 h-4 fill-white text-white" />
                          ) : (
                            <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                          )}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p
                          style={{
                            color: isCurrent ? activePalette.accent : activePalette.textPrimary,
                          }}
                          className="text-xs sm:text-sm font-bold truncate"
                        >
                          {song.title}
                        </p>
                        <p
                          style={{ color: activePalette.textSecondary }}
                          className="text-[10px] sm:text-xs truncate"
                        >
                          {song.artist}
                          {song.album ? ` · ${song.album}` : ''}
                        </p>
                      </div>

                      {song.durationText && (
                        <span
                          style={{ color: activePalette.textSecondary }}
                          className="text-[10px] sm:text-xs font-mono tabular-nums shrink-0"
                        >
                          {song.durationText}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite(song);
                        }}
                        className="p-1.5 rounded-full text-white/70 hover:text-white shrink-0 active:scale-90 transition-transform cursor-pointer"
                        aria-label="Favorite song"
                        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <Heart
                          className={`w-4 h-4 ${isFav ? 'fill-red-500 text-red-500' : ''}`}
                        />
                      </button>
                    </div>
                  );
                })}

                {/* Sentinel for Continuous Pagination */}
                <div ref={relatedSentinelRef} className="py-3 flex flex-col items-center justify-center gap-2">
                  {isLoadingRelated ? (
                    <div className="flex items-center gap-2 text-xs" style={{ color: activePalette.textSecondary }}>
                      <Loader2 className="w-4 h-4 animate-spin" style={{ color: activePalette.accent }} />
                      <span>Loading more related songs...</span>
                    </div>
                  ) : hasMoreRelated ? (
                    <button
                      type="button"
                      onClick={() => void loadMoreRelatedTracks()}
                      style={{
                        backgroundColor: activePalette.subBg,
                        color: activePalette.textPrimary,
                        borderColor: activePalette.deckBorder,
                      }}
                      className="px-4 py-1.5 rounded-xl border text-xs font-bold hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                    >
                      Load More Related Songs
                    </button>
                  ) : (
                    <span style={{ color: activePalette.textSecondary }} className="text-[11px] opacity-70">
                      All available related songs loaded
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
