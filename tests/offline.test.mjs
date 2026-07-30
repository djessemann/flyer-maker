// Service worker + offline behaviour.
//
// Split out from the mobile suite because an active service worker issues its own
// fetches, which Playwright's route interception cannot reach. That has one real
// consequence for coverage: we can verify same-origin caching end to end, but the
// CDN modules travelling *through* the worker cannot be exercised on a sandboxed
// machine with no route to jsDelivr. That half is covered by the static assertion
// below (the precache list must match the app's imports) and by the on-device
// offline item in TESTING.md.
//
// Run: node tests/offline.test.mjs
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  serveRepo, shimCDN, launchBrowser, appDepVersions, vendorFiles, PHONE, reporter, REPO,
} from './lib/harness.mjs';

const R = reporter('offline suite');
const ok = (c, n) => R.ok(c, n);

/* ---------- static: the precache list must match what the app imports ---------- */

const sw = readFileSync(join(REPO, 'sw.js'), 'utf8');
const files = Object.values(vendorFiles());
const wanted = files.map(f => './' + f);
for (const f of wanted) {
  ok(sw.includes(f),
     `sw.js caches ${f} with the rest of the shell — the canvas engine has to be ` +
     'there or an offline launch is a dead shell with a live-looking button');
}
ok(!sw.includes('cdn.jsdelivr.net'),
   'no cdn is on the critical path any more, so offline cannot depend on one being reachable');

// every app module should be in the shell list, or an offline visit misses it
const shellBlock = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('const RUNTIME_HOSTS'));
const modules = ['app', 'bus', 'store', 'fonts', 'editor', 'ui', 'retouch', 'inpaint-worker']
  .map(f => `./js/${f}.js`);
const missing = modules.filter(m => !shellBlock.includes(m));
ok(missing.length === 0,
   'every js module is in the service worker shell list' +
   (missing.length ? ' — missing: ' + missing.join(', ') : ''));

/* ---------- live: registration, shell caching, offline reload ---------- */

const { server, origin } = await serveRepo();
const browser = await launchBrowser();
// service workers are allowed here (the point of the suite); the CDN shim is still
// needed so the app can boot far enough to register one
const ctx = await browser.newContext(PHONE);
await shimCDN(ctx);
const page = await ctx.newPage();
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });

// Poll with real awaits rather than page.waitForFunction: an async predicate
// there resolves on the *Promise* it returns, not the value, so such a check
// passes vacuously on the first tick.
async function pollUntil(fn, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(250);
  }
}

const active = await pollUntil(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(reg && reg.active);
});
ok(active === true, 'service worker registers and activates on first load');

const cached = await pollUntil(async () => {
  const keys = await caches.keys();
  if (!keys.length) return 0;
  const paths = (await (await caches.open(keys[0])).keys()).map(r => new URL(r.url).pathname);
  const need = ['/js/app.js', '/js/ui.js', '/js/editor.js', '/css/app.css', '/fonts.json',
                '/vendor/fabric-6.9.1.min.mjs'];
  return need.every(n => paths.some(p => p.endsWith(n))) ? paths.length : 0;
});
ok(cached > 0, `the whole app shell is cached (${cached} entries)`);

// with the network cut, same-origin files must still resolve out of the cache
await ctx.setOffline(true);
const offlineFetch = await page.evaluate(async () => {
  const want = ['./js/app.js', './js/ui.js', './css/app.css', './fonts.json',
                './vendor/fabric-6.9.1.min.mjs'];
  const res = await Promise.all(want.map(u => fetch(u).then(r => r.ok).catch(() => false)));
  return res.every(Boolean);
});
ok(offlineFetch, 'app files load from cache with the network offline');

// #viewHome is hard-coded in index.html, so counting it proves nothing — it is
// there whether or not a single module ran. Assert the app BOOTED and works.
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(1500);

const booted = await page.evaluate(() => {
  const icon = document.querySelector('#touch-icon');
  // makeTouchIcon() is the last thing boot() does
  return !!(icon && (icon.getAttribute('href') || '').startsWith('data:image/png'));
});
ok(booted, 'the app actually boots offline (boot() ran to completion, not just a cached shell)');

const usable = await page.evaluate(async () => {
  document.querySelector('#btnNew').click();
  await new Promise(r => setTimeout(r, 350));
  const presets = document.querySelectorAll('#sheetBody [data-p]').length;
  const open = document.querySelector('#sheet').classList.contains('on');
  if (!open || !presets) return { open, presets, docW: null };
  document.querySelector('[data-p="ig-post"]').click();
  await new Promise(r => setTimeout(r, 700));
  const m = await import('./js/editor.js');
  return { open, presets, docW: m.ed.docW, hasCanvas: !!m.ed.canvas };
});
ok(usable.open && usable.presets === 5 && usable.docW === 1080 && usable.hasCanvas,
   `and you can start a flyer offline (presets ${usable.presets}, canvas ${usable.docW}px)`);

const engineCached = await page.evaluate(async paths => {
  const keys = await caches.keys();
  for (const k of keys) {
    const c = await caches.open(k);
    const hits = await Promise.all(paths.map(p => c.match(p).then(Boolean)));
    if (hits.every(Boolean)) return true;
  }
  return false;
}, wanted);
ok(engineCached,
   'the canvas engine is in the cache, so the offline boot is real rather than lucky');
await ctx.setOffline(false);

await browser.close();
server.close();
process.exit(R.finish() ? 1 : 0);
