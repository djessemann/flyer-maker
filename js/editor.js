// canvas engine: fabric setup, gestures, zoom/pan, undo/redo, autosave, export
import * as fabric from '../vendor/fabric-6.9.1.min.mjs';
import { emit } from './bus.js';
import { saveProject, newId } from './store.js';
import { ensureDocFonts } from './fonts.js';

export { fabric };

const PROPS = ['pName', 'pLocked', 'pKind', 'srcFormat', 'selectable', 'evented', 'rx', 'ry'];
const ZMIN = 0.05, ZMAX = 8;

export const PRESETS = [
  { key: 'ig-post', label: 'instagram post', w: 1080, h: 1080 },
  { key: 'ig-story', label: 'instagram story', w: 1080, h: 1920 },
  { key: 'letter', label: 'flyer · letter', w: 1275, h: 1650 },
  { key: 'a4', label: 'a4', w: 1240, h: 1754 },
  { key: 'poster', label: 'poster · tabloid', w: 1650, h: 2550 },
];

export const ed = {
  canvas: null, id: null, name: 'untitled flyer',
  docW: 1080, docH: 1350, bgRect: null,
  undoStack: [], redoStack: [], restoring: false,
  exportScale: 2, open: false,
};

let dirtyTimer = null, snapTimer = null, host = null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- init ---------- */

export function initEditor() {
  Object.assign(fabric.InteractiveFabricObject.ownDefaults, {
    borderColor: '#111110',
    cornerColor: '#F8F7F4',
    cornerStrokeColor: '#111110',
    cornerSize: 11,
    touchCornerSize: 44,
    transparentCorners: false,
    borderScaleFactor: 1.5,
    borderOpacityWhenMoving: 0.6,
    editingBorderColor: '#111110',
    cursorColor: '#111110',
    padding: 2,
  });

  host = document.querySelector('.canvas-host');
  const canvas = new fabric.Canvas('fab', {
    selection: false,
    preserveObjectStacking: true,
    uniformScaling: true,
    stopContextMenu: true,
    fireRightClick: false,
    backgroundColor: '',
  });
  ed.canvas = canvas;
  sizeToHost();
  new ResizeObserver(() => { sizeToHost(); if (ed.open) fit(); }).observe(host);

  canvas.on('mouse:down', opt => {
    if (!opt.target) { canvas.discardActiveObject(); canvas.requestRenderAll(); }
  });
  canvas.on('selection:created', e => { (e.selected || []).forEach(tuneHandles); emit('selection'); });
  canvas.on('selection:updated', e => { (e.selected || []).forEach(tuneHandles); emit('selection'); });
  canvas.on('selection:cleared', () => emit('selection'));
  canvas.on('object:modified', e => { bakeScale(e.target); markDirty(true); emit('selection'); });
  canvas.on('object:added', e => { if (!ed.restoring) styleControls(e.target); });
  canvas.on('text:changed', () => { emit('layers'); markDirty(true); });
  canvas.on('text:editing:exited', () => { markDirty(true); emit('layers'); });

  wireGestures(canvas);
  return canvas;
}

function sizeToHost() {
  if (!host || !ed.canvas) return;
  const w = host.clientWidth, h = host.clientHeight;
  if (w > 0 && h > 0) ed.canvas.setDimensions({ width: w, height: h });
}

function styleControls(obj) {
  if (!obj || !obj.controls || !obj.controls.mtr) return;
  obj.controls.mtr.y = 0.5;
  obj.controls.mtr.offsetY = 36;
  obj.controls.mtr.withConnection = true;
  tuneHandles(obj);
}

// A 44px touch target is right for a big layer and a trap for a small one: at
// fit zoom a fresh text layer is ~34px tall on screen, so its own corner
// handles covered it completely and a drag meant to move it scaled it into an
// illegible sliver instead. Keep handles proportional to what's on screen.
function tuneHandles(obj) {
  if (!obj || obj.pKind === 'bg') return;
  const z = ed.canvas ? ed.canvas.getZoom() : 1;
  const r = obj.getBoundingRect();
  const screenMin = Math.min(r.width, r.height) * z;
  obj.set({
    touchCornerSize: Math.max(10, Math.min(44, Math.floor(screenMin / 3))),
    cornerSize: Math.max(6, Math.min(11, Math.floor(screenMin / 6))),
  });
}

