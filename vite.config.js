import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
      // The only web app manifest (the plugin injects the <link> into index.html).
      manifest: {
        name: 'Woni — AI Exam Intelligence',
        short_name: 'Woni',
        description: 'Exam prep for CSIR NET, GATE Life Science, UGC NET, SLET and NPSC.',
        theme_color: '#0c0c0f',
        background_color: '#0c0c0f',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        maximumFileSizeToCacheInBytes: 5000000 // 5 MB
      }
    })
  ],
  optimizeDeps: {
    // Pre-bundle so the dev server doesn't discover it late and force a reload.
    include: ['workbox-window']
  },
  build: {
    outDir: 'www',
    emptyOutDir: true
  }
});
