// eraser: rub parts of a photo away to nothing, so whatever is behind shows
// through. What you see while you drag is what you get — no engine deciding
// what should have been there, nothing to wait for, nothing to be wrong about.
//
// This replaced two attempts at filling the hole back in (Telea, then PatchMatch
// content-aware fill). Both worked on the cases they were measured against and
// both produced a visible smear on real photographs. See docs/ui-revision.md
// round 9. Don't put a fill back without reading it.
import { on } from './bus.js';
import { ed, swapImageSource } from './editor.js';
import { showToast } from './ui.js';

const $ = s => document.querySelector(s);
const HINT = 'rub out the parts you don’t want';

let obj = null;          // fabric image being erased
let work = null;         // full-res working pixels, with alpha
let original = null;     // the pixels we started with, for clear + cancel
let history = [];        // one snapshot per stroke
let fitScale = 1, brushPct = 12, dirty = false;
let zoom = 1, panX = 0, panY = 0;

// brush size as a share of the photo's short side rather than screen pixels: on
// a 4096px photo, a fixed screen-pixel brush would rub out a huge area at once
const brushImagePx = () => Math.max(2, Math.round(Math.min(work.width, work.height) * brushPct / 100));

export function initRetouch() {
  on('retouch:open', open);
  // an undo replaces every object; the image we were erasing is detached
  on('doc:restored', () => {
    if ($('#retouch').classList.contains('on')) {
      close();
      showToast('erase closed — that photo was undone');
    }
  });
  $('#rtCancel').addEventListener('click', () => {
    close();
    if (dirty) showToast('nothing erased');
  });
  $('#rtDone').addEventListener('click', apply);
  $('#rtClear').addEventListener('click', restoreAll);
  $('#rtUndo').addEventListener('click', undoStroke);

  const size = $('#rtSize');
  size.addEventListener('input', () => { brushPct = +size.value / 10; drawDot(); });

  $('#rtZoom').addEventListener('click', e => {
    const b = e.target.closest('[data-z]');
    if (!b || !work) return;
    if (b.dataset.z === 'fit') setZoom(1, true);
    else setZoom(zoom * (b.dataset.z === 'in' ? 1.6 : 1 / 1.6));
  });

  wireErasing();
  wireViewGestures();
  drawDot();
  addEventListener('resize', () => { if ($('#retouch').classList.contains('on')) layout(); });
}

/* ---------------- view ---------------- */

function setZoom(z, recentre = false) {
  const max = Math.max(4, 1 / fitScale);   // 1/fitScale is 100% of the real pixels
  zoom = Math.max(1, Math.min(max, z));
  if (recentre || zoom === 1) { panX = 0; panY = 0; }
  applyView();
}

function applyView() {
  const stage = $('#rtStage'), wrap = $('#rtWrap');
  const slackX = Math.max(0, (wrap.clientWidth * zoom - stage.clientWidth) / 2 + 40);
  const slackY = Math.max(0, (wrap.clientHeight * zoom - stage.clientHeight) / 2 + 40);
  panX = Math.max(-slackX, Math.min(slackX, panX));
  panY = Math.max(-slackY, Math.min(slackY, panY));
  wrap.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
  $('#rtZoomVal').textContent = zoom === 1 ? 'fit' : Math.round(fitScale * zoom * 100) + '%';
  drawDot();
}

// two fingers pan and pinch; one finger erases (see wireErasing)
function wireViewGestures() {
  const stage = $('#rtStage');
  const pts = new Map();
  let base = null;

  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || !work) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      // the first finger may have started rubbing — take that stroke back,
      // this is a pinch
      if (cancelStroke()) undoStroke();
      const [a, b] = [...pts.values()];
      base = { d: dist(a, b), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, zoom, panX, panY };
    }
  });

  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size !== 2 || !base) return;
    e.preventDefault();
    const [a, b] = [...pts.values()];
    zoom = Math.max(1, Math.min(Math.max(4, 1 / fitScale), base.zoom * (dist(a, b) / (base.d || 1))));
    panX = base.panX + ((a.x + b.x) / 2 - base.cx);
    panY = base.panY + ((a.y + b.y) / 2 - base.cy);
    applyView();
  });

  const drop = e => { pts.delete(e.pointerId); if (pts.size < 2) base = null; };
  stage.addEventListener('pointerup', drop);
  stage.addEventListener('pointercancel', drop);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// the dot previews the brush at its size on screen, up to the space available
