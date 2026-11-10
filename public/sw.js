'use strict';
/**
 * EISBERG Service Worker - PWA Offline & Cache
 */
const CACHE_NAME = 'eisberg-cache-v7';
const STATIC_ASSETS = [
  './',
  './index.html',
  './admin.html',
  './css/style.css',
  './js/supabase-client.js',
  './js/app.js',
  './js/admin.js',
  './img/mascote.svg',
  './img/icon-192.png',
  './img/icon-512.png',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Nunca intercepta requisições de escrita (POST/PATCH/DELETE) nem chamadas externas (Supabase)
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Scripts, estilos e páginas HTML usam Network First para garantir atualizações imediatas
  if (req.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match(req, { ignoreSearch: true })))
    );
    return;
  }

  // Demais arquivos estáticos (ícones, imagens) usam Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networked = fetch(req).then((res) => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached);

      return cached || networked;
    })
  );
});

