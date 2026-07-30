# pasteup

a flyer editor for the browser. add photos, scrub out what doesn't belong, set type and simple shapes on top, export a png.

**live: https://djessemann.github.io/flyer-maker/**

- phone-first and fully usable on one; scales up to ipad and desktop
- vanilla js, es modules, zero build step — push to `main` deploys via pages
- fabric.js v6 for the canvas, idb-keyval for autosave. object removal is implemented in-repo, so it has nothing to download
- no backend, no accounts. projects live in your browser; export/import `.pasteup.json` files to move them

## how it works

select a layer and the bar under the canvas becomes that layer's controls —
tap `color`, `font`, `size` and you get one sheet doing one job. with nothing
selected the bar is `text · photo · shape · layers · canvas`. select a photo
and you get `crop · adjust · replace · erase · move`: drag a rectangle to keep
part of a picture, flip and rotate it, swap it out, place it to the pixel — or
paint over something you want gone and have the photo's own background copied
into its place.

## docs

- [`docs/design-doc.md`](docs/design-doc.md) — what pasteup does (spec of record)
- [`docs/ui-revision.md`](docs/ui-revision.md) — how the shipped ui differs from the doc, and why
- [`TESTING.md`](TESTING.md) — what's verified, and what still needs a real device

## run locally

```
python3 -m http.server 8080
```

then open http://localhost:8080 (es modules won't run from `file://`).
