import React, { useState, useRef, useEffect } from 'react';
import { Gift, Sparkles, CheckCircle2 } from 'lucide-react';

interface AmazonGiftCard3DProps {
  voucherCode: string;
  recipientName?: string;
  amount?: string;
  isDarkMode?: boolean;
}

export const AmazonGiftCard3D: React.FC<AmazonGiftCard3DProps> = ({
  voucherCode,
  recipientName = 'Kashish',
  amount = '₹300',
  isDarkMode = true,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [glare, setGlare] = useState({ x: 50, y: 50, opacity: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [supportsHover, setSupportsHover] = useState(true);

  // Check system preferences for reduced motion & hover support
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(motionQuery.matches);

    const handleMotionChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    motionQuery.addEventListener?.('change', handleMotionChange);

    const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    setSupportsHover(hoverQuery.matches);

    const handleHoverChange = (e: MediaQueryListEvent) => setSupportsHover(e.matches);
    hoverQuery.addEventListener?.('change', handleHoverChange);

    return () => {
      motionQuery.removeEventListener?.('change', handleMotionChange);
      hoverQuery.removeEventListener?.('change', handleHoverChange);
    };
  }, []);

  // 3D Tilt calculation on mouse move (desktop)
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || !supportsHover || !cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const xPct = (mouseX / width) * 100;
    const yPct = (mouseY / height) * 100;

    // Calculate rotation: max ±10deg X (vertical tilt) and ±12deg Y (horizontal tilt)
    const rotX = -((mouseY - height / 2) / (height / 2)) * 10;
    const rotY = ((mouseX - width / 2) / (width / 2)) * 12;

    setRotate({ x: rotX, y: rotY });
    setGlare({ x: xPct, y: yPct, opacity: 0.45 });
  };

  const handleMouseEnter = () => {
    if (!prefersReducedMotion && supportsHover) {
      setIsHovered(true);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setRotate({ x: 0, y: 0 });
    setGlare((prev) => ({ ...prev, opacity: 0 }));
  };

  return (
    <div className="w-full flex justify-center py-2 px-1 select-text">
      <div className="w-full max-w-[420px] relative">
        {/* Card Frame */}
        <div
          ref={cardRef}
          onMouseMove={handleMouseMove}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            boxShadow: '0 12px 30px -10px rgba(0, 0, 0, 0.8), 0 0 18px rgba(245, 158, 11, 0.2)',
          }}
          className="relative rounded-[22px] border border-amber-500/40 p-4 sm:p-5.5 text-white overflow-hidden"
        >
          {/* Base Card Background: Deep Navy Obsidian & Golden Radial Accents */}
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at 15% 15%, #1e293b 0%, #0f172a 35%, #090e1a 70%, #030712 100%)',
            }}
          />

          {/* Golden Ribbon Motif */}
          <div
            aria-hidden="true"
            className="absolute -right-12 -top-12 w-48 h-48 pointer-events-none opacity-35"
            style={{
              background:
                'radial-gradient(circle at center, rgba(245, 158, 11, 0.35) 0%, rgba(217, 119, 6, 0.15) 45%, transparent 70%)',
            }}
          />

          {/* CARD FOREGROUND CONTENT */}
          <div className="relative z-10 flex flex-col justify-between space-y-3.5">
            {/* TOP ROW: Minimalist Amazon Identifier + Amount Balance */}
            <div className="flex items-start justify-between gap-3">
              {/* Minimal Amazon-Inspired Identifier (Gift-focused, minimal branding) */}
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 p-[1px] shadow-md shadow-amber-500/20">
                  <div className="w-full h-full rounded-[11px] bg-slate-950/90 flex items-center justify-center text-amber-400">
                    {/* Stylized Amazon 'a' with the iconic smile curve */}
                    <svg
                      viewBox="0 0 24 24"
                      className="w-5 h-5 fill-current text-amber-300 drop-shadow-xs"
                    >
                      {/* Letter 'a' and smile arc */}
                      <path d="M13.8 13.7c-.2-.1-.5-.2-.8-.2-.7 0-1.2.3-1.2.9 0 .6.4.9 1.1.9.5 0 .9-.2 1-.4v-1.2zm1.7 2.5c-.4.4-1.1.6-1.9.6-1.4 0-2.4-.8-2.4-2.2 0-1.7 1.3-2.3 3.4-2.3.3 0 .6 0 .9.1v-.6c0-.8-.5-1.2-1.6-1.2-.7 0-1.4.2-1.9.5l-.4-1.1c.7-.4 1.6-.6 2.6-.6 2 0 3 1 3 2.8v4.1zm-8.6 2.7c3.9 2.2 8.9 1.9 12.8-.5.3-.2.6.1.4.4-4.2 3.1-9.7 2.9-13.7.5-.4-.3-.1-.7.5-.4zm13.2-.1c-.3-.2-.5-.7-.4-1 .1-.3.8-.1 1.1.1.3.2.3.8.1 1.1-.2.2-.6.1-.8-.2z" />
                    </svg>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs sm:text-sm font-black tracking-wider text-amber-200">
                      amazon
                    </span>
                    <span className="text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">
                      Gift Card
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300/80 font-medium tracking-wide">
                    Digital Birthday Reward
                  </div>
                </div>
              </div>

              {/* Amount Display with Metallic Gold Gradient */}
              <div className="text-right">
                <div className="text-[9px] uppercase tracking-[0.2em] text-amber-200/70 font-bold">
                  Card Value
                </div>
                <div
                  className="text-2xl sm:text-3xl font-serif font-black tracking-tight drop-shadow-md"
                  style={{
                    background:
                      'linear-gradient(135deg, #fffbeb 0%, #fef08a 25%, #fbbf24 60%, #f59e0b 90%, #d97706 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    textShadow: '0 2px 10px rgba(245, 158, 11, 0.35)',
                  }}
                >
                  {amount}
                </div>
              </div>
            </div>

            {/* MIDDLE ROW: Recessed Vault Voucher Code Container */}
            <div
              style={{
                background: 'rgba(3, 7, 18, 0.72)',
                boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.8), 0 1px 1px rgba(245, 158, 11, 0.15)',
                borderColor: 'rgba(245, 158, 11, 0.32)',
              }}
              className="rounded-xl p-3 border backdrop-blur-md"
            >
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-amber-200/80 font-semibold mb-1">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span>Gift Card Voucher Code</span>
                </span>
                <span className="inline-flex items-center gap-1 text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 px-2 py-0.5 rounded-full font-bold">
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                  <span>Active</span>
                </span>
              </div>

              {/* High Contrast Monospace Code Display */}
              <div className="font-mono text-sm sm:text-base font-extrabold tracking-widest text-amber-300 select-all break-all drop-shadow-sm py-0.5">
                {voucherCode}
              </div>
            </div>

            {/* BOTTOM ROW: Decorative Metadata & Recipient Ribbon */}
            <div className="flex items-center justify-between text-[10px] text-amber-200/75 font-medium pt-0.5">
              <div className="flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5 text-amber-400" />
                <span className="tracking-wide">Birthday Edition</span>
              </div>
              <div className="flex items-center gap-1 text-rose-300 font-semibold tracking-wide">
                <span>For {recipientName}</span>
                <span>✨</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
