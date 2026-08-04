# Debug log — Logic/flow bugs found in product_sizes DB migration review (2026-08-04)

Review scope: `remove-product-sizes-json-seed` branch (merged into `main`
2026-08-04) and related backend config/provider code. Found via manual review +
delegated multi-file investigation.

Sequenced in the order to fix them — each step is picked so it doesn't get
re-touched or invalidated by a later step.

## Step 1 — ✅ DONE (commit 684c4df) — `backend/server.js`: `PATCH /api/jobs/:id/listings/:listingId`

**Correction after reading the actual code:** this was flagged as a race condition,
but the handler is fully synchronous — no `await` between the `SELECT` and the
`UPDATE` — so on Node's single-threaded event loop, nothing can interleave in that
gap on today's single-process server. Not an active bug as written.

**What was done anyway:** wrapped the read-merge-write in
`db.transaction(() => { ... })`. This is future-proofing, not a fix for a live bug —
it guarantees atomicity stays true even if async work (e.g. an `await`) is later
added to the merge/validation step, which would otherwise silently reopen the
interleaving window without anyone noticing.

## Step 2 — ✅ DONE (commit 3173928) — `backend/server.js`: `/api/setup-status` uses row *count* as "configured" proxy

**Problem:** `hasProductSize` was computed as `COUNT(*) FROM product_sizes > 0`. Any
row — including an invalid or placeholder one — made the dashboard report "ready to
run" even when nothing usable was configured.

**Fix applied:** `hasProductSize` now requires at least one row where `dimensions`
and `mockup_template_path` are both present and non-empty. This is the same
required-field definition step 3 (`getProductSizes()` validation) should reuse, so
the two checks stay in sync.

## Step 3 — ✅ DONE (commit 8321059) — `backend/config/index.js`: `getProductSizes()` had no validation

**Problem:** Read raw rows from the `product_sizes` table and returned them
unvalidated. That table is dashboard-editable, so a bad edit — empty `dimensions`,
cleared `mockup_template_path` — flowed straight through to `mockup-generator.js`
with no guardrail.

**Fix applied:** Added `isValidProductSizeRow()` requiring `size_key`, `dimensions`,
and `mockup_template_path` all present — the same definition step 2's
`/api/setup-status` check uses. Invalid rows are skipped (with a `console.warn`),
not thrown, so one bad row doesn't take every configured size down with it.

## Step 4 — ✅ DONE (commits cc2f567, c1b953a) — `backend/lib/llm/claude.js`: `generateImage` stub throws instead of not existing

**Correction after reading the actual code:** the "mis-route causes a hard 500"
scenario doesn't actually happen today. `llm/index.js`'s `generateImage()` already
hardcodes a direct call to `gemini.js`, bypassing the `LLM_PROVIDER` switch
entirely — confirmed by `index.test.js`, which explicitly asserts
`claude.generateImage` is never called even when `LLM_PROVIDER=claude`. So this was
dead code, not a live mis-routing risk.

**Fix applied:** Removed `generateImage` from `claude.js` (`cc2f567`) and the
corresponding stub test from `claude.test.js` (`c1b953a`), since `claude.js` no
longer exports it. No change needed in `llm/index.js` — its existing hardcoded
routing to `gemini.js` already is the capability check; there was nothing to add.

## Step 5 — ✅ DONE (commits 1b22aba, 26affde, b5c063f) — `backend/config/index.js`: `getPipelineConfig()` re-queries on every call

**Problem:** Every call did a fresh `SELECT ... FROM settings` and re-joined against
the JSON seed. Not wrong, but a needless DB round-trip on a function likely called
frequently.

**Fix applied:** Added a module-level `pipelineConfigCache`, populated on first call
and invalidated by `invalidatePipelineConfigCache()` (`1b22aba`). Wired that
invalidation into `migratePipelineConfigSeed()` (whenever it actually inserts rows)
and into `server.js`'s `PATCH /api/settings` (unconditionally, since any settings
PATCH could touch a pipeline toggle) (`b5c063f`).

**Test-compatibility fix (`26affde`):** the existing test suite has a test asserting
`getPipelineConfig()` returns a fresh object every call (mutating one call's result
must not affect the next call's result). A naive "return the cached object" approach
would have broken that. Fixed by caching the computed data internally but always
returning a shallow copy (`{ ...cache, pipeline: cache.pipeline.map(e => ({...e})) }`)
on every call -- the DB round-trip is still skipped on a cache hit, which was the
actual goal, without changing the function's external contract.
