import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const base = mode === 'github-pages' ? '/garage/' : '/';

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          id: base,
          name: 'MűhelyGarázs',
          short_name: 'Garázs',
          description: 'Saját motoros műhelyed javítási és restaurálási projektjeihez.',
          lang: 'hu',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'any',
          background_color: '#10120f',
          theme_color: '#10120f',
          icons: [
            {
              src: `${base}icons/icon-192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}icons/icon-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}icons/icon-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{css,html,ico,js,png,svg,webmanifest}'],
          navigateFallback: `${base}index.html`,
        },
      }),
    ],
  };
});
