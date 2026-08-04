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

## Step 4 — `backend/lib/llm/claude.js`: `generateImage` stub throws instead of not existing

**Why fourth:** independent of the config/server work above, pure cleanup — do it
once the data-integrity fixes are settled.

**Problem:** `generateImage` is exported purely to throw "no image-generation
fallback." If any caller mis-routes an image request to the Claude provider, it's a
hard 500 instead of being filtered out earlier by capability checks.

**Fix direction:** Remove `generateImage` from `claude.js` entirely; have the
calling code in `llm/index.js` check provider capabilities before routing, instead
of relying on a defensive stub per-provider.

## Step 5 — `backend/config/index.js`: `getPipelineConfig()` re-queries on every call

**Why last:** pure performance optimization, no correctness impact — do it last so
it doesn't need to be redone if steps 1–3 change adjacent code in the same file.

**Problem:** Every call does a fresh `SELECT ... FROM settings` and re-joins against
the JSON seed. Not wrong, but a needless DB round-trip on a function likely called
frequently.

**Fix direction:** Memoize the result, invalidating the cache only when
`PATCH /api/settings` updates a pipeline-related key.
