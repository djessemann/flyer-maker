// canvas engine: fabric setup, tools, gestures, zoom/pan, undo/redo, autosave, export
import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.9.1/dist/index.min.mjs';
import { emit } from './bus.js';
import { saveProject, newId } from './store.js';
import { ensureDocFonts } from './fonts.js';

export { fabric };

const PROPS = ['pName', 'pLocked', 'pKind', 'srcFormat', 'selectable', 'evented', 'rx', 'ry'];
const ZMIN = 0.1, ZMAX = 8;
export const PRESETS = [
  { key: 'ig-post', label: 'ig post', w: 1080, h: 1080 },
  { key: 'ig-story', label: 'ig story', w: 1080, h: 1920 },
  { key: 'letter', label: 'flyer · letter', w: 1275, h: 1650 },
  { key: 'a4', label: 'a4', w: 1240, h: 1754 },
];

export const ed = {
  canvas: null, id: null, name: 'untitled flyer',
  docW: 1080, docH: 1350, bgRect: null,
  tool: 'move', pendingShape: null,
  undoStack: [], redoStack: [], restoring: false,
  exportScale: 2, open: false,
};

let dirtyTimer = null, snapTimer = null, host = null;

/* ---------- init ---------- */

export function initEditor() {
  Object.assign(fabric.InteractiveFabricObject.ownDefaults, {
    borderColor: '#111110',
    cornerColor: '#F8F7F4',
    cornerStrokeColor: '#111110',
    cornerSize: 10,
    touchCornerSize: 44,
    transparentCorners: false,
    borderScaleFactor: 1.5,
    borderOpacityWhenMoving: 0.6,
    editingBorderColor: '#111110',
    cursorColor: '#111110',
  });

  host = document.querySelector('.canvas-host');
  const canvas = new fabric.Canvas('fab', {
    selection: false,               // no marquee in v1 — touch-first
    preserveObjectStacking: true,
    uniformScaling: true,           // corner drag keeps aspect
    stopContextMenu: true,
    fireRightClick: false,
    backgroundColor: '',
  });
  ed.canvas = canvas;
  sizeToHost();
  new ResizeObserver(() => { sizeToHost(); if (ed.open) fit(); }).observe(host);

  canvas.on('mouse:down', onMouseDown);
  canvas.on('selection:created', () => emit('selection'));
  canvas.on('selection:updated', () => emit('selection'));
  canvas.on('selection:cleared', () => emit('selection'));
  canvas.on('object:modified', e => { bakeScale(e.target); markDirty(true); });
  canvas.on('object:added', e => { if (!ed.restoring) styleControls(e.target); });
  canvas.on('text:changed', () => { emit('layers'); markDirty(true); });
  canvas.on('text:editing:exited', () => markDirty(true));

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
  obj.controls.mtr.offsetY = 34;
  obj.controls.mtr.withConnection = true;
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
  if (missing.length) emit('toast', `offline? couldn't load: ${missing.join(', ')}`);
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
}

export function closeDoc() {
  flushSave();
  ed.open = false;
  ed.canvas.clear();
  emit('doc:close');
}

function makeBg(fill) {
  const r = new fabric.Rect({
    left: 0, top: 0, width: ed.docW, height: ed.docH, fill,
    selectable: false, evented: false, hoverCursor: 'default',
    pKind: 'bg', pName: 'background', pLocked: true,
    shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.18)', blur: 40, offsetY: 14 }),
  });
  return r;
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
  canvas.sendObjectToBack(ed.bgRect);
  canvas.getObjects().forEach(o => {
    styleControls(o);
    if (o.pLocked && o.pKind !== 'bg') o.set({ selectable: false, evented: false });
  });
  ed.restoring = false;
  canvas.requestRenderAll();
}

/* ---------- persistence ---------- */

