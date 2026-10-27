import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Images, 
  Upload, 
  Camera, 
  Heart, 
  Sparkles, 
  X, 
  Plus, 
  Loader2, 
  Check, 
  Download, 
  Calendar,
  Share2,
  Eye,
  Filter
} from 'lucide-react';
import { PrivateStorageImage } from './PrivateStorageMedia';
import { 
  triggerHaptic, 
  showNativeToast, 
  logNativeActivity, 
  sendTelegramPhoto, 
  incrementStat, 
  isNativeApp, 
  requestNativePermissions,
  uploadMediaToCloudinary,
} from '../androidBridge';
import { collection, doc, onSnapshot, query, orderBy, limit, updateDoc, increment } from 'firebase/firestore';
import { db } from '../firebase';
import { motion, AnimatePresence } from 'framer-motion';
import { useSite } from '../siteContent';
import { DynamicSlot } from './DynamicSlot';

export interface GalleryPhoto {
  id: string;
  url: string;
  storagePath?: string;
  cloudinaryPublicId?: string;
  resourceType?: 'image' | 'video';
  caption: string;
  timestamp?: any;
  likes: number;
  views?: number;
  isCurated?: boolean;
  isFirestore?: boolean;
  type?: 'surprise' | 'curated' | 'selfie';
}

function isVideoMedia(photo: { url?: string; storagePath?: string; resourceType?: string }): boolean {
  if (photo.resourceType === 'video') return true;
  const target = (photo.url || photo.storagePath || '').toLowerCase().split('?')[0];
  return target.endsWith('.mp4') || target.endsWith('.webm') || target.endsWith('.mov');
}

interface GallerySectionProps {
  name: string;
  isDarkMode: boolean;
  onBack: () => void;
}

// Curated foundational memories for Kashish
export const DEFAULT_CURATED_MEMORIES: GalleryPhoto[] = [
  {
    id: 'curated-1',
    url: 'https://res.cloudinary.com/dsfcu9y1h/image/upload/v1791174014/Dreamy_Monochrome_Romance_with_Hearts_cie0p4.png',
    caption: 'Dreamy romance bathed in infinite hearts ✨',
    likes: 12,
    isCurated: true,
    type: 'curated',
  },
  {
    id: 'curated-2',
    url: 'https://res.cloudinary.com/dsfcu9y1h/image/upload/v1790940725/Golden_Gaze_in_a_Neon_Circle_hztvx3.png',
    caption: 'Golden gaze that lights up my whole universe 🌙',
    likes: 18,
    isCurated: true,
    type: 'curated',
  },
  {
    id: 'curated-3',
    url: 'https://res.cloudinary.com/dsfcu9y1h/image/upload/v1791190420/Kashish_Silver_Calligraphy_with_Hearts_d0gbuz.png',
    caption: 'Kashish — the most poetic name in the world 💖',
    likes: 24,
    isCurated: true,
    type: 'curated',
  },
  {
    id: 'curated-4',
    url: 'https://res.cloudinary.com/dsfcu9y1h/image/upload/v1791191256/Royal_Purple_Eye_Portrait_Icon_vbflga.png',
    caption: 'Eyes holding safe harbors and quiet grace 👑',
    likes: 9,
    isCurated: true,
    type: 'curated',
  },
];

