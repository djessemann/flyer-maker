# testing checklist

verified in chromium (headless, pointer events + touch emulation). items marked
**hardware** need a real ipad / iphone pass — they can't be trusted in emulation.

## verified in browser

- [x] home screen: new flyer (all presets), open, duplicate, delete, import project file
- [x] autosave + thumbnail; project survives reload
- [x] text tool: place, edit, font size/weight/align/line-height/letter-spacing/fill/opacity
- [x] font picker: curated list, category chips, search, recents, load-by-name (mocked css)
- [x] shapes: rect / rounded / ellipse / line, fill + stroke + radius + opacity
- [x] layers: select, rename, reorder (drag), visibility, lock, duplicate, delete, z-order
- [x] undo / redo (40-step cap), keyboard ⌘Z / ⇧⌘Z, arrows nudge, delete key
- [x] canvas: presets, custom size, swap orientation, background color
- [x] export png at 1x/2x/3x (≤6000px cap), save/load .pasteup.json round-trip
- [x] image import: place fit-to-canvas, flip, replace, reset size, >4096px downscale
- [x] retouch: mask paint, erase, clear, telea inpaint in worker, result swaps into layer, one undo entry
- [x] wide layout / portrait sheet layout / phone toolbar layout switching
- [x] service worker registers; shell + cdn requests cached

## hardware — ipad/iphone pass needed

- [ ] HEIC from the photo library decodes via createImageBitmap (top platform risk — test early)
- [ ] pinch zoom / two-finger pan feel; no page rubber-banding; no accidental object drags mid-pinch
- [ ] double-tap a text layer enters editing; software keyboard doesn't cover the textbox
- [ ] canvas memory: 3–4 large photos on a 1275×1650 doc without safari reloading the tab
- [ ] export share-sheet flow (anchor download → share sheet) for png and .pasteup.json
- [ ] add-to-home-screen: icon, standalone chrome, safe-area insets around bottom toolbar
- [ ] offline relaunch after first visit (service worker), incl. previously used google fonts
- [ ] retouch brush feel with apple pencil + finger; opencv.js (~8 MB) load time on cellular
- [ ] long-press context menu doesn't trigger ios text-selection callout
- [ ] `docs.opencv.org/4.10.0/opencv.js` reachable + pinned version still served (verify once on device)