export function tuneAllHandles() {
  if (!ed.canvas) return;
  ed.canvas.getObjects().forEach(tuneHandles);
}

/* ---------- doc lifecycle ---------- */

export async function newDoc({ w, h, name } = {}) {
  const canvas = ed.canvas;
  canvas.clear();
  ed.id = newId();
  ed.name = name || 'untitled flyer';
  ed.docW = w || 1080; ed.docH = h || 1080;
  ed.bgRect = makeBg('#ffffff');
  canvas.add(ed.bgRect);
  canvas.sendObjectToBack(ed.bgRect);
  ed.undoStack = []; ed.redoStack = [];
  ed.open = true;
  fit();
  pushSnapshot();
  markDirty();
  emit('doc:open'); emit('layers'); emit('selection');
}

export async function openDoc(id, doc) {
  const canvas = ed.canvas;
  ed.restoring = true;
  const missing = await ensureDocFonts(doc.fonts);
  ed.id = id;
  ed.name = doc.name || 'untitled flyer';
  ed.docW = doc.canvas.w; ed.docH = doc.canvas.h;
  await canvas.loadFromJSON(doc.fabric);
  afterRestore();
  ed.undoStack = []; ed.redoStack = [];
  ed.open = true;
  fit();
  pushSnapshot();
  emit('doc:open'); emit('layers'); emit('selection');
  if (missing.length) emit('toast', `couldn't load ${missing.join(', ')} — check your connection`);
}

export function closeDoc() {
  flushSave();
  ed.open = false;
  ed.canvas.clear();
  emit('doc:close');
}

function makeBg(fill) {
  return new fabric.Rect({
    left: -1, top: -1, width: ed.docW + 2, height: ed.docH + 2, fill,
    selectable: false, evented: false, hoverCursor: 'default',
    pKind: 'bg', pName: 'background', pLocked: true,
    shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.18)', blur: 40, offsetY: 14 }),
  });
}

function afterRestore() {
  const canvas = ed.canvas;
  ed.bgRect = canvas.getObjects().find(o => o.pKind === 'bg');
  if (!ed.bgRect) {
    ed.bgRect = makeBg('#ffffff');
    canvas.add(ed.bgRect);
  } else if (!ed.bgRect.shadow) {
    ed.bgRect.set('shadow', new fabric.Shadow({ color: 'rgba(0,0,0,0.18)', blur: 40, offsetY: 14 }));
  }
  ed.bgRect.set({ selectable: false, evented: false });
  sizeBg();
  canvas.sendObjectToBack(ed.bgRect);
  canvas.getObjects().forEach(o => {
    styleControls(o);
    if (o.pLocked && o.pKind !== 'bg') o.set({ selectable: false, evented: false });
  });
  // Text laid out during loadFromJSON is measured against whatever face was
  // available at that instant, and fabric caches those metrics. Reopening a
  // flyer therefore came back with the headline re-wrapped onto one overflowing
  // line. Drop the cache and re-measure now that the real fonts are loaded.
  try { fabric.cache.clearFontCache(); } catch {}
  canvas.getObjects().forEach(o => {
    if (o.pKind === 'text' && o.initDimensions) { o.initDimensions(); o.setCoords(); }
  });
  ed.restoring = false;
  canvas.requestRenderAll();
}

/* ---------- persistence ---------- */

export function docFonts() {
  const seen = new Map();
  ed.canvas.getObjects().forEach(o => {
    if (o.fontFamily) seen.set(o.fontFamily, { family: o.fontFamily, weight: o.fontWeight || 400 });
  });
  return [...seen.values()];
}

export function serializeDoc() {
  return {
    app: 'pasteup', version: 1, name: ed.name,
    canvas: { w: ed.docW, h: ed.docH, bg: ed.bgRect ? ed.bgRect.fill : '#ffffff' },
    fonts: docFonts(),
    fabric: ed.canvas.toObject(PROPS),
  };
}

export function markDirty(withSnapshot) {
  if (ed.restoring || !ed.open) return;
  if (withSnapshot) queueSnapshot();
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(flushSave, 800);
}

