import { useEffect, useState } from 'react';
import { isNativeApp } from '../androidBridge';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    deferredPwaPrompt?: BeforeInstallPromptEvent | null;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    return (typeof window !== 'undefined' && window.deferredPwaPrompt) || null;
  });
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    return isNativeApp();
  });
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [showIOSGuide, setShowIOSGuide] = useState<boolean>(false);
  const [showChromeGuide, setShowChromeGuide] = useState<boolean>(false);
  const [installSuccessMsg, setInstallSuccessMsg] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kashishPwaDismissed') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // 1. Immediately Register Service Worker if on HTTPS or Localhost
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      (window.location.protocol === 'https:' ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1')
    ) {
      const registerSW = () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => {
            console.log('Service Worker registered successfully:', reg);
          })
          .catch((err) => {
            console.warn('SW registration info:', err);
          });
      };

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        registerSW();
      } else {
        window.addEventListener('load', registerSW);
      }
    }

    // 2. Check if app is running in native app wrapper or standalone / installed display mode
    const checkStandalone = () => {
      const isStandalone =
        isNativeApp() ||
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(isStandalone);
    };

    checkStandalone();
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleMediaChange = (e: MediaQueryListEvent) => setIsInstalled(e.matches);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleMediaChange);
    }

    // 3. Detect iOS devices
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    // 4. Check if global window.deferredPwaPrompt was already captured
    if (window.deferredPwaPrompt) {
      setDeferredPrompt(window.deferredPwaPrompt);
    }

    // 5. Capture beforeinstallprompt event (Android / Chrome / Edge)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.deferredPwaPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    // 6. Capture appinstalled event
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      window.deferredPwaPrompt = null;
      setInstallSuccessMsg("Kashish is now in your heart, and on your home screen 💗");
      setTimeout(() => setInstallSuccessMsg(null), 6000);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMediaChange);
      }
    };
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      localStorage.setItem('kashishPwaDismissed', 'true');
    } catch {
      // Safe fallback
    }
  };

  const handleResetDismiss = () => {
    setIsDismissed(false);
    try {
      localStorage.removeItem('kashishPwaDismissed');
    } catch {
      // Safe fallback
    }
  };

  const install = async () => {
    // 1. If on iOS Safari, show iOS guide card
    if (isIOS) {
      setShowIOSGuide(true);
      return false;
    }

    // 2. Check if we have active deferred prompt
    const promptToUse = deferredPrompt || window.deferredPwaPrompt;

    if (promptToUse) {
      try {
        await promptToUse.prompt();
        const { outcome } = await promptToUse.userChoice;
        if (outcome === 'accepted') {
          setIsInstalled(true);
          setDeferredPrompt(null);
          window.deferredPwaPrompt = null;
          setInstallSuccessMsg("Kashish is now in your heart, and on your home screen 💗");
          setTimeout(() => setInstallSuccessMsg(null), 6000);
          return true;
        } else {
          // User cancelled prompt, show Chrome guide as gentle reminder
          setShowChromeGuide(true);
        }
      } catch (err) {
        console.warn('Install prompt trigger error:', err);
        setShowChromeGuide(true);
      }
    } else {
      // If deferredPrompt is not available (e.g. Chrome preview iframe or heuristic not yet triggered), show step-by-step Chrome guide!
      setShowChromeGuide(true);
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt || isIOS,
    hasDeferredPrompt: !!(deferredPrompt || window.deferredPwaPrompt),
    isInstalled,
    isIOS,
    showIOSGuide,
    setShowIOSGuide,
    showChromeGuide,
    setShowChromeGuide,
    installSuccessMsg,
    setInstallSuccessMsg,
    isDismissed,
    handleDismiss,
    handleResetDismiss,
    install,
  };
}
