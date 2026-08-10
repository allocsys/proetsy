# Category → Orientation Rename: Remaining Work

**Repo:** allocsys/proetsy
**Origin:** #62
**PR #64:** Merged into `main` (commit `56e7fa6`) — completed the backend core, but **left the frontend and several backend files unrenamed**.

This is a multi-session task. Use this doc as the single source of truth for what's done and what's left. Update the checkboxes as work lands, and note the PR/commit that closed each item.

---

## ✅ Done (merged in PR #64)
- `backend/config/shop-conventions.js` + test
- `backend/config/index.js` + test
- `backend/lib/prompt-helper/index.js`, `prompt.js`, `validate.js` + all their tests
- `backend/lib/taste-filter/store.js`, `centroids.js` + `centroids.test.js`
- DB columns intentionally left as `category` pending a future migration (by design, not a gap)

## ✅ Done (this branch, `rename-category-orientation-continue`)
- [x] `backend/lib/pipeline-runner.direct.test.js:80` — already clean as merged in PR #64, no dangling refs found
- [x] `backend/lib/taste-filter/scoring.js` + `scoring.test.js:145`
- [x] `backend/server.prompt-routes.test.js:44,107`
- [x] `backend/server.config-routes.test.js:24` — was still asserting `aspectRatioByCategory`, fixed to `aspectRatioByOrientation`
- [x] `PromptHelper.jsx` — `CATEGORIES` → `ORIENTATIONS`, `category` state → `orientation`, "Category:" label → "Orientation:", `#prompt-category-select` → `#prompt-orientation-select` (trend's own `category` field left untouched — real, unrelated concept)
- [x] `PromptHelper.test.jsx`
- [x] `ShopConventions.jsx:49` — `aspectRatioByCategory` → `aspectRatioByOrientation` throughout (state, payload, labels, placeholders)
- [x] `ShopConventions.test.jsx:23`

## ❌ Outstanding — Backend
_(none — full sweep for `aspectRatioByCategory` / `prompt-category-select` across the repo came back clean)_

## ❌ Outstanding — Frontend
_(none — see Done above)_

## ⏸️ Deferred by design (not gaps — needs separate decision)
- DB migration for `prompts`, `image_preferences`, `taste_centroids` tables (columns stay `category` until this happens)
- `TasteFilter.jsx` freeform "Curation name" field — needs a product decision before renaming

## ⚠️ Known risk after PR #64 merge
Backend now expects `orientation` in the renamed modules while the frontend still sends `category`. **This is a live mismatch on `main` right now** — treat closing the frontend gap as high priority, not cleanup.

## Housekeeping
- [ ] Once frontend + remaining backend tests are done, decide on and schedule the DB column migration.

---
### Session log
| Date | Session did | Result |
|---|---|---|
| 2026-08-10 | Merged PR #64 (backend core rename) | Commit `56e7fa6` on `main` |
