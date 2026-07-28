// opencv.js inpainting worker — loaded lazily the first time retouch opens.
// telea inpaint on a padded region only; the page composites the patch back.
/* global cv, importScripts */

const OPENCV_URL = 'https://docs.opencv.org/4.10.0/opencv.js';

let ready = (async () => {
  importScripts(OPENCV_URL);
  // opencv.js ships either as a global with onRuntimeInitialized or as a thenable module
  if (typeof cv !== 'undefined' && typeof cv.then === 'function') {
    self.cv = await cv;
  } else if (typeof cv !== 'undefined' && !cv.Mat) {
    await new Promise(resolve => { cv.onRuntimeInitialized = resolve; });
  }
  if (!cv || !cv.Mat) throw new Error('opencv failed to initialize');
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