export async function flushSave() {
  clearTimeout(dirtyTimer);
  if (!ed.open || !ed.id) return;
  const doc = serializeDoc();
  let thumb = '';
  try {
    thumb = await renderArtboard(() => ed.canvas.toDataURL({
      left: 0, top: 0, width: ed.docW, height: ed.docH,
      format: 'jpeg', quality: 0.65, multiplier: 280 / ed.docW,
    }));
  } catch {}
  await saveProject({ id: ed.id, name: ed.name, updatedAt: Date.now(), thumb }, doc);
}

/* ---------- undo / redo ---------- */

// Undo snapshots used to embed every photo as a base64 data URL — a 4096px PNG
// is ~23MB of string, copied into all 40 history entries. Store each distinct
// source once and put a token in the snapshot instead.
const imageStore = new Map();   // token -> data url
let imageToken = 0;

function snapshotState() {
  const doc = ed.canvas.toObject(PROPS);
  for (const o of doc.objects || []) {
    if (o.type === 'Image' && typeof o.src === 'string' && o.src.length > 4096) {
      let token = null;
      for (const [k, v] of imageStore) if (v === o.src) { token = k; break; }
      if (!token) { token = `pasteup:img:${++imageToken}`; imageStore.set(token, o.src); }
      o.src = token;
    }
  }
  return { fabric: doc, w: ed.docW, h: ed.docH };
}

function rehydrate(state) {
  const doc = structuredClone(state.fabric);
  for (const o of doc.objects || []) {
    if (typeof o.src === 'string' && imageStore.has(o.src)) o.src = imageStore.get(o.src);
  }
  return doc;
}

// keep only what the history still refers to
function pruneImageStore() {
  const live = new Set();
  for (const s of [...ed.undoStack, ...ed.redoStack]) {
    for (const o of s.fabric.objects || []) if (imageStore.has(o.src)) live.add(o.src);
  }
  for (const k of [...imageStore.keys()]) if (!live.has(k)) imageStore.delete(k);
}

export function pushSnapshot() {
  if (ed.restoring) return;
  clearTimeout(snapTimer);
  ed.undoStack.push(snapshotState());
  if (ed.undoStack.length > 40) ed.undoStack.shift();
  ed.redoStack = [];
  pruneImageStore();
  emit('history');
}

function queueSnapshot() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(pushSnapshot, 300);
}

export const canUndo = () => ed.undoStack.length > 1;
export const canRedo = () => ed.redoStack.length > 0;

export async function undo() {
  if (!canUndo()) return;
  clearTimeout(snapTimer);
  ed.redoStack.push(ed.undoStack.pop());
  await restore(ed.undoStack[ed.undoStack.length - 1]);
}

export async function redo() {
  if (!canRedo()) return;
  const s = ed.redoStack.pop();
  ed.undoStack.push(s);
  await restore(s);
}

async function restore(s) {
  ed.restoring = true;
  const sizeChanged = s.w !== ed.docW || s.h !== ed.docH;
  ed.docW = s.w; ed.docH = s.h;
  await ed.canvas.loadFromJSON(rehydrate(s));
  afterRestore();
  if (sizeChanged) fit();
  // every object on the canvas is a new instance now: anything holding a
  // reference to the old one (an open sheet, an inline slider, erase mode) is
  // pointing at a detached object and must let go.
  emit('doc:restored');
  emit('layers'); emit('selection'); emit('history'); emit('doc:change');
  markDirty();
}

/* ---------- zoom / pan ---------- */

export const zoomLevel = () => ed.canvas.viewportTransform[0];

function fitZoom() {
  const canvas = ed.canvas;
  const pad = canvas.width < 700 ? 30 : 70;
  return clamp(Math.min((canvas.width - pad) / ed.docW, (canvas.height - pad) / ed.docH), ZMIN, ZMAX);
}

export function fit() {
  const canvas = ed.canvas;
  const z = fitZoom();
  canvas.setViewportTransform([z, 0, 0, z,
    (canvas.width - ed.docW * z) / 2, (canvas.height - ed.docH * z) / 2]);
  canvas.requestRenderAll();
  emit('zoom');
}

