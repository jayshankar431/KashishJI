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
} from 'lucide-react';
import {
  YouTubeTrack,
  searchYouTubeSongs,
  searchYouTubeVideos,
  getCachedSearchEntry,
  getCachedVideoSearchEntry,
  refreshSearchInBackground,
  findEmbeddableAlternative,
  formatDuration,
  loadUserLastPlayedTrack,
  saveUserLastPlayedTrack,
  loadUserLastSearch,
  saveUserLastSearch,
  loadUserRecentSearches,
  saveUserRecentSearch,
  removeUserRecentSearch,
  normalizeSquareThumbnail,
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
          style={{ color: 'var(--text-soft)' }}
          className="text-[10px] font-mono tabular-nums w-8 text-right shrink-0"
        >
          {formatDuration(currentTime) || '0:00'}
        </span>
        <div className="relative flex-1 flex items-center h-4">
          <div
            style={{ backgroundColor: 'var(--card-border)' }}
            className="w-full h-1.5 rounded-full overflow-hidden"
          >
            <div
              style={{
                width: `${progressPercent}%`,
                backgroundColor: 'var(--accent)',
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
          style={{ color: 'var(--text-soft)' }}
          className="text-[10px] font-mono tabular-nums w-8 shrink-0"
        >
          {duration > 0 ? formatDuration(duration) : '--:--'}
        </span>
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
  const [activeResultSection, setActiveResultSection] = useState<'songs' | 'videos'>('songs');
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    loadUserRecentSearches(userId)
  );
  const [currentTrack, setCurrentTrack] = useState<YouTubeTrack | null>(() =>
    loadUserLastPlayedTrack(userId)
  );

  const [isSearching, setIsSearching] = useState(false);
  const [isSearchingVideos, setIsSearchingVideos] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isListExpanded, setIsListExpanded] = useState<boolean>(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [volume, setVolume] = useState<number>(90);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showVideoViewport, setShowVideoViewport] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [isMiniExpanded, setIsMiniExpanded] = useState<boolean>(false);

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
  const activeResultSectionRef = useRef<'songs' | 'videos'>(activeResultSection);
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

    setCurrentTrack(savedPlayed);
    setSearchQuery(savedSearch?.query || '');
    setTracks(savedSearch?.results || []);
    setVideoTracks(savedSearch?.videoResults || []);
    setRecentSearches(savedRecent);
    setSearchError(null);
    setStatusNotice(null);
  }, [userId]);

  // Locate #darling-player-slot whenever HomeSection mounts
  useEffect(() => {
    if (activeTab !== 'home') {
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
        controls: 1,
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        fs: 0,
        iv_load_policy: 3,
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
              if ( loadedVideoIdInPlayerRef.current) {
                triedEmbedIdsRef.current.add(loadedVideoIdInPlayerRef.current);
              }
              triedEmbedIdsRef.current.add(failedTrack.videoId);
              setStatusNotice('Switching to playable version...');
              setIsBuffering(true);

              // 1. Check already-fetched in-memory video results first (0ms instant switch!)
              const inMemoryVideos = videoTracksRef.current.filter(
                (v) => v.videoId && !triedEmbedIdsRef.current.has(v.videoId)
              );
              if (inMemoryVideos.length > 0 && playerRef.current && isPlayerReadyRef.current) {
                const candidate = inMemoryVideos[0];
                triedEmbedIdsRef.current.add(candidate.videoId);
                loadedVideoIdInPlayerRef.current = candidate.videoId;
                lastPlayInitiatedAtRef.current = performance.now();
                try {
                  playerRef.current.loadVideoById({
                    videoId: candidate.videoId,
                    suggestedQuality: showVideoViewportRef.current ? 'default' : 'small',
                  });
                  playerRef.current.playVideo();
                  setStatusNotice(null);
                  return;
                } catch {}
              }

              // 2. Network search for embeddable video/song alternative
              const altTrack = await findEmbeddableAlternative(
                failedTrack,
                triedEmbedIdsRef.current
              );
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
    (track: YouTubeTrack) => {
      const tapStartPerf = performance.now();
      lastPlayInitiatedAtRef.current = tapStartPerf;
      triggerHaptic(25);
      userWantPlayingRef.current = true;

      // Persist as the current user's last actually PLAYED song (never confused with last searched)
      saveUserLastPlayedTrack(userIdRef.current, track);

      // If tapping the exact song that is already loaded in the player, toggle play/pause immediately
      if (
        currentTrackRef.current?.videoId === track.videoId &&
        loadedVideoIdInPlayerRef.current === track.videoId &&
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
          applyMediaMetadata(track, true);
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
        videoId: track.videoId,
        title: track.title,
        artist: track.artist,
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

      setCurrentTrack(track);
      setIsBuffering(true);
      setStatusNotice(null);
      triedEmbedIdsRef.current.clear();
      triedEmbedIdsRef.current.add(track.videoId);

      // Post native notification + immediately abandon competing Java AudioFocus BEFORE starting WebView media
      nativeNotifiedPlayingKeyRef.current = null;
      applyMediaMetadata(track, true);

      // Start playback synchronously inside the user's click/tap gesture so browser autoplay policies
      // immediately allow both the YouTube IFrame audio and the top-level MediaSession carrier audio!
      startYouTubeIframePlayback(track, 0);

      void logNativeActivity(
        `🎵 ${recipientName} played song: <b>${track.title}</b> (${track.artist})`
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
    }

    if (activeResultSectionRef.current === 'videos' && videos.length > 0) {
      return videos;
    }
    return songs.length > 0 ? songs : videos;
  }, []);

  const playNextTrack = useCallback(() => {
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
    const nextIdx = idx >= 0 ? (idx + 1) % list.length : 0;
    handleSelectTrack(list[nextIdx]);
  }, [getActivePlaybackQueue, handleSelectTrack]);

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
      const activeList = activeResultSection === 'videos' && videoTracks.length > 0 ? videoTracks : tracks.length > 0 ? tracks : videoTracks;
      if (activeList.length > 0) {
        handleSelectTrack(activeList[0]);
      }
      return;
    }

    if (isPlaying) {
      pausePlayback();
    } else {
      resumePlayback();
    }
  }, [activeResultSection, currentTrack, handleSelectTrack, isPlaying, pausePlayback, resumePlayback, tracks, videoTracks]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVol = Number(e.target.value);
    setVolume(nextVol);
    setIsMuted(nextVol === 0);
    const nativeAudio = getTopLevelNativeAudioElement();
    if (nativeAudio) {
      nativeAudio.volume = Math.max(0, Math.min(1, nextVol / 100));
      if (nextVol > 0 && nativeAudio.muted) {
        nativeAudio.muted = false;
      }
    }
    if (playerRef.current && isPlayerReadyRef.current) {
      try {
        playerRef.current.setVolume(nextVol);
        if (nextVol > 0 && playerRef.current.isMuted?.()) {
          playerRef.current.unMute();
        }
      } catch {}
    }
  };

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

    // Smart Auto-Switch: If a song is not found in the Songs catalog, automatically switch to Videos!
    if (resolvedSongs.length === 0 && resolvedVideos.length > 0) {
      setActiveResultSection('videos');
      setSearchError(null);
    } else if (resolvedSongs.length === 0 && resolvedVideos.length === 0 && (songsFailed || videosFailed)) {
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

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    void runSearch(searchQuery, true);
  };

  const handleRecentQueryTap = (recentQuery: string) => {
    triggerHaptic(20);
    setSearchQuery(recentQuery);
    setIsListExpanded(true);
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

  // Inline compact player UI rendered at the top of the Room section on Home
  const inlineRoomPlayerCard = (
    <div
      style={{
        backgroundColor: 'var(--card)',
        borderColor: 'var(--card-border)',
        boxShadow: '0 4px 18px var(--shadow-color)',
      }}
      className="rounded-2xl border p-3.5 sm:p-4 space-y-3 transition-all duration-200"
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            style={{
              backgroundColor: 'var(--card-subtle)',
              borderColor: 'var(--card-border)',
              color: 'var(--accent)',
            }}
            className="w-8 h-8 rounded-xl border flex items-center justify-center shrink-0"
          >
            <Music className={`w-4 h-4 ${isPlaying ? 'animate-bounce' : ''}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3
                style={{
                  color: 'var(--text)',
                  fontFamily: "'Century Gothic', 'Gothic A1', sans-serif",
                }}
                className="font-gothic text-sm sm:text-base font-bold truncate"
              >
                Music Player 4 You Darling
              </h3>
              <Heart className="w-3.5 h-3.5 fill-[var(--accent)] text-[var(--accent)] shrink-0" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {totalResultsCount > 0 && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(15);
                setIsListExpanded((prev) => !prev);
              }}
              style={{
                backgroundColor: 'var(--card-subtle)',
                color: 'var(--accent)',
                borderColor: 'var(--card-border)',
              }}
              className="px-2.5 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span>
                {isListExpanded ? 'Hide Results' : `Results (${totalResultsCount})`}
              </span>
              {isListExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} className="relative flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search
            style={{ color: 'var(--text-soft)' }}
            className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchInputChange}
            onFocus={() => {
              if (totalResultsCount > 0) setIsListExpanded(true);
            }}
            placeholder="Lost in melodies, found in Kashish ♡"
            style={{
              backgroundColor: 'var(--card-subtle)',
              borderColor: 'var(--card-border)',
              color: 'var(--text)',
            }}
            className="w-full pl-8 pr-8 py-2 rounded-xl border text-xs sm:text-sm outline-none focus:border-[var(--accent)] transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
                if (searchAbortRef.current) searchAbortRef.current.abort();
                activeSearchQueryRef.current = '';
                setSearchQuery('');
                setIsSearching(false);
                setIsSearchingVideos(false);
                setSearchError(null);
              }}
              style={{ color: 'var(--text-soft)' }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 hover:opacity-80 cursor-pointer"
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
            backgroundColor: 'var(--accent)',
            color: '#ffffff',
          }}
          className="px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 cursor-pointer active:scale-95 transition-transform disabled:opacity-60"
        >
          {isSearching || isSearchingVideos ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Search className="w-3.5 h-3.5" />
          )}
          <span>Search</span>
        </button>
      </form>

      {/* User's Recent Search Queries (replaces fixed singer suggestions) */}
      {recentSearches.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <span
            style={{ color: 'var(--text-soft)' }}
            className="text-[10px] font-semibold shrink-0 flex items-center gap-1 mr-0.5"
          >
            <Clock className="w-2.5 h-2.5 text-[var(--accent)]" />
            <span>Recent:</span>
          </span>
          {recentSearches.map((recentQuery) => {
            const isSelected = searchQuery.trim().toLowerCase() === recentQuery.toLowerCase();
            return (
              <div
                key={recentQuery}
                onClick={() => handleRecentQueryTap(recentQuery)}
                style={{
                  backgroundColor: isSelected ? 'var(--accent)' : 'var(--card-subtle)',
                  color: isSelected ? '#ffffff' : 'var(--text-soft)',
                  borderColor: 'var(--card-border)',
                }}
                className="px-2 py-1 rounded-lg border text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer hover:border-[var(--accent)] transition-colors flex items-center gap-1"
              >
                <span>{recentQuery}</span>
                <button
                  type="button"
                  onClick={(e) => handleRemoveRecentQuery(e, recentQuery)}
                  className="opacity-70 hover:opacity-100 p-0.5 cursor-pointer"
                  aria-label={`Remove ${recentQuery} from recent searches`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Compact Now-Playing Control Strip (shows Last-Played Song or Empty State for First-Time Visitors) */}
      <div
        style={{
          backgroundColor: 'var(--card-subtle)',
          borderColor: 'var(--card-border)',
        }}
        className="rounded-xl border p-2.5 sm:p-3 space-y-2"
      >
        {currentTrack ? (
          <>
            <div className="flex items-center justify-between gap-2.5">
              {/* Song Thumbnail & Info */}
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="relative w-11 h-11 aspect-square rounded-lg overflow-hidden shrink-0 border border-white/10 bg-black/20">
                  <img
                    src={normalizeSquareThumbnail(currentTrack.thumbnail, currentTrack.videoId)}
                    alt={currentTrack.title}
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      if (!target.dataset.triedFallback && currentTrack.videoId) {
                        target.dataset.triedFallback = 'true';
                        target.src = `https://i.ytimg.com/vi/${currentTrack.videoId}/mqdefault.jpg`;
                      }
                    }}
                    className="w-full h-full aspect-square object-cover object-center block"
                  />
                  {isPlaying && (
                    <div className="absolute inset-0 bg-black/35 flex items-center justify-center gap-0.5">
                      <span className="w-0.5 h-3 bg-white rounded-full animate-pulse" />
                      <span className="w-0.5 h-4 bg-rose-400 rounded-full animate-bounce" />
                      <span className="w-0.5 h-2.5 bg-white rounded-full animate-pulse" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p
                      style={{ color: 'var(--text)' }}
                      className="text-xs sm:text-sm font-bold truncate"
                      title={currentTrack.title}
                    >
                      {currentTrack.title}
                    </p>
                    {currentTrack.mediaType === 'video' && (
                      <span
                        style={{
                          backgroundColor: 'var(--accent)',
                          color: '#ffffff',
                        }}
                        className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider shrink-0"
                      >
                        Video
                      </span>
                    )}
                  </div>
                  <p
                    style={{ color: 'var(--text-soft)' }}
                    className="text-[11px] truncate font-medium"
                  >
                    {currentTrack.artist}
                  </p>
                </div>
              </div>

              {/* Playback Buttons + Watch Video Toggle */}
              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleToggleVideoViewport}
                  style={{
                    backgroundColor: showVideoViewport ? 'var(--accent)' : 'var(--card)',
                    color: showVideoViewport ? '#ffffff' : 'var(--text-soft)',
                    borderColor: 'var(--card-border)',
                  }}
                  title={showVideoViewport ? 'Hide Video Player' : 'Watch Video'}
                  className="p-2 rounded-lg border hover:opacity-90 active:scale-90 transition-all cursor-pointer"
                  aria-label={showVideoViewport ? 'Hide Video Player' : 'Watch Video'}
                >
                  <Tv className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={playPrevTrack}
                  style={{ color: 'var(--text)' }}
                  className="p-2 rounded-lg hover:bg-black/10 active:scale-90 transition-transform cursor-pointer"
                  aria-label="Previous song"
                >
                  <SkipBack className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleTogglePlayPause}
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: '#ffffff',
                  }}
                  className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm active:scale-95 transition-transform cursor-pointer"
                  aria-label={isPlaying ? 'Pause song' : 'Play song'}
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
                  style={{ color: 'var(--text)' }}
                  className="p-2 rounded-lg hover:bg-black/10 active:scale-90 transition-transform cursor-pointer"
                  aria-label="Next song"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrubber Row */}
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <PlayerProgressBar
                  getPlaybackMetrics={getPlaybackMetrics}
                  onSeekTo={handleSeekTo}
                  isPlaying={isPlaying}
                  trackId={currentTrack.videoId}
                  fallbackDurationSec={currentTrack.durationSeconds}
                />
              </div>
            </div>
          </>
        ) : (
          /* Clean Empty State for First-Time Visitors with No Saved Song */
          <div className="flex items-center justify-between gap-2.5 py-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                style={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--card-border)',
                  color: 'var(--text-soft)',
                }}
                className="w-10 h-10 rounded-lg border flex items-center justify-center shrink-0"
              >
                <Music className="w-4 h-4 opacity-70" />
              </div>
              <div className="min-w-0">
                <p style={{ color: 'var(--text)' }} className="text-xs font-semibold truncate">
                  No song selected yet
                </p>
                <p style={{ color: 'var(--text-soft)' }} className="text-[11px] truncate">
                  Search any song or video above &amp; tap to play
                </p>
              </div>
            </div>
          </div>
        )}

        {statusNotice && (
          <p className="text-[11px] font-medium text-amber-400 px-1">{statusNotice}</p>
        )}
      </div>

      {/* Collapsible Search Results List with Dual Sections: Songs & Videos */}
      {(isListExpanded || isSearching || isSearchingVideos || searchError !== null) && (
        <div
          style={{
            borderColor: 'var(--card-border)',
          }}
          className="border-t pt-2.5 space-y-2"
        >
          {/* Header & Loading Indicator */}
          <div className="flex items-center justify-between px-1">
            <span style={{ color: 'var(--text-soft)' }} className="text-[11px] font-semibold">
              {searchQuery.trim()
                ? `Found in Jay's Heart (${
                    activeResultSection === 'songs' ? tracks.length : videoTracks.length
                  })`
                : `Last Search Results (${
                    activeResultSection === 'songs' ? tracks.length : videoTracks.length
                  })`}
            </span>
            {(isSearching || isSearchingVideos) && (
              <span
                style={{ color: 'var(--accent)' }}
                className="text-[11px] font-semibold flex items-center gap-1"
              >
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>
                  {activeResultSection === 'videos'
                    ? 'Searching Videos...'
                    : 'Searching Songs & Videos...'}
                </span>
              </span>
            )}
          </div>

          {/* Two-Section Switcher: Songs | Videos */}
          <div
            style={{
              backgroundColor: 'var(--card-subtle)',
              borderColor: 'var(--card-border)',
            }}
            className="grid grid-cols-2 gap-1.5 p-1 rounded-xl border"
          >
            <button
              type="button"
              onClick={() => {
                triggerHaptic(15);
                setActiveResultSection('songs');
              }}
              style={{
                backgroundColor:
                  activeResultSection === 'songs' ? 'var(--accent)' : 'transparent',
                color: activeResultSection === 'songs' ? '#ffffff' : 'var(--text-soft)',
              }}
              className="py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Music className="w-3.5 h-3.5" />
              <span>Songs</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeResultSection === 'songs'
                    ? 'bg-white/25 text-white'
                    : 'bg-black/10 opacity-80'
                }`}
              >
                {isSearching && tracks.length === 0 ? '...' : tracks.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHaptic(15);
                setActiveResultSection('videos');
              }}
              style={{
                backgroundColor:
                  activeResultSection === 'videos' ? 'var(--accent)' : 'transparent',
                color: activeResultSection === 'videos' ? '#ffffff' : 'var(--text-soft)',
              }}
              className="py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Film className="w-3.5 h-3.5" />
              <span>Videos</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeResultSection === 'videos'
                    ? 'bg-white/25 text-white'
                    : 'bg-black/10 opacity-80'
                }`}
              >
                {isSearchingVideos && videoTracks.length === 0 ? '...' : videoTracks.length}
              </span>
            </button>
          </div>

          {searchError && tracks.length === 0 && videoTracks.length === 0 ? (
            <div
              style={{
                backgroundColor: 'var(--card-subtle)',
                borderColor: 'var(--card-border)',
              }}
              className="p-3 rounded-xl border text-center space-y-2"
            >
              <p style={{ color: 'var(--text-soft)' }} className="text-xs">
                {searchError}
              </p>
              <button
                type="button"
                onClick={() => void runSearch(searchQuery, false)}
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#ffffff',
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
              >
                Retry Search
              </button>
            </div>
          ) : activeResultSection === 'songs' ? (
            /* ==================== SONGS SECTION ==================== */
            tracks.length > 0 ? (
              <div className="max-h-80 sm:max-h-96 overflow-y-auto space-y-1 pr-0.5 custom-scrollbar">
                {tracks.map((track) => {
                  const isSelected = currentTrack?.videoId === track.videoId;
                  return (
                    <button
                      key={`song-${track.videoId}`}
                      type="button"
                      onClick={() => handleSelectTrack({ ...track, mediaType: 'song' })}
                      style={{
                        backgroundColor: isSelected ? 'var(--card-subtle)' : 'transparent',
                        borderColor: isSelected ? 'var(--accent)' : 'transparent',
                      }}
                      className="w-full text-left p-2 rounded-xl border flex items-center gap-2.5 hover:bg-black/10 active:scale-[0.99] transition-all cursor-pointer group"
                    >
                      <div className="relative w-10 h-10 aspect-square rounded-lg overflow-hidden shrink-0 bg-black/20">
                        <img
                          src={normalizeSquareThumbnail(track.thumbnail, track.videoId)}
                          alt={track.title}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            if (!target.dataset.triedFallback && track.videoId) {
                              target.dataset.triedFallback = 'true';
                              target.src = `https://i.ytimg.com/vi/${track.videoId}/mqdefault.jpg`;
                            }
                          }}
                          className="w-full h-full aspect-square object-cover object-center block"
                        />
                        <div className="absolute inset-0 bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play className="w-3.5 h-3.5 text-white fill-white" />
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p
                          style={{
                            color: isSelected ? 'var(--accent)' : 'var(--text)',
                          }}
                          className="text-xs font-bold truncate"
                        >
                          {track.title}
                        </p>
                        <p style={{ color: 'var(--text-soft)' }} className="text-[10px] truncate">
                          {track.artist}
                          {track.album ? ` · ${track.album}` : ''}
                        </p>
                      </div>

                      {track.durationText && (
                        <span
                          style={{
                            backgroundColor: 'var(--card-subtle)',
                            color: 'var(--text-soft)',
                          }}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0"
                        >
                          {track.durationText}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : !isSearching ? (
              <div
                style={{
                  backgroundColor: 'var(--card-subtle)',
                  borderColor: 'var(--card-border)',
                }}
                className="p-3 rounded-xl border text-center space-y-2"
              >
                <p style={{ color: 'var(--text-soft)' }} className="text-xs">
                  {videoTracks.length > 0
                    ? 'Ye gaana audio Songs mein nahi mila, par Videos section mein available hai!'
                    : 'Type a song title or singer name above to search.'}
                </p>
                {videoTracks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveResultSection('videos')}
                    style={{
                      backgroundColor: 'var(--accent)',
                      color: '#ffffff',
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Show Videos ({videoTracks.length})</span>
                  </button>
                )}
              </div>
            ) : null
          ) : (
            /* ==================== VIDEOS SECTION ==================== */
            videoTracks.length > 0 ? (
              <div className="max-h-80 sm:max-h-96 overflow-y-auto space-y-1.5 pr-0.5 custom-scrollbar">
                {tracks.length === 0 && !isSearching && (
                  <div
                    style={{
                      backgroundColor: 'var(--card-subtle)',
                      borderColor: 'var(--card-border)',
                      color: 'var(--accent)',
                    }}
                    className="px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5"
                  >
                    <Film className="w-3.5 h-3.5 shrink-0" />
                    <span>Showing Videos matching your search</span>
                  </div>
                )}
                {videoTracks.map((video) => {
                  const isSelected = currentTrack?.videoId === video.videoId;
                  return (
                    <div
                      key={`video-${video.videoId}`}
                      onClick={() =>
                        handleSelectTrack({
                          ...video,
                          mediaType: 'video',
                        })
                      }
                      style={{
                        backgroundColor: isSelected ? 'var(--card-subtle)' : 'transparent',
                        borderColor: isSelected ? 'var(--accent)' : 'transparent',
                      }}
                      className="w-full text-left p-2 rounded-xl border flex items-center gap-2.5 hover:bg-black/10 active:scale-[0.99] transition-all cursor-pointer group"
                    >
                      {/* 16:9 Video Thumbnail */}
                      <div className="relative w-16 h-10 aspect-video rounded-lg overflow-hidden shrink-0 bg-black/30 border border-white/10">
                        <img
                          src={`https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`}
                          alt={video.title}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover object-center block"
                        />
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity">
                          <Play className="w-3.5 h-3.5 text-white fill-white" />
                        </div>
                        {video.durationText && (
                          <span className="absolute bottom-0.5 right-0.5 px-1 py-0.2 rounded bg-black/80 text-white text-[9px] font-mono leading-tight">
                            {video.durationText}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p
                          style={{
                            color: isSelected ? 'var(--accent)' : 'var(--text)',
                          }}
                          className="text-xs font-bold truncate"
                        >
                          {video.title}
                        </p>
                        <p style={{ color: 'var(--text-soft)' }} className="text-[10px] truncate">
                          {video.artist}
                          {video.viewsText ? ` · ${video.viewsText}` : ''}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          showVideoViewportRef.current = true;
                          setShowVideoViewport(true);
                          handleSelectTrack({
                            ...video,
                            mediaType: 'video',
                          });
                        }}
                        style={{
                          backgroundColor: 'var(--card-subtle)',
                          color: 'var(--accent)',
                          borderColor: 'var(--card-border)',
                        }}
                        title="Play & Watch Video"
                        className="px-2 py-1 rounded-lg border text-[10px] font-bold shrink-0 flex items-center gap-1 hover:opacity-90 cursor-pointer"
                      >
                        <Tv className="w-3 h-3" />
                        <span className="hidden sm:inline">Watch</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : !isSearchingVideos ? (
              <p
                style={{ color: 'var(--text-soft)' }}
                className="text-xs text-center py-3 opacity-80"
              >
                No videos found yet. Search any song or video title above.
              </p>
            ) : null
          )}
        </div>
      )}
    </div>
  );

  // Floating Mini-Player when user navigates to other rooms (Gallery, Poetry, Breathe, etc.) while a song is loaded
  const showFloatingMiniPlayer = activeTab !== 'home' && currentTrack !== null;

  return (
    <>
      {/* Render inline card into #darling-player-slot on Home screen */}
      {activeTab === 'home' && slotElement && createPortal(inlineRoomPlayerCard, slotElement)}

      {/* Persistent Singleton YouTube IFrame Host Container (never unmounts across room switches) */}
      <div
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--card-border)',
        }}
        className={
          showVideoViewport && currentTrack
            ? 'fixed bottom-20 right-4 z-[90] w-64 sm:w-72 aspect-video rounded-2xl overflow-hidden border shadow-2xl transition-all duration-200'
            : 'fixed bottom-2 right-2 w-[200px] h-[200px] opacity-[0.01] pointer-events-none overflow-hidden z-0'
        }
      >
        <div id="kashish-yt-iframe-wrapper" className="w-full h-full" />
        {showVideoViewport && currentTrack && (
          <button
            type="button"
            onClick={() => handleToggleVideoViewport()}
            className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-black/75 text-white flex items-center justify-center cursor-pointer"
            aria-label="Hide video preview"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Persistent Floating Mini-Player across other Rooms */}
      {showFloatingMiniPlayer && currentTrack && (
        <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[85] w-[94%] max-w-md pointer-events-auto">
          <div
            style={{
              backgroundColor: 'var(--card)',
              borderColor: 'var(--card-border)',
              boxShadow: '0 8px 28px var(--shadow-color)',
            }}
            className="rounded-2xl border p-2.5 backdrop-blur-md space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div
                onClick={() => setIsMiniExpanded((prev) => !prev)}
                className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
              >
                <div className="relative w-10 h-10 aspect-square rounded-xl overflow-hidden shrink-0 border border-white/10">
                  <img
                    src={normalizeSquareThumbnail(currentTrack.thumbnail, currentTrack.videoId)}
                    alt={currentTrack.title}
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      if (!target.dataset.triedFallback && currentTrack.videoId) {
                        target.dataset.triedFallback = 'true';
                        target.src = `https://i.ytimg.com/vi/${currentTrack.videoId}/mqdefault.jpg`;
                      }
                    }}
                    className="w-full h-full aspect-square object-cover object-center block"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span
                      style={{ color: 'var(--accent)' }}
                      className="text-[10px] font-bold uppercase tracking-wider shrink-0"
                    >
                      4 You Darling
                    </span>
                  </div>
                  <p style={{ color: 'var(--text)' }} className="text-xs font-bold truncate">
                    {currentTrack.title}
                  </p>
                  <p style={{ color: 'var(--text-soft)' }} className="text-[10px] truncate">
                    {currentTrack.artist}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={playPrevTrack}
                  style={{ color: 'var(--text)' }}
                  className="p-1.5 rounded-lg hover:bg-black/10 cursor-pointer"
                  aria-label="Previous track"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleTogglePlayPause}
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: '#ffffff',
                  }}
                  className="w-8 h-8 rounded-xl flex items-center justify-center shadow-xs cursor-pointer active:scale-95"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isBuffering ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={playNextTrack}
                  style={{ color: 'var(--text)' }}
                  className="p-1.5 rounded-lg hover:bg-black/10 cursor-pointer"
                  aria-label="Next track"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    pausePlayback();
                    setCurrentTrack(null);
                    showNativeToast('Mini player closed');
                  }}
                  style={{ color: 'var(--text-soft)' }}
                  className="p-1.5 rounded-lg hover:bg-black/10 cursor-pointer"
                  aria-label="Close mini player"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {isMiniExpanded && (
              <div className="pt-1">
                <PlayerProgressBar
                  getPlaybackMetrics={getPlaybackMetrics}
                  onSeekTo={handleSeekTo}
                  isPlaying={isPlaying}
                  trackId={currentTrack.videoId}
                  fallbackDurationSec={currentTrack.durationSeconds}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
