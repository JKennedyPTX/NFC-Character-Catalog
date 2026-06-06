# NFC Catalog — Testing Log

## [v0.1 — 2026-06-06]

**Build:** ✅ `vite build` succeeds (1578 modules). One warning: JS bundle is 557 kB / 187 kB gzipped — exceeds Vite's 500 kB threshold. Caused by `xlsx` + `qrcode` in one chunk. Cosmetic warning, not a failure.
> Note: existing `dist/` from a prior build cannot be cleared by the sandbox (host-owned files); build was run to a temp dir to verify success.

**Lint:** N/A — no lint script in `package.json`, no ESLint config present.

**Static checks:**

- ✅ All npm dependencies resolve: `papaparse`, `xlsx`, `qrcode`, `lucide-react`
- ✅ All 12 lucide-react icons used in App.jsx exist in the installed version (`Search`, `Plus`, `Edit2`, `Trash2`, `Upload`, `Download`, `Settings`, `X`, `Sun`, `Moon`, `QrCode`, `Radio`)
- ✅ Hash routing logic correct for all cases (`#/`, `#/e/<id>`, unknown → home)
- ✅ `buildPalette()` produces valid 6-digit hex values for all theme presets, light + dark
- ✅ `normalizeEntry()` migration handles: `imageUrl` → `images[]`, null theme, null links, inheritTheme coercion
- ✅ `localStorage` keys namespaced (`nfc-catalog:*`) — no collision risk
- ✅ `localStorage` reads are lazy (inside `useState` initializer functions) — no SSR crash risk
- ✅ `--entry-accent` and `--fc` CSS variables are set inline per-element in JSX (not missing globals)
- ✅ `--entry-accent` has a fallback: `var(--entry-accent, var(--accent))` — safe
- ✅ `toSlug()` / `uniqueSlug()` logic correct, including collision suffix (`-2`, `-3`, …)
- ✅ `entryTagUrl()` strips trailing slashes from baseUrl correctly; empty baseUrl produces relative `#/e/<id>`
- ✅ `resolveTheme()` falls back correctly when collection theme not set
- ✅ `AdminPanel` re-mounts on each open (conditional render) — `initialEditId` prop works correctly
- ✅ No TODO/FIXME/STUB markers in source
- ✅ All required files present (`package.json`, `vite.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx`, `src/App.css`, `node_modules/`)
- ⚠️ Route `#/manage` parses to `{ page: 'manage' }` but no JSX branch handles it — navigating there renders an empty `<main>`. Minor/vestigial; no nav link points to it.
- ⚠️ `ImagePicker` uses array index as React `key` in `images.map()`. After reorder, React may render stale state in thumb inputs. Low real-world impact; would be cleaner with stable image IDs.
- ⚠️ `color-mix()` used in 9 CSS rules with no `@supports` fallback. Requires Chrome 111+ / Firefox 113+ / Safari 16.2+. Graceful degradation would fail on older browsers (folder tabs and hover states lose tinting). Acceptable for an NFC app targeting modern mobile Chrome.
- ⚠️ Import flow: entries with both empty `id` and empty `name` produce slug `""` — not a crash, but would result in an entry with a blank ID. Edge case; only hit with a malformed CSV/XLSX.
- ⚠️ `compressImage` caps images at 400px max dimension — intentional localStorage trade-off, but thumbnails may appear soft on retina displays.

**Manual browser tests needed:**

- [ ] Home page: confirm three seed entries (Tree Frog, Patrick Star, Yoda) appear as cards on first load (no prior localStorage)
- [ ] Entry detail: click a card, verify hero image/emoji, description, links, and NFC Tag URL all render
- [ ] Search: type "frog" → only Tree Frog card; clear → all entries return
- [ ] Collection filter: click a collection tab; confirm grid filters to that collection
- [ ] Add entry: open ⚙ → New entry → fill fields → save → confirm appears in grid
- [ ] Edit entry: open detail → Edit → change tagline → save → confirm change reflected
- [ ] Delete entry: delete from manage panel → confirm removed from grid
- [ ] Spreadsheet import: import CSV with `name,code,collection,tagline` columns → entries appear
- [ ] Export/import JSON: export → clear an entry → re-import → entry restored
- [ ] Dark mode: toggle moon/sun → theme updates across all pages
- [ ] QR code: open entry → "Show QR code" → QR renders in accent colour → "Download PNG" saves file → scan with phone opens entry
- [ ] NFC write tab: on Chrome Android (HTTPS) shows "Write tag" buttons; on desktop shows "Web NFC not available" notice with URL list
- [ ] Multi-image gallery: add ≥2 images → reorder → cover badge on first → thumbnails clickable → lightbox opens and pages through → card shows image-count badge
- [ ] Collection theming: set theme on a collection in Collections tab → enable "Use collection theme" on an entry → card and detail page use collection colours; disabling restores entry theme
- [ ] `#/manage` dead route: navigate to `<base>#/manage` manually → confirm app doesn't crash (just shows empty main)
- [ ] `color-mix()` visual check: folder tabs and hover states display tinted backgrounds (verifies modern browser requirement)

**Notes:**
- No backend, no env vars — entirely self-contained. Safe to open `dist/index.html` directly or via `npm run preview`.
- Bundle size is the main architectural concern: `xlsx` is ~500 kB alone. If bundle size matters, consider lazy-loading the Import tab.
- The `#/manage` route in `parseRoute()` is dead code — could be removed or wired to open the admin panel.
- No test suite exists. Adding Vitest unit tests for `normalizeEntry`, `buildPalette`, `parseRoute`, and `toSlug` would be straightforward given the pure-function structure.

---

## [v0.1.1 — 2026-06-06] — Bug-fix patch

**Build:** ✅ `vite build --outDir /tmp/nfc-build` succeeds (1578 modules, same bundle size as v0.1). Sandbox cannot clear host-owned `dist/`, so temp dir used as in v0.1.

**Fixes applied:**

1. **Dead `#/manage` route removed** (`src/App.jsx` — `parseRoute()`): Deleted the `if (h === 'manage') return { page: 'manage' }` branch. Navigating to `#/manage` now falls through to `{ page: 'home' }` — no blank screen, no orphaned route.

2. **Stable React key in `ImagePicker`** (`src/App.jsx`): Replaced `key={i}` (array index) with `key={img}` (the image URL or data-URL) in the `images.map()` thumbnail loop. Eliminates stale-state bugs after reorder operations.

3. **`color-mix()` wrapped in `@supports`** (`src/App.css`): All 9 `color-mix()` rules now have a `@supports (color: color-mix(in srgb, red, blue))` guard. Fallback values outside the block use the base CSS variables (`var(--card)`, `var(--rule)`, `var(--paper)`, or `transparent`) so older browsers get a sensible appearance instead of unstyled elements.

4. **Blank-ID rows skipped in CSV/XLSX importer** (`src/App.jsx` — `SpreadsheetImporter`): `commit()` now filters mapped rows by both `e.name` and `e.id` (previously only `e.name`). Rows that produce an empty ID after slugification are counted as skipped. `handleImport()` accepts the skipped count and surfaces it in the confirmation alert: *"Imported N entries (M skipped — blank name or ID)"*.
