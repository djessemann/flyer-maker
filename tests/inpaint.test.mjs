// Ground truth for object removal. Build a background, paste an object on it,
// mask the object, fill, and compare the result against the background that was
// really there — plus how much texture the fill has.
//
// Average error alone is not enough and never was: on random texture a smooth
// grey patch scores well while looking obviously wrong, which is exactly how the
// old Telea fill kept its numbers respectable while shipping visible smears. So
// every case also asserts "detail": gradient energy inside the fill against the
// same measure in the untouched photo. 1.0 means it has as much texture as its
// surroundings; the old fill scored 0.05 on the case below and would fail here.
//
// Run: node tests/inpaint.test.mjs
import { serveRepo, launchBrowser, reporter } from './lib/harness.mjs';

const R = reporter('inpaint suite');
const ok = (c, n) => R.ok(c, n);

const { server, origin } = await serveRepo();
const browser = await launchBrowser();
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
await page.goto(origin + '/');

const results = await page.evaluate(async () => {
  const W = 460, H = 360;

  const paint = {
    plain(g) {
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, '#9fb4c9'); gr.addColorStop(1, '#cfd9e2');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    },
    // motion-blurred streaks: the photo shape the old fill turned to mush
    streaks(g) {
      g.fillStyle = '#b9c6d4'; g.fillRect(0, 0, W, H);
      for (let i = -H; i < W * 2; i += 5) {
        g.strokeStyle = `rgba(255,255,255,${0.25 + 0.5 * Math.abs(Math.sin(i))})`;
        g.lineWidth = 1 + (i % 7 === 0 ? 3 : 1);
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i - H * 0.8, H); g.stroke();
        g.strokeStyle = `rgba(40,60,80,${0.10 + 0.2 * Math.abs(Math.cos(i))})`;
        g.beginPath(); g.moveTo(i + 2, 0); g.lineTo(i + 2 - H * 0.8, H); g.stroke();
      }
    },
  };

  const run = (which, shape) => new Promise((resolve, reject) => {
    const truth = document.createElement('canvas'); truth.width = W; truth.height = H;
    const tg = truth.getContext('2d', { willReadFrequently: true });
    paint[which](tg);
    const td = tg.getImageData(0, 0, W, H).data;

    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(truth, 0, 0);
    const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
    const mg = mc.getContext('2d');
    mg.fillStyle = 'rgb(204,51,51)';
    g.fillStyle = '#20232a';
    if (shape === 'person') {
      g.beginPath(); g.arc(W / 2, H / 2 - 40, 14, 0, 7); g.fill();
      g.fillRect(W / 2 - 17, H / 2 - 27, 34, 54);
      g.fillRect(W / 2 - 12, H / 2 + 25, 10, 40); g.fillRect(W / 2 + 3, H / 2 + 25, 10, 40);
      mg.beginPath(); mg.arc(W / 2, H / 2 - 40, 20, 0, 7); mg.fill();
      mg.fillRect(W / 2 - 23, H / 2 - 33, 46, 66);
      mg.fillRect(W / 2 - 18, H / 2 + 21, 36, 50);
    } else {
      g.beginPath(); g.arc(W / 2, H / 2, 22, 0, 7); g.fill();
      mg.beginPath(); mg.arc(W / 2, H / 2, 28, 0, 7); mg.fill();
    }

    const image = g.getImageData(0, 0, W, H);
    const mask = mg.getImageData(0, 0, W, H);
    const holes = [];
    for (let i = 0, p = 3; i < W * H; i++, p += 4) if (mask.data[p] > 10) holes.push(i);
    const holeSet = new Set(holes);

    const worker = new Worker('./js/inpaint-worker.js');
    const t0 = performance.now();
    const pcts = [];
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('timed out')); }, 60000);
    worker.onmessage = e => {
      if (e.data.type === 'progress') { pcts.push(e.data.pct); return; }
      if (e.data.type === 'error') { clearTimeout(timer); worker.terminate(); reject(new Error(e.data.message)); return; }
      if (e.data.type !== 'result') return;
      clearTimeout(timer);
      worker.terminate();
      const px = e.data.patch.data;

      let sum = 0, n = 0, darkest = 255;
      for (const i of holes) {
        for (let k = 0; k < 3; k++) { sum += Math.abs(px[i * 4 + k] - td[i * 4 + k]); n++; }
        const lum = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
        if (lum < darkest) darkest = lum;
      }
      const energy = (data, wantHole) => {
        let e2 = 0, c2 = 0;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (holeSet.has(i) !== wantHole) continue;
          for (let k = 0; k < 3; k++) {
            e2 += Math.abs(data[i * 4 + k] - data[(i + 1) * 4 + k])
                + Math.abs(data[i * 4 + k] - data[(i + W) * 4 + k]);
          }
          c2++;
        }
        return c2 ? e2 / c2 : 0;
      };
      resolve({
        which, shape,
        err: +(sum / n).toFixed(1),
        detail: +(energy(px, true) / (energy(td, false) || 1)).toFixed(2),
        darkest: Math.round(darkest),
        ms: Math.round(performance.now() - t0),
        progress: pcts.length,
      });
    };
    worker.postMessage({ type: 'inpaint', image, mask }, [image.data.buffer, mask.data.buffer]);
  });

  const out = [];
  for (const which of ['plain', 'streaks']) {
    for (const shape of ['blob', 'person']) out.push(await run(which, shape));
  }
  return out;
});

for (const r of results) {
  const id = `${r.which}, ${r.shape}`;
  // the object itself is #20232a — luminance ~34. Nothing that dark may survive.
  ok(r.darkest > 70, `${id}: the object is really gone (darkest pixel left ${r.darkest}/255)`);
  ok(r.err < 6, `${id}: the fill is close to the background that was really there (${r.err}/255)`);
  // the assertion the old fill could never pass: it scored 0.05 here
  ok(r.detail > 0.6,
     `${id}: the fill has the same kind of texture as the photo around it (${r.detail}, 1.0 = identical) ` +
     '— a smooth smear scores near 0 and would pass an error-only check');
  ok(r.ms < 8000, `${id}: finished in ${r.ms}ms`);
  ok(r.progress >= 2, `${id}: reported progress while it ran (${r.progress} updates)`);
}
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join('; ') : ''));

await browser.close();
server.close();
process.exit(R.finish() ? 1 : 0);
