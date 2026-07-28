// google fonts: curated manifest + load-any-by-name. no api key, no build step.
import { getSettings, patchSettings } from './store.js';

let manifest = { families: [] };
const extras = [];            // families pulled in by name this session
const loaded = new Map();     // family -> promise
let specimensDone = false;

export async function initFonts() {
  try {
    manifest = await (await fetch('./fonts.json')).json();
  } catch {
    manifest = { families: [] };
  }
  try {
    const s = await getSettings();
    (s.extraFonts || []).forEach(f => {
      if (!extras.find(x => x.family === f)) {
        extras.push({ family: f, category: 'loaded', weights: [400], italics: false });
      }
    });
  } catch {}
}

export const allFamilies = () => [...manifest.families, ...extras];

export function fontMeta(family) {
  return allFamilies().find(f => f.family === family)
    || { family, category: 'loaded', weights: [400], italics: false };
}

export async function recentFonts() {
  const s = await getSettings();
  return s.recentFonts || [];
}

export async function pushRecentFont(family) {
  const cur = await recentFonts();
  await patchSettings({ recentFonts: [family, ...cur.filter(f => f !== family)].slice(0, 8) });
}

function css2Url(fam) {
  const name = encodeURIComponent(fam.family).replace(/%20/g, '+');
  const w = fam.weights && fam.weights.length ? fam.weights : [400];
  let axis = '';
  if (fam.italics) {
    axis = `:ital,wght@${w.map(x => '0,' + x).join(';')};${w.map(x => '1,' + x).join(';')}`;
  } else if (!(w.length === 1 && w[0] === 400)) {
    axis = `:wght@${w.join(';')}`;
  }
  return `https://fonts.googleapis.com/css2?family=${name}${axis}&display=swap`;
}

function injectLink(href) {
  if (document.querySelector(`link[data-font="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  l.dataset.font = href;
  document.head.appendChild(l);
}

// resolves once the family is actually usable for rendering
export function loadFont(family) {
  if (family === 'DM Mono') return Promise.resolve(family);
  if (loaded.has(family)) return loaded.get(family);
  const fam = fontMeta(family);
  const p = (async () => {
    injectLink(css2Url(fam));
    const probe = `${(fam.weights || [400])[0]} 1rem "${family}"`;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        // resolves with the faces that actually loaded — [] means not available yet
        const faces = await document.fonts.load(probe);
        if (faces.length || document.fonts.check(probe)) return family;
      } catch {}
      await new Promise(r => setTimeout(r, 120));
    }
    throw new Error('unavailable');
  })();
  loaded.set(family, p);
  p.catch(() => loaded.delete(family));
  return p;
}

// specimen css so each row in the browser renders in its own face
export function loadSpecimens() {
  if (specimensDone) return;
  specimensDone = true;
  const fams = manifest.families;
  const chars = [...new Set(fams.map(f => f.family).join('') + 'Aa')].join('');
  for (let i = 0; i < fams.length; i += 8) {
    const q = fams.slice(i, i + 8)
      .map(f => 'family=' + encodeURIComponent(f.family).replace(/%20/g, '+')).join('&');
    injectLink(`https://fonts.googleapis.com/css2?${q}&text=${encodeURIComponent(chars)}&display=swap`);
  }
}

// pull an arbitrary family straight off google fonts by name
export async function loadByName(input) {
  const family = input.trim().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (!family) throw new Error('empty');
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
  const res = await fetch(href).catch(() => null);
  if (!res || !res.ok) throw new Error('not found');
  const css = await res.text();
  if (!css.includes('@font-face')) throw new Error('not found');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  try { await document.fonts.load(`1rem "${family}"`); } catch {}
  if (!document.fonts.check(`1rem "${family}"`)) throw new Error('not found');
  if (!extras.find(f => f.family === family) && !manifest.families.find(f => f.family === family)) {
    extras.push({ family, category: 'loaded', weights: [400], italics: false });
    const s = await getSettings();
    await patchSettings({ extraFonts: [...new Set([...(s.extraFonts || []), family])].slice(0, 40) });
  }
  loaded.set(family, Promise.resolve(family));
  return family;
}

// make sure a reopened document's fonts are ready; returns the ones that failed
export async function ensureDocFonts(fonts) {
  const fams = [...new Set((fonts || []).map(f => (typeof f === 'string' ? f : f.family)))]
    .filter(f => f && f !== 'DM Mono');
  const res = await Promise.allSettled(fams.map(f => loadFont(f)));
  return fams.filter((f, i) => res[i].status === 'rejected');
}
