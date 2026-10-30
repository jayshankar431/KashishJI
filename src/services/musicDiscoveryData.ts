import { YouTubeTrack, searchYouTubeSongs, normalizeSquareThumbnail } from './youtubeSearch';

export interface GenreMood {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

export const GENRE_MOODS: GenreMood[] = [
  { id: 'all', name: 'All Melodies', emoji: '✨', color: '#b8236d' },
  { id: 'romantic', name: 'Romantic', emoji: '💖', color: '#ec4899' },
  { id: 'sad', name: 'Sad & Soulful', emoji: '🌧️', color: '#64748b' },
  { id: 'happy', name: 'Happy Vibes', emoji: '☀️', color: '#eab308' },
  { id: 'chill', name: 'Chill', emoji: '🌊', color: '#0ea5e9' },
  { id: 'lofi', name: 'Lo-Fi', emoji: '🌙', color: '#8b5cf6' },
  { id: 'energetic', name: 'Energetic', emoji: '🔥', color: '#ef4444' },
  { id: 'workout', name: 'Workout', emoji: '⚡', color: '#6366f1' },
  { id: 'acoustic', name: 'Acoustic', emoji: '☕', color: '#f97316' },
  { id: 'sufi', name: 'Sufi', emoji: '🕊️', color: '#10b981' },
  { id: 'bollywood', name: 'Bollywood', emoji: '🎬', color: '#f59e0b' },
  { id: 'punjabi', name: 'Punjabi', emoji: '🥁', color: '#dc2626' },
  { id: 'indie', name: 'Indie Pop', emoji: '🎸', color: '#06b6d4' },
];

export const RELATED_MOOD_CHIPS: GenreMood[] = [
  { id: 'context', name: 'Match Current Song', emoji: '🎯', color: '#b8236d' },
  { id: 'romantic', name: 'Romantic', emoji: '💖', color: '#ec4899' },
  { id: 'sad', name: 'Sad', emoji: '🌧️', color: '#64748b' },
  { id: 'happy', name: 'Happy', emoji: '☀️', color: '#eab308' },
  { id: 'chill', name: 'Chill', emoji: '🌊', color: '#0ea5e9' },
  { id: 'lofi', name: 'Lo-Fi', emoji: '🌙', color: '#8b5cf6' },
  { id: 'energetic', name: 'Energetic', emoji: '🔥', color: '#ef4444' },
  { id: 'workout', name: 'Workout', emoji: '⚡', color: '#6366f1' },
  { id: 'acoustic', name: 'Acoustic', emoji: '☕', color: '#f97316' },
  { id: 'sufi', name: 'Sufi', emoji: '🕊️', color: '#10b981' },
];

export interface DailyMix {
  id: string;
  title: string;
  subtitle: string;
  gradient: string;
  tracks: YouTubeTrack[];
}

/**
 * Single Source of Truth — Canonical Verified Track Registry.
 * Every track below has been verified against YouTube InnerTube + oEmbed for:
 * 1) Exact videoId <-> Song Title & Artist match
 * 2) High-resolution thumbnail availability at https://i.ytimg.com/vi/{videoId}/...
 * 3) Embeddable playback support in YouTube IFrame Player
 */
export const CANONICAL_DISCOVERY_CATALOG = {
  apnaBanaLe: {
    videoId: 'UEvOsQBu1jY',
    title: 'Apna Bana Le',
    artist: 'Arijit Singh, Sachin-Jigar',
    album: 'Bhediya',
    thumbnail: 'https://i.ytimg.com/vi/UEvOsQBu1jY/maxresdefault.jpg',
    durationText: '3:25',
    durationSeconds: 205,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  kesariya: {
    videoId: 'BddP6PYo2gs',
    title: 'Kesariya',
    artist: 'Arijit Singh, Pritam',
    album: 'Brahmāstra',
    thumbnail: 'https://i.ytimg.com/vi/BddP6PYo2gs/maxresdefault.jpg',
    durationText: '2:53',
    durationSeconds: 173,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  tumHiHo: {
    videoId: 'Umqb9KENgmk',
    title: 'Tum Hi Ho',
    artist: 'Arijit Singh, Mithoon',
    album: 'Aashiqui 2',
    thumbnail: 'https://i.ytimg.com/vi/Umqb9KENgmk/maxresdefault.jpg',
    durationText: '4:28',
    durationSeconds: 268,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  lover: {
    videoId: 'mH_LFkWxpI0',
    title: 'Lover',
    artist: 'Diljit Dosanjh',
    album: 'MoonChild Era',
    thumbnail: 'https://i.ytimg.com/vi/mH_LFkWxpI0/maxresdefault.jpg',
    durationText: '3:08',
    durationSeconds: 188,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  chaleya: {
    videoId: 'VAdGW7QDJiU',
    title: 'Chaleya',
    artist: 'Arijit Singh, Shilpa Rao',
    album: 'Jawan',
    thumbnail: 'https://i.ytimg.com/vi/VAdGW7QDJiU/maxresdefault.jpg',
    durationText: '3:08',
    durationSeconds: 188,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  heeriye: {
    videoId: 'RLzC55ai0eo',
    title: 'Heeriye',
    artist: 'Jasleen Royal, Arijit Singh',
    album: 'Heeriye',
    thumbnail: 'https://i.ytimg.com/vi/RLzC55ai0eo/maxresdefault.jpg',
    durationText: '3:19',
    durationSeconds: 199,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  raataanLambiyan: {
    videoId: 'orYf6VDtj_k',
    title: 'Raataan Lambiyan',
    artist: 'Jubin Nautiyal, Asees Kaur',
    album: 'Shershaah',
    thumbnail: 'https://i.ytimg.com/vi/orYf6VDtj_k/maxresdefault.jpg',
    durationText: '3:54',
    durationSeconds: 234,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  pehleBhiMain: {
    videoId: 'iAIBF2ngbWY',
    title: 'Pehle Bhi Main',
    artist: 'Vishal Mishra, Raj Shekhar',
    album: 'Animal',
    thumbnail: 'https://i.ytimg.com/vi/iAIBF2ngbWY/maxresdefault.jpg',
    durationText: '4:09',
    durationSeconds: 249,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  satranga: {
    videoId: 'HrnrqYxYrbk',
    title: 'Satranga',
    artist: 'Arijit Singh, Shreyas Puranik',
    album: 'Animal',
    thumbnail: 'https://i.ytimg.com/vi/HrnrqYxYrbk/maxresdefault.jpg',
    durationText: '4:33',
    durationSeconds: 273,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  oMaahi: {
    videoId: 'Etkd-07gnxM',
    title: 'O Maahi',
    artist: 'Arijit Singh, Pritam',
    album: 'Dunki',
    thumbnail: 'https://i.ytimg.com/vi/Etkd-07gnxM/maxresdefault.jpg',
    durationText: '4:06',
    durationSeconds: 246,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  agarTumSaathHo: {
    videoId: 'sK7riqg2mr4',
    title: 'Agar Tum Saath Ho',
    artist: 'Alka Yagnik, Arijit Singh',
    album: 'Tamasha',
    thumbnail: 'https://i.ytimg.com/vi/sK7riqg2mr4/maxresdefault.jpg',
    durationText: '5:42',
    durationSeconds: 342,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  tereHawaale: {
    videoId: 'KUpwupYj_tY',
    title: 'Tere Hawaale',
    artist: 'Arijit Singh, Shilpa Rao',
    album: 'Laal Singh Chaddha',
    thumbnail: 'https://i.ytimg.com/vi/KUpwupYj_tY/maxresdefault.jpg',
    durationText: '5:31',
    durationSeconds: 331,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  sajni: {
    videoId: 'k3g_WjLCsXM',
    title: 'Sajni',
    artist: 'Arijit Singh, Ram Sampath',
    album: 'Laapataa Ladies',
    thumbnail: 'https://i.ytimg.com/vi/k3g_WjLCsXM/maxresdefault.jpg',
    durationText: '2:26',
    durationSeconds: 146,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  kabira: {
    videoId: 'jHNNMj5bNQw',
    title: 'Kabira',
    artist: 'Tochi Raina, Rekha Bhardwaj',
    album: 'Yeh Jawaani Hai Deewani',
    thumbnail: 'https://i.ytimg.com/vi/jHNNMj5bNQw/maxresdefault.jpg',
    durationText: '4:12',
    durationSeconds: 252,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  shayad: {
    videoId: 'MJyKN-8UncM',
    title: 'Shayad',
    artist: 'Arijit Singh, Pritam',
    album: 'Love Aaj Kal',
    thumbnail: 'https://i.ytimg.com/vi/MJyKN-8UncM/maxresdefault.jpg',
    durationText: '3:10',
    durationSeconds: 190,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  bornToShine: {
    videoId: 'dCmp56tSSmA',
    title: 'Born to Shine',
    artist: 'Diljit Dosanjh',
    album: 'G.O.A.T.',
    thumbnail: 'https://i.ytimg.com/vi/dCmp56tSSmA/maxresdefault.jpg',
    durationText: '3:38',
    durationSeconds: 218,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  bars52: {
    videoId: '4DfVxVeqk2o',
    title: '52 Bars',
    artist: 'Karan Aujla, Ikky',
    album: 'Four You',
    thumbnail: 'https://i.ytimg.com/vi/4DfVxVeqk2o/maxresdefault.jpg',
    durationText: '3:42',
    durationSeconds: 222,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  softly: {
    videoId: 'cWMxCE2HTag',
    title: 'Softly',
    artist: 'Karan Aujla, Ikky',
    album: 'Making Memories',
    thumbnail: 'https://i.ytimg.com/vi/cWMxCE2HTag/maxresdefault.jpg',
    durationText: '2:51',
    durationSeconds: 171,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  husn: {
    videoId: 'gJLVTKhTnog',
    title: 'Husn',
    artist: 'Anuv Jain',
    album: 'Husn Single',
    thumbnail: 'https://i.ytimg.com/vi/gJLVTKhTnog/maxresdefault.jpg',
    durationText: '4:00',
    durationSeconds: 240,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  baarishein: {
    videoId: 'PJWemSzExXs',
    title: 'Baarishein',
    artist: 'Anuv Jain',
    album: 'Baarishein Single',
    thumbnail: 'https://i.ytimg.com/vi/PJWemSzExXs/maxresdefault.jpg',
    durationText: '3:28',
    durationSeconds: 208,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  alagAasmaan: {
    videoId: 'vA86QFrXoho',
    title: 'Alag Aasmaan',
    artist: 'Anuv Jain',
    album: 'Alag Aasmaan Single',
    thumbnail: 'https://i.ytimg.com/vi/vA86QFrXoho/maxresdefault.jpg',
    durationText: '3:46',
    durationSeconds: 226,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  gul: {
    videoId: 'SmaY7RfBgas',
    title: 'Gul',
    artist: 'Anuv Jain',
    album: 'Gul Single',
    thumbnail: 'https://i.ytimg.com/vi/SmaY7RfBgas/maxresdefault.jpg',
    durationText: '3:45',
    durationSeconds: 225,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  kasoor: {
    videoId: 'BmUe3-sfr7E',
    title: 'Kasoor',
    artist: 'Prateek Kuhad',
    album: 'Shehron Ke Raaz',
    thumbnail: 'https://i.ytimg.com/vi/BmUe3-sfr7E/maxresdefault.jpg',
    durationText: '3:30',
    durationSeconds: 210,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  coldMess: {
    videoId: 'Il7Nv270zNk',
    title: 'cold/mess',
    artist: 'Prateek Kuhad',
    album: 'cold/mess',
    thumbnail: 'https://i.ytimg.com/vi/Il7Nv270zNk/maxresdefault.jpg',
    durationText: '6:08',
    durationSeconds: 368,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  chooLo: {
    videoId: 'sFMRqxCexDk',
    title: 'Choo Lo',
    artist: 'The Local Train',
    album: 'Aalas Ka Pedh',
    thumbnail: 'https://i.ytimg.com/vi/sFMRqxCexDk/maxresdefault.jpg',
    durationText: '3:54',
    durationSeconds: 234,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  aaogeTumKabhi: {
    videoId: 'i96UO8-GFvw',
    title: 'Aaoge Tum Kabhi',
    artist: 'The Local Train',
    album: 'Aalas Ka Pedh',
    thumbnail: 'https://i.ytimg.com/vi/i96UO8-GFvw/maxresdefault.jpg',
    durationText: '4:25',
    durationSeconds: 265,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  kunFayaKun: {
    videoId: 'T94PHkuydcw',
    title: 'Kun Faya Kun',
    artist: 'A.R. Rahman, Javed Ali, Mohit Chauhan',
    album: 'Rockstar',
    thumbnail: 'https://i.ytimg.com/vi/T94PHkuydcw/maxresdefault.jpg',
    durationText: '6:21',
    durationSeconds: 381,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  raanjhanaa: {
    videoId: 'vgm1u2gPxzw',
    title: 'Raanjhanaa',
    artist: 'Jaswinder Singh, Shiraz Uppal, A.R. Rahman',
    album: 'Raanjhanaa',
    thumbnail: 'https://i.ytimg.com/vi/vgm1u2gPxzw/maxresdefault.jpg',
    durationText: '3:10',
    durationSeconds: 190,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  afreenAfreen: {
    videoId: 'kw4tT7SCmaY',
    title: 'Afreen Afreen',
    artist: 'Rahat Fateh Ali Khan, Momina Mustehsan',
    album: 'Coke Studio 9',
    thumbnail: 'https://i.ytimg.com/vi/kw4tT7SCmaY/maxresdefault.jpg',
    durationText: '6:45',
    durationSeconds: 405,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  pasoori: {
    videoId: '5Eqb_-j3FDA',
    title: 'Pasoori',
    artist: 'Ali Sethi, Shae Gill',
    album: 'Coke Studio 14',
    thumbnail: 'https://i.ytimg.com/vi/5Eqb_-j3FDA/maxresdefault.jpg',
    durationText: '4:37',
    durationSeconds: 277,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  kahaniSuno: {
    videoId: 'KgdBrGHviv4',
    title: 'Kahani Suno 2.0',
    artist: 'Kaifi Khalil',
    album: 'Kahani Suno',
    thumbnail: 'https://i.ytimg.com/vi/KgdBrGHviv4/maxresdefault.jpg',
    durationText: '2:52',
    durationSeconds: 172,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  faasle: {
    videoId: 'EiiOYwqk3A0',
    title: 'Faasle',
    artist: 'Aditya Rikhari',
    album: 'Faasle Single',
    thumbnail: 'https://i.ytimg.com/vi/EiiOYwqk3A0/maxresdefault.jpg',
    durationText: '3:37',
    durationSeconds: 217,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  iraaday: {
    videoId: 'Qwm6BSGrOq0',
    title: 'Iraaday',
    artist: 'Abdul Hannan, Rovalio',
    album: 'Iraaday Single',
    thumbnail: 'https://i.ytimg.com/vi/Qwm6BSGrOq0/maxresdefault.jpg',
    durationText: '2:14',
    durationSeconds: 134,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  nadaanParinde: {
    videoId: '6MgsHSAcI9k',
    title: 'Nadaan Parinde',
    artist: 'A.R. Rahman, Mohit Chauhan',
    album: 'Rockstar',
    thumbnail: 'https://i.ytimg.com/vi/6MgsHSAcI9k/maxresdefault.jpg',
    durationText: '6:42',
    durationSeconds: 402,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  zinda: {
    videoId: 'Ax0G_P2dSBw',
    title: 'Zinda',
    artist: 'Siddharth Mahadevan, Shankar-Ehsaan-Loy',
    album: 'Bhaag Milkha Bhaag',
    thumbnail: 'https://i.ytimg.com/vi/Ax0G_P2dSBw/maxresdefault.jpg',
    durationText: '3:30',
    durationSeconds: 210,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
  karHarMaidaanFateh: {
    videoId: '9iIX4PBplAY',
    title: 'Kar Har Maidaan Fateh',
    artist: 'Sukhwinder Singh, Shreya Ghoshal',
    album: 'Sanju',
    thumbnail: 'https://i.ytimg.com/vi/9iIX4PBplAY/maxresdefault.jpg',
    durationText: '3:32',
    durationSeconds: 212,
    mediaType: 'song' as const,
    catalogSource: 'youtube_music' as const,
  },
} satisfies Record<string, YouTubeTrack>;

export const CANONICAL_TRACKS_BY_ID: ReadonlyMap<string, YouTubeTrack> = new Map(
  Object.values(CANONICAL_DISCOVERY_CATALOG).map((track) => [track.videoId, track])
);

/**
 * Ensures any track referencing a canonical videoId always carries its exact verified
 * title, artist, album, duration, and thumbnail URL.
 */
export function resolveCanonicalTrack<T extends YouTubeTrack>(track: T): T {
  const canonical = CANONICAL_TRACKS_BY_ID.get(track.videoId);
  if (!canonical) return track;
  return {
    ...track,
    videoId: canonical.videoId,
    title: canonical.title,
    artist: canonical.artist,
    album: canonical.album,
    thumbnail: canonical.thumbnail,
    durationText: canonical.durationText,
    durationSeconds: canonical.durationSeconds,
  };
}

export interface DiscoveryTrackItem extends YouTubeTrack {
  genreId: string;
  secondaryGenres?: string[];
}

export const QUICK_PICKS_TRACKS: (DiscoveryTrackItem & { vibe: string })[] = [
  {
    ...CANONICAL_DISCOVERY_CATALOG.apnaBanaLe,
    genreId: 'romantic',
    secondaryGenres: ['bollywood', 'acoustic', 'chill'],
    vibe: 'Soulful & Melodic',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.kesariya,
    genreId: 'romantic',
    secondaryGenres: ['bollywood', 'happy'],
    vibe: 'Pure Romance',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.chaleya,
    genreId: 'bollywood',
    secondaryGenres: ['romantic', 'happy', 'energetic'],
    vibe: 'Chartbuster Groove',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.lover,
    genreId: 'punjabi',
    secondaryGenres: ['energetic', 'happy', 'workout'],
    vibe: 'Upbeat Urban Punjabi',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.heeriye,
    genreId: 'romantic',
    secondaryGenres: ['indie', 'lofi', 'happy', 'chill'],
    vibe: 'Dreamy Pop Melody',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.husn,
    genreId: 'indie',
    secondaryGenres: ['acoustic', 'lofi', 'sad', 'chill'],
    vibe: 'Acoustic Poetry',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.pasoori,
    genreId: 'sufi',
    secondaryGenres: ['indie', 'punjabi', 'energetic'],
    vibe: 'Global Fusion Anthem',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.zinda,
    genreId: 'workout',
    secondaryGenres: ['bollywood', 'energetic'],
    vibe: 'High-Octane Energy',
  },
];

export const MADE_FOR_YOU_TRACKS: (DiscoveryTrackItem & { reason: string })[] = [
  {
    ...CANONICAL_DISCOVERY_CATALOG.satranga,
    genreId: 'romantic',
    secondaryGenres: ['bollywood', 'sad'],
    reason: 'Matches your romantic Bollywood favorites',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.oMaahi,
    genreId: 'bollywood',
    secondaryGenres: ['romantic', 'sufi', 'happy'],
    reason: 'Inspired by your recent Arijit Singh sessions',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.softly,
    genreId: 'punjabi',
    secondaryGenres: ['energetic', 'chill', 'happy'],
    reason: 'Trending Punjabi vibe in your queue',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.kasoor,
    genreId: 'acoustic',
    secondaryGenres: ['indie', 'lofi', 'chill', 'happy'],
    reason: 'Warm acoustic storytelling for your mood',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.raanjhanaa,
    genreId: 'sufi',
    secondaryGenres: ['bollywood', 'romantic'],
    reason: 'Soulful A.R. Rahman classic for your evening',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.coldMess,
    genreId: 'indie',
    secondaryGenres: ['acoustic', 'lofi', 'sad', 'chill'],
    reason: 'Indie ballad loved by listeners like you',
  },
];

export const DISCOVER_WEEKLY_TRACKS: (DiscoveryTrackItem & { tag: string })[] = [
  {
    ...CANONICAL_DISCOVERY_CATALOG.pehleBhiMain,
    genreId: 'bollywood',
    secondaryGenres: ['romantic', 'lofi', 'sad'],
    tag: 'Weekly Feature',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.sajni,
    genreId: 'romantic',
    secondaryGenres: ['bollywood', 'acoustic', 'chill'],
    tag: 'Fresh Melody',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.bars52,
    genreId: 'punjabi',
    secondaryGenres: ['workout', 'energetic'],
    tag: 'Power Anthem',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.iraaday,
    genreId: 'lofi',
    secondaryGenres: ['indie', 'romantic', 'chill'],
    tag: 'Late Night Chill',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.afreenAfreen,
    genreId: 'sufi',
    secondaryGenres: ['acoustic', 'romantic'],
    tag: 'Timeless Harmony',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.karHarMaidaanFateh,
    genreId: 'workout',
    secondaryGenres: ['bollywood', 'energetic'],
    tag: 'Peak Motivation',
  },
];

export const SIMILAR_TO_FAVORITES_TRACKS: (DiscoveryTrackItem & { referenceArtist: string })[] = [
  {
    ...CANONICAL_DISCOVERY_CATALOG.tumHiHo,
    genreId: 'romantic',
    secondaryGenres: ['bollywood', 'sad'],
    referenceArtist: 'Because you listened to Arijit Singh',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.shayad,
    genreId: 'bollywood',
    secondaryGenres: ['romantic', 'lofi', 'chill', 'happy'],
    referenceArtist: 'Because you love Romantic Bollywood',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.bornToShine,
    genreId: 'punjabi',
    secondaryGenres: ['workout', 'energetic', 'happy'],
    referenceArtist: 'Because you played Diljit Dosanjh',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.raataanLambiyan,
    genreId: 'romantic',
    secondaryGenres: ['bollywood', 'acoustic', 'happy'],
    referenceArtist: 'Because you enjoy soulful duets',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.agarTumSaathHo,
    genreId: 'sad',
    secondaryGenres: ['bollywood', 'romantic', 'acoustic'],
    referenceArtist: 'Because you love emotional classics',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.tereHawaale,
    genreId: 'romantic',
    secondaryGenres: ['bollywood', 'sufi', 'chill'],
    referenceArtist: 'Because you saved heartfelt melodies',
  },
];

export const HIDDEN_GEMS_TRACKS: (DiscoveryTrackItem & { gemFact: string })[] = [
  {
    ...CANONICAL_DISCOVERY_CATALOG.baarishein,
    genreId: 'indie',
    secondaryGenres: ['acoustic', 'lofi', 'sad', 'chill'],
    gemFact: 'Indie gem with heartfelt acoustic vocals',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.alagAasmaan,
    genreId: 'acoustic',
    secondaryGenres: ['indie', 'lofi', 'chill'],
    gemFact: 'Intimate ukulele poetry for quiet evenings',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.kunFayaKun,
    genreId: 'sufi',
    secondaryGenres: ['bollywood', 'chill'],
    gemFact: 'Timeless spiritual journey & divine tranquility',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.chooLo,
    genreId: 'indie',
    secondaryGenres: ['acoustic', 'sad'],
    gemFact: 'India’s most celebrated indie rock anthem',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.kabira,
    genreId: 'sufi',
    secondaryGenres: ['bollywood', 'acoustic', 'sad'],
    gemFact: 'Rustic folk warmth & soulful nostalgia',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.nadaanParinde,
    genreId: 'workout',
    secondaryGenres: ['sufi', 'bollywood', 'energetic'],
    gemFact: 'Soaring rock crescendo by A.R. Rahman',
  },
];

export const NEW_ARTISTS_TRACKS: (DiscoveryTrackItem & { spotlight: string })[] = [
  {
    ...CANONICAL_DISCOVERY_CATALOG.gul,
    genreId: 'indie',
    secondaryGenres: ['acoustic', 'lofi', 'chill'],
    spotlight: 'Rising Singer-Songwriter',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.kahaniSuno,
    genreId: 'sufi',
    secondaryGenres: ['romantic', 'lofi', 'sad'],
    spotlight: 'Soulful Indie Sensation',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.faasle,
    genreId: 'lofi',
    secondaryGenres: ['romantic', 'indie', 'acoustic', 'sad', 'chill'],
    spotlight: 'New Melodic Voice',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.aaogeTumKabhi,
    genreId: 'indie',
    secondaryGenres: ['acoustic', 'energetic'],
    spotlight: 'Indie Rock Pioneers',
  },
];

export const DAILY_MIXES: DailyMix[] = [
  {
    id: 'mix-1',
    title: 'Daily Mix 1',
    subtitle: 'Romantic & Bollywood Melodies',
    gradient: 'from-pink-600/80 via-purple-700/70 to-indigo-950/90',
    tracks: [
      CANONICAL_DISCOVERY_CATALOG.apnaBanaLe,
      CANONICAL_DISCOVERY_CATALOG.kesariya,
      CANONICAL_DISCOVERY_CATALOG.satranga,
      CANONICAL_DISCOVERY_CATALOG.tumHiHo,
      CANONICAL_DISCOVERY_CATALOG.raataanLambiyan,
    ],
  },
  {
    id: 'mix-2',
    title: 'Daily Mix 2',
    subtitle: 'Punjabi Vibe & High-Octane Energy',
    gradient: 'from-amber-600/80 via-red-600/70 to-slate-950/90',
    tracks: [
      CANONICAL_DISCOVERY_CATALOG.lover,
      CANONICAL_DISCOVERY_CATALOG.softly,
      CANONICAL_DISCOVERY_CATALOG.bornToShine,
      CANONICAL_DISCOVERY_CATALOG.bars52,
      CANONICAL_DISCOVERY_CATALOG.zinda,
    ],
  },
  {
    id: 'mix-3',
    title: 'Daily Mix 3',
    subtitle: 'Sufi Soul, Indie & Lo-Fi Midnight',
    gradient: 'from-emerald-600/80 via-teal-700/70 to-neutral-950/90',
    tracks: [
      CANONICAL_DISCOVERY_CATALOG.kunFayaKun,
      CANONICAL_DISCOVERY_CATALOG.husn,
      CANONICAL_DISCOVERY_CATALOG.kasoor,
      CANONICAL_DISCOVERY_CATALOG.pasoori,
      CANONICAL_DISCOVERY_CATALOG.iraaday,
    ],
  },
];

/**
 * Deduplicated ordered list of all Discovery tracks for unified playback queue navigation.
 */
export const ALL_DISCOVERY_TRACKS: YouTubeTrack[] = (() => {
  const seen = new Set<string>();
  const list: YouTubeTrack[] = [];
  const allPools: YouTubeTrack[] = [
    ...QUICK_PICKS_TRACKS,
    ...MADE_FOR_YOU_TRACKS,
    ...DISCOVER_WEEKLY_TRACKS,
    ...SIMILAR_TO_FAVORITES_TRACKS,
    ...HIDDEN_GEMS_TRACKS,
    ...NEW_ARTISTS_TRACKS,
  ];
  for (const item of allPools) {
    if (!seen.has(item.videoId)) {
      seen.add(item.videoId);
      list.push(resolveCanonicalTrack(item));
    }
  }
  return list;
})();

export function matchesDiscoveryGenre(item: DiscoveryTrackItem, selectedGenreId: string): boolean {
  if (selectedGenreId === 'all') return true;
  if (item.genreId === selectedGenreId) return true;
  return Boolean(item.secondaryGenres && item.secondaryGenres.includes(selectedGenreId));
}

const FAVORITES_KEY_PREFIX = 'kashish_music_favorites_v2_';
const FAVORITE_TRACKS_KEY_PREFIX = 'kashish_music_favorite_tracks_v1_';

export function loadUserFavorites(userId: string): Set<string> {
  if (typeof window === 'undefined' || !window.localStorage) return new Set();
  try {
    const raw = window.localStorage.getItem(`${FAVORITES_KEY_PREFIX}${userId}`);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return new Set(arr.filter((id): id is string => typeof id === 'string' && id.length > 0));
      }
    }
  } catch {}
  return new Set(['UEvOsQBu1jY', 'BddP6PYo2gs', 'Umqb9KENgmk']);
}

export function saveUserFavorites(userId: string, ids: Set<string>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      `${FAVORITES_KEY_PREFIX}${userId}`,
      JSON.stringify(Array.from(ids))
    );
  } catch {}
}

export function loadUserFavoriteTracks(userId: string): YouTubeTrack[] {
  const favIds = loadUserFavorites(userId);
  const storedMap = new Map<string, YouTubeTrack>();

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(`${FAVORITE_TRACKS_KEY_PREFIX}${userId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item.videoId === 'string' && item.videoId && item.title) {
              storedMap.set(item.videoId, resolveCanonicalTrack(item));
            }
          }
        }
      }
    } catch {}
  }

  for (const d of ALL_DISCOVERY_TRACKS) {
    if (!storedMap.has(d.videoId)) {
      storedMap.set(d.videoId, d);
    }
  }

  const result: YouTubeTrack[] = [];
  for (const id of favIds) {
    const found = storedMap.get(id);
    if (found) {
      result.push(resolveCanonicalTrack(found));
    }
  }
  return result;
}

export function saveUserFavoriteTracks(userId: string, tracks: YouTubeTrack[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const deduped: YouTubeTrack[] = [];
    const seen = new Set<string>();
    for (const t of tracks) {
      if (t && t.videoId && !seen.has(t.videoId)) {
        seen.add(t.videoId);
        deduped.push(resolveCanonicalTrack(t));
      }
    }
    window.localStorage.setItem(
      `${FAVORITE_TRACKS_KEY_PREFIX}${userId}`,
      JSON.stringify(deduped.slice(0, 200))
    );
  } catch {}
}

// ============================================================================
// PERSONALIZED USER LISTENING & TASTE PROFILE ENGINE (PHASE 4C)
// ============================================================================

export interface UserListeningProfile {
  artistPlayCounts: Record<string, number>;
  trackPlayCounts: Record<string, number>;
  skippedTrackCounts: Record<string, number>;
  genrePlayCounts: Record<string, number>;
  artistListenSeconds: Record<string, number>;
  updatedAt: number;
}

const LISTENING_PROFILE_KEY_PREFIX = 'kashish_music_taste_profile_v1_';

export function loadUserListeningProfile(userId: string = 'guest'): UserListeningProfile {
  const empty: UserListeningProfile = {
    artistPlayCounts: {},
    trackPlayCounts: {},
    skippedTrackCounts: {},
    genrePlayCounts: {},
    artistListenSeconds: {},
    updatedAt: Date.now(),
  };
  if (typeof window === 'undefined' || !window.localStorage) return empty;
  try {
    const raw = window.localStorage.getItem(`${LISTENING_PROFILE_KEY_PREFIX}${userId || 'guest'}`);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      artistPlayCounts: parsed?.artistPlayCounts || {},
      trackPlayCounts: parsed?.trackPlayCounts || {},
      skippedTrackCounts: parsed?.skippedTrackCounts || {},
      genrePlayCounts: parsed?.genrePlayCounts || {},
      artistListenSeconds: parsed?.artistListenSeconds || {},
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return empty;
  }
}

function saveUserListeningProfile(userId: string, profile: UserListeningProfile): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    profile.updatedAt = Date.now();
    window.localStorage.setItem(
      `${LISTENING_PROFILE_KEY_PREFIX}${userId || 'guest'}`,
      JSON.stringify(profile)
    );
  } catch {}
}

export function recordTrackPlayEvent(userId: string, track: YouTubeTrack): void {
  if (!track?.videoId) return;
  const profile = loadUserListeningProfile(userId);
  profile.trackPlayCounts[track.videoId] = (profile.trackPlayCounts[track.videoId] || 0) + 1;
  const artists = parseArtistNames(track.artist);
  for (const artist of artists) {
    const key = artist.toLowerCase();
    profile.artistPlayCounts[key] = (profile.artistPlayCounts[key] || 0) + 1;
  }
  const context = inferTrackMusicalContext(track);
  profile.genrePlayCounts[context.primaryGenre] =
    (profile.genrePlayCounts[context.primaryGenre] || 0) + 1;
  for (const mood of context.moods) {
    profile.genrePlayCounts[mood] = (profile.genrePlayCounts[mood] || 0) + 1;
  }
  saveUserListeningProfile(userId, profile);
}

export function recordTrackListenDuration(
  userId: string,
  track: YouTubeTrack | null,
  listenedSeconds: number
): void {
  if (!track?.videoId || !Number.isFinite(listenedSeconds) || listenedSeconds <= 0) return;
  const profile = loadUserListeningProfile(userId);
  if (listenedSeconds < 10) {
    // Switching away before 10s indicates a user skip
    profile.skippedTrackCounts[track.videoId] =
      (profile.skippedTrackCounts[track.videoId] || 0) + 1;
  } else {
    // Positive engagement: decay any previous skip count and credit artist listening time
    if (profile.skippedTrackCounts[track.videoId]) {
      profile.skippedTrackCounts[track.videoId] = Math.max(
        0,
        profile.skippedTrackCounts[track.videoId] - 1
      );
    }
    const artists = parseArtistNames(track.artist);
    for (const artist of artists) {
      const key = artist.toLowerCase();
      profile.artistListenSeconds[key] =
        (profile.artistListenSeconds[key] || 0) + Math.min(300, Math.round(listenedSeconds));
    }
  }
  saveUserListeningProfile(userId, profile);
}

// ============================================================================
// DYNAMIC "MORE LIKE THIS" RELATED SONGS ENGINE (WITH CONTINUOUS PAGINATION)
// ============================================================================

const DISCOVERY_ITEMS_BY_ID: ReadonlyMap<string, DiscoveryTrackItem> = (() => {
  const map = new Map<string, DiscoveryTrackItem>();
  const allItems: DiscoveryTrackItem[] = [
    ...QUICK_PICKS_TRACKS,
    ...MADE_FOR_YOU_TRACKS,
    ...DISCOVER_WEEKLY_TRACKS,
    ...SIMILAR_TO_FAVORITES_TRACKS,
    ...HIDDEN_GEMS_TRACKS,
    ...NEW_ARTISTS_TRACKS,
  ];
  for (const item of allItems) {
    if (!map.has(item.videoId)) {
      map.set(item.videoId, item);
    }
  }
  return map;
})();

const RELATED_ARTIST_CLUSTERS: Record<string, string[]> = {
  'arijit singh': ['Atif Aslam', 'Jubin Nautiyal', 'Vishal Mishra', 'Pritam', 'Shreya Ghoshal', 'KK', 'Sonu Nigam', 'Darshan Raval', 'Armaan Malik', 'Sachin-Jigar', 'Mithoon'],
  'diljit dosanjh': ['Karan Aujla', 'AP Dhillon', 'Amrinder Gill', 'Shubh', 'Guru Randhawa', 'Sidhu Moose Wala', 'Harrdy Sandhu', 'B Praak'],
  'karan aujla': ['Diljit Dosanjh', 'AP Dhillon', 'Shubh', 'Ikky', 'Sidhu Moose Wala', 'Prem Dhillon', 'Amrinder Gill'],
  'ap dhillon': ['Shubh', 'Karan Aujla', 'Diljit Dosanjh', 'Gurinder Gill', 'Ikky', 'Talwiinder'],
  'shubh': ['AP Dhillon', 'Karan Aujla', 'Diljit Dosanjh', 'Sidhu Moose Wala', 'Ikky'],
  'sidhu moose wala': ['Karan Aujla', 'Shubh', 'AP Dhillon', 'Diljit Dosanjh', 'Prem Dhillon', 'Ammy Virk'],
  'amrinder gill': ['Diljit Dosanjh', 'Sartaj', 'Prabh Gill', 'Ammy Virk', 'Harrdy Sandhu', 'B Praak'],
  'guru randhawa': ['Diljit Dosanjh', 'Harrdy Sandhu', 'Badshah', 'B Praak', 'Jass Manak'],
  'harrdy sandhu': ['B Praak', 'Jaani', 'Guru Randhawa', 'Diljit Dosanjh', 'Jass Manak'],
  'b praak': ['Jaani', 'Jubin Nautiyal', 'Vishal Mishra', 'Arijit Singh', 'Harrdy Sandhu', 'Ammy Virk'],
  'anuv jain': ['Prateek Kuhad', 'Aditya Rikhari', 'The Local Train', 'Abdul Hannan', 'Kaifi Khalil', 'When Chai Met Toast', 'Ritviz', 'Zaeden'],
  'prateek kuhad': ['Anuv Jain', 'The Local Train', 'Aditya Rikhari', 'When Chai Met Toast', 'Taba Chake', 'Lifafa', 'OAFF'],
  'the local train': ['Anuv Jain', 'Prateek Kuhad', 'Parvaaz', 'Agnee', 'Indian Ocean', 'Aditya Rikhari'],
  'aditya rikhari': ['Anuv Jain', 'Prateek Kuhad', 'Abdul Hannan', 'Kaifi Khalil', 'Zaeden'],
  'abdul hannan': ['Kaifi Khalil', 'Hasan Raheem', 'Ali Sethi', 'Anuv Jain', 'Aditya Rikhari'],
  'a.r. rahman': ['Mohit Chauhan', 'Javed Ali', 'Rahat Fateh Ali Khan', 'Shankar-Ehsaan-Loy', 'Amit Trivedi', 'Pritam', 'Coke Studio'],
  'vishal mishra': ['Arijit Singh', 'Jubin Nautiyal', 'Sachet Tandon', 'B Praak', 'Darshan Raval', 'Pritam'],
  'jubin nautiyal': ['Arijit Singh', 'Atif Aslam', 'Vishal Mishra', 'B Praak', 'Stebin Ben', 'Darshan Raval'],
  'kaifi khalil': ['Abdul Hannan', 'Ali Sethi', 'Atif Aslam', 'Anuv Jain', 'Aditya Rikhari', 'Hasan Raheem'],
  'ali sethi': ['Shae Gill', 'Kaifi Khalil', 'Rahat Fateh Ali Khan', 'Abida Parveen', 'Atif Aslam', 'Coke Studio'],
  'rahat fateh ali khan': ['Atif Aslam', 'Nusrat Fateh Ali Khan', 'Ali Sethi', 'A.R. Rahman', 'Javed Ali', 'Shafqat Amanat Ali'],
  'atif aslam': ['Arijit Singh', 'KK', 'Rahat Fateh Ali Khan', 'Mohit Chauhan', 'Jubin Nautiyal', 'Mustafa Zahid'],
  'kk': ['Mohit Chauhan', 'Atif Aslam', 'Arijit Singh', 'Pritam', 'Sonu Nigam', 'Shaan', 'Emraan Hashmi Hits'],
  'mohit chauhan': ['KK', 'Arijit Singh', 'Atif Aslam', 'Pritam', 'A.R. Rahman', 'Javed Ali'],
  'sonu nigam': ['Shreya Ghoshal', 'KK', 'Shaan', 'Udit Narayan', 'Arijit Singh', 'Kumar Sanu'],
  'darshan raval': ['Armaan Malik', 'Arijit Singh', 'Jubin Nautiyal', 'Vishal Mishra', 'Anuv Jain'],
  'armaan malik': ['Darshan Raval', 'Arijit Singh', 'Amaal Mallik', 'Jubin Nautiyal', 'Atif Aslam'],
  'shreya ghoshal': ['Arijit Singh', 'Sonu Nigam', 'Sunidhi Chauhan', 'Pritam', 'A.R. Rahman', 'Shilpa Rao'],
  'pritam': ['Arijit Singh', 'KK', 'Mohit Chauhan', 'Atif Aslam', 'Vishal-Shekhar', 'Amit Trivedi'],
  'sachin-jigar': ['Arijit Singh', 'Vishal Mishra', 'Pritam', 'Amit Trivedi', 'Darshan Raval'],
  'amit trivedi': ['A.R. Rahman', 'Pritam', 'Sachin-Jigar', 'Mohit Chauhan', 'Tochi Raina'],
  'mithoon': ['Arijit Singh', 'Atif Aslam', 'KK', 'Jubin Nautiyal', 'Vishal Mishra'],
  'kishore kumar': ['Mohammed Rafi', 'Lata Mangeshkar', 'R.D. Burman', 'Mukesh', 'Kumar Sanu'],
  'kumar sanu': ['Udit Narayan', 'Alka Yagnik', 'Sonu Nigam', 'Abhijeet', '90s Bollywood Hits'],
  'udit narayan': ['Alka Yagnik', 'Kumar Sanu', 'Sonu Nigam', 'Shreya Ghoshal'],
};

function parseArtistNames(artistStr: string): string[] {
  return (artistStr || '')
    .replace(/ - Topic$/i, '')
    .split(/[,&·|/]|(?:\bft\.?\b|\bfeat\.?\b)/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.toLowerCase() !== 'various artists');
}

function normalizeTrackTitleKey(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/official\s*(music\s*)?video|full\s*video|lyric\s*video|audio\s*song|full\s*song/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 28);
}

export interface InferredMusicalContext {
  primaryGenre: string;
  moods: string[];
  language: 'punjabi' | 'hindi' | 'urdu_sufi' | 'english';
}

/**
 * Analyzes any track (canonical or searched) to determine its genre, mood, and language context.
 */
export function inferTrackMusicalContext(track: YouTubeTrack): InferredMusicalContext {
  const known = DISCOVERY_ITEMS_BY_ID.get(track.videoId);
  const combined = `${track.title || ''} ${track.artist || ''} ${track.album || ''}`.toLowerCase();

  let language: 'punjabi' | 'hindi' | 'urdu_sufi' | 'english' = 'hindi';
  if (
    /\b(diljit|karan aujla|ap dhillon|shubh|sidhu moose|guru randhawa|amrinder gill|harrdy sandhu|ikky|jass manak|ammy virk|arjan dhillon|prem dhillon|gurinder gill|talwiinder|gippy grewal|parmish verma|nimrat khaira|sunanda sharma|sartaj|prabh gill|garry sandhu|mankirt|jatt|punjabi|gabru|koka|nakhra|chobbar|velly|52 bars|softly|born to shine|goat|moonchild)\b/i.test(
      combined
    )
  ) {
    language = 'punjabi';
  } else if (
    /\b(rahat fateh|ali sethi|kaifi khalil|abdul hannan|coke studio|abida parveen|nusrat|shafqat amanat|atif aslam.*coke studio|pasoori|afreen|kahani suno|iraaday|sufi|qawwali|tajdar|kun faya)\b/i.test(
      combined
    )
  ) {
    language = 'urdu_sufi';
  } else if (
    /\b(ed sheeran|taylor swift|the weeknd|justin bieber|alan walker|imagine dragons|coldplay|billie eilish|ariana grande|post malone|shawn mendes|charlie puth|dua lipa|bruno mars|maroon 5|chainsmokers|eminem|drake|adele|lady gaga|harry styles|selena gomez|sia|lana del rey|linkin park|one direction)\b/i.test(
      combined
    )
  ) {
    language = 'english';
  }

  if (known) {
    return {
      primaryGenre: known.genreId,
      moods: [known.genreId, ...(known.secondaryGenres || [])],
      language,
    };
  }

  const moods: string[] = [];
  let primaryGenre =
    language === 'punjabi'
      ? 'punjabi'
      : language === 'urdu_sufi'
        ? 'sufi'
        : language === 'english'
          ? 'chill'
          : 'romantic';

  if (/\b(lofi|lo-fi|slowed|reverb|chill|midnight|sleep|rain)\b/i.test(combined)) {
    primaryGenre = 'lofi';
    moods.push('lofi', 'chill');
  }
  if (
    /\b(sad|broken|heartbreak|judai|bewafa|rona|tanhai|agar tum saath ho|channa mereya|pehle bhi main|faasle|kahani suno|cold\/mess|hamari adhuri|bekhayali|tujhe bhula diya|bhar do jholi)\b/i.test(
      combined
    )
  ) {
    if (primaryGenre === 'romantic') primaryGenre = 'sad';
    moods.push('sad', 'romantic');
  }
  if (
    /\b(workout|gym|motivational|pump|zinda|fateh|sultan|chak de|energetic|party|dance|bhangra|club|beast|brothers anthem|dangal)\b/i.test(
      combined
    )
  ) {
    primaryGenre = 'workout';
    moods.push('workout', 'energetic', 'happy');
  }
  if (
    /\b(acoustic|unplugged|guitar|ukulele|anuv jain|prateek kuhad|local train|husn|kasoor|baarishein|alag aasmaan|gul|choo lo)\b/i.test(
      combined
    )
  ) {
    if (primaryGenre === 'romantic') primaryGenre = 'acoustic';
    moods.push('acoustic', 'indie', 'chill');
  }
  if (/\b(sufi|qawwali|kun faya|afreen|raanjhanaa|maula|allah|khuda|peer|ishq)\b/i.test(combined)) {
    if (language === 'urdu_sufi') primaryGenre = 'sufi';
    moods.push('sufi');
  }
  if (language === 'punjabi') {
    primaryGenre = 'punjabi';
    moods.push('punjabi', 'energetic', 'happy');
  }
  if (moods.length === 0) {
    moods.push('romantic', 'bollywood', 'happy');
  }

  return {
    primaryGenre,
    moods: Array.from(new Set(moods)),
    language,
  };
}

/**
 * Computes an instant (0ms) contextual list of related songs from the verified catalog
 * based on same artist, related artists, same album/movie, genre, mood, and user taste profile.
 */
export function getInstantRelatedTracks(
  seedTrack: YouTubeTrack,
  limit = 10,
  moodFilter = 'context',
  userId = 'guest'
): YouTubeTrack[] {
  const seedArtists = parseArtistNames(seedTrack.artist).map((a) => a.toLowerCase());
  const seedContext = inferTrackMusicalContext(seedTrack);
  const seedGenre =
    moodFilter && moodFilter !== 'context' && moodFilter !== 'all'
      ? moodFilter
      : seedContext.primaryGenre;
  const seedMoods = new Set(seedContext.moods);
  const seedAlbum = (seedTrack.album || '').trim().toLowerCase();
  const profile = loadUserListeningProfile(userId);
  const favorites = loadUserFavorites(userId);

  const clusterArtists = new Set<string>();
  for (const a of seedArtists) {
    const cluster = RELATED_ARTIST_CLUSTERS[a];
    if (cluster) {
      for (const rel of cluster) clusterArtists.add(rel.toLowerCase());
    }
  }

  const scored = ALL_DISCOVERY_TRACKS.filter((t) => t.videoId !== seedTrack.videoId).map((cand) => {
    let score = 0;
    const candArtists = parseArtistNames(cand.artist).map((a) => a.toLowerCase());
    const candMeta = DISCOVERY_ITEMS_BY_ID.get(cand.videoId);
    const candContext = inferTrackMusicalContext(cand);

    // If an explicit mood chip is active, strongly boost tracks matching that mood
    if (moodFilter && moodFilter !== 'context' && moodFilter !== 'all') {
      if (candMeta && matchesDiscoveryGenre(candMeta, moodFilter)) {
        score += 90;
      } else if (candContext.moods.includes(moodFilter) || candContext.primaryGenre === moodFilter) {
        score += 75;
      } else {
        score -= 40;
      }
    }

    // 1. Same language affinity (e.g. Punjabi -> Punjabi, Hindi -> Hindi)
    if (candContext.language === seedContext.language) {
      score += 45;
    } else if (seedContext.language === 'punjabi' && moodFilter === 'context') {
      score -= 35;
    }

    // 2. Same artist / co-artist
    for (const ca of candArtists) {
      if (seedArtists.some((sa) => ca.includes(sa) || sa.includes(ca))) {
        score += 60;
      } else if (clusterArtists.has(ca)) {
        score += 30;
      }
      // Personalization: Boost user's frequently played & listened artists
      const artistPlays = profile.artistPlayCounts[ca] || 0;
      const artistListenSec = profile.artistListenSeconds[ca] || 0;
      if (artistPlays > 0) score += Math.min(25, artistPlays * 5);
      if (artistListenSec > 60) score += Math.min(20, Math.floor(artistListenSec / 60) * 4);
    }

    // 3. Same album / movie soundtrack
    if (seedAlbum && cand.album && cand.album.toLowerCase() === seedAlbum) {
      score += 45;
    }

    // 4. Same primary or secondary genre & mood
    if (candMeta) {
      if (candMeta.genreId === seedGenre) score += 32;
      if (seedMoods.has(candMeta.genreId)) score += 18;
      if (candMeta.secondaryGenres) {
        for (const sg of candMeta.secondaryGenres) {
          if (sg === seedGenre) score += 22;
          if (seedMoods.has(sg)) score += 12;
        }
      }
    }

    // 5. Personalization: Boost liked songs & penalize repeatedly skipped tracks
    if (favorites.has(cand.videoId)) score += 15;
    const skips = profile.skippedTrackCounts[cand.videoId] || 0;
    if (skips > 0) score -= skips * 25;

    return { track: cand, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item) => item.track);
}

interface RelatedRecommendationCacheEntry {
  cacheKey: string;
  seedVideoId: string;
  moodFilter: string;
  tracks: YouTubeTrack[];
  seenVideoIds: Set<string>;
  seenTitleKeys: Set<string>;
  queries: string[];
  queriedSet: Set<string>;
  cursorIndex: number;
}

const MAX_RELATED_CACHE_ENTRIES = 35;
const relatedRecommendationCache = new Map<string, RelatedRecommendationCacheEntry>();

const MOOD_QUERY_MAP: Record<string, string[]> = {
  romantic: [
    'Romantic Bollywood hit songs',
    'Arijit Singh romantic love songs',
    'Soulful Hindi romantic melodies',
    'Best Bollywood love songs Pritam',
    'Shreya Ghoshal Jubin Nautiyal romantic songs',
    'Atif Aslam romantic Hindi songs',
    'Heartfelt Hindi romantic songs',
  ],
  sad: [
    'Sad emotional Bollywood songs',
    'Arijit Singh heartbreak sad songs',
    'Emotional Hindi breakup songs',
    'Soulful sad Hindi melodies',
    'B Praak Vishal Mishra emotional songs',
    'Late night sad Hindi songs',
  ],
  happy: [
    'Feel good happy Bollywood songs',
    'Upbeat Hindi melody songs',
    'Happy romantic Bollywood songs',
    'Pritam feel good Hindi songs',
    'Vibrant Punjabi & Bollywood hits',
  ],
  chill: [
    'Chill Hindi indie & Bollywood songs',
    'Relaxing soulful Hindi songs',
    'Evening chill Bollywood melodies',
    'Anuv Jain Prateek Kuhad chill songs',
    'Smooth Hindi vibe songs',
  ],
  lofi: [
    'Lo-Fi chill Hindi songs',
    'Bollywood lofi remix songs',
    'Midnight lofi Hindi melodies',
    'Slowed reverb romantic Hindi songs',
    'Peaceful Hindi lofi beats songs',
  ],
  energetic: [
    'High energy Bollywood dance & vibe songs',
    'Upbeat Punjabi chartbuster songs',
    'Energetic Hindi hit songs',
    'Diljit Dosanjh Karan Aujla upbeat songs',
    'Superhit Bollywood party anthems',
  ],
  workout: [
    'High energy Bollywood workout songs',
    'Punjabi gym motivation songs',
    'Motivational Hindi rock & workout anthems',
    'Karan Aujla Diljit Dosanjh workout hits',
    'Power packed Hindi gym songs',
  ],
  acoustic: [
    'Acoustic unplugged Hindi songs',
    'Peaceful acoustic Bollywood melodies',
    'Anuv Jain Prateek Kuhad acoustic songs',
    'Guitar unplugged romantic Hindi songs',
    'Indie acoustic Hindi songs',
  ],
  sufi: [
    'Sufi soulful Hindi & Urdu songs',
    'A.R. Rahman Sufi classic songs',
    'Coke Studio Sufi & soulful hits',
    'Rahat Fateh Ali Khan Ali Sethi songs',
    'Spiritual Sufi rock Hindi songs',
  ],
  bollywood: [
    'Latest Bollywood chartbuster songs',
    'Superhit Hindi movie songs',
    'Evergreen Bollywood melody hits',
  ],
  punjabi: [
    'Punjabi superhit songs Diljit Dosanjh Karan Aujla',
    'Urban Punjabi vibe songs AP Dhillon Shubh',
    'Trending Punjabi hit songs',
    'Amrinder Gill B Praak Punjabi songs',
  ],
  indie: [
    'Indian Indie pop songs Anuv Jain Prateek Kuhad',
    'Hindi Indie acoustic songs The Local Train',
    'Underrated Hindi indie songs Aditya Rikhari',
  ],
};

function buildInitialRelatedQueries(
  seedTrack: YouTubeTrack,
  moodFilter = 'context',
  userId = 'guest'
): string[] {
  const cleanTitle = (seedTrack.title || '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/official\s*(music\s*)?video|full\s*video|lyric\s*video/gi, '')
    .trim();
  const artists = parseArtistNames(seedTrack.artist);
  const primaryArtist = artists[0] || 'Arijit Singh';
  const secondaryArtist = artists[1] || '';
  const album = (seedTrack.album || '').replace(/Single$/i, '').trim();
  const context = inferTrackMusicalContext(seedTrack);
  const profile = loadUserListeningProfile(userId);

  const queries: string[] = [];
  const pushUnique = (q: string) => {
    const clean = q.replace(/\s+/g, ' ').trim();
    if (clean && !queries.some((existing) => existing.toLowerCase() === clean.toLowerCase())) {
      queries.push(clean);
    }
  };

  // If the user explicitly selected a specific Mood Filter chip, prioritize that mood first!
  if (moodFilter && moodFilter !== 'context' && moodFilter !== 'all') {
    const moodQueries = MOOD_QUERY_MAP[moodFilter] || [];
    pushUnique(`${primaryArtist} ${moodFilter} songs`);
    for (const mq of moodQueries) {
      pushUnique(mq);
    }
  }

  // 1. Similar to current song + primary artist (matched to language & style)
  if (context.language === 'punjabi') {
    pushUnique(`${cleanTitle} ${primaryArtist} Punjabi songs`);
    pushUnique(`${primaryArtist} top Punjabi hit songs`);
    pushUnique(`${primaryArtist} latest Punjabi songs`);
  } else if (context.language === 'english') {
    pushUnique(`${cleanTitle} ${primaryArtist} songs`);
    pushUnique(`${primaryArtist} best hit songs`);
    pushUnique(`${primaryArtist} popular tracks`);
  } else {
    pushUnique(`${cleanTitle} ${primaryArtist} songs`);
    pushUnique(`${primaryArtist} top hit songs`);
    pushUnique(`${primaryArtist} best melody songs`);
  }

  // 2. Album / movie soundtrack songs
  if (album && album.toLowerCase() !== cleanTitle.toLowerCase()) {
    pushUnique(`${album} songs ${primaryArtist}`);
  }

  // 3. Co-artist / composer songs
  if (secondaryArtist) {
    pushUnique(`${secondaryArtist} best hit songs`);
  }

  // 4. Related artists from cluster (matching current song's artist style)
  const cluster =
    RELATED_ARTIST_CLUSTERS[primaryArtist.toLowerCase()] ||
    (context.language === 'punjabi'
      ? ['Diljit Dosanjh', 'Karan Aujla', 'AP Dhillon', 'Shubh', 'Amrinder Gill', 'Guru Randhawa']
      : context.language === 'urdu_sufi'
        ? ['Atif Aslam', 'Rahat Fateh Ali Khan', 'Ali Sethi', 'Kaifi Khalil', 'A.R. Rahman']
        : context.language === 'english'
          ? [primaryArtist]
          : ['Arijit Singh', 'Jubin Nautiyal', 'Vishal Mishra', 'Atif Aslam', 'Pritam', 'Shreya Ghoshal']);

  for (const relArtist of cluster.slice(0, 5)) {
    pushUnique(`${relArtist} top songs`);
  }

  // 5. Personalized user taste queries (top listened artists from user's history)
  const topUserArtists = Object.entries(profile.artistPlayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([artist]) => artist);
  for (const favArtist of topUserArtists) {
    pushUnique(`${favArtist} best songs`);
  }

  // 6. Genre & mood specific discovery queries
  const effectiveGenre = context.primaryGenre;
  for (const gq of MOOD_QUERY_MAP[effectiveGenre] || MOOD_QUERY_MAP.romantic) {
    pushUnique(gq);
  }
  for (const relArtist of cluster.slice(5)) {
    pushUnique(`${relArtist} hit songs`);
  }

  return queries;
}

const REGIONAL_DUB_PATTERN =
  /\b(tamil|telugu|malayalam|kannada|bhojpuri|bengali|marathi|gujarati|odia|assamese)\b/i;

function isContentAwareRelatedTrack(
  candidate: YouTubeTrack,
  seedTrack: YouTubeTrack,
  _moodFilter: string
): boolean {
  if (!candidate || !candidate.videoId || !candidate.title) return false;
  if (candidate.videoId === seedTrack.videoId) return false;
  if (!candidate.artist || candidate.artist.trim().length < 2) return false;

  // Exclude ringtones/shorts (<45s) and marathon jukeboxes/compilations (>15m)
  if (
    typeof candidate.durationSeconds === 'number' &&
    candidate.durationSeconds > 0 &&
    (candidate.durationSeconds < 45 || candidate.durationSeconds > 900)
  ) {
    return false;
  }

  const seedCombined = `${seedTrack.title || ''} ${seedTrack.artist || ''} ${seedTrack.album || ''}`;
  const candCombined = `${candidate.title || ''} ${candidate.artist || ''} ${candidate.album || ''}`;

  // Prevent dubbed or unrelated regional language results unless the seed track itself is in that language
  const candRegionalMatch = candCombined.match(REGIONAL_DUB_PATTERN);
  if (candRegionalMatch && !REGIONAL_DUB_PATTERN.test(seedCombined)) {
    return false;
  }

  const seedContext = inferTrackMusicalContext(seedTrack);
  const candContext = inferTrackMusicalContext(candidate);

  if (seedContext.language === 'punjabi' && candContext.language !== 'punjabi') {
    const seedArtists = parseArtistNames(seedTrack.artist).map((a) => a.toLowerCase());
    const candArtists = parseArtistNames(candidate.artist).map((a) => a.toLowerCase());
    const hasOverlap = seedArtists.some((sa) =>
      candArtists.some((ca) => ca.includes(sa) || sa.includes(ca))
    );
    if (!hasOverlap) return false;
  }

  return true;
}

function isGenuineYouTubeMusicSong(track: YouTubeTrack): boolean {
  if (!track || !track.videoId || !track.title) return false;
  if (track.mediaType === 'video' || track.catalogSource === 'youtube_video') return false;
  // Filter out non-song uploads (Trailers, Teasers, Making Of, Full Movies, Jukeboxes, Karaoke, Ringtones)
  const nonSongPattern =
    /\b(making\s*of|trailer|teaser|jukebox|full\s*movie|dialogue\s*promo|interview|behind\s*the\s*scenes|karaoke|ringtone|whatsapp\s*status|status\s*video|reaction|review)\b/i;
  if (nonSongPattern.test(track.title)) return false;
  return true;
}

function getOrCreateRelatedEntry(
  seedTrack: YouTubeTrack,
  moodFilter = 'context',
  userId = 'guest'
): RelatedRecommendationCacheEntry {
  const normalizedMood = (moodFilter || 'context').toLowerCase();
  const cacheKey = `${seedTrack.videoId}__${normalizedMood}`;
  const existing = relatedRecommendationCache.get(cacheKey);
  if (existing) {
    relatedRecommendationCache.delete(cacheKey);
    relatedRecommendationCache.set(cacheKey, existing);
    return existing;
  }

  const seenVideoIds = new Set<string>([seedTrack.videoId]);
  const seenTitleKeys = new Set<string>();
  const seedTitleKey = normalizeTrackTitleKey(seedTrack.title);
  if (seedTitleKey) seenTitleKeys.add(seedTitleKey);

  // Immediately seed with high-affinity canonical songs so the Related Songs list is never empty (0ms instant response)
  const instantSeeds = getInstantRelatedTracks(seedTrack, 8, normalizedMood, userId);
  const initialTracks: YouTubeTrack[] = [];
  for (const t of instantSeeds) {
    if (!seenVideoIds.has(t.videoId)) {
      const tk = normalizeTrackTitleKey(t.title);
      seenVideoIds.add(t.videoId);
      if (tk) seenTitleKeys.add(tk);
      initialTracks.push({
        ...t,
        thumbnail: normalizeSquareThumbnail(t.thumbnail, t.videoId),
        mediaType: 'song',
        catalogSource: 'youtube_music',
      });
    }
  }

  const queries = buildInitialRelatedQueries(seedTrack, normalizedMood, userId);
  const entry: RelatedRecommendationCacheEntry = {
    cacheKey,
    seedVideoId: seedTrack.videoId,
    moodFilter: normalizedMood,
    tracks: initialTracks,
    seenVideoIds,
    seenTitleKeys,
    queries,
    queriedSet: new Set(queries.map((q) => q.toLowerCase())),
    cursorIndex: 0,
  };

  if (relatedRecommendationCache.size >= MAX_RELATED_CACHE_ENTRIES) {
    const oldestKey = relatedRecommendationCache.keys().next().value;
    if (oldestKey) relatedRecommendationCache.delete(oldestKey);
  }
  relatedRecommendationCache.set(cacheKey, entry);
  return entry;
}

/**
 * Returns the currently cached YouTube Music related songs for `seedTrack` synchronously.
 */
export function getCachedRelatedTracks(
  seedTrack: YouTubeTrack,
  moodFilter = 'context',
  userId = 'guest'
): {
  tracks: YouTubeTrack[];
  hasMore: boolean;
  cursorIndex: number;
} {
  const entry = getOrCreateRelatedEntry(seedTrack, moodFilter, userId);
  return {
    tracks: entry.tracks,
    hasMore: entry.cursorIndex < entry.queries.length,
    cursorIndex: entry.cursorIndex,
  };
}

/**
 * Loads the next cursor page of related songs exclusively from YouTube Music (`searchYouTubeSongs`),
 * automatically expanding the discovery cursor graph with newly discovered artists and albums
 * so continuous scrolling never hits an arbitrary fixed limit.
 */
export async function fetchNextRelatedTracksBatch(
  seedTrack: YouTubeTrack,
  signal?: AbortSignal,
  moodFilter = 'context',
  userId = 'guest'
): Promise<{ tracks: YouTubeTrack[]; hasMore: boolean }> {
  const entry = getOrCreateRelatedEntry(seedTrack, moodFilter, userId);
  const profile = loadUserListeningProfile(userId);

  let attempts = 0;
  const startCount = entry.tracks.length;

  while (entry.cursorIndex < entry.queries.length && attempts < 2) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const batchQueries = entry.queries.slice(entry.cursorIndex, entry.cursorIndex + 2);
    entry.cursorIndex += batchQueries.length;
    attempts += 1;

    const outcomes = await Promise.allSettled(
      batchQueries.map((q) => searchYouTubeSongs(q, signal))
    );

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const newlyDiscovered: YouTubeTrack[] = [];

    for (const outcome of outcomes) {
      if (outcome.status !== 'fulfilled') continue;
      for (const rawTrack of outcome.value) {
        const canonical = resolveCanonicalTrack(rawTrack);
        if (!isGenuineYouTubeMusicSong(canonical)) continue;
        if (!isContentAwareRelatedTrack(canonical, seedTrack, moodFilter)) continue;
        if (entry.seenVideoIds.has(canonical.videoId)) continue;

        // Skip tracks that the user has repeatedly skipped (>2 times)
        if ((profile.skippedTrackCounts[canonical.videoId] || 0) > 2) continue;

        const titleKey = normalizeTrackTitleKey(canonical.title);
        if (titleKey && entry.seenTitleKeys.has(titleKey)) continue;

        entry.seenVideoIds.add(canonical.videoId);
        if (titleKey) entry.seenTitleKeys.add(titleKey);

        const ytmSong: YouTubeTrack = {
          ...canonical,
          thumbnail: normalizeSquareThumbnail(canonical.thumbnail, canonical.videoId),
          mediaType: 'song',
          catalogSource: 'youtube_music',
        };
        newlyDiscovered.push(ytmSong);

        // Dynamically expand the pagination cursor graph using newly discovered related artists & albums
        const newArtists = parseArtistNames(ytmSong.artist);
        for (const artistName of newArtists) {
          const candidates = [
            `${artistName} best songs`,
            `${artistName} hit melody songs`,
            `${artistName} latest songs`,
          ];
          for (const cq of candidates) {
            const lower = cq.toLowerCase();
            if (!entry.queriedSet.has(lower) && entry.queries.length < 160) {
              entry.queriedSet.add(lower);
              entry.queries.push(cq);
            }
          }
        }
        if (ytmSong.album && ytmSong.album.length >= 3) {
          const albumQuery = `${ytmSong.album} movie songs`;
          const lowerAlbum = albumQuery.toLowerCase();
          if (!entry.queriedSet.has(lowerAlbum) && entry.queries.length < 160) {
            entry.queriedSet.add(lowerAlbum);
            entry.queries.push(albumQuery);
          }
        }
      }
    }

    if (newlyDiscovered.length > 0) {
      // If this was the very first network fetch, place fresh live YouTube Music matches at the front!
      if (entry.cursorIndex <= 2 && startCount <= 8) {
        entry.tracks = [...newlyDiscovered, ...entry.tracks];
      } else {
        entry.tracks.push(...newlyDiscovered);
      }
      break;
    }
  }

  return {
    tracks: [...entry.tracks],
    hasMore: entry.cursorIndex < entry.queries.length,
  };
}


