# pasteup — design doc v1

A flyer editor for the browser. Upload photos, scrub out what doesn't belong, set type and simple shapes on top, export a PNG. Pixelmator's layout half without its effects half.

Working title "pasteup" (the old zine/print-shop term for assembling a flyer by hand). Rename freely; nothing below depends on it.

**Targets:** iPad Safari is the primary device, landscape and portrait. Phone (390pt-class) must be fully usable. Desktop gets the iPad landscape layout for free. Static site on GitHub Pages, no backend, no accounts. Add-to-home-screen web app like journal-app.

**Non-goals:** filters/effects, brushes/painting, multi-page documents, collaboration, cloud sync, vector pen tools.

---

## 1. Stack

- **Vanilla JS, ES modules, no build step.** Small module files (`app.js`, `editor.js`, `panels.js`, `fonts.js`, `retouch.js`, `store.js`), deployable by pushing to the repo. Same operational model as journal-app.
- **Fabric.js v6** (ESM from jsDelivr, pin the exact version) as the canvas engine. It provides the object model, touch-draggable selection/transform handles, `Textbox` with wrapping and inline editing, per-object opacity, z-order, JSON serialize/deserialize, and PNG export with a resolution multiplier. Hand-rolling touch hit-testing and transforms is where a project like this dies; Fabric removes that entire risk class. (Konva was the alternative; Fabric wins on built-in interactive text editing and object serialization.)
- **OpenCV.js** (~8 MB wasm) for Retouch inpainting. Lazy-loaded in a Web Worker the first time the Retouch tool is opened, never before. Cached by the service worker after first load.
- **idb-keyval** for IndexedDB autosave and the project library.
- No framework, no bundler, no CSS preprocessor.

## 2. Design system

Lifted from journal-app and extended. The whole app is one typeface and five grays — the flyer being edited is the only colorful thing on screen.

### Tokens

| token | value | use |
|---|---|---|
| `--paper` | `#F8F7F4` | app chrome: bars, panels, sheets |
| `--workspace` | `#E8E6E0` | canvas surround; also hairlines/dividers |
| `--ink` | `#111110` | text, icons, primary buttons, selection handles |
| `--mut-1` | `#555` | secondary text |
| `--mut-2` | `#999` | tertiary text, disabled, inactive icons |
| `--danger` | `#cc3333` | delete only |
| `--sel` | `rgba(0,0,0,0.3)` | sheet overlays |

- **Type:** `'DM Mono', 'Courier New', monospace` for every piece of UI. Weights 300/400/500, italic 300 for hints. Scale: 11 / 13 / 14 / 16 / 17 / 18 / 20. Letterspacing 0.02–0.06em on labels. Sentence case, lowercase-leaning labels ("layers", "export png"), matching journal-app's register.
- **Surfaces:** flat. No card borders; separation by hairlines (`1px solid var(--workspace)`) and background shifts only. Radius: 0–2px on controls, 10px on floating popovers, 20px on pills, 47px reserved for the phone frame treatment.
- **Interaction states:** opacity fades, exactly like journal-app — `:active { opacity: 0.3 }` on buttons, `0.4` on rows. No color-change hovers.
- **Sheets:** bottom sheets slide up with `cubic-bezier(0.32,1.1,0.58,1)` 280ms over a `--sel` overlay. Panels on portrait/phone are sheets.
- **Primary button:** ink fill, paper text, 20px pill. Ghost button: ink text, hairline outline.
- **Icons:** inline SVG, 1.5px stroke, square caps, currentColor. No icon font.
- **Selection (editor-specific signature):** selected objects get a 1.5px ink outline with 10px paper-filled, ink-bordered square handles (44px invisible hit area), rotate handle on a 24px stem below. Monochrome selection is the point — no Figma blue anywhere.
- **Touch targets** ≥ 44px everywhere. `prefers-reduced-motion` kills sheet/zoom animations.

## 3. Layout

### iPad landscape (primary)
```
┌──────────────────────────────────────────────────────┐
│ ‹ projects   untitled flyer      ⟲ ⟳   100%  (export)│ 52px top bar
├────┬────────────────────────────────────┬────────────┤
│ ▸  │                                    │ layers     │
│ T  │                                    │ style      │
│ ▢  │          workspace                 │ canvas     │
│ 🖼 │        ┌──────────┐                │ ────────── │
│ ✕  │        │ artboard │                │ (active    │
│    │        └──────────┘                │  tab       │
│ ⚙  │                                    │  content)  │
└────┴────────────────────────────────────┴────────────┘
 60px tool rail                             300px panel
```
Panel collapses via its tab strip (tap active tab to hide) → canvas gets the width.

