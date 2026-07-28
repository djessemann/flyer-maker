// right panel / bottom sheets, popovers, color picker, layers, context menu, toasts
import { on, emit } from './bus.js';
import {
  ed, fabric, PRESETS, layerName, markDirty, pushSnapshot,
  duplicateObject, deleteObject, reorder, moveToIndex, setLocked,
  resizeDoc, setBg, collectDocColors, maxExportScale, exportPNG, saveProjectFile,
  replaceImage, resetImageSize, armShape,
} from './editor.js';
import { fontMeta, loadFont, openFontPicker } from './fonts.js';

const $ = s => document.querySelector(s);
const wideQ = matchMedia('(min-width:1000px) and (orientation:landscape)');
const isWide = () => wideQ.matches;

let panel, overlay, popFont, popColor, popMenu;
let sampling = null;

/* ---------- toast ---------- */
let toastTimer = null;
export function showToast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

/* ---------- popover base ---------- */
function openPop(pop, anchor) {
  closePops();
  pop.classList.add('open');
  if (isWide() && anchor) {
    const a = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = a.left - pw - 12;                    // prefer left of the anchor (panel controls)
    if (x < 8) x = Math.min(a.right + 12, innerWidth - pw - 8);
    let y = Math.min(a.top, innerHeight - ph - 8);
    pop.style.left = Math.max(8, x) + 'px';
    pop.style.top = Math.max(60, y) + 'px';
    pop.style.right = 'auto'; pop.style.bottom = 'auto';
  } else if (!isWide()) {
    pop.style.left = ''; pop.style.top = ''; pop.style.right = ''; pop.style.bottom = '';
  }
}
export function closePops() {
  document.querySelectorAll('.pop').forEach(p => p.classList.remove('open'));
}
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.pop') && !e.target.closest('[data-keeppop]')) closePops();
});

/* ---------- panel / sheet ---------- */
export function openPanelTab(name, toggle = false) {
  const tab = panel.querySelector(`[data-pane="pane-${name}"]`);
  if (isWide()) {
    if (toggle && tab.classList.contains('on') && !panel.classList.contains('collapsed')) {
      panel.classList.add('collapsed');
      return;
    }
    panel.classList.remove('collapsed');
  } else {
    panel.classList.add('open');
    overlay.classList.add('on');
  }
  panel.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t === tab));
  panel.querySelectorAll('.tabpane').forEach(p =>
    p.classList.toggle('on', p.id === 'pane-' + name));
  if (name === 'canvas') renderCanvasTab();
  if (name === 'style') renderStyle();
  if (name === 'layers') renderLayers();
}
export function closeSheet() {
  panel.classList.remove('open');
  overlay.classList.remove('on');
}

/* ---------- init ---------- */
export function initPanels() {
  panel = $('#panel'); overlay = $('#overlay');
  popFont = $('#popFont'); popColor = $('#popColor'); popMenu = $('#popMenu');

  panel.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => openPanelTab(t.dataset.pane.replace('pane-', ''), true)));
  panel.querySelector('.grab').addEventListener('click', closeSheet);
  overlay.addEventListener('click', closeSheet);
  wideQ.addEventListener('change', () => {
    closeSheet(); closePops();
    if (isWide()) panel.classList.remove('collapsed');
  });

  $('#pillLayers').addEventListener('click', () => openPanelTab('layers'));
  $('#pillLayersPhone').addEventListener('click', () => openPanelTab('layers'));

  wireCanvasTab();
  wireContextMenu();

  on('selection', () => { renderStyle(); renderLayers(); });
  on('layers', () => { renderLayers(); renderCanvasTab(); });
  on('doc:open', () => { renderLayers(); renderCanvasTab(); if (isWide()) openPanelTab('layers'); });
  on('doc:change', renderCanvasTab);
  on('toast', showToast);
}

/* ================= layers ================= */

const GLYPH = { text: 'T', rect: '▢', rounded: '▢', ellipse: '▢', line: '▢', image: '▣', bg: '□' };
const EYE = '<svg width="15" height="15" viewBox="0 0 15 15"><path d="M1.5 7.5 C3.5 4.5 5.5 3 7.5 3 s4 1.5 6 4.5 c-2 3-4 4.5-6 4.5 s-4-1.5-6-4.5 Z"/><circle cx="7.5" cy="7.5" r="1.6"/></svg>';
const LOCK = '<svg width="15" height="15" viewBox="0 0 15 15"><rect x="3.5" y="6.5" width="8" height="6"/><path d="M5 6.5 V4.5 a2.5 2.5 0 0 1 5 0 V6.5"/></svg>';