export function docFonts() {
  const seen = new Map();
  ed.canvas.getObjects().forEach(o => {
    if (o.fontFamily) seen.set(o.fontFamily + '|' + (o.fontWeight || 400),
      { family: o.fontFamily, weight: o.fontWeight || 400 });
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
    thumb = ed.canvas.toDataURL({
      left: 0, top: 0, width: ed.docW, height: ed.docH,
      format: 'jpeg', quality: 0.65, multiplier: 280 / ed.docW,
    });
  } catch {}
  await saveProject({ id: ed.id, name: ed.name, updatedAt: Date.now(), thumb }, doc);
}

/* ---------- undo / redo ---------- */

function snapshotState() {
  return { fabric: ed.canvas.toObject(PROPS), w: ed.docW, h: ed.docH };
}

export function pushSnapshot() {
  if (ed.restoring) return;
  clearTimeout(snapTimer);
  ed.undoStack.push(snapshotState());
  if (ed.undoStack.length > 40) ed.undoStack.shift();
  ed.redoStack = [];
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
  await ed.canvas.loadFromJSON(s.fabric);
  afterRestore();
  if (sizeChanged) fit();
  emit('layers'); emit('selection'); emit('history'); emit('doc:change');
  markDirty();
}

/* ---------- zoom / pan ---------- */

export function zoomLevel() { return ed.canvas.viewportTransform[0]; }

export function fit() {
  const canvas = ed.canvas;
  const pad = canvas.width < 700 ? 36 : 80;
  const z = clamp(Math.min((canvas.width - pad) / ed.docW, (canvas.height - pad) / ed.docH), ZMIN, ZMAX);
  canvas.setViewportTransform([z, 0, 0, z,
    (canvas.width - ed.docW * z) / 2, (canvas.height - ed.docH * z) / 2]);
  canvas.requestRenderAll();
  emit('zoom');
}

export function cycleZoom() {
  const z = zoomLevel();
  const canvas = ed.canvas;
  const pad = canvas.width < 700 ? 36 : 80;
  const fitZ = Math.min((canvas.width - pad) / ed.docW, (canvas.height - pad) / ed.docH);
  if (Math.abs(z - fitZ) < 0.01) {
    const c = new fabric.Point(canvas.width / 2, canvas.height / 2);
    canvas.zoomToPoint(c, 1);
    canvas.requestRenderAll();
    emit('zoom');
  } else {
    fit();
  }
}

function wireGestures(canvas) {
  const el = canvas.upperCanvasEl;
  let g = null;

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
      canvas._currentTransform = null;   // abort any in-progress object drag
      canvas.skipTargetFind = true;
      const p = pts(e.touches);
      g = { d0: dist(p), m0: local(mid(p)), vpt: [...canvas.viewportTransform] };
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
    if (g && e.touches.length < 2) {
      g = null;
      canvas.skipTargetFind = false;
    }
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

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- tools ---------- */

export function setTool(tool) {
  ed.tool = tool;
  if (tool !== 'shape') ed.pendingShape = null;
  emit('tool', tool);
}

function onMouseDown(opt) {
  const canvas = ed.canvas;
  const p = canvas.getScenePoint(opt.e);
  if (ed.tool === 'text') {
    addTextAt(p);
    setTool('move');
    return;
  }
  if (ed.tool === 'shape' && ed.pendingShape) {
    addShapeAt(ed.pendingShape, p);
    setTool('move');
    return;
  }
  if (!opt.target) {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }
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
    return t ? (t.length > 14 ? t.slice(0, 14) + '…' : t) : 'text';
  }
  return 'layer';
}

export function addTextAt(p) {
  const tb = new fabric.Textbox('type…', {
    left: p.x - 130, top: p.y - 30, width: 260,
    fontSize: 48, fontFamily: 'DM Mono', fontWeight: 400, fill: '#111110',
    pKind: 'text',
  });
  ed.canvas.add(tb);
  ed.canvas.setActiveObject(tb);
  styleControls(tb);
  ed.canvas.requestRenderAll();
  tb.enterEditing();
  tb.selectAll();
  pushSnapshot(); markDirty();
  emit('layers');
  return tb;
}

export function armShape(kind) {
  ed.pendingShape = kind;
  ed.tool = 'shape';
  emit('tool', 'shape');
}

export function addShapeAt(kind, p) {
  let obj;
  const common = { fill: '#111110', stroke: null, strokeWidth: 0, strokeUniform: true };
  if (kind === 'rect') obj = new fabric.Rect({ ...common, left: p.x - 120, top: p.y - 120, width: 240, height: 240 });
  if (kind === 'rounded') obj = new fabric.Rect({ ...common, left: p.x - 120, top: p.y - 120, width: 240, height: 240, rx: 28, ry: 28 });
  if (kind === 'ellipse') obj = new fabric.Ellipse({ ...common, left: p.x - 120, top: p.y - 120, rx: 120, ry: 120 });
  if (kind === 'line') obj = new fabric.Line([p.x - 120, p.y, p.x + 120, p.y], { stroke: '#111110', strokeWidth: 6, strokeUniform: true });
  if (!obj) return;
  obj.set({ pKind: kind, pName: autoName(kind) });
  ed.canvas.add(obj);
  ed.canvas.setActiveObject(obj);
  styleControls(obj);
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers');
  return obj;
}

// file → dataURL, downscaled to <=4096 on the long side. returns {url, format, scaled}
export async function fileToDataURL(file) {
  let bmp = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise((res, rej) => {
      const u = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode failed')); };
      img.src = u;
    });
  }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
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
    emit('toast', "couldn't read that image — try jpeg or png");
    return null;
  }
  if (data.scaled) emit('toast', 'large photo downscaled to 4096px');
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
  emit('layers');
  return img;
}

