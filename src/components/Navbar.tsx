import React from 'react';
import { CONFIG } from '../config';
import { PWAInstallButton } from './PWAInstallButton';
import { isNativeApp, triggerHaptic } from '../androidBridge';
import {
  Home,
  Lock,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  ArrowLeft,
  ShieldCheck,
  Palette,
} from 'lucide-react';
import { auth } from '../firebase';
import type { AppThemeId } from './ThemeSection';

export type NavTab =
  | 'home'
  | 'gallery'
  | 'breathe'
  | 'open-when'
  | 'games'
  | 'cute-pic'
  | 'poetry'
  | 'secret-letter'
  | 'name-game'
  | 'last-page'
  | 'theme'
  | `custom_tab_${string}`;

interface NavbarProps {
  name: string;
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  currentTheme?: AppThemeId;
  onOpenThemeModal?: () => void;
  isPlayingMusic: boolean;
  onToggleMusic: () => void;
  onReopenEnvelope: () => void;
  onShowAdmin: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  name,
  activeTab,
  onSelectTab,
  isDarkMode,
  onToggleDarkMode,
  currentTheme = 'default',
  onOpenThemeModal,
  isPlayingMusic,
  onToggleMusic,
  onReopenEnvelope,
  onShowAdmin,
}) => {
  const handleBrandClick = () => {
    triggerHaptic(30);
    onSelectTab('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToHome = () => {
    triggerHaptic(30);
    onSelectTab('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };


  return (
    <header
      style={{
        backgroundColor: 'var(--nav-bg)',
        borderColor: 'var(--card-border)',
        color: 'var(--text)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
      className="sticky top-0 z-40 backdrop-blur-md border-b transition-colors duration-300 shadow-xs"
    >
      <div className="max-w-5xl mx-auto px-2 sm:px-4 h-14 flex items-center justify-between gap-1 sm:gap-2 flex-nowrap">
        {/* Left Side: Back to Home button (when in any section) + Brand Logo */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 shrink">
          {activeTab !== 'home' && (
            <button
              onClick={handleBackToHome}
              className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border text-[11px] sm:text-xs font-bold cursor-pointer transition-transform active:scale-95 shadow-xs shrink-0"
              style={{
                backgroundColor: 'var(--card-subtle)',
                borderColor: 'var(--card-border)',
                color: 'var(--accent)',
              }}
              title="Back to Home"
              aria-label="Back to Home"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Home</span>
            </button>
          )}

          {/* Brand Wordmark */}
          <button
            onClick={handleBrandClick}
            className="flex items-center gap-1.5 sm:gap-2 group text-left cursor-pointer touch-manipulation select-none min-w-0"
            aria-label={`${name}'s World home`}
          >
            <div
              style={{
                boxShadow: '0 0 10px rgba(251, 191, 36, 0.6)',
              }}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-amber-400 overflow-hidden group-hover:scale-105 transition-transform shrink-0 flex items-center justify-center bg-black relative"
            >
              <img
                src="https://res.cloudinary.com/dsfcu9y1h/image/upload/v1790940725/Golden_Gaze_in_a_Neon_Circle_hztvx3.png"
                alt="Logo"
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (!target.dataset.triedSvg) {
                    target.dataset.triedSvg = 'true';
                    target.src = '/assets/golden_gaze_logo.svg';
                  }
                }}
              />
            </div>
            <div className="min-w-0 flex flex-col">
              <span
                style={{ color: 'var(--text)' }}
                className="font-serif font-bold text-sm sm:text-base tracking-tight truncate max-w-[100px] xs:max-w-[150px] sm:max-w-none block group-hover:text-amber-500 transition-colors duration-300"
              >
                {name}'s World
              </span>
              <div className="h-0.5 w-0 group-hover:w-full bg-amber-400 transition-all duration-500 rounded-full" />
            </div>
          </button>
        </div>

        {/* Right Action Icons: Download/Settings, Music, Theme Selector, Dark/Light, Lock */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 flex-nowrap">
          {/* Download App / Install App Popup Button (automatically hidden if inside native Android APK) */}
          <PWAInstallButton variant="header" />


          {/* Music Play/Pause */}
          <button
            onClick={() => {
              triggerHaptic(30);
              onToggleMusic();
            }}
            title={isPlayingMusic ? 'Mute Music' : 'Play Romantic Music'}
            aria-label="Toggle romantic music"
            style={{
              backgroundColor: isPlayingMusic ? 'var(--accent)' : 'var(--card-subtle)',
              color: isPlayingMusic ? 'var(--accent-text)' : 'var(--text)',
              borderColor: 'var(--card-border)',
            }}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border transition-all flex items-center justify-center relative cursor-pointer shadow-xs active:scale-95 shrink-0"
          >
            {isPlayingMusic ? (
              <>
                <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
              </>
            ) : (
              <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            )}
          </button>

          {/* Theme Section Button (Default / Glassmorphism / Light Selector) */}
          <button
            onClick={() => {
              triggerHaptic(30);
              if (onOpenThemeModal) {
                onOpenThemeModal();
              } else {
                onSelectTab('theme');
              }
            }}
            title="Choose Theme (Default / Glassmorphism)"
            aria-label="Choose Theme"
            style={{
              backgroundColor:
                activeTab === 'theme' || currentTheme === 'glass'
                  ? 'var(--accent)'
                  : 'var(--card-subtle)',
              color:
                activeTab === 'theme' || currentTheme === 'glass'
                  ? 'var(--accent-text)'
                  : 'var(--text)',
              borderColor: 'var(--card-border)',
            }}
            className="w-8 h-8 sm:w-auto sm:h-9 sm:px-2.5 rounded-full border text-[11px] sm:text-xs font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer shadow-xs active:scale-95 shrink-0"
          >
            <Palette className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="hidden md:inline">Theme</span>
          </button>

          {/* Sun/Moon Dark/Light Mode Toggle Button */}
          <button
            onClick={() => {
              triggerHaptic(30);
              onToggleDarkMode();
            }}
            title={isDarkMode ? 'Switch Theme' : 'Switch Theme'}
            aria-label="Quick switch theme"
            style={{
              backgroundColor: 'var(--card-subtle)',
              color: 'var(--text)',
              borderColor: 'var(--card-border)',
            }}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border transition-all flex items-center justify-center cursor-pointer shadow-xs active:scale-95 shrink-0"
          >
            {isDarkMode ? (
              <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-amber-300" />
            ) : (
              <Moon className="w-4 h-4 sm:w-5 sm:h-5 text-[var(--accent)]" />
            )}
          </button>

          {/* Lock Diary */}
          <button
            onClick={() => {
              triggerHaptic(40);
              onReopenEnvelope();
            }}
            title="Lock Diary"
            aria-label="Lock Diary"
            style={{
              backgroundColor: 'var(--card-subtle)',
              color: 'var(--text)',
              borderColor: 'var(--card-border)',
            }}
            className="w-8 h-8 sm:w-auto sm:h-9 sm:px-2.5 rounded-full border text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer shadow-xs active:scale-95 shrink-0"
          >
            <Lock className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
            <span className="hidden md:inline">Lock</span>
          </button>

          {/* Admin Panel Access - Restricted to specific email */}
          {auth.currentUser?.email === 'jayshankar431@gmail.com' && (
            <button
              onClick={() => {
                triggerHaptic(50);
                onShowAdmin();
              }}
              title="Admin Panel"
              aria-label="Admin Panel"
              style={{
                backgroundColor: 'var(--card-subtle)',
                color: 'var(--text)',
                borderColor: 'var(--card-border)',
              }}
              className="w-8 h-8 sm:w-auto sm:h-9 sm:px-2.5 rounded-full border text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer shadow-xs active:scale-95 shrink-0 border-amber-400/50"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="hidden md:inline text-amber-600 dark:text-amber-400">Admin</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
