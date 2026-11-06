'use strict';
/**
 * EISBERG Service Worker - PWA Offline & Cache
 */
const CACHE_NAME = 'eisberg-cache-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './admin.html',
  './css/style.css',
  './js/supabase-client.js',
  './js/app.js',
  './js/admin.js',
  './img/logo.png',
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

  // Requisições para APIs externas (Supabase) usam Network First
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // Arquivos estáticos do app usam Stale-While-Revalidate
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