function layerObjects() {          // top of stack first, bg excluded
  return ed.canvas.getObjects().filter(o => o.pKind !== 'bg').reverse();
}

function thumbFor(o) {
  if (o.pKind === 'image') {
    const src = o._element && o._element.src;
    if (o.__thumb && o.__thumbKey === src) return o.__thumb;
    try {
      const t = `<div class="thumb" style="background-image:url('${o.toDataURL({ multiplier: Math.min(1, 60 / Math.max(o.width, o.height)) })}')"></div>`;
      o.__thumb = t; o.__thumbKey = src;
      return t;
    } catch { return '<div class="thumb">▣</div>'; }
  }
  if (o.pKind === 'text') {
    const ch = (o.text || 'a').trim().charAt(0) || 'a';
    return `<div class="thumb" style="font-family:'${o.fontFamily}',var(--mono)">${escapeHtml(ch)}</div>`;
  }
  const c = o.pKind === 'line' ? o.stroke : o.fill;
  return `<div class="thumb" style="background:${c || '#fff'}"></div>`;
}

function renderLayers() {
  if (!ed.open) return;
  const objs = layerObjects();
  const active = ed.canvas.getActiveObject();

  $('#pillCount').textContent = objs.length;
  $('#pillCountPhone').textContent = objs.length;
  $('#layerCount').textContent = `${objs.length + 1} layers`;

  // selected-layer block
  const sb = $('#selBlock');
  if (active && active.pKind !== 'bg') {
    sb.innerHTML = `
      <div class="group">
        <div class="lbl"><span>opacity</span><span class="val">${Math.round((active.opacity ?? 1) * 100)}</span></div>
        <input type="range" min="0" max="100" value="${Math.round((active.opacity ?? 1) * 100)}" id="selOpacity">
        <div class="sel-actions">
          <button class="icon-btn" data-act="dup" title="duplicate"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="5" y="5" width="9" height="9"/><path d="M11 2 H2 V11"/></svg></button>
          <button class="icon-btn" data-act="fwd" title="bring forward"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 13 V3 M4 7 L8 3 L12 7"/></svg></button>
          <button class="icon-btn" data-act="back" title="send backward"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 3 V13 M4 9 L8 13 L12 9"/></svg></button>
          <div class="spacer"></div>
          <button class="icon-btn del" data-act="del" title="delete"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 4.5 H13 M6.5 4.5 V3 H9.5 V4.5 M4.5 4.5 L5.2 13.5 H10.8 L11.5 4.5"/></svg></button>
        </div>
      </div>`;
    const op = sb.querySelector('#selOpacity');
    op.addEventListener('input', () => {
      active.set('opacity', op.value / 100);
      sb.querySelector('.val').textContent = op.value;
      ed.canvas.requestRenderAll();
      markDirty(true);
    });
    sb.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'dup') duplicateObject(active);
      if (act === 'del') deleteObject(active);
      if (act === 'fwd') reorder(active, 'forward');
      if (act === 'back') reorder(active, 'backward');
    }));
  } else {
    sb.innerHTML = '';
  }

  // rows
  const list = $('#layerList');
  const rows = objs.map((o, i) => `
    <div class="lrow${o === active ? ' on' : ''}" data-i="${i}">
      <span class="glyph">${GLYPH[o.pKind] || '▢'}</span>
      ${thumbFor(o)}
      <div class="lname" data-name>${escapeHtml(layerName(o))}</div>
      <div class="lmeta">
        <button class="icon-btn${o.visible ? ' faint' : ''}" data-eye title="visibility">${EYE}</button>
        <button class="icon-btn${o.pLocked ? '' : ' faint'}" data-lock title="lock">${LOCK}</button>
      </div>
    </div>`).join('');
  list.innerHTML = rows + `
    <div class="lrow" data-bg>
      <span class="glyph">□</span>
      <div class="thumb" style="background:${ed.bgRect ? ed.bgRect.fill : '#fff'}"></div>
      <div class="lname">background</div>
      <div class="lmeta"><span class="icon-btn faint">${LOCK}</span></div>
    </div>`;

  list.querySelectorAll('.lrow[data-i]').forEach(row => wireLayerRow(row, objs));
  const bgRow = list.querySelector('[data-bg]');
  bgRow.addEventListener('click', () => openPanelTab('canvas'));
}

