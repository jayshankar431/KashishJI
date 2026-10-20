import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: "Kashish's World",
          short_name: "Kashish",
          description: "A deeply romantic, heart-touching interactive surprise gift world for Kashish.",
          theme_color: "#11061b",
          background_color: "#11061b",
          display: "standalone",
          orientation: "portrait",
          icons: [
            {
              src: "/pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any"
            },
            {
              src: "/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any"
            },
            {
              src: "/pwa-maskable-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable"
            },
            {
              src: "/pwa-maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable"
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB limit
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 365 * 24 * 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/res\.cloudinary\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'cloudinary-media-cache',
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 30 * 24 * 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve('./'),
      },
      dedupe: [
        'firebase',
        '@firebase/app',
        '@firebase/auth',
        '@firebase/firestore',
        '@firebase/analytics',
        '@firebase/component',
        '@firebase/util',
      ],
    },
    optimizeDeps: {
      include: [
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
        'firebase/analytics',
      ],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
