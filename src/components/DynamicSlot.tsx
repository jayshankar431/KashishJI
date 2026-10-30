import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  Heart,
  ExternalLink,
  ChevronRight,
  Gift,
  Star,
  Phone,
  MessageCircle,
  Camera,
  Music,
  Smile,
  Zap,
  Info,
  Clock,
  Quote,
  Mail,
  Play,
  Pause,
  X,
} from 'lucide-react';
import { useSite } from '../siteContent';
import { DynamicSlotId, DynamicSlotItem, VALID_BLOCK_TYPES } from '../dynamicSlots';
import { triggerHaptic, showNativeToast, makeNativePhoneCall } from '../androidBridge';
import { NavTab } from './Navbar';
import { romanticAudio } from '../audio';
import { ZoomablePhotoViewer } from './PrivateStorageMedia';

interface DynamicSlotProps {
  slotId: DynamicSlotId | string;
  onNavigate?: (tab: NavTab) => void;
  className?: string;
  isDarkMode?: boolean;
}

const ICON_MAP: Record<string, React.ElementType> = {
  heart: Heart,
  sparkles: Sparkles,
  gift: Gift,
  star: Star,
  phone: Phone,
  message: MessageCircle,
  camera: Camera,
  music: Music,
  smile: Smile,
  zap: Zap,
  info: Info,
  external: ExternalLink,
  clock: Clock,
  quote: Quote,
  mail: Mail,
};

