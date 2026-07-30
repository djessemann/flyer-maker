// End-to-end pass over the whole app on a phone-sized TOUCH viewport, tapping
// real targets rather than calling functions. Also re-measures the UX numbers
// from docs/ui-revision.md, so those claims stay honest instead of decaying.
//
// Run: npm run test:mobile
import { readFileSync } from 'fs';
import {
  serveRepo, shimCDN, launchBrowser, assertPinnedVersions, PHONE, reporter,
  pollUntil, LAYER_SNAPSHOT,
} from './lib/harness.mjs';

const R = reporter('mobile suite');
const ok = (c, n) => R.ok(c, n);

// if the app's CDN pins and our local copies disagree, everything below is
// testing a build users never see — say so and stop
for (const p of assertPinnedVersions()) ok(false, p);

const { server, origin } = await serveRepo();
const browser = await launchBrowser();
// Service workers are blocked here on purpose. Once one is active it issues its
// own fetches, which route interception cannot reach, so the pinned CDN shims
// would be bypassed and this suite would depend on real network. Offline and
// service-worker behaviour is covered separately in tests/offline.test.mjs.
const ctx = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
await shimCDN(ctx);

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: '+e.message));
page.on('console', m => { if (m.type()==='error') errs.push('console: '+m.text()); });

const tap = async sel => { await page.locator(sel).first().tap(); await page.waitForTimeout(240); };
const ed = () => page.evaluate(async () => (await import('./js/editor.js')).ed);
const kinds = () => page.evaluate(async () => (await import('./js/editor.js')).ed.canvas.getObjects().map(o=>o.pKind));
const active = () => page.evaluate(async () => {
  const o = (await import('./js/editor.js')).ed.canvas.getActiveObject();
  return o ? { kind:o.pKind, fill:o.fill, stroke:o.stroke, opacity:o.opacity, fontSize:o.fontSize,
               fontFamily:o.fontFamily, textAlign:o.textAlign, rx:o.rx, strokeWidth:o.strokeWidth,
               angle:o.angle, flipX:o.flipX, lineHeight:o.lineHeight, charSpacing:o.charSpacing,
               editing:!!o.isEditing } : null;
});
const bar = () => page.$$eval('#actionbar .act-l', els => els.map(e=>e.textContent));
const addPhoto = () => page.evaluate(async () => {
  const c=document.createElement('canvas');c.width=900;c.height=700;const g=c.getContext('2d');
  const gr=g.createLinearGradient(0,0,900,700);gr.addColorStop(0,'#22423B');gr.addColorStop(1,'#3A6156');
  g.fillStyle=gr;g.fillRect(0,0,900,700);
  g.fillStyle='#ffffff';g.fillRect(400,300,110,110);
  const b=await new Promise(r=>c.toBlob(r,'image/png'));
  const m=await import('./js/editor.js');
  await m.addImageFromFile(new File([b],'p.png',{type:'image/png'}));
});

await page.goto(origin + '/');
await page.waitForTimeout(1100);
const exposeEd = () => page.evaluate(async () => {
  window.__pasteupEd = (await import('./js/editor.js')).ed;
});
await exposeEd();

// ---------- home ----------
ok(await page.locator('#btnNew').isVisible(), 'home: new flyer button visible');
await tap('#btnNew');
// wait for the sheet to finish sliding up before reading a point on it: mid
// transition its top is still below the viewport and elementFromPoint returns
// null, which made this check fail at random rather than on a real regression
await pollUntil(page, () => {
  const s = document.querySelector('#sheet').getBoundingClientRect();
  return s.top < innerHeight - 80;
}, 4000);
const stacking = await page.evaluate(() => {
  const s = document.querySelector('#sheet').getBoundingClientRect();
  if (s.top >= innerHeight - 80) return 'sheet never came up (top ' + Math.round(s.top) + ')';
  const el = document.elementFromPoint(s.left + s.width/2, s.top + 40);
  return el && el.closest('#sheet') ? 'sheet' : (el && (el.id || el.className) || 'nothing');
});
ok(stacking === 'sheet', 'sheet receives taps, not covered by overlay: ' + stacking);
await tap('[data-p="ig-post"]');
ok(await page.locator('#viewEditor').isVisible(), 'editor opens');

// ---------- bar: empty ----------
ok(JSON.stringify(await bar()) === JSON.stringify(['text','photo','shape','layers','canvas']),
   'bar (nothing selected): ' + (await bar()).join(','));

// ---------- FIX 1: add stays reachable when something is selected ----------
await addPhoto();
await page.waitForTimeout(500);
ok((await active()).kind === 'image', 'photo added and selected');
let b = await bar();
ok(b[0] === 'add', 'FIX: "add" is the first item even with a photo selected: ' + b.join(','));
await tap('[data-a="add"]');
// "add" used to open a sheet over the flyer listing the same three verbs the
// empty bar shows directly. It now expands in the bar itself, nothing covered.
ok((await page.locator('#actionbar [data-x="text"]').count()) === 1,
   'FIX: "add" expands in the bar, no sheet: text/photo/shape are in #actionbar');
ok(!(await page.locator('#sheet').evaluate(e => e.classList.contains('on'))),
   'FIX: and no sheet is opened over the flyer to reach them');
await tap('#actionbar [data-x="text"]');
await page.waitForTimeout(400);
ok((await kinds()).includes('text'), 'text added without ever deselecting the photo');
await page.keyboard.type('BLOCK PARTY');
await page.evaluate(async () => (await import('./js/editor.js')).ed.canvas.getActiveObject().exitEditing());
await page.waitForTimeout(300);

// ---------- FIX 2: the bar fits ----------
b = await bar();
ok(JSON.stringify(b) === JSON.stringify(['add','edit','font','color','size','move','more']),
   'text bar: ' + b.join(','));
const fit = await page.evaluate(() => {
  const bar = document.querySelector('#actionbar');
  const r = bar.getBoundingClientRect();
  const off = [...bar.querySelectorAll('.act')]
    .filter(a => a.getBoundingClientRect().right > r.right + 1)
    .map(a => a.querySelector('.act-l').textContent);
  return { scrollW: bar.scrollWidth, clientW: bar.clientWidth, off };
});
ok(fit.off.length === 0,
   `FIX: whole bar fits without scrolling (${fit.scrollW}px in ${fit.clientW}px)` +
   (fit.off.length ? ' — still off-screen: '+fit.off.join(',') : ''));

