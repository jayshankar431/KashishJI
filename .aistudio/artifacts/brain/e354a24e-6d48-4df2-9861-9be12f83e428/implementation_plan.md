**Music Player 4 You Darling** adds a compact, zero-lag YouTube music search and in-app player directly at the top of the Room section in KASHISH, with a persistent floating mini-player that keeps music playing smoothly across all rooms without ever leaving the app.

## Features
- **Song & Singer Search**: Search any song by title or artist with debounced input, cached results, and instant multi-endpoint YouTube search (displaying song title, artist/channel name, duration, and thumbnail) plus quick romantic picks.
- **In-App Playback via Official YouTube IFrame API**: Clicking any song starts playback immediately inside KASHISH using the official YouTube IFrame Player API (`playsinline: 1`, `rel: 0`, `modestbranding: 1`) without opening YouTube or navigating away. Note: because the YouTube Data API does not provide raw audio streams, official embedded IFrame playback is used with a compact integrated visual viewport to comply with YouTube policies.
- **Full Playback Controls**: Play/pause, next/previous track in the current search/queue list, interactive progress scrubber, and volume/mute slider.
- **Inline Room Header + Persistent Floating Mini-Player**: Displays as a compact inline card right above the Room cards on the Home screen, and seamlessly transitions into a floating mini-player bar when you open other rooms (Gallery, Poetry, Breathe, Open When, Games) so playback never stops.
- **Background Music Auto-Pause**: Automatically pauses KASHISH's default ambient loop (`romanticAudio`) as soon as a YouTube track starts playing.

## Design
- **Theme & Colors**: Uses KASHISH's existing CSS variables so it adapts automatically to all active themes:
  - Card Surface: `var(--card)`
  - Subtle Surface / Search Row: `var(--card-subtle)`
  - Border: `var(--card-border)`
  - Primary Accent: `var(--accent)`
  - Primary Text: `var(--text)`
  - Secondary / Muted Text: `var(--text-soft)`
- **Layout & Performance**: Compact horizontal player header with a collapsible search results tray (`max-height` scroll list) right above the "Explore Your World" room grid, engineered with isolated progress state and lazy-loaded YouTube IFrame script so the app stays fast and lag-free.

## Tech Stack
- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide React icons
- **Playback Engine**: Official YouTube IFrame Player API (`window.YT.Player`)
- **Search Layer**: Multi-fallback YouTube search service with `AbortController` cancellation and in-memory query caching

## Architecture
- `src/services/youtubeSearch.ts` — Lightweight search client that queries public YouTube search endpoints with automatic fallback, query caching, and duration/thumbnail formatting.
- `src/components/DarlingMusicPlayer.tsx` — Manages the singleton YouTube IFrame Player instance, inline Room section card UI via React portal into `#darling-player-slot`, and the floating mini-player when navigating to other rooms.
- `src/components/HomeSection.tsx` — Adds the `#darling-player-slot` mount container at the very top of the "Explore Your World" Room section right above the room cards.
- `src/App.tsx` — Mounts `<DarlingMusicPlayer activeTab={activeTab} />` at the root level so music keeps playing without interruption across room changes.
