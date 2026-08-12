# Frontend Rebuild — Logic Review

**Repo:** allocsys/proetsy
**Branch:** `feat/frontend-rebuild-tailwind-shadcn`
**Date:** 2026-08-12
**Context:** This branch is a full frontend visual rewrite (Tailwind + Shadcn), done independently of the parallel rewrite on `main`. This review compares the two branches to separate intentional style/markup changes from actual logic/functional regressions introduced during the rewrite.

All issues below were found during review and have since been fixed on this branch. No open issues remain as of this writing.

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

---

## Summary

| # | Issue | Status |
|---|---|---|
| 1 | Upload field name (`artworks` vs `files`) | Fixed |
| 2 | API key payload (`key` vs `key_value`) | Fixed |
| 3 | `overall_status` stuck at `running` | Fixed |
| 4 | Missing DELETE routes (tags/trends) | Fixed |
| 5 | Mockup composer tries untemplated sizes | Fixed |

No logic/functional issues remain open on this branch. Remaining differences vs. `main` are the intended visual redesign (Tailwind CSS + Shadcn UI) and are not a correctness concern.