// ---------- FIX 3: sheets no longer hide the selection ----------
const overlapFor = async key => {
  await page.locator(`#actionbar [data-a="${key}"]`).first().tap();
  await page.waitForTimeout(450);
  const pct = await page.evaluate(async () => {
    const m = await import('./js/editor.js');
    const o = m.ed.canvas.getActiveObject();
    const r = o.getBoundingRect();
    const vt = m.ed.canvas.viewportTransform;
    const el = m.ed.canvas.lowerCanvasEl.getBoundingClientRect();
    const box = { left: el.left + r.left*vt[0] + vt[4], top: el.top + r.top*vt[3] + vt[5],
                  w: r.width*vt[0], h: r.height*vt[3] };
    const s = document.querySelector('#sheet').getBoundingClientRect();
    const ox = Math.max(0, Math.min(box.left+box.w, s.right) - Math.max(box.left, s.left));
    const oy = Math.max(0, Math.min(box.top+box.h, s.bottom) - Math.max(box.top, s.top));
    // also: how much of the layer is inside the strip left visible above the
    // sheet. Zero overlap is equally true of an object panned off-screen, which
    // is the regression this assertion exists to catch.
    const strip = { top: el.top, bottom: s.top };
    const vx = Math.max(0, Math.min(box.left+box.w, innerWidth) - Math.max(box.left, 0));
    const vy = Math.max(0, Math.min(box.top+box.h, strip.bottom) - Math.max(box.top, strip.top));
    return {
      pct: Math.round((ox*oy)/(box.w*box.h)*100),
      visible: Math.round((vx*vy)/(box.w*box.h)*100),
    };
  });
  return pct;
};
const covColor = await overlapFor('fill');
ok(covColor.pct === 0, `FIX: colour sheet covers ${covColor.pct}% of the text (was 100%)`);
ok(covColor.visible === 100,
   `and the text is fully inside the visible strip (${covColor.visible}%) — 0% overlap ` +
   'would also be true of a layer panned off-screen');
// and the change is applied live while visible
await tap('#sheetBody .sw[data-c="#cc3333"]');
ok((await active()).fill === '#cc3333', 'swatch applies: ' + (await active()).fill);
await tap('#sheetBody [data-custom]');
ok(await page.locator('#sheetBody .cp-sq').isVisible(), 'custom picker unfolds on request');
await page.fill('#sheetBody [data-hex]', '#22423b');
await page.locator('#sheetBody [data-hex]').press('Enter');
await page.waitForTimeout(250);
ok((await active()).fill === '#22423b', 'hex applies: ' + (await active()).fill);
const hue = await page.locator('#sheetBody .cp-hue').boundingBox();
await page.mouse.click(hue.x + hue.width*0.62, hue.y + hue.height/2);
await page.waitForTimeout(250);
ok((await active()).fill !== '#22423b', 'hue drag applies: ' + (await active()).fill);
await tap('#sheetClose');

const covFont = await overlapFor('font');
ok(covFont.pct === 0, `FIX: font sheet covers ${covFont.pct}% of the text (was 100%)`);
ok(covFont.visible === 100, `and the text stays fully visible above it (${covFont.visible}%)`);
ok((await page.locator('#sheetBody .frow').count()) > 20, 'font list populated');
await page.fill('#sheetBody [data-q]', 'anton');
await page.waitForTimeout(300);
ok((await page.locator('#sheetBody .frow').count()) <= 3, 'font search narrows');
await page.locator('#sheetBody .frow[data-fam="Anton"]').first().tap();
await pollUntil(page, async () =>
  (await import('./js/editor.js')).ed.canvas.getActiveObject().fontFamily === 'Anton', 12000);
ok((await active()).fontFamily === 'Anton', 'font applies: ' + (await active()).fontFamily);
ok(await page.locator('#sheetBody [data-load]').isVisible(), 'load-any-google-font present');
await tap('#sheetClose');

// ---------- FIX 4: size is inline, nothing dims, nothing covered ----------
await tap('[data-a="size"]');
const inline = await page.evaluate(() => ({
  inlineOpen: document.querySelector('#actionbar').classList.contains('inline-mode'),
  sheetOpen: document.querySelector('#sheet').classList.contains('on'),
  overlayOn: document.querySelector('#overlay').classList.contains('on'),
}));
ok(inline.inlineOpen && !inline.sheetOpen && !inline.overlayOn,
   'FIX: size is an inline slider — no sheet, no dimming');
await page.$eval('#actionbar [data-in]', el => { el.value=150; el.dispatchEvent(new Event('input',{bubbles:true})); });
await page.waitForTimeout(220);
ok((await active()).fontSize === 150, 'inline size applies: ' + (await active()).fontSize);
await tap('#actionbar [data-done]');
ok((await bar()).includes('font'), 'done restores the bar');

// ---------- FIX 5: edit affordance + done while typing ----------
await tap('[data-a="edit"]');
ok((await active()).editing === true, 'FIX: "edit" enters text editing');
const editBar = await page.$$eval('#actionbar .inline-l', e => e.map(x=>x.textContent));
ok(editBar[0] === 'editing text', 'FIX: bar shows an editing state with a done button');
await tap('#actionbar [data-done]');
ok((await active()).editing === false, 'done exits editing');

// ---------- more: the long tail ----------
await tap('[data-a="more"]');
await tap('#sheetBody [data-v="right"]');
ok((await active()).textAlign === 'right', 'align (in more): ' + (await active()).textAlign);
await page.$eval('#sheetBody [data-ls]', el => { el.value=200; el.dispatchEvent(new Event('input',{bubbles:true})); });
await page.waitForTimeout(200);
ok((await active()).charSpacing === 200, 'letter spacing (in more): ' + (await active()).charSpacing);
await page.$eval('#sheetBody [data-lh]', el => { el.value=90; el.dispatchEvent(new Event('input',{bubbles:true})); });
await page.waitForTimeout(200);
ok(Math.abs((await active()).lineHeight-0.9) < .001, 'line height (in more)');
await page.$eval('#sheetBody [data-op]', el => { el.value=60; el.dispatchEvent(new Event('input',{bubbles:true})); });
await page.waitForTimeout(200);
ok(Math.abs((await active()).opacity-0.6) < .001, 'opacity (in more)');
await tap('#sheetBody [data-pos="cx"]');
const centred = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const o = m.ed.canvas.getActiveObject();
  const r = o.getBoundingRect();
  return Math.abs(r.left + r.width / 2 - m.ed.docW / 2);
});
ok(centred < 1.5, `centre across really centres it (off by ${centred.toFixed(2)}px)`);
await tap('#sheetClose');

// ---------- shapes ----------
await tap('[data-a="add"]');
await tap('#actionbar [data-x="shape"]');
await tap('#sheetBody [data-k="rounded"]');
ok((await active()).kind === 'rounded', 'shape added from the bar');
b = await bar();
ok(JSON.stringify(b) === JSON.stringify(['add','fill','stroke','corners','move','more']), 'shape bar: '+b.join(','));
await tap('[data-a="stroke"]');
await tap('#sheetBody .sw[data-c="#ffffff"]');
ok((await active()).stroke === '#ffffff', 'stroke colour: ' + (await active()).stroke);
ok((await active()).strokeWidth > 0, 'stroke width auto-set: ' + (await active()).strokeWidth);
await page.$eval('#sheetBody [data-wi]', el => { el.value=12; el.dispatchEvent(new Event('input',{bubbles:true})); });
await page.waitForTimeout(200);
ok((await active()).strokeWidth === 12, 'FIX: stroke thickness lives with stroke colour: ' + (await active()).strokeWidth);
await tap('#sheetClose');
await tap('[data-a="corners"]');
await page.$eval('#actionbar [data-in]', el => { el.value=40; el.dispatchEvent(new Event('input',{bubbles:true})); });
await page.waitForTimeout(200);
ok((await active()).rx === 40, 'corners inline slider: ' + (await active()).rx);
await tap('#actionbar [data-done]');

