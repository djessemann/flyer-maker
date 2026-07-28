// opencv.js inpainting worker — loaded lazily the first time retouch opens.
// telea inpaint on a padded region only; the page composites the patch back.
/* global cv, importScripts */

// pinned primary + pinned fallback (same 4.10.0 build via jsdelivr) + docs latest
const OPENCV_URLS = [
  'https://docs.opencv.org/4.10.0/opencv.js',
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
  'https://docs.opencv.org/4.x/opencv.js',
];

async function initFrom(url) {
  importScripts(url);
  let mod = self.cv;
  if (mod && typeof mod.then === 'function') {
    mod = await mod;                       // modularized build: cv is a thenable
  } else if (typeof mod === 'function') {
    mod = await mod();                     // factory build: cv() returns a promise
  } else if (mod && !mod.Mat) {
    await new Promise((resolve, reject) => {   // classic build: wait for runtime
      const t = setTimeout(() => reject(new Error('opencv init timed out')), 25000);
      mod.onRuntimeInitialized = () => { clearTimeout(t); resolve(); };
    });
  }
  if (!mod || !mod.Mat) throw new Error('no Mat after init');
  if (!mod.inpaint) throw new Error('build lacks inpaint');
  self.cv = mod;
}

let ready = (async () => {
  const failures = [];
  for (const url of OPENCV_URLS) {
    try {
      await initFrom(url);
      return;
    } catch (err) {
      failures.push(`${new URL(url).host}: ${err && err.message || err}`);
    }
  }
  throw new Error(failures.join(' · '));
})();

ready.then(
  () => postMessage({ type: 'ready' }),
  err => postMessage({ type: 'error', message: String(err && err.message || err) })
);

onmessage = async e => {
  if (e.data.type !== 'inpaint') return;
  try {
    await ready;
    const { image, mask, radius } = e.data;
    const src = cv.matFromImageData(image);
    const m = cv.matFromImageData(mask);

    const src3 = new cv.Mat();
    cv.cvtColor(src, src3, cv.COLOR_RGBA2RGB);
    const gray = new cv.Mat();
    cv.cvtColor(m, gray, cv.COLOR_RGBA2GRAY);
    const bin = new cv.Mat();
    cv.threshold(gray, bin, 10, 255, cv.THRESH_BINARY);

    const dst = new cv.Mat();
    cv.inpaint(src3, bin, dst, radius || 4, cv.INPAINT_TELEA);

    const out = new cv.Mat();
    cv.cvtColor(dst, out, cv.COLOR_RGB2RGBA);
    const patch = new ImageData(new Uint8ClampedArray(out.data), out.cols, out.rows);

    src.delete(); m.delete(); src3.delete(); gray.delete(); bin.delete(); dst.delete(); out.delete();
    postMessage({ type: 'result', patch }, [patch.data.buffer]);
  } catch (err) {
    postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
