# testing checklist

The browser items below are covered by an automated pass driven through a
393×800 **touch** viewport in headless chromium (`hasTouch`, `isMobile`), tapping
real targets rather than calling functions. Everything marked **hardware** still
needs a real iPad/iPhone.

## verified on a phone-sized touch viewport — 68 checks, all passing

**the interface**
- [x] sheets receive taps (asserted via `elementFromPoint`) — the v1 regression
      where `#overlay` painted over the panel and ate every tap
- [x] action bar swaps with the selection: nothing / text / shape / photo
- [x] `add` leads every selected-object bar — adding never needs a hidden deselect
- [x] the whole bar fits: 393px in 393px, nothing off-screen
- [x] **sheets cover 0% of the selected object** (colour and font were both 100%)
- [x] the bar stays live above an open sheet, so controls swap without closing
- [x] the canvas returns to its prior position when a sheet closes
- [x] size and corners are inline sliders: no sheet, no dimming
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

**erase object** (paramount)
- [x] opens from the photo's action bar
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
- [x] home-screen thumbnails show the whole flyer (same crop bug)
- [x] saved file carries a real png signature on disk
- [x] project file saves; the photo picker actually opens
- [x] autosave → reload → project listed → reopen with every layer intact
- [x] undo / redo, keyboard shortcuts, arrow-key nudge
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
| `tests/offline.test.mjs` | service worker registration, shell caching, offline reload |
| `tests/mobile.test.mjs` | the whole app on a 393×800 touch viewport |

`npm run audit` is not pass/fail — it prints the interaction costs and geometry
that `docs/ui-revision.md` makes claims about, so those claims can be re-measured
rather than trusted.

The suites serve the repo over http and answer the app's two CDN imports with the
same **pinned** versions out of `node_modules`, so they run with no network. If the
import URLs in `js/` and the pins in `package.json` ever drift apart, the mobile
suite fails on the first assertion rather than quietly testing a build nobody ships.

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
