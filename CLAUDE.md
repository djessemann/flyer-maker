# pasteup

A flyer editor for the browser: upload photos, scrub out unwanted objects, set type and simple shapes, export PNG. iPad Safari first, phone usable, static hosting.

**Spec of record: `docs/design-doc.md`. Read it end to end before writing any code.**
**Visual target: `docs/mock.html`** — the approved look. Open it and match its actual rendering (spacing, weights, states), not a from-memory approximation.
**Design-system origin: `docs/journal-app-reference.html`** — the app this system extends. When a visual convention is ambiguous, copy that file's patterns (press states, sheets, hairlines).

## Hard constraints

- Vanilla JS with native ES modules. Zero build step. No frameworks, bundlers, preprocessors, or TypeScript.
- Deploys as a static GitHub Pages **project site** (served under `/repo-name/`): every path must be relative (`./js/app.js`, never `/js/app.js`).
- Dependencies, all pinned-version CDN imports, and only these: `fabric` v6 (ESM), `idb-keyval` (ESM), `opencv.js` (lazy-loaded inside a Web Worker, only when the retouch tool is first opened). Anything else: ask first.
- All UI type is DM Mono. Chrome is strictly monochrome per the token table in doc §2 — the flyer being edited is the only color on screen. Selection UI is ink, not blue.
- Touch targets ≥ 44px. `prefers-reduced-motion` respected.

## File layout (suggested — keep it flat and obvious)

```
index.html
css/app.css
js/app.js  js/editor.js  js/panels.js  js/fonts.js  js/retouch.js  js/store.js
fonts.json          ← already written, see below
sw.js               ← milestone 6 only
```

## fonts.json

The curated Google Fonts manifest (doc §6) is already authored at the repo root — 48 families with categories and real available weights. Wire the font picker to it; don't regenerate or trim it. The "load any google font by name" field is separate and builds a css2 URL from user input.

## Run & verify

Serve over http (ES modules won't run from `file://`): `python3 -m http.server 8080`.
Verify each milestone in a real browser before calling it done. Keep a running `TESTING.md` checklist of anything that needs hardware-iPad verification (HEIC decode, pinch gesture feel, canvas memory, share-sheet export).

## Working style

- Build milestone-by-milestone per doc §10. Every milestone ends runnable. Commit at each milestone boundary.
- Doc §11 lists decisions already made — don't relitigate them. If one proves genuinely unworkable in practice, stop and say so; don't silently substitute.
- UI copy matches journal-app's register: lowercase, terse ("export png", "save project file", "load any google font by name"). Real labels from the mock, never placeholder text.
- Deploy: push to `main`, enable Pages on the repo. That's the whole pipeline.
