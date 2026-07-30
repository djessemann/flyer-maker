# testing checklist

The browser items below are covered by an automated pass driven through a
393×800 **touch** viewport in headless chromium (`hasTouch`, `isMobile`), tapping
real targets rather than calling functions. Everything marked **hardware** still
needs a real iPad/iPhone.

## verified — 153 checks across four suites, all passing

**the interface**
- [x] sheets receive taps (asserted via `elementFromPoint`) — the v1 regression
      where `#overlay` painted over the panel and ate every tap
- [x] action bar swaps with the selection: nothing / text / shape / photo
- [x] `add` leads every selected-object bar — adding never needs a hidden deselect
- [x] `add` expands **inside the bar** (text/photo/shape); no sheet covers the flyer
      to reach the same three verbs the empty bar already shows
- [x] the whole bar fits: 393px in 393px, nothing off-screen
- [x] **sheets cover 0% of the selected object** (colour and font were both 100%)
- [x] the bar stays live above an open sheet, so controls swap without closing
- [x] the canvas returns to its prior position when a sheet closes
- [x] size and corners are inline sliders: no sheet, no dimming
- [x] `move` is an inline nudge pad: 1px per tap, step toggles 1/10/50, four 44px
      targets, and the whole row fits in 393px without clipping `done`
- [x] `erase` is not the primary-styled button on the photo bar any more
- [x] `edit` enters text editing; the bar becomes an editing state with `done`
- [x] no horizontal page overflow at 393px

**colour** (paramount)
- [x] one tap from a selected layer; swatch grid applies instantly
- [x] hue slider + saturation/value square drag
- [x] hex entry, rejects malformed input
- [x] the bar's colour dot mirrors the layer's current colour
- [x] shape fill *and* stroke, stroke auto-gains a width when given a colour
- [x] canvas background, reachable from both layers and canvas sheets
- [x] sample-a-colour-from-the-flyer eyedropper reopens the sheet with the pick

**fonts** (paramount)
- [x] browsable list, each row rendered in its own face
- [x] search narrows; category chips filter
- [x] tap applies immediately; recents persist
- [x] weight + italic segmented control follows the family's real axes
- [x] "load any google font by name" field present and wired
- [x] a slow load says so rather than appearing to do nothing
- [x] the font list stays clear of the text it is restyling

**crop** (photos)
- [x] opens from the photo's action bar; live readout of the pixels being kept
- [x] corner drag, whole-rect drag, and a fresh rect drawn from the dimmed area
- [x] **the kept region does not shift on the flyer** — a landmark pixel of the
      photo stays at the same flyer coordinate to within 2px after a crop taken
      from the middle of the image (the whole risk in cropping)
