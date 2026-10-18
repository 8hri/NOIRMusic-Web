import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// NOIRMusic Web — independent PWA. No backend, no analytics, no network use:
// the app shell is precached offline and every audio file lives in IndexedDB.

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'inline',
      includeAssets: [
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/apple-touch-icon-180.png',
        'fonts/InstrumentSerif-Latin.ttf',
        'fonts/Vazirmatn.ttf',
      ],
      workbox: {
        // Precache the app shell (HTML, JS, CSS, fonts, icons). Audio blobs
        // are never touched: they live in IndexedDB, not the network.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ttf}'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      manifest: {
        name: 'NOIRMusic',
        short_name: 'NOIRMusic',
        description: 'Local-first music player — your files, your library, on your device.',
        lang: 'en',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'browser'],
        orientation: 'portrait',
        background_color: '#121110',
        theme_color: '#121110',
        categories: ['music', 'entertainment', 'utilities'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/apple-touch-icon-180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
  },
  preview: {
    host: true,
    port: 4173,
  },
  server: {
    host: true,
    port: 5174,
  },
});