function wireLayerRow(row, objs) {
  const o = objs[+row.dataset.i];

  row.querySelector('[data-eye]').addEventListener('click', e => {
    e.stopPropagation();
    o.set('visible', !o.visible);
    ed.canvas.requestRenderAll();
    markDirty(true);
    renderLayers();
  });
  row.querySelector('[data-lock]').addEventListener('click', e => {
    e.stopPropagation();
    setLocked(o, !o.pLocked);
  });
  row.addEventListener('click', () => {
    if (o.pLocked) { showToast('layer is locked'); return; }
    ed.canvas.setActiveObject(o);
    ed.canvas.requestRenderAll();
  });
  row.querySelector('[data-name]').addEventListener('dblclick', e => {
    e.stopPropagation();
    const el = e.currentTarget;
    el.innerHTML = `<input value="${escapeHtml(o.pName || layerName(o))}">`;
    const input = el.querySelector('input');
    input.focus(); input.select();
    const done = () => {
      o.pName = input.value.trim() || null;
      markDirty(true);
      renderLayers();
    };
    input.addEventListener('blur', done);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); });
  });

  // pointer drag to reorder
  row.addEventListener('pointerdown', e => {
    if (e.target.closest('button,input')) return;
    const list = row.parentElement;
    const startY = e.clientY;
    let dragging = false;
    const move = ev => {
      if (!dragging && Math.abs(ev.clientY - startY) > 8) {
        dragging = true;
        row.classList.add('dragging');
        row.setPointerCapture(e.pointerId);
      }
      if (!dragging) return;
      ev.preventDefault();
      const rows = [...list.querySelectorAll('.lrow[data-i]')].filter(r => r !== row);
      const after = rows.find(r => ev.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
      if (after) list.insertBefore(row, after);
      else if (rows.length) list.insertBefore(row, rows[rows.length - 1].nextSibling);
    };
    const up = () => {
      row.removeEventListener('pointermove', move);
      row.removeEventListener('pointerup', up);
      row.removeEventListener('pointercancel', up);
      if (!dragging) return;
      row.classList.remove('dragging');
      const order = [...list.querySelectorAll('.lrow[data-i]')];
      const visIdx = order.indexOf(row);
      // list is top-first; fabric index is bottom-first (bg at 0)
      const objCount = ed.canvas.getObjects().length;
      moveToIndex(o, objCount - 1 - visIdx);
    };
    row.addEventListener('pointermove', move);
    row.addEventListener('pointerup', up);
    row.addEventListener('pointercancel', up);
  });
}

/* ================= style ================= */

function renderStyle() {
  if (!ed.open) return;
  const pane = $('#pane-style');
  const o = ed.canvas.getActiveObject();
  if (!o || o.pKind === 'bg') {
    pane.innerHTML = `<p class="hint" style="font-size:13.5px;line-height:1.6">select something, or add text / shapes / an image from the ${isWide() ? 'left' : 'toolbar'}.</p>`;
    return;
  }
  if (o.type === 'activeselection') {
    pane.innerHTML = `<p class="hint" style="font-size:13.5px">multiple layers selected.</p>`;
    return;
  }
  if (o.pKind === 'text') return renderTextStyle(pane, o);
  if (o.pKind === 'image') return renderImageStyle(pane, o);
  renderShapeStyle(pane, o);
}

const sw = (color, cur) => `<button class="sw${cur ? ' cur' : ''}" data-c="${color}" style="background:${color}"></button>`;
function swatchRow(current, extra = []) {
  const base = [...new Set([current, '#111110', '#f8f7f4', '#ffffff', ...collectDocColors(), ...extra])]
    .filter(Boolean).slice(0, 8);
  return base.map(c => sw(c, c.toLowerCase() === (current || '').toLowerCase())).join('')
    + '<button class="sw add" data-pick>+</button>';
}

