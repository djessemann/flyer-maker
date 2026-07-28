// boot: home screen, view switching, top bars, tools, keyboard, import, pwa bits
import { on, emit } from './bus.js';
import { listProjects, getDoc, removeProject, duplicateProject, newId, saveProject, timeAgo } from './store.js';
import { initFonts } from './fonts.js';
import {
  ed, initEditor, newDoc, openDoc, closeDoc, flushSave, setTool,
  undo, redo, canUndo, canRedo, cycleZoom, zoomLevel, fit, nudge, deleteObject,
  addImageFromFile, PRESETS, markDirty,
} from './editor.js';
import {
  initPanels, initSampling, openPanelTab, closeSheet, closePops,
  openShapeMenu, showToast,
} from './panels.js';
import { initRetouch } from './retouch.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

boot();

async function boot() {
  await initFonts();
  initEditor();
  initPanels();
  initSampling();
  initRetouch();
  wireHome();
  wireTopbar();
  wireTools();
  wireKeyboard();
  makeTouchIcon();
  await renderHome();

  if (location.protocol !== 'file:' && 'serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('./sw.js').catch(() => {}); } catch {}
  }
}

/* ---------- views ---------- */

function show(view) {
  $('#viewHome').classList.toggle('on', view === 'home');
  $('#viewEditor').classList.toggle('on', view === 'editor');
}

/* ---------- home ---------- */

async function renderHome() {
  const metas = await listProjects();
  const grid = $('#projectGrid');
  grid.innerHTML = metas.map(m => `
    <button class="proj" data-id="${m.id}">
      <span class="pthumb" style="${m.thumb ? `background-image:url('${m.thumb}')` : ''}"></span>
      <span class="pname">${escapeHtml(m.name)}</span>
      <span class="pmeta">${timeAgo(m.updatedAt)}</span>
    </button>`).join('');
  $('#homeEmpty').classList.toggle('hidden', metas.length > 0);
}

function wireHome() {
  const grid = $('#projectGrid');
  let pressTimer = null, pressFired = false;

  grid.addEventListener('click', async e => {
    const card = e.target.closest('[data-id]');
    if (!card || pressFired) { pressFired = false; return; }
    const doc = await getDoc(card.dataset.id);
    if (!doc) { showToast("couldn't open that flyer"); return; }
    show('editor');
    await openDoc(card.dataset.id, doc);
  });

  // long-press a card for duplicate / delete
  grid.addEventListener('pointerdown', e => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    pressFired = false;
    pressTimer = setTimeout(() => {
      pressFired = true;
      homeCardMenu(card.dataset.id, e.clientX, e.clientY);
    }, 550);
  });
  const cancel = () => clearTimeout(pressTimer);
  grid.addEventListener('pointermove', cancel);
  grid.addEventListener('pointerup', () => setTimeout(cancel, 0));
  grid.addEventListener('pointercancel', cancel);
  grid.addEventListener('contextmenu', e => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    e.preventDefault();
    pressFired = true;
    homeCardMenu(card.dataset.id, e.clientX, e.clientY);
  });

  $('#btnNew').addEventListener('click', newFlyerMenu);
  $('#btnImport').addEventListener('click', () => {
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
        showToast("couldn't read that project file");
      }
    };
    input.click();
  });
}

function homeCardMenu(id, x, y) {
  const pop = $('#popMenu');
  pop.innerHTML = `<div class="menu">
    <button class="srow" data-a="dup"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="5" y="5" width="9" height="9"/><path d="M11 2 H2 V11"/></svg>duplicate</button>
    <button class="srow danger" data-a="del"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 4.5 H13 M6.5 4.5 V3 H9.5 V4.5 M4.5 4.5 L5.2 13.5 H10.8 L11.5 4.5"/></svg>delete</button>
  </div>`;
  pop.classList.add('open');
  if (innerWidth >= 700) {
    pop.style.left = Math.min(x, innerWidth - 200) + 'px';
    pop.style.top = Math.min(y, innerHeight - 140) + 'px';
    pop.style.right = 'auto'; pop.style.bottom = 'auto';
  }
  pop.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', async () => {
    closePops();
    if (b.dataset.a === 'dup') await duplicateProject(id);
    if (b.dataset.a === 'del') await removeProject(id);
    renderHome();
  }));
}

