// IndexedDB persistence via idb-keyval: project metas, full docs, app settings
import { createStore, get, set, del } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6.3.0/+esm';

const kv = createStore('pasteup', 'kv');

const META_KEY = 'projects';

export async function listProjects() {
  return (await get(META_KEY, kv)) || [];
}

export async function getDoc(id) {
  return get('doc:' + id, kv);
}

export async function saveProject(meta, doc) {
  const metas = await listProjects();
  const i = metas.findIndex(m => m.id === meta.id);
  if (i >= 0) metas[i] = meta; else metas.unshift(meta);
  metas.sort((a, b) => b.updatedAt - a.updatedAt);
  await set('doc:' + meta.id, doc, kv);
  await set(META_KEY, metas, kv);
}

export async function removeProject(id) {
  const metas = (await listProjects()).filter(m => m.id !== id);
  await set(META_KEY, metas, kv);
  await del('doc:' + id, kv);
}

export async function duplicateProject(id) {
  const metas = await listProjects();
  const src = metas.find(m => m.id === id);
  const doc = await getDoc(id);
  if (!src || !doc) return null;
  const copy = { ...src, id: newId(), name: src.name + ' copy', updatedAt: Date.now() };
  await saveProject(copy, structuredClone(doc));
  return copy;
}

export async function getSettings() {
  return (await get('settings', kv)) || {};
}

export async function patchSettings(patch) {
  const s = await getSettings();
  Object.assign(s, patch);
  await set('settings', s, kv);
  return s;
}

export const newId = () =>
  'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'edited just now';
  if (s < 3600) return `edited ${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `edited ${Math.floor(s / 3600)}h ago`;
  return `edited ${Math.floor(s / 86400)}d ago`;
}