export function cycleZoom() {
  const canvas = ed.canvas;
  if (Math.abs(zoomLevel() - fitZoom()) < 0.01) {
    canvas.zoomToPoint(new fabric.Point(canvas.width / 2, canvas.height / 2), 1);
    canvas.requestRenderAll();
    emit('zoom');
  } else {
    fit();
  }
}

function wireGestures(canvas) {
  const el = canvas.upperCanvasEl;
  let g = null;
  let beforeTouch = null;   // selection as it stood before this touch sequence

  // captured before fabric sees the event, so we know what was selected when
  // the first finger landed — a two-finger pan used to leave you holding
  // whatever happened to be under your fingers
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 1) beforeTouch = canvas.getActiveObject() || null;
  }, { capture: true, passive: true });

  const pts = tl => [...tl].map(t => ({ x: t.clientX, y: t.clientY }));
  const mid = p => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const dist = p => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const local = m => {
    const r = el.getBoundingClientRect();
    return { x: m.x - r.left, y: m.y - r.top };
  };

  el.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      canvas._currentTransform = null;
      canvas.skipTargetFind = true;
      // put the selection back the way the user left it before they pinched
      if (canvas.getActiveObject() !== beforeTouch) {
        if (beforeTouch && canvas.getObjects().includes(beforeTouch)) canvas.setActiveObject(beforeTouch);
        else canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
      const p = pts(e.touches);
      g = { d0: dist(p) || 1, m0: local(mid(p)), vpt: [...canvas.viewportTransform] };
    }
  }, { passive: false });

  el.addEventListener('touchmove', e => {
    if (!g || e.touches.length !== 2) return;
    e.preventDefault();
    const p = pts(e.touches);
    const m = local(mid(p));
    const k = clamp(g.vpt[0] * (dist(p) / g.d0), ZMIN, ZMAX) / g.vpt[0];
    canvas.setViewportTransform([
      g.vpt[0] * k, 0, 0, g.vpt[3] * k,
      k * (g.vpt[4] - g.m0.x) + m.x,
      k * (g.vpt[5] - g.m0.y) + m.y,
    ]);
    emit('zoom');
  }, { passive: false });

  const end = e => {
    if (g && e.touches.length < 2) { g = null; canvas.skipTargetFind = false; }
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);

  el.addEventListener('wheel', e => {
    e.preventDefault();
    const vpt = canvas.viewportTransform;
    if (e.ctrlKey || e.metaKey) {
      const z = clamp(vpt[0] * Math.pow(0.999, e.deltaY * 2), ZMIN, ZMAX);
      const r = el.getBoundingClientRect();
      canvas.zoomToPoint(new fabric.Point(e.clientX - r.left, e.clientY - r.top), z);
    } else {
      vpt[4] -= e.deltaX; vpt[5] -= e.deltaY;
      canvas.setViewportTransform(vpt);
    }
    canvas.requestRenderAll();
    emit('zoom');
  }, { passive: false });
}

/* ---------- objects ---------- */

function autoName(kind) {
  const n = ed.canvas.getObjects().filter(o => o.pKind === kind).length + 1;
  const label = { rect: 'rectangle', rounded: 'rounded', ellipse: 'ellipse', line: 'line', image: 'photo' }[kind] || kind;
  return `${label} ${n}`;
}

export function layerName(o) {
  if (o.pKind === 'bg') return 'background';
  if (o.pName) return o.pName;
  if (o.text != null) {
    const t = o.text.replace(/\s+/g, ' ').trim();
    return t ? (t.length > 16 ? t.slice(0, 16) + '…' : t) : 'text';
  }
  return 'layer';
}

// place near the middle of the artboard, nudged down as the stack grows
// cascade far enough that a new layer never lands hidden under the last one
function spot() {
  const n = ed.canvas.getObjects().filter(o => o.pKind !== 'bg').length;
  const off = (n % 5) * Math.round(ed.docH * 0.11);
  return { x: ed.docW / 2, y: ed.docH * 0.28 + off };
}

