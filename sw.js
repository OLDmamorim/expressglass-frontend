// sw.js - Service Worker para PWA
const CACHE_NAME = 'eg-agenda-v1';

// Instalar - cache básico
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activar - limpar caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      );
    })
  );
  self.clients.claim();
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Ignorar requests a APIs
  if (event.request.url.includes('/.netlify/functions/') || 
      event.request.url.includes('api.') ||
      event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Guardar em cache
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline - tentar cache
        return caches.match(event.request);
      })
  );
});
