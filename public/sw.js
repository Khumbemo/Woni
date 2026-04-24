// Minimal Service Worker
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', (event) => {
  // Network-first or bypass
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
