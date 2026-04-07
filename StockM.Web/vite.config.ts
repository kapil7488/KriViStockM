import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-512.svg'],
      manifest: false, // we use public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/query[12]\.finance\.yahoo\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'yahoo-api', expiration: { maxEntries: 50, maxAgeSeconds: 300 } },
          },
        ],
      },
    }),
  ],
  envDir: __dirname,
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
      },
      '/api/yahoo2': {
        target: 'https://query2.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo2/, ''),
      },
      '/api/fc': {
        target: 'https://fc.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/fc/, ''),
      },
      '/api/finnhub': {
        target: 'https://finnhub.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/finnhub/, ''),
      },
      '/api/alphavantage': {
        target: 'https://www.alphavantage.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/alphavantage/, ''),
      },
    },
  },
});
