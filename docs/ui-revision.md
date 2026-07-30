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

---

# round 4 — what four independent reviewers found

Four Claude instances that had not built the app were given `qa-charter.md`, the
design doc, and real user goals — deliberately *not* the test suite. Between them
they found one data-loss blocker, seven majors, and proved the suite was close to
worthless. Everything below was reproduced before it was fixed.

## the suite was passing while the app was broken

One reviewer copied the repo, injected six user-visible bugs, and ran the suite.
**It stayed 72/72 green for all six**: layer names and lock state dropped on save,
a dead visibility toggle, "fit to flyer" shrinking photos to 10%, centre-across
shoving layers off the artboard, load-by-name ignoring the typed family, and the
selection panned 300px off-screen — the last of which still printed
`sheets cover 0%`, because zero overlap is equally true of an object nobody can see.

Three assertions were literally `ok(true, …)`. One used `waitForFunction` with an
async predicate, which resolves on the returned Promise rather than its value — it
had been green and meaningless since the day it was written.

The suite is now 153 checks across four files (123 at the end of round 4), and
every one of those six injected bugs fails at least one of them.

## data loss

- **Undoing while an erase was in flight destroyed the photo.** History walked
  past the import, the finishing pass snapshotted an empty canvas, redo was wiped
  and autosave made it permanent. `ed.busy` now blocks undo/redo for the duration,
  and an erase that finds its layer detached refuses to write.
- **Erase after an undo lied.** It reported success while writing to an object no
  longer on the canvas, and the export still contained what you'd removed. Erase
  mode now closes when the document is rewound underneath it.
- **Reopening re-wrapped text.** Layout was measured against whatever face existed
  during `loadFromJSON`, and fabric cached those metrics, so a two-line headline
  came back as one overflowing line. The cache is dropped and text re-measured
  after fonts resolve.
- **Autosave fidelity was asserted by layer *type* only.** Now a full
  property-by-property snapshot across save → reload, naming the first key that
  differs, plus a pixel check that a restored photo still has pixels.

## the layout could fall off the canvas

Changing canvas size left every layer at its old coordinates: poster → square left
the photo 21% inside the frame and the export two-thirds blank. Layers now keep
their relative position and scale uniformly, asserted at ≥90% inside across both
directions.

## moving a layer scaled it instead

`touchCornerSize: 44` is right for a big layer and a trap for a small one — at fit
zoom a fresh text layer is 34px tall on screen, so its own handles covered it
entirely and a drag crushed a headline to an 8px sliver. Handle hit areas are now
proportional to the layer's on-screen size.

## erase, measured honestly

Ground-truth measurements, small object on a smooth background: **1.26/255 mean
error**. That case is genuinely excellent. Beyond it, it degraded — a large hole
left a hard seam (a 20/255 step at the rim where the truth is 1) and faceting.

A feathered blur confined to the filled region, plus a sampling radius chosen
against a work budget, cuts the seam to roughly a third (11 → 4 on a 200px hole,
14 → 6 on 300px) while keeping the pass interactive: the worst large-region case
went 930ms → 1397ms rather than the 10× a naive bigger radius cost.

**The doc's escape hatch is false and has been removed from the UI copy.** §7 says
that if the fill smears, paint again with a bigger brush. Measured: that makes it
*worse* — 27.0 → 28.5 mean error over 3.9× the area. On texture this algorithm
smears, and no amount of re-painting fixes it; the honest guidance is that erase
is for small things against plain backgrounds.

Also: the brush is now a share of the image rather than screen pixels (on a 4096px
photo the smallest brush painted a 116px stroke, so fine masking was impossible),
undo inside erase mode reverts an applied pass, and results are handed back as
lossless PNG so repeated passes stop compounding JPEG artefacts.

## offline was never real

The assertion counted `#viewHome`, which is hard-coded in `index.html` and present
whether or not a single module ran. After an offline reload the app was a dead
shell: empty project list, "new flyer" doing nothing, the canvas engine not in the
cache at all — because module imports on a first visit happen before the service
worker activates.

Precaching the CDN URLs made the promise depend on jsDelivr being reachable at
exactly the right moment, which no test could prove. **The two libraries are now
vendored in `vendor/`**, so they are ordinary shell files. Offline is asserted by
booting the app with the network cut and starting a flyer. This also closes a
testing blind spot: the suite used to answer those imports with local copies, so
it exercised a slightly different build than users got.

## smaller repairs

- ⌘Z died once focus was in a slider — every `<input>` was skipped, not just text.
- Deleting a layer left its sheet open, silently editing nothing.
- Layer rename was unreachable by touch (a finger never sends `dblclick`); there is
  a rename button on each row now.
- Closing the canvas sheet undid the resize re-fit, so the zoom readout disagreed
  with what was drawn.
