import React, { useEffect, useRef } from 'react';

interface BackgroundEffectsProps {
  isDarkMode: boolean;
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

export const BackgroundEffects: React.FC<BackgroundEffectsProps> = ({ isDarkMode }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Check prefers-reduced-motion
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      return;
    }

    let animationFrameId: number | null = null;
    let isVisible = !document.hidden;

    // Cap devicePixelRatio at 2 to prevent GPU fill-rate throttling on ultra high-DPI phones
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

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

    // Handle tab visibility to save battery and maintain 60fps
    const handleVisibilityChange = () => {
      isVisible = !document.hidden;
      if (isVisible && !animationFrameId) {
        animationFrameId = requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Limit particle counts: 32 on mobile, 64 on desktop for butter-smooth 60fps
    const particleCount = width < 640 ? 32 : 64;
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

    let lastTime = performance.now();

    const render = (currentTime: number) => {
      if (!isVisible) {
        animationFrameId = null;
        return;
      }

      // Delta time normalized to 60fps baseline (~16.67ms) to support up to 120Hz smoothly
      const elapsed = currentTime - lastTime;
      lastTime = currentTime;
      const dt = Math.min(elapsed / 16.67, 2.5);

      ctx.clearRect(0, 0, width, height);

      const heartColor = isDarkMode ? '#f472b6' : '#fb7185';
      const petalColor = isDarkMode ? '#e879f9' : '#fbcfe8';
      const sparkleColor = isDarkMode ? '#fef08a' : '#fde047';

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

    animationFrameId = requestAnimationFrame(render);

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isDarkMode]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 transition-opacity duration-700"
      style={{
        opacity: isDarkMode ? 0.45 : 0.65,
        transform: 'translateZ(0)',
        willChange: 'opacity',
      }}
    />
  );
};