// ---------- photo ----------
await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const i = m.ed.canvas.getObjects().find(o=>o.pKind==='image');
  m.ed.canvas.setActiveObject(i); m.ed.canvas.requestRenderAll();
});
await page.waitForTimeout(300);
b = await bar();
ok(JSON.stringify(b) === JSON.stringify(['add','crop','adjust','replace','erase','move','more']), 'photo bar: '+b.join(','));
// erase was the one filled, dominant button on the photo bar: the most
// destructive action shouting loudest on a layout tool
ok(await page.locator('#actionbar [data-a="erase"]').evaluate(e => !e.classList.contains('primary')),
   'FIX: erase is no longer the primary-styled button on the photo bar');
await tap('[data-a="adjust"]');
await tap('#sheetBody [data-f="x"]');
ok((await active()).flipX === true, 'flip (in adjust)');
await tap('#sheetBody [data-fit]');
const fitted = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const o = m.ed.canvas.getObjects().find(x => x.pKind === 'image');
  const want = Math.min(m.ed.docW / o.width, m.ed.docH / o.height);
  return { d: Math.abs(o.scaleX - want), angle: o.angle,
           dx: Math.abs(o.left - (m.ed.docW - o.width * o.scaleX) / 2) };
});
ok(fitted.d < 1e-6 && fitted.angle === 0 && fitted.dx < 1,
   `fit really fits and centres (scale off ${fitted.d.toExponential(1)}, dx ${fitted.dx.toFixed(1)})`);
await tap('#sheetClose');

// ---------- crop: does the kept region stay where it was? ----------
// The whole risk in cropping is the offset: trim the left edge and the photo
// slides left, so everything you lined it up with is wrong. Track one landmark
// pixel of the photo and require it not to move on the flyer at all.
const landmarkAt = (px, py) => page.evaluate(async ([px, py]) => {
  const m = await import('./js/editor.js');
  const o = m.ed.canvas.getObjects().find(x => x.pKind === 'image');
  return { x: +(o.left + px * o.scaleX).toFixed(2), y: +(o.top + py * o.scaleY).toFixed(2),
           left: +o.left.toFixed(2), top: +o.top.toFixed(2), sx: o.scaleX,
           nat: [o._element.naturalWidth, o._element.naturalHeight] };
}, [px, py]);
const dragBy = async (sel, dx, dy) => {
  const bx = await page.locator(sel).boundingBox();
  const cx = bx.x + bx.width / 2, cy = bx.y + bx.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(cx + dx * i / 6, cy + dy * i / 6);
  await page.mouse.up();
  await page.waitForTimeout(120);
};
const preCrop = await landmarkAt(400, 300);
await tap('[data-a="crop"]');
ok(await page.locator('#crop').isVisible(), 'crop mode opens');
ok(/^\d+ × \d+ px$/.test((await page.locator('#cpHint').textContent()).trim()),
   'crop reads out the pixels being kept, and nothing else: ' +
   (await page.locator('#cpHint').textContent()));
await dragBy('.cp-h[data-h="nw"]', 55, 40);
await dragBy('.cp-h[data-h="se"]', -30, -25);
const cropped = await page.locator('#cpHint').textContent();
await tap('#cpGo');
await page.waitForTimeout(700);
const post = await landmarkAt(0, 0);
ok(post.nat[0] < preCrop.nat[0] && post.nat[1] < preCrop.nat[1],
   `the photo's pixels really were trimmed (${preCrop.nat.join('x')} -> ${post.nat.join('x')})`);
const trimX = Math.round((post.left - preCrop.left) / post.sx);
const trimY = Math.round((post.top - preCrop.top) / post.sx);
ok(trimX > 0 && trimY > 0, `crop came off the top-left, not the origin (${trimX},${trimY})`);
const moved = await landmarkAt(400 - trimX, 300 - trimY);
ok(Math.abs(moved.x - preCrop.x) < 2 && Math.abs(moved.y - preCrop.y) < 2,
   `the kept picture did not shift on the flyer (landmark ${preCrop.x},${preCrop.y} -> ${moved.x},${moved.y})`);
// and it survives a round trip through the export, at full resolution
const cropPx = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const blob = await m.renderPNGBlob(1);
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const o = m.ed.canvas.getObjects().find(x => x.pKind === 'image');
  const r = o.getBoundingRect();
  // the test photo is a green gradient; the headline can sit over the middle, so
  // sample a grid and count how much of the box is the photo's own colour
  let green = 0, total = 0;
  const seenAt = [];
  for (const fx of [0.15, 0.5, 0.85]) for (const fy of [0.15, 0.5, 0.85]) {
    const d = g.getImageData((r.left + r.width * fx) | 0, (r.top + r.height * fy) | 0, 1, 1).data;
    total++;
    if (d[1] > d[0] + 8 && d[1] > d[2] + 3) green++;
    seenAt.push([d[0], d[1], d[2]].join(','));
  }
  return { green, total, seenAt, w: Math.round(r.width) };
});
ok(cropPx.green >= 6,
   `the cropped photo fills its box in the export — ${cropPx.green}/${cropPx.total} sampled points ` +
   `are the photo's own colour (${cropPx.seenAt[0]})`);
// undo puts the whole photo back — crop must not be a one-way door
await tap('#btnUndo');
await page.waitForTimeout(700);
const undone = await landmarkAt(0, 0);
ok(undone.nat[0] === preCrop.nat[0] && undone.nat[1] === preCrop.nat[1],
   `undo restores the uncropped photo (${undone.nat.join('x')})`);
await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const i = m.ed.canvas.getObjects().find(o => o.pKind === 'image');
  m.ed.canvas.setActiveObject(i); m.ed.canvas.requestRenderAll();
});
await page.waitForTimeout(300);
// aspect locks are exact, not approximate
await tap('[data-a="crop"]');
await tap('#cpAspect [data-r="1"]');
const sq = await page.locator('#cpRect').boundingBox();
ok(Math.abs(sq.width - sq.height) <= 1, `square lock is square (${Math.round(sq.width)}x${Math.round(sq.height)})`);
await tap('#cpAspect [data-r="flyer"]');
const fl = await page.locator('#cpRect').boundingBox();
const wantR = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  return m.ed.docW / m.ed.docH;
});
ok(Math.abs(fl.width / fl.height - wantR) < 0.02,
   `"flyer" lock matches the canvas shape (${(fl.width / fl.height).toFixed(3)} vs ${wantR.toFixed(3)})`);
await tap('#cpCancel');
ok(!(await page.locator('#crop').isVisible()), 'cancel leaves crop without changing the photo');

