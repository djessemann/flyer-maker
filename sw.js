// offline: cache the app shell up front, runtime-cache the canvas lib and fonts
const VERSION = 'pasteup-v3';
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
  './js/inpaint-worker.js',
  './fonts.json',
  './manifest.webmanifest',
  './icon.svg',
];
// The app imports these at boot. Module imports on a first visit happen before
// this worker activates, so runtime caching alone never captures them and an
// offline relaunch could not load the canvas engine. Precache them by exact URL.
// tests/offline.test.mjs asserts these stay in step with the imports in js/.
const CDN_MODULES = [
  'https://cdn.jsdelivr.net/npm/fabric@6.9.1/dist/index.min.mjs',
  'https://cdn.jsdelivr.net/npm/idb-keyval@6.3.0/+esm',
];
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

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
    // Deliberately not awaited, and time-boxed: a slow or unreachable CDN must
    // never hold up activation or leave the worker installing forever.
    warmCDN();
  })());
});

async function warmCDN() {
  const cache = await caches.open(VERSION);
  await Promise.allSettled(CDN_MODULES.map(async u => {
    if (await cache.match(u)) return;
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (res && res.ok) await cache.put(u, res);
    } catch {}
  }));
}

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