function opacityGroup(o) {
  return `<div class="group"><div class="lbl"><span>opacity</span><span class="val" data-out="op">${Math.round((o.opacity ?? 1) * 100)}</span></div>
    <input type="range" min="0" max="100" value="${Math.round((o.opacity ?? 1) * 100)}" data-in="op"></div>`;
}
function wireOpacity(pane, o) {
  const r = pane.querySelector('[data-in="op"]');
  if (!r) return;
  r.addEventListener('input', () => {
    o.set('opacity', r.value / 100);
    pane.querySelector('[data-out="op"]').textContent = r.value;
    ed.canvas.requestRenderAll();
    markDirty(true);
  });
}

function renderTextStyle(pane, o) {
  const meta = fontMeta(o.fontFamily);
  const weights = meta.weights && meta.weights.length ? meta.weights : [400];
  pane.innerHTML = `
    <div class="group"><div class="lbl"><span>font</span></div>
      <button class="field" data-font style="width:100%;font-family:'${o.fontFamily}',var(--mono)">${o.fontFamily}<span class="cara">▾</span></button></div>
    <div class="group"><div class="lbl"><span>size</span></div>
      <div class="stepper"><button data-sz="-1">–</button><input class="num" data-szin inputmode="numeric" value="${Math.round(o.fontSize)}"><button data-sz="1">+</button></div></div>
    <div class="group"><div class="lbl"><span>weight · style</span></div>
      <div class="seg" data-wseg>
        ${weights.map(w => `<button data-w="${w}"${+o.fontWeight === w ? ' class="on"' : ''}>${w}</button>`).join('')}
        ${meta.italics ? `<button data-i style="font-style:italic"${o.fontStyle === 'italic' ? ' class="on"' : ''}>i</button>` : ''}
      </div></div>
    <div class="group"><div class="lbl"><span>fill</span></div>
      <div class="swatches" data-fill>${swatchRow(o.fill)}</div></div>
    <div class="group"><div class="lbl"><span>align</span></div>
      <div class="seg" data-align>
        <button data-a="left"${o.textAlign === 'left' ? ' class="on"' : ''}><svg width="15" height="15" viewBox="0 0 15 15"><path d="M2 3.5 H13 M2 7.5 H9 M2 11.5 H11"/></svg></button>
        <button data-a="center"${o.textAlign === 'center' ? ' class="on"' : ''}><svg width="15" height="15" viewBox="0 0 15 15"><path d="M2 3.5 H13 M4 7.5 H11 M3 11.5 H12"/></svg></button>
        <button data-a="right"${o.textAlign === 'right' ? ' class="on"' : ''}><svg width="15" height="15" viewBox="0 0 15 15"><path d="M2 3.5 H13 M6 7.5 H13 M4 11.5 H13"/></svg></button>
      </div></div>
    <div class="group"><div class="lbl"><span>line height</span><span class="val" data-out="lh">${(o.lineHeight ?? 1.16).toFixed(2)}</span></div>
      <input type="range" min="80" max="200" value="${Math.round((o.lineHeight ?? 1.16) * 100)}" data-in="lh"></div>
    <div class="group"><div class="lbl"><span>letter spacing</span><span class="val" data-out="ls">${((o.charSpacing || 0) / 1000).toFixed(2)}em</span></div>
      <input type="range" min="-50" max="500" value="${o.charSpacing || 0}" data-in="ls"></div>
    ${opacityGroup(o)}`;

  pane.querySelector('[data-font]').addEventListener('click', e => {
    openFontPickerPop(e.currentTarget, o);
  });
  const szin = pane.querySelector('[data-szin]');
  const setSize = v => {
    const s = Math.max(8, Math.min(400, Math.round(v) || o.fontSize));
    o.set('fontSize', s); szin.value = s;
    ed.canvas.requestRenderAll(); markDirty(true);
  };
  pane.querySelectorAll('[data-sz]').forEach(b =>
    b.addEventListener('click', () => setSize(+szin.value + +b.dataset.sz * 2)));
  szin.addEventListener('change', () => setSize(+szin.value));

  pane.querySelector('[data-wseg]').addEventListener('click', async e => {
    const wb = e.target.closest('[data-w]');
    const ib = e.target.closest('[data-i]');
    if (wb) {
      o.set('fontWeight', +wb.dataset.w);
      pane.querySelectorAll('[data-w]').forEach(b => b.classList.toggle('on', b === wb));
    }
    if (ib) {
      const it = o.fontStyle === 'italic' ? 'normal' : 'italic';
      o.set('fontStyle', it);
      ib.classList.toggle('on', it === 'italic');
    }
    ed.canvas.requestRenderAll(); markDirty(true);
  });

  wireSwatches(pane.querySelector('[data-fill]'), 'fill', o.fill, c => {
    o.set('fill', c); ed.canvas.requestRenderAll(); markDirty(true);
  });

  pane.querySelector('[data-align]').addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    o.set('textAlign', b.dataset.a);
    pane.querySelectorAll('[data-a]').forEach(x => x.classList.toggle('on', x === b));
    ed.canvas.requestRenderAll(); markDirty(true);
  });

  const lh = pane.querySelector('[data-in="lh"]');
  lh.addEventListener('input', () => {
    o.set('lineHeight', lh.value / 100);
    pane.querySelector('[data-out="lh"]').textContent = (lh.value / 100).toFixed(2);
    ed.canvas.requestRenderAll(); markDirty(true);
  });
  const ls = pane.querySelector('[data-in="ls"]');
  ls.addEventListener('input', () => {
    o.set('charSpacing', +ls.value);
    pane.querySelector('[data-out="ls"]').textContent = (ls.value / 1000).toFixed(2) + 'em';
    ed.canvas.requestRenderAll(); markDirty(true);
  });
  wireOpacity(pane, o);
}