const CountdownBlock: React.FC<{
  item: DynamicSlotItem;
  scheme: { bg: string; text: string; accent: string };
}> = ({ item, scheme }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const targetMs = item.targetDate ? new Date(item.targetDate).getTime() : NaN;
  const diff = Number.isFinite(targetMs) ? Math.max(0, targetMs - now) : 0;
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const secs = Math.floor((diff % 60_000) / 1000);

  return (
    <div className={`p-4 sm:p-5 rounded-2xl border ${scheme.bg} space-y-3`}>
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${scheme.accent}`}>
          <Clock className="w-4 h-4" />
        </div>
        <div>
          <h4 className="font-bold text-sm sm:text-base text-[var(--text)]">{item.title}</h4>
          {item.subtitle && (
            <p className="text-xs text-[var(--text-soft)]">{item.subtitle}</p>
          )}
        </div>
      </div>
      {diff > 0 ? (
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { v: days, l: 'Days' },
            { v: hours, l: 'Hours' },
            { v: mins, l: 'Mins' },
            { v: secs, l: 'Secs' },
          ].map((u) => (
            <div
              key={u.l}
              className="p-2.5 rounded-xl bg-white/70 dark:bg-black/30 border border-white/20 dark:border-white/10"
            >
              <div className={`text-lg sm:text-xl font-black tabular-nums ${scheme.text}`}>
                {String(u.v).padStart(2, '0')}
              </div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-soft)]">
                {u.l}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={`text-sm font-bold text-center py-2 ${scheme.text}`}>
          {item.content || '✨ The special moment is here! 💖'}
        </p>
      )}
    </div>
  );
};

const MusicBlock: React.FC<{
  item: DynamicSlotItem;
  scheme: { bg: string; text: string; accent: string };
}> = ({ item, scheme }) => {
  const [playing, setPlaying] = useState(false);
  const audioElRef = React.useRef<HTMLAudioElement | null>(null);
  const audioUrl = item.mediaUrl || item.actionPayload || '';

  const togglePlay = () => {
    triggerHaptic(35);
    const el = audioElRef.current;
    if (!audioUrl || !el) return;
    if (!el.paused) {
      el.pause();
      setPlaying(false);
    } else {
      window.dispatchEvent(new CustomEvent('kashish-pause-darling-player'));
      el.play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    }
  };

  return (
    <div className={`p-4 rounded-2xl border ${scheme.bg} space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={togglePlay}
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 cursor-pointer transition-transform active:scale-95 ${scheme.accent}`}
            aria-label={playing ? 'Pause music' : 'Play music'}
          >
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <div className="min-w-0">
            <h4 className="font-bold text-sm text-[var(--text)] truncate">{item.title}</h4>
            {item.subtitle && (
              <p className="text-xs text-[var(--text-soft)] truncate">{item.subtitle}</p>
            )}
          </div>
        </div>
      </div>
      {audioUrl && (
        <audio
          ref={audioElRef}
          controls
          src={audioUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="w-full h-9 rounded-lg"
          preload="metadata"
        />
      )}
    </div>
  );
};

export const DynamicSlot: React.FC<DynamicSlotProps> = ({
  slotId,
  onNavigate,
  className = '',
}) => {
  const site = useSite();
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title?: string } | null>(null);
  const rawItems: DynamicSlotItem[] = (site.dynamicSlots && site.dynamicSlots[slotId]) || [];

  useEffect(() => {
    if (!lightboxImage) return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [lightboxImage]);

  // Filter out OFF items and unknown block types safely
  const items = rawItems
    .filter(
      (item): item is DynamicSlotItem =>
        Boolean(item) &&
        item.visible !== false &&
        typeof item.type === 'string' &&
        VALID_BLOCK_TYPES.has(item.type)
    )
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  // IMPORTANT: An empty or OFF slot renders NOTHING (no gap, no blank space)
  if (items.length === 0) {
    return null;
  }

  const handleAction = (item: DynamicSlotItem) => {
    if (!item.actionType || item.actionType === 'none') return;
    triggerHaptic(40);
    romanticAudio.playChime();

    switch (item.actionType) {
      case 'navigate': {
        if (onNavigate && item.actionPayload) {
          onNavigate(item.actionPayload as NavTab);
        }
        break;
      }
      case 'external_url': {
        if (item.actionPayload) {
          const url = item.actionPayload.startsWith('http')
            ? item.actionPayload
            : `https://${item.actionPayload}`;
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        break;
      }
      case 'toast': {
        if (item.actionPayload) {
          showNativeToast(item.actionPayload);
        }
        break;
      }
      case 'call': {
        const num = item.actionPayload?.trim() || site.callPhoneNumber?.trim();
        if (num) {
          makeNativePhoneCall(num);
        } else {
          showNativeToast('Phone number is configured in Admin Settings 📞');
        }
        break;
      }
      case 'haptic': {
        showNativeToast(item.subtitle || item.title);
        break;
      }
      default:
        break;
    }
  };

  const getSchemeStyles = (scheme: DynamicSlotItem['colorScheme']) => {
    switch (scheme) {
      case 'rose':
        return {
          bg: 'bg-rose-500/10 hover:bg-rose-500/15 border-rose-500/25',
          text: 'text-rose-600 dark:text-rose-400',
          accent: 'bg-rose-500 text-white',
        };
      case 'amber':
        return {
          bg: 'bg-amber-500/10 hover:bg-amber-500/15 border-amber-500/25',
          text: 'text-amber-600 dark:text-amber-400',
          accent: 'bg-amber-500 text-white',
        };
      case 'emerald':
        return {
          bg: 'bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/25',
          text: 'text-emerald-600 dark:text-emerald-400',
          accent: 'bg-emerald-500 text-white',
        };
      case 'indigo':
        return {
          bg: 'bg-indigo-500/10 hover:bg-indigo-500/15 border-indigo-500/25',
          text: 'text-indigo-600 dark:text-indigo-400',
          accent: 'bg-indigo-500 text-white',
        };
      case 'purple':
        return {
          bg: 'bg-purple-500/10 hover:bg-purple-500/15 border-purple-500/25',
          text: 'text-purple-600 dark:text-purple-400',
          accent: 'bg-purple-500 text-white',
        };
      case 'cyan':
        return {
          bg: 'bg-cyan-500/10 hover:bg-cyan-500/15 border-cyan-500/25',
          text: 'text-cyan-600 dark:text-cyan-400',
          accent: 'bg-cyan-500 text-white',
        };
      default:
        return {
          bg: 'bg-[var(--card)] hover:bg-[var(--card-subtle)] border-[var(--card-border)]',
          text: 'text-[var(--accent)]',
          accent: 'bg-[var(--accent)] text-white',
        };
    }
  };

  const renderedNodes = items
    .map((item) => {
      const IconComponent =
        (item.iconName && ICON_MAP[item.iconName.toLowerCase()]) || Sparkles;
      const scheme = getSchemeStyles(item.colorScheme);
      const hasAction = Boolean(item.actionType && item.actionType !== 'none');

      switch (item.type) {
        case 'text':
          return (
            <div
              key={item.id}
              onClick={hasAction ? () => handleAction(item) : undefined}
              className={`p-4 sm:p-5 rounded-2xl border ${scheme.bg} space-y-1.5 ${
                hasAction ? 'cursor-pointer' : ''
              }`}
            >
              {item.title && (
                <h4 className="font-bold text-sm sm:text-base text-[var(--text)]">
                  {item.title}
                </h4>
              )}
              {item.subtitle && (
                <p className={`text-xs font-semibold ${scheme.text}`}>{item.subtitle}</p>
              )}
              {item.content && (
                <p className="text-xs sm:text-sm text-[var(--text-soft)] leading-relaxed whitespace-pre-wrap">
                  {item.content}
                </p>
              )}
            </div>
          );

        case 'image': {
          const imgUrl = item.mediaUrl || item.actionPayload;
          if (!imgUrl) return null;
          return (
            <div
              key={item.id}
              onClick={
                hasAction
                  ? () => handleAction(item)
                  : () => {
                      triggerHaptic(25);
                      setLightboxImage({ url: imgUrl, title: item.title });
                    }
              }
              className={`rounded-2xl overflow-hidden border ${scheme.bg} cursor-pointer`}
            >
              <img
                src={imgUrl}
                alt={item.title || 'Memory'}
                className="w-full max-h-96 object-cover"
                loading="lazy"
              />
              {(item.title || item.subtitle || item.content) && (
                <div className="p-3.5 sm:p-4 space-y-1">
                  {item.title && (
                    <h4 className="font-bold text-sm text-[var(--text)]">{item.title}</h4>
                  )}
                  {(item.subtitle || item.content) && (
                    <p className="text-xs text-[var(--text-soft)]">
                      {item.content || item.subtitle}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        }

        case 'gallery': {
          const urls = (item.galleryUrls || []).filter(Boolean);
          if (urls.length === 0 && item.mediaUrl) urls.push(item.mediaUrl);
          if (urls.length === 0) return null;
          return (
            <div key={item.id} className={`p-4 sm:p-5 rounded-2xl border ${scheme.bg} space-y-3`}>
              {(item.title || item.subtitle) && (
                <div>
                  {item.title && (
                    <h4 className="font-bold text-sm sm:text-base text-[var(--text)]">
                      {item.title}
                    </h4>
                  )}
                  {item.subtitle && (
                    <p className="text-xs text-[var(--text-soft)]">{item.subtitle}</p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {urls.map((u, idx) => (
                  <div
                    key={`${item.id}_img_${idx}`}
                    onClick={() => {
                      triggerHaptic(25);
                      setLightboxImage({ url: u, title: item.title });
                    }}
                    className="aspect-square rounded-xl overflow-hidden border border-white/10 bg-black/10 cursor-pointer active:scale-95 transition-transform"
                  >
                    <img
                      src={u}
                      alt={`${item.title || 'Photo'} ${idx + 1}`}
                      className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        }

        case 'video': {
          const videoUrl = item.mediaUrl || item.actionPayload;
          if (!videoUrl) return null;
          return (
            <div key={item.id} className={`rounded-2xl overflow-hidden border ${scheme.bg}`}>
              <video
                src={videoUrl}
                controls
                playsInline
                preload="metadata"
                className="w-full max-h-96 bg-black"
              />
              {(item.title || item.subtitle) && (
                <div className="p-3.5 sm:p-4">
                  {item.title && (
                    <h4 className="font-bold text-sm text-[var(--text)]">{item.title}</h4>
                  )}
                  {item.subtitle && (
                    <p className="text-xs text-[var(--text-soft)] mt-0.5">{item.subtitle}</p>
                  )}
                </div>
              )}
            </div>
          );
        }

        case 'music':
          return <MusicBlock key={item.id} item={item} scheme={scheme} />;

        case 'countdown':
          return <CountdownBlock key={item.id} item={item} scheme={scheme} />;

        case 'letter':
          return (
            <div
              key={item.id}
              className={`p-5 sm:p-6 rounded-3xl border ${scheme.bg} space-y-3 shadow-sm`}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${scheme.accent}`}
                >
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-base sm:text-lg text-[var(--text)]">
                    {item.title}
                  </h4>
                  {item.subtitle && (
                    <p className="text-[11px] text-[var(--text-soft)]">{item.subtitle}</p>
                  )}
                </div>
              </div>
              {item.content && (
                <div className="text-xs sm:text-sm text-[var(--text)] leading-relaxed whitespace-pre-wrap font-serif italic pl-1 border-l-2 border-rose-400/40">
                  {item.content}
                </div>
              )}
              {item.author && (
                <p className={`text-xs font-bold text-right ${scheme.text}`}>— {item.author}</p>
              )}
            </div>
          );

        case 'quote':
          return (
            <blockquote
              key={item.id}
              className={`p-4 sm:p-5 rounded-2xl border ${scheme.bg} space-y-2 relative`}
            >
              <div className="flex items-start gap-3">
                <Quote className={`w-5 h-5 shrink-0 mt-0.5 ${scheme.text}`} />
                <div className="space-y-1.5 min-w-0">
                  <p className="text-sm sm:text-base font-serif italic text-[var(--text)] leading-relaxed">
                    "{item.content || item.subtitle || item.title}"
                  </p>
                  {(item.author || (item.content && item.title)) && (
                    <footer className={`text-xs font-bold ${scheme.text}`}>
                      — {item.author || item.title}
                    </footer>
                  )}
                </div>
              </div>
            </blockquote>
          );

        case 'banner':
          return (
            <div
              key={item.id}
              onClick={() => handleAction(item)}
              role="button"
              tabIndex={0}
              className={`p-3.5 sm:p-4 rounded-2xl border transition-all duration-200 cursor-pointer shadow-xs flex items-center justify-between gap-3 ${scheme.bg}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${scheme.accent}`}
                >
                  <IconComponent className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-bold truncate text-[var(--text)]">
                    {item.title}
                  </h4>
                  {(item.subtitle || item.content) && (
                    <p className="text-[10px] sm:text-xs text-[var(--text-soft)] truncate font-medium">
                      {item.subtitle || item.content}
                    </p>
                  )}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[var(--text-soft)] shrink-0" />
            </div>
          );

        case 'card':
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleAction(item)}
              className={`w-full text-left p-4 sm:p-5 rounded-2xl border transition-all duration-200 shadow-sm flex items-start gap-4 active:scale-[0.98] cursor-pointer hover:border-[var(--accent)] ${scheme.bg}`}
            >
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${scheme.accent}`}
              >
                <IconComponent className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-semibold text-sm sm:text-base text-[var(--text)]">
                    {item.title}
                  </h4>
                  {item.actionType === 'external_url' ? (
                    <ExternalLink className="w-3.5 h-3.5 text-[var(--text-soft)] shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-[var(--text-soft)] shrink-0" />
                  )}
                </div>
                {(item.subtitle || item.content) && (
                  <p className="text-xs text-[var(--text-soft)] leading-relaxed font-medium whitespace-pre-wrap">
                    {item.content || item.subtitle}
                  </p>
                )}
              </div>
            </button>
          );

        case 'button':
        case 'link':
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleAction(item)}
              className={`w-full py-3 px-4 rounded-xl sm:rounded-2xl border font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition-all duration-200 active:scale-95 cursor-pointer ${scheme.bg} ${scheme.text}`}
            >
              <IconComponent className="w-4 h-4 shrink-0" />
              <span>{item.title}</span>
              {item.subtitle && (
                <span className="text-[10px] opacity-75 font-normal">({item.subtitle})</span>
              )}
              {item.actionType === 'external_url' && (
                <ExternalLink className="w-3.5 h-3.5 ml-1 opacity-70" />
              )}
            </button>
          );

        default:
          // Unknown block types are ignored safely
          return null;
      }
    })
    .filter(Boolean);

  if (renderedNodes.length === 0) {
    return null;
  }

  return (
    <div className={`dynamic-slot dynamic-slot-${slotId} space-y-2.5 my-3 ${className}`}>
      {renderedNodes}
      {lightboxImage &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={() => setLightboxImage(null)}
            className="fixed inset-0 z-[1500] w-screen h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none bg-black/92 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 animate-fade-in select-none"
          >
            <div className="flex items-center justify-between text-white z-10 shrink-0">
              <span className="font-serif text-sm sm:text-base font-bold truncate pr-2">
                {lightboxImage.title || '✨ Cherished Memory'}
              </span>
              <button
                onClick={() => setLightboxImage(null)}
                className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-h-0 flex items-center justify-center p-2 overflow-hidden"
            >
              <ZoomablePhotoViewer
                fallbackUrl={lightboxImage.url}
                alt={lightboxImage.title || 'Memory'}
              />
            </div>
            <div className="text-center text-xs text-white/70 shrink-0 pb-1">
              Pinch or double-tap to zoom • Tap outside to close
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
