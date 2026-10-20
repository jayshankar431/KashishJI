import React, { useState, useEffect } from 'react';
import { resolveFirestoreMediaUrl } from '../androidBridge';

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
  React.ImgHTMLAttributes<HTMLImageElement> & { storagePath?: string; fallbackUrl?: string }
> = ({ storagePath, fallbackUrl, className = '', onLoad, ...props }) => {
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
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
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

