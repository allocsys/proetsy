« Consolidated Functional Correctness Review »

**Repo:** allocsys/proetsy
**Branch:** feat/frontend-rebuild-tailwind-shadcn
**Consolidated:** 2026-08-12, re-verified directly against source on this branch.

This supersedes the four separate review docs below as the single source of truth.
Nothing from them was dropped — every issue is preserved here with its original
detail (where it happens, impact, suggested fix) plus a **Status** line confirming
whether it still reproduces on the current branch. Original docs, for history:
- `functional-correctness-review-2026-08-11.md`
- `functional-correctness-review-2026-08-12.md` (Taste Filter — see CORRECTION)
- `functional-correctness-review-2026-08-12-CORRECTION.md`
- `functional-correctness-review-2026-08-12-upload-and-settings.md`

---

## ✅ RESOLVED — no action needed

### R1. `jobs.overall_status` never reached a terminal success state
**Originally:** High — every job stayed `'running'` forever even after full success,
since no code path ever set `overall_status` to a success value. Broke the
`StatusBadge`, sidebar pipeline-status bar, and batch summaries in `App.jsx`.

**Status: FIXED.** `backend/lib/jobs.js` now has `finalizeJobStatus(db, jobId)`,
called at the end of every `setModuleStatus()`. It re-derives `overall_status` from
the job's non-skipped modules once they're all terminal (`'success'` if none
failed, `'failed'` otherwise). The fix's comment explicitly cites this issue.

### R2. Frontend called DELETE routes for tags/trends that didn't exist
**Originally:** High — Settings → Tags & Trends' "Delete tag"/"Delete trend"
buttons hit `DELETE /api/tags/:id` and `DELETE /api/trends/:id`, neither of which
existed server-side (404, silently swallowed by the frontend).

**Status: FIXED.** `backend/server.js` now defines both:
```js
app.delete('/api/tags/:id', (req, res) => { ... });   // cites this issue in comment
app.delete('/api/trends/:id', (req, res) => { ... });  // cites this issue in comment
```
Both follow the standard 404-if-missing / 204-on-success pattern. Frontend's
`api.tags.delete` / `api.trends.delete` (in `hooks/useApi.js`) target the correct
paths.

### R4. Artwork upload sends the wrong multipart field name
**Originally:** Critical — no artwork could be uploaded via the dashboard at all.
`UploadView.jsx:111` appended files under the `artworks` field, but the backend
(`upload.array('files', 50)`) expected `files`, so `multer` always populated an
empty array and every upload attempt 400s.

**Status: FIXED.** `formData.append('artworks', file)` changed to
`formData.append('files', file)` in `UploadView.jsx` (commit `cc2c552`).

### R5. API key creation sends the wrong payload key
**Originally:** High — adding a new API key from Settings failed. The frontend's
`ApiKeysTab.handleAddKey` sent `{ provider, key, label }`, but the backend route
`POST /api/settings/api-keys` required `key_value`, so the request 400s every
time.

**Status: FIXED.** Frontend payload key changed from `key` to `key_value` in
`SettingsView.jsx`'s `handleAddKey` (commit `2ea44cc`).

### R3. Mockup composer attempted every size, not just templated ones
**Originally:** Low — `pipeline-runner.js` defaulted to `Object.keys(getProductSizes())`
instead of filtering to sizes with a configured `mockup_template`, producing
predictable per-size failures on every run.

**Status: FIXED.** `pipeline-runner.js`'s default `sizeKeys` now filters
`Object.entries(getProductSizes())` down to entries with a truthy `mockup_template`,
mirroring `listing-generator/index.js`'s `availableSizes` filter. Comment cites this
issue directly.

---

## ❌ INVALID — do not act on these (confirmed via direct re-read + independent re-check)

The `2026-08-12.md` (Taste Filter) doc's three issues were already flagged as
fabricated/stale by a CORRECTION doc. I independently re-read the current source on
`feat/frontend-rebuild-tailwind-shadcn` and confirm the CORRECTION is right — none
of these reproduce:

### X1. "Watch folder settings write to keys the watcher never reads" — false
`SettingsView.jsx`'s `WatchFolderSection` reads/writes `taste_filter_watch_enabled`,
`taste_filter_watch_folder`, and `taste_filter_watch_category` — exactly matching
`SETTING_ENABLED`/`SETTING_FOLDER`/`SETTING_CATEGORY` in
`backend/lib/taste-filter/watcher.js`. The status panel reads `watchStatus.active`,
`.folder`, `.category`, `.pendingCount`, `.lastError` — exactly matching
`getWatcherStatus()`'s return shape. A category field is present in the UI.

### X2. "Taste Filter Auto Mode toggle writes to the wrong key" — false
`TasteFilterAutoSection`'s `Switch` reads `settings.taste_filter_auto_enabled` and
`handleToggleAuto` writes `{ taste_filter_auto_enabled: checked }` — exactly
matching `SETTING_AUTO_ENABLED` in `backend/server.js`.

### X3. "Watched-folder candidates never receive a category score" — false
`watcher.js`'s `handleNewFile()` calls
`scoreCandidate(embedding, { global: globalCentroids, category: categoryCentroids })`
— using `category`, matching what `scoreCandidate` destructures in `scoring.js`. No
`orientation:` key anywhere in this call.

**Likely cause (per the CORRECTION doc):** unclear — possibly a stale checkout or a
fabricated finding from whatever review pass produced the original doc. Treat any
future automated finding of this shape with the same skepticism until directly
re-verified against source.

---

## 🔴 OPEN — confirmed still broken

None — all previously open issues have been fixed. See Summary below.

---

## Summary

| # | Issue | Status |
|---|---|---|
| R1 | `overall_status` stuck at `running` | Fixed |
| R2 | Missing DELETE routes (tags/trends) | Fixed |
| R3 | Mockup composer tries untemplated sizes | Fixed |
| R4 | Upload field name (`artworks` vs `files`) | Fixed |
| R5 | API key payload (`key` vs `key_value`) | Fixed |
| X1 | Watch-folder key mismatch | Invalid (never real) |
| X2 | Auto-mode key mismatch | Invalid (never real) |
| X3 | Watcher `orientation` vs `category` | Invalid (never real) |

All known real issues from the original review passes have been fixed. No open
items remain.