export function addText() {
  const p = spot();
  const w = Math.round(ed.docW * 0.76);
  const size = Math.round(ed.docW / 12);
  const tb = new fabric.Textbox('your text', {
    left: p.x - w / 2, top: p.y - size,
    width: w, fontSize: size,
    fontFamily: 'DM Mono', fontWeight: 400, fill: '#111110',
    textAlign: 'center', pKind: 'text',
  });
  ed.canvas.add(tb);
  ed.canvas.setActiveObject(tb);
  styleControls(tb);
  ed.canvas.requestRenderAll();
  tb.enterEditing();
  tb.selectAll();
  pushSnapshot(); markDirty();
  emit('layers'); emit('selection');
  return tb;
}

export function addShape(kind) {
  const p = spot();
  const s = Math.round(Math.min(ed.docW, ed.docH) * 0.32);
  const common = { fill: '#111110', stroke: null, strokeWidth: 0, strokeUniform: true };
  let obj;
  if (kind === 'rect') obj = new fabric.Rect({ ...common, left: p.x - s / 2, top: p.y - s / 2, width: s, height: s });
  if (kind === 'rounded') obj = new fabric.Rect({ ...common, left: p.x - s / 2, top: p.y - s / 2, width: s, height: s, rx: Math.round(s * 0.12), ry: Math.round(s * 0.12) });
  if (kind === 'ellipse') obj = new fabric.Ellipse({ ...common, left: p.x - s / 2, top: p.y - s / 2, rx: s / 2, ry: s / 2 });
  if (kind === 'line') obj = new fabric.Line([p.x - s / 2, p.y, p.x + s / 2, p.y], { stroke: '#111110', strokeWidth: Math.max(4, Math.round(s * 0.03)), strokeUniform: true });
  if (!obj) return null;
  obj.set({ pKind: kind, pName: autoName(kind) });
  ed.canvas.add(obj);
  ed.canvas.setActiveObject(obj);
  styleControls(obj);
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers'); emit('selection');
  return obj;
}

// decode + downscale to <=4096 on the long side (safari canvas memory ceiling)
export async function fileToDataURL(file) {
  let bmp = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise((res, rej) => {
      const u = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { res(img); };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode failed')); };
      img.src = u;
    });
  }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  if (!w || !h) throw new Error('decode failed');
  const long = Math.max(w, h);
  const k = long > 4096 ? 4096 / long : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  const isPng = file.type === 'image/png' || file.type === 'image/gif';
  return {
    url: isPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92),
    format: isPng ? 'png' : 'jpeg',
    scaled: k < 1,
  };
}

export async function addImageFromFile(file) {
  let data;
  try {
    data = await fileToDataURL(file);
  } catch {
    emit('toast', "couldn't read that photo — try a jpeg or png");
    return null;
  }
  if (data.scaled) emit('toast', 'photo scaled down to 4096px');
  const img = await fabric.FabricImage.fromURL(data.url);
  const s = Math.min(ed.docW / img.width, ed.docH / img.height);
  img.set({
    scaleX: s, scaleY: s,
    left: (ed.docW - img.width * s) / 2,
    top: (ed.docH - img.height * s) / 2,
    pKind: 'image', pName: autoName('image'), srcFormat: data.format,
  });
  ed.canvas.add(img);
  ed.canvas.setActiveObject(img);
  styleControls(img);
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers'); emit('selection');
  return img;
}

export async function replaceImage(obj, file) {
  let data;
  try {
    data = await fileToDataURL(file);
  } catch {
    emit('toast', "couldn't read that photo — try a jpeg or png");
    return;
  }
  const oldW = obj.width * obj.scaleX;
  await obj.setSrc(data.url);
  const s = oldW / obj.width;
  obj.set({ scaleX: s, scaleY: s, srcFormat: data.format });
  obj.setCoords();
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers'); emit('selection');
}

export function resetImageSize(obj) {
  const s = Math.min(ed.docW / obj.width, ed.docH / obj.height);
  obj.set({
    scaleX: s, scaleY: s, angle: 0,
    left: (ed.docW - obj.width * s) / 2,
    top: (ed.docH - obj.height * s) / 2,
  });
  obj.setCoords();
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('selection');
}

export async function duplicateObject(obj) {
  const clone = await obj.clone(PROPS);
  const off = Math.round(ed.docW * 0.03);
  clone.set({ left: obj.left + off, top: obj.top + off });
  if (clone.pName) clone.pName = autoName(clone.pKind);
  ed.canvas.add(clone);
  styleControls(clone);
  ed.canvas.setActiveObject(clone);
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers'); emit('selection');
}

