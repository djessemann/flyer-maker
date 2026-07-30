// the interface: a contextual bar under the canvas, inline sliders for simple
// values, and short sheets that never hide the thing you're changing.
import { on, emit } from './bus.js';
import {
  ed, fabric, PRESETS, layerName, markDirty,
  addText, addShape, addImageFromFile, replaceImage, resetImageSize,
  duplicateObject, deleteObject, reorder, setLocked, setVisible, nudge,
  resizeDoc, setBg, collectDocColors, maxExportScale, tuneAllHandles,
  renderPNGBlob, exportFilename, projectBlob, projectFilename, saveFile,
} from './editor.js';
import {
  allFamilies, fontMeta, loadFont, loadByName, loadSpecimens,
  recentFonts, pushRecentFont,
} from './fonts.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let sheetEl, overlayEl, bodyEl, titleEl, backEl;
let stack = [];          // sheet history, for the back chevron
let sampling = null;     // pending eyedropper callback
let inlineOpen = false;  // an inline slider has taken over the bar
let savedVpt = null;     // viewport to restore after a sheet pans the canvas
let sheetOwner = null;   // the layer the open sheet belongs to, if any

/* ================= icons ================= */

const I = {
  plus: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 3.5 V16.5 M3.5 10 H16.5"/></svg>',
  text: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M3 5.5 V3.5 H17 V5.5 M10 3.5 V16.5 M7 16.5 H13"/></svg>',
  edit: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M11 3.5 H3.5 V16.5 H16.5 V9"/><path d="M8 12 L16.5 3.5 L18 5 L9.5 13.5 Z"/></svg>',
  photo: '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="4" width="15" height="12"/><circle cx="7" cy="8" r="1.5"/><path d="M4 14.5 L9 9.5 L12 12.5 L14 10.5 L16.5 13"/></svg>',
  shape: '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="2.5" width="10" height="10"/><circle cx="13" cy="13" r="4.5"/></svg>',
  layers: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 2.5 L18 7 L10 11.5 L2 7 Z"/><path d="M2 11 L10 15.5 L18 11"/></svg>',
  canvas: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M2.5 5.5 H17.5 M2.5 10 H17.5 M2.5 14.5 H17.5"/><circle cx="7" cy="5.5" r="1.8" fill="var(--paper)"/><circle cx="13" cy="10" r="1.8" fill="var(--paper)"/><circle cx="8.5" cy="14.5" r="1.8" fill="var(--paper)"/></svg>',
  font: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M2 16 L6.5 4 L11 16 M3.4 12.4 H9.6"/><path d="M17.5 9.6 a3 3 0 0 0-5.6 1.2 M17.5 8.5 V16 M17.5 12.6 a2.6 2.6 0 1 1-5.2 .4 a2.6 2.6 0 0 1 5.2-.4Z"/></svg>',
  size: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M1.5 15.5 L5.5 6 L9.5 15.5 M2.7 12.9 H8.3"/><path d="M12 15.5 L15 8.5 L18 15.5 M12.9 13.6 H17.1"/></svg>',
  crop: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M5.5 1.5 V14.5 H18.5"/><path d="M1.5 5.5 H14.5 V18.5"/></svg>',
  move: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 2.5 V17.5 M2.5 10 H17.5"/><path d="M10 2.5 L7.5 5 M10 2.5 L12.5 5 M10 17.5 L7.5 15 M10 17.5 L12.5 15 M2.5 10 L5 7.5 M2.5 10 L5 12.5 M17.5 10 L15 7.5 M17.5 10 L15 12.5"/></svg>',
  replace: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M3 7.5 H14 M11 4.5 L14 7.5 L11 10.5"/><path d="M17 12.5 H6 M9 9.5 L6 12.5 L9 15.5"/></svg>',
  adjust: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 2.5 V17.5"/><path d="M7.5 6 L2.5 10 L7.5 14 Z"/><path d="M12.5 6 L17.5 10 L12.5 14 Z"/></svg>',
  stroke: '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="3" y="3" width="14" height="14" stroke-width="3"/></svg>',
  radius: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M3 17 V8 a5 5 0 0 1 5-5 H17"/></svg>',
  more: '<svg viewBox="0 0 20 20" width="20" height="20"><circle cx="4" cy="10" r="1.4" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1.4" fill="currentColor" stroke="none"/></svg>',
  dup: '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="6.5" y="6.5" width="11" height="11"/><path d="M13.5 2.5 H2.5 V13.5"/></svg>',
  fwd: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 16.5 V3.5 M5 8.5 L10 3.5 L15 8.5"/></svg>',
  back: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 3.5 V16.5 M5 11.5 L10 16.5 L15 11.5"/></svg>',
  lock: '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="4.5" y="8.5" width="11" height="8"/><path d="M6.5 8.5 V6 a3.5 3.5 0 0 1 7 0 V8.5"/></svg>',
  unlock: '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="4.5" y="8.5" width="11" height="8"/><path d="M6.5 8.5 V6 a3.5 3.5 0 0 1 6.8-1.2"/></svg>',
  eye: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M1.5 10 C4 6 6.8 4.2 10 4.2 s6 1.8 8.5 5.8 c-2.5 4-5.3 5.8-8.5 5.8 s-6-1.8-8.5-5.8 Z"/><circle cx="10" cy="10" r="2.2"/></svg>',
  eyeOff: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M1.5 10 C4 6 6.8 4.2 10 4.2 s6 1.8 8.5 5.8 c-2.5 4-5.3 5.8-8.5 5.8 s-6-1.8-8.5-5.8 Z"/><path d="M3 17 L17 3"/></svg>',
  del: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M3.5 5.5 H16.5 M8 5.5 V3.5 H12 V5.5 M5.5 5.5 L6.4 17 H13.6 L14.5 5.5"/></svg>',
  fit: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M3 7 V3.5 H6.5 M13.5 3.5 H17 V7 M17 13 V16.5 H13.5 M6.5 16.5 H3 V13"/></svg>',
};

/* ================= toast ================= */

let toastTimer = null;
export function showToast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

/* ================= keeping the artwork visible ================= */

