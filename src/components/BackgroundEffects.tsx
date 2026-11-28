import React, { useEffect, useRef } from 'react';
import { isLowPerfDevice } from '../utils/perfTier';

interface BackgroundEffectsProps {
  isDarkMode: boolean;
  isPaused?: boolean;
}

interface Particle {
  x: number;
  y: number;
  size: number;
  speedY: number;
  speedX: number;
  opacity: number;
  fadeSpeed: number;
  rotation: number;
  rotSpeed: number;
  type: 'heart' | 'sparkle' | 'petal';
}

export const BackgroundEffects: React.FC<BackgroundEffectsProps> = ({
  isDarkMode,
  isPaused = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDarkModeRef = useRef<boolean>(isDarkMode);
  const isPausedRef = useRef<boolean>(isPaused);
  const syncActiveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    isDarkModeRef.current = isDarkMode;
  }, [isDarkMode]);

  useEffect(() => {
    isPausedRef.current = isPaused;
    syncActiveRef.current?.();
  }, [isPaused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Respect prefers-reduced-motion
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      return;
    }

    const lowPerf = isLowPerfDevice();
    let animationFrameId: number | null = null;
    let overlayLocked = false;
    let lastFrameTime = 0;

    // Frame budget: ~30fps on high-end, ~24fps on low-end so UI/audio threads stay butter-smooth
    const minFrameIntervalMs = lowPerf ? 42 : 33;

    const isBodyModalOpen = () => {
      if (typeof document === 'undefined') return false;
      return (
        document.body.style.overflow === 'hidden' ||
        document.documentElement.style.overflow === 'hidden' ||
        overlayLocked
      );
    };

    const checkIsActive = () =>
      !document.hidden &&
      !Boolean((window as any).__kashishAppInBackground) &&
      !isPausedRef.current &&
      !isBodyModalOpen();

    let isVisible = checkIsActive();

    // Cap devicePixelRatio: 1.0 on low-perf devices, 1.5 on high-perf devices
    const dpr = lowPerf
      ? 1
      : Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5);

    let width = window.innerWidth;
    let height = window.innerHeight;

    const setupCanvas = () => {
      if (!canvas) return;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    setupCanvas();

    const handleResize = () => {
      setupCanvas();
    };

    window.addEventListener('resize', handleResize, { passive: true });

    const syncAnimationState = (active: boolean) => {
      isVisible = active;
      if (!isVisible) {
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
      } else if (animationFrameId === null) {
        lastTime = performance.now();
        animationFrameId = requestAnimationFrame(render);
      }
    };

    syncActiveRef.current = () => {
      syncAnimationState(checkIsActive());
    };

    // Pause animation loop whenever tab is hidden, native app is backgrounded, or a full-screen modal/player opens
    const handleVisibilityChange = () => {
      syncAnimationState(checkIsActive());
    };
    const handleNativeBackgroundState = (ev: Event) => {
      const detail = (ev as CustomEvent<{ backgrounded?: boolean }>).detail;
      const inBg = Boolean(detail?.backgrounded ?? (window as any).__kashishAppInBackground);
      syncAnimationState(!inBg && checkIsActive());
    };
    const handleOverlayPauseEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<{ paused?: boolean }>).detail;
      overlayLocked = Boolean(detail?.paused);
      syncAnimationState(checkIsActive());
    };
    const handleWindowBlur = () => {
      if ((window as any).__kashishAppInBackground) {
        syncAnimationState(false);
      }
    };
    const handleWindowFocus = () => {
      syncAnimationState(checkIsActive());
    };

    // Watch body style overflow changes (used by full-screen modals, lightboxes, and players)
    let bodyStyleObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      bodyStyleObserver = new MutationObserver(() => {
        syncAnimationState(checkIsActive());
      });
      bodyStyleObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['style'],
      });
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('kashish-app-background-state', handleNativeBackgroundState as EventListener);
    window.addEventListener('kashish-overlay-pause', handleOverlayPauseEvent as EventListener);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    // Particle counts: ~45% fewer particles in low-perf mode (11 mobile / 22 desktop vs 20 / 42)
    const baseCount = width < 640 ? 20 : 42;
    const particleCount = lowPerf ? Math.max(8, Math.round(baseCount * 0.55)) : baseCount;
    const particles: Particle[] = [];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 8 + 4,
        speedY: Math.random() * 0.9 + 0.35,
        speedX: (Math.random() - 0.5) * 0.25,
        opacity: Math.random() * 0.45 + 0.15,
        fadeSpeed: (Math.random() - 0.5) * 0.005,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.012,
        type: Math.random() > 0.45 ? 'heart' : Math.random() > 0.5 ? 'petal' : 'sparkle',
      });
    }

    const drawHeart = (c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, alpha: number) => {
      c.save();
      c.translate(x, y);
      c.globalAlpha = alpha;
      c.fillStyle = color;
      c.beginPath();
      const topCurveHeight = s * 0.3;
      c.moveTo(0, topCurveHeight);
      c.bezierCurveTo(0, 0, -s / 2, 0, -s / 2, topCurveHeight);
      c.bezierCurveTo(-s / 2, (s + topCurveHeight) / 2, 0, (s + topCurveHeight) / 1.4, 0, s);
      c.bezierCurveTo(0, (s + topCurveHeight) / 1.4, s / 2, (s + topCurveHeight) / 2, s / 2, topCurveHeight);
      c.bezierCurveTo(s / 2, 0, 0, 0, 0, topCurveHeight);
      c.closePath();
      c.fill();
      c.restore();
    };

    const drawPetal = (c: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, color: string, alpha: number) => {
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.globalAlpha = alpha;
      c.fillStyle = color;
      c.beginPath();
      c.ellipse(0, 0, s * 0.35, s * 0.85, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    };

    const drawSparkle = (c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, alpha: number) => {
      c.save();
      c.translate(x, y);
      c.globalAlpha = alpha;
      c.fillStyle = color;
      c.beginPath();
      c.arc(0, 0, s * 0.22, 0, Math.PI * 2);
      c.fill();
      c.restore();
    };

    // Smoothly interpolate between light (0) and dark (1) palette without resetting particles
    let themeMix = isDarkModeRef.current ? 1 : 0;
    const lerpChannel = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

    let lastTime = performance.now();

    const render = (currentTime: number) => {
      if (!isVisible || !checkIsActive()) {
        animationFrameId = null;
        return;
      }

      if (currentTime - lastFrameTime < minFrameIntervalMs) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }
      lastFrameTime = currentTime;

      const elapsed = currentTime - lastTime;
      lastTime = currentTime;
      const dt = Math.min(elapsed / 16.67, 2.5);

      const targetMix = isDarkModeRef.current ? 1 : 0;
      if (Math.abs(targetMix - themeMix) > 0.002) {
        themeMix += (targetMix - themeMix) * Math.min(1, 0.14 * dt);
      } else {
        themeMix = targetMix;
      }

      ctx.clearRect(0, 0, width, height);

      const heartColor = `rgb(${lerpChannel(251, 244, themeMix)}, ${lerpChannel(113, 114, themeMix)}, ${lerpChannel(133, 182, themeMix)})`;
      const petalColor = `rgb(${lerpChannel(251, 232, themeMix)}, ${lerpChannel(207, 121, themeMix)}, ${lerpChannel(232, 249, themeMix)})`;
      const sparkleColor = `rgb(${lerpChannel(253, 254, themeMix)}, ${lerpChannel(224, 240, themeMix)}, ${lerpChannel(71, 138, themeMix)})`;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.y += p.speedY * dt;
        p.x += p.speedX * dt;
        p.rotation += p.rotSpeed * dt;
        p.opacity += p.fadeSpeed * dt;

        if (p.opacity > 0.75 || p.opacity < 0.12) {
          p.fadeSpeed = -p.fadeSpeed;
        }

        if (p.y > height + 16) {
          p.y = -16;
          p.x = Math.random() * width;
        }
        if (p.x < -16) p.x = width + 16;
        if (p.x > width + 16) p.x = -16;

        if (p.type === 'heart') {
          drawHeart(ctx, p.x, p.y, p.size, heartColor, p.opacity);
        } else if (p.type === 'petal') {
          drawPetal(ctx, p.x, p.y, p.size, p.rotation, petalColor, p.opacity * 0.65);
        } else {
          drawSparkle(ctx, p.x, p.y, p.size, sparkleColor, p.opacity);
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    if (isVisible) {
      animationFrameId = requestAnimationFrame(render);
    }

    return () => {
      syncActiveRef.current = null;
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      if (bodyStyleObserver) bodyStyleObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('kashish-app-background-state', handleNativeBackgroundState as EventListener);
      window.removeEventListener('kashish-overlay-pause', handleOverlayPauseEvent as EventListener);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 transition-opacity duration-300"
      style={{
        opacity: isDarkMode ? 0.45 : 0.65,
        transform: 'translate3d(0, 0, 0)',
        willChange: 'opacity',
      }}
    />
  );
};
