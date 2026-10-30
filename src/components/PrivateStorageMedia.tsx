import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { resolveFirestoreMediaUrl, triggerHaptic } from '../androidBridge';

function pickValidUrl(storagePath?: string, fallbackUrl?: string): string {
  const isUrl = (v?: string) =>
    !!v &&
    (v.startsWith('http') ||
      v.startsWith('data:') ||
      v.startsWith('blob:') ||
      v.startsWith('firestore-chunked://') ||
      v.startsWith('/'));
  if (isUrl(fallbackUrl)) return fallbackUrl!;
  if (isUrl(storagePath)) return storagePath!;
  return fallbackUrl || storagePath || '';
}

export const PrivateStorageImage: React.FC<
  React.ImgHTMLAttributes<HTMLImageElement> & {
    storagePath?: string;
    fallbackUrl?: string;
    imgClassName?: string;
  }
> = ({ storagePath, fallbackUrl, className = '', imgClassName = 'w-full h-full object-cover', onLoad, ...props }) => {
  const rawUrl = pickValidUrl(storagePath, fallbackUrl);
  const [resolvedUrl, setResolvedUrl] = useState<string>(
    rawUrl.startsWith('firestore-chunked://') ? '' : rawUrl
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    if (!rawUrl) {
      setResolvedUrl('');
      return;
    }
    if (rawUrl.startsWith('firestore-chunked://')) {
      resolveFirestoreMediaUrl(rawUrl).then((u) => {
        if (active) setResolvedUrl(u);
      });
    } else {
      setResolvedUrl(rawUrl);
    }
    return () => {
      active = false;
    };
  }, [rawUrl]);

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      {(!resolvedUrl || !loaded) && (
        <div className="absolute inset-0 bg-slate-300/30 dark:bg-zinc-800/60 animate-pulse rounded-xl" />
      )}
      {resolvedUrl && (
        <img
          loading="lazy"
          decoding="async"
          {...props}
          src={resolvedUrl}
          onLoad={(e) => {
            setLoaded(true);
            if (onLoad) onLoad(e);
          }}
          className={`${imgClassName} transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
};

export interface ZoomablePhotoViewerProps {
  storagePath?: string;
  fallbackUrl?: string;
  alt?: string;
}

export const ZoomablePhotoViewer: React.FC<ZoomablePhotoViewerProps> = ({
  storagePath,
  fallbackUrl,
  alt = 'Memory',
}) => {
  const rawUrl = pickValidUrl(storagePath, fallbackUrl);
  const [resolvedUrl, setResolvedUrl] = useState<string>(
    rawUrl.startsWith('firestore-chunked://') ? '' : rawUrl
  );
  const [scale, setScale] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const scaleRef = useRef<number>(1);
  const offsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStartRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(
    null
  );
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);
  const lastTapTimeRef = useRef<number>(0);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  // Reset zoom and resolve URL when photo changes
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };

    let active = true;
    if (!rawUrl) {
      setResolvedUrl('');
      return;
    }
    if (rawUrl.startsWith('firestore-chunked://')) {
      resolveFirestoreMediaUrl(rawUrl).then((u) => {
        if (active) setResolvedUrl(u);
      });
    } else {
      setResolvedUrl(rawUrl);
    }
    return () => {
      active = false;
    };
  }, [rawUrl]);

  const clampScale = (val: number) => Math.min(5, Math.max(1, Number(val.toFixed(2))));

  const clampOffset = useCallback((nextX: number, nextY: number, currentScale: number) => {
    if (currentScale <= 1) return { x: 0, y: 0 };
    const maxPan = (currentScale - 1) * 260;
    return {
      x: Math.max(-maxPan, Math.min(maxPan, nextX)),
      y: Math.max(-maxPan, Math.min(maxPan, nextY)),
    };
  }, []);

  const handleZoomIn = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    triggerHaptic(15);
    const next = clampScale(scaleRef.current + 0.5);
    setScale(next);
  };

  const handleZoomOut = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    triggerHaptic(15);
    const next = clampScale(scaleRef.current - 0.5);
    setScale(next);
    setOffset((prev) => clampOffset(prev.x, prev.y, next));
  };

  const handleResetZoom = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    triggerHaptic(15);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleDoubleTapOrClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic(20);
    if (scaleRef.current > 1.05) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    } else {
      setScale(2.5);
      setOffset({ x: 0, y: 0 });
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    const next = clampScale(scaleRef.current + delta);
    setScale(next);
    setOffset((prev) => clampOffset(prev.x, prev.y, next));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scaleRef.current <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: offsetRef.current.x,
      startY: offsetRef.current.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStartRef.current || scaleRef.current <= 1) return;
    e.preventDefault();
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setOffset(
      clampOffset(
        dragStartRef.current.startX + dx,
        dragStartRef.current.startY + dy,
        scaleRef.current
      )
    );
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length === 2) {
      setIsDragging(false);
      pinchStartDistRef.current = getTouchDistance(e.touches);
      pinchStartScaleRef.current = scaleRef.current;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTimeRef.current < 280) {
        // Double tap detected
        triggerHaptic(20);
        if (scaleRef.current > 1.05) {
          setScale(1);
          setOffset({ x: 0, y: 0 });
        } else {
          setScale(2.5);
          setOffset({ x: 0, y: 0 });
        }
        lastTapTimeRef.current = 0;
        return;
      }
      lastTapTimeRef.current = now;

      if (scaleRef.current > 1) {
        setIsDragging(true);
        dragStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          startX: offsetRef.current.x,
          startY: offsetRef.current.y,
        };
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length === 2 && pinchStartDistRef.current) {
      const dist = getTouchDistance(e.touches);
      if (dist > 0) {
        const ratio = dist / pinchStartDistRef.current;
        const nextScale = clampScale(pinchStartScaleRef.current * ratio);
        setScale(nextScale);
        setOffset((prev) => clampOffset(prev.x, prev.y, nextScale));
      }
    } else if (
      e.touches.length === 1 &&
      isDragging &&
      dragStartRef.current &&
      scaleRef.current > 1
    ) {
      const dx = e.touches[0].clientX - dragStartRef.current.x;
      const dy = e.touches[0].clientY - dragStartRef.current.y;
      setOffset(
        clampOffset(
          dragStartRef.current.startX + dx,
          dragStartRef.current.startY + dy,
          scaleRef.current
        )
      );
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length < 2) {
      pinchStartDistRef.current = null;
    }
    if (e.touches.length === 0) {
      setIsDragging(false);
      dragStartRef.current = null;
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={handleDoubleTapOrClick}
      style={{ touchAction: 'none' }}
      className="relative w-full h-full flex items-center justify-center overflow-hidden select-none"
    >
      {resolvedUrl && (
        <img
          src={resolvedUrl}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transition: isDragging || pinchStartDistRef.current ? 'none' : 'transform 180ms ease-out',
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
          }}
          className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl border border-white/10 select-none"
        />
      )}

      {/* Floating Zoom Controls Pill */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-950/85 backdrop-blur-md border border-white/15 text-white shadow-xl"
      >
        <button
          type="button"
          onClick={handleZoomOut}
          disabled={scale <= 1}
          aria-label="Zoom out"
          className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition-all disabled:opacity-40 cursor-pointer"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleResetZoom}
          aria-label="Reset zoom"
          className="px-2 py-0.5 rounded-md hover:bg-white/15 text-xs font-mono font-bold tabular-nums cursor-pointer flex items-center gap-1"
        >
          <span>{Math.round(scale * 100)}%</span>
          {scale > 1 && <RotateCcw className="w-3 h-3 text-rose-400" />}
        </button>

        <button
          type="button"
          onClick={handleZoomIn}
          disabled={scale >= 5}
          aria-label="Zoom in"
          className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition-all disabled:opacity-40 cursor-pointer"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export const PrivateStorageAudio: React.FC<
  React.AudioHTMLAttributes<HTMLAudioElement> & { storagePath?: string; fallbackUrl?: string }
> = ({ storagePath, fallbackUrl, ...props }) => {
  const rawUrl = pickValidUrl(storagePath, fallbackUrl);
  const [resolvedUrl, setResolvedUrl] = useState<string>(
    rawUrl.startsWith('firestore-chunked://') ? '' : rawUrl
  );

  useEffect(() => {
    let active = true;
    if (rawUrl.startsWith('firestore-chunked://')) {
      resolveFirestoreMediaUrl(rawUrl).then((u) => {
        if (active) setResolvedUrl(u);
      });
    } else {
      setResolvedUrl(rawUrl);
    }
    return () => {
      active = false;
    };
  }, [rawUrl]);

  return resolvedUrl ? (
    <audio {...props} src={resolvedUrl} />
  ) : (
    <div className="text-[10px] text-zinc-500">Audio unavailable</div>
  );
};