// ---------- move: placing a small layer without a keyboard ----------
// a finger drag on a small layer grabs its own handles, and a phone has no
// arrow keys — this was the one gap a reviewer had to invent a workaround for
await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const t = m.ed.canvas.getObjects().find(o => o.pKind === 'text');
  m.ed.canvas.setActiveObject(t); m.ed.canvas.requestRenderAll();
});
await page.waitForTimeout(300);
const posOf = () => page.evaluate(async () => {
  const o = (await import('./js/editor.js')).ed.canvas.getActiveObject();
  return { left: o.left, top: o.top };
});
await tap('[data-a="move"]');
ok((await page.locator('#actionbar .nudge button').count()) === 4, 'move offers four directions in the bar');
const nudgeTargets = await page.$$eval('#actionbar .nudge button', els =>
  els.map(e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
ok(nudgeTargets.every(v => v >= 44), 'each nudge target is at least 44px: ' + nudgeTargets.join(','));
// five controls plus a 176px pad in 393px: "done" was clipped off the edge
const moveFit = await page.evaluate(() => {
  const bar = document.querySelector('#actionbar');
  const r = bar.getBoundingClientRect();
  const over = [...bar.querySelectorAll('.inline > *')]
    .filter(e => e.getBoundingClientRect().right > r.right + 1).length;
  return { over, scrollW: bar.scrollWidth, clientW: bar.clientWidth };
});
ok(moveFit.over === 0 && moveFit.scrollW <= moveFit.clientW,
   `the whole move row fits in the bar (${moveFit.scrollW}px in ${moveFit.clientW}px)`);
const p0 = await posOf();
await tap('#actionbar [data-n="right"]');
const p1 = await posOf();
ok(Math.abs((p1.left - p0.left) - 1) < 0.01, `one tap moves exactly 1px (${(p1.left - p0.left).toFixed(2)})`);
await tap('#actionbar [data-step]');
ok((await page.locator('#actionbar [data-step]').textContent()) === '10px', 'step toggles to 10px');
await tap('#actionbar [data-n="down"]');
const p2 = await posOf();
ok(Math.abs((p2.top - p1.top) - 10) < 0.01, `and then moves exactly 10px (${(p2.top - p1.top).toFixed(2)})`);
await tap('#actionbar [data-done]');
ok((await bar()).includes('move'), 'done returns the normal bar');
// hand the selection back to the photo for the erase block below
await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const i = m.ed.canvas.getObjects().find(o => o.pKind === 'image');
  m.ed.canvas.setActiveObject(i); m.ed.canvas.requestRenderAll();
});
await page.waitForTimeout(300);

// ---------- FIX 6: erase instructions visible on a phone ----------
await tap('[data-a="erase"]');
ok(await page.locator('#retouch').isVisible(), 'erase mode opens');
const hintVisible = await page.evaluate(() => {
  const t = document.querySelector('#rtHint');
  const r = t.getBoundingClientRect();
  return { shown: getComputedStyle(t).display !== 'none' && r.height > 0, text: t.textContent };
});
ok(hintVisible.shown, `FIX: instruction visible on phone — "${hintVisible.text}"`);

// ---------- erase: get close enough to mask something small ----------
// at fit zoom a 4096px photo shows at ~9%, so nothing finer than a ~116px blob
// could be masked at all. Zoom, then check a stroke lands where the finger was.
ok((await page.locator('#rtZoom').isVisible()), 'erase has a zoom control');
await tap('#rtZoom [data-z="in"]');
await tap('#rtZoom [data-z="in"]');
const zoomState = await page.evaluate(() => ({
  label: document.querySelector('#rtZoomVal').textContent,
  scale: +(document.querySelector('#rtWrap').style.transform.match(/scale\(([\d.]+)\)/) || [, 1])[1],
}));
ok(zoomState.scale > 1.5, `zoom really scales the photo (${zoomState.scale.toFixed(2)}x)`);
ok(/%/.test(zoomState.label), 'and reads out the magnification: ' + zoomState.label);
// paint a short stroke over the white square (native 400,300 .. 510,410)
const zt = await page.evaluate(() => {
  const m = document.querySelector('#rtMask');
  const r = m.getBoundingClientRect();
  const k = r.width / m.width;
  return { x: r.left + 455 * k, y: r.top + 355 * k, k };
});
ok(zt.x > 0 && zt.x < 393 && zt.y > 0 && zt.y < 800,
   'the zoomed-to spot is still on screen, so it can be painted');
await page.mouse.move(zt.x - 10, zt.y - 10);
await page.mouse.down();
for (let i = -10; i <= 10; i += 5) await page.mouse.move(zt.x + i, zt.y + i, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(150);
const zoomPaint = await page.evaluate(() => {
  const c = document.querySelector('#rtMask');
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  let n = 0, sx = 0, sy = 0;
  for (let i = 3, p = 0; i < d.length; i += 4, p++) if (d[i] > 10) {
    n++; sx += p % c.width; sy += (p / c.width) | 0;
  }
  return n ? { n, cx: Math.round(sx / n), cy: Math.round(sy / n) } : { n: 0 };
});
ok(zoomPaint.n > 0, 'painting works while zoomed in');
ok(zoomPaint.n && Math.abs(zoomPaint.cx - 455) < 60 && Math.abs(zoomPaint.cy - 355) < 60,
   `and the stroke lands where the finger was, not offset by the zoom ` +
   `(centre ${zoomPaint.cx},${zoomPaint.cy}, aimed at 455,355)`);
// a brush is a share of the image, so its px size does not change with zoom
const brushLabel = await page.locator('#rtBrushVal').textContent();
await tap('#rtZoom [data-z="fit"]');
ok((await page.locator('#rtBrushVal').textContent()) === brushLabel,
   `brush size is in image pixels, unchanged by zoom (${brushLabel})`);
ok((await page.locator('#rtZoomVal').textContent()) === 'fit', 'fit returns the whole photo');
await tap('#rtClear');

const mbox = await page.locator('#rtMask').boundingBox();
const sc = mbox.width / 900;
const cx = mbox.x + 455*sc, cy = mbox.y + 355*sc;
await page.mouse.move(cx-70*sc, cy-70*sc);
await page.mouse.down();
for (let i=-70;i<=70;i+=10){
  await page.mouse.move(cx+i*sc, cy-55*sc, {steps:2});
  await page.mouse.move(cx+i*sc, cy+55*sc, {steps:2});
}
await page.mouse.up();
await page.waitForTimeout(200);
// a big fill runs for seconds; watch every hint change so "erasing… 40%" is
// proved to actually appear rather than asserted from the source
await page.evaluate(() => {
  window.__hints = [];
  new MutationObserver(() => window.__hints.push(document.querySelector('#rtHint').textContent))
    .observe(document.querySelector('#rtHint'), { childList: true, characterData: true, subtree: true });
});
await tap('#rtGo');
await page.waitForFunction(() => document.querySelector('#rtHint').textContent.includes('gone'),
  null, { timeout: 60000 }).catch(()=>{});
ok((await page.locator('#rtHint').textContent()).includes('gone'), 'inpaint reported done');
const seen = (await page.evaluate(() => window.__hints || [])).filter(t => /erasing… \d+%/.test(t));
ok(seen.length >= 2, `progress counted up while it ran (${seen.length} updates, e.g. "${seen[1] || seen[0] || 'none'}")`);
// "no longer white" would also be satisfied by a black hole, a transparent one,
// or a patch composited at the wrong offset. Require the fill to match what
// surrounds it, and require the rest of the photo to be untouched.
const erased = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const o = m.ed.canvas.getObjects().find(x => x.pKind === 'image');
  const el = o._element;
  const c = document.createElement('canvas');
  c.width = el.naturalWidth; c.height = el.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(el, 0, 0);
  const mean = (x, y, w, h) => {
    const d = g.getImageData(x, y, w, h).data;
    const t = [0, 0, 0]; let n = 0, minA = 255;
    for (let i = 0; i < d.length; i += 4) { t[0]+=d[i]; t[1]+=d[i+1]; t[2]+=d[i+2]; if (d[i+3]<minA) minA=d[i+3]; n++; }
    return { c: t.map(v => Math.round(v / n)), minA };
  };
  const hole = mean(430, 330, 50, 50);
  const left = mean(300, 330, 40, 40);
  const right = mean(600, 330, 40, 40);
  const far = mean(40, 40, 40, 40);
  let bright = 0;
  const d = g.getImageData(430, 330, 50, 50).data;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i+1] > 200 && d[i+2] > 200) bright++;
  return { hole, left, right, far, bright };
});
ok(erased.bright === 0, `the object is gone (${erased.bright} bright pixels left)`);
const expect = erased.hole.c.map((_, i) => Math.round((erased.left.c[i] + erased.right.c[i]) / 2));
const off = Math.max(...erased.hole.c.map((v, i) => Math.abs(v - expect[i])));
ok(off <= 12,
   `and the fill matches what surrounds it (${erased.hole.c} vs neighbours ${expect}, off by ${off}/255)`);