// slide the canvas so the selected object sits in the strip left above a sheet
function panSelectionIntoView() {
  const o = ed.canvas.getActiveObject();
  if (!o || !sheetEl.classList.contains('on')) return;
  // derive the sheet's resting top from its height and css offset — its live
  // rect is still mid-transition when this runs
  const bottomPx = parseFloat(getComputedStyle(sheetEl).bottom) || 0;
  const sheetTop = innerHeight - bottomPx - sheetEl.offsetHeight;
  const cRect = ed.canvas.lowerCanvasEl.getBoundingClientRect();
  const stripH = Math.min(cRect.height, sheetTop - cRect.top);
  if (stripH < 60) return;

  const vt = ed.canvas.viewportTransform;
  const r = o.getBoundingRect();
  const objTop = r.top * vt[3] + vt[5];
  const objH = r.height * vt[3];
  const target = objH >= stripH - 24 ? 12 : (stripH - objH) / 2;
  const dy = target - objTop;
  if (Math.abs(dy) < 4) return;
  vt[5] += dy;
  ed.canvas.setViewportTransform(vt);
  ed.canvas.requestRenderAll();
}

/* ================= sheet plumbing ================= */

function openSheet(title, html, wire, opts = {}) {
  const fresh = !sheetEl.classList.contains('on');
  if (fresh) savedVpt = [...ed.canvas.viewportTransform];
  if (opts.push === false) stack = [];
  else if (stack.length) stack[stack.length - 1].scroll = bodyEl.scrollTop;

  stack.push({ title, html, wire, scroll: 0, tall: !!opts.tall });
  paintSheet();
}

function paintSheet() {
  const cur = stack[stack.length - 1];
  if (!cur) return;
  titleEl.textContent = cur.title;
  bodyEl.innerHTML = cur.html;
  backEl.classList.toggle('hidden', stack.length < 2);
  sheetEl.classList.toggle('tall', cur.tall);
  sheetEl.classList.add('on');
  overlayEl.classList.add('on');
  if (cur.wire) cur.wire(bodyEl);
  bodyEl.scrollTop = cur.scroll || 0;
  requestAnimationFrame(panSelectionIntoView);
}

export function closeSheet() {
  hideSheet();
  if (savedVpt) {
    ed.canvas.setViewportTransform(savedVpt);
    ed.canvas.requestRenderAll();
    savedVpt = null;
  }
}

// dismiss the sheet without giving back the canvas position (used when an
// inline control takes over — the pan is still wanted)
function hideSheet() {
  sheetEl.classList.remove('on', 'tall');
  overlayEl.classList.remove('on');
  stack = [];
  sheetOwner = null;
}

function sheetBack() {
  if (stack.length < 2) return closeSheet();
  stack.pop();
  paintSheet();
}

// rebuild the current sheet in place after a value changes
function refreshSheet() {
  if (!sheetEl.classList.contains('on') || !stack.length) return;
  const cur = stack[stack.length - 1];
  if (!cur.rebuild) return;
  const next = cur.rebuild();
  cur.html = next.html;
  cur.wire = next.wire;
  const y = bodyEl.scrollTop;
  bodyEl.innerHTML = cur.html;
  if (cur.wire) cur.wire(bodyEl);
  bodyEl.scrollTop = y;
}

/* ================= inline slider (no sheet, nothing hidden) ================= */

function inlineSlider({ label, min, max, step = 1, get, format, apply }) {
  const bar = $('#actionbar');
  inlineOpen = true;
  bar.classList.add('inline-mode');
  bar.innerHTML = `
    <div class="inline">
      <span class="inline-l">${label}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${get()}" data-in>
      <span class="inline-v" data-v>${format(get())}</span>
      <button class="inline-done" data-done>done</button>
    </div>`;
  const s = bar.querySelector('[data-in]');
  const v = bar.querySelector('[data-v]');
  s.addEventListener('input', () => {
    apply(+s.value);
    v.textContent = format(+s.value);
    ed.canvas.requestRenderAll();
    markDirty(true);
  });
  bar.querySelector('[data-done]').addEventListener('click', () => {
    inlineOpen = false;
    bar.classList.remove('inline-mode');
    renderBar();
  });
}

/* ================= init ================= */

export function initUI() {
  sheetEl = $('#sheet'); overlayEl = $('#overlay');
  bodyEl = $('#sheetBody'); titleEl = $('#sheetTitle'); backEl = $('#sheetBack');

  $('#sheetClose').addEventListener('click', closeSheet);
  sheetEl.querySelector('.sheet-grab').addEventListener('click', closeSheet);
  backEl.addEventListener('click', sheetBack);
  overlayEl.addEventListener('click', closeSheet);

  on('selection', () => { if (!inlineOpen) renderBar(); });
  on('layers', () => { if (!inlineOpen) renderBar(); refreshSheet(); });
  on('doc:open', () => { closeSheet(); renderBar(); });
  on('toast', showToast);

  // undo/redo rebuilds every object, so any sheet or inline slider still on
  // screen is wired to a detached one: it reported values that no longer
  // existed and its edits went nowhere. Let go of all of it.
  on('doc:restored', () => {
    inlineOpen = false;
    savedVpt = null;
    closeSheet();
    renderBar();
  });

  // a resize re-fits the canvas; keeping the pre-sheet viewport would undo that
  on('doc:change', () => { savedVpt = null; refreshSheet(); });

  // a sheet outlives the layer it belongs to unless we close it
  ed.canvas.on('object:removed', e => {
    if (e.target && e.target === sheetOwner) closeSheet();
  });

  ed.canvas.on('mouse:down', onCanvasSample);
  ed.canvas.on('text:editing:entered', renderEditingBar);
  ed.canvas.on('text:editing:exited', () => { inlineOpen = false; renderBar(); });

  renderBar();
}

// eyedropper: read a pixel straight off the rendered canvas
function onCanvasSample(opt) {
  if (!sampling) return;
  const cb = sampling;
  sampling = null;
  const el = ed.canvas.lowerCanvasEl;
  const r = el.getBoundingClientRect();
  const e = opt.e.touches ? (opt.e.touches[0] || opt.e.changedTouches[0]) : opt.e;
  const x = Math.round((e.clientX - r.left) * (el.width / r.width));
  const y = Math.round((e.clientY - r.top) * (el.height / r.height));
  let hex = null;
  try {
    const d = el.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
    hex = '#' + [d[0], d[1], d[2]].map(n => n.toString(16).padStart(2, '0')).join('');
  } catch {}
  cb(hex);
}

/* ================= action bar ================= */

