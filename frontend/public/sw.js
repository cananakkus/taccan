const CACHE_NAME = 'murmur-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => (key.startsWith('taccan-') || key.startsWith('wordmurmur-') || key.startsWith('murmur-')) && key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/murmur/')) return;
  if (url.pathname.includes('/socket.io') || url.pathname.includes('/api')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && !response.headers.get('cache-control')?.includes('no-store')) {
          const clone = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {}));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const shell = await caches.match(self.registration.scope) ||
            await caches.match(new URL('index.html', self.registration.scope).href);
          if (shell) return shell;
        }
        throw new Error('Request failed and no cached response was found.');
      })
  );
});