function newFlyerMenu() {
  const pop = $('#popMenu');
  pop.innerHTML = `<div class="menu">
    ${PRESETS.map(p => `<button class="srow" data-p="${p.key}">${p.label}<span class="dim" style="margin-left:auto;color:var(--mut2);font-size:12px">${p.w} × ${p.h}</span></button>`).join('')}
  </div>`;
  pop.classList.add('open');
  const btn = $('#btnNew').getBoundingClientRect();
  if (innerWidth >= 700) {
    pop.style.left = (btn.right - 240) + 'px';
    pop.style.top = (btn.bottom + 8) + 'px';
    pop.style.right = 'auto'; pop.style.bottom = 'auto';
    pop.style.minWidth = '240px';
  }
  pop.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', async () => {
    closePops();
    const p = PRESETS.find(x => x.key === b.dataset.p);
    show('editor');
    await newDoc({ w: p.w, h: p.h });
  }));
}

/* ---------- editor top bar ---------- */

function wireTopbar() {
  $('#btnBack').addEventListener('click', async () => {
    closeSheet(); closePops();
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
    input.focus(); input.select();
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
  $('#btnExportTop').addEventListener('click', () => openPanelTab('canvas'));
  $('#btnExportPhone').addEventListener('click', () => openPanelTab('canvas'));

  on('history', () => {
    $('#btnUndo').classList.toggle('dim', !canUndo());
    $('#btnRedo').classList.toggle('dim', !canRedo());
  });
  on('zoom', () => {
    $('#btnZoom').textContent = Math.round(zoomLevel() * 100) + '%';
  });
  on('doc:open', () => {
    $('#docTitle').textContent = ed.name;
    $('#btnUndo').classList.add('dim');
    $('#btnRedo').classList.add('dim');
  });
}

/* ---------- tools ---------- */

function wireTools() {
  $$('[data-tool]').forEach(btn => btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    if (tool === 'shape') { setTool('move'); openShapeMenu(btn); return; }
    if (tool === 'image') {
      setTool('move');
      const input = $('#fileImage');
      input.onchange = async () => {
        const file = input.files[0];
        input.value = '';
        if (file) await addImageFromFile(file);
      };
      input.click();
      return;
    }
    if (tool === 'retouch') {
      setTool('move');
      const o = ed.canvas.getActiveObject();
      if (o && o.pKind === 'image') emit('retouch:open', o);
      else showToast('select a photo first');
      return;
    }
    if (tool === 'settings') { setTool('move'); openPanelTab('canvas'); return; }
    setTool(tool);
    if (tool === 'text') showToast('tap the canvas to add text');
  }));

  on('tool', tool => {
    const hl = tool === 'shape' ? 'shape' : (tool === 'text' ? 'text' : 'move');
    $$('[data-tool]').forEach(b =>
      b.classList.toggle('on', b.dataset.tool === hl));
  });
}

/* ---------- keyboard ---------- */

function wireKeyboard() {
  addEventListener('keydown', e => {
    if (!ed.open) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const o = ed.canvas.getActiveObject();
    if (o && o.isEditing) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (o) { e.preventDefault(); deleteObject(o); }
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[e.key]) {
      e.preventDefault();
      nudge(...map[e.key]);
    }
  });

  addEventListener('beforeunload', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}

/* ---------- pwa touch icon (generated, like journal-app) ---------- */

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
  // artboard
  ctx.strokeRect(S * 0.22, S * 0.14, S * 0.56, S * 0.72);
  // photo block
  ctx.fillStyle = '#111110';
  ctx.fillRect(S * 0.30, S * 0.24, S * 0.40, S * 0.28);
  // headline lines
  ctx.fillRect(S * 0.30, S * 0.60, S * 0.40, S * 0.055);
  ctx.fillRect(S * 0.30, S * 0.70, S * 0.26, S * 0.055);
  $('#touch-icon').href = c.toDataURL('image/png');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