const act = (key, icon, label, cls = '') =>
  `<button class="act ${cls}" data-a="${key}"><span class="act-ico">${icon}</span><span class="act-l">${label}</span></button>`;
const actDot = (key, color, label) =>
  `<button class="act" data-a="${key}"><span class="act-ico"><span class="act-dot" style="background:${color || '#fff'}"></span></span><span class="act-l">${label}</span></button>`;
const sep = '<span class="act-sep"></span>';

export function renderBar() {
  const bar = $('#actionbar');
  if (!bar || !ed.open) return;
  bar.classList.remove('inline-mode');
  const o = ed.canvas.getActiveObject();
  let html;

  if (!o || o.pKind === 'bg') {
    // nothing selected: the three add verbs are right here, one tap each
    html =
      act('add-text', I.text, 'text') +
      act('add-photo', I.photo, 'photo') +
      act('add-shape', I.shape, 'shape') +
      sep +
      act('layers', I.layers, 'layers') +
      act('canvas', I.canvas, 'canvas');
  } else if (o.pKind === 'text') {
    html =
      act('add', I.plus, 'add') +
      act('edit', I.edit, 'edit') +
      act('font', I.font, 'font') +
      actDot('fill', o.fill, 'color') +
      act('size', I.size, 'size') +
      act('move', I.move, 'move') +
      act('more', I.more, 'more');
  } else if (o.pKind === 'image') {
    html =
      act('add', I.plus, 'add') +
      act('crop', I.crop, 'crop') +
      act('adjust', I.adjust, 'adjust') +
      act('replace', I.replace, 'replace') +
      act('move', I.move, 'move') +
      act('more', I.more, 'more');
  } else {
    const isLine = o.pKind === 'line';
    const isRect = o.pKind === 'rect' || o.pKind === 'rounded';
    html =
      act('add', I.plus, 'add') +
      (isLine ? '' : actDot('fill', o.fill, 'fill')) +
      actDot('stroke', o.stroke || '#ffffff', isLine ? 'color' : 'stroke') +
      (isRect ? act('corners', I.radius, 'corners') : '') +
      act('move', I.move, 'move') +
      act('more', I.more, 'more');
  }

  bar.innerHTML = html;
  bar.querySelectorAll('[data-a]').forEach(b =>
    b.addEventListener('click', () => runAction(b.dataset.a, o)));
  markScrollable(bar);
}

// while typing, the bar gets out of the way and offers one clear exit
function renderEditingBar() {
  const bar = $('#actionbar');
  inlineOpen = true;
  bar.classList.add('inline-mode');
  bar.innerHTML = `
    <div class="inline">
      <span class="inline-l">editing text</span>
      <span class="spacer"></span>
      <button class="pill" data-done style="padding:11px 26px">done</button>
    </div>`;
  bar.querySelector('[data-done]').addEventListener('click', () => {
    const o = ed.canvas.getActiveObject();
    if (o && o.isEditing) o.exitEditing();
    inlineOpen = false;
    renderBar();
  });
}

function markScrollable(bar) {
  const update = () => {
    const over = bar.scrollWidth > bar.clientWidth + 2;
    bar.classList.toggle('scrollable', over);
    bar.classList.toggle('scrolled-end', over && bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 2);
  };
  requestAnimationFrame(update);
  if (!bar.dataset.wired) {
    bar.dataset.wired = '1';
    bar.addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update);
  }
}

async function runAction(key, o) {
  sheetOwner = o && o.pKind !== 'bg' ? o : null;
  // the bar stays live above an open sheet — tapping another action swaps the
  // sheet rather than stacking, so you can move colour → font → size freely
  const SHEETY = ['add-shape', 'layers', 'canvas', 'font', 'fill', 'stroke', 'adjust', 'more'];
  if (SHEETY.includes(key)) stack.length = 0;
  if (key === 'size' || key === 'corners' || key === 'add' || key === 'move') hideSheet();

  switch (key) {
    case 'add': inlineAdd(); break;
    case 'add-text': addText(); break;
    case 'add-photo': pickImage(f => addImageFromFile(f)); break;
    case 'add-shape': sheetShapes(); break;
    case 'layers': sheetLayers(); break;
    case 'canvas': sheetCanvas(); break;

    case 'edit':
      ed.canvas.setActiveObject(o);
      o.enterEditing();
      o.selectAll();
      ed.canvas.requestRenderAll();
      break;

    case 'font': sheetFont(o); break;
    case 'fill': sheetColor('color', o.fill, c => { o.set('fill', c); afterChange(); }); break;
    case 'stroke': sheetStroke(o); break;

    case 'size':
      inlineSlider({
        label: 'size', min: 8, max: 400,
        get: () => Math.round(o.fontSize),
        format: v => v + 'px',
        apply: v => o.set('fontSize', v),
      });
      break;

    case 'corners':
      inlineSlider({
        label: 'corners', min: 0, max: Math.round(Math.min(o.width, o.height) / 2),
        get: () => Math.round(o.rx || 0),
        format: v => v + 'px',
        apply: v => o.set({ rx: v, ry: v }),
      });
      break;

    case 'move': inlineNudge(o); break;
    case 'crop': emit('crop:open', o); break;
    case 'replace': pickImage(f => replaceImage(o, f)); break;
    case 'adjust': sheetAdjust(o); break;
    case 'more': sheetMore(o); break;
  }
}

function afterChange() {
  ed.canvas.requestRenderAll();
  markDirty(true);
  if (!inlineOpen) renderBar();
}

function pickImage(fn) {
  const input = $('#fileImage');
  input.onchange = async () => {
    const f = input.files[0];
    input.value = '';
    if (f) await fn(f);
  };
  input.click();
}

/* ================= add: in the bar, not a sheet ================= */

// with a layer selected, "add" used to open a sheet listing the same three verbs
// the empty bar shows directly — a sheet over the flyer to reach a menu. Now the
// bar itself becomes the three verbs, so the second tap is where your thumb is.
function inlineAdd() {
  const bar = $('#actionbar');
  inlineOpen = true;
  bar.classList.add('inline-mode');
  bar.innerHTML = `
    <div class="inline">
      <span class="inline-l">add</span>
      <button class="pill ghost" data-x="text">text</button>
      <button class="pill ghost" data-x="photo">photo</button>
      <button class="pill ghost" data-x="shape">shape</button>
      <span class="spacer"></span>
      <button class="inline-done" data-done>✕</button>
    </div>`;
  const leave = () => { inlineOpen = false; bar.classList.remove('inline-mode'); renderBar(); };
  bar.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => {
    const x = b.dataset.x;
    leave();
    if (x === 'text') addText();
    if (x === 'photo') pickImage(f => addImageFromFile(f));
    if (x === 'shape') sheetShapes();
  }));
  bar.querySelector('[data-done]').addEventListener('click', leave);
}

