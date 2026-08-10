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
- `TasteFilter.jsx` freeform "Curation name" field — needs a product decision before renaming

## ✅ Done — DB column rename
_(found already complete on this branch — `schema.sql`'s `prompts`, `image_preferences`, `taste_centroids` tables already use `orientation`, `idx_image_preferences_orientation` already exists, and `store.js`/`prompt-helper/index.js` already use `orientation` in their SQL with no leftover "pending migration" comments. `product_sizes.category`, `tags.category`, and `trends.category` correctly left as-is — unrelated concepts. Local dev DB file(s) still need deleting so they regenerate from the current schema, since this wasn't tracked as done until now.)_

Settings key `mj_aspectRatioByCategory` (backend/config/index.js) stays as-is regardless — that one's a stored dashboard-override key, not a schema column, and renaming it would orphan existing overrides.

## ✅ Done — Doc text fix
- `ARCHITECTURE.md`'s Module 4 section still described the renamed concept using "category" (desired category / aspect ratio per category / target category / category selector / category-filtered history) — these referred to the actual orientation concept, not the unrelated product_sizes/tags/trends "category". Fixed to "orientation" throughout, plus the matching quoted comment in `shop-conventions.js` and quoted test title in `shop-conventions.test.js`.

## ⚠️ Known risk after PR #64 merge (resolved on this branch)
Backend expected `orientation` in the renamed modules while the frontend still sent `category`, causing every prompt-generate call to 422 on `main`. Frontend now sends/reads `orientation` to match — fixed pending merge of `rename-category-orientation-continue`.

## Housekeeping
- [ ] Do the DB column rename per "Next up" above (frontend + remaining backend tests are done, so this is unblocked).

---
### Session log
| Date | Session did | Result |
|---|---|---|
| 2026-08-10 | Merged PR #64 (backend core rename) | Commit `56e7fa6` on `main` |
| 2026-08-10 | Closed remaining backend gap (scoring.js, prompt-routes, config-routes) + full frontend rename (PromptHelper, ShopConventions) | Commits through `826c11c` on `rename-category-orientation-continue`; ready for PR |
