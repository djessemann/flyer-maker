// Not a pass/fail suite — a measuring tape. Prints the interaction costs and
// geometry that docs/ui-revision.md makes claims about, so those claims can be
// re-checked instead of trusted.
//
// Run: npm run audit
import { serveRepo, shimCDN, launchBrowser, PHONE } from './lib/harness.mjs';

const { server, origin } = await serveRepo();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
await shimCDN(ctx);
const page = await ctx.newPage();
const say = (k, m) => console.log(`[${k}] ${m}`);
const tap = async s => { await page.locator(s).first().tap(); await page.waitForTimeout(260); };

await page.goto(origin + '/');
await page.waitForTimeout(900);
await tap('#btnNew');
await tap('[data-p="ig-story"]');

// screen budget
const budget = await page.evaluate(() => ({
  h: innerHeight,
  top: Math.round(document.querySelector('#viewEditor .topbar').getBoundingClientRect().height),
  bar: Math.round(document.querySelector('#actionbar').getBoundingClientRect().height),
  ws: Math.round(document.querySelector('#ws').getBoundingClientRect().height),
}));
say('BUDGET', `${budget.h}px = topbar ${budget.top} + canvas ${budget.ws} + bar ${budget.bar} ` +
    `(chrome ${Math.round((budget.top + budget.bar) / budget.h * 100)}%)`);

// put a headline in the lower third, where flyer headlines live
await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const t = m.addText(); t.exitEditing();
  t.set({ text: 'BLOCK PARTY', fontSize: 110, top: m.ed.docH * 0.62,
          left: m.ed.docW * 0.08, width: m.ed.docW * 0.84 });
  t.setCoords(); m.ed.canvas.setActiveObject(t); m.ed.canvas.requestRenderAll();
});
await page.waitForTimeout(400);

// bar fit
const bar = await page.evaluate(() => {
  const b = document.querySelector('#actionbar');
  const r = b.getBoundingClientRect();
  const acts = [...b.querySelectorAll('.act')];
  return {
    labels: acts.map(a => a.querySelector('.act-l').textContent),
    needs: b.scrollWidth, has: b.clientWidth,
    off: acts.filter(a => a.getBoundingClientRect().right > r.right + 1)
             .map(a => a.querySelector('.act-l').textContent),
    minW: Math.min(...acts.map(a => Math.round(a.getBoundingClientRect().width))),
    minH: Math.min(...acts.map(a => Math.round(a.getBoundingClientRect().height))),
  };
});
say('BAR', `${bar.labels.join(' · ')}`);
say('BAR', `needs ${bar.needs}px in ${bar.has}px; off-screen: ${bar.off.length ? bar.off.join(',') : 'none'}`);
say('BAR', `smallest target ${bar.minW}x${bar.minH}px`);

// how much of the selection each sheet hides
const overlap = async key => {
  await page.locator(`#actionbar [data-a="${key}"]`).first().tap();
  await page.waitForTimeout(450);
  const pct = await page.evaluate(async () => {
    const m = await import('./js/editor.js');
    const o = m.ed.canvas.getActiveObject();
    if (!o) return -1;
    const r = o.getBoundingRect(), vt = m.ed.canvas.viewportTransform;
    const el = m.ed.canvas.lowerCanvasEl.getBoundingClientRect();
    const box = { l: el.left + r.left * vt[0] + vt[4], t: el.top + r.top * vt[3] + vt[5],
                  w: r.width * vt[0], h: r.height * vt[3] };
    const s = document.querySelector('#sheet').getBoundingClientRect();
    const ox = Math.max(0, Math.min(box.l + box.w, s.right) - Math.max(box.l, s.left));
    const oy = Math.max(0, Math.min(box.t + box.h, s.bottom) - Math.max(box.t, s.top));
    return Math.round((ox * oy) / (box.w * box.h) * 100);
  });
  const h = await page.evaluate(() =>
    Math.round(document.querySelector('#sheet').getBoundingClientRect().height));
  await page.locator('#sheetClose').tap();
  await page.waitForTimeout(220);
  return { pct, h };
};
for (const k of ['fill', 'font', 'more']) {
  const { pct, h } = await overlap(k);
  say('OCCLUSION', `"${k}" sheet is ${h}px tall and hides ${pct}% of the selected layer` +
      (pct > 0 ? '  <-- you cannot see your change' : ''));
}

// can the bar be reached while a sheet is open
await tap('[data-a="fill"]');
const live = await page.evaluate(() => {
  const a = document.querySelector('#actionbar [data-a="font"]').getBoundingClientRect();
  const el = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
  return !!(el && el.closest('#actionbar'));
});
say('BAR', `reachable while a sheet is open: ${live}`);
await tap('#sheetClose');

// contrast of the smallest ui text
const contrast = await page.evaluate(() => {
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  const parse = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const bar = document.querySelector('#actionbar');
  const l = bar.querySelector('.act-l');
  return { r: +ratio(parse(getComputedStyle(l).color), parse(getComputedStyle(bar).backgroundColor)).toFixed(2),
           size: getComputedStyle(l).fontSize };
});
say('CONTRAST', `bar labels ${contrast.r}:1 at ${contrast.size} (AA wants 4.5:1)`);

await browser.close();
server.close();