### iPad portrait
Same top bar and tool rail; no persistent right panel. A pill at bottom-right ("layers · 5") opens the panel as a 60%-height bottom sheet with the same three tabs.

### Phone
Top bar condenses (back, title, export icon). Tool rail becomes a 56px bottom bar: 5 tools + layers pill. Panels are full-width bottom sheets. Style controls in sheets are one control per row.

### Canvas gestures
Pinch to zoom 10%–800% around the pinch center; two-finger drag to pan; double-tap a text layer to edit; long-press any object for a context menu (duplicate / delete / forward / backward); tap empty workspace to deselect. Single-finger drag on an object moves it; on empty space, nothing (no marquee in v1 — touch-first).

## 4. Tools

`move` (default) · `text` · `shape` · `image` · `retouch` · rail bottom: `canvas settings` (opens canvas tab). Zoom readout in the top bar tap-cycles fit → 100% → fit.

- **text:** tap tool, then tap canvas → new `Textbox` ("type…", 48px, DM Mono until changed), immediately in edit mode. Tool returns to move after placing.
- **shape:** tap → popover with rectangle / rounded rectangle / ellipse / line. Tap canvas to place at 240px default; drag handles from there.
- **image:** opens file picker (`<input accept="image/*">` → photo library on iPadOS). Placed fit-to-canvas, centered.
- **retouch:** see §7.

## 5. Panels

Right panel / sheets, three tabs:

**layers** — one row per object, top of stack first: 28px thumbnail, type glyph (T ▢ 🖼), auto name (text layers use their first ~14 chars: `t · block party`; others `rectangle 2`, `photo 1`), rename on double-tap, eye (visibility) and lock glyphs at 0.35 opacity unless active. Drag rows to reorder z. Selected row: `--workspace` background + 2px ink left bar. Above the list, a block for the selected layer: **opacity slider** (0–100, live), duplicate, delete (danger), forward/backward.

**style** — contextual on selection type:
- *Text:* font family button (opens font picker, §6) · size stepper (8–400) · weight segmented control (populated from the loaded family's actual weights) · italic toggle · fill color swatch (opens color picker) · align segmented (left/center/right) · line-height slider (0.8–2.0) · letter-spacing slider (−0.05–0.5em) · opacity slider.
- *Shape:* fill swatch · stroke swatch + width stepper (0–24) · corner radius slider (rect only) · opacity.
- *Image:* opacity · flip h/v · replace image · **retouch** shortcut button · reset size.
- *Nothing selected:* italic hint "select something, or add text / shapes / an image from the left."

**canvas** — size presets as radio rows (`ig post 1080×1080`, `ig story 1080×1920`, `flyer letter 1275×1650`, `a4 1240×1754`, `custom w×h` with inputs), orientation-swap button, background color swatch, then the **export block**: scale segmented `1x 2x 3x` + `export png` (primary pill) + `save project file` (ghost).

### Color picker (shared popover/sheet)
Swatch grid: 12 fixed neutrals + this document's used colors (auto-collected) · HSB square + hue slider · hex field · **sample from canvas** button → tap the canvas to pick that pixel (read from a rendered snapshot; the `EyeDropper` API doesn't exist on iOS Safari, so manual sampling is the primary path everywhere).

## 6. Google Fonts

No API key. Two paths:

1. **Curated manifest** (`fonts.json`, ~48 families with category + available weights: a spread of display, serif, sans, mono, script). Picker = search field + category filter chips + list rendered *in each font* (specimens load via `fonts.googleapis.com/css2` with `text=` subsetting so the list stays light). "recent" section persists globally.
2. **"load any google font"** text field: builds the css2 URL for the typed family, `document.fonts.load()` confirms; unknown family → toast "couldn't find that font on google fonts."

Applying a font: inject the css2 `<link>`, await `document.fonts.load('1rem "Family"')`, then set on the Fabric object and re-render (prevents the invisible-text flash). Export awaits `document.fonts.ready`. Project files record family + weight per text layer; opening a project re-loads its fonts before first render, with a system-font placeholder + retry toast when offline.