- 4 of 18 palette swatches applied a drifted hex via an HSV round-trip, so they
  never read as selected and each tap added a near-duplicate.
- A two-finger pan grabbed whatever was under your fingers; the pre-pinch
  selection is restored.
- The dimming overlay covered the top bar, so undo needed two taps.
- A closed sheet peeked 38px onto the home screen.
- The home card cropped story flyers (`cover` → `contain`).
- Exports had a 2px translucent border; the background now bleeds 1px.
- Six controls were below the doc's own 44px minimum.
- Undo snapshots embedded every photo as base64 — a 4096px PNG is ~23MB of string
  copied into all 40 entries. Sources are stored once and referenced by token.
- The export filename now matches doc §8 (`name-WxH@Nx.png`) instead of folding
  the scale into the dimensions.

# round 5 — the feature gaps behind the friction

Round 4 fixed what the reviewers could reproduce as *broken*. It left four things
they had reported as *friction* — places where the app had no answer, not places
where its answer was wrong. The QA charter is partly to blame: it says
"suggestions with no observed problem behind them do not count", which stopped
padded reports and also stopped anyone proposing a feature. Everything below came
in disguised as a workaround someone had to invent.

## crop (new)

There was no way to trim a photo. `crop` sits second on the photo bar and opens a
full-screen mode alongside erase: drag the corners, drag the whole rectangle, or
draw a fresh one by pressing on the dimmed area. Thirds guides, a live
`keeping 1840 × 1035 px` readout, and locks for free / flyer / square / 4:5 —
"flyer" meaning the shape of the canvas you are actually designing.

**The whole risk in cropping is the offset.** Replacing an image's pixels with a
sub-rectangle moves every remaining pixel unless the layer moves with it: trim
120px off the left and the photo slides 120px left, so everything you had lined it
up against is now wrong. `cropImageSource()` shifts the layer by the crop origin
scaled by the layer's own scale, rotated by its angle. The test asserts the thing
a person would notice — a landmark pixel of the photo stays at the same flyer
coordinate, to within 2px, after a crop taken out of the middle of the image.

Two details worth keeping: the fitted display size is rounded to whole screen
pixels, so scaling the rectangle back naively shaved a pixel or two off each edge
and a keep-everything crop quietly lost its border — the edges snap instead. And a
jpeg photo is re-encoded as jpeg: one pass is invisible, while a PNG of a 4096px
photo is many megabytes in every autosave. Undo restores the uncropped pixels,
because sources are held in the token store.

## move — placing something without a keyboard

Round 4 fixed handles swallowing a small layer, which stopped the drag *destroying*
it. It did not give anyone a way to place a layer precisely on a phone: arrow-key
nudge needs a keyboard, and `more` offered only centre-across / centre-down. A
reviewer's own words: *"I guessed at 'zoom to 100% first, position while it is
still big, shrink afterwards', which worked, but it is a workaround I invented,
not something the app suggests."*

`move` is now on every layer's bar and takes over the bar rather than opening a
sheet — four 44px arrows, a step toggle cycling 1 / 10 / 50px, and press-and-hold
to repeat. The row is 393px wide in a 393px bar; the first version clipped `done`
off the right edge, which is now asserted rather than eyeballed. Centre-across and
centre-down also moved out of the text-only block in `more`, where they had been
unreachable for photos and shapes.

## zoom inside erase

Erase fitted the photo to the screen and stopped there, so on a 4096px photo the
finest thing you could mask was about 116px across — the brush fix in round 4 made
the brush proportional but could not make the *photo* bigger. There is now a
zoom stepper in the erase toolbar (out / fit / in, reading out the true
magnification) plus two-finger pinch and pan, with a second finger abandoning any
half-drawn stroke rather than smearing it. Stroke coordinates are read off the
element's live rect, so they survive the CSS scale; the test paints while zoomed
and requires the mask to land within 60 native pixels of where the finger was.

A long fill also used to sit on the word "erasing…" for seconds. The worker now
reports progress as it marches, and the test watches the live DOM for those
updates rather than trusting the source.

## the bar

- `add` opened a sheet over the flyer listing the same three verbs the empty bar
  shows directly. It expands in the bar itself now. Still two taps — but no sheet,
  no dimming, and the second tap is where your thumb already is.
- `erase` was the one filled, dominant button on the photo bar: the most
  destructive action shouting loudest in a layout tool. It is now plain, and sits
  after `crop`, `adjust` and `replace`.
- `.act` min-width dropped 60px → 54px so a seven-item bar still fits 393px
  without scrolling; 600px and up gets the roomier target back.

## count

153 checks across four suites, up from 123. Two of the new ones are the kind this
project keeps needing: the crop landmark check (a crop that shifts the photo would
pass any dimensions-only assertion) and the progress check (read from the DOM, not
from the fact that a `postMessage` exists in the source).
