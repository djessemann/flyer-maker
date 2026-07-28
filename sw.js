// offline: cache the app shell up front, runtime-cache cdn libs and any fonts used
const VERSION = 'pasteup-v1';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/bus.js',
  './js/store.js',
  './js/fonts.js',
  './js/editor.js',
  './js/panels.js',
  './js/retouch.js',
  './js/retouch-worker.js',
  './fonts.json',
  './manifest.webmanifest',
  './icon.svg',
];
const RUNTIME_HOSTS = [
  'cdn.jsdelivr.net',
  'docs.opencv.org',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k !== VERSION) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  const runtime = RUNTIME_HOSTS.includes(url.host);
  if (!sameOrigin && !runtime) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(e.request, { ignoreSearch: false });
    if (hit) {
      // refresh same-origin shell files in the background
      if (sameOrigin) e.waitUntil?.(fetch(e.request).then(r => {
        if (r && r.ok) cache.put(e.request, r.clone());
      }).catch(() => {}));
      return hit;
    }
    try {
      const res = await fetch(e.request);
      if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      if (sameOrigin && e.request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
