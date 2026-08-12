# Correction: functional-correctness-review-2026-08-12.md is invalid

**Status:** All three issues in that doc were re-verified directly against
`feat/frontend-rebuild-tailwind-shadcn` on 2026-08-12 and do **not** reproduce.
The doc should be treated as stale/invalid pending re-verification, not as an
open bug list.

## What was checked

**Issue #1 (watch-folder settings key mismatch)** — False.
`frontend/src/views/SettingsView.jsx`'s `WatchFolderSection` reads/writes
`taste_filter_watch_enabled`, `taste_filter_watch_folder`, and
`taste_filter_watch_category` — exactly matching `SETTING_ENABLED` /
`SETTING_FOLDER` / `SETTING_CATEGORY` in `backend/lib/taste-filter/watcher.js`.
The Watch Status panel reads `watchStatus.active`, `.folder`, `.category`,
`.pendingCount`, and `.lastError` — exactly matching the shape
`getWatcherStatus()` returns. A `taste_filter_watch_category` field is present
in the UI. None of the described mismatches exist in the current code.

**Issue #2 (auto-mode settings key mismatch)** — False.
`TasteFilterAutoSection` reads and writes `taste_filter_auto_enabled` on both
the `Switch`'s `checked` prop and in `handleToggleAuto`'s `api.settings.patch`
call — exactly matching `SETTING_AUTO_ENABLED` in `backend/server.js`. The
doc's claimed key (`taste_filter_auto`) does not appear in `SettingsView.jsx`.

**Issue #3 (`orientation` vs `category` in watcher)** — False.
`backend/lib/taste-filter/watcher.js`'s `handleNewFile()` calls
`scoreCandidate(embedding, { global: globalCentroids, category: categoryCentroids })`
— using `category`, matching what `scoreCandidate` destructures in
`backend/lib/taste-filter/scoring.js`. The doc's claimed `orientation:` key is
not present.

## Likely cause

Unclear — possibly written against an earlier/stale checkout, or possibly
fabricated by whatever process generated it (the same review session that
produced this doc also included at least one other unverified claim — an
API-key route path that didn't match the real route — that turned out to be
wrong when checked directly). Either way, none of these three should be
treated as real bugs without re-confirming against a specific commit.

## Recommendation

Do not act on `functional-correctness-review-2026-08-12.md`'s issues #1–#3.
If a future automated or delegated review produces findings like these again,
verify each claim by directly reading both the frontend and backend files
before filing it.
