const CACHE_NAME = 'radja-bekam-pwa-v1';
const OFFLINE_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Don't fail install if caching fails, just try to cache the root
      return cache.add(new Request(OFFLINE_URL, { cache: 'reload' })).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(OFFLINE_URL).then((response) => {
          if (response) {
            return response;
          }
          // Fallback if cache fails
          return new Response('Offline', {
            headers: { 'Content-Type': 'text/html' }
          });
        });
      })
    );
  }
});
