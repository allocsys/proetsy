# Plan: Dashboard Mockup Template Manager (folder picker + template selection)

## Problem

Today, using your own mockup template files (blank frames/canvases/mugs from Etsy mockup
packs) requires manually editing `backend/config/product-sizes.json` by hand — one JSON
entry per size, with a hand-typed path into `backend/templates/` (or wherever
`MOCKUP_TEMPLATES_DIR` points). There's no way to point the app at a folder of templates,
browse what's in it, or pick which files become templates from the dashboard. This is fine
for 2 templates; it's unworkable for "a few hundred mockups."

This plan replaces that manual-JSON-editing workflow with a real dashboard feature: pick a
folder, see what's in it (with thumbnails), and select which files become product-size
templates — no text editor, no JSON, no restart.

## What already exists (and why this is more tractable than it looks)

Three things already in the codebase make this a config-and-UI change, not a from-scratch
build:

1. **A `product_sizes` DB table already has every column this needs**
   (`backend/db/schema.sql`): `size_key`, `dimensions`, `dpi`, `orientation`,
   `mockup_template_path`, `placement_layer`. It's currently *write-only* — only populated
   lazily, one row at a time, the first time a mockup actually gets generated for that size
   (`generateMockupForJob` in `backend/lib/mockup-generator.js`). `getProductSizes()`
   (`backend/config/index.js`) still reads from the static JSON file, so the DB table and
   the JSON file are two disconnected copies of the same information today. Making the DB
   table the live, dashboard-editable source of truth (instead of a side-effect mirror) is
   most of this plan.
2. **The exact same "folder path settable from the dashboard, takes effect without a
   restart" pattern already exists** for Module 7's watched-folder auto-import
   (`backend/lib/taste-filter/watcher.js`, settings keys `taste_filter_watch_folder` etc.,
   wired through the generic `GET/PATCH /api/settings` key-value store). This plan reuses
   that exact convention for `mockup_templates_dir` instead of inventing a new one.
3. **`electron/preload.js` already has a comment flagging this exact future need**: "a
   future privileged need — e.g. a native file-save dialog for exported listings... has an
   obvious place to add a `contextBridge.exposeInMainWorld()` call." And
   `electron/main.js`'s `packagedBackendEnv()` comment says outright: *"Revisit if/when
   template management becomes dashboard-editable rather than config-file-edited."* This is
   that revisit.

## Two distinct pieces of UI (per the actual ask)

1. **Pick a folder.** A text field (same convention as the taste-filter watch folder) plus,
   when running inside Electron, a real native "Browse…" button that opens an OS folder
   picker and fills the field in — not just a typed path, an actual dialog.
2. **Select mockups from that folder.** After scanning the folder, show a thumbnail grid of
   every image/PSD file found, let the user select one (or several, for bulk-tagging same
   dimensions/DPI at once) and assign it as a product-size template, with the size's
   metadata (dimensions, DPI, orientation, placement layer for PSDs) editable inline — then
   save. Also list already-configured templates with a Remove option.

Both pieces live in a new dashboard section — see "Frontend" below.

## Backend changes

### 1. Settings key: `mockup_templates_dir`

Reuse the existing generic `settings` table — no schema change needed, `GET/PATCH
/api/settings` already accepts arbitrary keys. Just document/reserve the key, mirroring
`taste_filter_watch_folder`.

### 2. `backend/lib/mockup-generator.js`: resolve the templates dir dynamically

