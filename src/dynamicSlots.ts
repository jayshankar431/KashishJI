export type DynamicSlotId =
  | 'home_quick_actions'
  | 'home_after_hero'
  | 'home_before_rooms'
  | 'home_after_rooms'
  | 'home_bottom'
  | 'gallery_top'
  | 'gallery_bottom'
  | 'games_bottom'
  | 'cute_pic_bottom'
  | 'secret_letter_bottom'
  | 'name_game_bottom'
  | `custom_tab_${string}`;

export type BlockType =
  | 'text'
  | 'image'
  | 'gallery'
  | 'video'
  | 'button'
  | 'music'
  | 'countdown'
  | 'letter'
  | 'quote'
  | 'card'
  | 'banner'
  | 'link';

export const VALID_BLOCK_TYPES: ReadonlySet<string> = new Set<BlockType>([
  'text',
  'image',
  'gallery',
  'video',
  'button',
  'music',
  'countdown',
  'letter',
  'quote',
  'card',
  'banner',
  'link',
]);

export interface DynamicSlotItem {
  id: string;
  type: BlockType;
  title: string;
  subtitle?: string;
  content?: string; // Paragraph text, letter body, quote text
  mediaUrl?: string; // Image URL, Video URL, or Audio/Music MP3 URL
  galleryUrls?: string[]; // Multiple image URLs for gallery block
  targetDate?: string; // ISO date string for countdown block
  author?: string; // Author / sign-off for quote or letter
  iconName?: string;
  actionType: 'navigate' | 'external_url' | 'toast' | 'haptic' | 'call' | 'none';
  actionPayload: string; // e.g. tab name, url, message, or phone number
  colorScheme?: 'rose' | 'amber' | 'emerald' | 'indigo' | 'purple' | 'cyan' | 'default';
  visible?: boolean;
  order?: number;
}

export interface CustomTabDefinition {
  id: string; // e.g. "custom_tab_anniversary"
  label: string;
  emoji: string;
  subtitle?: string;
  visible?: boolean;
  order?: number;
}

export type DynamicSlotsMap = Partial<Record<string, DynamicSlotItem[]>>;

export const SLOT_DEFINITIONS: { id: DynamicSlotId; label: string; location: string }[] = [
  { id: 'home_quick_actions', label: 'Home Quick Action Buttons', location: 'Under the main Call/Hug/Pic buttons' },
  { id: 'home_after_hero', label: 'Home After Hero Header', location: 'Right under the welcome title/photo' },
  { id: 'home_before_rooms', label: 'Home Before Room Cards', location: 'Above Explore Your World rooms' },
  { id: 'home_after_rooms', label: 'Home After Room Cards', location: 'Under the Explore Your World grid' },
  { id: 'home_bottom', label: 'Home Bottom Slot', location: 'At the very end of Home screen' },
  { id: 'gallery_top', label: 'Gallery Top Slot', location: 'Above photo memories' },
  { id: 'gallery_bottom', label: 'Gallery Bottom Slot', location: 'Under photo memories' },
  { id: 'games_bottom', label: 'Games Bottom Slot', location: 'Under the games hub' },
  { id: 'cute_pic_bottom', label: 'Cute Pic Bottom', location: 'Under camera / photo sender' },
  { id: 'secret_letter_bottom', label: 'Secret Letter Bottom', location: 'Inside secret letter' },
  { id: 'name_game_bottom', label: 'Name Game Bottom', location: 'Under name anagram cards' },
];
