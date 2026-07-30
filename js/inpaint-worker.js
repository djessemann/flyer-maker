// content-aware fill — multi-scale PatchMatch image completion.
// no cdn, no wasm, no dependency: the feature can't fail to load.
//
// The previous implementation was Telea fast-marching, which fills a hole by
// propagating colour inward from its rim. That is right for a scratch and wrong
// for a person: with nothing but an average to propagate, anything textured came
// back as a radial smear (measured 22.8/255 mean error against ground truth).
//
// This copies *real patches* from elsewhere in the same photo. For each small
// square overlapping the hole it finds the most similar square in the untouched
// part of the image, then rebuilds the hole out of what those squares actually
// contain. Grass stays grass, brick stays brick.
//
// Barnes et al. 2009 for the nearest-neighbour search, Wexler et al. 2007 for
// the iterate-and-vote structure. Runs on a padded region at reduced scale, then
// applies the final correspondences at full resolution so the result is sharp.

const PATCH = 7;
const HALF = (PATCH - 1) / 2;
const WORK_MAX = 384;   // long side of the working region; full res is too slow
const ITERS = 6;        // propagate + random-search sweeps per pyramid level

/* ---------------- small helpers ---------------- */

// deterministic rng: a fixed seed makes results reproducible, so a measured
// improvement is a real one and not a lucky roll
let seed = 0x2f6e2b1;
function rnd() {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) % 100000) / 100000;
}

// rgb planes as floats, so repeated averaging doesn't quantise
function toPlanes(rgba, n) {
  const p = new Float32Array(n * 3);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    p[i * 3] = rgba[j]; p[i * 3 + 1] = rgba[j + 1]; p[i * 3 + 2] = rgba[j + 2];
  }
  return p;
}

function halveImage(src, w, h) {
  const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1);
  const out = new Float32Array(w2 * h2 * 3);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1);
      const y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1);
      for (let c = 0; c < 3; c++) {
        out[(y * w2 + x) * 3 + c] = 0.25 * (
          src[(y0 * w + x0) * 3 + c] + src[(y0 * w + x1) * 3 + c] +
          src[(y1 * w + x0) * 3 + c] + src[(y1 * w + x1) * 3 + c]);
      }
    }
  }
  return { data: out, w: w2, h: h2 };
}

// a coarse pixel is a hole if ANY of its four fine pixels was: never treat
// unknown pixels as known, or the fill quietly seeds itself from the object
function halveMask(m, w, h) {
  const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1);
  const out = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1);
      const y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1);
      out[y * w2 + x] = (m[y0 * w + x0] || m[y0 * w + x1] ||
                         m[y1 * w + x0] || m[y1 * w + x1]) ? 1 : 0;
    }
  }
  return { data: out, w: w2, h: h2 };
}

function upscaleImage(src, w, h, w2, h2) {
  const out = new Float32Array(w2 * h2 * 3);
  for (let y = 0; y < h2; y++) {
    const sy = Math.min(h - 1, y >> 1);
    for (let x = 0; x < w2; x++) {
      const sx = Math.min(w - 1, x >> 1);
      for (let c = 0; c < 3; c++) out[(y * w2 + x) * 3 + c] = src[(sy * w + sx) * 3 + c];
    }
  }
  return out;
}

/* ---------------- where a patch may be copied FROM ---------------- */

// a source patch must sit entirely in untouched pixels — otherwise the fill
// starts quoting itself and the object reappears smeared across the hole
function buildValid(mask, w, h) {
  const ii = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      ii[(y + 1) * (w + 1) + x + 1] = mask[y * w + x]
        + ii[y * (w + 1) + x + 1] + ii[(y + 1) * (w + 1) + x] - ii[y * (w + 1) + x];
    }
  }
  const boxSum = (x0, y0, x1, y1) =>
    ii[(y1 + 1) * (w + 1) + x1 + 1] - ii[y0 * (w + 1) + x1 + 1]
    - ii[(y1 + 1) * (w + 1) + x0] + ii[y0 * (w + 1) + x0];

  const valid = new Uint8Array(w * h);
  const list = [];
  for (let y = HALF; y < h - HALF; y++) {
    for (let x = HALF; x < w - HALF; x++) {
      if (boxSum(x - HALF, y - HALF, x + HALF, y + HALF) === 0) {
        valid[y * w + x] = 1;
        list.push(y * w + x);
      }
    }
  }
  return { valid, list };
}