export function deleteObject(obj) {
  if (!obj || obj.pKind === 'bg') return;
  ed.canvas.remove(obj);
  ed.canvas.discardActiveObject();
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers'); emit('selection');
}

export function reorder(obj, dir) {
  const c = ed.canvas;
  if (dir === 'forward') c.bringObjectForward(obj);
  if (dir === 'backward') c.sendObjectBackwards(obj);
  if (dir === 'front') c.bringObjectToFront(obj);
  if (dir === 'back') c.sendObjectToBack(obj);
  c.sendObjectToBack(ed.bgRect);
  c.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers');
}

export function setLocked(obj, locked) {
  obj.set({ pLocked: locked, selectable: !locked, evented: !locked });
  if (locked && ed.canvas.getActiveObject() === obj) ed.canvas.discardActiveObject();
  ed.canvas.requestRenderAll();
  markDirty(true);
  emit('layers'); emit('selection');
}

export function setVisible(obj, visible) {
  obj.set('visible', visible);
  if (!visible && ed.canvas.getActiveObject() === obj) ed.canvas.discardActiveObject();
  ed.canvas.requestRenderAll();
  markDirty(true);
  emit('layers'); emit('selection');
}

export function nudge(dx, dy) {
  const o = ed.canvas.getActiveObject();
  if (!o) return;
  o.set({ left: o.left + dx, top: o.top + dy });
  o.setCoords();
  ed.canvas.requestRenderAll();
  markDirty(true);
}

// bake scale into intrinsic dims so radius/stroke/font stay honest after a resize
function bakeScale(o) {
  if (!o) return;
  const sx = o.scaleX, sy = o.scaleY;
  if (sx === 1 && sy === 1) return;
  if (o.pKind === 'text') {
    o.set({ fontSize: Math.round(o.fontSize * sy * 10) / 10, width: o.width * sx, scaleX: 1, scaleY: 1 });
    o.setCoords();
  } else if (o.pKind === 'rect' || o.pKind === 'rounded') {
    o.set({ width: o.width * sx, height: o.height * sy, scaleX: 1, scaleY: 1 });
    o.setCoords();
  } else if (o.pKind === 'ellipse') {
    o.set({ rx: o.rx * sx, ry: o.ry * sy, scaleX: 1, scaleY: 1 });
    o.setCoords();
  }
}

/* ---------- canvas settings ---------- */

export function resizeDoc(w, h) {
  const oldW = ed.docW, oldH = ed.docH;
  ed.docW = clamp(Math.round(w) || ed.docW, 100, 6000);
  ed.docH = clamp(Math.round(h) || ed.docH, 100, 6000);
  if (oldW && oldH && (ed.docW !== oldW || ed.docH !== oldH)) reflowLayers(oldW, oldH);
  sizeBg();
  fit();
  pushSnapshot(); markDirty();
  emit('doc:change');
}

// Changing the canvas used to leave every layer at its old coordinates, so
// switching a poster to a square silently pushed most of the flyer outside the
// frame and the export came back mostly blank. Carry the layout across instead:
// each layer keeps its relative position and is scaled uniformly, so nothing
// distorts and nothing falls off the edge.
function reflowLayers(oldW, oldH) {
  const s = Math.min(ed.docW / oldW, ed.docH / oldH);
  for (const o of ed.canvas.getObjects()) {
    if (o.pKind === 'bg') continue;
    const c = o.getCenterPoint();
    if (o.pKind === 'text') {
      o.set({ fontSize: Math.max(4, o.fontSize * s), width: Math.max(20, o.width * s) });
      if (o.initDimensions) o.initDimensions();
    } else if (o.pKind === 'rect' || o.pKind === 'rounded') {
      o.set({ width: o.width * s, height: o.height * s, rx: (o.rx || 0) * s, ry: (o.ry || 0) * s });
    } else if (o.pKind === 'ellipse') {
      o.set({ rx: o.rx * s, ry: o.ry * s });
    } else {
      o.set({ scaleX: o.scaleX * s, scaleY: o.scaleY * s });
    }
    if (o.strokeWidth) o.set('strokeWidth', o.strokeWidth * s);
    o.setPositionByOrigin(
      new fabric.Point(c.x / oldW * ed.docW, c.y / oldH * ed.docH), 'center', 'center');
    o.setCoords();
  }
}