ok(erased.hole.minA === 255, `the fill is fully opaque (min alpha ${erased.hole.minA})`);
ok(erased.far.c.every(v => v > 0),
   `the rest of the photo is untouched (far corner ${erased.far.c}) — a mis-offset patch would show here`);
// no mask painted: it must tell you, not silently do nothing
await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
await tap('#rtGo');
await page.waitForTimeout(400);
const emptyMsg = await page.locator('#toast').textContent();
ok(/paint over something first/.test(emptyMsg),
   `erasing with no mask explains itself ("${emptyMsg}")`);

// undo inside erase mode reverts an applied erase, which cancel never did
await tap('#rtCancel');

// ---------- layers / canvas / dedupe ----------
await tap('[data-a="more"]');
await tap('#sheetBody [data-m="layers"]');
ok((await page.locator('#sheetBody .lrow[data-i]').count()) === 3, 'layers lists 3 layers');
// visibility must actually remove it from what gets rendered, not just flip a flag
const eyeOff = await (async () => {
  await tap('#sheetBody .lrow[data-i="1"] [data-eye]');
  return page.evaluate(async () => {
    const m = await import('./js/editor.js');
    const objs = m.ed.canvas.getObjects().filter(o => o.pKind !== 'bg').reverse();
    return objs[1] ? objs[1].visible : null;
  });
})();
ok(eyeOff === false, 'the eye button really hides the layer');
await tap('#sheetBody .lrow[data-i="1"] [data-eye]');
const eyeOn = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const objs = m.ed.canvas.getObjects().filter(o => o.pKind !== 'bg').reverse();
  return objs[1] ? objs[1].visible : null;
});
ok(eyeOn === true, 'and shows it again');

// reorder must move the layer exactly one slot, not merely not throw
const before = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  return m.ed.canvas.getObjects().map(o => o.pKind);
});
await tap('#sheetBody .lrow[data-i="2"] [data-up]');
const afterOrder = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  return m.ed.canvas.getObjects().map(o => o.pKind);
});
ok(JSON.stringify(before) !== JSON.stringify(afterOrder),
   `reorder moved a layer (${before.join(',')} -> ${afterOrder.join(',')})`);
const bgButtons = await page.locator('#sheetBody [data-bgrow]').count();
ok(bgButtons === 1, 'FIX: layers shows background as a pointer to canvas, not a second colour control');
await tap('#sheetBody [data-bgrow]');
ok((await page.locator('#sheetTitle').textContent()) === 'canvas', 'background row leads to the canvas sheet');
await tap('#sheetBody [data-bgsw] [data-c="#111110"]');
ok((await page.evaluate(async () => (await import('./js/editor.js')).ed.bgRect.fill)) === '#111110',
   'background colour applies from canvas sheet');
await tap('#sheetBody [data-preset="ig-story"]');
let e2 = await ed();
ok(e2.docW===1080 && e2.docH===1920, 'preset resize: '+e2.docW+'x'+e2.docH);
await tap('#sheetBody [data-swap]');
e2 = await ed();
ok(e2.docW===1920 && e2.docH===1080, 'swap orientation: '+e2.docW+'x'+e2.docH);
await tap('#sheetBody [data-swap]');
await tap('#sheetClose');

// ---------- export: render -> preview -> save ----------
await tap('#btnExport');
ok((await page.locator('#sheetBody [data-png]').textContent()).includes('2160'), 'export shows 2x dims');
// render at 2x on a 1080x1920 doc: the old data-url path produced ~15MB of base64
await tap('#sheetBody [data-png]');
await page.waitForSelector('#sheetBody .exp-prev img', { timeout: 30000 });
ok(true, 'FIX: export renders a preview you can actually see');
const prev = await page.evaluate(() => {
  const i = document.querySelector('#sheetBody .exp-prev img');
  return { src: i.src.slice(0,5), w: i.naturalWidth, h: i.naturalHeight };
});
ok(prev.src === 'blob:', 'FIX: preview is a blob url, not a multi-MB data url');
ok(prev.w === 2160 && prev.h === 3840, `preview is the real full-size png: ${prev.w}x${prev.h}`);
const dl = page.waitForEvent('download', { timeout: 25000 }).catch(()=>null);
await tap('#sheetBody [data-save]');
const file = await dl;
ok(!!file && /\.png$/.test(file.suggestedFilename()), 'png saved: ' + (file && file.suggestedFilename()));
// doc §8 spells out the filename; only asserting /\.png$/ let it drift
const wantName = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  return m.exportFilename(2);   // this save ran at 2x, so the name carries @2x
});
ok(file && file.suggestedFilename() === wantName,
   `the filename follows the documented shape (${file && file.suggestedFilename()})`);
ok(/^[a-z0-9-]+-\d+x\d+(@\dx)?\.png$/.test(wantName), `and it is name-WxH[@Nx].png (${wantName})`);
// and it's a genuine png on disk, not a truncated blob
if (file) {
  const path = await file.path();
  const head = readFileSync(path).subarray(0,8);
  ok(head[0]===0x89 && head[1]===0x50 && head[2]===0x4e && head[3]===0x47,
     'saved file has a real png signature (' + readFileSync(path).length + ' bytes)');
}
// project file too
await tap('#sheetClose');
await tap('#btnExport');
const dl2 = page.waitForEvent('download', { timeout: 20000 }).catch(()=>null);
await tap('#sheetBody [data-proj]');
const pf = await dl2;
ok(!!pf && /\.pasteup\.json$/.test(pf.suggestedFilename()), 'project file saved: ' + (pf && pf.suggestedFilename()));

// ---------- and it can be imported back: the whole point of the format ----------
const projSnapshot = await page.evaluate(LAYER_SNAPSHOT);
if (pf) {
  const projPath = await pf.path();
  await tap('#sheetClose');
  await tap('#btnBack');
  await page.waitForTimeout(600);
  const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
  await page.locator('#btnImport').tap();
  (await chooser).setFiles(projPath);
  await page.waitForTimeout(1500);
  await exposeEd();
  const imported = await page.evaluate(LAYER_SNAPSHOT);
  const same = JSON.stringify(projSnapshot.objs.map(o => [o.pKind, o.text, o.fill, o.pName]))
            === JSON.stringify(imported.objs.map(o => [o.pKind, o.text, o.fill, o.pName]));
  ok(await page.locator('#viewEditor').isVisible() && same
     && imported.docW === projSnapshot.docW && imported.bg === projSnapshot.bg,
     `a saved project file imports back intact (${imported.objs.length} layers, ` +
     `${imported.docW}x${imported.docH}, bg ${imported.bg})`);
  const photoOk = await page.evaluate(async () => {
    const m = await import('./js/editor.js');
    const o = m.ed.canvas.getObjects().find(x => x.pKind === 'image');
    return o && o._element ? o._element.naturalWidth : 0;
  });
  ok(photoOk > 0, `the imported photo has real pixels (${photoOk}px wide)`);
}