/* ---------------- patch distance ---------------- */

function patchDist(img, w, ax, ay, bx, by, cutoff) {
  let d = 0;
  for (let dy = -HALF; dy <= HALF; dy++) {
    let ia = ((ay + dy) * w + ax - HALF) * 3;
    let ib = ((by + dy) * w + bx - HALF) * 3;
    for (let dx = -HALF; dx <= HALF; dx++, ia += 3, ib += 3) {
      const r = img[ia] - img[ib];
      const g = img[ia + 1] - img[ib + 1];
      const b = img[ia + 2] - img[ib + 2];
      d += r * r + g * g + b * b;
    }
    if (d > cutoff) return d;
  }
  return d;
}

/* ---------------- one pyramid level ---------------- */

// nnf holds, for every target patch, the source patch it is currently copying.
// propagate: a good offset for my neighbour is probably good for me too.
// random search: jump about with a shrinking radius so we escape local minima.
function solveLevel(img, mask, w, h, iters, nnfX, nnfY, onProgress) {
  const { valid, list } = buildValid(mask, w, h);
  if (!list.length) return null;               // nothing clean to copy from

  // targets: every patch that overlaps the hole
  const targets = [];
  for (let y = HALF; y < h - HALF; y++) {
    for (let x = HALF; x < w - HALF; x++) {
      let touches = false;
      for (let dy = -HALF; dy <= HALF && !touches; dy++) {
        for (let dx = -HALF; dx <= HALF; dx++) {
          if (mask[(y + dy) * w + x + dx]) { touches = true; break; }
        }
      }
      if (touches) targets.push(y * w + x);
    }
  }
  if (!targets.length) return null;

  const cost = new Float32Array(w * h).fill(Infinity);
  for (const t of targets) {
    const tx = t % w, ty = (t / w) | 0;
    let sx = nnfX[t], sy = nnfY[t];
    if (!(sx >= HALF && sy >= HALF && sx < w - HALF && sy < h - HALF && valid[sy * w + sx])) {
      const p = list[(rnd() * list.length) | 0];
      sx = p % w; sy = (p / w) | 0;
    }
    nnfX[t] = sx; nnfY[t] = sy;
    cost[t] = patchDist(img, w, tx, ty, sx, sy, Infinity);
  }

  const tryOne = (t, tx, ty, sx, sy) => {
    if (sx < HALF || sy < HALF || sx >= w - HALF || sy >= h - HALF) return;
    if (!valid[sy * w + sx]) return;
    const d = patchDist(img, w, tx, ty, sx, sy, cost[t]);
    if (d < cost[t]) { cost[t] = d; nnfX[t] = sx; nnfY[t] = sy; }
  };

  const maxRadius = Math.max(w, h);
  for (let it = 0; it < iters; it++) {
    const forward = (it & 1) === 0;
    for (let k = 0; k < targets.length; k++) {
      const t = targets[forward ? k : targets.length - 1 - k];
      const tx = t % w, ty = (t / w) | 0;
      const step = forward ? -1 : 1;

      // propagate from the neighbour we just improved
      const nl = t + step;
      if (nl >= 0 && nl < w * h && Math.abs((nl % w) - tx) === 1 && cost[nl] < Infinity) {
        tryOne(t, tx, ty, nnfX[nl] - step, nnfY[nl]);
      }
      const nu = t + step * w;
      if (nu >= 0 && nu < w * h && cost[nu] < Infinity) {
        tryOne(t, tx, ty, nnfX[nu], nnfY[nu] - step);
      }

      // random search around the current best
      let radius = maxRadius;
      while (radius > 1) {
        const bx = nnfX[t] + ((rnd() * 2 - 1) * radius) | 0;
        const by = nnfY[t] + ((rnd() * 2 - 1) * radius) | 0;
        tryOne(t, tx, ty, bx, by);
        radius = (radius / 2) | 0;
      }
    }
    vote(img, mask, w, h, targets, nnfX, nnfY, cost);
    if (onProgress) onProgress(it / iters);
  }
  return { targets, cost };
}

