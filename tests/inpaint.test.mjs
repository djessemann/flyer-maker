// The object-removal algorithm on its own, against a known-good ground truth.
// No browser: it imports the worker's pure functions directly.
//
// Run: node tests/inpaint.test.mjs
import { readFileSync } from 'fs';
import { join } from 'path';
import { REPO, reporter } from './lib/harness.mjs';

const R = reporter('inpaint suite');
const ok = (c, n) => R.ok(c, n);

// load the worker's maths without its message plumbing
let src = readFileSync(join(REPO, 'js', 'inpaint-worker.js'), 'utf8');
src = src.slice(0, src.indexOf('self.onmessage')) + '\nexport { inpaint };\n';
const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

const W = 160, H = 160;
const px = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    px[p] = 30 + x * 0.5; px[p + 1] = 70 + y * 0.4; px[p + 2] = 60 + (x + y) * 0.2; px[p + 3] = 255;
  }
}
// remember the truth under the blob we are about to paint over
const truth = [];
for (let y = 60; y < 100; y++) {
  for (let x = 60; x < 100; x++) {
    const p = (y * W + x) * 4;
    truth.push([px[p], px[p + 1], px[p + 2]]);
  }
}
for (let y = 60; y < 100; y++) {
  for (let x = 60; x < 100; x++) {
    const p = (y * W + x) * 4;
    px[p] = 255; px[p + 1] = 255; px[p + 2] = 255;
  }
}
const bits = new Uint8Array(W * H);
for (let y = 58; y < 102; y++) for (let x = 58; x < 102; x++) bits[y * W + x] = 1;

const t0 = Date.now();
mod.inpaint(px, W, H, bits, 5);
const ms = Date.now() - t0;

let white = 0, sum = 0, max = 0, k = 0;
for (let y = 60; y < 100; y++) {
  for (let x = 60; x < 100; x++) {
    const p = (y * W + x) * 4;
    if (px[p] > 240 && px[p + 1] > 240 && px[p + 2] > 240) white++;
    const t = truth[k++];
    const e = Math.max(Math.abs(px[p] - t[0]), Math.abs(px[p + 1] - t[1]), Math.abs(px[p + 2] - t[2]));
    sum += e; if (e > max) max = e;
  }
}
const mean = sum / truth.length;

ok(white === 0, `the painted-over object is gone (${white} bright pixels remain)`);
ok(mean < 12, `reconstruction is close to the truth (mean error ${mean.toFixed(1)}/255)`);
ok(max < 40, `no wild outliers (max error ${max}/255)`);
ok(ms < 3000, `fast enough for an interactive tap (${ms}ms for a 44x44 hole)`);

// an empty mask must be a no-op rather than a crash or a smear
const flat = new Uint8ClampedArray(px);
mod.inpaint(flat, W, H, new Uint8Array(W * H), 5);
ok(flat.every((v, i) => v === px[i]), 'an empty mask changes nothing');

// a mask touching the edge must not read out of bounds
const edge = new Uint8Array(W * H);
for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) edge[y * W + x] = 1;
let threw = false;
try { mod.inpaint(new Uint8ClampedArray(px), W, H, edge, 5); } catch { threw = true; }
ok(!threw, 'a mask in the very corner does not crash');

process.exit(R.finish() ? 1 : 0);
