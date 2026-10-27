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
  Heart,
} from 'lucide-react';
import {
  YouTubeTrack,
  searchYouTubeSongs,
  getCachedSearchEntry,
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

function updateMediaSessionPosition(positionSec: number, durationSec: number) {
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
      playbackRate: 1,
      position: safePos,
    });
  } catch {
    // Ignore unsupported browser errors
  }
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
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    loadUserRecentSearches(userId)
  );
  const [currentTrack, setCurrentTrack] = useState<YouTubeTrack | null>(() =>
    loadUserLastPlayedTrack(userId)
  );

  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isListExpanded, setIsListExpanded] = useState<boolean>(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [volume, setVolume] = useState<number>(90);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showVideoViewport, setShowVideoViewport] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [isMiniExpanded, setIsMiniExpanded] = useState<boolean>(false);

  // Official YouTube IFrame Player API singleton refs
  const playerRef = useRef<any>(null);
  const isPlayerReadyRef = useRef<boolean>(false);
  const isInitializingPlayerRef = useRef<boolean>(false);
  const loadedVideoIdInPlayerRef = useRef<string | null>(null);
  const userWantPlayingRef = useRef<boolean>(false);
  const volumeRef = useRef<number>(volume);
  const isMutedRef = useRef<boolean>(isMuted);

  const pendingTrackRef = useRef<YouTubeTrack | null>(null);
  const currentTrackRef = useRef<YouTubeTrack | null>(currentTrack);
  const tracksRef = useRef<YouTubeTrack[]>(tracks);
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

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Isolate search history and playback state when userId changes (e.g. sign-in / sign-out / account switch)
  useEffect(() => {
    if (userIdRef.current === userId) return;
    userIdRef.current = userId;

    // Pause any active playback from previous user session
    userWantPlayingRef.current = false;
    setIsPlaying(false);
    setIsBuffering(false);
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
    const p = playerRef.current;
    if (p && isPlayerReadyRef.current && typeof p.getCurrentTime === 'function') {
      try {
        const cur = p.getCurrentTime() || 0;
        const dur = p.getDuration() || 0;
        return { currentTime: cur, duration: dur };
      } catch {}
    }
    return { currentTime: 0, duration: 0 };
  }, []);

  // Seek handler for YouTube IFrame Player API
  const handleSeekTo = useCallback((seconds: number) => {
    const safeSec = Math.max(0, seconds);
    const p = playerRef.current;
    if (p && isPlayerReadyRef.current && typeof p.seekTo === 'function') {
      try {
        p.seekTo(safeSec, true);
      } catch {}
    }
  }, []);

  // Update Media Session metadata whenever currentTrack changes
  useEffect(() => {
    if (
      typeof navigator === 'undefined' ||
      !('mediaSession' in navigator) ||
      typeof window === 'undefined' ||
      typeof (window as any).MediaMetadata === 'undefined'
    ) {
      return;
    }

    if (!currentTrack) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      } catch {}
      return;
    }

    const thumbUrl =
      currentTrack.thumbnail || `https://i.ytimg.com/vi/${currentTrack.videoId}/mqdefault.jpg`;

    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album || `KASHISH · Music Player 4 ${recipientName}`,
        artwork: [
          { src: thumbUrl, sizes: '226x226', type: 'image/jpeg' },
          { src: thumbUrl, sizes: '512x512', type: 'image/jpeg' },
        ],
      });
    } catch {
      // Ignore MediaMetadata errors on older browsers
    }
  }, [currentTrack, recipientName]);

  // Keep Media Session playbackState synchronized with player state
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      if (!currentTrack) {
        navigator.mediaSession.playbackState = 'none';
      } else {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      }
    } catch {}
  }, [isPlaying, currentTrack]);

  // Pause helper (used by UI, Media Session, and voice note recording event)
  const pausePlayback = useCallback(() => {
    userWantPlayingRef.current = false;
    setIsPlaying(false);
    setIsBuffering(false);

    if (playerRef.current && isPlayerReadyRef.current) {
      try {
        playerRef.current.pauseVideo?.();
      } catch {}
    }
  }, []);

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
      const hostEl = document.getElementById('kashish-yt-iframe-target');
      if (!hostEl) return;

      isInitializingPlayerRef.current = true;
      const initialVideoId =
        pendingTrackRef.current?.videoId || currentTrackRef.current?.videoId || undefined;

      const playerConfig: Record<string, any> = {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: pendingTrackRef.current && userWantPlayingRef.current ? 1 : 0,
          controls: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          fs: 0,
          iv_load_policy: 3,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event: any) => {
            isPlayerReadyRef.current = true;
            isInitializingPlayerRef.current = false;

            const store = ensureMetricsStore();
            if (store && store.playerPrewarmedAtMs === null) {
              store.playerPrewarmedAtMs = Math.round(performance.now());
            }

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
                  suggestedQuality: 'small',
                });
                event.target.playVideo();
              } else if (currentTrackRef.current && !userWantPlayingRef.current) {
                // Pre-cue the restored last-played track without autoplaying
                loadedVideoIdInPlayerRef.current = currentTrackRef.current.videoId;
                event.target.cueVideoById({
                  videoId: currentTrackRef.current.videoId,
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
              setIsPlaying(true);
              setIsBuffering(false);
              setStatusNotice(null);
            } else if (state === 2) {
              if (
                typeof document !== 'undefined' &&
                document.visibilityState === 'hidden' &&
                userWantPlayingRef.current
              ) {
                try {
                  event.target?.playVideo?.();
                } catch {}
              }
              setIsPlaying(false);
              setIsBuffering(false);
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
            const errCode = event?.data;
            const failedTrack = currentTrackRef.current;
            // Error 101 / 150 = Uploader does not allow embedded playback outside YouTube
            if (
              failedTrack &&
              (errCode === 101 ||
                errCode === 150 ||
                errCode === 2 ||
                errCode === 5 ||
                errCode === 100)
            ) {
              triedEmbedIdsRef.current.add(failedTrack.videoId);
              setStatusNotice('Switching to embeddable YouTube Music version...');
              setIsBuffering(true);
              const altTrack = await findEmbeddableAlternative(
                failedTrack,
                triedEmbedIdsRef.current
              );
              if (altTrack && playerRef.current && isPlayerReadyRef.current) {
                triedEmbedIdsRef.current.add(altTrack.videoId);
                setCurrentTrack(altTrack);
                saveUserLastPlayedTrack(userIdRef.current, altTrack);
                loadedVideoIdInPlayerRef.current = altTrack.videoId;
                try {
                  playerRef.current.loadVideoById({
                    videoId: altTrack.videoId,
                    suggestedQuality: 'small',
                  });
                  playerRef.current.playVideo();
                  setStatusNotice(null);
                  return;
                } catch {}
              }
            }
            setIsBuffering(false);
            setIsPlaying(false);
            setStatusNotice('This track restricts embedded playback. Try another result from the list.');
          },
        },
      };

      if (initialVideoId) {
        playerConfig.videoId = initialVideoId;
        loadedVideoIdInPlayerRef.current = initialVideoId;
      }

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
  }, []);

  // Pre-warm singleton YouTube IFrame Player immediately on mount
  useEffect(() => {
    ensureYouTubePlayer();
  }, [ensureYouTubePlayer]);

  const handleSelectTrack = useCallback(
    (track: YouTubeTrack) => {
      const tapStartPerf = performance.now();
      triggerHaptic(25);
      userWantPlayingRef.current = true;

      // Persist as the current user's last actually PLAYED song (never confused with last searched)
      saveUserLastPlayedTrack(userIdRef.current, track);

      // If tapping the song that is already loaded in the YT player, resume/toggle without reloading
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
          // If cued or paused, record timing and start playback immediately
          tapTimestampRef.current = tapStartPerf;
          const readyMs = Math.round(performance.now() - tapStartPerf);
          tapToReadyRecordedRef.current = readyMs;
          firstAudioReachedRef.current = false;
          const telemetryEntry: PlaybackTelemetryEntry = {
            videoId: track.videoId,
            title: track.title,
            artist: track.artist,
            tapToPlayerReadyMs: readyMs,
            tapToFirstAudioMs: null,
            bufferingInterruptions: 0,
            timestamp: Date.now(),
          };
          activeTelemetryEntryRef.current = telemetryEntry;
          ensureMetricsStore()?.playbacks.push(telemetryEntry);

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
        tapToPlayerReadyMs: null,
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

      // Start playback synchronously inside the user tap gesture on the singleton YT.Player
      if (playerRef.current && isPlayerReadyRef.current) {
        const readyMs = Math.round(performance.now() - tapStartPerf);
        tapToReadyRecordedRef.current = readyMs;
        telemetryEntry.tapToPlayerReadyMs = readyMs;
        loadedVideoIdInPlayerRef.current = track.videoId;
        try {
          playerRef.current.loadVideoById({
            videoId: track.videoId,
            suggestedQuality: showVideoViewport ? 'default' : 'small',
          });
          playerRef.current.playVideo();
        } catch {
          pendingTrackRef.current = track;
        }
      } else {
        pendingTrackRef.current = track;
        ensureYouTubePlayer();
      }

      void logNativeActivity(
        `🎵 ${recipientName} played song: <b>${track.title}</b> (${track.artist})`
      );
    },
    [ensureYouTubePlayer, pausePlayback, recipientName, showVideoViewport]
  );

  // Resume helper (used by UI and Media Session)
  const resumePlayback = useCallback(() => {
    const cur = currentTrackRef.current;
    if (!cur) return;
    userWantPlayingRef.current = true;
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
  }, [handleSelectTrack]);

  const playNextTrack = useCallback(() => {
    const list = tracksRef.current;
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
  }, [handleSelectTrack]);

  const playPrevTrack = useCallback(() => {
    const list = tracksRef.current;
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
  }, [handleSelectTrack]);

  const playNextTrackRef = useRef(playNextTrack);
  useEffect(() => {
    playNextTrackRef.current = playNextTrack;
  }, [playNextTrack]);

  // Register Media Session action handlers for OS Notification & Lock-Screen Controls
  useEffect(() => {
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

    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {}
      }
    };
  }, [getPlaybackMetrics, handleSeekTo, pausePlayback, playNextTrack, playPrevTrack, resumePlayback]);

  // Keep playback state synchronized across page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!userWantPlayingRef.current || !currentTrackRef.current) return;

      if (document.visibilityState === 'hidden') {
        if (playerRef.current && isPlayerReadyRef.current) {
          try {
            playerRef.current.playVideo?.();
          } catch {}
        }
      } else if (document.visibilityState === 'visible') {
        if (playerRef.current && isPlayerReadyRef.current) {
          try {
            const state = playerRef.current.getPlayerState?.();
            setIsPlaying(state === 1);
            if (state !== 1 && userWantPlayingRef.current) {
              playerRef.current.playVideo?.();
            }
          } catch {}
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const handleTogglePlayPause = useCallback(() => {
    triggerHaptic(20);
    if (!currentTrack) {
      if (tracks.length > 0) {
        handleSelectTrack(tracks[0]);
      }
      return;
    }

    if (isPlaying) {
      pausePlayback();
    } else {
      resumePlayback();
    }
  }, [currentTrack, handleSelectTrack, isPlaying, pausePlayback, resumePlayback, tracks]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVol = Number(e.target.value);
    setVolume(nextVol);
    setIsMuted(nextVol === 0);
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

  // Toggle video viewport without reloading the song or interrupting playback
  const handleToggleVideoViewport = () => {
    triggerHaptic(15);
    const nextShow = !showVideoViewport;
    setShowVideoViewport(nextShow);
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
    const cachedEntry = getCachedSearchEntry(trimmed);
    if (cachedEntry && cachedEntry.tracks.length > 0) {
      const cacheElapsedMs = Math.round(performance.now() - cacheStartPerf);
      if (searchAbortRef.current) searchAbortRef.current.abort();
      activeSearchQueryRef.current = '';
      setTracks(cachedEntry.tracks);
      saveUserLastSearch(userIdRef.current, trimmed, cachedEntry.tracks);
      setIsSearching(false);
      setSearchError(null);
      setIsListExpanded(true);

      ensureMetricsStore()?.searches.push({
        query: trimmed,
        responseTimeMs: cacheElapsedMs,
        source: 'cache',
        resultCount: cachedEntry.tracks.length,
        timestamp: Date.now(),
      });

      // Stale-While-Revalidate: refresh stale cached results in the background without blocking UI
      if (cachedEntry.isStale) {
        const bgStart = performance.now();
        void refreshSearchInBackground(trimmed).then((freshTracks) => {
          if (freshTracks && freshTracks.length > 0) {
            setTracks((prev) => (prev === cachedEntry.tracks ? freshTracks : prev));
            saveUserLastSearch(userIdRef.current, trimmed, freshTracks);
            ensureMetricsStore()?.searches.push({
              query: trimmed,
              responseTimeMs: Math.round(performance.now() - bgStart),
              source: 'background_refresh',
              resultCount: freshTracks.length,
              timestamp: Date.now(),
            });
          }
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
    setSearchError(null);
    setIsListExpanded(true);

    const isColdSearch = !hasCompletedNetworkSearchRef.current;
    const searchStartPerf = performance.now();
    try {
      const results = await searchYouTubeSongs(trimmed, controller.signal);
      if (!controller.signal.aborted) {
        const elapsedMs = Math.round(performance.now() - searchStartPerf);
        hasCompletedNetworkSearchRef.current = true;
        activeSearchQueryRef.current = '';
        setTracks(results);
        saveUserLastSearch(userIdRef.current, trimmed, results);
        setIsSearching(false);

        ensureMetricsStore()?.searches.push({
          query: trimmed,
          responseTimeMs: elapsedMs,
          source: isColdSearch ? 'cold' : 'warm',
          resultCount: results.length,
          timestamp: Date.now(),
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      activeSearchQueryRef.current = '';
      setIsSearching(false);
      setSearchError(
        err?.message || 'YouTube Music catalog search failed. Tap Retry or try another query.'
      );
    }
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
      setSearchError(null);
      return;
    }

    // Serve cached queries immediately without waiting for debounce
    const cachedEntry = getCachedSearchEntry(trimmed);
    if (cachedEntry && cachedEntry.tracks.length > 0) {
      if (searchAbortRef.current) searchAbortRef.current.abort();
      activeSearchQueryRef.current = '';
      setTracks(cachedEntry.tracks);
      setIsSearching(false);
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

          {tracks.length > 0 && (
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
              <span>{isListExpanded ? 'Hide Results' : `Results (${tracks.length})`}</span>
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
              if (tracks.length > 0) setIsListExpanded(true);
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
          disabled={isSearching || !searchQuery.trim()}
          style={{
            backgroundColor: 'var(--accent)',
            color: '#ffffff',
          }}
          className="px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 cursor-pointer active:scale-95 transition-transform disabled:opacity-60"
        >
          {isSearching ? (
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
            Recent:
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
                <div className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 border border-white/10 bg-black/20">
                  <img
                    src={currentTrack.thumbnail}
                    alt={currentTrack.title}
                    decoding="async"
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      if (!target.dataset.triedFallback && currentTrack.videoId) {
                        target.dataset.triedFallback = 'true';
                        target.src = `https://i.ytimg.com/vi/${currentTrack.videoId}/hqdefault.jpg`;
                      }
                    }}
                    className="w-full h-full object-cover"
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
                  <p
                    style={{ color: 'var(--text)' }}
                    className="text-xs sm:text-sm font-bold truncate"
                    title={currentTrack.title}
                  >
                    {currentTrack.title}
                  </p>
                  <p
                    style={{ color: 'var(--text-soft)' }}
                    className="text-[11px] truncate font-medium"
                  >
                    {currentTrack.artist}
                  </p>
                </div>
              </div>

              {/* Playback Buttons */}
              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
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
                  Search any song or artist above &amp; tap to play
                </p>
              </div>
            </div>
          </div>
        )}

        {statusNotice && (
          <p className="text-[11px] font-medium text-amber-400 px-1">{statusNotice}</p>
        )}
      </div>

      {/* Collapsible Search Results List */}
      {(isListExpanded || isSearching || searchError !== null) && (
        <div
          style={{
            borderColor: 'var(--card-border)',
          }}
          className="border-t pt-2.5 space-y-1.5"
        >
          <div className="flex items-center justify-between px-1">
            <span style={{ color: 'var(--text-soft)' }} className="text-[11px] font-semibold">
              {searchQuery.trim()
                ? `Found in Jay's Heart (${tracks.length})`
                : `Last Search Results (${tracks.length})`}
            </span>
            {isSearching && (
              <span
                style={{ color: 'var(--accent)' }}
                className="text-[11px] font-semibold flex items-center gap-1"
              >
                <Loader2 className="w-3 h-3 animate-spin" />
                Searching YouTube Music...
              </span>
            )}
          </div>

          {searchError ? (
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
          ) : tracks.length > 0 ? (
            <div className="max-h-56 overflow-y-auto space-y-1 pr-0.5 custom-scrollbar">
              {tracks.map((track) => {
                const isSelected = currentTrack?.videoId === track.videoId;
                return (
                  <button
                    key={track.videoId}
                    type="button"
                    onClick={() => handleSelectTrack(track)}
                    style={{
                      backgroundColor: isSelected ? 'var(--card-subtle)' : 'transparent',
                      borderColor: isSelected ? 'var(--accent)' : 'transparent',
                    }}
                    className="w-full text-left p-2 rounded-xl border flex items-center gap-2.5 hover:bg-black/10 active:scale-[0.99] transition-all cursor-pointer group"
                  >
                    <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-black/20">
                      <img
                        src={track.thumbnail}
                        alt={track.title}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        crossOrigin="anonymous"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          if (!target.dataset.triedFallback && track.videoId) {
                            target.dataset.triedFallback = 'true';
                            target.src = `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
                          }
                        }}
                        className="w-full h-full object-cover"
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
          ) : (
            !isSearching && (
              <p
                style={{ color: 'var(--text-soft)' }}
                className="text-xs text-center py-3 opacity-80"
              >
                Type a song title or singer name above to search YouTube Music.
              </p>
            )
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
            : 'fixed bottom-0 right-0 w-44 h-28 opacity-[0.001] pointer-events-none overflow-hidden -z-10'
        }
      >
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
        <div id="kashish-yt-iframe-target" className="w-full h-full" />
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
                <div className="relative w-10 h-10 rounded-xl overflow-hidden shrink-0 border border-white/10">
                  <img
                    src={currentTrack.thumbnail}
                    alt={currentTrack.title}
                    decoding="async"
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      if (!target.dataset.triedFallback && currentTrack.videoId) {
                        target.dataset.triedFallback = 'true';
                        target.src = `https://i.ytimg.com/vi/${currentTrack.videoId}/hqdefault.jpg`;
                      }
                    }}
                    className="w-full h-full object-cover"
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