// rebuild every hole pixel from all the patches that cover it, weighted so a
// better-matching patch counts for more. This is what removes the seams: no
// pixel is decided by a single patch.
function vote(img, mask, w, h, targets, nnfX, nnfY, cost) {
  const acc = new Float32Array(w * h * 3);
  const wsum = new Float32Array(w * h);
  // scale the weighting to this image's own costs. A fixed sigma underflows
  // exp() on anything textured, every patch ends up weighted the same, and the
  // vote degenerates into a plain average — which is what we came here to stop.
  let best = Infinity;
  for (const t of targets) if (cost[t] < best) best = cost[t];
  const sigma2 = Math.max(1, best * 2 + PATCH * PATCH * 3 * 4);

  for (const t of targets) {
    const tx = t % w, ty = (t / w) | 0;
    const sx = nnfX[t], sy = nnfY[t];
    const weight = Math.exp(-cost[t] / sigma2) + 1e-6;
    for (let dy = -HALF; dy <= HALF; dy++) {
      const trow = (ty + dy) * w, srow = (sy + dy) * w;
      for (let dx = -HALF; dx <= HALF; dx++) {
        const ti = trow + tx + dx;
        if (!mask[ti]) continue;                 // never touch original pixels
        const si = (srow + sx + dx) * 3;
        acc[ti * 3] += img[si] * weight;
        acc[ti * 3 + 1] += img[si + 1] * weight;
        acc[ti * 3 + 2] += img[si + 2] * weight;
        wsum[ti] += weight;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || wsum[i] === 0) continue;
    img[i * 3] = acc[i * 3] / wsum[i];
    img[i * 3 + 1] = acc[i * 3 + 1] / wsum[i];
    img[i * 3 + 2] = acc[i * 3 + 2] / wsum[i];
  }
}

/* ---------------- coarse seed ---------------- */

// The hole starts as real photo, not as an average. Seeding it by diffusing
// neighbouring colour inward gives a smooth blob, and then every patch match is
// scored against that blob: smooth patches match it best, so the fill settles
// into the smear it started from and never escapes. Seeding with actual patches
// copied from the untouched photo starts it in the right neighbourhood instead.
function seedHole(img, mask, w, h) {
  const { list } = buildValid(mask, w, h);
  if (!list.length) return diffuseSeed(img, mask, w, h);
  for (let y = 0; y < h; y += PATCH) {
    for (let x = 0; x < w; x += PATCH) {
      let any = false;
      for (let dy = 0; dy < PATCH && !any; dy++) {
        for (let dx = 0; dx < PATCH; dx++) {
          const i = (y + dy) * w + x + dx;
          if (y + dy < h && x + dx < w && mask[i]) { any = true; break; }
        }
      }
      if (!any) continue;
      const p = list[(rnd() * list.length) | 0];
      const sx = p % w, sy = (p / w) | 0;
      for (let dy = 0; dy < PATCH; dy++) {
        for (let dx = 0; dx < PATCH; dx++) {
          const ty = y + dy, tx = x + dx;
          if (ty >= h || tx >= w) continue;
          const ti = ty * w + tx;
          if (!mask[ti]) continue;
          const syy = Math.min(h - 1, Math.max(0, sy - HALF + dy));
          const sxx = Math.min(w - 1, Math.max(0, sx - HALF + dx));
          const si = syy * w + sxx;
          if (mask[si]) continue;
          img[ti * 3] = img[si * 3];
          img[ti * 3 + 1] = img[si * 3 + 1];
          img[ti * 3 + 2] = img[si * 3 + 2];
        }
      }
    }
  }
}

// last resort when the hole leaves nothing clean to copy: average inward
function diffuseSeed(img, mask, w, h) {
  const m = Uint8Array.from(mask);
  for (let pass = 0; pass < 40; pass++) {
    let filled = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!m[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (m[j]) continue;
            r += img[j * 3]; g += img[j * 3 + 1]; b += img[j * 3 + 2]; n++;
          }
        }
        if (n) { img[i * 3] = r / n; img[i * 3 + 1] = g / n; img[i * 3 + 2] = b / n; m[i] = 0; filled++; }
      }
    }
    if (!filled) break;
  }
}

/* ---------------- the whole job ---------------- */

