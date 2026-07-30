// offline: cache the app shell up front, runtime-cache the canvas lib and fonts
const VERSION = 'pasteup-v5';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/bus.js',
  './js/store.js',
  './js/fonts.js',
  './js/editor.js',
  './js/ui.js',
  './js/retouch.js',
  './js/crop.js',
  './js/inpaint-worker.js',
  './vendor/fabric-6.9.1.min.mjs',
  './vendor/idb-keyval-6.3.0.mjs',
  './fonts.json',
  './manifest.webmanifest',
  './icon.svg',
];
// Google Fonts is the only third party left, and it is genuinely optional: the
// app runs without it. The canvas engine lives in vendor/ and is precached with
// the rest of the shell, so an offline launch has everything it needs.
const RUNTIME_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
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
    // same-origin app files: network first so a deploy lands immediately
    if (sameOrigin) {
      try {
        const res = await fetch(e.request);
        if (res && res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        if (e.request.mode === 'navigate') {
          const shell = await cache.match('./index.html');
          if (shell) return shell;
        }
        throw new Error('offline');
      }
    }
    // third-party libs and fonts: cache first, they're versioned
    const hit = await cache.match(e.request);
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
    return res;
  })());
});
