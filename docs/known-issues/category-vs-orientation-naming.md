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

## ❌ Outstanding — Backend
- [ ] `backend/lib/pipeline-runner.direct.test.js:80`
- [ ] `backend/lib/taste-filter/scoring.js` + `scoring.test.js:145`
- [ ] `backend/server.prompt-routes.test.js:44,107`
- [ ] `backend/server.config-routes.test.js:24`

## ❌ Outstanding — Frontend (entire surface still unrenamed)
- [ ] `PromptHelper.jsx` — `CATEGORIES` const, `category` state, "Category:" label, `#prompt-category-select`
- [ ] `PromptHelper.test.jsx`
- [ ] `ShopConventions.jsx:49`
- [ ] `ShopConventions.test.jsx:23`

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