export async function replaceImage(obj, file) {
  let data;
  try {
    data = await fileToDataURL(file);
  } catch {
    emit('toast', "couldn't read that image — try jpeg or png");
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
  obj.set({ scaleX: s, scaleY: s, left: (ed.docW - obj.width * s) / 2, top: (ed.docH - obj.height * s) / 2, angle: 0 });
  obj.setCoords();
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
}

export async function duplicateObject(obj) {
  const clone = await obj.clone(PROPS);
  clone.set({ left: obj.left + 18, top: obj.top + 18 });
  if (clone.pName) clone.pName = autoName(clone.pKind);
  ed.canvas.add(clone);
  styleControls(clone);
  ed.canvas.setActiveObject(clone);
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers');
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
  c.sendObjectToBack(ed.bgRect);
  c.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers');
}

export function moveToIndex(obj, idx) {
  ed.canvas.moveObjectTo(obj, idx);
  ed.canvas.sendObjectToBack(ed.bgRect);
  ed.canvas.requestRenderAll();
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

export function nudge(dx, dy) {
  const o = ed.canvas.getActiveObject();
  if (!o) return;
  o.set({ left: o.left + dx, top: o.top + dy });
  o.setCoords();
  ed.canvas.requestRenderAll();
  markDirty(true);
}

// bake scale into intrinsic dims so radius/stroke/font stay honest after resize
function bakeScale(o) {
  if (!o) return;
  if (o.pKind === 'text' && (o.scaleX !== 1 || o.scaleY !== 1)) {
    o.set({
      fontSize: Math.round(o.fontSize * o.scaleY * 10) / 10,
      width: o.width * o.scaleX,
      scaleX: 1, scaleY: 1,
    });
    o.setCoords();
  } else if ((o.pKind === 'rect' || o.pKind === 'rounded') && (o.scaleX !== 1 || o.scaleY !== 1)) {
    o.set({ width: o.width * o.scaleX, height: o.height * o.scaleY, scaleX: 1, scaleY: 1 });
    o.setCoords();
  } else if (o.pKind === 'ellipse' && (o.scaleX !== 1 || o.scaleY !== 1)) {
    o.set({ rx: o.rx * o.scaleX, ry: o.ry * o.scaleY, scaleX: 1, scaleY: 1 });
    o.setCoords();
  }
}

/* ---------- canvas settings ---------- */

export function resizeDoc(w, h) {
  ed.docW = clamp(Math.round(w) || ed.docW, 100, 6000);
  ed.docH = clamp(Math.round(h) || ed.docH, 100, 6000);
  ed.bgRect.set({ left: 0, top: 0, width: ed.docW, height: ed.docH });
  ed.bgRect.setCoords();
  fit();
  pushSnapshot(); markDirty();
  emit('doc:change');
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

export function maxExportScale() {
  return Math.max(1, Math.floor(6000 / Math.max(ed.docW, ed.docH)));
}

export async function exportPNG(scale) {
  const canvas = ed.canvas;
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  try { await document.fonts.ready; } catch {}
  const shadow = ed.bgRect.shadow;
  ed.bgRect.set('shadow', null);
  const url = canvas.toDataURL({
    left: 0, top: 0, width: ed.docW, height: ed.docH,
    format: 'png', multiplier: scale,
  });
  ed.bgRect.set('shadow', shadow);
  canvas.requestRenderAll();
  const slug = ed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flyer';
  download(url, `${slug}-${ed.docW}x${ed.docH}@${scale}x.png`);
}

export function saveProjectFile() {
  const doc = serializeDoc();
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const slug = ed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flyer';
  download(url, `${slug}.pasteup.json`);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function download(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// swap an image's pixels (retouch result). keeps transforms; one undo entry.
export async function swapImageSource(obj, dataURL) {
  await obj.setSrc(dataURL);
  obj.setCoords();
  ed.canvas.requestRenderAll();
  pushSnapshot(); markDirty();
  emit('layers');
}