export const GallerySection: React.FC<GallerySectionProps> = ({ name, isDarkMode }) => {
  const site = useSite();
  const hideDefaults = site.hideDefaultGallery;
  const [photos, setPhotos] = useState<GalleryPhoto[]>(() => {
    try {
      const cached = localStorage.getItem('kashish_cached_gallery');
      if (cached !== null) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return hideDefaults ? parsed.filter((p) => !p?.isCurated) : parsed;
        }
      }
    } catch {}
    return hideDefaults ? [] : DEFAULT_CURATED_MEMORIES;
  });
  const [filter, setFilter] = useState<'all' | 'surprise' | 'curated'>('all');
  const [selectedPhoto, setSelectedPhoto] = useState<GalleryPhoto | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewIsVideo, setPreviewIsVideo] = useState(false);
  const [selectedRawFile, setSelectedRawFile] = useState<File | null>(null);
  const [captionInput, setCaptionInput] = useState('');
  const [userLikedPhotos, setUserLikedPhotos] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('kashish_liked_photos');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to real-time Firestore media collection + merge curated defaults
  useEffect(() => {
    const q = query(collection(db, 'media'), orderBy('createdAt', 'desc'), limit(80));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const remoteItems: GalleryPhoto[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (d.isChunk) return;
          if (d.category === 'Gallery' || d.category === 'Uploads From Her' || !d.category) {
            remoteItems.push({
              id: docSnap.id,
              url: d.url || '',
              storagePath: d.storagePath || '',
              resourceType: d.type === 'video' ? 'video' : 'image',
              caption: d.name || d.caption || 'Memory',
              timestamp: d.createdAt || Date.now(),
              likes: d.likes || 1,
              views: d.views || 0,
              isCurated: d.uploadedBy !== 'her',
              isFirestore: true,
              type: d.uploadedBy === 'her' ? 'surprise' : 'curated',
            });
          }
        });
        const baseDefaults = hideDefaults ? [] : DEFAULT_CURATED_MEMORIES;
        setPhotos([...remoteItems, ...baseDefaults]);
      },
      () => {
        setPhotos(hideDefaults ? [] : DEFAULT_CURATED_MEMORIES);
      }
    );
    return () => unsub();
  }, [hideDefaults]);

  // Save liked photos to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('kashish_liked_photos', JSON.stringify(userLikedPhotos));
    } catch {}
  }, [userLikedPhotos]);

  // Lock background page scroll whenever a photo lightbox or upload modal is open
  useEffect(() => {
    if (!selectedPhoto && !isUploadModalOpen) return;

    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedPhoto) setSelectedPhoto(null);
        else if (isUploadModalOpen && !isUploading) {
          setIsUploadModalOpen(false);
          setPreviewImage(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedPhoto, isUploadModalOpen, isUploading]);

  // Handle Photo / Video Selection and resize optimization
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');

    if (!isImg && !isVid) {
      showNativeToast('Please select a valid image or video file');
      return;
    }

    setUploadError(null);
    setUploadProgress(0);

    if (isVid) {
      if (file.size > 25 * 1024 * 1024) {
        showNativeToast('Video size must be under 25 MB');
        return;
      }
      const videoObjectUrl = URL.createObjectURL(file);
      setSelectedRawFile(file);
      setPreviewIsVideo(true);
      setPreviewImage(videoObjectUrl);
      setIsUploadModalOpen(true);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showNativeToast('Image size must be under 10 MB');
      return;
    }

    setSelectedRawFile(file);
    setPreviewIsVideo(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Optimize and resize image for fast uploading & crisp mobile display
        const canvas = document.createElement('canvas');
        const maxDim = 1400;
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
          setPreviewImage(compressedBase64);
          setIsUploadModalOpen(true);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Submit and upload photo/video to Cloudinary + push notification to APK & Firestore
  const handleUploadSubmit = async () => {
    if (!previewImage) return;

    setIsUploading(true);
    setUploadProgress(1);
    setUploadError(null);
    triggerHaptic(60);

    const caption = captionInput.trim() || 'A sweet surprise memory for you 💕';

    try {
      const uploadInput: Blob | File | string =
        previewIsVideo && selectedRawFile ? selectedRawFile : previewImage;

      const uploaded = await uploadMediaToCloudinary(
        uploadInput,
        'memories',
        (pct) => setUploadProgress(pct)
      );

      const newPhoto: GalleryPhoto = {
        id: `surprise-${Date.now()}`,
        url: uploaded.secureUrl,
        storagePath: uploaded.secureUrl,
        cloudinaryPublicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
        caption,
        timestamp: Date.now(),
        likes: 1,
        type: 'surprise',
      };

      setPhotos((prev) => {
        const next = [newPhoto, ...prev];
        try {
          localStorage.setItem('kashish_cached_gallery', JSON.stringify(next.slice(0, 30)));
        } catch {}
        return next;
      });

      incrementStat('selfies_sent');
      showNativeToast('Added to Gallery! 💖');
      logNativeActivity(`📸 ${name} uploaded a new photo to Gallery: "${caption}"`);

      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        setIsUploadModalOpen(false);
        setPreviewImage(null);
        setSelectedRawFile(null);
        setPreviewIsVideo(false);
        setUploadProgress(0);
        setCaptionInput('');
      }, 1400);
    } catch (error: any) {
      console.error('Gallery upload error:', error);
      const msg = error?.message || 'Upload failed.';
      setUploadError(msg);
      showNativeToast(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleLike = (photo: GalleryPhoto, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    triggerHaptic(40);

    const isCurrentlyLiked = !!userLikedPhotos[photo.id];
    const newLikedStatus = !isCurrentlyLiked;

    setUserLikedPhotos(prev => ({
      ...prev,
      [photo.id]: newLikedStatus,
    }));

    setPhotos(prev => {
      const next = prev.map(p => {
        if (p.id === photo.id) {
          return {
            ...p,
            likes: newLikedStatus ? p.likes + 1 : Math.max(0, p.likes - 1),
          };
        }
        return p;
      });
      try {
        localStorage.setItem('kashish_cached_gallery', JSON.stringify(next.slice(0, 30)));
      } catch {}
      return next;
    });

    if (selectedPhoto && selectedPhoto.id === photo.id) {
      setSelectedPhoto(prev => prev ? {
        ...prev,
        likes: newLikedStatus ? prev.likes + 1 : Math.max(0, prev.likes - 1),
      } : null);
    }
  };

  const filteredPhotos = photos.filter(p => {
    if (filter === 'surprise') return p.type === 'surprise';
    if (filter === 'curated') return p.isCurated;
    return true;
  });

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl mx-auto pb-16">
      {/* Header Banner */}
      <section
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--card-border)',
          boxShadow: '0 6px 24px var(--shadow-color)',
        }}
        className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border text-center transition-all"
      >
        <div className="max-w-2xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500/10 border border-rose-500/20 text-[var(--accent)]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Cherished Sanctuary</span>
          </div>

          <h1 className="font-serif text-3xl sm:text-4xl font-bold flex items-center justify-center gap-3">
            <Images className="w-8 h-8 text-[var(--accent)]" />
            <span>Memories of Kashish 💖</span>
          </h1>

          <p className="text-xs sm:text-sm text-[var(--text-soft)] font-medium leading-relaxed">
            Every photo carries a gentle whisper of love. Add a new surprise picture anytime — it instantly pops up with love and sends a surprise notification! ✨
          </p>

          {/* Action & Upload Bar */}
          {site.features?.galleryUpload !== false && (
            <div className="pt-3 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => {
                  triggerHaptic(40);
                  fileInputRef.current?.click();
                }}
                style={{
                  background: 'linear-gradient(135deg, #ec4899 0%, #e11d48 50%, #be123c 100%)',
                  boxShadow: '0 6px 20px rgba(225, 29, 72, 0.4)',
                }}
                className="px-5 py-3 rounded-2xl text-white font-bold text-xs sm:text-sm flex items-center gap-2 hover:scale-105 active:scale-95 transition-all cursor-pointer shadow-md"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>Add Surprise Photo</span>
              </button>

              <button
                onClick={() => {
                  triggerHaptic(40);
                  if (isNativeApp()) {
                    requestNativePermissions(['CAMERA']);
                  }
                  cameraInputRef.current?.click();
                }}
                style={{
                  backgroundColor: 'var(--card-subtle)',
                  borderColor: 'var(--card-border)',
                  color: 'var(--text)',
                }}
                className="px-4 py-3 rounded-2xl border font-bold text-xs sm:text-sm flex items-center gap-2 hover:scale-105 active:scale-95 transition-all cursor-pointer shadow-xs"
              >
                <Camera className="w-4 h-4 text-[var(--accent)]" />
                <span>Take Live Pic</span>
              </button>
            </div>
          )}

          {/* Hidden File & Camera Inputs */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
            className="hidden"
          />
          <input
            type="file"
            ref={cameraInputRef}
            onChange={handleFileChange}
            accept="image/*"
            capture="user"
            className="hidden"
          />
        </div>
      </section>

      {/* Dynamic Slot: Gallery Top */}
      <DynamicSlot slotId="gallery_top" isDarkMode={isDarkMode} />

      {/* Filter Tabs */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto px-1 py-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { triggerHaptic(20); setFilter('all'); }}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
              filter === 'all'
                ? 'bg-rose-500 text-white shadow-sm'
                : 'bg-[var(--card-subtle)] text-[var(--text-soft)] border border-[var(--card-border)] hover:text-[var(--text)]'
            }`}
          >
            All Moments ({photos.length})
          </button>
          <button
            onClick={() => { triggerHaptic(20); setFilter('surprise'); }}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
              filter === 'surprise'
                ? 'bg-rose-500 text-white shadow-sm'
                : 'bg-[var(--card-subtle)] text-[var(--text-soft)] border border-[var(--card-border)] hover:text-[var(--text)]'
            }`}
          >
            ✨ Surprises & Selfies
          </button>
          <button
            onClick={() => { triggerHaptic(20); setFilter('curated'); }}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
              filter === 'curated'
                ? 'bg-rose-500 text-white shadow-sm'
                : 'bg-[var(--card-subtle)] text-[var(--text-soft)] border border-[var(--card-border)] hover:text-[var(--text)]'
            }`}
          >
            💌 Cherished Moments
          </button>
        </div>

        <span className="text-[11px] font-semibold text-[var(--text-soft)] hidden sm:inline">
          Tap any photo to view full size
        </span>
      </div>

      {/* Photos Masonry / Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {filteredPhotos.map((photo) => {
          const isLiked = !!userLikedPhotos[photo.id];
          return (
            <motion.div
              key={photo.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25 }}
              onClick={() => {
                triggerHaptic(30);
                setSelectedPhoto(photo);
                logNativeActivity(`🖼️ Viewed media: "${photo.caption}"`, false, 'media_viewed');
                if (photo.isFirestore) {
                  updateDoc(doc(db, 'media', photo.id), { views: increment(1) }).catch(() => {});
                }
              }}
              style={{
                backgroundColor: 'var(--card)',
                borderColor: 'var(--card-border)',
                boxShadow: '0 4px 16px var(--shadow-color)',
              }}
              className="group relative rounded-2xl overflow-hidden border cursor-pointer select-none transition-transform active:scale-[0.98]"
            >
              {/* Image/Video Container with 3:4 or 1:1 Aspect Ratio */}
              <div className="aspect-[3/4] w-full overflow-hidden bg-zinc-900/10 dark:bg-black/40 relative">
                {isVideoMedia(photo) ? (
                  <video
                    src={photo.url || photo.storagePath}
                    muted
                    playsInline
                    loop
                    onMouseOver={(e) => e.currentTarget.play().catch(() => {})}
                    onMouseOut={(e) => e.currentTarget.pause()}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <PrivateStorageImage
                    storagePath={photo.storagePath}
                    fallbackUrl={photo.url}
                    alt={photo.caption}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                )}

                {/* Top badges */}
                <div className="absolute top-2 left-2 flex items-center gap-1.5">
                  {photo.type === 'surprise' && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-rose-500/90 text-white backdrop-blur-md shadow-xs flex items-center gap-1">
                      <Sparkles className="w-2.5 h-2.5" />
                      <span>Surprise</span>
                    </span>
                  )}
                </div>

                {/* Heart Button Overlay */}
                <button
                  onClick={(e) => handleLike(photo, e)}
                  aria-label="Like photo"
                  className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition-all active:scale-90 ${
                    isLiked
                      ? 'bg-rose-500 text-white shadow-md'
                      : 'bg-black/40 text-white hover:bg-black/60'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${isLiked ? 'fill-white stroke-white' : 'stroke-white'}`} />
                </button>

                {/* Gradient and Caption Overlay on Hover / Bottom */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3 pt-6 flex flex-col justify-end">
                  <p className="text-white text-xs font-bold line-clamp-2 leading-tight drop-shadow-sm">
                    {photo.caption}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-white/80 font-medium pt-1">
                    <span className="flex items-center gap-1">
                      <Heart className={`w-3 h-3 ${isLiked ? 'text-rose-400 fill-rose-400' : 'text-white/70'}`} />
                      <span>{photo.likes}</span>
                    </span>
                    <span className="text-white/60 text-[9px] uppercase tracking-wider">View</span>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Empty State */}
      {filteredPhotos.length === 0 && (
        <div className="py-16 text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mx-auto">
            <Images className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-[var(--text)]">No photos found in this tab</h3>
          <p className="text-xs text-[var(--text-soft)]">Tap the button above to add a sweet surprise photo!</p>
        </div>
      )}

      {/* Dynamic Slot: Gallery Bottom */}
      <DynamicSlot slotId="gallery_bottom" isDarkMode={isDarkMode} />

      {/* Upload Preview & Caption Modal (Portaled to document.body to stay strictly viewport-bound) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isUploadModalOpen && previewImage && (
              <div className="fixed inset-0 z-[1200] w-screen h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  style={{
                    backgroundColor: 'var(--card)',
                    borderColor: 'var(--card-border)',
                    color: 'var(--text)',
                  }}
                  className="relative w-full max-w-md rounded-3xl border shadow-2xl overflow-hidden p-5 space-y-4 my-auto"
                >
                  {/* Close Button */}
                  <button
                    onClick={() => {
                      if (!isUploading) {
                        setIsUploadModalOpen(false);
                        setPreviewImage(null);
                      }
                    }}
                    disabled={isUploading}
                    className="absolute top-4 right-4 p-2 rounded-full bg-black/10 dark:bg-white/10 hover:bg-black/20 text-[var(--text)] transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>

                  <div className="text-center space-y-1 pt-1">
                    <h3 className="font-serif text-lg font-bold flex items-center justify-center gap-2">
                      <Sparkles className="w-5 h-5 text-[var(--accent)]" />
                      <span>Add New Surprise Photo</span>
                    </h3>
                    <p className="text-[11px] text-[var(--text-soft)]">
                      This photo will be visible in the room and will trigger a notification to the APK!
                    </p>
                  </div>

                  {/* Photo / Video Preview */}
                  <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-black/20 border border-white/10 relative">
                    {previewIsVideo ? (
                      <video
                        src={previewImage}
                        controls
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img
                        src={previewImage}
                        alt="Upload Preview"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>

                  {/* Upload Progress Bar */}
                  {isUploading && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-[var(--accent)]">
                        <span>Uploading to Cloudinary...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-pink-500 to-rose-600 transition-all duration-200"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Upload Error Banner */}
                  {uploadError && (
                    <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-500 text-xs font-semibold leading-relaxed">
                      {uploadError}
                    </div>
                  )}

                  {/* Caption Input */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-[var(--text-soft)] uppercase tracking-wider block">
                      Add a Sweet Note / Caption:
                    </label>
                    <input
                      type="text"
                      value={captionInput}
                      onChange={(e) => setCaptionInput(e.target.value)}
                      placeholder="e.g. A cute surprise smile for you 💕"
                      maxLength={100}
                      disabled={isUploading}
                      className="w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors"
                      style={{
                        backgroundColor: 'var(--card-subtle)',
                        borderColor: 'var(--card-border)',
                        color: 'var(--text)',
                      }}
                    />
                  </div>

                  {/* Submit Button */}
                  <div className="pt-2 flex gap-2">
                    <button
                      onClick={() => {
                        setIsUploadModalOpen(false);
                        setPreviewImage(null);
                        setSelectedRawFile(null);
                        setPreviewIsVideo(false);
                        setUploadError(null);
                        setUploadProgress(0);
                      }}
                      disabled={isUploading}
                      className="flex-1 py-3 rounded-xl border text-xs font-bold text-[var(--text-soft)] hover:text-[var(--text)] transition-colors cursor-pointer"
                      style={{ borderColor: 'var(--card-border)' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUploadSubmit}
                      disabled={isUploading}
                      style={{
                        background: 'linear-gradient(135deg, #ec4899 0%, #e11d48 100%)',
                      }}
                      className="flex-[2] py-3 rounded-xl text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Uploading ({uploadProgress}%)...</span>
                        </>
                      ) : isSuccess ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Surprise Added! 💖</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          <span>Publish & Notify APK 💌</span>
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Fullscreen Lightbox Modal (Portaled to document.body & locked to 100dvh viewport) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {selectedPhoto && (
              <div
                onClick={() => setSelectedPhoto(null)}
                className="fixed inset-0 z-[1400] w-screen h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none bg-black/92 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 animate-fade-in select-none"
              >
                {/* Top Toolbar */}
                <div className="flex items-center justify-between text-white z-10 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="font-serif text-sm sm:text-base font-bold">
                      {selectedPhoto.type === 'surprise' ? '✨ Sweet Surprise' : '💌 Cherished Memory'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => handleLike(selectedPhoto, e)}
                      className={`p-2.5 rounded-full backdrop-blur-md transition-transform active:scale-90 ${
                        userLikedPhotos[selectedPhoto.id] ? 'bg-rose-500 text-white' : 'bg-white/20 text-white'
                      }`}
                    >
                      <Heart className={`w-5 h-5 ${userLikedPhotos[selectedPhoto.id] ? 'fill-white stroke-white' : 'stroke-white'}`} />
                    </button>
                    <button
                      onClick={() => setSelectedPhoto(null)}
                      className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Central High-Res Photo / Video Container */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-h-0 flex items-center justify-center p-2 overflow-hidden"
                >
                  {isVideoMedia(selectedPhoto) ? (
                    <video
                      src={selectedPhoto.url || selectedPhoto.storagePath}
                      controls
                      autoPlay
                      playsInline
                      className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl border border-white/10"
                    />
                  ) : (
                    <PrivateStorageImage
                      storagePath={selectedPhoto.storagePath}
                      fallbackUrl={selectedPhoto.url}
                      alt={selectedPhoto.caption}
                      className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl border border-white/10"
                    />
                  )}
                </div>

                {/* Bottom Caption & Stats */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="bg-zinc-950/80 backdrop-blur-md border border-white/10 p-4 rounded-2xl max-w-xl mx-auto w-full text-center space-y-1.5 shrink-0"
                >
                  <p className="text-white text-sm sm:text-base font-bold">
                    {selectedPhoto.caption}
                  </p>
                  <div className="flex items-center justify-center gap-4 text-xs text-white/60 font-medium">
                    <span className="flex items-center gap-1">
                      <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
                      <span>{selectedPhoto.likes} loves</span>
                    </span>
                    <span>•</span>
                    <span>Tap outside to close</span>
                  </div>
                </div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
};
