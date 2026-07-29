// shared test plumbing: serve the repo, launch a browser, and stand in for the
// two CDN modules the app imports at runtime.
//
// The app has no build step and loads fabric + idb-keyval straight from jsDelivr.
// Tests serve the same *pinned* versions out of node_modules instead, so the suite
// runs on a sandboxed machine with no route to a CDN. assertPinnedVersions() fails
// loudly if the app's import URLs and package.json ever drift apart.
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

// the versions the app actually asks for, read out of the source
export function appDepVersions() {
  const src = readFileSync(join(REPO, 'js', 'editor.js'), 'utf8')
            + readFileSync(join(REPO, 'js', 'store.js'), 'utf8');
  const grab = name => {
    const m = src.match(new RegExp(`cdn\\.jsdelivr\\.net/npm/${name}@([0-9.]+)`));
    return m && m[1];
  };
  return { fabric: grab('fabric'), 'idb-keyval': grab('idb-keyval') };
}

export function assertPinnedVersions() {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const app = appDepVersions();
  const problems = [];
  for (const [name, wanted] of Object.entries(app)) {
    const have = pkg.devDependencies[name];
    if (!wanted) problems.push(`could not find the ${name} import url in js/`);
    else if (have !== wanted) {
      problems.push(`app imports ${name}@${wanted} but package.json pins ${have} — ` +
                    'the tests would exercise a different build than users get');
    }
  }
  return problems;
}

const localDep = (name, file) => join(REPO, 'node_modules', name, file);

// answer the app's CDN imports with the pinned local copies
export async function shimCDN(ctx, { realFonts = false } = {}) {
  const v = appDepVersions();
  await ctx.route(`https://cdn.jsdelivr.net/npm/fabric@${v.fabric}/dist/index.min.mjs`, r =>
    r.fulfill({ contentType: 'text/javascript',
                body: readFileSync(localDep('fabric', 'dist/index.min.mjs'), 'utf8') }));
  await ctx.route(`https://cdn.jsdelivr.net/npm/idb-keyval@${v['idb-keyval']}/+esm`, r =>
    r.fulfill({ contentType: 'text/javascript',
                body: readFileSync(localDep('idb-keyval', 'dist/index.js'), 'utf8') }));

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
