# Frontend Rebuild — Logic Review

**Repo:** allocsys/proetsy
**Branch:** `feat/frontend-rebuild-tailwind-shadcn`
**Date:** 2026-08-12
**Context:** This branch is a full frontend visual rewrite (Tailwind + Shadcn), done independently of the parallel rewrite on `main`. This review compares the two branches to separate intentional style/markup changes from actual logic/functional regressions introduced during the rewrite.

Issues #1-6 below were found during the original review and were fixed at the time. A follow-up review on 2026-08-13 independently re-verified each of them directly against current source and confirmed all six are still genuinely fixed — but it also found one new open issue (#7) that this document had not previously caught. Treat "no open issues" claims in a doc like this as a thing to re-verify, not take on trust, including this one.

**Verification:** issues #1-6 were independently re-checked directly against current source on `main` (not taken on the original reviewing agent's word alone) — reading the actual frontend call site and the actual backend route/schema/config it talks to, and confirming both sides still agree as of 2026-08-13.

---

## Issues found (all fixed)

### 1. Artwork upload sent the wrong multipart field name
- **File:** `frontend/src/views/UploadView.jsx`
- **Problem:** FormData appended files under `'artworks'`; backend `multer` config (`upload.array('files', 50)`) expected `'files'`. Every upload request 400'd with an empty file array.
- **Fix:** Field name changed to `'files'` (commit `cc2c552`).

### 2. API key creation sent the wrong payload key
- **File:** `frontend/src/views/SettingsView.jsx` (`ApiKeysTab.handleAddKey`)
- **Problem:** Sent `{ provider, key, label }`; backend route `POST /api/settings/api-keys` required `key_value`. Adding a new API key always failed with 400.
- **Fix:** Payload key changed from `key` to `key_value` (commit `2ea44cc`).

### 3. Job overall status never reached a terminal state
- **Files:** `backend/lib/jobs.js`, `frontend/src/App.jsx`
- **Problem:** No code path ever set `overall_status` to a success value, so jobs stayed `'running'` forever even after completing successfully. Broke `StatusBadge` and the sidebar pipeline-status indicators.
- **Fix:** Added `finalizeJobStatus()`, called at the end of every `setModuleStatus()`, which re-derives `overall_status` once all modules are terminal (commit `a987160`).

### 4. Missing server-side DELETE routes for tags & trends
- **Files:** `backend/server.js`, `frontend/src/hooks/useApi.js`
- **Problem:** Settings UI called `DELETE /api/tags/:id` and `DELETE /api/trends/:id`, neither of which existed server-side — requests silently 404'd.
- **Fix:** Both routes added to `server.js`, following the standard 404-if-missing / 204-on-success pattern.

### 5. Mockup composer attempted every product size, not just templated ones
- **File:** `backend/lib/pipeline-runner.js`
- **Problem:** Defaulted to `Object.keys(getProductSizes())` instead of filtering to sizes with a configured `mockup_template`, causing predictable per-size failures on every run.
- **Fix:** Default `sizeKeys` now filters to entries with a truthy `mockup_template`, mirroring the equivalent filter in `listing-generator/index.js`.

### 6. Job-by-id fetch dropped the artwork file path
- **File:** `backend/lib/jobs.js` (`getJobWithModules`)
- **Problem:** Previously a bare `SELECT * FROM jobs`, so a job loaded by id (as opposed to the jobs-list endpoint) never carried `artwork_file_path`. Silently broke the Job Workspace artwork preview/filename in `App.jsx` whenever a job was opened directly.
- **Fix:** Query now joins `artworks` and aliases `artworks.file_path AS artwork_file_path`, matching the field the jobs-list query already returns.

---

### 7. Pipeline module labels never match their config keys
- **File:** `frontend/src/views/UploadView.jsx`
- **Problem:** `MODULE_LABELS` was keyed with hyphenated, partly-wrong names: `'image-analyzer'`, `'listing-generator'`, `'mockup-generator'`, `'taste-filter'`. The actual pipeline module names, per `backend/config/pipeline.config.json`, are underscored and one didn't match in wording at all: `image_analyzer`, `listing_generator`, `mockup_composer` (not "mockup-generator"). `taste-filter` isn't a pipeline module in that config at all, so that entry was dead.
- **Effect:** `MODULE_LABELS[mod.module]` never matched any real module, so every toggle in the Pipeline Configuration section on the Upload screen fell back to the generic `{ name: mod.module, description: 'Pipeline module' }` — users saw raw internal strings like `image_analyzer` instead of "Image Analyzer / Analyzes artwork for colors, style, and composition."
- **Fix:** `MODULE_LABELS` rekeyed to `image_analyzer`, `listing_generator`, `mockup_composer`; unused `taste-filter` entry dropped (commit `b64ace4`). While in the same file, also fixed the loading-skeleton row count (`[...Array(4)]` → `[...Array(3)]`) to match the actual 3 pipeline modules (commit `63e1cbc`).
- **Status:** Fixed 2026-08-13.

---

## Summary

| # | Issue | Status |
|---|---|---|
| 1 | Upload field name (`artworks` vs `files`) | Fixed |
| 2 | API key payload (`key` vs `key_value`) | Fixed |
| 3 | `overall_status` stuck at `running` | Fixed |
| 4 | Missing DELETE routes (tags/trends) | Fixed |
| 5 | Mockup composer tries untemplated sizes | Fixed |
| 6 | Job-by-id fetch missing `artwork_file_path` | Fixed |
| 7 | Module label keys don't match pipeline config | **Open** |

Issues #1-6 remain fixed as of the 2026-08-13 follow-up review. Issue #7 is a newly-identified open item — see above for details and suggested fix. Remaining differences vs. the pre-rewrite frontend are the intended visual redesign (Tailwind CSS + Shadcn UI) and are not a correctness concern.