/* ================= move: nudge without a keyboard ================= */

// a finger drag on a small layer grabs its handles, and on a phone there is no
// arrow key. Four buttons and a step toggle place anything exactly.
function inlineNudge(o) {
  const bar = $('#actionbar');
  inlineOpen = true;
  bar.classList.add('inline-mode');
  let step = 1;
  bar.innerHTML = `
    <div class="inline tight">
      <span class="inline-l">move</span>
      <div class="nudge">
        <button data-n="left" aria-label="left">←</button>
        <button data-n="up" aria-label="up">↑</button>
        <button data-n="down" aria-label="down">↓</button>
        <button data-n="right" aria-label="right">→</button>
      </div>
      <button class="pill ghost" data-step>1px</button>
      <span class="spacer"></span>
      <button class="inline-done" data-done>done</button>
    </div>`;

  const D = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  const go = dir => {
    if (!ed.canvas.getObjects().includes(o)) return;
    ed.canvas.setActiveObject(o);
    nudge(D[dir][0] * step, D[dir][1] * step);
  };

  // hold to keep going, so crossing the flyer doesn't take fifty taps
  bar.querySelectorAll('[data-n]').forEach(b => {
    let timer = null, repeat = null;
    const stop = () => { clearTimeout(timer); clearInterval(repeat); timer = repeat = null; };
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      go(b.dataset.n);
      timer = setTimeout(() => { repeat = setInterval(() => go(b.dataset.n), 60); }, 380);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => b.addEventListener(ev, stop));
  });

  const sb = bar.querySelector('[data-step]');
  sb.addEventListener('click', () => {
    step = step === 1 ? 10 : step === 10 ? 50 : 1;
    sb.textContent = step + 'px';
  });
  bar.querySelector('[data-done]').addEventListener('click', () => {
    inlineOpen = false;
    bar.classList.remove('inline-mode');
    renderBar();
  });
}

function sheetShapes() {
  const html = `
    <button class="srow" data-k="rect"><svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="4" width="15" height="12"/></svg>rectangle</button>
    <button class="srow" data-k="rounded"><svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="4" width="15" height="12" rx="4"/></svg>rounded rectangle</button>
    <button class="srow" data-k="ellipse"><svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="7"/></svg>circle</button>
    <button class="srow" data-k="line"><svg viewBox="0 0 20 20" width="20" height="20"><path d="M3 16 L17 4"/></svg>line</button>`;
  openSheet('shape', html, root => {
    root.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => {
      addShape(b.dataset.k);
      closeSheet();
    }));
  });
}

/* ================= sheet: colour ================= */

const NEUTRALS = ['#111110', '#555555', '#999999', '#d9d7d1', '#f8f7f4', '#ffffff'];
const PALETTE = [
  '#cc3333', '#e2582c', '#e8a45c', '#f2d16b', '#7fa650', '#22423b',
  '#3a6156', '#2f6f8f', '#26408b', '#5b3f8c', '#a8447f', '#c97a35',
];

export function sheetColor(title, initial, onChange, opts = {}) {
  let { h, s, v } = hexToHsv(initial || '#111110');
  let current = initial || '#111110';
  let custom = false;      // the picker stays folded away until asked for

  const build = () => {
    const docCols = collectDocColors().filter(c => !NEUTRALS.includes(c) && !PALETTE.includes(c));
    const swatch = c =>
      `<button class="sw${c.toLowerCase() === (current || '').toLowerCase() ? ' cur' : ''}" data-c="${c}" style="background:${c}"></button>`;
    const html = `
      <div class="swatches">
        ${opts.allowNone ? '<button class="sw none" data-none></button>' : ''}
        ${[...NEUTRALS, ...PALETTE, ...docCols].map(swatch).join('')}
      </div>
      <div class="cp-actions">
        <button class="pill ghost" data-custom>${custom ? 'hide picker' : 'custom colour'}</button>
        <button class="pill ghost" data-sample>pick from flyer</button>
      </div>
      <div class="cp-wrap${custom ? '' : ' hidden'}">
        <div class="cp-sq"><span class="cp-dot"></span></div>
        <div class="cp-hue"><span class="cp-mark"></span></div>
        <div class="cp-row">
          <span class="cp-cur" data-cur></span>
          <label class="field" style="flex:1">hex<input data-hex spellcheck="false" autocapitalize="off"></label>
        </div>
      </div>`;

    const wire = root => {
      const sq = root.querySelector('.cp-sq'), dot = root.querySelector('.cp-dot');
      const hue = root.querySelector('.cp-hue'), mark = root.querySelector('.cp-mark');
      const hexIn = root.querySelector('[data-hex]'), cur = root.querySelector('[data-cur]');

      const paint = (fire = true) => {
        const hex = hsvToHex(h, s, v);
        current = hex;
        sq.style.background =
          `linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,hsl(${h},100%,50%))`;
        dot.style.left = (s * 100) + '%';
        dot.style.top = ((1 - v) * 100) + '%';
        dot.style.background = hex;
        mark.style.left = (h / 360 * 100) + '%';
        mark.style.background = `hsl(${h},100%,50%)`;
        cur.style.background = hex;
        if (document.activeElement !== hexIn) hexIn.value = hex;
        root.querySelectorAll('.sw[data-c]').forEach(el =>
          el.classList.toggle('cur', el.dataset.c.toLowerCase() === hex.toLowerCase()));
        if (fire) onChange(hex);
      };
      paint(false);

      const track = (el, fn) => {
        const handle = e => {
          const r = el.getBoundingClientRect();
          fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
             Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
          paint();
        };
        el.addEventListener('pointerdown', e => {
          el.setPointerCapture(e.pointerId);
          handle(e);
          const mv = ev => handle(ev);
          const up = () => {
            el.removeEventListener('pointermove', mv);
            el.removeEventListener('pointerup', up);
            if (!inlineOpen) renderBar();
          };
          el.addEventListener('pointermove', mv);
          el.addEventListener('pointerup', up);
        });
      };
      track(sq, (x, y) => { s = x; v = 1 - y; });
      track(hue, x => { h = Math.round(x * 360) % 360; });

      root.querySelectorAll('.sw[data-c]').forEach(b => b.addEventListener('click', () => {
        // apply the swatch's own hex. Going through HSV and back drifts a few
        // of them by a digit, so they never read as selected and each tap
        // added a near-duplicate to the document's colour list.
        const hex = b.dataset.c;
        ({ h, s, v } = hexToHsv(hex));
        current = hex;
        onChange(hex);
        paint(false);
        cur.style.background = hex;
        hexIn.value = hex;
        root.querySelectorAll('.sw[data-c]').forEach(el =>
          el.classList.toggle('cur', el.dataset.c.toLowerCase() === hex.toLowerCase()));
        if (!inlineOpen) renderBar();
      }));
      const none = root.querySelector('[data-none]');
      if (none) none.addEventListener('click', () => {
        if (opts.onNone) opts.onNone();
        closeSheet();
      });
      hexIn.addEventListener('change', () => {
        const m = hexIn.value.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
        if (!m) { hexIn.value = current; return; }
        ({ h, s, v } = hexToHsv('#' + m[1]));
        paint();
        if (!inlineOpen) renderBar();
      });
      root.querySelector('[data-custom]').addEventListener('click', () => {
        custom = !custom;
        refreshSheet();
        requestAnimationFrame(panSelectionIntoView);
      });
      root.querySelector('[data-sample]').addEventListener('click', () => {
        closeSheet();
        showToast('tap the flyer to pick a colour');
        sampling = hex => {
          if (!hex) { showToast("couldn't read that pixel"); return; }
          onChange(hex);
          ed.canvas.requestRenderAll();
          markDirty(true);
          if (!inlineOpen) renderBar();
          ({ h, s, v } = hexToHsv(hex));
          current = hex;
          const b2 = build();
          openSheet(title, b2.html, b2.wire, { push: false });
          stack[stack.length - 1].rebuild = build;
        };
      });
    };
    return { html, wire };
  };

  const b = build();
  openSheet(title, b.html, b.wire);
  stack[stack.length - 1].rebuild = build;
}