function complete(rgba, w, h, maskBits, report = () => {}) {
  const n = w * h;
  let holes = 0;
  for (let i = 0; i < n; i++) if (maskBits[i]) holes++;
  if (!holes) return;

  // work at a reduced size: patch search is O(area) per iteration and a person
  // on a 4096px photo would take minutes at full resolution
  let levels = [{ img: toPlanes(rgba, n), mask: Uint8Array.from(maskBits), w, h }];
  while (Math.max(levels[0].w, levels[0].h) > WORK_MAX) {
    const im = halveImage(levels[0].img, levels[0].w, levels[0].h);
    const mk = halveMask(levels[0].mask, levels[0].w, levels[0].h);
    levels.unshift({ img: im.data, mask: mk.data, w: im.w, h: im.h });
    levels.splice(1, 1);                       // only keep the working size
  }
  const full = { img: toPlanes(rgba, n), w, h, mask: maskBits };
  const work = levels[0];
  // the real ratio, read off what halving actually produced
  const scale = work.w / w;

  // pyramid down from the working size so the coarse structure is decided first
  const pyr = [work];
  while (Math.min(pyr[0].w, pyr[0].h) > 48) {
    const im = halveImage(pyr[0].img, pyr[0].w, pyr[0].h);
    const mk = halveMask(pyr[0].mask, pyr[0].w, pyr[0].h);
    pyr.unshift({ img: im.data, mask: mk.data, w: im.w, h: im.h });
  }

  seedHole(pyr[0].img, pyr[0].mask, pyr[0].w, pyr[0].h);

  let nnfX = null, nnfY = null, solved = null;
  for (let l = 0; l < pyr.length; l++) {
    const lv = pyr[l];
    const nx = new Int32Array(lv.w * lv.h);
    const ny = new Int32Array(lv.w * lv.h);
    if (nnfX) {
      // carry the correspondences up from the coarser level
      const pw = pyr[l - 1].w, ph = pyr[l - 1].h;
      for (let y = 0; y < lv.h; y++) {
        const sy = Math.min(ph - 1, y >> 1);
        for (let x = 0; x < lv.w; x++) {
          const sx = Math.min(pw - 1, x >> 1);
          nx[y * lv.w + x] = nnfX[sy * pw + sx] * 2;
          ny[y * lv.w + x] = nnfY[sy * pw + sx] * 2;
        }
      }
      // and carry the filled pixels, so this level refines rather than restarts
      const up = upscaleImage(pyr[l - 1].img, pw, ph, lv.w, lv.h);
      for (let i = 0; i < lv.w * lv.h; i++) {
        if (!lv.mask[i]) continue;
        lv.img[i * 3] = up[i * 3];
        lv.img[i * 3 + 1] = up[i * 3 + 1];
        lv.img[i * 3 + 2] = up[i * 3 + 2];
      }
    }
    solved = solveLevel(lv.img, lv.mask, lv.w, lv.h, ITERS, nx, ny,
      f => report(Math.round(((l + f) / (pyr.length + 0.4)) * 100)));
    nnfX = nx; nnfY = ny;
  }

  // Apply the final correspondences at FULL resolution. Voting at the working
  // size and simply enlarging it would hand back a soft patch inside a sharp
  // photo; copying the same patches from the full-res pixels keeps the grain.
  report(96);
  applyFullRes(full, work, nnfX, nnfY, solved && solved.cost, scale);

  for (let i = 0; i < n; i++) {
    if (!maskBits[i]) continue;
    rgba[i * 4] = full.img[i * 3];
    rgba[i * 4 + 1] = full.img[i * 3 + 1];
    rgba[i * 4 + 2] = full.img[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  report(100);
}

function applyFullRes(full, work, nnfX, nnfY, cost, scale) {
  const { img, w, h, mask } = full;
  const k = 1 / scale;                       // working px -> full px
  const R = Math.max(1, Math.round(HALF * k));

  // Winner-take-all, not an average. Every hole pixel is covered by dozens of
  // overlapping patch placements; averaging them is a blur, which is the exact
  // failure this algorithm exists to avoid. Each pixel takes its value from the
  // single best-matching patch, so full-resolution grain survives intact.
  const bestCost = new Float32Array(w * h).fill(Infinity);
  const src = new Int32Array(w * h).fill(-1);

  for (let wy = HALF; wy < work.h - HALF; wy++) {
    for (let wx = HALF; wx < work.w - HALF; wx++) {
      const t = wy * work.w + wx;
      const c = cost ? cost[t] : 0;
      if (!isFinite(c)) continue;
      const sxw = nnfX[t], syw = nnfY[t];
      if (!sxw && !syw) continue;
      const tx = Math.round(wx * k), ty = Math.round(wy * k);
      const sx = Math.round(sxw * k), sy = Math.round(syw * k);
      for (let dy = -R; dy <= R; dy++) {
        const tyy = ty + dy, syy = sy + dy;
        if (tyy < 0 || tyy >= h || syy < 0 || syy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const txx = tx + dx, sxx = sx + dx;
          if (txx < 0 || txx >= w || sxx < 0 || sxx >= w) continue;
          const ti = tyy * w + txx;
          if (!mask[ti]) continue;
          const si = syy * w + sxx;
          if (mask[si]) continue;              // never copy from inside the hole
          // tie-break toward the middle of the patch, where the match is most
          // trustworthy, so neighbouring patches don't fight at their edges
          const d = c + (dx * dx + dy * dy) * 0.01;
          if (d < bestCost[ti]) { bestCost[ti] = d; src[ti] = si; }
        }
      }
    }
  }

  const up = upscaleFilled(work, w, h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    if (src[i] >= 0) {
      img[i * 3] = img[src[i] * 3];
      img[i * 3 + 1] = img[src[i] * 3 + 1];
      img[i * 3 + 2] = img[src[i] * 3 + 2];
    } else {
      img[i * 3] = up[i * 3]; img[i * 3 + 1] = up[i * 3 + 1]; img[i * 3 + 2] = up[i * 3 + 2];
    }
  }
  featherRim(img, mask, w, h);
}

// Two pixels of blend where the new pixels meet the untouched photo. Copying
// real patches gives the right texture but not a guaranteed match at the exact
// seam; without this a faint outline of the mask can show.
function featherRim(img, mask, w, h) {
  const rim = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (!mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) rim.push(i);
    }
  }
  const snap = new Float32Array(rim.length * 3);
  for (let k = 0; k < rim.length; k++) {
    const i = rim[k];
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const j = i + dy * w + dx;
        if (j < 0 || j >= w * h) continue;
        r += img[j * 3]; g += img[j * 3 + 1]; b += img[j * 3 + 2]; n++;
      }
    }
    snap[k * 3] = r / n; snap[k * 3 + 1] = g / n; snap[k * 3 + 2] = b / n;
  }
  for (let k = 0; k < rim.length; k++) {
    const i = rim[k];
    img[i * 3] = img[i * 3] * 0.5 + snap[k * 3] * 0.5;
    img[i * 3 + 1] = img[i * 3 + 1] * 0.5 + snap[k * 3 + 1] * 0.5;
    img[i * 3 + 2] = img[i * 3 + 2] * 0.5 + snap[k * 3 + 2] * 0.5;
  }
}