// a file that isn't ours must be refused, with an explanation
await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
await tap('#btnBack');
await page.waitForTimeout(500);
const badChooser = page.waitForEvent('filechooser', { timeout: 10000 });
await page.locator('#btnImport').tap();
(await badChooser).setFiles({ name: 'nope.json', mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({ app: 'notpasteup' })) });
await page.waitForTimeout(900);
const badMsg = await page.locator('#toast').textContent();
ok(/doesn.t look like a pasteup project/.test(badMsg) && await page.locator('#viewHome').isVisible(),
   `a foreign json file is refused with an explanation ("${badMsg}")`);

// back into the flyer for the rest of the run
await tap('#projectGrid .proj');
await page.waitForTimeout(1200);
await exposeEd();

// the photo picker must be openable — display:none inputs can refuse on mobile
const inputOk = await page.evaluate(() => {
  const i = document.querySelector('#fileImage');
  const st = getComputedStyle(i);
  return { display: st.display, visible: st.display !== 'none' };
});
ok(inputOk.visible, 'FIX: file input is off-screen, not display:none (display=' + inputOk.display + ')');
let picked = false;
page.once('filechooser', fc => { picked = true; fc.setFiles([]).catch(()=>{}); });
await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  m.ed.canvas.discardActiveObject();
  const u = await import('./js/ui.js'); u.renderBar();
});
await page.waitForTimeout(250);
await page.locator('#actionbar [data-a="add-photo"]').first().tap();
await page.waitForTimeout(700);
ok(picked, 'FIX: tapping "photo" actually opens the file picker');

// ---------- persistence: every property, not just the layer types ----------
// A type-only check let real data loss ship: with PROPS trimmed, layer names
// were erased and *locked layers came back unlocked*, and the suite stayed green.
// Give the layers distinguishing state first so there is something to lose.
await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const objs = m.ed.canvas.getObjects().filter(o => o.pKind !== 'bg');
  objs.forEach((o, i) => { o.pName = 'layer ' + i; });
  const shape = objs.find(o => o.pKind === 'rounded');
  if (shape) { shape.pLocked = true; shape.selectable = false; shape.evented = false; }
  const txt = objs.find(o => o.pKind === 'text');
  if (txt) txt.set({ opacity: 0.65, charSpacing: 120 });
  m.ed.canvas.requestRenderAll();
});
const beforeSave = await page.evaluate(LAYER_SNAPSHOT);
const docId = await page.evaluate(async () => (await import('./js/editor.js')).ed.id);
await page.evaluate(async () => (await import('./js/editor.js')).flushSave());
await page.waitForTimeout(600);
await page.reload();
await page.waitForTimeout(1200);
// target this flyer by id: earlier import checks legitimately leave more than one
ok((await page.locator(`#projectGrid [data-id="${docId}"]`).count()) === 1,
   'this flyer is listed on the home screen after a reload');
await tap(`#projectGrid [data-id="${docId}"]`);
await page.waitForTimeout(1200);
await exposeEd();
const afterSave = await page.evaluate(LAYER_SNAPSHOT);
if (JSON.stringify(beforeSave) === JSON.stringify(afterSave)) {
  ok(true, `every layer property survived save -> reload (${afterSave.objs.length} layers, ` +
           `${afterSave.docW}x${afterSave.docH}, bg ${afterSave.bg})`);
} else {
  // name the first thing that changed, so the failure is actionable
  const diffs = [];
  if (beforeSave.objs.length !== afterSave.objs.length) {
    diffs.push(`layer count ${beforeSave.objs.length} -> ${afterSave.objs.length}`);
  }
  for (const k of ['docW', 'docH', 'bg']) {
    if (beforeSave[k] !== afterSave[k]) diffs.push(`${k}: ${beforeSave[k]} -> ${afterSave[k]}`);
  }
  beforeSave.objs.forEach((b, i) => {
    const a = afterSave.objs[i] || {};
    for (const k of Object.keys(b)) {
      if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) {
        diffs.push(`layer ${i} (${b.pKind}) ${k}: ${JSON.stringify(b[k])} -> ${JSON.stringify(a[k])}`);
      }
    }
  });
  ok(false, 'save -> reload lost data: ' + diffs.slice(0, 8).join('; '));
}
// a restored photo must still have real pixels, not a dead src
const photoAlive = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const o = m.ed.canvas.getObjects().find(x => x.pKind === 'image');
  if (!o || !o._element || !o._element.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  c.getContext('2d').drawImage(o._element, 0, 0, 8, 8);
  const d = c.getContext('2d').getImageData(2, 2, 1, 1).data;
  return { w: o._element.naturalWidth, px: [d[0], d[1], d[2]], alpha: d[3] };
});
ok(photoAlive && photoAlive.w > 0 && photoAlive.alpha === 255,
   `the restored photo still has pixels (${photoAlive ? photoAlive.w + 'px, rgb ' + photoAlive.px : 'GONE'})`);

// ---------- viewport restored after a sheet pans ----------
const vptBefore = await page.evaluate(async () => [...(await import('./js/editor.js')).ed.canvas.viewportTransform]);
await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const t = m.ed.canvas.getObjects().find(o=>o.pKind==='text');
  m.ed.canvas.setActiveObject(t); m.ed.canvas.requestRenderAll();
});
await page.waitForTimeout(300);
await tap('[data-a="fill"]');
await tap('#sheetClose');
const vptAfter = await page.evaluate(async () => [...(await import('./js/editor.js')).ed.canvas.viewportTransform]);
ok(JSON.stringify(vptBefore) === JSON.stringify(vptAfter),
   'canvas returns to where it was after the sheet closes');

const scrollW = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
ok(scrollW, 'no horizontal page overflow at 393px');

// ---------- keyboard, undo/redo and rename: claimed verified, never tested ----------
await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const u = await import('./js/ui.js');
  const t = m.ed.canvas.getObjects().find(o => o.pKind === 'text');
  m.ed.canvas.setActiveObject(t); m.ed.canvas.requestRenderAll(); u.renderBar();
});
await page.waitForTimeout(300);
const nudged = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const o = m.ed.canvas.getActiveObject();
  const start = o.left;
  document.body.focus();
  return { start, left: o.left };
});
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(120);
const after1 = await page.evaluate(async () =>
  (await import('./js/editor.js')).ed.canvas.getActiveObject().left);
ok(Math.abs(after1 - nudged.start - 1) < 0.01, `arrow key nudges exactly 1px (moved ${(after1-nudged.start).toFixed(2)})`);
await page.keyboard.press('Shift+ArrowRight');
await page.waitForTimeout(120);
const after2 = await page.evaluate(async () =>
  (await import('./js/editor.js')).ed.canvas.getActiveObject().left);
ok(Math.abs(after2 - after1 - 10) < 0.01, `shift+arrow nudges exactly 10px (moved ${(after2-after1).toFixed(2)})`);

