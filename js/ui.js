// the interface: a contextual action bar that changes with the selection, and
// single-purpose sheets. every control is one tap from whatever is selected.
import { on, emit } from './bus.js';
import {
  ed, fabric, PRESETS, layerName, markDirty,
  addText, addShape, addImageFromFile, replaceImage, resetImageSize,
  duplicateObject, deleteObject, reorder, setLocked, setVisible,
  resizeDoc, setBg, collectDocColors, maxExportScale, exportPNG, saveProjectFile,
} from './editor.js';
import {
  allFamilies, fontMeta, loadFont, loadByName, loadSpecimens,
  recentFonts, pushRecentFont,
} from './fonts.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let sheetEl, overlayEl, bodyEl, titleEl, backEl;
let stack = [];          // sheet history for the back chevron
let sampling = null;     // pending eyedropper callback

/* ================= icons ================= */

const I = {
  text: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M3 5.5 V3.5 H17 V5.5 M10 3.5 V16.5 M7 16.5 H13"/></svg>',
  photo: '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="4" width="15" height="12"/><circle cx="7" cy="8" r="1.5"/><path d="M4 14.5 L9 9.5 L12 12.5 L14 10.5 L16.5 13"/></svg>',
  shape: '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="2.5" width="10" height="10"/><circle cx="13" cy="13" r="4.5"/></svg>',
  layers: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 2.5 L18 7 L10 11.5 L2 7 Z"/><path d="M2 11 L10 15.5 L18 11"/></svg>',
  canvas: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M2.5 5.5 H17.5 M2.5 10 H17.5 M2.5 14.5 H17.5"/><circle cx="7" cy="5.5" r="1.8" fill="var(--paper)"/><circle cx="13" cy="10" r="1.8" fill="var(--paper)"/><circle cx="8.5" cy="14.5" r="1.8" fill="var(--paper)"/></svg>',
  font: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M2 16 L6.5 4 L11 16 M3.4 12.4 H9.6"/><path d="M17.5 9.6 a3 3 0 0 0-5.6 1.2 M17.5 8.5 V16 M17.5 12.6 a2.6 2.6 0 1 1-5.2 .4 a2.6 2.6 0 0 1 5.2-.4Z"/></svg>',
  size: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M1.5 15.5 L5.5 6 L9.5 15.5 M2.7 12.9 H8.3"/><path d="M12 15.5 L15 8.5 L18 15.5 M12.9 13.6 H17.1"/></svg>',
  align: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M2.5 4.5 H17.5 M2.5 9 H12 M2.5 13.5 H15"/></svg>',
  spacing: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M2.5 6 H17.5 M2.5 14 H17.5"/><path d="M10 8.5 V11.5 M8.4 9.6 L10 8 L11.6 9.6 M8.4 10.4 L10 12 L11.6 10.4"/></svg>',
  opacity: '<svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="7.5"/><path d="M10 2.5 a7.5 7.5 0 0 1 0 15 Z" fill="currentColor" stroke="none"/></svg>',
  erase: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M9.5 3.5 L16.5 10.5 L11 16 L4 9 Z"/><path d="M6.5 11.5 H16"/><path d="M2.5 17.5 H10"/></svg>',
  replace: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M3 7.5 H14 M11 4.5 L14 7.5 L11 10.5"/><path d="M17 12.5 H6 M9 9.5 L6 12.5 L9 15.5"/></svg>',
  flip: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 2.5 V17.5"/><path d="M7.5 6 L2.5 10 L7.5 14 Z"/><path d="M12.5 6 L17.5 10 L12.5 14 Z"/></svg>',
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
  drop: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 2.5 C10 2.5 4.5 9 4.5 12.2 a5.5 5.5 0 0 0 11 0 C15.5 9 10 2.5 10 2.5 Z"/></svg>',
  plus: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M10 4 V16 M4 10 H16"/></svg>',
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

/* ================= sheet plumbing ================= */

function openSheet(title, html, wire, { push = true } = {}) {
  if (push && sheetEl.classList.contains('on') && stack.length) {
    stack[stack.length - 1].scroll = bodyEl.scrollTop;
  } else if (!push) {
    stack = [];
  }
  const entry = { title, html, wire, scroll: 0 };
  if (push) stack.push(entry); else stack = [entry];
  paintSheet();
}

function paintSheet() {
  const cur = stack[stack.length - 1];
  if (!cur) return;
  titleEl.textContent = cur.title;
  bodyEl.innerHTML = cur.html;
  backEl.classList.toggle('hidden', stack.length < 2);
  sheetEl.classList.add('on');
  overlayEl.classList.add('on');
  if (cur.wire) cur.wire(bodyEl);
  bodyEl.scrollTop = cur.scroll || 0;
}

export function closeSheet() {
  sheetEl.classList.remove('on');
  overlayEl.classList.remove('on');
  stack = [];
}

function sheetBack() {
  if (stack.length < 2) return closeSheet();
  stack.pop();
  paintSheet();
}

// refresh the sheet in place (after a value changes elsewhere)
function refreshSheet() {
  if (!sheetEl.classList.contains('on') || !stack.length) return;
  const cur = stack[stack.length - 1];
  if (cur.rebuild) {
    const next = cur.rebuild();
    cur.html = next.html;
    cur.wire = next.wire;
    const y = bodyEl.scrollTop;
    bodyEl.innerHTML = cur.html;
    if (cur.wire) cur.wire(bodyEl);
    bodyEl.scrollTop = y;
  }
}

/* ================= init ================= */

export function initUI() {
  sheetEl = $('#sheet'); overlayEl = $('#overlay');
  bodyEl = $('#sheetBody'); titleEl = $('#sheetTitle'); backEl = $('#sheetBack');

  $('#sheetClose').addEventListener('click', closeSheet);
  sheetEl.querySelector('.sheet-grab').addEventListener('click', closeSheet);
  backEl.addEventListener('click', sheetBack);
  overlayEl.addEventListener('click', closeSheet);

  on('selection', renderBar);
  on('layers', () => { renderBar(); refreshSheet(); });
  on('doc:open', () => { closeSheet(); renderBar(); });
  on('doc:change', refreshSheet);
  on('toast', showToast);

  ed.canvas.on('mouse:down', onCanvasSample);
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

function renderBar() {
  const bar = $('#actionbar');
  if (!bar || !ed.open) return;
  const o = ed.canvas.getActiveObject();
  let html;

  if (!o || o.pKind === 'bg') {
    html =
      act('add-text', I.text, 'text') +
      act('add-photo', I.photo, 'photo') +
      act('add-shape', I.shape, 'shape') +
      sep +
      act('layers', I.layers, 'layers') +
      act('canvas', I.canvas, 'canvas');
  } else if (o.pKind === 'text') {
    html =
      act('font', I.font, 'font') +
      actDot('fill', o.fill, 'color') +
      act('size', I.size, 'size') +
      act('align', I.align, 'align') +
      act('spacing', I.spacing, 'spacing') +
      act('opacity', I.opacity, 'opacity') +
      sep +
      act('layers', I.layers, 'layers') +
      act('more', I.more, 'more');
  } else if (o.pKind === 'image') {
    html =
      act('erase', I.erase, 'erase object', 'primary') +
      act('replace', I.replace, 'replace') +
      act('flip', I.flip, 'flip') +
      act('opacity', I.opacity, 'opacity') +
      act('fitimg', I.canvas, 'fit') +
      sep +
      act('layers', I.layers, 'layers') +
      act('more', I.more, 'more');
  } else {
    const isLine = o.pKind === 'line';
    const isRect = o.pKind === 'rect' || o.pKind === 'rounded';
    html =
      (isLine ? '' : actDot('fill', o.fill, 'fill')) +
      actDot('stroke', o.stroke || '#fff', isLine ? 'color' : 'stroke') +
      act('strokew', I.stroke, 'weight') +
      (isRect ? act('radius', I.radius, 'corners') : '') +
      act('opacity', I.opacity, 'opacity') +
      sep +
      act('layers', I.layers, 'layers') +
      act('more', I.more, 'more');
  }

  bar.innerHTML = html;
  bar.querySelectorAll('[data-a]').forEach(b =>
    b.addEventListener('click', () => runAction(b.dataset.a, o)));
  markScrollable(bar);
}

// fade the trailing edge only while there's more bar to reach
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
  switch (key) {
    case 'add-text': addText(); break;
    case 'add-photo': pickImage(f => addImageFromFile(f)); break;
    case 'add-shape': sheetShapes(); break;
    case 'layers': sheetLayers(); break;
    case 'canvas': sheetCanvas(); break;
    case 'font': sheetFont(o); break;
    case 'fill': sheetColor('color', o.fill, c => { o.set('fill', c); applied(); }); break;
    case 'stroke':
      sheetColor('stroke', o.stroke || '#111110', c => {
        o.set('stroke', c);
        if (!o.strokeWidth) o.set('strokeWidth', Math.max(2, Math.round(ed.docW * 0.006)));
        applied();
      }, { allowNone: o.pKind !== 'line', onNone: () => { o.set({ stroke: null, strokeWidth: 0 }); applied(); } });
      break;
    case 'size': sheetSize(o); break;
    case 'align': sheetAlign(o); break;
    case 'spacing': sheetSpacing(o); break;
    case 'opacity': sheetOpacity(o); break;
    case 'strokew': sheetStrokeWidth(o); break;
    case 'radius': sheetRadius(o); break;
    case 'erase': emit('retouch:open', o); break;
    case 'replace': pickImage(f => replaceImage(o, f)); break;
    case 'flip': sheetFlip(o); break;
    case 'fitimg': resetImageSize(o); showToast('photo fit to the canvas'); break;
    case 'more': sheetMore(o); break;
  }
}

function applied() {
  ed.canvas.requestRenderAll();
  markDirty(true);
  renderBar();
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

/* ================= slider sheet helper ================= */

function sliderSheet(title, cfg) {
  // cfg: {label, min, max, value, format, apply, extraHtml, extraWire}
  const build = () => {
    const html = `
      <div class="group">
        <div class="lbl"><span>${cfg.label}</span><span class="val" data-out>${cfg.format(cfg.get())}</span></div>
        <input type="range" min="${cfg.min}" max="${cfg.max}" step="${cfg.step || 1}" value="${cfg.raw()}" data-slider>
      </div>${cfg.extraHtml ? cfg.extraHtml() : ''}`;
    const wire = root => {
      const s = root.querySelector('[data-slider]');
      const out = root.querySelector('[data-out]');
      s.addEventListener('input', () => {
        cfg.apply(+s.value);
        out.textContent = cfg.format(cfg.get());
        ed.canvas.requestRenderAll();
        markDirty(true);
      });
      s.addEventListener('change', () => renderBar());
      if (cfg.extraWire) cfg.extraWire(root, s, out);
    };
    return { html, wire };
  };
  const b = build();
  openSheet(title, b.html, b.wire);
  stack[stack.length - 1].rebuild = build;
}

/* ================= sheets: object properties ================= */

function sheetOpacity(o) {
  sliderSheet('opacity', {
    label: 'opacity', min: 0, max: 100,
    get: () => Math.round((o.opacity ?? 1) * 100),
    raw: () => Math.round((o.opacity ?? 1) * 100),
    format: v => v + '%',
    apply: v => o.set('opacity', v / 100),
  });
}

function sheetSize(o) {
  sliderSheet('size', {
    label: 'font size', min: 8, max: 400,
    get: () => Math.round(o.fontSize),
    raw: () => Math.round(o.fontSize),
    format: v => v + 'px',
    apply: v => o.set('fontSize', v),
    extraHtml: () => `
      <div class="group"><div class="lbl"><span>nudge</span></div>
        <div class="stepper"><button data-st="-1">–</button>
        <input class="num" data-num inputmode="numeric" value="${Math.round(o.fontSize)}">
        <button data-st="1">+</button></div></div>`,
    extraWire: (root, slider, out) => {
      const num = root.querySelector('[data-num]');
      const set = v => {
        const s = Math.max(8, Math.min(400, Math.round(v) || o.fontSize));
        o.set('fontSize', s);
        num.value = s; slider.value = s; out.textContent = s + 'px';
        ed.canvas.requestRenderAll(); markDirty(true);
      };
      root.querySelectorAll('[data-st]').forEach(b =>
        b.addEventListener('click', () => set(+num.value + +b.dataset.st * 2)));
      num.addEventListener('change', () => set(+num.value));
      slider.addEventListener('input', () => { num.value = Math.round(o.fontSize); });
    },
  });
}

function sheetStrokeWidth(o) {
  sliderSheet('stroke weight', {
    label: 'weight', min: 0, max: 48,
    get: () => Math.round(o.strokeWidth || 0),
    raw: () => Math.round(o.strokeWidth || 0),
    format: v => v + 'px',
    apply: v => {
      o.set('strokeWidth', v);
      if (v > 0 && !o.stroke) o.set('stroke', '#111110');
      o.setCoords();
    },
  });
}

function sheetRadius(o) {
  const max = Math.round(Math.min(o.width, o.height) / 2);
  sliderSheet('corners', {
    label: 'corner radius', min: 0, max,
    get: () => Math.round(o.rx || 0),
    raw: () => Math.round(o.rx || 0),
    format: v => v + 'px',
    apply: v => o.set({ rx: v, ry: v }),
  });
}

function sheetAlign(o) {
  const build = () => {
    const opts = ['left', 'center', 'right'];
    const html = `
      <div class="group"><div class="lbl"><span>text align</span></div>
        <div class="seg" data-align>${opts.map(a =>
          `<button data-v="${a}" class="${o.textAlign === a ? 'on' : ''}">${a}</button>`).join('')}</div></div>
      <div class="group"><div class="lbl"><span>position on the flyer</span></div>
        <div class="rowbtns">
          <button class="pill ghost" data-pos="cx">centre across</button>
          <button class="pill ghost" data-pos="cy">centre down</button>
        </div></div>`;
    const wire = root => {
      root.querySelector('[data-align]').addEventListener('click', e => {
        const b = e.target.closest('[data-v]');
        if (!b) return;
        o.set('textAlign', b.dataset.v);
        root.querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', x === b));
        ed.canvas.requestRenderAll(); markDirty(true);
      });
      root.querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => {
        const r = o.getBoundingRect();
        if (b.dataset.pos === 'cx') o.set('left', o.left + (ed.docW - r.width) / 2 - r.left);
        else o.set('top', o.top + (ed.docH - r.height) / 2 - r.top);
        o.setCoords();
        ed.canvas.requestRenderAll(); markDirty(true);
      }));
    };
    return { html, wire };
  };
  const b = build();
  openSheet('align', b.html, b.wire);
  stack[stack.length - 1].rebuild = build;
}

