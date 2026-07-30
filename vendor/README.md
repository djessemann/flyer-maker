# vendor

`fabric` and `idb-keyval`, at the versions pinned in `package.json`, copied here
rather than imported from a CDN.

**Why.** The design doc promises the app works offline, and it did not. Module
imports on a first visit happen before the service worker activates, so the CDN
copies were never in the cache, and an offline relaunch produced a dead shell
with a live-looking "new flyer" button. Precaching them by URL made the promise
depend on jsDelivr being reachable at exactly the right moment — something no
test could prove. Same-origin files are simply in the shell cache, so offline
works from the first visit and there is an assertion that proves it.

It also closes a testing blind spot: the suite used to answer the CDN imports
with local copies, so it exercised a slightly different build than users got.
Now it runs exactly what ships.

This deviates from `CLAUDE.md`'s "pinned-version CDN imports" wording. The
dependency list itself is unchanged — still only these two, still pinned.

## updating

```
npm install fabric@<version> idb-keyval@<version>
cp node_modules/fabric/dist/index.min.mjs vendor/fabric-<version>.min.mjs
cp node_modules/idb-keyval/dist/index.js vendor/idb-keyval-<version>.mjs
```

Then update the import in `js/editor.js` / `js/store.js`, the `SHELL` list in
`sw.js`, and the pins in `package.json`. `tests/offline.test.mjs` fails if those
fall out of step.
