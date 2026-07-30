// Loading a font by name, including the failure path.
//
// Its own suite because it needs a browser context where Google Fonts *fails*.
// The main harness answers any family with a valid face, which made every
// failure toast in the app unreachable — so "load any google font" was only ever
// asserted to be visible, and discarding the typed name passed the whole suite.
//
// Run: node tests/fonts.test.mjs
import { serveRepo, shimCDN, launchBrowser, PHONE, reporter, pollUntil } from './lib/harness.mjs';

const R = reporter('fonts suite');
const ok = (c, n) => R.ok(c, n);

const { server, origin } = await serveRepo();
const browser = await launchBrowser();

async function editorWith(opts) {
  const ctx = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
  await shimCDN(ctx, opts);
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', r => { if (r.url().includes('fonts.googleapis.com')) requests.push(r.url()); });
  await page.goto(origin + '/');
  await page.waitForTimeout(900);
  await page.locator('#btnNew').first().tap();
  await page.waitForTimeout(250);
  await page.locator('[data-p="ig-post"]').first().tap();
  await page.waitForTimeout(600);
  await page.locator('#actionbar [data-a="add-text"]').first().tap();
  await page.waitForTimeout(400);
  await page.keyboard.type('HELLO');
  await page.evaluate(async () => (await import('./js/editor.js')).ed.canvas.getActiveObject().exitEditing());
  await page.waitForTimeout(300);
  await page.locator('#actionbar [data-a="font"]').first().tap();
  await page.waitForTimeout(500);
  return { ctx, page, requests };
}

const family = () => page.evaluate(async () =>
  (await import('./js/editor.js')).ed.canvas.getObjects().find(o => o.pKind === 'text').fontFamily);

/* ---------- the happy path: a family not in the manifest ---------- */
let { ctx, page, requests } = await editorWith({});
await page.fill('#sheetBody [data-load]', 'Chivo');   // not in fonts.json
await page.locator('#sheetBody [data-go]').tap();
const applied = await pollUntil(page, async () =>
  (await import('./js/editor.js')).ed.canvas.getObjects()
    .find(o => o.pKind === 'text').fontFamily === 'Chivo', 15000);
ok(applied === true, 'a font typed by name is applied to the layer');
ok(requests.some(u => /css2\?family=Chivo/.test(decodeURIComponent(u))),
   'and the css2 url it built carries the family that was typed — ' +
   'discarding the input used to pass the whole suite');
const persisted = await page.evaluate(async () => {
  const s = await import('./js/store.js');
  return ((await s.getSettings()).extraFonts || []).includes('Chivo');
});
ok(persisted, 'the loaded family is remembered for next time');
await ctx.close();

/* ---------- the failure path: google has no such font ---------- */
({ ctx, page, requests } = await editorWith({ failFonts: true }));
const beforeFail = await family();
await page.fill('#sheetBody [data-load]', 'Notafontatall');
await page.locator('#sheetBody [data-go]').tap();
await page.waitForTimeout(2500);
const toast = await page.locator('#toast').textContent();
ok(/couldn.t find that font/.test(toast), `an unknown family says so ("${toast.trim()}")`);
ok((await family()) === beforeFail,
   `and the layer keeps the font it had (${await family()}) rather than silently changing`);
await ctx.close();

await browser.close();
server.close();
process.exit(R.finish() ? 1 : 0);
