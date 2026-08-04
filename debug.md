# Debug log — Logic/flow bugs found in product_sizes DB migration review (2026-08-04)

Review scope: `remove-product-sizes-json-seed` branch (merged into `main`
2026-08-04) and related backend config/provider code. Found via manual review +
delegated multi-file investigation.

Sequenced in the order to fix them — each step is picked so it doesn't get
re-touched or invalidated by a later step.

## Step 1 — `backend/server.js`: `PATCH /api/jobs/:id/listings/:listingId` race condition

**Why first:** the only one of these that can actually lose user data right now
(concurrent requests overwriting each other). Highest severity, fix before anything
else.

**Problem:** The route does a `SELECT`, merges the partial request body in JS, runs
it through `enforceConventions()`, then issues a separate `UPDATE`. Not atomic —
two concurrent PATCHes on the same listing can overwrite each other (lost-update
anomaly).

**Fix direction:** Wrap the read-merge-write in `db.transaction(() => { ... })` so
the whole operation is atomic.

## Step 2 — `backend/server.js`: `/api/setup-status` uses row *count* as "configured" proxy

**Why second:** same file as step 1, and a correctness bug that actively misleads
users (dashboard says "ready" when it isn't) — fix before moving to config/index.js.

**Problem:** `hasProductSize` is computed as `COUNT(*) FROM product_sizes > 0`. Any
row — including an invalid or placeholder one — makes the dashboard report "ready to
run" even when nothing usable is configured.

**Fix direction:** Check for at least one row with required fields populated
(`dimensions`, `mockup_template_path` not null) instead of a bare count.

## Step 3 — `backend/config/index.js`: `getProductSizes()` has no validation

**Why third:** directly related to step 2 — once "configured" means "has a valid
row," `getProductSizes()` should enforce that same validity on every read, not just
at setup-status time.

**Problem:** Reads raw rows from the `product_sizes` table and returns them
unvalidated. That table is dashboard-editable, so a bad edit — empty `dimensions`,
missing/zero `dpi` — flows straight through to `mockup-generator.js` with no
guardrail.

**Fix direction:** Add a schema check (e.g. Zod/Joi, or hand-rolled) in
`getProductSizes()` before returning `result`, rejecting or logging rows missing
required fields. Reuse the same "required fields" definition from step 2 so the two
checks can't drift apart.

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
