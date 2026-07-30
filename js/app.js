// boot: home screen, view switching, top bar, keyboard, pwa bits
import { on } from './bus.js';
import { listProjects, getDoc, removeProject, duplicateProject, newId, saveProject, timeAgo } from './store.js';
import { initFonts } from './fonts.js';
import {
  ed, initEditor, newDoc, openDoc, closeDoc, flushSave,
  undo, redo, canUndo, canRedo, cycleZoom, zoomLevel, nudge, deleteObject,
  PRESETS, markDirty, tuneAllHandles,
} from './editor.js';
import { initUI, closeSheet, showToast, sheetExport } from './ui.js';
import { initRetouch } from './retouch.js';
import { initCrop } from './crop.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

boot();

async function boot() {
  await initFonts();
  initEditor();
  initUI();
  initRetouch();
  initCrop();
  wireHome();
  wireTopbar();
  wireKeyboard();
  makeTouchIcon();
  await renderHome();

  if (location.protocol !== 'file:' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

const show = view => {
  $('#viewHome').classList.toggle('on', view === 'home');
  $('#viewEditor').classList.toggle('on', view === 'editor');
};

/* ---------- home ---------- */

async function renderHome() {
  const metas = await listProjects();
  $('#projectGrid').innerHTML = metas.map(m => `
    <button class="proj" data-id="${m.id}">
      <span class="pthumb" style="${m.thumb ? `background-image:url('${m.thumb}')` : ''}"></span>
      <span class="pname">${esc(m.name)}</span>
      <span class="pmeta">${timeAgo(m.updatedAt)}</span>
    </button>`).join('');
  $('#homeEmpty').classList.toggle('hidden', metas.length > 0);
}

function wireHome() {
  const grid = $('#projectGrid');
  let pressTimer = null, longFired = false;

  grid.addEventListener('click', async e => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    if (longFired) { longFired = false; return; }
    const doc = await getDoc(card.dataset.id);
    if (!doc) { showToast("couldn't open that flyer"); return; }
    show('editor');
    await openDoc(card.dataset.id, doc);
  });

  grid.addEventListener('pointerdown', e => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    longFired = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { longFired = true; projectMenu(card.dataset.id); }, 550);
  });
  const cancel = () => clearTimeout(pressTimer);
  grid.addEventListener('pointermove', cancel);
  grid.addEventListener('pointerup', cancel);
  grid.addEventListener('pointercancel', cancel);
  grid.addEventListener('contextmenu', e => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    e.preventDefault();
    longFired = true;
    projectMenu(card.dataset.id);
  });

  $('#btnNew').addEventListener('click', newFlyerSheet);
  $('#btnImport').addEventListener('click', importProject);
}

function newFlyerSheet() {
  buildSheet('new flyer', PRESETS.map(p => `
    <button class="srow" data-p="${p.key}">${p.label}<span class="dim">${p.w} × ${p.h}</span></button>`).join(''),
    root => root.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', async () => {
      const p = PRESETS.find(x => x.key === b.dataset.p);
      closeSheet();
      show('editor');
      await newDoc({ w: p.w, h: p.h });
    })));
}

function projectMenu(id) {
  buildSheet('flyer', `
    <button class="srow" data-m="open">open</button>
    <button class="srow" data-m="dup">duplicate</button>
    <button class="srow danger" data-m="del">delete</button>`,
    root => root.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', async () => {
      const m = b.dataset.m;
      closeSheet();
      if (m === 'open') {
        const doc = await getDoc(id);
        if (doc) { show('editor'); await openDoc(id, doc); }
      }
      if (m === 'dup') { await duplicateProject(id); await renderHome(); }
      if (m === 'del') { await removeProject(id); await renderHome(); }
    })));
}

// minimal sheet driver for home-screen menus (the editor uses ui.js sheets)
function buildSheet(title, html, wire) {
  const sheet = $('#sheet'), overlay = $('#overlay');
  $('#sheetTitle').textContent = title;
  $('#sheetBack').classList.add('hidden');
  const body = $('#sheetBody');
  body.innerHTML = html;
  sheet.classList.add('on');
  overlay.classList.add('on');
  wire(body);
}

function importProject() {
  const input = $('#fileProject');
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const doc = JSON.parse(await file.text());
      if (doc.app !== 'pasteup') throw new Error('not a pasteup file');
      const id = newId();
      await saveProject({ id, name: doc.name || 'imported flyer', updatedAt: Date.now(), thumb: '' }, doc);
      show('editor');
      await openDoc(id, doc);
    } catch {
      showToast("that doesn't look like a pasteup project file");
    }
  };
  input.click();
}

/* ---------- editor top bar ---------- */

function wireTopbar() {
  $('#btnBack').addEventListener('click', async () => {
    closeSheet();
    closeDoc();
    show('home');
    await renderHome();
  });

  const title = $('#docTitle');
  title.addEventListener('click', () => {
    const input = document.createElement('input');
    input.className = 'doc-title-input';
    input.value = ed.name;
    title.replaceWith(input);
    input.focus();
    input.select();
    const done = () => {
      ed.name = input.value.trim() || 'untitled flyer';
      title.textContent = ed.name;
      input.replaceWith(title);
      markDirty();
    };
    input.addEventListener('blur', done);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });

  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnZoom').addEventListener('click', cycleZoom);
  $('#btnExport').addEventListener('click', sheetExport);

  on('history', () => {
    $('#btnUndo').classList.toggle('dim', !canUndo());
    $('#btnRedo').classList.toggle('dim', !canRedo());
  });
  on('zoom', () => {
    $('#btnZoom').textContent = Math.round(zoomLevel() * 100) + '%';
    tuneAllHandles();
  });
  on('doc:open', () => {
    $('#docTitle').textContent = ed.name;
    $('#btnUndo').classList.add('dim');
    $('#btnRedo').classList.add('dim');
  });
}

/* ---------- hardware keyboard ---------- */

function wireKeyboard() {
  addEventListener('keydown', e => {
    if (!ed.open) return;
    // the full-screen modes own the screen and have their own controls
    if (document.querySelector('#retouch').classList.contains('on')) return;
    if (document.querySelector('#crop').classList.contains('on')) return;
    // only text entry should swallow shortcuts — a focused slider used to kill
    // undo entirely, which is exactly when you want it
    const t = e.target;
    const typing = t && (t.tagName === 'TEXTAREA'
      || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type)));
    if (typing) return;
    const o = ed.canvas.getActiveObject();
    if (o && o.isEditing) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (o) { e.preventDefault(); deleteObject(o); }
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[e.key]) { e.preventDefault(); nudge(...map[e.key]); }
  });

  addEventListener('beforeunload', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}

/* ---------- generated home-screen icon ---------- */

function makeTouchIcon() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#F8F7F4';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#111110';
  ctx.lineWidth = 16;
  ctx.lineCap = 'square';
  ctx.strokeRect(S * 0.22, S * 0.14, S * 0.56, S * 0.72);
  ctx.fillStyle = '#111110';
  ctx.fillRect(S * 0.30, S * 0.24, S * 0.40, S * 0.28);
  ctx.fillRect(S * 0.30, S * 0.60, S * 0.40, S * 0.055);
  ctx.fillRect(S * 0.30, S * 0.70, S * 0.26, S * 0.055);
  $('#touch-icon').href = c.toDataURL('image/png');
}