function sheetSpacing(o) {
  const build = () => {
    const lh = o.lineHeight ?? 1.16;
    const ls = o.charSpacing || 0;
    const html = `
      <div class="group">
        <div class="lbl"><span>line height</span><span class="val" data-lho>${lh.toFixed(2)}</span></div>
        <input type="range" min="70" max="220" value="${Math.round(lh * 100)}" data-lh>
      </div>
      <div class="group">
        <div class="lbl"><span>letter spacing</span><span class="val" data-lso>${(ls / 1000).toFixed(2)}em</span></div>
        <input type="range" min="-60" max="500" value="${ls}" data-ls>
      </div>`;
    const wire = root => {
      const lhI = root.querySelector('[data-lh]'), lsI = root.querySelector('[data-ls]');
      lhI.addEventListener('input', () => {
        o.set('lineHeight', lhI.value / 100);
        root.querySelector('[data-lho]').textContent = (lhI.value / 100).toFixed(2);
        ed.canvas.requestRenderAll(); markDirty(true);
      });
      lsI.addEventListener('input', () => {
        o.set('charSpacing', +lsI.value);
        root.querySelector('[data-lso]').textContent = (lsI.value / 1000).toFixed(2) + 'em';
        ed.canvas.requestRenderAll(); markDirty(true);
      });
    };
    return { html, wire };
  };
  const b = build();
  openSheet('spacing', b.html, b.wire);
  stack[stack.length - 1].rebuild = build;
}

