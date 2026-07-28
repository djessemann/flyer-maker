// retouch: focused object-removal mode. paints a mask, inpaints only the masked
// region (padded bbox, native resolution) in a worker, composites the patch back.
import { on, emit } from './bus.js';
import { swapImageSource } from './editor.js';
import { showToast } from './panels.js';

const $ = s => document.querySelector(s);

let worker = null, workerReady = null;
let obj = null;            // fabric image being retouched
let native = null;         // full-res source canvas
let maskNative = null;     // full-res mask canvas
let fitScale = 1, brush = 44, mode = 'mask', busy = false;

function ensureWorker() {
  if (workerReady) return workerReady;
  worker = new Worker(new URL('./retouch-worker.js', import.meta.url));
  workerReady = new Promise((resolve, reject) => {
    worker.onmessage = e => {
      if (e.data.type === 'ready') resolve();
      if (e.data.type === 'error') reject(new Error(e.data.message));
    };
    worker.onerror = () => reject(new Error('worker failed'));
  });
  return workerReady;
}

export function initRetouch() {
  on('retouch:open', open);
  $('#rtCancel').addEventListener('click', close);
  $('#rtClear').addEventListener('click', clearMask);
  $('#rtGo').addEventListener('click', run);
  const size = $('#rtSize');
  size.addEventListener('input', () => { brush = +size.value; drawDot(); });
  $('#rtMode').addEventListener('click', e => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    mode = b.dataset.m;
    $('#rtMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  wirePainting();
  drawDot();
}

function drawDot() {
  const d = $('#rtDot');
  const s = Math.min(40, brush);
  d.style.width = s + 'px'; d.style.height = s + 'px';
}

function open(fabricImage) {
  obj = fabricImage;
  const el = obj._element;
  if (!el) { showToast('select a photo first'); return; }

  native = document.createElement('canvas');
  native.width = el.naturalWidth || el.width;
  native.height = el.naturalHeight || el.height;
  native.getContext('2d').drawImage(el, 0, 0, native.width, native.height);

  maskNative = document.createElement('canvas');
  maskNative.width = native.width;
  maskNative.height = native.height;

  $('#retouch').classList.add('on');
  layout();
  $('#rtHint').textContent = 'paint over what you want gone';
  let settled = false;
  ensureWorker().then(
    () => { settled = true; if ($('#retouch').classList.contains('on')) $('#rtHint').textContent = 'paint over what you want gone'; },
    () => { settled = true; showToast('retouch engine failed to load — offline?'); }
  );
  setTimeout(() => { if (!settled) $('#rtHint').textContent = 'loading retouch engine…'; }, 400);
}

function layout() {
  const stage = $('#rtStage');
  const pad = 24;
  fitScale = Math.min(
    (stage.clientWidth - pad * 2) / native.width,
    (stage.clientHeight - pad * 2) / native.height, 1);
  const w = Math.round(native.width * fitScale), h = Math.round(native.height * fitScale);
  const img = $('#rtImg'), mask = $('#rtMask');
  for (const c of [img, mask]) {
    c.width = native.width; c.height = native.height;
    c.style.width = w + 'px'; c.style.height = h + 'px';
  }
  img.getContext('2d').drawImage(native, 0, 0);
  redrawMask();
}

function redrawMask() {
  const m = $('#rtMask');
  const ctx = m.getContext('2d');
  ctx.clearRect(0, 0, m.width, m.height);
  ctx.drawImage(maskNative, 0, 0);
}

function wirePainting() {
  const mask = $('#rtMask');
  let painting = false, last = null;

  const toNative = e => {
    const r = mask.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / fitScale,
      y: (e.clientY - r.top) / fitScale,
    };
  };
  const stroke = (a, b) => {
    const ctx = maskNative.getContext('2d');
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = 'rgb(204,51,51)';
    ctx.fillStyle = 'rgb(204,51,51)';
    ctx.lineWidth = brush / fitScale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    redrawMask();
  };

  mask.addEventListener('pointerdown', e => {
    if (busy) return;
    painting = true;
    mask.setPointerCapture(e.pointerId);
    last = toNative(e);
    stroke(last, { x: last.x + 0.01, y: last.y + 0.01 });
  });
  mask.addEventListener('pointermove', e => {
    if (!painting) return;
    const p = toNative(e);
    stroke(last, p);
    last = p;
  });
  const up = () => { painting = false; last = null; };
  mask.addEventListener('pointerup', up);
  mask.addEventListener('pointercancel', up);
  mask.style.touchAction = 'none';
  addEventListener('resize', () => {
    if ($('#retouch').classList.contains('on')) layout();
  });
}

function clearMask() {
  maskNative.getContext('2d').clearRect(0, 0, maskNative.width, maskNative.height);
  redrawMask();
}

function maskBBox() {
  const ctx = maskNative.getContext('2d');
  const d = ctx.getImageData(0, 0, maskNative.width, maskNative.height).data;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  const w = maskNative.width;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] > 10) {
      const px = ((i - 3) / 4) % w, py = Math.floor((i - 3) / 4 / w);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (maxX < 0) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const pad = Math.max(64, Math.round(Math.max(bw, bh) * 0.15));
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
  return {
    x, y,
    w: Math.min(maskNative.width - x, bw + pad * 2),
    h: Math.min(maskNative.height - y, bh + pad * 2),
  };
}

async function run() {
  if (busy) return;
  const box = maskBBox();
  if (!box) { showToast('paint a mask first'); return; }
  busy = true;
  $('#rtGo').textContent = 'removing…';
  try {
    await ensureWorker();
    const img = native.getContext('2d').getImageData(box.x, box.y, box.w, box.h);
    const msk = maskNative.getContext('2d').getImageData(box.x, box.y, box.w, box.h);
    const patch = await new Promise((resolve, reject) => {
      const onMsg = e => {
        if (e.data.type === 'result') { worker.removeEventListener('message', onMsg); resolve(e.data.patch); }
        if (e.data.type === 'error') { worker.removeEventListener('message', onMsg); reject(new Error(e.data.message)); }
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ type: 'inpaint', image: img, mask: msk, radius: 4 },
        [img.data.buffer, msk.data.buffer]);
    });
    native.getContext('2d').putImageData(patch, box.x, box.y);
    $('#rtImg').getContext('2d').drawImage(native, 0, 0);
    clearMask();
    const format = obj.srcFormat === 'png' ? 'image/png' : 'image/jpeg';
    const url = format === 'image/png' ? native.toDataURL(format) : native.toDataURL(format, 0.92);
    await swapImageSource(obj, url);
    $('#rtHint').textContent = 'done — paint again for another pass';
  } catch (err) {
    showToast('retouch failed: ' + err.message);
  }
  $('#rtGo').textContent = 'remove';
  busy = false;
}

function close() {
  $('#retouch').classList.remove('on');
  obj = null; native = null; maskNative = null;
  emit('retouch:closed');
}
