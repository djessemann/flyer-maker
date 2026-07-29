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
  serveRepo, shimCDN, launchBrowser, appDepVersions, PHONE, reporter, REPO,
} from './lib/harness.mjs';

const R = reporter('offline suite');
const ok = (c, n) => R.ok(c, n);

/* ---------- static: the precache list must match what the app imports ---------- */

const sw = readFileSync(join(REPO, 'sw.js'), 'utf8');
const v = appDepVersions();
const wanted = [
  `https://cdn.jsdelivr.net/npm/fabric@${v.fabric}/dist/index.min.mjs`,
  `https://cdn.jsdelivr.net/npm/idb-keyval@${v['idb-keyval']}/+esm`,
];
for (const url of wanted) {
  ok(sw.includes(url),
     `sw.js precaches the exact url the app imports: ${url.replace('https://cdn.jsdelivr.net/npm/', '')} — ` +
     'module imports on a first visit happen before the worker activates, so ' +
     'runtime caching alone would never capture them');
}

// the precache must not block install or activation on a slow CDN
ok(/AbortSignal\.timeout/.test(sw), 'the cdn warm-up is time-boxed so it cannot hang activation');
const activateBlock = sw.slice(sw.indexOf("addEventListener('activate'"), sw.indexOf('async function warmCDN'));
ok(!/await\s+warmCDN\(\)/.test(activateBlock), 'the cdn warm-up is not awaited during activation');

// every app module should be in the shell list, or an offline visit misses it
const shellBlock = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('const CDN_MODULES'));
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
  const need = ['/js/app.js', '/js/ui.js', '/js/editor.js', '/css/app.css', '/fonts.json'];
  return need.every(n => paths.some(p => p.endsWith(n))) ? paths.length : 0;
});
ok(cached > 0, `the whole app shell is cached (${cached} entries)`);

// with the network cut, same-origin files must still resolve out of the cache
await ctx.setOffline(true);
const offlineFetch = await page.evaluate(async () => {
  const want = ['./js/app.js', './js/ui.js', './css/app.css', './fonts.json'];
  const res = await Promise.all(want.map(u => fetch(u).then(r => r.ok).catch(() => false)));
  return res.every(Boolean);
});
ok(offlineFetch, 'app files load from cache with the network offline');

const navOk = await page.reload({ waitUntil: 'domcontentloaded' })
  .then(async () => (await page.locator('#viewHome').count()) > 0)
  .catch(() => false);
ok(navOk, 'the page still serves after an offline reload');
await ctx.setOffline(false);

await browser.close();
server.close();
process.exit(R.finish() ? 1 : 0);
