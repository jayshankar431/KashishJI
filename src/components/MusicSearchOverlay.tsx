import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowUpLeft,
  Clock,
  Disc3,
  Heart,
  ListMusic,
  Loader2,
  Music,
  Play,
  Podcast,
  Search,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import {
  CategorizedSearchResults,
  SearchCatalogItem,
  SearchFilterCategory,
  YouTubeTrack,
  createEmptyCategorizedResults,
  fetchYouTubeSuggestions,
  getInstantSuggestions,
  normalizeSquareThumbnail,
  searchYouTubeCategorized,
} from '../services/youtubeSearch';
import { triggerHaptic } from '../androidBridge';

export type SearchOverlayStage = 'history' | 'suggestions' | 'results';

interface MusicSearchOverlayProps {
  isOpen: boolean;
  initialQuery?: string;
  recentSearches: string[];
  currentTrackId?: string;
  isPlaying: boolean;
  favoriteIds: Set<string>;
  onClose: () => void;
  onAddRecentSearch: (query: string) => void;
  onRemoveRecentSearch: (query: string) => void;
  onClearRecentSearches: () => void;
  onPlaySong: (track: YouTubeTrack) => void;
  onPlayVideo: (track: YouTubeTrack) => void;
  onToggleFavorite: (track: YouTubeTrack) => void;
}

const SEARCH_FILTERS: { id: SearchFilterCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'videos', label: 'Videos' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'community_playlists', label: 'Community playlists' },
  { id: 'featured_playlists', label: 'Featured playlists' },
  { id: 'podcasts', label: 'Podcasts' },
  { id: 'episodes', label: 'Episodes' },
];

const QUICK_POPULAR_PICKS = [
  'Arijit Singh',
  'Apna Bana Le',
  'Diljit Dosanjh',
  'Anuv Jain',
  'Atif Aslam',
  'Pritam Romantic Hits',
];

