// erase-object mode: paint over what you want gone, telea inpaint fills it in.
// runs in a worker with no external dependency, so it works on first tap.
import { on, emit } from './bus.js';
import { swapImageSource } from './editor.js';
import { showToast } from './ui.js';

const $ = s => document.querySelector(s);

let worker = null, ready = null;
let obj = null;          // fabric image being worked on
let native = null;       // full-res pixels
let maskC = null;        // full-res mask
let history = [];        // mask undo stack
let fitScale = 1, brush = 48, mode = 'paint', busy = false;

function ensureWorker() {
  if (ready) return ready;
  // classic worker: it has no imports, and this avoids module-worker support gaps
  worker = new Worker(new URL('./inpaint-worker.js', import.meta.url));
  ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('engine start timed out')), 15000);
    worker.addEventListener('message', function onMsg(e) {
      if (e.data.type === 'ready') {
        clearTimeout(t);
        worker.removeEventListener('message', onMsg);
        resolve();
      }
    });
    worker.addEventListener('error', e => {
      clearTimeout(t);
      reject(new Error(e.message || 'engine failed to start'));
    });
  });
  return ready;
}

export function initRetouch() {
  on('retouch:open', open);
  $('#rtCancel').addEventListener('click', close);
  $('#rtClear').addEventListener('click', () => { snapshot(); clearMask(); });
  $('#rtUndo').addEventListener('click', undoMask);
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
  addEventListener('resize', () => { if ($('#retouch').classList.contains('on')) layout(); });
}

function drawDot() {
  const d = $('#rtDot');
  const s = Math.max(10, Math.min(38, brush * 0.4));
  d.style.width = s + 'px';
  d.style.height = s + 'px';
}

function open(image) {
  obj = image;
  const el = obj && obj._element;
  if (!el) { showToast('select a photo first'); return; }

  native = document.createElement('canvas');
  native.width = el.naturalWidth || el.width;
  native.height = el.naturalHeight || el.height;
  native.getContext('2d').drawImage(el, 0, 0, native.width, native.height);

  maskC = document.createElement('canvas');
  maskC.width = native.width;
  maskC.height = native.height;
  history = [];

  $('#retouch').classList.add('on');
  $('#rtHint').textContent = 'paint over what you want gone';
  $('#rtGo').disabled = false;
  layout();
  ensureWorker().catch(err => showToast('erase engine problem: ' + err.message));
}

function layout() {
  const stage = $('#rtStage');
  const pad = 20;
  fitScale = Math.min(
    (stage.clientWidth - pad * 2) / native.width,
    (stage.clientHeight - pad * 2) / native.height, 1) || 1;
  const w = Math.round(native.width * fitScale), h = Math.round(native.height * fitScale);
  for (const c of [$('#rtImg'), $('#rtMask')]) {
    c.width = native.width; c.height = native.height;
    c.style.width = w + 'px'; c.style.height = h + 'px';
  }
  $('#rtImg').getContext('2d').drawImage(native, 0, 0);
  redrawMask();
}

function redrawMask() {
  const m = $('#rtMask');
  const ctx = m.getContext('2d');
  ctx.clearRect(0, 0, m.width, m.height);
  ctx.drawImage(maskC, 0, 0);
}

function snapshot() {
  const c = document.createElement('canvas');
  c.width = maskC.width; c.height = maskC.height;
  c.getContext('2d').drawImage(maskC, 0, 0);
  history.push(c);
  if (history.length > 20) history.shift();
}

function undoMask() {
  const prev = history.pop();
  if (!prev) { showToast('nothing to undo'); return; }
  const ctx = maskC.getContext('2d');
  ctx.clearRect(0, 0, maskC.width, maskC.height);
  ctx.drawImage(prev, 0, 0);
  redrawMask();
}

function clearMask() {
  maskC.getContext('2d').clearRect(0, 0, maskC.width, maskC.height);
  redrawMask();
}

function wirePainting() {
  const mask = $('#rtMask');
  let painting = false, last = null;

  const toNative = e => {
    const r = mask.getBoundingClientRect();
    return { x: (e.clientX - r.left) / fitScale, y: (e.clientY - r.top) / fitScale };
  };
  const stroke = (a, b) => {
    const ctx = maskC.getContext('2d');
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = 'rgb(204,51,51)';
    ctx.lineWidth = Math.max(1, brush / fitScale);
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
    e.preventDefault();
    painting = true;
    snapshot();
    mask.setPointerCapture(e.pointerId);
    last = toNative(e);
    stroke(last, { x: last.x + 0.01, y: last.y + 0.01 });
  });
  mask.addEventListener('pointermove', e => {
    if (!painting) return;
    e.preventDefault();
    const p = toNative(e);
    stroke(last, p);
    last = p;
  });
  const up = () => { painting = false; last = null; };
  mask.addEventListener('pointerup', up);
  mask.addEventListener('pointercancel', up);
}

// tight bounds of the painted mask, padded so telea has context to work from
function maskBBox() {
  const ctx = maskC.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, maskC.width, maskC.height).data;
  const w = maskC.width;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let i = 3, n = 0; i < d.length; i += 4, n++) {
    if (d[i] > 10) {
      const px = n % w, py = (n / w) | 0;
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
    w: Math.min(maskC.width - x, bw + pad * 2 + (minX - x < pad ? 0 : 0)),
    h: Math.min(maskC.height - y, bh + pad * 2),
  };
}

async function run() {
  if (busy) return;
  const box = maskBBox();
  if (!box) { showToast('paint over something first'); return; }

  busy = true;
  $('#rtGo').disabled = true;
  $('#rtHint').textContent = 'erasing…';

  try {
    await ensureWorker();
    const image = native.getContext('2d', { willReadFrequently: true })
      .getImageData(box.x, box.y, box.w, box.h);
    const mask = maskC.getContext('2d', { willReadFrequently: true })
      .getImageData(box.x, box.y, box.w, box.h);

    const patch = await new Promise((resolve, reject) => {
      const onMsg = e => {
        if (e.data.type === 'result') { worker.removeEventListener('message', onMsg); resolve(e.data.patch); }
        if (e.data.type === 'error') { worker.removeEventListener('message', onMsg); reject(new Error(e.data.message)); }
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage(
        { type: 'inpaint', image, mask, radius: 5 },
        [image.data.buffer, mask.data.buffer]);
    });

    native.getContext('2d').putImageData(patch, box.x, box.y);
    $('#rtImg').getContext('2d').drawImage(native, 0, 0);
    history = [];
    clearMask();

    const png = obj.srcFormat === 'png';
    const url = png ? native.toDataURL('image/png') : native.toDataURL('image/jpeg', 0.92);
    await swapImageSource(obj, url);
    $('#rtHint').textContent = 'gone — paint again for another pass';
    showToast('erased');
  } catch (err) {
    $('#rtHint').textContent = 'paint over what you want gone';
    showToast('erase failed: ' + (err.message || err));
  }

  $('#rtGo').disabled = false;
  busy = false;
}

function close() {
  $('#retouch').classList.remove('on');
  obj = null; native = null; maskC = null; history = [];
  emit('retouch:closed');
}