// undo must restore a real value, and it must still work with a slider focused
const undoWorks = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const o = m.ed.canvas.getActiveObject();
  const before = o.fill;
  o.set('fill', '#7fa650');
  m.ed.canvas.requestRenderAll();
  m.pushSnapshot();
  await new Promise(r => setTimeout(r, 400));
  await m.undo();
  await new Promise(r => setTimeout(r, 400));
  const now = m.ed.canvas.getObjects().find(x => x.pKind === 'text');
  return { before, after: now ? now.fill : null };
});
ok(undoWorks.after === undoWorks.before,
   `undo restores the previous value (${undoWorks.before} -> changed -> ${undoWorks.after})`);

// a focused slider used to swallow cmd-Z entirely
const undoWithSliderFocus = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const u = await import('./js/ui.js');
  const t = m.ed.canvas.getObjects().find(o => o.pKind === 'text');
  m.ed.canvas.setActiveObject(t); u.renderBar();
  document.querySelector('#actionbar [data-a="size"]').click();
  await new Promise(r => setTimeout(r, 350));
  const slider = document.querySelector('#actionbar [data-in]');
  if (!slider) return { ok: false, why: 'no inline slider' };
  slider.focus();
  return { ok: true, focused: document.activeElement === slider, type: slider.type };
});
ok(undoWithSliderFocus.ok && undoWithSliderFocus.focused, 'an inline slider can take focus');
// real check: change something, focus the slider, press cmd-Z, and require the
// document to actually revert. (An assertion like `x !== null` here would pass
// no matter what — the exact failure mode this suite is meant to have stopped.)
const beforeKey = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const o = m.ed.canvas.getActiveObject();
  const was = Math.round(o.fontSize);
  o.set('fontSize', was + 40);
  m.ed.canvas.requestRenderAll();
  m.pushSnapshot();
  await new Promise(r => setTimeout(r, 400));
  document.querySelector('#actionbar [data-in]')?.focus();
  return { was, bumped: Math.round(o.fontSize), focused: document.activeElement?.type };
});
await page.keyboard.press('Meta+z');
await page.waitForTimeout(700);
const afterKey = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const t = m.ed.canvas.getObjects().find(o => o.pKind === 'text');
  return t ? Math.round(t.fontSize) : null;
});
ok(beforeKey.focused === 'range' && afterKey === beforeKey.was,
   `cmd-Z still undoes with a slider focused (${beforeKey.was} -> ${beforeKey.bumped} -> ${afterKey})`);
await page.evaluate(() => { const d = document.querySelector('#actionbar [data-done]'); if (d) d.click(); });
await page.waitForTimeout(250);

// rename has to be reachable by touch, and has to persist
await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  m.ed.canvas.discardActiveObject();
  const u = await import('./js/ui.js'); u.renderBar();
});
await page.waitForTimeout(250);
await tap('[data-a="layers"]');
ok((await page.locator('#sheetBody .lrow[data-i="0"] [data-rename]').count()) === 1,
   'FIX: layers rows have a rename button — a double-tap never fired dblclick on touch');
await tap('#sheetBody .lrow[data-i="0"] [data-rename]');
await page.fill('#sheetBody .lrow[data-i="0"] [data-name] input', 'my headline');
await page.locator('#sheetBody .lrow[data-i="0"] [data-name] input').press('Enter');
await page.waitForTimeout(400);
const renamed = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  return m.ed.canvas.getObjects().filter(o => o.pKind !== 'bg').reverse()[0].pName;
});
ok(renamed === 'my headline', `rename by tap works (name is now ${JSON.stringify(renamed)})`);
await tap('#sheetClose');

// ---------- export: content, not just dimensions ----------
// The one pixel test was two opaque rects at 1x. Nothing checked that text ever
// produces ink, that a hidden layer is excluded, that opacity is honoured, or
// that the shipped default (2x) has correct *content* rather than correct size.
const exportPixels = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  m.ed.canvas.getObjects().slice().forEach(o => { if (o.pKind !== 'bg') m.ed.canvas.remove(o); });
  m.resizeDoc(600, 600);
  m.setBg('#ffffff');
  const t = m.addText(); t.exitEditing();
  t.set({ text: 'BLOCK', left: 40, top: 200, width: 520, fontSize: 120, fill: '#000000' });
  t.initDimensions(); t.setCoords();
  const half = m.addShape('rect');
  half.set({ left: 40, top: 430, width: 200, height: 120, fill: '#000000', opacity: 0.5 });
  m.ed.canvas.discardActiveObject();
  m.ed.canvas.requestRenderAll();

  const sample = async (scale, box) => {
    const blob = await m.renderPNGBlob(scale);
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const g = c.getContext('2d');
    if (!box) return { g, w: bmp.width, h: bmp.height };
    const d = g.getImageData(box.x * scale, box.y * scale, box.w * scale, box.h * scale).data;
    let dark = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { n++; if (d[i] < 90 && d[i+1] < 90 && d[i+2] < 90) dark++; }
    return { darkPct: Math.round(dark / n * 100), w: bmp.width, h: bmp.height };
  };

  const tb = t.getBoundingRect();
  const textBox = { x: Math.round(tb.left), y: Math.round(tb.top), w: Math.round(tb.width), h: Math.round(tb.height) };
  const withText = await sample(1, textBox);

  // opacity: 50% black over white must land mid-grey
  const one = await sample(1, null);
  const mid = one.g.getImageData(120, 470, 1, 1).data;

  // 2x and 3x must place the same content, not merely be the right size
  const two = await sample(2, textBox);
  const three = await sample(3, textBox);

  // hide the text and the same region must come back blank
  t.set('visible', false);
  m.ed.canvas.requestRenderAll();
  const hidden = await sample(1, textBox);
  t.set('visible', true);
  m.ed.canvas.requestRenderAll();

  return { withText: withText.darkPct, hidden: hidden.darkPct,
           mid: [mid[0], mid[1], mid[2]],
           two: { pct: two.darkPct, w: two.w }, three: { pct: three.darkPct, w: three.w } };
});
ok(exportPixels.withText > 5,
   `text actually produces ink in the png (${exportPixels.withText}% dark inside its box)`);
ok(exportPixels.hidden === 0,
   `a hidden layer is excluded from the export (${exportPixels.hidden}% dark where it was)`);
ok(Math.abs(exportPixels.mid[0] - 128) < 8,
   `opacity is honoured in the export (50% black over white read ${exportPixels.mid})`);
ok(exportPixels.two.w === 1200 && exportPixels.two.pct > 5,
   `2x export has the right content, not just the right size (${exportPixels.two.pct}% ink at ${exportPixels.two.w}px)`);
ok(exportPixels.three.w === 1800 && exportPixels.three.pct > 5,
   `3x export likewise (${exportPixels.three.pct}% ink at ${exportPixels.three.w}px)`);

// ---------- export scale capping ----------
const capping = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  m.resizeDoc(1650, 2550);
  const maxAt = m.maxExportScale();
  m.resizeDoc(9999, 9999);
  return { maxAt, clampedW: m.ed.docW, clampedMax: m.maxExportScale() };
});
ok(capping.maxAt === 2, `a tabloid poster caps at 2x (got ${capping.maxAt}x) — 3x would be 4950x7650`);
ok(capping.clampedW === 6000 && capping.clampedMax === 1,
   `an oversized canvas clamps to 6000px and 1x (got ${capping.clampedW}px, ${capping.clampedMax}x)`);

// ---------- regressions for the independently-reported bugs ----------