// bilinear enlarge of the working-size result, used only as a fallback
function upscaleFilled(work, w, h) {
  const out = new Float32Array(w * h * 3);
  const sx = work.w / w, sy = work.h / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(work.h - 1.001, y * sy), y0 = fy | 0, ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(work.w - 1.001, x * sx), x0 = fx | 0, tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const a = work.img[(y0 * work.w + x0) * 3 + c], b = work.img[(y0 * work.w + x0 + 1) * 3 + c];
        const cc = work.img[((y0 + 1) * work.w + x0) * 3 + c], d = work.img[((y0 + 1) * work.w + x0 + 1) * 3 + c];
        out[(y * w + x) * 3 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
      }
    }
  }
  return out;
}

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'ping') { postMessage({ type: 'ready' }); return; }
  if (msg.type !== 'inpaint') return;
  try {
    const { image, mask } = msg;
    const w = image.width, h = image.height;
    const px = image.data;
    const md = mask.data;
    const bits = new Uint8Array(w * h);
    for (let i = 0, p = 3; i < bits.length; i++, p += 4) bits[i] = md[p] > 10 ? 1 : 0;
    complete(px, w, h, bits, pct => postMessage({ type: 'progress', pct }));
    postMessage({ type: 'result', patch: image }, [px.buffer]);
  } catch (err) {
    postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};

postMessage({ type: 'ready' });