export const MusicSearchOverlay: React.FC<MusicSearchOverlayProps> = ({
  isOpen,
  initialQuery = '',
  recentSearches,
  currentTrackId,
  isPlaying,
  favoriteIds,
  onClose,
  onAddRecentSearch,
  onRemoveRecentSearch,
  onClearRecentSearches,
  onPlaySong,
  onPlayVideo,
  onToggleFavorite,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [stage, setStage] = useState<SearchOverlayStage>('history');
  const [activeFilter, setActiveFilter] = useState<SearchFilterCategory>('all');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [results, setResults] = useState<CategorizedSearchResults>(createEmptyCategorizedResults);
  const [loadedFilters, setLoadedFilters] = useState<Set<SearchFilterCategory>>(new Set());
  const [isLoadingResults, setIsLoadingResults] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Sync when overlay opens
  useEffect(() => {
    if (!isOpen) return;
    if (initialQuery.trim()) {
      setQuery(initialQuery);
    }
    const raf = window.requestAnimationFrame(() => {
      if (stage !== 'results') {
        inputRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isOpen]);

  // Cleanup active requests on unmount/close
  useEffect(() => {
    if (!isOpen) {
      suggestAbortRef.current?.abort();
      searchAbortRef.current?.abort();
    }
  }, [isOpen]);

  // Stage 2: Live debounced suggestions while typing
  useEffect(() => {
    if (!isOpen || stage !== 'suggestions') return;
    const trimmed = query.trim();
    if (!trimmed) {
      setSuggestions([]);
      setStage('history');
      return;
    }

    // Immediate 0ms instant suggestions
    setSuggestions(getInstantSuggestions(trimmed, recentSearches, 8));

    const timer = window.setTimeout(() => {
      suggestAbortRef.current?.abort();
      const controller = new AbortController();
      suggestAbortRef.current = controller;

      void fetchYouTubeSuggestions(trimmed, recentSearches, controller.signal, 8)
        .then((list) => {
          if (!controller.signal.aborted && list.length > 0) {
            setSuggestions(list);
          }
        })
        .catch(() => {});
    }, 110);

    return () => window.clearTimeout(timer);
  }, [isOpen, query, stage, recentSearches]);

  const executeCategorizedSearch = useCallback(
    async (rawTerm: string, filterToLoad: SearchFilterCategory = 'all', isNewSearch = true) => {
      const cleanTerm = rawTerm.replace(/\s+/g, ' ').trim();
      if (!cleanTerm) {
        setStage('history');
        return;
      }

      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setQuery(cleanTerm);
      setSubmittedQuery(cleanTerm);
      setActiveFilter(filterToLoad);
      setStage('results');
      inputRef.current?.blur();

      if (isNewSearch) {
        onAddRecentSearch(cleanTerm);
        setResults(createEmptyCategorizedResults());
        setLoadedFilters(new Set());
      }

      setIsLoadingResults(true);
      try {
        const fetched = await searchYouTubeCategorized(cleanTerm, filterToLoad, controller.signal);
        if (controller.signal.aborted) return;

        setResults((prev) => {
          if (isNewSearch || filterToLoad === 'all') {
            return {
              songs: fetched.songs.length > 0 ? fetched.songs : prev.songs,
              videos: fetched.videos.length > 0 ? fetched.videos : prev.videos,
              albums: fetched.albums.length > 0 ? fetched.albums : prev.albums,
              artists: fetched.artists.length > 0 ? fetched.artists : prev.artists,
              community_playlists:
                fetched.community_playlists.length > 0
                  ? fetched.community_playlists
                  : prev.community_playlists,
              featured_playlists:
                fetched.featured_playlists.length > 0
                  ? fetched.featured_playlists
                  : prev.featured_playlists,
              podcasts: fetched.podcasts.length > 0 ? fetched.podcasts : prev.podcasts,
              episodes: fetched.episodes.length > 0 ? fetched.episodes : prev.episodes,
            };
          }
          return {
            ...prev,
            [filterToLoad]: (fetched as any)[filterToLoad] || (prev as any)[filterToLoad],
          };
        });
        setLoadedFilters((prev) => new Set(prev).add(filterToLoad));
      } catch {
        // Keep any existing partial results gracefully
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingResults(false);
        }
      }
    },
    [onAddRecentSearch]
  );

  const handleSelectFilter = useCallback(
    (nextFilter: SearchFilterCategory) => {
      triggerHaptic(15);
      setActiveFilter(nextFilter);
      if (!submittedQuery) return;
      if (nextFilter === 'all') return;

      const existingItems = (results as any)[nextFilter] as any[];
      const alreadyLoaded = loadedFilters.has(nextFilter);
      if (!alreadyLoaded || !existingItems || existingItems.length < 6) {
        void executeCategorizedSearch(submittedQuery, nextFilter, false);
      }
    },
    [submittedQuery, results, loadedFilters, executeCategorizedSearch]
  );

  const handleCatalogItemPress = useCallback(
    (item: SearchCatalogItem) => {
      triggerHaptic(20);
      if (item.videoId) {
        const track: YouTubeTrack = {
          videoId: item.videoId,
          title: item.title,
          artist: item.artist || item.subtitle || 'YouTube Music',
          album: item.album,
          thumbnail: normalizeSquareThumbnail(item.thumbnail, item.videoId),
          durationText: item.durationText || '',
          durationSeconds: item.durationSeconds,
          viewsText: item.viewsText,
          mediaType: item.category === 'videos' ? 'video' : 'song',
          catalogSource: item.category === 'videos' ? 'youtube_video' : 'youtube_music',
        };
        if (item.category === 'videos') {
          onPlayVideo(track);
        } else {
          onPlaySong(track);
        }
        return;
      }

      // Non-direct playable entity (Artist, Album, Playlist, Podcast): open its songs cleanly
      const scopedQuery =
        item.category === 'artists'
          ? `${item.title} top songs`
          : item.category === 'albums'
            ? `${item.title} ${item.artist || ''} album songs`.trim()
            : item.category === 'podcasts'
              ? `${item.title} podcast episodes`
              : `${item.title} songs`;

      const targetFilter: SearchFilterCategory =
        item.category === 'podcasts' ? 'episodes' : 'songs';
      void executeCategorizedSearch(scopedQuery, targetFilter, true);
    },
    [onPlaySong, onPlayVideo, executeCategorizedSearch]
  );

  const handleBackAction = useCallback(() => {
    triggerHaptic(15);
    if (stage === 'results' && activeFilter !== 'all') {
      setActiveFilter('all');
      return;
    }
    onClose();
  }, [stage, activeFilter, onClose]);

  // Close/step back cleanly on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleBackAction();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleBackAction]);

  if (!isOpen) return null;

  const renderSongRow = (song: YouTubeTrack, idx: number) => {
    const isActive = currentTrackId === song.videoId;
    const isLiked = favoriteIds.has(song.videoId);
    const thumbUrl = normalizeSquareThumbnail(song.thumbnail, song.videoId);

    return (
      <div
        key={`sr-song-${song.videoId}-${idx}`}
        onClick={() => {
          triggerHaptic(20);
          onPlaySong({ ...song, mediaType: 'song', catalogSource: 'youtube_music' });
        }}
        style={{
          backgroundColor: isActive ? 'var(--ytm-accent-soft)' : 'transparent',
          borderColor: isActive ? 'var(--ytm-accent)' : 'transparent',
        }}
        className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl border transition-colors cursor-pointer hover:opacity-95 active:scale-[0.99]"
      >
        <div
          style={{ backgroundColor: 'var(--ytm-surface-elevated)' }}
          className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0"
        >
          <img
            src={thumbUrl}
            alt={song.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.dataset.fb) {
                img.dataset.fb = '1';
                img.src = `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`;
              }
            }}
            className="w-full h-full object-cover"
          />
          {isActive && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <div className="flex items-end gap-[2px] h-3.5">
                <span
                  style={{ backgroundColor: 'var(--ytm-accent)' }}
                  className={`w-[3px] rounded-full ${isPlaying ? 'animate-bounce h-3' : 'h-1.5'}`}
                />
                <span
                  style={{ backgroundColor: 'var(--ytm-accent)' }}
                  className={`w-[3px] rounded-full ${isPlaying ? 'animate-pulse h-3.5' : 'h-2.5'}`}
                />
                <span
                  style={{ backgroundColor: 'var(--ytm-accent)' }}
                  className={`w-[3px] rounded-full ${isPlaying ? 'animate-bounce h-2' : 'h-1.5'}`}
                />
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 text-left">
          <p
            style={{ color: isActive ? 'var(--ytm-accent)' : 'var(--ytm-text)' }}
            className="text-sm font-semibold truncate leading-snug"
          >
            {song.title}
          </p>
          <p
            style={{ color: 'var(--ytm-text-muted)' }}
            className="text-xs truncate mt-0.5"
          >
            Song • {song.artist}
            {song.durationText ? ` • ${song.durationText}` : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            triggerHaptic(15);
            onToggleFavorite(song);
          }}
          aria-label={isLiked ? 'Unlike song' : 'Like song'}
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer"
        >
          <Heart
            className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`}
            style={{ color: isLiked ? 'var(--ytm-accent)' : 'var(--ytm-text-muted)' }}
          />
        </button>
      </div>
    );
  };

  const renderVideoRow = (vid: YouTubeTrack, idx: number) => {
    const isActive = currentTrackId === vid.videoId;
    const thumbUrl = vid.thumbnail || `https://i.ytimg.com/vi/${vid.videoId}/hqdefault.jpg`;

    return (
      <div
        key={`sr-vid-${vid.videoId}-${idx}`}
        onClick={() => {
          triggerHaptic(20);
          onPlayVideo({ ...vid, mediaType: 'video', catalogSource: 'youtube_video' });
        }}
        style={{
          backgroundColor: isActive ? 'var(--ytm-accent-soft)' : 'transparent',
          borderColor: isActive ? 'var(--ytm-accent)' : 'transparent',
        }}
        className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl border transition-colors cursor-pointer active:scale-[0.99]"
      >
        <div
          style={{ backgroundColor: 'var(--ytm-surface-elevated)' }}
          className="relative w-24 aspect-video rounded-lg overflow-hidden shrink-0"
        >
          <img
            src={thumbUrl}
            alt={vid.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.dataset.fb) {
                img.dataset.fb = '1';
                img.src = `https://i.ytimg.com/vi/${vid.videoId}/hqdefault.jpg`;
              }
            }}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
            <span className="w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center">
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            </span>
          </div>
          {vid.durationText && (
            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] font-semibold leading-none">
              {vid.durationText}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 text-left">
          <p
            style={{ color: isActive ? 'var(--ytm-accent)' : 'var(--ytm-text)' }}
            className="text-sm font-semibold line-clamp-2 leading-snug"
          >
            {vid.title}
          </p>
          <p
            style={{ color: 'var(--ytm-text-muted)' }}
            className="text-xs truncate mt-0.5"
          >
            Video • {vid.artist}
            {vid.viewsText ? ` • ${vid.viewsText}` : ''}
          </p>
        </div>
      </div>
    );
  };

  const renderCatalogRow = (item: SearchCatalogItem, idx: number) => {
    const isArtist = item.category === 'artists';
    const IconFallback =
      item.category === 'artists'
        ? User
        : item.category === 'albums'
          ? Disc3
          : item.category === 'podcasts' || item.category === 'episodes'
            ? Podcast
            : ListMusic;

    return (
      <button
        key={`sr-cat-${item.category}-${item.id}-${idx}`}
        type="button"
        onClick={() => handleCatalogItemPress(item)}
        className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors cursor-pointer text-left active:scale-[0.99]"
        style={{ backgroundColor: 'transparent' }}
      >
        <div
          style={{
            backgroundColor: 'var(--ytm-surface-elevated)',
            borderColor: 'var(--ytm-border)',
          }}
          className={`w-12 h-12 shrink-0 overflow-hidden border flex items-center justify-center ${
            isArtist ? 'rounded-full' : 'rounded-lg'
          }`}
        >
          {item.thumbnail ? (
            <img
              src={item.thumbnail}
              alt={item.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <IconFallback className="w-5 h-5" style={{ color: 'var(--ytm-text-muted)' }} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p style={{ color: 'var(--ytm-text)' }} className="text-sm font-semibold truncate">
            {item.title}
          </p>
          <p style={{ color: 'var(--ytm-text-muted)' }} className="text-xs truncate mt-0.5">
            {item.subtitle}
            {item.durationText ? ` • ${item.durationText}` : ''}
          </p>
        </div>
      </button>
    );
  };

  const renderSectionHeader = (
    title: string,
    targetFilter: SearchFilterCategory,
    showViewAll: boolean
  ) => (
    <div className="flex items-center justify-between px-2 pt-3 pb-1.5">
      <h3
        style={{ color: 'var(--ytm-text)' }}
        className="text-base font-bold tracking-tight"
      >
        {title}
      </h3>
      {showViewAll && (
        <button
          type="button"
          onClick={() => handleSelectFilter(targetFilter)}
          style={{
            color: 'var(--ytm-accent)',
            borderColor: 'var(--ytm-border)',
            backgroundColor: 'var(--ytm-surface)',
          }}
          className="px-3 py-1 rounded-full border text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer active:scale-95"
        >
          View all
        </button>
      )}
    </div>
  );

  const hasAnyResults =
    results.songs.length > 0 ||
    results.videos.length > 0 ||
    results.albums.length > 0 ||
    results.artists.length > 0 ||
    results.community_playlists.length > 0 ||
    results.featured_playlists.length > 0 ||
    results.podcasts.length > 0 ||
    results.episodes.length > 0;

  const overlayContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Music Search"
      style={{
        backgroundColor: 'var(--ytm-bg)',
        color: 'var(--ytm-text)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      className="fixed inset-0 z-[200] w-screen h-[100dvh] flex flex-col liquid-overlay-in overflow-hidden"
    >
      {/* Top Pinned Search Bar */}
      <div
        style={{
          backgroundColor: 'var(--ytm-bg)',
          borderColor: 'var(--ytm-border)',
        }}
        className="shrink-0 border-b px-2.5 sm:px-4 py-2.5"
      >
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleBackAction}
            aria-label="Back"
            style={{ color: 'var(--ytm-text)' }}
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 cursor-pointer active:scale-90"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void executeCategorizedSearch(query, 'all', true);
            }}
            style={{
              backgroundColor: 'var(--ytm-input-bg)',
              borderColor: 'var(--ytm-border)',
            }}
            className="flex-1 flex items-center rounded-full border pl-3.5 pr-1.5 h-11 min-w-0"
          >
            <input
              ref={inputRef}
              type="text"
              value={query}
              onFocus={() => {
                if (!query.trim()) {
                  setStage('history');
                } else if (stage === 'results') {
                  setStage('suggestions');
                }
              }}
              onChange={(e) => {
                const nextVal = e.target.value;
                setQuery(nextVal);
                if (!nextVal.trim()) {
                  setStage('history');
                } else {
                  setStage('suggestions');
                }
              }}
              placeholder="Search songs, artists, albums, podcasts..."
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="ytm-search-input flex-1 min-w-0 bg-transparent border-0 outline-none py-1.5"
            />

            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setStage('history');
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                style={{ color: 'var(--ytm-text-muted)' }}
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            <button
              type="submit"
              aria-label="Search"
              style={{
                backgroundColor: query.trim() ? 'var(--ytm-accent)' : 'transparent',
                color: query.trim() ? 'var(--ytm-accent-text)' : 'var(--ytm-text-muted)',
              }}
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-colors"
            >
              <Search className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Stage 3 Filter Chips Row directly below Search Bar */}
        {stage === 'results' && (
          <div className="max-w-3xl mx-auto mt-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {SEARCH_FILTERS.map((f) => {
              const active = activeFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleSelectFilter(f.id)}
                  style={{
                    backgroundColor: active
                      ? 'var(--ytm-chip-active-bg)'
                      : 'var(--ytm-chip-bg)',
                    color: active
                      ? 'var(--ytm-chip-active-text)'
                      : 'var(--ytm-chip-text)',
                    borderColor: active ? 'var(--ytm-chip-active-bg)' : 'var(--ytm-border)',
                  }}
                  className="px-3.5 py-1.5 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-5 pb-10">
        <div className="max-w-3xl mx-auto w-full pt-2">
          {/* STAGE 1: SEARCH HISTORY */}
          {stage === 'history' && (
            <div className="space-y-4">
              {recentSearches.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span
                      style={{ color: 'var(--ytm-text-muted)' }}
                      className="text-xs font-bold uppercase tracking-wider"
                    >
                      Recent Searches
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(15);
                        onClearRecentSearches();
                      }}
                      style={{ color: 'var(--ytm-accent)' }}
                      className="text-xs font-semibold cursor-pointer px-2 py-1"
                    >
                      Clear all
                    </button>
                  </div>

                  <div className="space-y-0.5">
                    {recentSearches.map((item) => (
                      <div
                        key={`hist-${item}`}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-xl"
                      >
                        <button
                          type="button"
                          onClick={() => void executeCategorizedSearch(item, 'all', true)}
                          className="flex-1 min-w-0 flex items-center gap-3 py-1.5 text-left cursor-pointer"
                        >
                          <Clock
                            className="w-4 h-4 shrink-0"
                            style={{ color: 'var(--ytm-text-muted)' }}
                          />
                          <span
                            style={{ color: 'var(--ytm-text)' }}
                            className="text-sm font-medium truncate"
                          >
                            {item}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setQuery(item);
                            setStage('suggestions');
                            inputRef.current?.focus();
                          }}
                          aria-label="Fill search"
                          style={{ color: 'var(--ytm-text-muted)' }}
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 cursor-pointer"
                        >
                          <ArrowUpLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveRecentSearch(item)}
                          aria-label="Remove history item"
                          style={{ color: 'var(--ytm-text-muted)' }}
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    backgroundColor: 'var(--ytm-surface)',
                    borderColor: 'var(--ytm-border)',
                  }}
                  className="rounded-2xl border p-5 text-center mt-2 space-y-2"
                >
                  <Search
                    className="w-7 h-7 mx-auto opacity-75"
                    style={{ color: 'var(--ytm-accent)' }}
                  />
                  <p style={{ color: 'var(--ytm-text)' }} className="text-sm font-semibold">
                    Search your favourite music
                  </p>
                  <p style={{ color: 'var(--ytm-text-muted)' }} className="text-xs">
                    Your recent searches will appear right here for quick access.
                  </p>
                </div>
              )}

              {/* Popular quick-starts */}
              <div>
                <div className="px-2 py-1.5 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--ytm-accent)' }} />
                  <span
                    style={{ color: 'var(--ytm-text-muted)' }}
                    className="text-xs font-bold uppercase tracking-wider"
                  >
                    Popular Searches
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 px-1 pt-1">
                  {QUICK_POPULAR_PICKS.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => void executeCategorizedSearch(term, 'all', true)}
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                        color: 'var(--ytm-text)',
                      }}
                      className="px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer active:scale-95"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STAGE 2: LIVE SEARCH SUGGESTIONS WHILE TYPING */}
          {stage === 'suggestions' && (
            <div className="space-y-0.5">
              {/* Direct search row for typed query */}
              <button
                type="button"
                onClick={() => void executeCategorizedSearch(query, 'all', true)}
                style={{
                  backgroundColor: 'var(--ytm-accent-soft)',
                  borderColor: 'var(--ytm-border)',
                }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border mb-2 text-left cursor-pointer"
              >
                <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--ytm-accent)' }} />
                <span style={{ color: 'var(--ytm-text)' }} className="text-sm font-semibold truncate">
                  Search for &ldquo;{query.trim()}&rdquo;
                </span>
              </button>

              {suggestions.map((sug) => (
                <div
                  key={`sug-${sug}`}
                  className="flex items-center gap-2 px-2 py-1 rounded-xl"
                >
                  <button
                    type="button"
                    onClick={() => void executeCategorizedSearch(sug, 'all', true)}
                    className="flex-1 min-w-0 flex items-center gap-3 py-2 text-left cursor-pointer"
                  >
                    <Search
                      className="w-4 h-4 shrink-0"
                      style={{ color: 'var(--ytm-text-muted)' }}
                    />
                    <span
                      style={{ color: 'var(--ytm-text)' }}
                      className="text-sm font-medium truncate"
                    >
                      {sug}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery(sug);
                      inputRef.current?.focus();
                    }}
                    aria-label="Fill suggestion"
                    style={{ color: 'var(--ytm-text-muted)' }}
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <ArrowUpLeft className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* STAGE 3: CATEGORIZED SEARCH RESULTS */}
          {stage === 'results' && (
            <div className="space-y-4">
              {isLoadingResults && !hasAnyResults && (
                <div className="py-12 flex flex-col items-center justify-center gap-3">
                  <Loader2
                    className="w-7 h-7 animate-spin"
                    style={{ color: 'var(--ytm-accent)' }}
                  />
                  <p style={{ color: 'var(--ytm-text-muted)' }} className="text-xs font-medium">
                    Searching YouTube Music for &ldquo;{submittedQuery}&rdquo;...
                  </p>
                </div>
              )}

              {/* ALL FILTER: Stacked categorized sections (5 Songs + View all, Videos, Albums, Artists, Playlists, Podcasts, Episodes) */}
              {activeFilter === 'all' && hasAnyResults && (
                <div className="space-y-4">
                  {/* 1. Songs (strictly 5 songs + View all) */}
                  {results.songs.length > 0 && (
                    <section
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="rounded-2xl border p-2 sm:p-3"
                    >
                      {renderSectionHeader('Songs', 'songs', results.songs.length > 0)}
                      <div className="space-y-0.5">
                        {results.songs.slice(0, 5).map((song, idx) => renderSongRow(song, idx))}
                      </div>
                    </section>
                  )}

                  {/* 2. Videos */}
                  {results.videos.length > 0 && (
                    <section
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="rounded-2xl border p-2 sm:p-3"
                    >
                      {renderSectionHeader('Videos', 'videos', results.videos.length > 0)}
                      <div className="space-y-1">
                        {results.videos.slice(0, 4).map((vid, idx) => renderVideoRow(vid, idx))}
                      </div>
                    </section>
                  )}

                  {/* 3. Albums */}
                  {results.albums.length > 0 && (
                    <section
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="rounded-2xl border p-2 sm:p-3"
                    >
                      {renderSectionHeader('Albums', 'albums', results.albums.length > 0)}
                      <div className="space-y-0.5">
                        {results.albums.slice(0, 4).map((item, idx) => renderCatalogRow(item, idx))}
                      </div>
                    </section>
                  )}

                  {/* 4. Artists */}
                  {results.artists.length > 0 && (
                    <section
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="rounded-2xl border p-2 sm:p-3"
                    >
                      {renderSectionHeader('Artists', 'artists', results.artists.length > 0)}
                      <div className="space-y-0.5">
                        {results.artists.slice(0, 4).map((item, idx) => renderCatalogRow(item, idx))}
                      </div>
                    </section>
                  )}

                  {/* 5. Community playlists */}
                  {results.community_playlists.length > 0 && (
                    <section
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="rounded-2xl border p-2 sm:p-3"
                    >
                      {renderSectionHeader(
                        'Community playlists',
                        'community_playlists',
                        results.community_playlists.length > 0
                      )}
                      <div className="space-y-0.5">
                        {results.community_playlists
                          .slice(0, 4)
                          .map((item, idx) => renderCatalogRow(item, idx))}
                      </div>
                    </section>
                  )}

                  {/* 6. Featured playlists */}
                  {results.featured_playlists.length > 0 && (
                    <section
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="rounded-2xl border p-2 sm:p-3"
                    >
                      {renderSectionHeader(
                        'Featured playlists',
                        'featured_playlists',
                        results.featured_playlists.length > 0
                      )}
                      <div className="space-y-0.5">
                        {results.featured_playlists
                          .slice(0, 4)
                          .map((item, idx) => renderCatalogRow(item, idx))}
                      </div>
                    </section>
                  )}

                  {/* 7. Podcasts */}
                  {results.podcasts.length > 0 && (
                    <section
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="rounded-2xl border p-2 sm:p-3"
                    >
                      {renderSectionHeader('Podcasts', 'podcasts', results.podcasts.length > 0)}
                      <div className="space-y-0.5">
                        {results.podcasts
                          .slice(0, 4)
                          .map((item, idx) => renderCatalogRow(item, idx))}
                      </div>
                    </section>
                  )}

                  {/* 8. Episodes */}
                  {results.episodes.length > 0 && (
                    <section
                      style={{
                        backgroundColor: 'var(--ytm-surface)',
                        borderColor: 'var(--ytm-border)',
                      }}
                      className="rounded-2xl border p-2 sm:p-3"
                    >
                      {renderSectionHeader('Episodes', 'episodes', results.episodes.length > 0)}
                      <div className="space-y-0.5">
                        {results.episodes
                          .slice(0, 4)
                          .map((item, idx) => renderCatalogRow(item, idx))}
                      </div>
                    </section>
                  )}
                </div>
              )}

              {/* SPECIFIC CATEGORY EXPANDED VIEW */}
              {activeFilter !== 'all' && (
                <section
                  style={{
                    backgroundColor: 'var(--ytm-surface)',
                    borderColor: 'var(--ytm-border)',
                  }}
                  className="rounded-2xl border p-2 sm:p-3"
                >
                  <div className="flex items-center justify-between px-2 py-2">
                    <h3 style={{ color: 'var(--ytm-text)' }} className="text-base font-bold">
                      {SEARCH_FILTERS.find((f) => f.id === activeFilter)?.label}
                    </h3>
                    {isLoadingResults && (
                      <Loader2
                        className="w-4 h-4 animate-spin"
                        style={{ color: 'var(--ytm-accent)' }}
                      />
                    )}
                  </div>

                  {activeFilter === 'songs' && (
                    <div className="space-y-0.5">
                      {results.songs.map((song, idx) => renderSongRow(song, idx))}
                      {!isLoadingResults && results.songs.length === 0 && (
                        <p
                          style={{ color: 'var(--ytm-text-muted)' }}
                          className="text-xs text-center py-8"
                        >
                          No songs found for &ldquo;{submittedQuery}&rdquo;.
                        </p>
                      )}
                    </div>
                  )}

                  {activeFilter === 'videos' && (
                    <div className="space-y-1">
                      {results.videos.map((vid, idx) => renderVideoRow(vid, idx))}
                      {!isLoadingResults && results.videos.length === 0 && (
                        <p
                          style={{ color: 'var(--ytm-text-muted)' }}
                          className="text-xs text-center py-8"
                        >
                          No videos found for &ldquo;{submittedQuery}&rdquo;.
                        </p>
                      )}
                    </div>
                  )}

                  {activeFilter !== 'songs' && activeFilter !== 'videos' && (
                    <div className="space-y-0.5">
                      {(results[activeFilter] as SearchCatalogItem[]).map((item, idx) =>
                        renderCatalogRow(item, idx)
                      )}
                      {!isLoadingResults &&
                        (results[activeFilter] as SearchCatalogItem[]).length === 0 && (
                          <p
                            style={{ color: 'var(--ytm-text-muted)' }}
                            className="text-xs text-center py-8"
                          >
                            No {SEARCH_FILTERS.find((f) => f.id === activeFilter)?.label.toLowerCase()} found for &ldquo;{submittedQuery}&rdquo;.
                          </p>
                        )}
                    </div>
                  )}
                </section>
              )}

              {!isLoadingResults && activeFilter === 'all' && !hasAnyResults && (
                <div
                  style={{
                    backgroundColor: 'var(--ytm-surface)',
                    borderColor: 'var(--ytm-border)',
                  }}
                  className="rounded-2xl border p-6 text-center space-y-2"
                >
                  <Music className="w-7 h-7 mx-auto opacity-70" style={{ color: 'var(--ytm-accent)' }} />
                  <p style={{ color: 'var(--ytm-text)' }} className="text-sm font-semibold">
                    No results found for &ldquo;{submittedQuery}&rdquo;
                  </p>
                  <p style={{ color: 'var(--ytm-text-muted)' }} className="text-xs">
                    Try another song title, artist name, or album.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(overlayContent, document.body);
  }
  return overlayContent;
};
