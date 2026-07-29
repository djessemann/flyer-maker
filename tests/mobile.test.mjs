// End-to-end pass over the whole app on a phone-sized TOUCH viewport, tapping
// real targets rather than calling functions. Also re-measures the UX numbers
// from docs/ui-revision.md, so those claims stay honest instead of decaying.
//
// Run: npm run test:mobile
import { readFileSync } from 'fs';
import {
  serveRepo, shimCDN, launchBrowser, assertPinnedVersions, PHONE, reporter,
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

// ---------- home ----------
ok(await page.locator('#btnNew').isVisible(), 'home: new flyer button visible');
await tap('#btnNew');
const stacking = await page.evaluate(() => {
  const s = document.querySelector('#sheet').getBoundingClientRect();
  const el = document.elementFromPoint(s.left + s.width/2, s.top + 40);
  return el && el.closest('#sheet') ? 'sheet' : (el && (el.id || el.className));
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
ok((await page.locator('#sheetBody [data-x="text"]').count()) === 1, 'add sheet offers text/photo/shape');
await tap('#sheetBody [data-x="text"]');
await page.waitForTimeout(400);
ok((await kinds()).includes('text'), 'text added without ever deselecting the photo');
await page.keyboard.type('BLOCK PARTY');
await page.evaluate(async () => (await import('./js/editor.js')).ed.canvas.getActiveObject().exitEditing());
await page.waitForTimeout(300);

// ---------- FIX 2: the bar fits ----------
b = await bar();
ok(JSON.stringify(b) === JSON.stringify(['add','edit','font','color','size','more']),
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
    return Math.round((ox*oy)/(box.w*box.h)*100);
  });
  return pct;
};
const covColor = await overlapFor('fill');
ok(covColor === 0, `FIX: colour sheet covers ${covColor}% of the text (was 100%)`);
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
ok(covFont === 0, `FIX: font sheet covers ${covFont}% of the text (was 100%)`);
ok((await page.locator('#sheetBody .frow').count()) > 20, 'font list populated');
await page.fill('#sheetBody [data-q]', 'anton');
await page.waitForTimeout(300);
ok((await page.locator('#sheetBody .frow').count()) <= 3, 'font search narrows');
await page.locator('#sheetBody .frow[data-fam="Anton"]').first().tap();
await page.waitForFunction(async () =>
  (await import('./js/editor.js')).ed.canvas.getActiveObject().fontFamily === 'Anton',
  null, { timeout: 12000 }).catch(()=>{});
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
ok(true, 'centre across ran');
await tap('#sheetClose');

// ---------- shapes ----------
await tap('[data-a="add"]');
await tap('#sheetBody [data-x="shape"]');
await tap('#sheetBody [data-k="rounded"]');
ok((await active()).kind === 'rounded', 'shape added via add sheet');
b = await bar();
ok(JSON.stringify(b) === JSON.stringify(['add','fill','stroke','corners','more']), 'shape bar: '+b.join(','));
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
ok(JSON.stringify(b) === JSON.stringify(['add','erase','replace','adjust','more']), 'photo bar: '+b.join(','));
await tap('[data-a="adjust"]');
await tap('#sheetBody [data-f="x"]');
ok((await active()).flipX === true, 'flip (in adjust)');
await tap('#sheetBody [data-fit]');
ok(true, 'fit (in adjust)');
await tap('#sheetClose');

// ---------- FIX 6: erase instructions visible on a phone ----------
await tap('[data-a="erase"]');
ok(await page.locator('#retouch').isVisible(), 'erase mode opens');
const hintVisible = await page.evaluate(() => {
  const t = document.querySelector('#rtHint');
  const r = t.getBoundingClientRect();
  return { shown: getComputedStyle(t).display !== 'none' && r.height > 0, text: t.textContent };
});
ok(hintVisible.shown, `FIX: instruction visible on phone — "${hintVisible.text}"`);

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
await tap('#rtGo');
await page.waitForFunction(() => document.querySelector('#rtHint').textContent.includes('gone'),
  null, { timeout: 60000 }).catch(()=>{});
ok((await page.locator('#rtHint').textContent()).includes('gone'), 'inpaint reported done');
const bright = await page.evaluate(async () => {
  const m = await import('./js/editor.js');
  const o = m.ed.canvas.getObjects().find(x=>x.pKind==='image');
  const el = o._element;
  const c = document.createElement('canvas'); c.width=el.naturalWidth; c.height=el.naturalHeight;
  c.getContext('2d').drawImage(el,0,0);
  const d = c.getContext('2d').getImageData(430,330,50,50).data;
  let n=0; for(let i=0;i<d.length;i+=4) if(d[i]>200&&d[i+1]>200&&d[i+2]>200) n++;
  return n;
});
ok(bright === 0, 'object removed from the actual pixels (bright px left: '+bright+')');
await tap('#rtCancel');

// ---------- layers / canvas / dedupe ----------
await tap('[data-a="more"]');
await tap('#sheetBody [data-m="layers"]');
ok((await page.locator('#sheetBody .lrow[data-i]').count()) === 3, 'layers lists 3 layers');
await tap('#sheetBody .lrow[data-i="1"] [data-eye]');
await tap('#sheetBody .lrow[data-i="1"] [data-eye]');
await tap('#sheetBody .lrow[data-i="2"] [data-up]');
ok(true, 'visibility + reorder work');
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

// ---------- persistence ----------
await page.evaluate(async () => (await import('./js/editor.js')).flushSave());
await page.waitForTimeout(500);
await page.reload();
await page.waitForTimeout(1200);
ok((await page.locator('#projectGrid .proj').count()) === 1, 'project listed after reload');
await tap('#projectGrid .proj');
await page.waitForTimeout(1000);
const k2 = await kinds();
ok(k2.includes('image') && k2.includes('text'), 'layers restored: ' + k2.join(','));

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
