// object removal — telea fast-marching inpainting, implemented directly.
// no cdn, no wasm, no 11mb download: the feature can't fail to load.
// operates on a padded region at native resolution; the page composites it back.

const KNOWN = 0, BAND = 1, INSIDE = 2;
const INF = 1e6;

// binary min-heap keyed on arrival time
class MinHeap {
  constructor() { this.t = []; this.i = []; }
  get size() { return this.i.length; }
  push(t, idx) {
    const T = this.t, I = this.i;
    T.push(t); I.push(idx);
    let c = I.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (T[p] <= T[c]) break;
      [T[p], T[c]] = [T[c], T[p]];
      [I[p], I[c]] = [I[c], I[p]];
      c = p;
    }
  }
  pop() {
    const T = this.t, I = this.i;
    const top = I[0];
    const lt = T.pop(), li = I.pop();
    if (I.length) {
      T[0] = lt; I[0] = li;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = l + 1;
        let s = p;
        if (l < I.length && T[l] < T[s]) s = l;
        if (r < I.length && T[r] < T[s]) s = r;
        if (s === p) break;
        [T[p], T[s]] = [T[s], T[p]];
        [I[p], I[s]] = [I[s], I[p]];
        p = s;
      }
    }
    return top;
  }
}

// eikonal solver over a pair of orthogonal neighbours
function solve(i1, j1, i2, j2, w, h, flags, T) {
  const in1 = i1 >= 0 && i1 < w && j1 >= 0 && j1 < h;
  const in2 = i2 >= 0 && i2 < w && j2 >= 0 && j2 < h;
  const f1 = in1 ? flags[j1 * w + i1] : INSIDE;
  const f2 = in2 ? flags[j2 * w + i2] : INSIDE;
  const t1 = in1 ? T[j1 * w + i1] : INF;
  const t2 = in2 ? T[j2 * w + i2] : INF;

  if (f1 !== INSIDE) {
    if (f2 !== INSIDE) {
      const d = 2 - (t1 - t2) * (t1 - t2);
      if (d > 0) {
        const r = Math.sqrt(d);
        let s = (t1 + t2 - r) / 2;
        if (s >= t1 && s >= t2) return s;
        s += r;
        if (s >= t1 && s >= t2) return s;
      }
      return 1 + Math.min(t1, t2);
    }
    return 1 + t1;
  }
  if (f2 !== INSIDE) return 1 + t2;
  return INF;
}

// estimate one unknown pixel from its known neighbourhood, weighted by
// distance, level-set proximity and direction along the T gradient
function estimate(i, j, w, h, flags, T, px, eps) {
  const idx = j * w + i;

  let gx = 0, gy = 0;
  const okL = i > 0 && flags[idx - 1] !== INSIDE;
  const okR = i < w - 1 && flags[idx + 1] !== INSIDE;
  if (okL && okR) gx = (T[idx + 1] - T[idx - 1]) * 0.5;
  else if (okR) gx = T[idx + 1] - T[idx];
  else if (okL) gx = T[idx] - T[idx - 1];
  const okU = j > 0 && flags[idx - w] !== INSIDE;
  const okD = j < h - 1 && flags[idx + w] !== INSIDE;
  if (okU && okD) gy = (T[idx + w] - T[idx - w]) * 0.5;
  else if (okD) gy = T[idx + w] - T[idx];
  else if (okU) gy = T[idx] - T[idx - w];

  let sr = 0, sg = 0, sb = 0, sw = 0;
  const e2 = eps * eps;
  const jlo = Math.max(0, j - eps), jhi = Math.min(h - 1, j + eps);
  const ilo = Math.max(0, i - eps), ihi = Math.min(w - 1, i + eps);

  for (let l = jlo; l <= jhi; l++) {
    for (let k = ilo; k <= ihi; k++) {
      const n = l * w + k;
      if (flags[n] === INSIDE) continue;
      const rx = i - k, ry = j - l;
      const d2 = rx * rx + ry * ry;
      if (d2 === 0 || d2 > e2) continue;
      const len = Math.sqrt(d2);
      const dst = 1 / (d2 * len);
      const lev = 1 / (1 + Math.abs(T[n] - T[idx]));
      let dir = (rx * gx + ry * gy) / len;
      if (Math.abs(dir) < 0.01) dir = 0.01;
      const wt = Math.abs(dir * dst * lev);
      const p = n * 4;
      sr += wt * px[p]; sg += wt * px[p + 1]; sb += wt * px[p + 2];
      sw += wt;
    }
  }

  if (sw > 0) {
    const p = idx * 4;
    px[p] = sr / sw; px[p + 1] = sg / sw; px[p + 2] = sb / sw; px[p + 3] = 255;
  }
}