- [x] the photo's pixels really are trimmed, and the cropped photo fills its box
      in the export (6 of 9 sampled points are the photo's own colour)
- [x] undo restores the uncropped photo — crop is not a one-way door
- [x] aspect locks are exact: square is square, "flyer" matches the canvas ratio
- [x] cancel changes nothing; "crop it" with nothing trimmed says so

**erase object** (paramount)
- [x] opens from the photo's action bar
- [x] zoom in/out/fit, and a stroke painted while zoomed lands where the finger
      was (within 60 native px of the target) — at fit zoom a 4096px photo shows
      at ~9%, so nothing finer than a ~116px blob could be masked at all
- [x] brush size is in image pixels, unchanged by zooming
- [x] progress counts up while a fill runs, observed through the live DOM rather
      than asserted from the source
- [x] the instruction is visible on a phone (it used to be hidden under 560px)
- [x] paint / unpaint / undo / clear on the mask
- [x] Telea inpaint runs in the worker and the target object is **gone from the
      actual pixels** (asserted: zero bright pixels remain where it was)
- [x] result swaps into the layer as one undo entry
- [x] algorithm unit-tested against ground truth: mean error 3.9/255, max 10/255, 31 ms

**everything else**
- [x] text: add, edit, size (slider + stepper), align, centre on canvas, line
      height, letter spacing, opacity
- [x] shapes: rectangle / rounded / circle / line, fill, stroke, corner radius
- [x] photos: add, flip, rotate, replace, fit-to-canvas
- [x] layers: select, rename, reorder up/down, visibility, lock, duplicate, delete
- [x] canvas: 5 presets, custom w/h, swap orientation
- [x] export renders a **preview you can see** before saving, then saves on a
      fresh tap (iOS only opens the share sheet from a real gesture)
- [x] the png is a Blob, not a data URL — a 2x story png is ~15MB of base64
- [x] **the exported pixels are the flyer**: red/blue half-and-half test doc comes
      back red corner-to-corner on the left, blue on the right, no blank margin
- [x] exporting never drops your selection, and no handles are baked into the png
- [x] home-screen thumbnails show the whole flyer, and the card no longer crops it
- [x] text produces ink in the png; hidden layers are excluded; opacity is honoured
- [x] 2x and 3x exports have correct **content**, not merely correct size
- [x] export scale caps correctly on a tabloid; an oversized canvas clamps to 6000px
- [x] the erase fill matches its surroundings to within 12/255 and is fully opaque
- [x] saved file carries a real png signature on disk
- [x] project file saves; the photo picker actually opens
- [x] autosave → reload → project listed → reopen with every layer intact
- [x] undo / redo restores real values; ⌘Z survives a focused slider
- [x] arrow nudge is exactly 1px, shift+arrow exactly 10px; the on-screen nudge
      pad moves exactly 1px and exactly 10px too
- [x] rename by tap (a finger never fires `dblclick`) and it persists
- [x] layers stay inside the frame when the canvas size changes
- [x] handles stay proportional so dragging a small layer moves rather than scales it
- [x] undo refuses to run mid-erase; an undo dismisses controls bound to old objects
- [x] a project file imports back intact; a foreign json file is refused
- [x] no page errors across the whole run

## hardware — real iPad / iPhone pass still needed

- [ ] HEIC from the photo library decodes via `createImageBitmap` (top platform risk)
- [ ] pinch-zoom and two-finger pan feel; no page rubber-banding; no stray object
      drag when a second finger lands
- [ ] software keyboard doesn't cover the textbox while editing type
- [ ] canvas memory: 3–4 large photos on a 1275×1650 doc without Safari reloading the tab
- [ ] share sheet actually offers “save image” into Photos, for png and `.pasteup.json`
- [ ] press-and-hold on the export preview offers Save Image
- [ ] add-to-home-screen: icon, standalone chrome, safe-area insets under the action bar
- [ ] offline relaunch after a first visit, including previously used google fonts
- [ ] erase brush feel with finger and Apple Pencil; inpaint time on a large photo
      (region-limited, but a big mask on a 4096px photo is the worst case)
- [ ] pinch-to-zoom inside erase mode: it is covered by a synthetic two-finger
      CDP gesture, which says the maths is right but nothing about how it feels
- [ ] crop handles with a fingertip — 44px hit areas hanging outside the photo
- [ ] the pan-into-view on sheet open feels helpful rather than jumpy on device
- [ ] inline sliders are comfortable to drag one-handed at the bottom of the screen

## running the tests

```
npm install
npx playwright install chromium   # skip if a chromium is already on the machine
npm test
```

Three suites, 87 checks:

| suite | what it covers |
|---|---|
| `tests/inpaint.test.mjs` | the object-removal maths against ground truth, no browser |
| `tests/fonts.test.mjs` | load-any-google-font, **including the not-found path** |
| `tests/offline.test.mjs` | service worker, shell caching, and that the app really boots offline |
| `tests/mobile.test.mjs` | the whole app on a 393×800 touch viewport |

`npm run audit` is not pass/fail — it prints the interaction costs and geometry
that `docs/ui-revision.md` makes claims about, so those claims can be re-measured
rather than trusted.

The suites serve the repo over http and run **exactly what ships** — the canvas
engine is vendored (see `vendor/README.md`), so there is no stand-in for it any
more. Only Google Fonts is substituted, and `tests/fonts.test.mjs` deliberately
runs one context where it *fails*, because a shim that makes every font succeed
made every failure path in the app unreachable.

`tests/mobile.test.mjs` blocks service workers on purpose — an active worker makes
its own fetches, which route interception cannot reach, so the CDN shims would be
bypassed. That is why offline lives in its own suite.

CI runs all of it on every push and pull request (`.github/workflows/test.yml`).

## independent QA agents

`docs/qa-charter.md` briefs a Claude instance that did **not** build this app to
use it like a person and file findings as GitHub issues labelled `qa-agent`. It is
deliberately pointed at the design doc and at real user goals rather than at
`tests/` — the suite is a regression net, not the spec, and twice now it has passed
while a feature was visibly broken.