// a hair of bleed so the exported edge is fully opaque rather than antialiased
function sizeBg() {
  if (!ed.bgRect) return;
  ed.bgRect.set({ left: -1, top: -1, width: ed.docW + 2, height: ed.docH + 2 });
  ed.bgRect.setCoords();
}

export function setBg(color) {
  ed.bgRect.set('fill', color);
  ed.canvas.requestRenderAll();
  markDirty(true);
  emit('doc:change');
}

export function collectDocColors() {
  const out = new Set();
  const push = v => {
    if (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) out.add(v.toLowerCase());
  };
  ed.canvas.getObjects().forEach(o => { push(o.fill); push(o.stroke); });
  return [...out];
}

/* ---------- export ---------- */

export const maxExportScale = () => Math.max(1, Math.floor(6000 / Math.max(ed.docW, ed.docH)));

// fabric's export multiplies the *current* zoom and reads left/top/width/height
// as screen coordinates. render with an identity viewport so the crop box means
// artboard pixels — otherwise the flyer comes out shrunk into a corner.
async function renderArtboard(fn) {
  const canvas = ed.canvas;
  // note: no discardActiveObject here — autosave renders a thumbnail on every
  // edit, and dropping the selection each time would fight the user. fabric
  // sets skipControlsDrawing during export, so handles stay out of the output.
  const vpt = [...canvas.viewportTransform];
  const shadow = ed.bgRect ? ed.bgRect.shadow : null;
  if (ed.bgRect) ed.bgRect.set('shadow', null);
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  try {
    return await fn();
  } finally {
    canvas.setViewportTransform(vpt);
    if (ed.bgRect) ed.bgRect.set('shadow', shadow);
    canvas.requestRenderAll();
  }
}

// a Blob, not a data URL: a 2x story png is ~15MB of base64, which mobile
// safari will not reliably hand to a download link
export async function renderPNGBlob(scale) {
  try { await document.fonts.ready; } catch {}
  return renderArtboard(() => ed.canvas.toBlob({
    left: 0, top: 0, width: ed.docW, height: ed.docH, format: 'png', multiplier: scale,
  }));
}

// doc §8: name-1080x1350@2x.png — canvas size plus the scale, not the product
export const exportFilename = scale =>
  `${slug()}-${ed.docW}x${ed.docH}${scale > 1 ? '@' + scale + 'x' : ''}.png`;
export const projectFilename = () => `${slug()}.pasteup.json`;
export const projectBlob = () =>
  new Blob([JSON.stringify(serializeDoc())], { type: 'application/json' });

// the share sheet is the only route into Photos on iOS; fall back to a
// download link everywhere else. must be called straight from a tap.
export async function saveFile(blob, filename) {
  const type = blob.type || 'application/octet-stream';
  try {
    const file = new File([blob], filename, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
    // any other share failure falls through to the download link
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

const slug = () => ed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flyer';

// swap an image's pixels (erase result); keeps transforms, one undo entry
export async function swapImageSource(obj, dataURL) {
  await obj.setSrc(dataURL);
  obj.setCoords();
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers');
}

// crop: the new pixels are a sub-rectangle of the old ones, so the layer has to
// move by that offset at the current scale — otherwise trimming the left edge
// slides the whole photo left and everything you'd lined it up with is off.
export async function cropImageSource(obj, dataURL, off) {
  const sx = obj.scaleX, sy = obj.scaleY;
  const rad = ((obj.angle || 0) * Math.PI) / 180;
  const dx = off.x * sx, dy = off.y * sy;
  await obj.setSrc(dataURL);
  obj.set({
    scaleX: sx, scaleY: sy,
    left: obj.left + dx * Math.cos(rad) - dy * Math.sin(rad),
    top: obj.top + dx * Math.sin(rad) + dy * Math.cos(rad),
  });
  obj.setCoords();
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers'); emit('selection');
}

