/// <reference lib="webworker" />

import { build, version } from '$service-worker';

const worker = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `trackr-shell-${version}`;
const PUBLIC_SHELL = ['/manifest.webmanifest', '/favicon.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png'];
const CACHEABLE = new Set([...build, ...PUBLIC_SHELL]);

worker.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...CACHEABLE])));
  worker.skipWaiting();
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('trackr-shell-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => worker.clients.claim())
  );
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin || !CACHEABLE.has(url.pathname)) return;
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});