function renderShapeStyle(pane, o) {
  const isLine = o.pKind === 'line';
  const isRect = o.pKind === 'rect' || o.pKind === 'rounded';
  pane.innerHTML = `
    ${isLine ? '' : `<div class="group"><div class="lbl"><span>fill</span></div>
      <div class="swatches" data-fill>${swatchRow(o.fill)}</div></div>`}
    <div class="group"><div class="lbl"><span>stroke</span></div>
      <div class="swatches" data-stroke>${o.stroke ? '' : '<button class="sw none cur" data-none></button>'}${swatchRow(o.stroke || '#111110')}</div></div>
    <div class="group"><div class="lbl"><span>stroke width</span></div>
      <div class="stepper"><button data-st="-1">–</button><div class="num" data-stout>${o.strokeWidth || 0}</div><button data-st="1">+</button></div></div>
    ${isRect ? `<div class="group"><div class="lbl"><span>corner radius</span><span class="val" data-out="rx">${Math.round(o.rx || 0)}</span></div>
      <input type="range" min="0" max="200" value="${Math.round(o.rx || 0)}" data-in="rx"></div>` : ''}
    ${opacityGroup(o)}`;

  if (!isLine) {
    wireSwatches(pane.querySelector('[data-fill]'), 'fill', o.fill, c => {
      o.set('fill', c); ed.canvas.requestRenderAll(); markDirty(true);
    });
  }
  const strokeBox = pane.querySelector('[data-stroke]');
  wireSwatches(strokeBox, 'stroke', o.stroke || '#111110', c => {
    o.set('stroke', c);
    if (!o.strokeWidth) o.set('strokeWidth', 2);
    ed.canvas.requestRenderAll(); markDirty(true); renderStyle();
  });
  const noneBtn = strokeBox.querySelector('[data-none]');
  if (noneBtn) noneBtn.addEventListener('click', () => {
    o.set({ stroke: null, strokeWidth: 0 });
    ed.canvas.requestRenderAll(); markDirty(true); renderStyle();
  });

  const stout = pane.querySelector('[data-stout]');
  pane.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => {
    const w = Math.max(0, Math.min(24, (o.strokeWidth || 0) + +b.dataset.st));
    o.set('strokeWidth', w);
    if (w === 0 && !isLine) o.set('stroke', null);
    stout.textContent = w;
    o.setCoords(); ed.canvas.requestRenderAll(); markDirty(true);
  }));

  const rx = pane.querySelector('[data-in="rx"]');
  if (rx) rx.addEventListener('input', () => {
    o.set({ rx: +rx.value, ry: +rx.value });
    pane.querySelector('[data-out="rx"]').textContent = rx.value;
    ed.canvas.requestRenderAll(); markDirty(true);
  });
  wireOpacity(pane, o);
}

