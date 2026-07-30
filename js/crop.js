// crop mode: drag a rectangle over a photo, keep what's inside it.
// the kept region stays exactly where it was on the flyer, so trimming an edge
// doesn't shove the picture sideways.
import { on } from './bus.js';
import { ed, cropImageSource } from './editor.js';
import { showToast } from './ui.js';

const $ = s => document.querySelector(s);
const MIN = 36;          // smallest crop, in screen px, so a handle stays grabbable

let obj = null;          // fabric image being cropped
let native = null;       // full-res pixels
let fitScale = 1;        // display px per native px
let box = null;          // crop rect in display px, relative to the wrap
let ratio = null;        // null = free, otherwise width/height

export function initCrop() {
  on('crop:open', open);
  // an undo replaces every object; the image we were cropping is detached
  on('doc:restored', () => {
    if ($('#crop').classList.contains('on')) {
      close();
      showToast('closed crop — the flyer was undone underneath it');
    }
  });
  $('#cpCancel').addEventListener('click', close);
  $('#cpGo').addEventListener('click', apply);
  $('#cpReset').addEventListener('click', () => { ratio = null; markRatio(); reset(); });
  $('#cpAspect').addEventListener('click', e => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    ratio = b.dataset.r === 'free' ? null
          : b.dataset.r === 'flyer' ? ed.docW / ed.docH
          : +b.dataset.r;
    markRatio();
    applyRatio();
  });
  wireDrag();
  addEventListener('resize', () => { if ($('#crop').classList.contains('on')) relayout(); });
}

function markRatio() {
  const want = ratio === null ? 'free' : ratio === ed.docW / ed.docH ? 'flyer' : String(ratio);
  $('#cpAspect').querySelectorAll('[data-r]').forEach(b =>
    b.classList.toggle('on', b.dataset.r === want));
}

function open(image) {
  obj = image;
  const el = obj && obj._element;
  if (!el) { showToast('select a photo first'); return; }

  native = document.createElement('canvas');
  native.width = el.naturalWidth || el.width;
  native.height = el.naturalHeight || el.height;
  native.getContext('2d').drawImage(el, 0, 0, native.width, native.height);

  ratio = null;
  markRatio();
  $('#crop').classList.add('on');
  layout();
  reset();
}

function layout() {
  const stage = $('#cpStage');
  const pad = 34;        // room for the corner handles to hang outside the photo
  fitScale = Math.min(
    (stage.clientWidth - pad * 2) / native.width,
    (stage.clientHeight - pad * 2) / native.height, 1) || 1;
  const w = Math.round(native.width * fitScale), h = Math.round(native.height * fitScale);
  const wrap = $('#cpWrap');
  wrap.style.width = w + 'px';
  wrap.style.height = h + 'px';
  const c = $('#cpImg');
  c.width = native.width; c.height = native.height;
  c.getContext('2d').drawImage(native, 0, 0);
}

// keep the same slice of the photo when the window changes shape
function relayout() {
  const before = box ? toNative(box) : null;
  layout();
  if (before) {
    box = {
      x: before.x * fitScale, y: before.y * fitScale,
      w: before.w * fitScale, h: before.h * fitScale,
    };
    clamp();
    paint();
  } else reset();
}

function reset() {
  const wrap = $('#cpWrap');
  box = { x: 0, y: 0, w: wrap.clientWidth, h: wrap.clientHeight };
  if (ratio) applyRatio(); else paint();
}

// fit the largest box of the wanted shape inside the photo, centred on the
// current selection so switching shapes doesn't jump you back to the middle
function applyRatio() {
  if (!ratio || !box) { paint(); return; }
  const wrap = $('#cpWrap');
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  let w = Math.min(wrap.clientWidth, wrap.clientHeight * ratio);
  let h = w / ratio;
  box = { x: cx - w / 2, y: cy - h / 2, w, h };
  clamp();
  paint();
}