function sheetFlip(o) {
  const build = () => ({
    html: `
      <div class="group"><div class="lbl"><span>flip the photo</span></div>
        <div class="rowbtns">
          <button class="pill ghost" data-f="x">horizontal</button>
          <button class="pill ghost" data-f="y">vertical</button>
        </div></div>
      <div class="group"><div class="lbl"><span>rotation</span><span class="val" data-ro>${Math.round(o.angle || 0)}°</span></div>
        <input type="range" min="-180" max="180" value="${Math.round(o.angle || 0)}" data-rot></div>`,
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
    },
  });
  const b = build();
  openSheet('flip & rotate', b.html, b.wire);
  stack[stack.length - 1].rebuild = build;
}

function sheetMore(o) {
  const html = `
    <button class="srow" data-m="dup">${I.dup}duplicate</button>
    <button class="srow" data-m="fwd">${I.fwd}bring forward</button>
    <button class="srow" data-m="back">${I.back}send backward</button>
    <button class="srow" data-m="lock">${o.pLocked ? I.unlock : I.lock}${o.pLocked ? 'unlock' : 'lock'}</button>
    <button class="srow danger" data-m="del">${I.del}delete</button>`;
  openSheet('layer', html, root => {
    root.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
      const m = b.dataset.m;
      if (m === 'dup') { duplicateObject(o); closeSheet(); }
      if (m === 'fwd') { reorder(o, 'forward'); closeSheet(); }
      if (m === 'back') { reorder(o, 'backward'); closeSheet(); }
      if (m === 'lock') { setLocked(o, !o.pLocked); closeSheet(); }
      if (m === 'del') { deleteObject(o); closeSheet(); }
    }));
  });
}