function drawDot() {
  const d = $('#rtDot');
  const px = work ? brushImagePx() * fitScale * zoom : brushPct * 3;
  const s = Math.max(6, Math.min(40, px));
  d.style.width = s + 'px';
  d.style.height = s + 'px';
  const label = $('#rtBrushVal');
  if (label && work) label.textContent = brushImagePx() + 'px';
}

/* ---------------- open / layout ---------------- */

function open(image) {
  obj = image;
  const el = obj && obj._element;
  if (!el) { showToast('select a photo first'); return; }

  work = document.createElement('canvas');
  work.width = el.naturalWidth || el.width;
  work.height = el.naturalHeight || el.height;
  work.getContext('2d').drawImage(el, 0, 0, work.width, work.height);

  original = document.createElement('canvas');
  original.width = work.width; original.height = work.height;
  original.getContext('2d').drawImage(work, 0, 0);

  history = [];
  dirty = false;
  zoom = 1; panX = 0; panY = 0;
  $('#retouch').classList.add('on');
  $('#rtHint').textContent = HINT;
  layout();
}

function layout() {
  const stage = $('#rtStage');
  const pad = 20;
  fitScale = Math.min(
    (stage.clientWidth - pad * 2) / work.width,
    (stage.clientHeight - pad * 2) / work.height, 1) || 1;
  const wrap = $('#rtWrap');
  wrap.style.width = Math.round(work.width * fitScale) + 'px';
  wrap.style.height = Math.round(work.height * fitScale) + 'px';
  const c = $('#rtImg');
  c.width = work.width; c.height = work.height;
  redraw();
  applyView();
}

function redraw() {
  const c = $('#rtImg');
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(work, 0, 0);
}

/* ---------------- erasing ---------------- */

let cancelStroke = () => false;

function wireErasing() {
  const c = $('#rtImg');
  let rubbing = false, last = null;

  cancelStroke = () => {
    if (!rubbing) return false;
    rubbing = false; last = null;
    return true;
  };

  // read the scale off the live rect: under zoom the element is css-scaled, so
  // fitScale alone would put every stroke in the wrong place
  const toImage = e => {
    const r = c.getBoundingClientRect();
    const k = work.width / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };

  // a soft edge, the way an eraser behaves: a hard circle leaves a cut-out
  // outline that reads as a mistake against any background
  const rub = (a, b) => {
    const g = work.getContext('2d');
    const r = brushImagePx() / 2;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, r / 2)));
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * (i / steps);
      const y = a.y + (b.y - a.y) * (i / steps);
      const grad = g.createRadialGradient(x, y, r * 0.6, x, y, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    redraw();
  };

  c.addEventListener('pointerdown', e => {
    e.preventDefault();
    rubbing = true;
    snapshot();
    try { c.setPointerCapture(e.pointerId); } catch {}
    last = toImage(e);
    rub(last, last);
  });
  c.addEventListener('pointermove', e => {
    if (!rubbing) return;
    e.preventDefault();
    const p = toImage(e);
    rub(last, p);
    last = p;
  });
  const up = () => { rubbing = false; last = null; };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
}

function snapshot() {
  const c = document.createElement('canvas');
  c.width = work.width; c.height = work.height;
  c.getContext('2d').drawImage(work, 0, 0);
  history.push(c);
  if (history.length > 12) history.shift();
  dirty = true;
}

function undoStroke() {
  const prev = history.pop();
  if (!prev) { showToast('nothing to undo'); return; }
  const g = work.getContext('2d');
  g.clearRect(0, 0, work.width, work.height);
  g.drawImage(prev, 0, 0);
  redraw();
}

function restoreAll() {
  if (!history.length && !dirty) { showToast('nothing to undo'); return; }
  snapshot();
  const g = work.getContext('2d');
  g.clearRect(0, 0, work.width, work.height);
  g.drawImage(original, 0, 0);
  redraw();
}

/* ---------------- apply ---------------- */

async function apply() {
  const target = obj;
  if (!dirty) { close(); return; }
  if (!ed.canvas.getObjects().includes(target)) {
    showToast('that photo is no longer on the flyer');
    close();
    return;
  }
  // png always: the whole point is the transparency, and a jpeg has none
  const url = work.toDataURL('image/png');
  target.srcFormat = 'png';
  close();
  await swapImageSource(target, url);
  showToast('erased');
}

function close() {
  $('#retouch').classList.remove('on');
  obj = null; work = null; original = null;
  history = [];
  dirty = false;
}
