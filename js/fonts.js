// google fonts: curated manifest picker + load-any-by-name. no api key.
import { getSettings, patchSettings } from './store.js';

let manifest = { families: [] };
const extras = [];          // families loaded by name this session
const loaded = new Map();   // family -> Promise
let specimensRequested = false;

export async function initFonts() {
  try {
    manifest = await (await fetch('./fonts.json')).json();
  } catch {
    manifest = { families: [] };
  }
}

export function fontMeta(family) {
  return manifest.families.find(f => f.family === family)
    || extras.find(f => f.family === family)
    || { family, category: 'loaded', weights: [400], italics: false };
}

function css2Url(fam) {
  const f = encodeURIComponent(fam.family).replace(/%20/g, '+');
  const w = fam.weights && fam.weights.length ? fam.weights : [400];
  const axis = fam.italics
    ? `:ital,wght@${w.map(x => '0,' + x).join(';')};${w.map(x => '1,' + x).join(';')}`
    : (w.length === 1 && w[0] === 400 ? '' : `:wght@${w.join(';')}`);
  return `https://fonts.googleapis.com/css2?family=${f}${axis}&display=swap`;
}

function injectLink(href) {
  if (document.querySelector(`link[href="${CSS.escape(href)}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}

// load a family's full axis set; resolves when usable (rejects if it never becomes usable)
export function loadFont(family) {
  if (loaded.has(family)) return loaded.get(family);
  const fam = fontMeta(family);
  const p = (async () => {
    injectLink(css2Url(fam));
    const probes = (fam.weights || [400]).map(w => `${w} 1rem "${family}"`);
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      try { await Promise.all(probes.map(pr => document.fonts.load(pr))); } catch {}
      if (document.fonts.check(probes[0])) return family;
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error('font not available: ' + family);
  })();
  loaded.set(family, p);
  p.catch(() => loaded.delete(family));
  return p;
}

// specimens: subset css requests so the picker list renders each row in its own face.
// chunked so one odd family can't 400 the whole batch.
function loadSpecimens() {
  if (specimensRequested) return;
  specimensRequested = true;
  const fams = manifest.families;
  const chars = [...new Set(fams.map(f => f.family).join(''))].join('');
  for (let i = 0; i < fams.length; i += 8) {
    const chunk = fams.slice(i, i + 8);
    const q = chunk.map(f => 'family=' + encodeURIComponent(f.family).replace(/%20/g, '+')).join('&');
    injectLink(`https://fonts.googleapis.com/css2?${q}&text=${encodeURIComponent(chars)}&display=swap`);
  }
}

// try to load an arbitrary family typed by the user (default style only)
export async function loadByName(name) {
  const family = name.trim().replace(/\s+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  if (!family) throw new Error('empty');
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
  const res = await fetch(href).catch(() => null);
  if (!res || !res.ok) throw new Error('not found');
  const css = await res.text();
  if (!css.includes('@font-face')) throw new Error('not found');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  await document.fonts.load(`1rem "${family}"`);
  if (!document.fonts.check(`1rem "${family}"`)) throw new Error('not found');
  if (!fontMeta(family) || !manifest.families.find(f => f.family === family)) {
    if (!extras.find(f => f.family === family)) {
      extras.push({ family, category: 'loaded', weights: [400], italics: false });
    }
  }
  loaded.set(family, Promise.resolve(family));
  return family;
}

// make sure every font a document uses is loaded before render; returns families that failed
export async function ensureDocFonts(fonts) {
  const fams = [...new Set((fonts || []).map(f => typeof f === 'string' ? f : f.family))];
  const results = await Promise.allSettled(fams.map(f => loadFont(f)));
  return fams.filter((f, i) => results[i].status === 'rejected');
}

/* ---------- picker ui ---------- */

const CATS = ['all', 'display', 'serif', 'sans', 'mono', 'script'];

// opens the font picker popover. onPick(family) fires when a family is chosen.
export async function openFontPicker(pop, current, onPick) {
  loadSpecimens();
  const settings = await getSettings();
  const recents = settings.recentFonts || [];
  let cat = 'all', query = '';

  pop.innerHTML = `
    <div class="pop-head">font<button class="icon-btn" data-x><svg width="13" height="13" viewBox="0 0 14 14"><path d="M3 3 L11 11 M11 3 L3 11"/></svg></button></div>
    <input class="fp-search" placeholder="search google fonts…">
    <div class="fp-chips">${CATS.map(c => `<button class="chip2${c === 'all' ? ' on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
    <div class="fp-list"></div>
    <div class="fp-load"><input placeholder="load any google font by name…"><button data-go>load</button></div>`;

  const list = pop.querySelector('.fp-list');

  const render = () => {
    const all = [...manifest.families, ...extras];
    const match = f =>
      (cat === 'all' || f.category === cat) &&
      (!query || f.family.toLowerCase().includes(query));
    const rows = [];
    const rec = recents.map(r => all.find(f => f.family === r)).filter(f => f && match(f));
    if (rec.length && !query && cat === 'all') {
      rows.push(`<div class="fp-sect">recent</div>`);
      rows.push(...rec.map(f => rowHtml(f)));
      rows.push(`<div class="fp-sect">all fonts</div>`);
    }
    rows.push(...all.filter(match).map(f => rowHtml(f)));
    list.innerHTML = rows.join('') || `<div class="fp-sect">nothing matches</div>`;
  };
  const rowHtml = f =>
    `<button class="frow" data-fam="${f.family}" style="font-family:'${f.family}',var(--mono)">${f.family}${f.family === current ? '<span class="fchk">✓</span>' : ''}</button>`;
  render();

  const search = pop.querySelector('.fp-search');
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
  pop.querySelector('.fp-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat;
    pop.querySelectorAll('.chip2').forEach(c => c.classList.toggle('on', c === b));
    render();
  });
  list.addEventListener('click', async e => {
    const b = e.target.closest('[data-fam]');
    if (!b) return;
    const family = b.dataset.fam;
    const next = [family, ...recents.filter(r => r !== family)].slice(0, 6);
    patchSettings({ recentFonts: next });
    onPick(family);
  });
  const loadInput = pop.querySelector('.fp-load input');
  const doLoad = async () => {
    const name = loadInput.value;
    if (!name.trim()) return;
    loadInput.disabled = true;
    try {
      const family = await loadByName(name);
      onPick(family);
    } catch {
      const { showToast } = await import('./panels.js');
      showToast("couldn't find that font on google fonts");
    }
    loadInput.disabled = false;
  };
  pop.querySelector('[data-go]').addEventListener('click', doLoad);
  loadInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLoad(); });
}