`TEMPLATES_BASE_DIR` is currently a module-load-time constant from
`process.env.MOCKUP_TEMPLATES_DIR`. Change it to a function,
`resolveTemplatesBaseDir()`, that reads the `mockup_templates_dir` setting first, falls back
to `MOCKUP_TEMPLATES_DIR`/`BACKEND_ROOT` if unset — same fallback chain, just settings-first
— so picking a folder from the dashboard takes effect immediately, no server restart (same
principle `syncWatcherFromSettings` already established for Module 7). Every call site that
currently reads the constant (`composeMockup`'s `templatePath` join) switches to calling the
function instead.

### 3. New module: `backend/lib/mockup-templates/index.js`

- **`scanTemplatesFolder(folder)`** — lists files directly in `folder` (flat, not
  recursive — same `depth: 0` convention `watcher.js` uses for watched folders) with
  extension in `{.png, .jpg, .jpeg, .psd}`. For each file, returns `{ filename, path,
  width, height, kind: 'flat' | 'psd', alreadyAssignedTo: sizeKey | null }`:
  - Flat PNG/JPEG: `Jimp.read()` header-only would be ideal, but Jimp doesn't expose a
    cheap header-only path — read via Jimp and take `.bitmap.width/height` (acceptable;
    these are template files, not artwork batches, so scanning "a few hundred" is a
    one-time action, not a hot path). Cache the result keyed by
    `(path, mtime)` in-process so re-scanning the same folder without any file changes
    doesn't re-read every file.
  - PSD: use `ag-psd`'s `readPsd(buffer, { skipLayerImageData: true })` to get `psd.width`/
    `psd.height` cheaply without decoding every layer's pixels (full decode only happens
    later, at actual mockup-composition time in `mockup-generator.js`).
  - `alreadyAssignedTo`: cross-reference against `product_sizes.mockup_template_path` so
    the grid can show "already used as `8x10-portrait`" instead of letting the user
    accidentally double-assign a file.
- **`generateTemplatePreview(filePath, kind)`** — produces a small flattened preview PNG
  (long edge capped at ~400px) for the thumbnail grid:
  - Flat PNG/JPEG: `Jimp.read().resize()`, written to a preview cache dir.
  - PSD: can't hand a `.psd` straight to `<img>`. Reuses the existing
    `ensurePsdCanvasInitialized()` + `readPsd()` + the paint-order flattening logic already
    in `mockup-generator.js`/`psd-template.js` (extract the "flatten every visible layer in
    stacking order onto one canvas" step out of `composeMockupPsd` into a shared helper both
    call, rather than duplicating it), writes the flattened result as a PNG into the same
    preview cache dir. This is the first real reuse of that flatten logic outside of actual
    mockup generation, which is a good forcing function to make sure it's factored as a
    standalone function rather than inlined in `composeMockupPsd`.
  - Preview cache dir: `backend/data/mockup-template-previews/` by default, overridable via
    `MOCKUP_TEMPLATE_PREVIEWS_DIR` (same env-override convention as every other data dir in
    this app). Cached by content hash or `(path, mtime)`, so re-opening the picker after the
    first scan doesn't regenerate every preview.
- **`listConfiguredTemplates()`** — reads all rows from `product_sizes` (the DB table, now
  the live source — see below).
- **`upsertConfiguredTemplate({ size_key, dimensions, dpi, orientation, mockup_template,
  placement_layer })`** — validates the referenced file exists under the current templates
  dir, then upserts into `product_sizes` (same `ON CONFLICT(size_key) DO UPDATE` pattern
  `generateMockupForJob` already uses inline — moved here so both callers share one
  function instead of two copies of the same SQL).
- **`deleteConfiguredTemplate(sizeKey)`** — deletes the `product_sizes` row. Does **not**
  delete the underlying file (the file lives in the user's own folder, outside app-managed
  storage) or touch any `mockups` rows already generated against it historically — a
  deleted size just stops being offered going forward, exactly like removing an entry from
  the old JSON file would have.

### 4. `getProductSizes()` becomes DB-backed, JSON becomes a one-time seed