function sheetStroke(o) {
  const isLine = o.pKind === 'line';
  sheetColor(isLine ? 'colour' : 'stroke', o.stroke || '#111110', c => {
    o.set('stroke', c);
    if (!o.strokeWidth) o.set('strokeWidth', Math.max(2, Math.round(ed.docW * 0.006)));
    afterChange();
    refreshSheet();
  }, {
    allowNone: !isLine,
    onNone: () => { o.set({ stroke: null, strokeWidth: 0 }); afterChange(); },
  });
  // fold the width slider in underneath the swatches
  const cur = stack[stack.length - 1];
  const inner = cur.rebuild;
  cur.rebuild = () => {
    const base = inner();
    const w = Math.round(o.strokeWidth || 0);
    return {
      html: base.html + `
        <div class="group" style="margin-top:18px">
          <div class="lbl"><span>thickness</span><span class="val" data-wo>${w}px</span></div>
          <input type="range" min="0" max="48" value="${w}" data-wi>
        </div>`,
      wire: root => {
        base.wire(root);
        const wi = root.querySelector('[data-wi]');
        wi.addEventListener('input', () => {
          o.set('strokeWidth', +wi.value);
          if (+wi.value > 0 && !o.stroke) o.set('stroke', '#111110');
          root.querySelector('[data-wo]').textContent = wi.value + 'px';
          o.setCoords();
          ed.canvas.requestRenderAll();
          markDirty(true);
        });
      },
    };
  };
  refreshSheet();
}

