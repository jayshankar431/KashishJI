import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { SiteContentProvider } from './siteContent';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register service worker with auto-update & immediate revalidation
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true);
  },
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      // Check for updates when app returns to foreground
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {});
        }
      });
      // Check for updates periodically every 60 seconds
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 1000);
    }
  }
});

createRoot(document.getElementById('root')!).render(
  <SiteContentProvider>
    <App />
  </SiteContentProvider>
);
