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
  { id: 'bollywood', name: 'Bollywood Hits', emoji: '🎬', color: '#f59e0b' },
  { id: 'lofi', name: 'Lo-Fi Chill', emoji: '🌙', color: '#8b5cf6' },
  { id: 'punjabi', name: 'Punjabi Vibe', emoji: '🔥', color: '#ef4444' },
  { id: 'indie', name: 'Indie Pop', emoji: '🎸', color: '#06b6d4' },
  { id: 'sufi', name: 'Sufi & Soul', emoji: '🕊️', color: '#10b981' },
  { id: 'acoustic', name: 'Acoustic', emoji: '☕', color: '#f97316' },
  { id: 'workout', name: 'Workout Pump', emoji: '⚡', color: '#6366f1' },
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
    secondaryGenres: ['bollywood', 'acoustic'],
    vibe: 'Soulful & Melodic',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.kesariya,
    genreId: 'romantic',
    secondaryGenres: ['bollywood'],
    vibe: 'Pure Romance',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.chaleya,
    genreId: 'bollywood',
    secondaryGenres: ['romantic', 'workout'],
    vibe: 'Chartbuster Groove',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.lover,
    genreId: 'punjabi',
    secondaryGenres: ['workout'],
    vibe: 'Upbeat Urban Punjabi',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.heeriye,
    genreId: 'romantic',
    secondaryGenres: ['indie', 'lofi'],
    vibe: 'Dreamy Pop Melody',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.husn,
    genreId: 'indie',
    secondaryGenres: ['acoustic', 'lofi'],
    vibe: 'Acoustic Poetry',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.pasoori,
    genreId: 'sufi',
    secondaryGenres: ['indie', 'punjabi'],
    vibe: 'Global Fusion Anthem',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.zinda,
    genreId: 'workout',
    secondaryGenres: ['bollywood'],
    vibe: 'High-Octane Energy',
  },
];

export const MADE_FOR_YOU_TRACKS: (DiscoveryTrackItem & { reason: string })[] = [
  {
    ...CANONICAL_DISCOVERY_CATALOG.satranga,
    genreId: 'romantic',
    secondaryGenres: ['bollywood'],
    reason: 'Matches your romantic Bollywood favorites',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.oMaahi,
    genreId: 'bollywood',
    secondaryGenres: ['romantic', 'sufi'],
    reason: 'Inspired by your recent Arijit Singh sessions',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.softly,
    genreId: 'punjabi',
    secondaryGenres: ['workout', 'lofi'],
    reason: 'Trending Punjabi vibe in your queue',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.kasoor,
    genreId: 'acoustic',
    secondaryGenres: ['indie', 'lofi'],
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
    secondaryGenres: ['acoustic', 'lofi'],
    reason: 'Indie ballad loved by listeners like you',
  },
];

export const DISCOVER_WEEKLY_TRACKS: (DiscoveryTrackItem & { tag: string })[] = [
  {
    ...CANONICAL_DISCOVERY_CATALOG.pehleBhiMain,
    genreId: 'bollywood',
    secondaryGenres: ['romantic', 'lofi'],
    tag: 'Weekly Feature',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.sajni,
    genreId: 'romantic',
    secondaryGenres: ['bollywood', 'acoustic'],
    tag: 'Fresh Melody',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.bars52,
    genreId: 'punjabi',
    secondaryGenres: ['workout'],
    tag: 'Power Anthem',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.iraaday,
    genreId: 'lofi',
    secondaryGenres: ['indie', 'romantic'],
    tag: 'Late Night Chill',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.afreenAfreen,
    genreId: 'sufi',
    secondaryGenres: ['acoustic'],
    tag: 'Timeless Harmony',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.karHarMaidaanFateh,
    genreId: 'workout',
    secondaryGenres: ['bollywood'],
    tag: 'Peak Motivation',
  },
];

export const SIMILAR_TO_FAVORITES_TRACKS: (DiscoveryTrackItem & { referenceArtist: string })[] = [
  {
    ...CANONICAL_DISCOVERY_CATALOG.tumHiHo,
    genreId: 'romantic',
    secondaryGenres: ['bollywood'],
    referenceArtist: 'Because you listened to Arijit Singh',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.shayad,
    genreId: 'bollywood',
    secondaryGenres: ['romantic', 'lofi'],
    referenceArtist: 'Because you love Romantic Bollywood',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.bornToShine,
    genreId: 'punjabi',
    secondaryGenres: ['workout'],
    referenceArtist: 'Because you played Diljit Dosanjh',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.raataanLambiyan,
    genreId: 'romantic',
    secondaryGenres: ['bollywood', 'acoustic'],
    referenceArtist: 'Because you enjoy soulful duets',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.agarTumSaathHo,
    genreId: 'bollywood',
    secondaryGenres: ['romantic', 'acoustic'],
    referenceArtist: 'Because you love emotional classics',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.tereHawaale,
    genreId: 'romantic',
    secondaryGenres: ['bollywood', 'sufi'],
    referenceArtist: 'Because you saved heartfelt melodies',
  },
];