function renderImageStyle(pane, o) {
  pane.innerHTML = `
    ${opacityGroup(o)}
    <div class="group"><div class="lbl"><span>flip</span></div>
      <div class="seg"><button data-fh>horizontal</button><button data-fv>vertical</button></div></div>
    <div class="group"><div class="lbl"><span>image</span></div>
      <div class="rowbtns">
        <button class="pill ghost" data-replace>replace image</button>
        <button class="pill ghost" data-reset>reset size</button>
      </div></div>
    <div class="group">
      <button class="pill" style="width:100%;padding:12px 0" data-retouch>retouch</button>
    </div>`;
  wireOpacity(pane, o);
  pane.querySelector('[data-fh]').addEventListener('click', () => {
    o.set('flipX', !o.flipX); ed.canvas.requestRenderAll(); markDirty(true);
  });
  pane.querySelector('[data-fv]').addEventListener('click', () => {
    o.set('flipY', !o.flipY); ed.canvas.requestRenderAll(); markDirty(true);
  });
  pane.querySelector('[data-replace]').addEventListener('click', () => {
    const input = $('#fileImage');
    input.onchange = async () => {
      if (input.files[0]) await replaceImage(o, input.files[0]);
      input.value = '';
      renderStyle();
    };
    input.click();
  });
  pane.querySelector('[data-reset]').addEventListener('click', () => resetImageSize(o));
  pane.querySelector('[data-retouch]').addEventListener('click', () => {
    closeSheet();
    emit('retouch:open', o);
  });
}

function wireSwatches(box, kind, current, apply) {
  if (!box) return;
  box.addEventListener('click', e => {
    const s = e.target.closest('[data-c]');
    if (s) {
      apply(s.dataset.c);
      box.querySelectorAll('.sw').forEach(x => x.classList.toggle('cur', x === s));
      return;
    }
    if (e.target.closest('[data-pick]')) {
      openColorPicker(kind, current, apply, e.target);
    }
  });
}

/* ================= color picker ================= */

export function openColorPicker(title, initial, onChange, anchor) {
  const pop = popColor;
  let { h, s, v } = hexToHsv(initial || '#111110');

  pop.innerHTML = `
    <div class="pop-head">${title}<button class="icon-btn" data-x><svg width="13" height="13" viewBox="0 0 14 14"><path d="M3 3 L11 11 M11 3 L3 11"/></svg></button></div>
    <div class="cp-body">
      <div class="cp-sq"><span class="cp-dot"></span></div>
      <div class="cp-hue"><span class="cp-mark"></span></div>
      <div class="cp-row">
        <div class="sw" data-cur></div>
        <label class="field" style="flex:1">hex<input data-hex spellcheck="false"></label>
      </div>
      <div class="swatches" data-swl></div>
      <button class="pill ghost" data-sample>sample from canvas</button>
    </div>`;
  openPop(pop, anchor);

  const sq = pop.querySelector('.cp-sq'), dot = pop.querySelector('.cp-dot');
  const hue = pop.querySelector('.cp-hue'), mark = pop.querySelector('.cp-mark');
  const hexIn = pop.querySelector('[data-hex]'), cur = pop.querySelector('[data-cur]');
  const swl = pop.querySelector('[data-swl]');

  const NEUTRALS = ['#111110', '#555555', '#999999', '#d9d7d1', '#e8e6e0', '#f8f7f4', '#ffffff'];
  const docCols = collectDocColors().filter(c => !NEUTRALS.includes(c)).slice(0, 5);
  swl.innerHTML = [...NEUTRALS, ...docCols].map(c => sw(c, false)).join('');

  const paint = (fire = true) => {
    const hex = hsvToHex(h, s, v);
    sq.style.background = `linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,hsl(${h},100%,50%))`;
    dot.style.left = (s * 100) + '%';
    dot.style.top = ((1 - v) * 100) + '%';
    dot.style.background = hex;
    mark.style.left = (h / 360 * 100) + '%';
    mark.style.background = `hsl(${h},100%,50%)`;
    cur.style.background = hex;
    if (document.activeElement !== hexIn) hexIn.value = hex;
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
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
    });
  };
  track(sq, (x, y) => { s = x; v = 1 - y; });
  track(hue, x => { h = Math.round(x * 360) % 360; });

  hexIn.addEventListener('change', () => {
    const m = hexIn.value.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (!m) return;
    ({ h, s, v } = hexToHsv('#' + m[1]));
    paint();
  });
  swl.addEventListener('click', e => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    ({ h, s, v } = hexToHsv(b.dataset.c));
    paint();
  });
  pop.querySelector('[data-x]').addEventListener('click', closePops);
  pop.querySelector('[data-sample]').addEventListener('click', () => {
    closePops(); closeSheet();
    showToast('tap the canvas to sample a color');
    sampling = hex => { onChange(hex); showToast('sampled ' + hex); };
  });
}

