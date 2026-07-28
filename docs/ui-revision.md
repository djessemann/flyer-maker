# ui revision — v2

`design-doc.md` remains the record of *what* pasteup does. This file records
where the shipped build now differs from it, and why. Two changes, both driven
by using v1 on a phone.

## 1. the tabbed panel is gone; the bar is contextual

**What v1 did.** A three-tab panel (`layers · style · canvas`) docked right on
iPad and slid up as a 62%-height sheet everywhere else. Every control lived
behind a tab, and `style` only showed anything once something was selected.

**Why it failed.** Two reasons, one fatal:

- *It was invisible.* `.view` is `position: fixed`, which creates a stacking
  context, so the panel's `z-index: 30` was scoped **inside** the editor view.
  `#overlay` was a body-level sibling at `z-index: 20`, painting above the view
  and therefore above the panel. On any narrow screen the whole panel sat
  behind a 30%-black scrim that also swallowed every tap. Colour, fonts and
  canvas settings were unreachable on a phone.
- *It was the wrong shape.* Even working, "select a layer → open the sheet →
  find the right tab → find the control" is three steps of hunting before you
  can change a colour. No touch design tool works that way.

**What v2 does.** A **contextual action bar** pinned under the canvas, whose
contents change with the selection — the pattern every touch design app uses.

| selection | bar |
|---|---|
| nothing | `text` `photo` `shape` │ `layers` `canvas` |
| text | `font` `color` `size` `align` `spacing` `opacity` │ `layers` `more` |
| shape | `fill` `stroke` `weight` `corners` `opacity` │ `layers` `more` |
| photo | **`erase object`** `replace` `flip` `opacity` `fit` │ `layers` `more` |

Each button opens a **single-purpose sheet** — one job, big targets, no tabs.
Colour and font are now one tap from a selected layer instead of three. The
`color` button renders the layer's current colour as a live dot, so the bar
doubles as a readout. Sheets stack with a back chevron (layers → background
colour returns to layers).

Structurally: `#overlay` and `#sheet` are body-level siblings of the views with
`z-index` 60/70 against the views' 1, so a sheet can never be covered again.
There is a regression test asserting `elementFromPoint` inside an open sheet
hits the sheet.

## 2. object removal has no external dependency

**What v1 did.** Loaded `opencv.js` (~11 MB wasm) from a single pinned
`docs.opencv.org` URL, lazily, to call `cv.inpaint(..., INPAINT_TELEA)`.

**Why it failed.** The single URL was a single point of failure, and when it
failed the UI blamed the user's connection ("offline?"). An 11 MB download
before the headline feature works is also a poor trade on cellular.

**What v2 does.** `js/inpaint-worker.js` implements Telea's fast-marching
inpainting directly — the eikonal solver, a binary-heap narrow band, and the
distance/level-set/direction weighted estimator — in about 180 lines of plain
JS in a worker. **Zero downloads, so the feature cannot fail to load.**

Decision §11 of the design doc ("Telea over an ML model in v1") is unchanged;
only the vehicle is. Same region-limited strategy: padded mask bbox, native
resolution, composite the patch back, one undo entry.

Measured against a known-good ground truth (`inpainttest`): a 44×44 masked
blob over a gradient reconstructs with **mean error 3.9/255, max 10/255, in
31 ms**. In the browser it removes the test object completely.

The remaining CDN dependencies are unchanged: `fabric` v6 and `idb-keyval`,
both pinned.

## smaller changes

- **Placement, not modes.** v1 made you pick a tool then tap the canvas. v2
  drops tools entirely: `text`/`shape`/`photo` place at the artboard centre
  (cascading slightly as the stack grows) and select immediately.
- **Layer reorder** is per-row up/down buttons rather than drag — drag inside a
  scrolling sheet is unreliable on touch.
- **Export** is its own sheet off the top bar, one tap from anywhere, instead
  of being buried at the bottom of the canvas tab.
- **Zoom** moved to a floating pill over the canvas, freeing top-bar width.
- **Service worker** is network-first for same-origin files, so a deploy shows
  up on the next load instead of being pinned to a stale cache.