function hexToHsv(hex) {
  const m = String(hex).replace('#', '');
  const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const r = parseInt(full.slice(0, 2), 16) / 255,
        g = parseInt(full.slice(2, 4), 16) / 255,
        b = parseInt(full.slice(4, 6), 16) / 255;
  if ([r, g, b].some(Number.isNaN)) return { h: 0, s: 0, v: 0 };
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToHex(h, s, v) {
  const f = n => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(5) + f(3) + f(1);
}

/* ================= sheet: fonts ================= */

const CATS = ['all', 'display', 'serif', 'sans', 'mono', 'script'];

async function sheetFont(o) {
  loadSpecimens();
  const recents = await recentFonts();
  let cat = 'all', query = '';

  const build = () => {
    const meta = fontMeta(o.fontFamily);
    const weights = meta.weights && meta.weights.length ? meta.weights : [400];
    const all = allFamilies();
    const match = f =>
      (cat === 'all' || f.category === cat) &&
      (!query || f.family.toLowerCase().includes(query));
    const row = f =>
      `<button class="frow${f.family === o.fontFamily ? ' on' : ''}" data-fam="${esc(f.family)}"
        style="font-family:'${esc(f.family)}',var(--mono)">${esc(f.family)}<span class="fname">${esc(f.category)}</span></button>`;

    const rec = recents.map(r => all.find(f => f.family === r)).filter(f => f && match(f));
    const rows = [];
    if (rec.length && !query && cat === 'all') {
      rows.push('<div class="fsect">recent</div>', ...rec.map(row), '<div class="fsect">all fonts</div>');
    }
    rows.push(...all.filter(match).map(row));

    const html = `
      <div class="fsearch"><input placeholder="search fonts…" value="${esc(query)}" data-q></div>
      <div class="fchips">${CATS.map(c =>
        `<button class="chip${c === cat ? ' on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
      <div class="seg" data-wseg>
        ${weights.map(w => `<button data-w="${w}" class="${+o.fontWeight === w ? 'on' : ''}">${w}</button>`).join('')}
        ${meta.italics ? `<button data-i style="font-style:italic" class="${o.fontStyle === 'italic' ? 'on' : ''}">italic</button>` : ''}
      </div>
      <div class="flist">${rows.join('') || '<div class="fsect">nothing matches that search</div>'}</div>
      <div class="floadrow">
        <input placeholder="load any google font by name…" data-load>
        <button class="pill ghost" data-go>load</button>
      </div>`;

    const wire = root => {
      const q = root.querySelector('[data-q]');
      q.addEventListener('input', () => {
        query = q.value.trim().toLowerCase();
        const pos = q.selectionStart;
        refreshSheet();
        const q2 = bodyEl.querySelector('[data-q]');
        if (q2) { q2.focus(); q2.setSelectionRange(pos, pos); }
      });
      root.querySelectorAll('[data-cat]').forEach(c => c.addEventListener('click', () => {
        cat = c.dataset.cat;
        refreshSheet();
      }));
      root.querySelectorAll('[data-fam]').forEach(b => b.addEventListener('click', async () => {
        await applyFamily(o, b.dataset.fam);
        refreshSheet();
      }));
      const wseg = root.querySelector('[data-wseg]');
      if (wseg) wseg.addEventListener('click', e => {
        const wb = e.target.closest('[data-w]'), ib = e.target.closest('[data-i]');
        if (wb) o.set('fontWeight', +wb.dataset.w);
        if (ib) o.set('fontStyle', o.fontStyle === 'italic' ? 'normal' : 'italic');
        if (wb || ib) { ed.canvas.requestRenderAll(); markDirty(true); refreshSheet(); }
      });
      const li = root.querySelector('[data-load]');
      const go = async () => {
        const name = li.value.trim();
        if (!name) return;
        li.disabled = true;
        showToast('looking for “' + name + '”…', 6000);
        try {
          const fam = await loadByName(name);
          await applyFamily(o, fam, true);
          li.value = '';
          showToast('loaded ' + fam);
          refreshSheet();
        } catch {
          showToast("couldn't find that font on google fonts");
        }
        const li2 = bodyEl.querySelector('[data-load]');
        if (li2) li2.disabled = false;
      };
      root.querySelector('[data-go]').addEventListener('click', go);
      li.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    };
    return { html, wire };
  };

  const b = build();
  openSheet('font', b.html, b.wire, { tall: true });
  stack[stack.length - 1].rebuild = build;
}

async function applyFamily(o, family, skipLoad) {
  if (!skipLoad) {
    const slow = setTimeout(() => showToast('loading ' + family + '…', 8000), 350);
    try {
      await loadFont(family);
    } catch {
      clearTimeout(slow);
      showToast("couldn't load " + family + ' — check your connection');
      return;
    }
    clearTimeout(slow);
    $('#toast').classList.remove('on');
  }
  const meta = fontMeta(family);
  const weights = meta.weights || [400];
  const w = weights.includes(+o.fontWeight)
    ? +o.fontWeight
    : weights.reduce((a, b) => (Math.abs(b - 400) < Math.abs(a - 400) ? b : a));
  o.set({ fontFamily: family, fontWeight: w });
  if (!meta.italics) o.set('fontStyle', 'normal');
  try { fabric.cache.clearFontCache(); } catch {}
  o.initDimensions();
  o.setCoords();
  ed.canvas.requestRenderAll();
  markDirty(true);
  pushRecentFont(family);
  if (!inlineOpen) renderBar();
}

/* ================= sheet: adjust (photos) ================= */

function sheetAdjust(o) {
  const build = () => ({
    html: `
      <div class="group"><div class="lbl"><span>flip</span></div>
        <div class="rowbtns">
          <button class="pill ghost" data-f="x">horizontal</button>
          <button class="pill ghost" data-f="y">vertical</button>
        </div></div>
      <div class="group">
        <div class="lbl"><span>rotation</span><span class="val" data-ro>${Math.round(o.angle || 0)}°</span></div>
        <input type="range" min="-180" max="180" value="${Math.round(o.angle || 0)}" data-rot>
      </div>
      <div class="group">
        <button class="pill ghost" style="width:100%" data-fit>fit to the flyer</button>
      </div>`,
    wire: root => {
      root.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => {
        o.set(b.dataset.f === 'x' ? 'flipX' : 'flipY', !(b.dataset.f === 'x' ? o.flipX : o.flipY));
        ed.canvas.requestRenderAll(); markDirty(true);
      }));
      const r = root.querySelector('[data-rot]');
      r.addEventListener('input', () => {
        o.rotate(+r.value);
        root.querySelector('[data-ro]').textContent = r.value + '°';
        ed.canvas.requestRenderAll(); markDirty(true);
      });
      root.querySelector('[data-fit]').addEventListener('click', () => {
        resetImageSize(o);
      });
    },
  });
  const b = build();
  openSheet('adjust', b.html, b.wire);
  stack[stack.length - 1].rebuild = build;
}

/* ================= sheet: more (the long tail) ================= */

function sheetMore(o) {
  const isText = o.pKind === 'text';
  const build = () => {
    const op = Math.round((o.opacity ?? 1) * 100);
    const textBits = isText ? `
      <div class="group"><div class="lbl"><span>align</span></div>
        <div class="seg" data-align>${['left', 'centre', 'right'].map((a, i) => {
          const v = ['left', 'center', 'right'][i];
          return `<button data-v="${v}" class="${o.textAlign === v ? 'on' : ''}">${a}</button>`;
        }).join('')}</div></div>
      <div class="group">
        <div class="lbl"><span>line height</span><span class="val" data-lho>${(o.lineHeight ?? 1.16).toFixed(2)}</span></div>
        <input type="range" min="70" max="220" value="${Math.round((o.lineHeight ?? 1.16) * 100)}" data-lh>
      </div>
      <div class="group">
        <div class="lbl"><span>letter spacing</span><span class="val" data-lso>${((o.charSpacing || 0) / 1000).toFixed(2)}em</span></div>
        <input type="range" min="-60" max="500" value="${o.charSpacing || 0}" data-ls>
      </div>
      <div class="sheet-div"></div>` : '';

    // centring used to be inside the text-only block, so a photo or a shape
    // could not be centred at all
    const posBits = `
      <div class="group">
        <div class="rowbtns">
          <button class="pill ghost" data-pos="cx">centre across</button>
          <button class="pill ghost" data-pos="cy">centre down</button>
        </div>
      </div>`;

    const html = `${textBits}${posBits}
      <div class="group">
        <div class="lbl"><span>opacity</span><span class="val" data-opo>${op}%</span></div>
        <input type="range" min="0" max="100" value="${op}" data-op>
      </div>
      <button class="srow" data-m="fwd">${I.fwd}bring forward</button>
      <button class="srow" data-m="back">${I.back}send backward</button>
      <button class="srow" data-m="dup">${I.dup}duplicate</button>
      <button class="srow" data-m="lock">${o.pLocked ? I.unlock : I.lock}${o.pLocked ? 'unlock' : 'lock'}</button>
      <button class="srow" data-m="layers">${I.layers}all layers…</button>
      <button class="srow danger" data-m="del">${I.del}delete</button>`;

    const wire = root => {
      const op2 = root.querySelector('[data-op]');
      op2.addEventListener('input', () => {
        o.set('opacity', op2.value / 100);
        root.querySelector('[data-opo]').textContent = op2.value + '%';
        ed.canvas.requestRenderAll(); markDirty(true);
      });
      const al = root.querySelector('[data-align]');
      if (al) al.addEventListener('click', e => {
        const b = e.target.closest('[data-v]');
        if (!b) return;
        o.set('textAlign', b.dataset.v);
        root.querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', x === b));
        ed.canvas.requestRenderAll(); markDirty(true);
      });
      const lh = root.querySelector('[data-lh]');
      if (lh) lh.addEventListener('input', () => {
        o.set('lineHeight', lh.value / 100);
        root.querySelector('[data-lho]').textContent = (lh.value / 100).toFixed(2);
        ed.canvas.requestRenderAll(); markDirty(true);
      });
      const ls = root.querySelector('[data-ls]');
      if (ls) ls.addEventListener('input', () => {
        o.set('charSpacing', +ls.value);
        root.querySelector('[data-lso]').textContent = (ls.value / 1000).toFixed(2) + 'em';
        ed.canvas.requestRenderAll(); markDirty(true);
      });
      root.querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => {
        const r = o.getBoundingRect();
        if (b.dataset.pos === 'cx') o.set('left', o.left + (ed.docW - r.width) / 2 - r.left);
        else o.set('top', o.top + (ed.docH - r.height) / 2 - r.top);
        o.setCoords();
        ed.canvas.requestRenderAll(); markDirty(true);
      }));
      root.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
        const m = b.dataset.m;
        if (m === 'layers') { sheetLayers(); return; }
        if (m === 'dup') duplicateObject(o);
        if (m === 'fwd') reorder(o, 'forward');
        if (m === 'back') reorder(o, 'backward');
        if (m === 'lock') setLocked(o, !o.pLocked);
        if (m === 'del') deleteObject(o);
        closeSheet();
      }));
    };
    return { html, wire };
  };
  const b = build();
  openSheet('more', b.html, b.wire);
  stack[stack.length - 1].rebuild = build;
}

/* ================= sheet: layers ================= */

const GLYPH = { text: 'T', rect: '▢', rounded: '▢', ellipse: '◯', line: '╱', image: '▣', bg: '□' };

function thumbFor(o) {
  if (o.pKind === 'image') {
    try {
      const url = o.toDataURL({ multiplier: Math.min(1, 70 / Math.max(o.width, o.height)) });
      return `<span class="thumb" style="background-image:url('${url}')"></span>`;
    } catch { return '<span class="thumb">▣</span>'; }
  }
  if (o.pKind === 'text') {
    const ch = (o.text || 'a').trim().charAt(0) || 'a';
    return `<span class="thumb" style="font-family:'${esc(o.fontFamily)}',var(--mono)">${esc(ch)}</span>`;
  }
  return `<span class="thumb" style="background:${o.pKind === 'line' ? o.stroke : o.fill || '#fff'}"></span>`;
}

function sheetLayers() {
  const build = () => {
    const objs = ed.canvas.getObjects().filter(o => o.pKind !== 'bg').reverse();
    const active = ed.canvas.getActiveObject();
    const rows = objs.map((o, i) => `
      <div class="lrow${o === active ? ' on' : ''}" data-i="${i}">
        <button class="lpick" data-pick>
          <span class="lbl" style="width:12px;text-align:center">${GLYPH[o.pKind] || '▢'}</span>
          ${thumbFor(o)}
          <span class="lname" data-name>${esc(layerName(o))}</span>
        </button>
        <span class="lacts">
          <button class="icon-btn" data-rename title="rename">${I.edit}</button>
          <button class="icon-btn" data-up ${i === 0 ? 'disabled' : ''}>${I.fwd}</button>
          <button class="icon-btn" data-down ${i === objs.length - 1 ? 'disabled' : ''}>${I.back}</button>
          <button class="icon-btn ${o.visible ? 'act-on' : ''}" data-eye>${o.visible ? I.eye : I.eyeOff}</button>
          <button class="icon-btn ${o.pLocked ? 'act-on' : ''}" data-lock>${o.pLocked ? I.lock : I.unlock}</button>
        </span>
      </div>`).join('');

    // the background lives in the canvas sheet — this row just points there
    const html = (objs.length ? rows : '<p class="hint" style="padding:14px 8px">nothing on your flyer yet</p>') + `
      <button class="lrow" data-bgrow style="width:100%">
        <span class="lpick" style="pointer-events:none">
          <span class="lbl" style="width:12px;text-align:center">□</span>
          <span class="thumb" style="background:${ed.bgRect ? ed.bgRect.fill : '#fff'}"></span>
          <span class="lname">background</span>
        </span>
        <span class="lbl" style="padding-right:8px">canvas ›</span>
      </button>`;

    const wire = root => {
      root.querySelectorAll('.lrow[data-i]').forEach(row => {
        const o = objs[+row.dataset.i];
        row.querySelector('[data-pick]').addEventListener('click', () => {
          if (o.pLocked) { showToast('that layer is locked'); return; }
          if (!o.visible) { showToast('that layer is hidden'); return; }
          ed.canvas.setActiveObject(o);
          ed.canvas.requestRenderAll();
          closeSheet();
        });
        row.querySelector('[data-up]').addEventListener('click', () => reorder(o, 'forward'));
        row.querySelector('[data-down]').addEventListener('click', () => reorder(o, 'backward'));
        row.querySelector('[data-eye]').addEventListener('click', () => setVisible(o, !o.visible));
        row.querySelector('[data-lock]').addEventListener('click', () => setLocked(o, !o.pLocked));
        const startRename = el => {
          el.innerHTML = `<input value="${esc(o.pName || layerName(o))}">`;
          const input = el.querySelector('input');
          input.focus(); input.select();
          const done = () => { o.pName = input.value.trim() || null; markDirty(true); refreshSheet(); };
          input.addEventListener('blur', done);
          input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); });
        };
        row.querySelector('[data-rename]').addEventListener('click', e => {
          e.stopPropagation();
          startRename(row.querySelector('[data-name]'));
        });
        // still works with a mouse
        row.querySelector('[data-name]').addEventListener('dblclick', e => {
          e.stopPropagation();
          startRename(e.currentTarget);
        });
      });
      root.querySelector('[data-bgrow]').addEventListener('click', sheetCanvas);
    };
    return { html, wire };
  };

  const b = build();
  openSheet('layers', b.html, b.wire);
  stack[stack.length - 1].rebuild = build;
}

/* ================= sheet: canvas ================= */

function sheetCanvas() {
  const build = () => {
    const cur = PRESETS.find(p => p.w === ed.docW && p.h === ed.docH);
    const html = `
      <div class="group">
        <div class="lbl"><span>background</span></div>
        <div class="swatches" data-bgsw>
          ${[...new Set([ed.bgRect ? ed.bgRect.fill : '#ffffff', '#ffffff', '#f8f7f4', '#111110', '#22423b', '#cc3333'])]
            .map(c => `<button class="sw${c === (ed.bgRect && ed.bgRect.fill) ? ' cur' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}
          <button class="sw add" data-bgmore>+</button>
        </div>
      </div>
      <div class="group">
        <div class="lbl"><span>size</span></div>
        ${PRESETS.map(p => `
          <button class="preset${cur && cur.key === p.key ? ' on' : ''}" data-preset="${p.key}">
            <span class="radio"></span>${p.label}<span class="dim">${p.w} × ${p.h}</span>
          </button>`).join('')}
        <button class="preset${cur ? '' : ' on'}">
          <span class="radio"></span>custom<span class="dim">${ed.docW} × ${ed.docH}</span>
        </button>
        <div class="wh">
          <label class="field">w<input id="inW" type="number" inputmode="numeric" value="${ed.docW}"></label>
          <label class="field">h<input id="inH" type="number" inputmode="numeric" value="${ed.docH}"></label>
        </div>
        <div class="rowbtns" style="margin-top:12px">
          <button class="pill ghost" data-swap>swap orientation</button>
        </div>
      </div>`;
    const wire = root => {
      root.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
        const p = PRESETS.find(x => x.key === b.dataset.preset);
        if (p) { resizeDoc(p.w, p.h); refreshSheet(); }
      }));
      const w = root.querySelector('#inW'), h = root.querySelector('#inH');
      w.addEventListener('change', () => { resizeDoc(+w.value, ed.docH); refreshSheet(); });
      h.addEventListener('change', () => { resizeDoc(ed.docW, +h.value); refreshSheet(); });
      root.querySelector('[data-swap]').addEventListener('click', () => { resizeDoc(ed.docH, ed.docW); refreshSheet(); });
      root.querySelectorAll('[data-bgsw] [data-c]').forEach(b => b.addEventListener('click', () => {
        setBg(b.dataset.c);
        refreshSheet();
      }));
      root.querySelector('[data-bgmore]').addEventListener('click', () => {
        sheetColor('background', ed.bgRect ? ed.bgRect.fill : '#ffffff', c => setBg(c));
      });
    };
    return { html, wire };
  };
  const b = build();
  openSheet('canvas', b.html, b.wire);
  stack[stack.length - 1].rebuild = build;
}