function inpaint(px, w, h, maskBits, radius) {
  const N = w * h;
  const flags = new Uint8Array(N);
  const T = new Float32Array(N);
  let unknown = 0;
  for (let n = 0; n < N; n++) {
    if (maskBits[n]) { flags[n] = INSIDE; T[n] = INF; unknown++; }
    else { flags[n] = KNOWN; T[n] = 0; }
  }
  if (!unknown) return;

  // seed the narrow band with the known pixels hugging the mask
  const heap = new MinHeap();
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const n = j * w + i;
      if (flags[n] !== KNOWN) continue;
      const touches =
        (i > 0 && flags[n - 1] === INSIDE) ||
        (i < w - 1 && flags[n + 1] === INSIDE) ||
        (j > 0 && flags[n - w] === INSIDE) ||
        (j < h - 1 && flags[n + w] === INSIDE);
      if (touches) { flags[n] = BAND; T[n] = 0; heap.push(0, n); }
    }
  }

  // Sampling radius, chosen against a work budget. A fixed small radius leaves
  // a hard step and flat facets across a big fill, but cost grows as eps² per
  // unknown pixel — so give small holes a generous radius and large ones a
  // modest one, keeping the whole pass interactive on a 4096px photo.
  const WORK_BUDGET = 1.6e8;
  const wanted = Math.max(radius | 0, Math.sqrt(unknown / Math.PI) * 0.28);
  const affordable = Math.sqrt(WORK_BUDGET / (4 * unknown));
  const eps = Math.max(4, Math.min(14, Math.round(Math.min(wanted, affordable))));

  // march inward; every popped pixel fills its still-unknown neighbours
  while (heap.size) {
    const idx = heap.pop();
    flags[idx] = KNOWN;
    const i = idx % w, j = (idx / w) | 0;

    for (let d = 0; d < 4; d++) {
      const ni = i + (d === 0 ? -1 : d === 1 ? 1 : 0);
      const nj = j + (d === 2 ? -1 : d === 3 ? 1 : 0);
      if (ni < 0 || ni >= w || nj < 0 || nj >= h) continue;
      const n = nj * w + ni;
      if (flags[n] !== INSIDE) continue;

      T[n] = Math.min(
        solve(ni - 1, nj, ni, nj - 1, w, h, flags, T),
        solve(ni + 1, nj, ni, nj - 1, w, h, flags, T),
        solve(ni - 1, nj, ni, nj + 1, w, h, flags, T),
        solve(ni + 1, nj, ni, nj + 1, w, h, flags, T)
      );
      estimate(ni, nj, w, h, flags, T, px, eps);
      flags[n] = BAND;
      heap.push(T[n], n);
    }
  }

  smoothFill(px, w, h, maskBits, eps, unknown);
}

// Telea fills outward from the rim, which leaves a visible ridge where the new
// pixels meet the old ones and faceting deeper in. A short blur confined to the
// filled region — feathered so it fades out at the boundary — removes both
// without touching any original pixel.
function smoothFill(px, w, h, maskBits, eps, unknown) {
  // same budget logic: the blur is cheap per pixel but there can be millions
  const r = Math.max(1, Math.min(4, Math.round(Math.min(eps / 4, Math.sqrt(4e7 / (4 * unknown))))));
  const N = w * h;
  // distance from the rim, in steps, capped: used as the blend weight
  const depth = new Uint8Array(N);
  let edge = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const n = j * w + i;
      if (!maskBits[n]) continue;
      const rim = (i === 0 || !maskBits[n - 1]) || (i === w - 1 || !maskBits[n + 1])
               || (j === 0 || !maskBits[n - w]) || (j === h - 1 || !maskBits[n + w]);
      if (rim) { depth[n] = 1; edge.push(n); }
    }
  }
  const maxDepth = Math.max(2, Math.min(6, Math.round(eps / 3)));
  for (let d = 1; d < maxDepth && edge.length; d++) {
    const next = [];
    for (const n of edge) {
      const i = n % w, j = (n / w) | 0;
      for (let k = 0; k < 4; k++) {
        const ni = i + (k === 0 ? -1 : k === 1 ? 1 : 0);
        const nj = j + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (ni < 0 || ni >= w || nj < 0 || nj >= h) continue;
        const m = nj * w + ni;
        if (maskBits[m] && !depth[m]) { depth[m] = d + 1; next.push(m); }
      }
    }
    edge = next;
  }

  const src = new Float32Array(N * 3);
  for (let n = 0; n < N; n++) {
    const p = n * 4;
    src[n * 3] = px[p]; src[n * 3 + 1] = px[p + 1]; src[n * 3 + 2] = px[p + 2];
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const n = j * w + i;
      if (!maskBits[n]) continue;
      let sr = 0, sg = 0, sb = 0, c = 0;
      const jlo = Math.max(0, j - r), jhi = Math.min(h - 1, j + r);
      const ilo = Math.max(0, i - r), ihi = Math.min(w - 1, i + r);
      for (let l = jlo; l <= jhi; l++) {
        for (let k = ilo; k <= ihi; k++) {
          const m = l * w + k;
          sr += src[m * 3]; sg += src[m * 3 + 1]; sb += src[m * 3 + 2]; c++;
        }
      }
      // weight 0 at the rim rising to 1 in the interior, so the join stays put
      const wgt = Math.min(1, (depth[n] || maxDepth) / maxDepth) * 0.85;
      const p = n * 4;
      px[p] = px[p] * (1 - wgt) + (sr / c) * wgt;
      px[p + 1] = px[p + 1] * (1 - wgt) + (sg / c) * wgt;
      px[p + 2] = px[p + 2] * (1 - wgt) + (sb / c) * wgt;
    }
  }
}

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'ping') { postMessage({ type: 'ready' }); return; }
  if (msg.type !== 'inpaint') return;
  try {
    const { image, mask, radius } = msg;
    const w = image.width, h = image.height;
    const px = image.data;
    const md = mask.data;
    const bits = new Uint8Array(w * h);
    for (let n = 0, p = 3; n < bits.length; n++, p += 4) bits[n] = md[p] > 10 ? 1 : 0;
    inpaint(px, w, h, bits, radius || 5);
    postMessage({ type: 'result', patch: image }, [px.buffer]);
  } catch (err) {
    postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};

postMessage({ type: 'ready' });