`backend/config/index.js`'s `getProductSizes()` currently reads `product-sizes.json` fresh
on every call. Change it to read from the `product_sizes` DB table instead (fresh query
each call, same "always current" property, no caching to invalidate). On backend startup
(alongside `getDb()`'s existing schema init in `server.js`), run a **one-time migration**:
if `product_sizes` is empty and `product-sizes.json` has entries, insert them — so an
existing dev setup with a hand-edited JSON file doesn't lose its configured sizes on
upgrade. After that first migration, the JSON file is inert (not read again); document this
clearly in `ARCHITECTURE.md` and leave the file in place with a comment noting it's a
legacy one-time seed, not the live config, rather than deleting it outright (a still-open
question for a later cleanup pass — see "Out of scope").

### 5. New routes (`backend/server.js`)

- `GET /api/mockup-templates/scan?folder=<path>` — calls `scanTemplatesFolder()`. If
  `folder` is omitted, uses the saved `mockup_templates_dir` setting. 400 if neither is set
  or the folder doesn't exist (mirrors `syncWatcherFromSettings`'s "watched folder does not
  exist" handling, but returned as a request error here since this is a synchronous
  user-initiated scan, not a background watcher).
- `GET /api/mockup-templates` — `listConfiguredTemplates()`, each row annotated with a
  `preview_url` (see static serving below).
- `POST /api/mockup-templates` — body matches `upsertConfiguredTemplate`'s shape; used both
  for creating a new entry and editing an existing one (same upsert-by-`size_key`
  semantics the JSON file always had).
- `DELETE /api/mockup-templates/:sizeKey` — `deleteConfiguredTemplate()`.
- Static serving: `app.use('/mockup-template-previews', express.static(PREVIEW_DIR))`,
  same pattern as the existing `/mockup-files` and `/taste-filter-files` mounts.

### 6. Electron: real native folder picker

- `electron/main.js`: add an `ipcMain.handle('select-folder', async () => { const result =
  await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] }); return
  result.canceled ? null : result.filePaths[0]; })`.
- `electron/preload.js`: add the file's first real `contextBridge.exposeInMainWorld`
  call — `window.mockupTemplatesAPI = { selectFolder: () => ipcRenderer.invoke('select-folder')
  }` (naming scoped to this feature, not a generic grab-bag API, so a future privileged need
  gets its own similarly-scoped bridge call rather than everything piling into one).
- Dev-in-browser (no Electron) has no equivalent — `window.mockupTemplatesAPI` will simply
  be `undefined`, and the frontend feature-detects that (see below) rather than assuming
  Electron is always present, since `ARCHITECTURE.md`'s "local-first... must run end-to-end
  on a dev machine" already requires the whole app to work in a plain browser tab too.

## Frontend changes

New component: `frontend/src/MockupTemplates.jsx` (not job-scoped — mirrors
`TasteFilter.jsx`/`PromptHelper.jsx`'s shape, not `JobListingReview.jsx`'s), replacing the
current read-only "Product sizes / mockup templates" box in the Shop Settings view
(`frontend/src/App.jsx`) with a real management UI. Given how much surface this adds, it
gets its own `NAV_ITEMS` entry ("Mockup Templates", under the `Configuration` group
alongside Shop Settings) rather than being crammed into an already-reorganized Settings
page.

1. **Folder field**: text input bound to the `mockup_templates_dir` setting (same
   `onBlur`-saves-via-`PATCH /api/settings` pattern as every other settings field in
   `App.jsx`), plus a "Browse…" button rendered only when `window.mockupTemplatesAPI`
   exists — calls `selectFolder()`, fills the field, and saves it the same way a manual
   edit would.
2. **"Scan folder" button** → `GET /api/mockup-templates/scan` → renders a grid of
   thumbnails (reusing the `.taste-grid`/`.taste-card` CSS pattern already in
   `styles.css` — same card-grid shape, new class names where the content genuinely
   differs). Each card: thumbnail, filename, pixel dimensions, a checkbox, and an
   "already used as X" badge when `alreadyAssignedTo` is set (still selectable, to
   support re-assigning/renaming).
3. **Bulk-assign form**: appears once ≥1 card is checked. Since "a few hundred mockups"
   makes one-at-a-time entry the exact pain point being solved, this form's fields
   (dimensions, DPI, orientation) apply to *all* checked files at once on submit — only
   `size_key` and (for PSDs) `placement_layer` are necessarily per-file, so those two
   fields render as a small per-file list under the shared fields, pre-filled with a
   slugified filename as the default `size_key` (editable). Submits one `POST
   /api/mockup-templates` call per checked file.