function clamp() {
  const wrap = $('#cpWrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  box.w = Math.max(MIN, Math.min(box.w, W));
  box.h = Math.max(MIN, Math.min(box.h, H));
  box.x = Math.max(0, Math.min(box.x, W - box.w));
  box.y = Math.max(0, Math.min(box.y, H - box.h));
}

function paint() {
  const r = $('#cpRect');
  r.style.left = box.x + 'px';
  r.style.top = box.y + 'px';
  r.style.width = box.w + 'px';
  r.style.height = box.h + 'px';
  const n = toNative(box);
  $('#cpHint').textContent =
    `keeping ${Math.round(n.w)} × ${Math.round(n.h)} px — drag the corners or the picture itself`;
}

// display px -> native px. The fitted size is rounded to whole screen pixels, so
// scaling straight back loses a pixel or two at each edge: a crop that keeps
// everything would quietly shave the border off. Snap to the real edges instead.
function toNative(b) {
  const wrap = $('#cpWrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const kx = native.width / W, ky = native.height / H;
  const x = b.x <= 0.5 ? 0 : Math.round(b.x * kx);
  const y = b.y <= 0.5 ? 0 : Math.round(b.y * ky);
  return {
    x, y,
    w: b.x + b.w >= W - 0.5 ? native.width - x : Math.round(b.w * kx),
    h: b.y + b.h >= H - 0.5 ? native.height - y : Math.round(b.h * ky),
  };
}

function wireDrag() {
  const wrap = $('#cpWrap');
  let drag = null;

  const at = e => {
    const r = wrap.getBoundingClientRect();
    const k = wrap.clientWidth / r.width;      // css transforms, if any
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };

  wrap.addEventListener('pointerdown', e => {
    const h = e.target.closest('.cp-h');
    const inRect = e.target.closest('.cp-rect');
    const p = at(e);
    e.preventDefault();
    try { wrap.setPointerCapture(e.pointerId); } catch {}
    if (h) drag = { kind: 'corner', which: h.dataset.h, start: p, box: { ...box } };
    else if (inRect) drag = { kind: 'move', start: p, box: { ...box } };
    // a press on the dimmed part starts a fresh rectangle from that point
    else drag = { kind: 'new', start: p, box: { x: p.x, y: p.y, w: MIN, h: MIN } };
  });

  wrap.addEventListener('pointermove', e => {
    if (!drag) return;
    e.preventDefault();
    const p = at(e);
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    const b = drag.box;

    if (drag.kind === 'move') {
      box = { ...b, x: b.x + dx, y: b.y + dy };
      clamp();
    } else if (drag.kind === 'new') {
      const x1 = Math.min(drag.start.x, p.x), x2 = Math.max(drag.start.x, p.x);
      const y1 = Math.min(drag.start.y, p.y), y2 = Math.max(drag.start.y, p.y);
      box = { x: x1, y: y1, w: Math.max(MIN, x2 - x1), h: Math.max(MIN, y2 - y1) };
      if (ratio) shapeCorner('se', box);
      clamp();
    } else {
      // move the dragged corner, hold the opposite one still
      const west = drag.which[1] === 'w', north = drag.which[0] === 'n';
      const right = b.x + b.w, bottom = b.y + b.h;
      let nb = { ...b };
      if (west) { nb.x = b.x + dx; nb.w = right - nb.x; } else nb.w = b.w + dx;
      if (north) { nb.y = b.y + dy; nb.h = bottom - nb.y; } else nb.h = b.h + dy;
      if (nb.w < MIN) { nb.w = MIN; if (west) nb.x = right - MIN; }
      if (nb.h < MIN) { nb.h = MIN; if (north) nb.y = bottom - MIN; }
      box = nb;
      if (ratio) shapeCorner(drag.which, box);
      clamp();
    }
    paint();
  });

  const up = () => { drag = null; };
  wrap.addEventListener('pointerup', up);
  wrap.addEventListener('pointercancel', up);
}

// force the locked shape while keeping the corner opposite the drag pinned
function shapeCorner(which, b) {
  const west = which[1] === 'w', north = which[0] === 'n';
  const right = b.x + b.w, bottom = b.y + b.h;
  const h = b.w / ratio;
  if (north) b.y = bottom - h;
  b.h = h;
  if (west) b.x = right - b.w;
}

async function apply() {
  const n = toNative(box);
  const w = Math.max(1, Math.round(n.w)), h = Math.max(1, Math.round(n.h));
  const x = Math.round(n.x), y = Math.round(n.y);
  if (w >= native.width && h >= native.height) {
    close();
    showToast('nothing trimmed — drag a corner in first');
    return;
  }

  const target = obj;
  if (!ed.canvas.getObjects().includes(target)) {
    showToast('that photo is no longer on the flyer');
    close();
    return;
  }

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(native, x, y, w, h, 0, 0, w, h);
  // a jpeg photo stays a jpeg: one re-encode is invisible and a png of a 4096px
  // photo is many megabytes in every autosave
  const png = target.srcFormat !== 'jpeg';
  const url = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);

  await cropImageSource(target, url, { x, y });
  close();
  showToast(`cropped to ${w} × ${h}`);
}

function close() {
  $('#crop').classList.remove('on');
  obj = null; native = null; box = null;
}