/* ================= sheet: export ================= */

export function sheetExport() {
  const build = () => {
    const maxS = maxExportScale();
    const s = Math.min(ed.exportScale, maxS);
    const html = `
      <div class="group">
        <div class="lbl"><span>size</span></div>
        <div class="seg" data-scale>
          ${[1, 2, 3].map(n =>
            `<button data-s="${n}" class="${n === s ? 'on' : ''}" ${n > maxS ? 'disabled' : ''}>${n}x</button>`).join('')}
        </div>
      </div>
      <div class="group">
        <button class="pill" style="width:100%;padding:15px 0" data-png>
          export png · ${ed.docW * s} × ${ed.docH * s}
        </button>
      </div>
      <div class="group">
        <button class="pill ghost" style="width:100%;padding:14px 0" data-proj>save project file</button>
      </div>`;
    const wire = root => {
      root.querySelector('[data-scale]').addEventListener('click', e => {
        const b = e.target.closest('[data-s]');
        if (!b || b.disabled) return;
        ed.exportScale = +b.dataset.s;
        refreshSheet();
      });
      root.querySelector('[data-png]').addEventListener('click', makePNG);
      root.querySelector('[data-proj]').addEventListener('click', async () => {
        const r = await saveFile(projectBlob(), projectFilename());
        if (r === 'downloaded') showToast('project file saved');
        if (r === 'shared') closeSheet();
        if (r === 'failed') showToast("couldn't save the project file");
      });
    };
    return { html, wire };
  };
  const b = build();
  openSheet('export', b.html, b.wire, { push: false });
  stack[stack.length - 1].rebuild = build;
}

