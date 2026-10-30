import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Upload, Check, Loader2, X, Heart, Sparkles } from 'lucide-react';
import { triggerHaptic, showNativeToast, logNativeActivity, logSelfieToFirestore, incrementStat, isNativeApp, requestNativePermissions } from '../androidBridge';
import { DynamicSlot } from './DynamicSlot';
import { PrivateStorageImage, ZoomablePhotoViewer } from './PrivateStorageMedia';

const preparePhoto = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('The selected photo could not be read.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The selected photo could not be read.'));
        return;
      }

      const image = new Image();
      image.onerror = () => reject(new Error('The selected photo could not be decoded.'));
      image.onload = () => {
        const maxDimension = 1600;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));

        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Photo processing is unavailable.'));
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

interface CutePicSectionProps {
  onBack: () => void;
}

export const CutePicSection: React.FC<CutePicSectionProps> = ({ onBack }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [sentPics, setSentPics] = useState<{ id: string; url: string; storagePath?: string; caption: string }[]>([]);
  const [selectedSentPic, setSelectedSentPic] = useState<{ id: string; url: string; storagePath?: string; caption: string } | null>(null);
  const uploadInProgressRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Lock background scroll whenever camera overlay or photo preview is open
  useEffect(() => {
    if (!showCamera && !selectedSentPic) return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [showCamera, selectedSentPic]);

  // Load selfies saved locally
  useEffect(() => {
    try {
      const raw = localStorage.getItem('kashish_sent_selfies');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSentPics(parsed);
        }
      }
    } catch {}
  }, []);

  // Safely attach stream to video element when camera overlay renders
  useEffect(() => {
    if (showCamera && cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().catch((err) => {
        console.warn("Video play error:", err);
        setIsCameraReady(false);
      });
    }
  }, [showCamera, cameraStream]);

  // Clean up media tracks when unmounting to prevent camera remaining open in background
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraStream]);

  const handleShyClick = () => {
    incrementStat('shy_clicks');
    logNativeActivity("🙈 Kashish was going to send a pic but got shy!");
    onBack();
  };

  const handleUpload = async (imageBody: string) => {
    if (uploadInProgressRef.current) return;

    uploadInProgressRef.current = true;
    setIsUploading(true);
    setUploadProgress(1);
    setUploadError(null);
    triggerHaptic(60);

    try {
      const uploaded = await logSelfieToFirestore(
        "Cute pic to make his day! 💖",
        imageBody,
        undefined,
        (pct) => setUploadProgress(pct)
      );

      if (uploaded?.secureUrl) {
        const newPic = {
          id: `selfie-${Date.now()}`,
          url: uploaded.secureUrl,
          storagePath: uploaded.secureUrl,
          caption: 'Cute Pic 💖',
        };
        setSentPics((prev) => [newPic, ...prev].slice(0, 12));
      }

      await incrementStat('selfies_sent');
      setIsSuccess(true);
      showNativeToast("Cute pic saved! 💖");
    } catch (error: any) {
      console.error('Upload error:', error);
      const errMsg = error?.message || "Error saving pic.";
      setUploadError(errMsg);
      showNativeToast(errMsg);
    } finally {
      uploadInProgressRef.current = false;
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.type && !file.type.startsWith('image/')) {
      showNativeToast('Please select a valid image file.');
      return;
    }

    try {
      const imageData = await preparePhoto(file);
      await handleUpload(imageData);
    } catch (error) {
      console.error('Photo preparation failed:', error);
      showNativeToast('Could not open this photo. Please try another one.');
    }
  };

  const startCamera = async () => {
    if (isStartingCamera || isUploading) return;

    setIsStartingCamera(true);
    setIsCameraReady(false);
    triggerHaptic(40);
    console.log('CutePicSection: Starting camera, isNativeApp:', isNativeApp());
    
    // Explicitly request native permissions if in APK
    if (isNativeApp()) {
      requestNativePermissions(['CAMERA']);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' },
        audio: false 
      });
      console.log('CutePicSection: Camera access granted');
      setCameraStream(stream);
      setShowCamera(true);
    } catch (err) {
      console.error("CutePicSection: Camera access denied or unavailable:", err);
      showNativeToast("Could not open live camera. Opening camera capture... 📸");
      // Fallback to native camera input if getUserMedia fails
      cameraInputRef.current?.click();
    } finally {
      setIsStartingCamera(false);
    }
  };

  const stopCamera = () => {
    setIsCameraReady(false);
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (isCameraReady && videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.85);
        handleUpload(base64);
        stopCamera();
      }
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-xl mx-auto pb-12">
      <div className="text-center space-y-2">
        <h2 className="font-serif text-3xl sm:text-4xl font-bold flex items-center justify-center gap-3">
          <Camera className="w-8 h-8 text-[var(--accent)]" />
          <span>Make His Day! 💖</span>
        </h2>
        <p className="text-sm text-[var(--text-soft)] italic font-medium px-4">
          "Your smile is the most beautiful thing in his world. Send him a cute pic to light up his day!"
        </p>
      </div>

      <div
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--card-border)',
          boxShadow: '0 8px 30px var(--shadow-color)',
        }}
        className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border text-center transition-all"
      >
        <div className="space-y-6 py-6">
          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="w-20 h-20 rounded-full flex items-center justify-center bg-rose-500/15 border border-rose-400/40 shadow-[0_0_20px_rgba(244,114,182,0.3)]">
              {isSuccess ? (
                <Check className="w-9 h-9 text-emerald-500 animate-fade-in" />
              ) : (
                <Heart className="w-9 h-9 text-rose-500 fill-rose-500 animate-pulse" />
              )}
            </div>
            <p className="text-xs text-[var(--text-soft)] font-serif italic tracking-wide">
              {isSuccess ? "Delivered with all my love" : "Capturing a moment just for him"}
            </p>
          </div>

          {isSuccess ? (
            <div className="space-y-2 animate-fade-in py-4">
              <h3 className="text-2xl font-bold text-emerald-500 font-serif">Thank you for making his day! 💖✨</h3>
              <p className="text-sm text-[var(--text-soft)] italic font-medium">
                "Your cute picture has reached him and brought a big smile to his face."
              </p>
              <div className="pt-4">
                 <button
                  onClick={() => setIsSuccess(false)}
                  className="px-6 py-2.5 rounded-xl bg-[var(--card-subtle)] border border-[var(--card-border)] text-xs font-bold cursor-pointer hover:scale-105 transition-transform"
                >
                  Send another surprise? 📸
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {isUploading && (
                <div className="space-y-2 py-2 max-w-xs mx-auto">
                  <div className="flex items-center justify-between text-xs font-bold text-rose-500">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Uploading to Cloudinary...</span>
                    </span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-rose-500/15 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-rose-500 to-pink-600 transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {uploadError && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-500 text-xs font-semibold">
                  {uploadError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={startCamera}
                  disabled={isStartingCamera || isUploading}
                  className="flex-1 px-6 py-4 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-600 text-white font-bold text-base shadow-lg hover:scale-105 active:scale-95 transition-all flex flex-col items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                >
                  {isStartingCamera ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
                  <span>{isStartingCamera ? 'Opening Camera...' : 'Take a Selfie'}</span>
                </button>
                <button
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={isUploading || isStartingCamera}
                  style={{
                    backgroundColor: 'var(--card-subtle)',
                    borderColor: 'var(--card-border)',
                    color: 'var(--text)',
                  }}
                  className="flex-1 px-6 py-4 rounded-2xl border font-bold text-base shadow-lg hover:scale-105 active:scale-95 transition-colors flex flex-col items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                >
                  <Upload className="w-6 h-6 text-[var(--accent)]" />
                  <span>From Gallery</span>
                </button>
              </div>
            </div>
          )}

          <input
            type="file"
            ref={galleryInputRef}
            onChange={handleFileChange}
            accept="image/*"
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

      </div>

      {/* Real-time Camera Overlay (Portaled to document.body & locked to 100dvh viewport) */}
      {showCamera &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[1500] w-screen h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none bg-black flex flex-col animate-fade-in">
            <div className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                onCanPlay={() => setIsCameraReady(true)}
                className="w-full h-full object-cover mirror"
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
              />

              {/* Camera Header */}
              <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/60 to-transparent flex justify-between items-center">
                <span className="text-white font-bold text-sm uppercase tracking-widest">Selfie Mode</span>
                <button
                  onClick={stopCamera}
                  className="p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="bg-zinc-950 p-6 sm:p-8 flex flex-col items-center gap-5 shrink-0">
              <div className="flex items-center gap-8">
                <div className="w-12 h-12" /> {/* Spacer */}
                <button
                  onClick={capturePhoto}
                  disabled={!isCameraReady || isUploading}
                  className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center group active:scale-90 transition-transform disabled:opacity-50 disabled:cursor-wait cursor-pointer"
                >
                  <div className="w-16 h-16 rounded-full bg-white group-hover:bg-rose-100 transition-colors" />
                </button>
                <button
                  onClick={() => {
                    stopCamera();
                    galleryInputRef.current?.click();
                  }}
                  className="w-12 h-12 rounded-full bg-zinc-800 text-white flex items-center justify-center hover:bg-zinc-700 transition-colors cursor-pointer"
                >
                  <Upload className="w-5 h-5" />
                </button>
              </div>
              <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.2em]">Tap white button to capture</p>
            </div>

            {/* Hidden canvas for processing */}
            <canvas ref={canvasRef} className="hidden" />
          </div>,
          document.body
        )}

      {/* Fullscreen Lightbox for Sent Cute Pics */}
      {selectedSentPic &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={() => setSelectedSentPic(null)}
            className="fixed inset-0 z-[1500] w-screen h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none bg-black/92 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 animate-fade-in select-none"
          >
            <div className="flex items-center justify-between text-white z-10 shrink-0">
              <span className="font-serif text-sm sm:text-base font-bold">💖 Sent Cute Pic</span>
              <button
                onClick={() => setSelectedSentPic(null)}
                className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-h-0 flex items-center justify-center p-2 overflow-hidden"
            >
              <ZoomablePhotoViewer
                storagePath={selectedSentPic.storagePath}
                fallbackUrl={selectedSentPic.url}
                alt={selectedSentPic.caption}
              />
            </div>
            <div className="text-center text-xs text-white/70 shrink-0 pb-1">
              Pinch or double-tap to zoom • Tap outside to close
            </div>
          </div>,
          document.body
        )}

      {/* Recently Sent Surprises (Synced with Cloudinary + Telegram) */}
      {sentPics.length > 0 && (
        <div
          style={{
            backgroundColor: 'var(--card)',
            borderColor: 'var(--card-border)',
            boxShadow: '0 8px 30px var(--shadow-color)',
          }}
          className="rounded-3xl p-5 sm:p-6 border space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-lg font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--accent)]" />
              <span>Sent Cute Pics ({sentPics.length})</span>
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-soft)]">
              Saved in Cloud & Gallery 💖
            </span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
            {sentPics.map((pic) => (
              <div
                key={pic.id}
                onClick={() => {
                  triggerHaptic(25);
                  setSelectedSentPic(pic);
                }}
                className="aspect-square rounded-2xl overflow-hidden border border-white/10 bg-black/20 cursor-pointer active:scale-95 transition-transform"
              >
                <PrivateStorageImage
                  storagePath={pic.storagePath}
                  fallbackUrl={pic.url}
                  alt={pic.caption}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dynamic Slot: Cute Pic Bottom */}
      <DynamicSlot slotId="cute_pic_bottom" />

      <div className="text-center">
        <button
          onClick={handleShyClick}
          className="text-xs font-bold uppercase tracking-widest text-[var(--text-soft)] hover:text-[var(--accent)] transition-colors underline underline-offset-4"
        >
          Nevermind, I'm shy! 🙈
        </button>
      </div>
    </div>
  );
};
