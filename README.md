# pasteup

a flyer editor for the browser. upload photos, scrub out what doesn't belong, set type and simple shapes on top, export a png.

**live: https://djessemann.github.io/flyer-maker/**

- ipad safari first (landscape + portrait), phone usable, desktop works
- vanilla js, es modules, zero build step — push to `main` deploys via pages
- fabric.js v6 for the canvas, opencv.js (lazy, in a worker) for retouch, idb-keyval for autosave
- no backend, no accounts. projects live in your browser; export/import `.pasteup.json` files to move them

spec of record: [`docs/design-doc.md`](docs/design-doc.md) · visual target: [`docs/mock.html`](docs/mock.html)

## run locally

```
python3 -m http.server 8080
```

then open http://localhost:8080 (es modules won't run from `file://`).
