import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const pkgDir = name => path.dirname(require.resolve(`${name}/package.json`));

/**
 * Tesseract (image OCR) normally downloads its worker, WebAssembly core and
 * English language data from a CDN. Serve them from the app instead, so OCR
 * works offline and in the Android app. Paths match src/ai.js.
 */
const TESSERACT_FILES = {
  'tesseract/worker.min.js': () => path.join(pkgDir('tesseract.js'), 'dist/worker.min.js'),
  'tesseract/core/tesseract-core-lstm.wasm.js': () => path.join(pkgDir('tesseract.js-core'), 'tesseract-core-lstm.wasm.js'),
  'tesseract/core/tesseract-core-simd-lstm.wasm.js': () => path.join(pkgDir('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'),
  'tesseract/lang/eng.traineddata.gz': () => path.join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'),
};

function tesseractAssets() {
  return {
    name: 'woni-tesseract-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        const source = TESSERACT_FILES[rel];
        if (!source) return next();
        res.setHeader('Content-Type', rel.endsWith('.gz') ? 'application/gzip' : 'text/javascript');
        fs.createReadStream(source()).pipe(res);
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(TESSERACT_FILES)) {
        this.emitFile({ type: 'asset', fileName, source: fs.readFileSync(source()) });
      }
    },
  };
}

export default defineConfig({
  root: './',
  plugins: [
    preact(),
    tesseractAssets(),
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
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,json,webmanifest}'],
        // OCR files are large and only needed by people who scan images:
        // cache them the first time they're used instead of on install.
        globIgnores: ['tesseract/**'],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.includes('/tesseract/'),
          handler: 'CacheFirst',
          options: { cacheName: 'woni-ocr', expiration: { maxEntries: 10 } },
        }],
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