/* ================= sheet: add shape ================= */

function sheetShapes() {
  const html = `
    <button class="srow" data-k="rect"><svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="4" width="15" height="12"/></svg>rectangle</button>
    <button class="srow" data-k="rounded"><svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="4" width="15" height="12" rx="4"/></svg>rounded rectangle</button>
    <button class="srow" data-k="ellipse"><svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="7"/></svg>circle</button>
    <button class="srow" data-k="line"><svg viewBox="0 0 20 20" width="20" height="20"><path d="M3 16 L17 4"/></svg>line</button>`;
  openSheet('add a shape', html, root => {
    root.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => {
      addShape(b.dataset.k);
      closeSheet();
    }));
  });
}

/* ================= sheet: color ================= */

const NEUTRALS = ['#111110', '#3d3d3a', '#555555', '#999999', '#d9d7d1', '#e8e6e0', '#f8f7f4', '#ffffff'];
const PALETTE = [
  '#cc3333', '#e2582c', '#e8a45c', '#f2d16b', '#7fa650', '#22423b',
  '#3a6156', '#2f6f8f', '#26408b', '#5b3f8c', '#a8447f', '#c97a35',
];

export function sheetColor(title, initial, onChange, opts = {}) {
  let { h, s, v } = hexToHsv(initial || '#111110');
  let current = initial || '#111110';

  const build = () => {
    const docCols = collectDocColors().filter(c => !NEUTRALS.includes(c) && !PALETTE.includes(c));
    const swatch = c =>
      `<button class="sw${c.toLowerCase() === (current || '').toLowerCase() ? ' cur' : ''}" data-c="${c}" style="background:${c}"></button>`;
    const html = `
      <div class="group">
        <div class="swatches">
          ${opts.allowNone ? '<button class="sw none" data-none></button>' : ''}
          ${[...NEUTRALS, ...PALETTE, ...docCols].map(swatch).join('')}
        </div>
      </div>
      <div class="group">
        <div class="lbl"><span>custom</span></div>
        <div class="cp-sq"><span class="cp-dot"></span></div>
        <div class="cp-hue"><span class="cp-mark"></span></div>
        <div class="cp-row">
          <span class="cp-cur" data-cur></span>
          <label class="field" style="flex:1">hex<input data-hex spellcheck="false" autocapitalize="off"></label>
        </div>
        <button class="pill ghost" style="width:100%" data-sample>${'sample a color from the flyer'}</button>
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
            renderBar();
          };
          el.addEventListener('pointermove', mv);
          el.addEventListener('pointerup', up);
        });
      };
      track(sq, (x, y) => { s = x; v = 1 - y; });
      track(hue, x => { h = Math.round(x * 360) % 360; });

      root.querySelectorAll('.sw[data-c]').forEach(b => b.addEventListener('click', () => {
        ({ h, s, v } = hexToHsv(b.dataset.c));
        paint();
        renderBar();
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
        renderBar();
      });
      root.querySelector('[data-sample]').addEventListener('click', () => {
        closeSheet();
        showToast('tap anywhere on the flyer to pick up that color');
        sampling = hex => {
          if (!hex) { showToast("couldn't read that pixel"); return; }
          onChange(hex);
          ed.canvas.requestRenderAll();
          markDirty(true);
          renderBar();
          ({ h, s, v } = hexToHsv(hex));
          current = hex;
          const b2 = build();
          openSheet(title, b2.html, b2.wire, { push: false });
          stack[stack.length - 1].rebuild = build;
          showToast('picked up ' + hex);
        };
      });
    };
    return { html, wire };
  };

  const b = build();
  openSheet(title, b.html, b.wire);
  stack[stack.length - 1].rebuild = build;
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
      <div class="group">
        <div class="lbl"><span>weight${meta.italics ? ' · style' : ''}</span></div>
        <div class="seg" data-wseg>
          ${weights.map(w => `<button data-w="${w}" class="${+o.fontWeight === w ? 'on' : ''}">${w}</button>`).join('')}
          ${meta.italics ? `<button data-i style="font-style:italic" class="${o.fontStyle === 'italic' ? 'on' : ''}">italic</button>` : ''}
        </div>
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
        if (wb || ib) {
          ed.canvas.requestRenderAll();
          markDirty(true);
          refreshSheet();
        }
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
  openSheet('font', b.html, b.wire);
  stack[stack.length - 1].rebuild = build;
}

async function applyFamily(o, family, skipLoad) {
  if (!skipLoad) {
    // fonts come off the network; say so if it isn't instant
    const slow = setTimeout(() => showToast('loading ' + family + '…', 8000), 350);
    try {
      await loadFont(family);
    } catch {
      clearTimeout(slow);
      showToast("couldn't load " + family + ' — check your connection');
      return;
    }
    clearTimeout(slow);
    if ($('#toast').classList.contains('on')) $('#toast').classList.remove('on');
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
  renderBar();
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
          <button class="icon-btn" data-up ${i === 0 ? 'disabled' : ''} title="up">${I.fwd}</button>
          <button class="icon-btn" data-down ${i === objs.length - 1 ? 'disabled' : ''} title="down">${I.back}</button>
          <button class="icon-btn ${o.visible ? 'act-on' : ''}" data-eye>${o.visible ? I.eye : I.eyeOff}</button>
          <button class="icon-btn ${o.pLocked ? 'act-on' : ''}" data-lock>${o.pLocked ? I.lock : I.unlock}</button>
        </span>
      </div>`).join('');

    const html = (objs.length ? rows : '<p class="hint" style="padding:14px 8px">nothing on the flyer yet.</p>') + `
      <div class="lrow" style="opacity:.6">
        <span class="lpick" style="pointer-events:none">
          <span class="lbl" style="width:12px;text-align:center">□</span>
          <span class="thumb" style="background:${ed.bgRect ? ed.bgRect.fill : '#fff'}"></span>
          <span class="lname">background</span>
        </span>
      </div>
      <div class="group" style="margin-top:16px">
        <button class="pill ghost" style="width:100%" data-bg>change background color</button>
      </div>`;

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
        row.querySelector('[data-name]').addEventListener('dblclick', e => {
          e.stopPropagation();
          const el = e.currentTarget;
          el.innerHTML = `<input value="${esc(o.pName || layerName(o))}">`;
          const input = el.querySelector('input');
          input.focus(); input.select();
          const done = () => { o.pName = input.value.trim() || null; markDirty(true); refreshSheet(); };
          input.addEventListener('blur', done);
          input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); });
        });
      });
      root.querySelector('[data-bg]').addEventListener('click', () => {
        sheetColor('background', ed.bgRect ? ed.bgRect.fill : '#ffffff', c => setBg(c));
      });
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
    const curSwap = PRESETS.find(p => p.w === ed.docH && p.h === ed.docW);
    const html = `
      <div class="group">
        <div class="lbl"><span>size</span></div>
        ${PRESETS.map(p => `
          <button class="preset${cur && cur.key === p.key ? ' on' : ''}" data-preset="${p.key}">
            <span class="radio"></span>${p.label}<span class="dim">${p.w} × ${p.h}</span>
          </button>`).join('')}
        <button class="preset${cur ? '' : ' on'}" data-custom>
          <span class="radio"></span>custom<span class="dim">${ed.docW} × ${ed.docH}</span>
        </button>
        <div class="wh">
          <label class="field">w<input id="inW" type="number" inputmode="numeric" value="${ed.docW}"></label>
          <label class="field">h<input id="inH" type="number" inputmode="numeric" value="${ed.docH}"></label>
        </div>
        <div class="rowbtns" style="margin-top:12px">
          <button class="pill ghost" data-swap>${curSwap || cur ? 'swap orientation' : 'swap w / h'}</button>
        </div>
      </div>
      <div class="group">
        <div class="lbl"><span>background</span></div>
        <button class="pill ghost" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px" data-bg>
          <span class="act-dot" style="background:${ed.bgRect ? ed.bgRect.fill : '#fff'}"></span>background color
        </button>
      </div>`;
    const wire = root => {
      root.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
        const p = PRESETS.find(x => x.key === b.dataset.preset);
        if (p) { resizeDoc(p.w, p.h); refreshSheet(); }
      }));
      const w = root.querySelector('#inW'), h = root.querySelector('#inH');
      w.addEventListener('change', () => { resizeDoc(+w.value, ed.docH); refreshSheet(); });
      h.addEventListener('change', () => { resizeDoc(ed.docW, +h.value); refreshSheet(); });
      root.querySelector('[data-swap]').addEventListener('click', () => {
        resizeDoc(ed.docH, ed.docW); refreshSheet();
      });
      root.querySelector('[data-bg]').addEventListener('click', () => {
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
        <p class="hint" style="font-size:11.5px;margin-top:10px;line-height:1.5">
          a project file keeps every layer editable — import it from the home screen to pick up where you left off.
        </p>
      </div>`;
    const wire = root => {
      root.querySelector('[data-scale]').addEventListener('click', e => {
        const b = e.target.closest('[data-s]');
        if (!b || b.disabled) return;
        ed.exportScale = +b.dataset.s;
        refreshSheet();
      });
      root.querySelector('[data-png]').addEventListener('click', async () => {
        showToast('rendering your png…');
        await exportPNG(Math.min(ed.exportScale, maxExportScale()));
        closeSheet();
      });
      root.querySelector('[data-proj]').addEventListener('click', () => {
        saveProjectFile();
        closeSheet();
      });
    };
    return { html, wire };
  };
  const b = build();
  openSheet('export', b.html, b.wire, { push: false });
  stack[stack.length - 1].rebuild = build;
}

export { renderBar };
