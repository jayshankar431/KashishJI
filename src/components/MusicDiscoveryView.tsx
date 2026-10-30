import React, { useState, useMemo } from 'react';
import {
  Play,
  Pause,
  Heart,
  Sparkles,
  Flame,
  Radio,
  Compass,
  Disc3,
  TrendingUp,
  Headphones,
  SlidersHorizontal,
  ChevronRight,
  Music2,
} from 'lucide-react';
import { YouTubeTrack } from '../services/youtubeSearch';
import {
  GENRE_MOODS,
  QUICK_PICKS_TRACKS,
  MADE_FOR_YOU_TRACKS,
  DISCOVER_WEEKLY_TRACKS,
  SIMILAR_TO_FAVORITES_TRACKS,
  HIDDEN_GEMS_TRACKS,
  NEW_ARTISTS_TRACKS,
  DAILY_MIXES,
  matchesDiscoveryGenre,
} from '../services/musicDiscoveryData';
import { triggerHaptic } from '../androidBridge';

interface MusicDiscoveryViewProps {
  currentTrack: YouTubeTrack | null;
  isPlaying: boolean;
  onSelectTrack: (track: YouTubeTrack) => void;
  onPreCueTrack: (track: YouTubeTrack) => void;
  favoriteIds: Set<string>;
  onToggleFavorite: (track: YouTubeTrack) => void;
  activePalette: any;
  recentPlayedTracks: YouTubeTrack[];
  HighResThumbnailComponent: React.ComponentType<{
    videoId: string;
    rawThumbnail?: string;
    alt: string;
    className?: string;
    aspect?: 'square' | 'video';
  }>;
}

