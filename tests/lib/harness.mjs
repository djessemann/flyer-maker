// shared test plumbing: serve the repo and launch a browser.
//
// The canvas engine is vendored (see vendor/README.md), so the suite now runs
// exactly what ships — there is no CDN stand-in for it any more, which removes a
// class of blind spot where the tests exercised a different build than users got.
// Google Fonts is still substituted, since a sandbox has no route to it.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

export function serveRepo(port = 0) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (p.includes('..')) { res.writeHead(400); res.end(); return; }
    const f = join(REPO, p);
    if (!existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  }).listen(port);
  return new Promise(resolve => server.on('listening', () =>
    resolve({ server, origin: `http://localhost:${server.address().port}` })));
}

// the versions the app actually loads, read out of its import statements
export function appDepVersions() {
  const src = readFileSync(join(REPO, 'js', 'editor.js'), 'utf8')
            + readFileSync(join(REPO, 'js', 'store.js'), 'utf8');
  const grab = name => {
    const m = src.match(new RegExp(`vendor/${name}-(\\d+\\.\\d+\\.\\d+)`));
    return m && m[1];
  };
  return { fabric: grab('fabric'), 'idb-keyval': grab('idb-keyval') };
}

export function vendorFiles() {
  const v = appDepVersions();
  return {
    fabric: `vendor/fabric-${v.fabric}.min.mjs`,
    'idb-keyval': `vendor/idb-keyval-${v['idb-keyval']}.mjs`,
  };
}

export function assertPinnedVersions() {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const app = appDepVersions();
  const files = vendorFiles();
  const problems = [];
  for (const [name, wanted] of Object.entries(app)) {
    const have = pkg.devDependencies[name];
    if (!wanted) problems.push(`could not find the ${name} import in js/`);
    else if (have !== wanted) {
      problems.push(`app imports ${name}@${wanted} but package.json pins ${have}`);
    }
    if (wanted && !existsSync(join(REPO, files[name]))) {
      problems.push(`${files[name]} is missing — the app imports it and it is not in the repo`);
    }
  }
  return problems;
}

// Only Google Fonts needs standing in for now. Kept the old name so every suite
// keeps calling it, and so it stays the one place third-party traffic is faked.
export async function shimCDN(ctx, { realFonts = false, failFonts = false } = {}) {
  if (failFonts) {
    // exercise the not-found path: without this the shim makes every font succeed
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 404, body: '' }));
    await ctx.route('https://fonts.gstatic.com/**', r => r.fulfill({ status: 404, body: '' }));
    return;
  }
  if (!realFonts) {
    // hand back a real installed face for whatever family is asked for, so the
    // font-loading path (document.fonts.load actually resolving) is exercised
    await ctx.route('https://fonts.googleapis.com/**', r => {
      const url = decodeURIComponent(r.request().url());
      const fam = (url.match(/family=([^&:]+)/) || [, 'X'])[1].replace(/\+/g, ' ');
      r.fulfill({ contentType: 'text/css',
        body: `@font-face{font-family:"${fam}";` +
              'src:local("DejaVu Serif"),local("Liberation Serif"),local("Times New Roman");' +
              'font-weight:100 900;font-style:normal;}' });
    });
    await ctx.route('https://fonts.gstatic.com/**', r => r.fulfill({ status: 404, body: '' }));
  }
}

// prefer a browser already on the machine; otherwise let playwright use its own
export function launchBrowser() {
  const preinstalled = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  const opts = existsSync(preinstalled) ? { executablePath: preinstalled } : {};
  return chromium.launch(opts);
}

export const PHONE = {
  viewport: { width: 393, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
};
export const TABLET = { viewport: { width: 1194, height: 834 }, hasTouch: true };

// Poll with real awaits. page.waitForFunction with an async predicate resolves
// on the *Promise* it returns rather than its value, so such a check passes
// vacuously on the first tick — that mistake had been green and meaningless in
// this suite for its whole life. Never use waitForFunction with an async fn.
export async function pollUntil(page, fn, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(200);
  }
}

// every property whose loss would be invisible to a type-only check
export const LAYER_SNAPSHOT = `(() => {
  const m = window.__pasteupEd;
  const objs = m.canvas.getObjects().filter(o => o.pKind !== 'bg').map(o => ({
    pKind: o.pKind, pName: o.pName ?? null, pLocked: !!o.pLocked, visible: o.visible !== false,
    fill: o.fill ?? null, stroke: o.stroke ?? null,
    // 2dp: fabric serialises floats to 4dp, which is rounding, not data loss
    strokeWidth: Math.round((o.strokeWidth ?? 0) * 100) / 100,
    rx: Math.round((o.rx ?? 0) * 100) / 100, opacity: Math.round((o.opacity ?? 1) * 1000) / 1000,
    left: Math.round(o.left), top: Math.round(o.top),
    text: o.text ?? null, fontFamily: o.fontFamily ?? null, fontWeight: o.fontWeight ?? null,
    fontSize: o.fontSize ? Math.round(o.fontSize) : null, textAlign: o.textAlign ?? null,
    charSpacing: o.charSpacing ?? null, lineHeight: o.lineHeight ? Math.round(o.lineHeight*100) : null,
    srcFormat: o.srcFormat ?? null,
    scaleX: Math.round((o.scaleX ?? 1) * 1000) / 1000,
    natural: o._element ? (o._element.naturalWidth || 0) : null,
  }));
  return { objs, docW: m.docW, docH: m.docH, bg: m.bgRect ? m.bgRect.fill : null };
})()`;

// tiny assertion recorder
export function reporter(title) {
  const fails = [];
  let count = 0;
  return {
    ok(cond, name) {
      count++;
      console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
      if (!cond) fails.push(name);
      return !!cond;
    },
    finish() {
      console.log(`\n${title}: ${count - fails.length}/${count} passed`);
      if (fails.length) {
        console.log('\nfailures:');
        fails.forEach(f => console.log('  - ' + f));
      }
      return fails.length;
    },
    get failures() { return fails.length; },
  };
}