let previewURL = null;

// render first, show it, then let a fresh tap do the saving — ios only opens
// the share sheet from a real user gesture, and an await eats that permission
async function makePNG() {
  const scale = Math.min(ed.exportScale, maxExportScale());
  const btn = bodyEl.querySelector('[data-png]');
  if (btn) { btn.disabled = true; btn.textContent = 'rendering…'; }

  let blob = null;
  try { blob = await renderPNGBlob(scale); } catch {}
  if (!blob) {
    showToast("couldn't render the png — try a smaller size");
    refreshSheet();
    return;
  }

  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = URL.createObjectURL(blob);
  const name = exportFilename(scale);
  const size = blob.size > 1048576
    ? (blob.size / 1048576).toFixed(1) + ' MB'
    : Math.round(blob.size / 1024) + ' KB';

  openSheet('png', `
    <div class="exp-prev"><img src="${previewURL}" alt="your flyer"></div>
    <p class="lbl" style="text-align:center;margin:12px 0 16px">
      ${ed.docW * scale} × ${ed.docH * scale} · ${size}
    </p>
    <button class="pill" style="width:100%;padding:15px 0" data-save>save image</button>`,
    root => {
      root.querySelector('[data-save]').addEventListener('click', async () => {
        const r = await saveFile(blob, name);
        if (r === 'shared') { showToast('saved'); closeSheet(); }
        if (r === 'downloaded') showToast('saved to your downloads');
        if (r === 'failed') showToast('press and hold the picture to save it');
      });
    },
    { tall: true });
}
