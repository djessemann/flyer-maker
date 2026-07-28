# testing checklist

The browser items below are covered by an automated pass driven through a
393×800 **touch** viewport in headless chromium (`hasTouch`, `isMobile`), tapping
real targets rather than calling functions. Everything marked **hardware** still
needs a real iPad/iPhone.

## verified on a phone-sized touch viewport — 50 checks, all passing

**the interface**
- [x] sheets receive taps (asserted via `elementFromPoint`) — the v1 regression
      where `#overlay` painted over the panel and ate every tap
- [x] action bar swaps with the selection: nothing / text / shape / photo
- [x] bar scrolls with a faded trailing edge when it overflows
- [x] sheet stack: layers → background colour → back chevron returns to layers
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

**erase object** (paramount)
- [x] opens from the photo's action bar
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
- [x] export: 1x/2x/3x with live dimensions, png actually downloads, project file
- [x] autosave → reload → project listed → reopen with every layer intact
- [x] undo / redo, keyboard shortcuts, arrow-key nudge
- [x] no page errors across the whole run

## hardware — real iPad / iPhone pass still needed

- [ ] HEIC from the photo library decodes via `createImageBitmap` (top platform risk)
- [ ] pinch-zoom and two-finger pan feel; no page rubber-banding; no stray object
      drag when a second finger lands
- [ ] software keyboard doesn't cover the textbox while editing type
- [ ] canvas memory: 3–4 large photos on a 1275×1650 doc without Safari reloading the tab
- [ ] export share-sheet flow for png and `.pasteup.json`
- [ ] add-to-home-screen: icon, standalone chrome, safe-area insets under the action bar
- [ ] offline relaunch after a first visit, including previously used google fonts
- [ ] erase brush feel with finger and Apple Pencil; inpaint time on a large photo
      (region-limited, but a big mask on a 4096px photo is the worst case)
- [ ] the bar's horizontal scroll is discoverable in practice, not just visible

## running the tests

`node mobile.mjs` from the scratchpad drives the whole suite; it shims the two
CDN modules from local tarballs and stubs Google Fonts with a real installed
face so the font-loading path is genuinely exercised.
