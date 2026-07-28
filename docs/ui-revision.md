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

---

# ui revision — v3

v2 fixed *reachability* (controls existed and could be tapped) but created a
different problem: everything became a modal. A measured pass over real tasks on
a 393×800 touch viewport found the following, and this revision addresses each.

## 1. you could not see what you were changing

**Measured.** The colour and font sheets were 656px tall on an 800px screen. With
a headline selected, sheet-vs-object overlap was **100%** — for text in the lower
third *and* mid-flyer. Every colour decision was made blind, then verified by
closing the sheet.

**Now.** Sheets are capped (`56dvh`, `72dvh` for the font browser), and opening
one pans the canvas so the selected object sits in the strip left above it. The
canvas returns to where it was on close. Measured overlap: **0% for both**, with
a regression test asserting it.

## 2. the bar kept its own controls out of reach

**Measured.** The text bar needed 547px of width in a 393px viewport; `opacity`,
`layers` and `more` sat off-screen — including `more`, which holds delete.

**Now.** Six items, **393px in 393px**, nothing off-screen. Related controls were
merged rather than dropped (see §4).

## 3. adding things was a hidden mode

`text · photo · shape` only appeared when nothing was selected. Adding a photo
auto-selected it, so the add verbs vanished and the only way back was tapping
empty canvas — which nothing taught.

**Now.** An `add` button leads every selected-object bar. The empty-canvas bar
still shows the three verbs directly, so the common case stays one tap.

## 4. one modal per property

Eight sheets for a single text layer; `opacity` dimmed the whole screen for one
slider. Styling four properties cost 12 interactions.

**Now, for text:** `add · edit · font · colour · size · more` —
three sheets plus one inline slider.

- **Inline sliders** for simple values (font size, corner radius): the slider
  replaces the bar in place. No sheet, no dimming, artwork fully visible.
- **The bar stays live above an open sheet.** The overlay stops short of it, so
  tapping another action swaps the sheet instead of stacking — colour → font →
  size without closing anything. Styling four properties: **12 → 10**, and the
  round trips of close-look-reopen are gone entirely.
- `align`, `line height`, `letter spacing`, `opacity`, order, lock, duplicate and
  delete live together under `more`. Stroke thickness moved in with stroke colour.
- The colour picker is folded behind **custom colour**, so the sheet opens at
  311px of swatches instead of 656px of everything.

## 5. smaller repairs

- **Erase instructions were invisible on phones** — the hint was `display:none`
  under 560px, hiding the only guidance for the headline feature. It now sits with
  the brush controls, visible at every size, and the button reads "erase it".
- **No way to discover text editing** (double-tap only). There's now an `edit`
  button, and while typing the bar becomes an editing state with one clear `done`.
- **Background colour lived in two sheets.** The layers list now shows background
  as a row that points at the canvas sheet, where the colour actually lives.

## what was already fine, and kept

Contrast measured 6.96:1 against a 4.5:1 requirement; targets are 60×64px in the
bar and 44px on canvas handles; chrome takes 15% of the screen with the artboard
filling 87% of what's left. The contextual-bar concept and the contents of the
colour and font sheets were right in v2 — the problem was where they appeared.

---

# export fixes

Reported from a phone: download and viewing the image didn't work. Three causes,
all in the same path.

## 1. the exported pixels were wrong

`StaticCanvas.toCanvasElement(multiplier, {left, top, width, height})` computes
its render zoom as **`currentZoom × multiplier`** and treats the crop box as
**screen** coordinates. The export passed *scene* coordinates (`0,0,docW,docH`)
while the canvas sat at fit zoom (~0.34), so every png came out the right size
with the flyer shrunk into the top-left corner and the rest blank.

Exports now run with an identity viewport, so the crop box means artboard pixels.
Autosave thumbnails had the identical bug and are fixed by the same helper.

**This shipped broken from v1.** Every export test asserted output *dimensions*,
which were always correct — the crop error changed content, not size. There is now
a pixel assertion: a half-red/half-blue document must come back red corner-to-corner
on the left and blue on the right, with no blank margin.

## 2. the download couldn't work on iOS

The png was built as a data URL and handed to `<a download>`. A 2x story export is
~15 MB of base64, and iOS Safari does not reliably honour `download` on data URLs
at any size.

Now: `canvas.toBlob()` (no base64 round trip) and a `saveFile()` helper that tries
`navigator.share({files})` first — the only route into Photos on iOS — and falls
back to an object-URL download link elsewhere.

## 3. you couldn't see the result

Export fired and closed the sheet, so a failure was indistinguishable from success.
Export now renders, shows the png at full size in a preview, and saves on a second,
deliberate tap. That also fixes a subtler iOS constraint: `navigator.share` needs a
real user gesture, and the `await` around rendering spends the original one.

## also

- File inputs moved from `display:none` to off-screen positioning; some mobile
  browsers refuse to open a picker for a `display:none` input.
- `renderArtboard` deliberately does **not** discard the selection — autosave
  renders a thumbnail on every edit, and discarding would deselect the user's
  layer roughly once a second. Fabric sets `skipControlsDrawing` during export,
  so handles stay out of the output regardless; asserted by test.