export const HIDDEN_GEMS_TRACKS: (DiscoveryTrackItem & { gemFact: string })[] = [
  {
    ...CANONICAL_DISCOVERY_CATALOG.baarishein,
    genreId: 'indie',
    secondaryGenres: ['acoustic', 'lofi'],
    gemFact: 'Indie gem with heartfelt acoustic vocals',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.alagAasmaan,
    genreId: 'acoustic',
    secondaryGenres: ['indie', 'lofi'],
    gemFact: 'Intimate ukulele poetry for quiet evenings',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.kunFayaKun,
    genreId: 'sufi',
    secondaryGenres: ['bollywood'],
    gemFact: 'Timeless spiritual journey & divine tranquility',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.chooLo,
    genreId: 'indie',
    secondaryGenres: ['acoustic'],
    gemFact: 'India’s most celebrated indie rock anthem',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.kabira,
    genreId: 'sufi',
    secondaryGenres: ['bollywood', 'acoustic'],
    gemFact: 'Rustic folk warmth & soulful nostalgia',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.nadaanParinde,
    genreId: 'workout',
    secondaryGenres: ['sufi', 'bollywood'],
    gemFact: 'Soaring rock crescendo by A.R. Rahman',
  },
];

export const NEW_ARTISTS_TRACKS: (DiscoveryTrackItem & { spotlight: string })[] = [
  {
    ...CANONICAL_DISCOVERY_CATALOG.gul,
    genreId: 'indie',
    secondaryGenres: ['acoustic', 'lofi'],
    spotlight: 'Rising Singer-Songwriter',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.kahaniSuno,
    genreId: 'sufi',
    secondaryGenres: ['romantic', 'lofi'],
    spotlight: 'Soulful Indie Sensation',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.faasle,
    genreId: 'lofi',
    secondaryGenres: ['romantic', 'indie', 'acoustic'],
    spotlight: 'New Melodic Voice',
  },
  {
    ...CANONICAL_DISCOVERY_CATALOG.aaogeTumKabhi,
    genreId: 'indie',
    secondaryGenres: ['acoustic'],
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

export function loadUserFavorites(userId: string): Set<string> {
  if (typeof window === 'undefined' || !window.localStorage) return new Set();
  try {
    const raw = window.localStorage.getItem(`${FAVORITES_KEY_PREFIX}${userId}`);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return new Set(arr);
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
  'anuv jain': ['Prateek Kuhad', 'Aditya Rikhari', 'The Local Train', 'Abdul Hannan', 'Kaifi Khalil', 'When Chai Met Toast', 'Ritviz', 'Zaeden'],
  'prateek kuhad': ['Anuv Jain', 'The Local Train', 'Aditya Rikhari', 'When Chai Met Toast', 'Taba Chake', 'Lifafa', 'OAFF'],
  'the local train': ['Anuv Jain', 'Prateek Kuhad', 'Parvaaz', 'Agnee', 'Indian Ocean', 'Aditya Rikhari'],
  'a.r. rahman': ['Mohit Chauhan', 'Javed Ali', 'Rahat Fateh Ali Khan', 'Shankar-Ehsaan-Loy', 'Amit Trivedi', 'Pritam', 'Coke Studio'],
  'vishal mishra': ['Arijit Singh', 'Jubin Nautiyal', 'Sachet Tandon', 'B Praak', 'Darshan Raval', 'Pritam'],
  'jubin nautiyal': ['Arijit Singh', 'Atif Aslam', 'Vishal Mishra', 'B Praak', 'Stebin Ben', 'Darshan Raval'],
  'kaifi khalil': ['Abdul Hannan', 'Ali Sethi', 'Atif Aslam', 'Anuv Jain', 'Aditya Rikhari', 'Hasan Raheem'],
  'ali sethi': ['Shae Gill', 'Kaifi Khalil', 'Rahat Fateh Ali Khan', 'Abida Parveen', 'Atif Aslam', 'Coke Studio'],
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

/**
 * Computes an instant (0ms) contextual list of related songs from the verified catalog
 * based on same artist, related artists, same album/movie, genre, and musical style.
 */
export function getInstantRelatedTracks(seedTrack: YouTubeTrack, limit = 10): YouTubeTrack[] {
  const seedArtists = parseArtistNames(seedTrack.artist).map((a) => a.toLowerCase());
  const seedMeta = DISCOVERY_ITEMS_BY_ID.get(seedTrack.videoId);
  const seedGenre = seedMeta?.genreId || 'romantic';
  const seedSecondary = new Set(seedMeta?.secondaryGenres || []);
  const seedAlbum = (seedTrack.album || '').trim().toLowerCase();

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

    // 1. Same artist / co-artist
    for (const ca of candArtists) {
      if (seedArtists.some((sa) => ca.includes(sa) || sa.includes(ca))) {
        score += 55;
      } else if (clusterArtists.has(ca)) {
        score += 28;
      }
    }

    // 2. Same album / movie soundtrack
    if (seedAlbum && cand.album && cand.album.toLowerCase() === seedAlbum) {
      score += 40;
    }

    // 3. Same primary or secondary genre & mood
    if (candMeta) {
      if (candMeta.genreId === seedGenre) score += 30;
      if (seedSecondary.has(candMeta.genreId)) score += 18;
      if (candMeta.secondaryGenres) {
        for (const sg of candMeta.secondaryGenres) {
          if (sg === seedGenre) score += 20;
          if (seedSecondary.has(sg)) score += 12;
        }
      }
    }

    return { track: cand, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item) => item.track);
}

interface RelatedRecommendationCacheEntry {
  seedVideoId: string;
  tracks: YouTubeTrack[];
  seenVideoIds: Set<string>;
  seenTitleKeys: Set<string>;
  queries: string[];
  queriedSet: Set<string>;
  cursorIndex: number;
}

const MAX_RELATED_CACHE_ENTRIES = 25;
const relatedRecommendationCache = new Map<string, RelatedRecommendationCacheEntry>();

function buildInitialRelatedQueries(seedTrack: YouTubeTrack): string[] {
  const cleanTitle = (seedTrack.title || '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/official\s*(music\s*)?video|full\s*video|lyric\s*video/gi, '')
    .trim();
  const artists = parseArtistNames(seedTrack.artist);
  const primaryArtist = artists[0] || 'Arijit Singh';
  const secondaryArtist = artists[1] || '';
  const album = (seedTrack.album || '').replace(/Single$/i, '').trim();
  const seedMeta = DISCOVERY_ITEMS_BY_ID.get(seedTrack.videoId);
  const genreId = seedMeta?.genreId || 'romantic';

  const queries: string[] = [];
  const pushUnique = (q: string) => {
    const clean = q.replace(/\s+/g, ' ').trim();
    if (clean && !queries.some((existing) => existing.toLowerCase() === clean.toLowerCase())) {
      queries.push(clean);
    }
  };

  // 1. Similar to current song + primary artist
  pushUnique(`${cleanTitle} ${primaryArtist} similar songs`);
  // 2. Same primary artist top hits
  pushUnique(`${primaryArtist} top hit songs`);
  // 3. Album / movie soundtrack songs
  if (album && album.toLowerCase() !== cleanTitle.toLowerCase()) {
    pushUnique(`${album} movie songs ${primaryArtist}`);
  }
  // 4. Co-artist / composer songs
  if (secondaryArtist) {
    pushUnique(`${secondaryArtist} best hit songs`);
  }
  // 5. Related artists from cluster
  const cluster = RELATED_ARTIST_CLUSTERS[primaryArtist.toLowerCase()] || [
    'Arijit Singh',
    'Jubin Nautiyal',
    'Vishal Mishra',
    'Atif Aslam',
    'Pritam',
    'Anuv Jain',
    'Diljit Dosanjh',
  ];
  for (const relArtist of cluster.slice(0, 5)) {
    pushUnique(`${relArtist} top songs`);
  }
  // 6. Genre & mood specific discovery queries
  const genreQueryMap: Record<string, string[]> = {
    romantic: ['Romantic Bollywood hit songs', 'Soulful Hindi love songs', 'Romantic acoustic Hindi songs'],
    bollywood: ['Latest Bollywood chartbuster songs', 'Superhit Hindi movie songs', 'Bollywood melody hits'],
    punjabi: ['Punjabi superhit songs', 'Urban Punjabi vibe songs', 'Trending Punjabi hits'],
    indie: ['Indian Indie pop songs', 'Hindi Indie acoustic songs', 'Underrated Hindi indie songs'],
    sufi: ['Sufi soulful Hindi songs', 'Coke Studio classic songs', 'Spiritual Sufi rock songs'],
    acoustic: ['Acoustic unplugged Hindi songs', 'Peaceful acoustic melodies', 'Late night acoustic songs'],
    lofi: ['Lo-Fi chill Hindi songs', 'Midnight lofi Bollywood songs', 'Slowed reverb Hindi melodies'],
    workout: ['High energy Bollywood workout songs', 'Punjabi gym pump songs', 'Motivational Hindi anthems'],
  };
  for (const gq of genreQueryMap[genreId] || genreQueryMap.romantic) {
    pushUnique(gq);
  }
  for (const relArtist of cluster.slice(5)) {
    pushUnique(`${relArtist} hit songs`);
  }

  return queries;
}

function isGenuineYouTubeMusicSong(track: YouTubeTrack): boolean {
  if (!track || !track.videoId || !track.title) return false;
  if (track.mediaType === 'video' || track.catalogSource === 'youtube_video') return false;
  // Filter out video-only uploads (Official Video, Full Video, Lyrical Video, Trailer, Teaser, Jukebox)
  const videoTitlePattern =
    /\b(official\s*(music\s*)?video|full\s*video|lyrical\s*video|lyric\s*video|video\s*song|making\s*of|trailer|teaser|jukebox|full\s*movie)\b/i;
  if (videoTitlePattern.test(track.title)) return false;
  return true;
}

function getOrCreateRelatedEntry(seedTrack: YouTubeTrack): RelatedRecommendationCacheEntry {
  const existing = relatedRecommendationCache.get(seedTrack.videoId);
  if (existing) {
    // Refresh LRU order
    relatedRecommendationCache.delete(seedTrack.videoId);
    relatedRecommendationCache.set(seedTrack.videoId, existing);
    return existing;
  }

  const seenVideoIds = new Set<string>([seedTrack.videoId]);
  const seenTitleKeys = new Set<string>();
  const seedTitleKey = normalizeTrackTitleKey(seedTrack.title);
  if (seedTitleKey) seenTitleKeys.add(seedTitleKey);

  // Start with an empty list so 100% of related tracks come from YouTube Music Songs catalog
  const initialTracks: YouTubeTrack[] = [];

  const queries = buildInitialRelatedQueries(seedTrack);
  const entry: RelatedRecommendationCacheEntry = {
    seedVideoId: seedTrack.videoId,
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
  relatedRecommendationCache.set(seedTrack.videoId, entry);
  return entry;
}

/**
 * Returns the currently cached YouTube Music related songs for `seedTrack` synchronously.
 */
export function getCachedRelatedTracks(seedTrack: YouTubeTrack): {
  tracks: YouTubeTrack[];
  hasMore: boolean;
  cursorIndex: number;
} {
  const entry = getOrCreateRelatedEntry(seedTrack);
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
  signal?: AbortSignal
): Promise<{ tracks: YouTubeTrack[]; hasMore: boolean }> {
  const entry = getOrCreateRelatedEntry(seedTrack);

  // Pull up to 2 queries per cursor batch until we add new unique YouTube Music songs or exhaust current queries
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

    for (const outcome of outcomes) {
      if (outcome.status !== 'fulfilled') continue;
      for (const rawTrack of outcome.value) {
        if (!isGenuineYouTubeMusicSong(rawTrack)) continue;
        if (entry.seenVideoIds.has(rawTrack.videoId)) continue;

        const titleKey = normalizeTrackTitleKey(rawTrack.title);
        if (titleKey && entry.seenTitleKeys.has(titleKey)) continue;

        entry.seenVideoIds.add(rawTrack.videoId);
        if (titleKey) entry.seenTitleKeys.add(titleKey);

        const ytmSong: YouTubeTrack = {
          ...rawTrack,
          thumbnail: normalizeSquareThumbnail(rawTrack.thumbnail, rawTrack.videoId),
          mediaType: 'song',
          catalogSource: 'youtube_music',
        };
        entry.tracks.push(ytmSong);

        // Dynamically expand the pagination cursor graph using newly discovered related artists & albums
        const newArtists = parseArtistNames(ytmSong.artist);
        for (const artistName of newArtists) {
          const candidates = [
            `${artistName} best songs`,
            `${artistName} romantic melody songs`,
            `${artistName} latest hit songs`,
          ];
          for (const cq of candidates) {
            const lower = cq.toLowerCase();
            if (!entry.queriedSet.has(lower) && entry.queries.length < 120) {
              entry.queriedSet.add(lower);
              entry.queries.push(cq);
            }
          }
        }
        if (ytmSong.album && ytmSong.album.length >= 3) {
          const albumQuery = `${ytmSong.album} movie songs`;
          const lowerAlbum = albumQuery.toLowerCase();
          if (!entry.queriedSet.has(lowerAlbum) && entry.queries.length < 120) {
            entry.queriedSet.add(lowerAlbum);
            entry.queries.push(albumQuery);
          }
        }
      }
    }

    if (entry.tracks.length > startCount) {
      break;
    }
  }

  return {
    tracks: [...entry.tracks],
    hasMore: entry.cursorIndex < entry.queries.length,
  };
}