4. **Configured templates grid**: `GET /api/mockup-templates` rendered the same
   card-grid way, each with an inline-editable dimensions/DPI/orientation/placement-layer
   form (PATCH via the same `POST /api/mockup-templates` upsert route) and a Remove
   button (`DELETE`).
5. `App.jsx`'s existing "Product sizes / mockup templates" read-only reference box
   (added in the just-shipped Settings polish pass) gets removed — this new page
   supersedes it entirely rather than the two coexisting.

## Testing

- `backend/lib/mockup-templates/index.test.js`: `scanTemplatesFolder()` against a small
  fixture folder (mix of PNG + the existing PSD test fixture) — correct dimensions, correct
  `kind`, `alreadyAssignedTo` populated/omitted correctly; `generateTemplatePreview()` for
  both kinds produces a readable PNG; upsert/delete against a real temp SQLite DB
  (mirrors `mockup-generator.idempotency.test.js`'s DB-fixture pattern).
- `backend/config/index.test.js`: update for `getProductSizes()` reading from the DB, plus
  a new test for the one-time JSON→DB migration (empty DB + populated JSON → rows inserted;
  already-populated DB + populated JSON → JSON ignored, no duplicate/overwrite).
- `backend/server.mockup-templates-routes.test.js` (new, Supertest — mirrors
  `server.mockup-routes.test.js`): scan/list/create/update/delete route behavior, the
  missing-folder 400 path, `preview_url` shape.
- `frontend/src/MockupTemplates.test.jsx` (new, mirrors `TasteFilter.test.jsx`): folder
  field save, scan-and-render grid, bulk-assign submits one call per selected file,
  configured-templates edit/remove. `window.mockupTemplatesAPI` mocked absent (browser
  path) and present (Electron path) as two separate test cases for the Browse button.
- `electron/main.test.js`: new test for the `select-folder` IPC handler (mock `dialog`,
  same mocking pattern already used for `electron`/`node:child_process`/`node:http` in
  that file).

## Rollout

1. DB-backed `product_sizes` + JSON one-time-seed migration + `getProductSizes()` switch —
   land alone first (no UI change yet, existing read-only Settings box keeps working
   unchanged since it just calls the same route, now DB-backed underneath).
2. `mockup-templates` backend module + routes (scan/list/create/delete), tested
   independently of any frontend.
3. Dynamic `resolveTemplatesBaseDir()` + `mockup_templates_dir` setting wiring in
   `mockup-generator.js`.
4. Frontend `MockupTemplates.jsx` + nav entry, folder field with plain text input only
   (no Electron button yet) — usable end-to-end in dev/browser at this point.
5. Electron `select-folder` IPC + preload bridge + the Browse button's Electron path.
6. Remove the now-redundant read-only box from `App.jsx`'s Settings view.

## Out of scope

- Deleting `backend/config/product-sizes.json` outright, or removing `getPipelineConfig()`/
  `getTrendsSeed()`'s equivalent JSON-file patterns — those aren't part of this ask; only
  product-sizes moves to DB-backed here.
- Warping/perspective-correcting PSD smart-object placement (pre-existing, documented
  limitation in `ARCHITECTURE.md` -> Module 3 -> "Template formats" — unrelated to this
  plan).
- A continuous folder *watcher* for templates (chokidar-style, like Module 7's). This plan
  is an explicit "scan → select → assign" action, not always-on watching — templates are a
  one-time/occasional setup task, not a continuous stream like Midjourney downloads.
  Revisit only if template packs are being added so frequently that re-clicking "Scan
  folder" becomes real friction.
- Uploading/copying template files into app-managed storage. Templates stay wherever the
  user's folder is; the app only reads them (and generates small previews) in place —
  consistent with "mockups use the user's own templates" per `ARCHITECTURE.md`'s guiding
  principles, and avoids duplicating what could be gigabytes across a few hundred files.