export const MusicDiscoveryView: React.FC<MusicDiscoveryViewProps> = ({
  currentTrack,
  isPlaying,
  onSelectTrack,
  onPreCueTrack,
  favoriteIds,
  onToggleFavorite,
  activePalette,
  recentPlayedTracks,
  HighResThumbnailComponent,
}) => {
  const [selectedGenreId, setSelectedGenreId] = useState<string>('all');

  // Filter Quick Picks and Curated Tracks when a genre/mood is selected
  const filteredQuickPicks = useMemo(() => {
    return QUICK_PICKS_TRACKS.filter((t) => matchesDiscoveryGenre(t, selectedGenreId));
  }, [selectedGenreId]);

  const filteredMadeForYou = useMemo(() => {
    return MADE_FOR_YOU_TRACKS.filter((t) => matchesDiscoveryGenre(t, selectedGenreId));
  }, [selectedGenreId]);

  const filteredDiscoverWeekly = useMemo(() => {
    return DISCOVER_WEEKLY_TRACKS.filter((t) => matchesDiscoveryGenre(t, selectedGenreId));
  }, [selectedGenreId]);

  const filteredSimilarToFavorites = useMemo(() => {
    return SIMILAR_TO_FAVORITES_TRACKS.filter((t) => matchesDiscoveryGenre(t, selectedGenreId));
  }, [selectedGenreId]);

  const filteredHiddenGems = useMemo(() => {
    return HIDDEN_GEMS_TRACKS.filter((t) => matchesDiscoveryGenre(t, selectedGenreId));
  }, [selectedGenreId]);

  const filteredNewArtists = useMemo(() => {
    return NEW_ARTISTS_TRACKS.filter((t) => matchesDiscoveryGenre(t, selectedGenreId));
  }, [selectedGenreId]);

  const handleGenreClick = (genreId: string) => {
    triggerHaptic(15);
    setSelectedGenreId(genreId);
  };

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col overflow-y-auto no-scrollbar pr-1 pb-6 space-y-5 select-none">
      {/* =========================================================================
          1. EXPLORE GENRES & MOODS (Interactive Category Chips)
         ========================================================================= */}
      <div className="w-full shrink-0 pt-0.5">
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5" style={{ color: activePalette.accent }} />
            <h3
              style={{ color: activePalette.textPrimary }}
              className="text-xs font-bold uppercase tracking-wider"
            >
              Explore Genres & Moods
            </h3>
          </div>
          <span style={{ color: activePalette.textSecondary }} className="text-[10px]">
            {selectedGenreId === 'all'
              ? 'Showing All'
              : GENRE_MOODS.find((g) => g.id === selectedGenreId)?.name}
          </span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 w-full max-w-full">
          {GENRE_MOODS.map((genre) => {
            const isSelected = selectedGenreId === genre.id;
            return (
              <button
                key={genre.id}
                type="button"
                onClick={() => handleGenreClick(genre.id)}
                style={{
                  background: isSelected ? activePalette.accentGradient : activePalette.subBg,
                  color: isSelected ? '#ffffff' : activePalette.textSecondary,
                  borderColor: isSelected ? activePalette.accent : activePalette.deckBorder,
                  boxShadow: isSelected ? `0 2px 10px ${activePalette.accentGlow}` : 'none',
                }}
                className="px-3 py-1.5 rounded-xl border text-[11px] font-bold shrink-0 flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer hover:text-white"
              >
                <span>{genre.emoji}</span>
                <span>{genre.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* =========================================================================
          2. QUICK PICKS (Multi-Column Card Grid with Large Artwork)
         ========================================================================= */}
      <section className="w-full space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <h2
              style={{ color: activePalette.textPrimary }}
              className="text-sm font-extrabold tracking-tight"
            >
              Quick Picks
            </h2>
          </div>
          <span style={{ color: activePalette.textSecondary }} className="text-[10px]">
            Immediate Play
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
          {filteredQuickPicks.map((song) => {
            const isCurrent = currentTrack?.videoId === song.videoId;
            const isFav = favoriteIds.has(song.videoId);

            return (
              <div
                key={`quick-pick-${song.videoId}`}
                onClick={() => onSelectTrack(song)}
                onMouseEnter={() => onPreCueTrack(song)}
                onTouchStart={() => onPreCueTrack(song)}
                style={{
                  backgroundColor: isCurrent ? activePalette.subBg : 'rgba(255, 255, 255, 0.03)',
                  borderColor: isCurrent ? activePalette.accent : activePalette.deckBorder,
                }}
                className="group relative flex flex-col p-2 rounded-2xl border transition-all duration-200 hover:border-white/20 hover:bg-white/[0.06] active:scale-[0.98] cursor-pointer overflow-hidden shadow-xs"
              >
                {/* Large Square Artwork */}
                <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-black/40 border border-white/10 shrink-0">
                  <img
                    src={song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/maxresdefault.jpg`}
                    alt={song.title}
                    loading="eager"
                    decoding="async"
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth > 0 && img.naturalWidth <= 120) {
                        if (!img.src.includes('hq720.jpg')) {
                          img.src = `https://i.ytimg.com/vi/${song.videoId}/hq720.jpg`;
                        } else if (!img.src.includes('sddefault.jpg')) {
                          img.src = `https://i.ytimg.com/vi/${song.videoId}/sddefault.jpg`;
                        } else if (!img.src.includes('mqdefault.jpg')) {
                          img.src = `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`;
                        } else if (!img.src.includes('hqdefault.jpg')) {
                          img.src = `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`;
                        }
                      }
                    }}
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (!img.src.includes('hq720.jpg')) {
                        img.src = `https://i.ytimg.com/vi/${song.videoId}/hq720.jpg`;
                      } else if (!img.src.includes('sddefault.jpg')) {
                        img.src = `https://i.ytimg.com/vi/${song.videoId}/sddefault.jpg`;
                      } else if (!img.src.includes('mqdefault.jpg')) {
                        img.src = `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`;
                      } else if (!img.src.includes('hqdefault.jpg')) {
                        img.src = `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`;
                      }
                    }}
                    className="w-full h-full object-cover object-center block transition-transform duration-500 group-hover:scale-105"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'center',
                    }}
                  />

                  {/* Play Action Floating Overlay */}
                  <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div
                      style={{
                        background: activePalette.accentGradient,
                        boxShadow: `0 4px 14px ${activePalette.accentGlow}`,
                      }}
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white transform scale-90 group-hover:scale-100 transition-transform shadow-lg"
                    >
                      {isCurrent && isPlaying ? (
                        <Pause className="w-5 h-5 fill-current" />
                      ) : (
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      )}
                    </div>
                  </div>

                  {/* Currently Playing Indicator Badge */}
                  {isCurrent && (
                    <div className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-xs flex items-end gap-1 h-4 z-10 border border-white/15">
                      <span className="w-1 h-1.5 bg-white rounded-full animate-pulse" />
                      <span
                        style={{ backgroundColor: activePalette.accent }}
                        className="w-1 h-2.5 rounded-full animate-bounce"
                      />
                      <span className="w-1 h-2 bg-white rounded-full animate-pulse" />
                    </div>
                  )}

                  {/* Heart / Favorite Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(song);
                    }}
                    className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/60 hover:bg-black/85 text-white backdrop-blur-xs transition-transform active:scale-90 z-10 cursor-pointer"
                    title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    aria-label="Favorite song"
                  >
                    <Heart
                      className={`w-3.5 h-3.5 transition-colors ${
                        isFav ? 'fill-red-500 text-red-500' : 'text-white/80'
                      }`}
                    />
                  </button>
                </div>

                {/* Song Typography (Zero-Pill Discipline) */}
                <div className="mt-2 text-left min-w-0">
                  <h4
                    style={{
                      color: isCurrent ? activePalette.accent : activePalette.textPrimary,
                    }}
                    className="text-xs font-bold truncate leading-tight group-hover:text-white"
                  >
                    {song.title}
                  </h4>
                  <p
                    style={{ color: activePalette.textSecondary }}
                    className="text-[10px] truncate mt-0.5"
                  >
                    {song.artist}
                  </p>
                  <div
                    style={{ color: activePalette.textSecondary }}
                    className="text-[9px] flex items-center gap-1.5 mt-1 opacity-75 font-mono"
                  >
                    <span>{song.durationText}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{song.vibe}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* =========================================================================
          3. MADE FOR YOU (Personalized Recommendations)
         ========================================================================= */}
      <section className="w-full space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" style={{ color: activePalette.accent }} />
            <h2
              style={{ color: activePalette.textPrimary }}
              className="text-sm font-extrabold tracking-tight"
            >
              Made For You
            </h2>
          </div>
          <span style={{ color: activePalette.textSecondary }} className="text-[10px]">
            Personalized Mix
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filteredMadeForYou.map((song) => {
            const isCurrent = currentTrack?.videoId === song.videoId;
            const isFav = favoriteIds.has(song.videoId);

            return (
              <div
                key={`made-for-you-${song.videoId}`}
                onClick={() => onSelectTrack(song)}
                onMouseEnter={() => onPreCueTrack(song)}
                onTouchStart={() => onPreCueTrack(song)}
                style={{
                  backgroundColor: isCurrent ? activePalette.subBg : 'rgba(255, 255, 255, 0.025)',
                  borderColor: isCurrent ? activePalette.accent : activePalette.deckBorder,
                }}
                className="group flex items-center gap-3 p-2 rounded-2xl border transition-all duration-200 hover:border-white/20 hover:bg-white/[0.05] active:scale-[0.99] cursor-pointer"
              >
                <div className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-black/40 border border-white/10">
                  <HighResThumbnailComponent
                    videoId={song.videoId}
                    rawThumbnail={song.thumbnail}
                    alt={song.title}
                    aspect="square"
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                  </div>
                </div>

                <div className="flex-1 min-w-0 text-left">
                  <p
                    style={{
                      color: isCurrent ? activePalette.accent : activePalette.textPrimary,
                    }}
                    className="text-xs font-bold truncate leading-tight group-hover:text-white"
                  >
                    {song.title}
                  </p>
                  <p
                    style={{ color: activePalette.textSecondary }}
                    className="text-[10px] truncate mt-0.5"
                  >
                    {song.artist}
                  </p>
                  <p
                    style={{ color: activePalette.textSecondary }}
                    className="text-[9px] truncate opacity-75 mt-0.5 italic"
                  >
                    {song.reason}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(song);
                  }}
                  className="p-2 rounded-full text-white/70 hover:text-white shrink-0 active:scale-90"
                  title="Favorite"
                  aria-label="Favorite"
                >
                  <Heart
                    className={`w-4 h-4 ${isFav ? 'fill-red-500 text-red-500' : ''}`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* =========================================================================
          4. YOUR DAILY MIX (Curated Mood Playlists)
         ========================================================================= */}
      <section className="w-full space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-purple-400" />
            <h2
              style={{ color: activePalette.textPrimary }}
              className="text-sm font-extrabold tracking-tight"
            >
              Your Daily Mix
            </h2>
          </div>
          <span style={{ color: activePalette.textSecondary }} className="text-[10px]">
            Updated Daily
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {DAILY_MIXES.map((mix) => (
            <div
              key={mix.id}
              onClick={() => {
                if (mix.tracks[0]) onSelectTrack(mix.tracks[0]);
              }}
              className={`relative p-3.5 rounded-2xl bg-gradient-to-br ${mix.gradient} border border-white/10 hover:border-white/25 transition-all duration-200 cursor-pointer group shadow-md active:scale-[0.98]`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-white/70">
                  Kashish Mix
                </span>
                <div className="w-7 h-7 rounded-full bg-white/20 backdrop-blur-xs flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Play className="w-3.5 h-3.5 fill-white text-white ml-0.5" />
                </div>
              </div>
              <h3 className="text-sm font-extrabold text-white mt-3 truncate">{mix.title}</h3>
              <p className="text-[10px] text-white/80 truncate mt-0.5">{mix.subtitle}</p>
              <div className="text-[9px] text-white/60 mt-2 font-mono">
                {mix.tracks.length} tracks ready
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* =========================================================================
          5. DISCOVER WEEKLY (Fresh Releases & Trending Drops)
         ========================================================================= */}
      <section className="w-full space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <h2
              style={{ color: activePalette.textPrimary }}
              className="text-sm font-extrabold tracking-tight"
            >
              Discover Weekly
            </h2>
          </div>
          <span style={{ color: activePalette.textSecondary }} className="text-[10px]">
            New Releases
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {filteredDiscoverWeekly.map((song) => {
            const isCurrent = currentTrack?.videoId === song.videoId;
            return (
              <div
                key={`discover-weekly-${song.videoId}`}
                onClick={() => onSelectTrack(song)}
                onMouseEnter={() => onPreCueTrack(song)}
                onTouchStart={() => onPreCueTrack(song)}
                style={{
                  backgroundColor: isCurrent ? activePalette.subBg : 'rgba(255, 255, 255, 0.02)',
                  borderColor: isCurrent ? activePalette.accent : activePalette.deckBorder,
                }}
                className="group p-2 rounded-2xl border transition-all duration-200 hover:border-white/20 hover:bg-white/[0.05] active:scale-[0.98] cursor-pointer"
              >
                <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-black/40 border border-white/10 shrink-0">
                  <img
                    src={song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/maxresdefault.jpg`}
                    alt={song.title}
                    loading="lazy"
                    decoding="async"
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth > 0 && img.naturalWidth <= 120) {
                        if (!img.src.includes('hq720.jpg')) {
                          img.src = `https://i.ytimg.com/vi/${song.videoId}/hq720.jpg`;
                        } else if (!img.src.includes('sddefault.jpg')) {
                          img.src = `https://i.ytimg.com/vi/${song.videoId}/sddefault.jpg`;
                        } else if (!img.src.includes('mqdefault.jpg')) {
                          img.src = `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`;
                        } else if (!img.src.includes('hqdefault.jpg')) {
                          img.src = `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`;
                        }
                      }
                    }}
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (!img.src.includes('hq720.jpg')) {
                        img.src = `https://i.ytimg.com/vi/${song.videoId}/hq720.jpg`;
                      } else if (!img.src.includes('sddefault.jpg')) {
                        img.src = `https://i.ytimg.com/vi/${song.videoId}/sddefault.jpg`;
                      } else if (!img.src.includes('mqdefault.jpg')) {
                        img.src = `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`;
                      } else if (!img.src.includes('hqdefault.jpg')) {
                        img.src = `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`;
                      }
                    }}
                    className="w-full h-full object-cover object-center block group-hover:scale-105 transition-transform duration-500"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'center',
                    }}
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                  </div>
                </div>
                <div className="mt-1.5 text-left min-w-0">
                  <h4
                    style={{
                      color: isCurrent ? activePalette.accent : activePalette.textPrimary,
                    }}
                    className="text-[11px] font-bold truncate leading-tight"
                  >
                    {song.title}
                  </h4>
                  <p
                    style={{ color: activePalette.textSecondary }}
                    className="text-[9px] truncate mt-0.5"
                  >
                    {song.artist}
                  </p>
                  <p
                    style={{ color: activePalette.accent }}
                    className="text-[8px] font-semibold mt-0.5 truncate"
                  >
                    {song.tag}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* =========================================================================
          6. SIMILAR TO YOUR FAVORITES
         ========================================================================= */}
      <section className="w-full space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Headphones className="w-3.5 h-3.5 text-indigo-400" />
            <h2
              style={{ color: activePalette.textPrimary }}
              className="text-sm font-extrabold tracking-tight"
            >
              Similar to Your Favorites
            </h2>
          </div>
          <span style={{ color: activePalette.textSecondary }} className="text-[10px]">
            Based on Activity
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filteredSimilarToFavorites.map((song) => {
            const isCurrent = currentTrack?.videoId === song.videoId;
            return (
              <div
                key={`similar-${song.videoId}`}
                onClick={() => onSelectTrack(song)}
                onMouseEnter={() => onPreCueTrack(song)}
                onTouchStart={() => onPreCueTrack(song)}
                style={{
                  backgroundColor: isCurrent ? activePalette.subBg : 'rgba(255, 255, 255, 0.02)',
                  borderColor: isCurrent ? activePalette.accent : activePalette.deckBorder,
                }}
                className="group flex items-center gap-3 p-2 rounded-2xl border transition-all duration-200 hover:border-white/20 active:scale-[0.99] cursor-pointer"
              >
                <div className="relative w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-black/40 border border-white/10">
                  <HighResThumbnailComponent
                    videoId={song.videoId}
                    rawThumbnail={song.thumbnail}
                    alt={song.title}
                    aspect="square"
                  />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p
                    style={{
                      color: isCurrent ? activePalette.accent : activePalette.textPrimary,
                    }}
                    className="text-xs font-bold truncate leading-tight group-hover:text-white"
                  >
                    {song.title}
                  </p>
                  <p
                    style={{ color: activePalette.textSecondary }}
                    className="text-[10px] truncate mt-0.5"
                  >
                    {song.artist}
                  </p>
                  <p
                    style={{ color: activePalette.textSecondary }}
                    className="text-[9px] truncate opacity-70 mt-0.5"
                  >
                    {song.referenceArtist}
                  </p>
                </div>
                <div className="p-2 rounded-full text-white/50 group-hover:text-white">
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* =========================================================================
          7. HIDDEN GEMS (Underrated Songs & Indie Treasures)
         ========================================================================= */}
      <section className="w-full space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <h2
              style={{ color: activePalette.textPrimary }}
              className="text-sm font-extrabold tracking-tight"
            >
              Hidden Gems
            </h2>
          </div>
          <span style={{ color: activePalette.textSecondary }} className="text-[10px]">
            Underrated Music
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filteredHiddenGems.map((song) => {
            const isCurrent = currentTrack?.videoId === song.videoId;
            return (
              <div
                key={`gem-${song.videoId}`}
                onClick={() => onSelectTrack(song)}
                onMouseEnter={() => onPreCueTrack(song)}
                onTouchStart={() => onPreCueTrack(song)}
                style={{
                  backgroundColor: isCurrent ? activePalette.subBg : 'rgba(255, 255, 255, 0.02)',
                  borderColor: isCurrent ? activePalette.accent : activePalette.deckBorder,
                }}
                className="group flex items-center gap-3 p-2 rounded-2xl border transition-all duration-200 hover:border-white/20 active:scale-[0.99] cursor-pointer"
              >
                <div className="relative w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-black/40 border border-white/10">
                  <HighResThumbnailComponent
                    videoId={song.videoId}
                    rawThumbnail={song.thumbnail}
                    alt={song.title}
                    aspect="square"
                  />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p
                    style={{
                      color: isCurrent ? activePalette.accent : activePalette.textPrimary,
                    }}
                    className="text-xs font-bold truncate leading-tight group-hover:text-white"
                  >
                    {song.title}
                  </p>
                  <p
                    style={{ color: activePalette.textSecondary }}
                    className="text-[10px] truncate mt-0.5"
                  >
                    {song.artist}
                  </p>
                  <p
                    style={{ color: activePalette.textSecondary }}
                    className="text-[9px] truncate opacity-80 mt-0.5 text-cyan-300"
                  >
                    {song.gemFact}
                  </p>
                </div>
                <Play className="w-4 h-4 text-white/50 group-hover:text-white shrink-0 mr-1" />
              </div>
            );
          })}
        </div>
      </section>

      {/* =========================================================================
          8. NEW ARTISTS (Emerging Voices)
         ========================================================================= */}
      <section className="w-full space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Disc3 className="w-3.5 h-3.5 text-rose-400" />
            <h2
              style={{ color: activePalette.textPrimary }}
              className="text-sm font-extrabold tracking-tight"
            >
              New Artists Spotlight
            </h2>
          </div>
          <span style={{ color: activePalette.textSecondary }} className="text-[10px]">
            Emerging Talent
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {filteredNewArtists.map((song) => {
            const isCurrent = currentTrack?.videoId === song.videoId;
            return (
              <div
                key={`new-artist-${song.videoId}`}
                onClick={() => onSelectTrack(song)}
                onMouseEnter={() => onPreCueTrack(song)}
                onTouchStart={() => onPreCueTrack(song)}
                style={{
                  backgroundColor: isCurrent ? activePalette.subBg : 'rgba(255, 255, 255, 0.02)',
                  borderColor: isCurrent ? activePalette.accent : activePalette.deckBorder,
                }}
                className="group p-2 rounded-2xl border transition-all duration-200 hover:border-white/20 active:scale-[0.98] cursor-pointer text-center"
              >
                <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full mx-auto overflow-hidden bg-black/40 border border-white/10 shrink-0">
                  <HighResThumbnailComponent
                    videoId={song.videoId}
                    rawThumbnail={song.thumbnail}
                    alt={song.artist}
                    aspect="square"
                    className="group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <h4
                  style={{
                    color: isCurrent ? activePalette.accent : activePalette.textPrimary,
                  }}
                  className="text-xs font-bold truncate mt-2 leading-tight"
                >
                  {song.artist}
                </h4>
                <p
                  style={{ color: activePalette.textSecondary }}
                  className="text-[9px] truncate mt-0.5 text-rose-300"
                >
                  {song.spotlight}
                </p>
                <p
                  style={{ color: activePalette.textSecondary }}
                  className="text-[8px] truncate mt-0.5 opacity-70"
                >
                  Track: {song.title}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* =========================================================================
          9. RECENTLY PLAYED (Listening History Scroll)
         ========================================================================= */}
      {recentPlayedTracks.length > 0 && (
        <section className="w-full space-y-2 shrink-0 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Headphones className="w-3.5 h-3.5" style={{ color: activePalette.accent }} />
              <h2
                style={{ color: activePalette.textPrimary }}
                className="text-xs font-bold uppercase tracking-wider"
              >
                Recently Played History
              </h2>
            </div>
            <span style={{ color: activePalette.textSecondary }} className="text-[9px]">
              Swipe to explore
            </span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 w-full max-w-full">
            {recentPlayedTracks.map((song) => {
              const isCurrent = currentTrack?.videoId === song.videoId;
              return (
                <button
                  key={`discovery-recent-${song.videoId}`}
                  type="button"
                  onClick={() => onSelectTrack(song)}
                  onMouseEnter={() => onPreCueTrack(song)}
                  onTouchStart={() => onPreCueTrack(song)}
                  style={{
                    backgroundColor: isCurrent ? activePalette.subBg : 'transparent',
                    borderColor: isCurrent ? activePalette.accent : activePalette.deckBorder,
                  }}
                  className="flex items-center gap-2 p-1.5 rounded-2xl border shrink-0 max-w-[160px] active:scale-95 transition-all cursor-pointer group hover:border-white/20"
                >
                  <div className="relative w-8 h-8 rounded-xl overflow-hidden shrink-0 bg-black/40 border border-white/10">
                    <HighResThumbnailComponent
                      videoId={song.videoId}
                      rawThumbnail={song.thumbnail}
                      alt={song.title}
                      aspect="square"
                    />
                  </div>
                  <div className="min-w-0 text-left">
                    <p
                      style={{
                        color: isCurrent ? activePalette.accent : activePalette.textPrimary,
                      }}
                      className="text-[10px] font-bold truncate max-w-[100px]"
                    >
                      {song.title}
                    </p>
                    <p
                      style={{ color: activePalette.textSecondary }}
                      className="text-[8px] truncate max-w-[100px]"
                    >
                      {song.artist}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