// a 44px touch target on a layer only 34px tall on screen meant its own corner
// handles blanketed it, so a drag meant to move it scaled it into a sliver
const handles = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const t = m.ed.canvas.getObjects().find(o => o.pKind === 'text');
  m.ed.canvas.setActiveObject(t);
  m.ed.canvas.requestRenderAll();
  const z = m.ed.canvas.getZoom();
  const r = t.getBoundingRect();
  return { screenH: r.height * z, screenW: r.width * z, touch: t.touchCornerSize, corner: t.cornerSize };
});
ok(handles.touch <= Math.min(handles.screenH, handles.screenW) / 2.5,
   `handles stay proportional to the layer on screen (${handles.touch}px hit area on a ` +
   `${Math.round(handles.screenH)}px-tall layer) — a fixed 44px used to cover it entirely`);

// changing the canvas used to leave every layer at its old coordinates, so most
// of the flyer ended up outside the frame and the export came back mostly blank
const reflow = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  m.resizeDoc(1650, 2550);
  const inside = () => m.ed.canvas.getObjects().filter(o => o.pKind !== 'bg').map(o => {
    const r = o.getBoundingRect();
    const ox = Math.max(0, Math.min(r.left + r.width, m.ed.docW) - Math.max(r.left, 0));
    const oy = Math.max(0, Math.min(r.top + r.height, m.ed.docH) - Math.max(r.top, 0));
    return Math.round((ox * oy) / (r.width * r.height) * 100);
  });
  const big = inside();
  m.resizeDoc(1080, 1080);
  return { big, small: inside() };
});
const worst = Math.min(...reflow.big, ...reflow.small);
ok(worst >= 90,
   `layers stay inside the frame across canvas changes (worst ${worst}% inside; ` +
   'poster->square used to leave the photo 21% inside and the export 2/3 blank)');

// undoing mid-erase used to walk past the photo's import; the finishing pass then
// snapshotted an empty canvas and autosave made the blank flyer permanent
const busyGuard = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const n = m.ed.canvas.getObjects().length;
  m.ed.busy = true;
  await m.undo();
  const during = m.ed.canvas.getObjects().length;
  m.ed.busy = false;
  return { n, during };
});
ok(busyGuard.during === busyGuard.n,
   'undo refuses to run while an erase owns the document');

// an undo replaces every object, so anything still holding the old one must let go
const detach = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const u = await import('./js/ui.js');
  const t = m.ed.canvas.getObjects().find(o => o.pKind === 'text');
  m.ed.canvas.setActiveObject(t);
  u.renderBar();
  return new Promise(res => {
    document.querySelector('#actionbar [data-a="size"]').click();
    setTimeout(async () => {
      const inlineBefore = document.querySelector('#actionbar').classList.contains('inline-mode');
      await m.undo();
      setTimeout(() => res({
        inlineBefore,
        inlineAfter: document.querySelector('#actionbar').classList.contains('inline-mode'),
        sheetOpen: document.querySelector('#sheet').classList.contains('on'),
      }), 400);
    }, 350);
  });
});
ok(detach.inlineBefore && !detach.inlineAfter && !detach.sheetOpen,
   'an undo dismisses controls bound to the old objects (the ghost slider that ' +
   'read 300px while the layer was 90px)');

// ---------- destructive: rewrites the document, so it runs last ----------
// ---------- the exported pixels are actually the flyer ----------
// dimensions alone are not enough: fabric's export inherits the canvas zoom, so
// a wrong crop still yields a right-sized png with the art shrunk in a corner
const pix = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  // known layout: red left half, blue right half, on a 600x600 doc
  m.ed.canvas.getObjects().slice().forEach(o => { if (o.pKind !== 'bg') m.ed.canvas.remove(o); });
  m.resizeDoc(600, 600);
  m.setBg('#ffffff');
  const L = m.addShape('rect'); L.set({ left:0, top:0, width:300, height:600, fill:'#ff0000' });
  const R = m.addShape('rect'); R.set({ left:300, top:0, width:300, height:600, fill:'#0000ff' });
  m.ed.canvas.discardActiveObject(); m.ed.canvas.requestRenderAll();
  // zoom the view somewhere odd — the export must not care
  m.ed.canvas.setViewportTransform([0.21,0,0,0.21,37,64]);
  const blob = await m.renderPNGBlob(1);
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  const g = c.getContext('2d');
  const at = (x,y) => { const d = g.getImageData(x,y,1,1).data; return [d[0],d[1],d[2]]; };
  return { w: bmp.width, h: bmp.height,
           topLeft: at(20,20), topRight: at(bmp.width-20,20),
           botLeft: at(20,bmp.height-20), botRight: at(bmp.width-20,bmp.height-20),
           centre: at(bmp.width>>1, bmp.height>>1) };
});
ok(pix.w === 600 && pix.h === 600, `export size: ${pix.w}x${pix.h}`);
const isRed  = c => c[0] > 200 && c[1] < 60 && c[2] < 60;
const isBlue = c => c[2] > 200 && c[0] < 60 && c[1] < 60;
ok(isRed(pix.topLeft) && isRed(pix.botLeft),
   `FIX: left edge of the png is the red half, corner-to-corner (${pix.topLeft}, ${pix.botLeft})`);
ok(isBlue(pix.topRight) && isBlue(pix.botRight),
   `FIX: right edge of the png is the blue half (${pix.topRight}, ${pix.botRight})`);
ok(!(pix.topRight[0]>240 && pix.topRight[1]>240 && pix.topRight[2]>240),
   'FIX: no blank white margin — the artwork fills the exported frame');

// exporting must not disturb the selection, and must not bake in handles
const selSafe = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const shape = m.ed.canvas.getObjects().find(o => o.pKind === 'rect');
  m.ed.canvas.setActiveObject(shape); m.ed.canvas.requestRenderAll();
  const blob = await m.renderPNGBlob(1);
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  const d = c.getContext('2d').getImageData(2, 300, 1, 1).data;
  return { stillSelected: m.ed.canvas.getActiveObject() === shape, edge: [d[0],d[1],d[2]] };
});
ok(selSafe.stillSelected, 'FIX: exporting (and autosave) no longer drops your selection');
ok(isRed(selSafe.edge), `no selection handles baked into the png (edge ${selSafe.edge})`);

// the same crop bug hit autosave thumbnails
const thumbOk = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  await m.flushSave();
  const s = await import('./js/store.js');
  const metas = await s.listProjects();
  const meta = metas.find(x => x.id === m.ed.id);
  if (!meta || !meta.thumb) return { ok:false, why:'no thumb' };
  const img = new Image();
  await new Promise(r => { img.onload = r; img.onerror = r; img.src = meta.thumb; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img,0,0);
  const d = c.getContext('2d').getImageData(c.width-6, c.height>>1, 1, 1).data;
  return { ok:true, w:img.width, right:[d[0],d[1],d[2]] };
});
ok(thumbOk.ok && thumbOk.right[2] > 150 && thumbOk.right[0] < 90,
   `FIX: home-screen thumbnail shows the whole flyer too (right edge ${thumbOk.right})`);


const real = errs.filter(e => !/googleapis|gstatic|Failed to load resource|manifest/i.test(e));
ok(real.length === 0, 'no page errors' + (real.length ? ':\n  '+real.slice(0,6).join('\n  ') : ''));

await browser.close();
server.close();
process.exit(R.finish() ? 1 : 0);