// one canvas-level listener reads pixels while sampling
export function initSampling() {
  ed.canvas.on('mouse:down', opt => {
    if (!sampling) return;
    const el = ed.canvas.lowerCanvasEl;
    const r = el.getBoundingClientRect();
    const e = opt.e.touches ? opt.e.touches[0] || opt.e.changedTouches[0] : opt.e;
    const x = Math.round((e.clientX - r.left) * (el.width / r.width));
    const y = Math.round((e.clientY - r.top) * (el.height / r.height));
    try {
      const d = el.getContext('2d').getImageData(x, y, 1, 1).data;
      sampling('#' + [d[0], d[1], d[2]].map(n => n.toString(16).padStart(2, '0')).join(''));
    } catch {}
    sampling = null;
  });
}

function hexToHsv(hex) {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const r = parseInt(full.slice(0, 2), 16) / 255,
        g = parseInt(full.slice(2, 4), 16) / 255,
        b = parseInt(full.slice(4, 6), 16) / 255;
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

/* ================= font picker popover ================= */

async function openFontPickerPop(anchor, obj) {
  await openFontPicker(popFont, obj.fontFamily, async family => {
    closePops();
    try {
      await loadFont(family);
    } catch {
      showToast("couldn't load that font — offline?");
      return;
    }
    const meta = fontMeta(family);
    const weights = meta.weights || [400];
    const w = weights.includes(+obj.fontWeight) ? +obj.fontWeight
      : weights.reduce((a, b) => Math.abs(b - 400) < Math.abs(a - 400) ? b : a);
    obj.set({ fontFamily: family, fontWeight: w });
    if (!meta.italics) obj.set('fontStyle', 'normal');
    try { fabric.cache.clearFontCache(); } catch {}
    obj.initDimensions();
    ed.canvas.requestRenderAll();
    markDirty(true);
    renderStyle(); renderLayers();
  });
  openPop(popFont, anchor);
  popFont.querySelector('[data-x]').addEventListener('click', closePops);
}

/* ================= shape + context menus ================= */

export function openShapeMenu(anchor) {
  popMenu.innerHTML = `<div class="menu">
    <button class="srow" data-k="rect"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9"/></svg>rectangle</button>
    <button class="srow" data-k="rounded"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="3"/></svg>rounded</button>
    <button class="srow" data-k="ellipse"><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/></svg>ellipse</button>
    <button class="srow" data-k="line"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 13 L13 3"/></svg>line</button>
  </div>`;
  popMenu.classList.add('open');
  if (isWide() || innerWidth >= 700) {
    const a = anchor.getBoundingClientRect();
    popMenu.style.left = (a.right + 10) + 'px';
    popMenu.style.top = Math.min(a.top, innerHeight - 220) + 'px';
    popMenu.style.right = 'auto'; popMenu.style.bottom = 'auto';
  }
  popMenu.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => {
    closePops();
    armShape(b.dataset.k);
    showToast('tap the canvas to place');
  }));
}

function wireContextMenu() {
  const canvas = ed.canvas;
  let timer = null, sx = 0, sy = 0, target = null;

  canvas.on('mouse:down', opt => {
    if (!opt.target || opt.target.pKind === 'bg') return;
    const e = opt.e.touches ? opt.e.touches[0] : opt.e;
    sx = e.clientX; sy = e.clientY; target = opt.target;
    clearTimeout(timer);
    timer = setTimeout(() => {
      canvas._currentTransform = null;
      openContextMenu(target, sx, sy);
    }, 550);
  });
  canvas.on('mouse:move', opt => {
    if (!timer) return;
    const e = opt.e.touches ? opt.e.touches[0] : opt.e;
    if (e && Math.hypot(e.clientX - sx, e.clientY - sy) > 9) { clearTimeout(timer); timer = null; }
  });
  canvas.on('mouse:up', () => { clearTimeout(timer); timer = null; });
}