## 7. Retouch (object removal)

Selecting an image and tapping retouch enters a focused mode: the image alone, fit to screen, everything else dimmed. Controls in a bottom bar: brush size slider (10–120 screen px, circle preview), mask/erase toggle, clear, cancel, **remove** (primary).

Paint over the unwanted object → 50%-opacity red overlay. On remove:
1. Map the mask from screen space to the image's native pixels.
2. Take the mask's bounding box padded ~15% (min 64px) — inpaint **only that region at native resolution** (`cv.inpaint`, `INPAINT_TELEA`, radius 4) in the worker, then composite the patch back. Keeps cost bounded and avoids resampling the whole photo.
3. Replace the Fabric image's source; one undo entry; stay in retouch mode for further passes.

Telea is fast, fully offline, and excellent on skies, walls, pavement, and other low-texture fill — which covers the flyer-cleanup use case. It smears on complex backgrounds; the escape hatch is painting again with a bigger brush or a follow-up pass. `retouch.js` should isolate the inpaint call behind one function so a future ML upgrade (MI-GAN via onnxruntime-web, ~25 MB) is a drop-in swap — noted as a later milestone, not v1.

## 8. Documents, saving, export

- **Every object is a layer** (Pixelmator-style); no groups in v1.
- **Autosave:** any mutation → debounced 800ms write to IndexedDB: `{id, name, updatedAt, thumbPNG, doc}`.
- **Home screen:** journal-app-style list/grid of projects (thumbnail, name, "edited 2h ago"), new / open / duplicate / delete / import project.
- **Project file:** `name.pasteup.json` → `{app:"pasteup", version:1, canvas:{w,h,bg}, fonts:[…], fabric:{…}}`, images embedded as data URLs (PNG if alpha, else JPEG 0.92). Export via anchor-download (iPadOS shows the share sheet — correct behavior); import via file input on home.
- **PNG export:** `canvas.toDataURL({multiplier})` at 1x/2x/3x with all overlays hidden. Filename `name-1080x1350@2x.png`.
- **Undo/redo:** JSON snapshots debounced 300ms, capped at 40 entries; retouch = one entry. Top-bar buttons; ⌘Z/⇧⌘Z when a hardware keyboard is attached; arrow keys nudge 1px (10 with shift), delete removes.

## 9. Performance and platform notes

- Downscale images on import if the longest side exceeds 4096px (Safari canvas memory ceilings); toast when it happens.
- HEIC from the iPad photo library: decode through `createImageBitmap`; if it throws, toast asking for JPEG/PNG. **Test on hardware early** — this is the top platform risk.
- Cap export multiplier so output stays ≤ 6000px on the long side.
- Fabric config: enlarge `cornerSize`/`touchCornerSize` for 44px hit areas; disable `uniformScaling` off, keep aspect lock on corner-drag for images.
- Service worker (last milestone): cache app shell, fabric/opencv/idb-keyval, fonts manifest, and any font CSS/woff2 already fetched → previously used fonts work offline.

## 10. Milestones

1. **Shell** — chrome/layout for all three form factors, Fabric canvas, pan/zoom gestures, new-project presets, autosave + home screen.
2. **Text** — text tool, style panel, font system (manifest + load-by-name), color picker.
3. **Shapes + layers** — shape tool and styles, full layers panel, opacity, reorder, context menu, undo/redo.
4. **Images + output** — import, transforms, flip/replace, PNG export, project save/load/import.
5. **Retouch** — worker + OpenCV region inpaint, focused mode UI.
6. **Polish** — phone sheets, keyboard support, service worker/offline, hardware QA pass (HEIC, memory, pinch behavior).

Each milestone ends runnable; ship-and-try on the iPad between each.

## 11. Defaults I chose (veto here)

- Fabric.js over Konva or hand-rolled canvas.
- Telea inpainting (offline, instant, small) over an ML model in v1.
- Curated font manifest + load-by-name instead of full Google Fonts directory browsing (which needs an API key).
- Monochrome ink selection UI instead of a conventional blue.
- No marquee multi-select, no groups, no guides/snapping in v1 (snapping to canvas center/edges is a cheap M6 add if wanted).