function openContextMenu(obj, x, y) {
  popMenu.innerHTML = `<div class="menu">
    <button class="srow" data-a="dup"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="5" y="5" width="9" height="9"/><path d="M11 2 H2 V11"/></svg>duplicate</button>
    <button class="srow" data-a="fwd"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 13 V3 M4 7 L8 3 L12 7"/></svg>bring forward</button>
    <button class="srow" data-a="back"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 3 V13 M4 9 L8 13 L12 9"/></svg>send backward</button>
    <button class="srow danger" data-a="del"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 4.5 H13 M6.5 4.5 V3 H9.5 V4.5 M4.5 4.5 L5.2 13.5 H10.8 L11.5 4.5"/></svg>delete</button>
  </div>`;
  popMenu.classList.add('open');
  if (innerWidth >= 700) {
    popMenu.style.left = Math.min(x, innerWidth - 200) + 'px';
    popMenu.style.top = Math.min(y, innerHeight - 230) + 'px';
    popMenu.style.right = 'auto'; popMenu.style.bottom = 'auto';
  }
  popMenu.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
    closePops();
    const a = b.dataset.a;
    if (a === 'dup') duplicateObject(obj);
    if (a === 'del') deleteObject(obj);
    if (a === 'fwd') reorder(obj, 'forward');
    if (a === 'back') reorder(obj, 'backward');
  }));
}

/* ================= canvas tab ================= */

function wireCanvasTab() {
  const inW = $('#inW'), inH = $('#inH');
  $('#btnSwap').addEventListener('click', () => resizeDoc(ed.docH, ed.docW));
  inW.addEventListener('change', () => resizeDoc(+inW.value, ed.docH));
  inH.addEventListener('change', () => resizeDoc(ed.docW, +inH.value));
  $('#segScale').addEventListener('click', e => {
    const b = e.target.closest('[data-s]');
    if (!b || b.disabled) return;
    ed.exportScale = +b.dataset.s;
    renderCanvasTab();
  });
  $('#btnExport').addEventListener('click', async () => {
    showToast('exporting…');
    await exportPNG(Math.min(ed.exportScale, maxExportScale()));
  });
  $('#btnSaveFile').addEventListener('click', saveProjectFile);
  $('#presets').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const p = PRESETS.find(x => x.key === b.dataset.preset);
    if (p) resizeDoc(p.w, p.h);
  });
  $('#bgSwatches').addEventListener('click', e => {
    const s = e.target.closest('[data-c]');
    if (s) { setBg(s.dataset.c); renderCanvasTab(); return; }
    if (e.target.closest('[data-pick]')) {
      openColorPicker('background', ed.bgRect.fill, c => { setBg(c); }, e.target);
    }
  });
}

function renderCanvasTab() {
  if (!ed.open) return;
  const cur = PRESETS.find(p => (p.w === ed.docW && p.h === ed.docH) || (p.w === ed.docH && p.h === ed.docW));
  $('#presets').innerHTML = PRESETS.map(p => `
    <button class="preset${cur && cur.key === p.key ? ' on' : ''}" data-preset="${p.key}">
      <span class="radio"></span>${p.label}<span class="dim">${p.w} × ${p.h}</span>
    </button>`).join('') + `
    <button class="preset${cur ? '' : ' on'}" data-custom><span class="radio"></span>custom</button>`;
  $('#inW').value = ed.docW;
  $('#inH').value = ed.docH;
  const bg = ed.bgRect ? ed.bgRect.fill : '#ffffff';
  $('#bgSwatches').innerHTML =
    [...new Set([bg, '#ffffff', '#f8f7f4', '#111110'])].map(c => sw(c, c === bg)).join('')
    + '<button class="sw add" data-pick>+</button>';
  const maxS = maxExportScale();
  $('#segScale').querySelectorAll('[data-s]').forEach(b => {
    b.disabled = +b.dataset.s > maxS;
    b.classList.toggle('on', +b.dataset.s === Math.min(ed.exportScale, maxS));
  });
  const s = Math.min(ed.exportScale, maxS);
  $('#btnExport').textContent = `export png · ${ed.docW * s} × ${ed.docH * s}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
