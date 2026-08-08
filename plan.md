# Plan: Dashboard-Editable Shop Conventions

**Status:** steps 1-4 (backend getter/setter, call sites, server.js routes, frontend editable form) done. This file is the working scope doc for this change — check
items off in place as they land so this can be picked up mid-stream by anyone (or any
agent) without re-deriving the plan. Delete this file in the PR that completes the
Rollout section.

## Why

`backend/config/shop-conventions.js` (`SHOP_CONVENTIONS`, `MIDJOURNEY_CONVENTIONS`) is a
frozen, hardcoded config module. This was a deliberate original decision —
ARCHITECTURE.md -> Module 2 -> "Must hardcode shop conventions", and the dashboard route
comment says so explicitly:

```js
// Module 6 -> Settings panel: ... These are intentionally hardcoded (see
// ARCHITECTURE.md -> Module 2 -> "Must hardcode shop conventions"), so this is a
// read-only view for the dashboard, not an editable-then-PATCH resource.
app.get('/api/config/shop-conventions', (req, res) => { ... });
```

Decision reversed: the user wants these editable from the dashboard, same as
`product_sizes` already is. This plan migrates shop conventions from a static frozen
JS module to the DB-backed `settings` key/value table, following the exact pattern
`product_sizes` used (see ARCHITECTURE.md's "Differences from the original plan" table:
"Trends/tags hardcoded to their source -> Both sit behind swappable provider
interfaces" — same spirit, applied here to conventions instead).

**Not in scope:** `LISTING_VARIATIONS` (`['fine_art', 'aesthetic', 'gift']`) stays a
static export. It's structural (drives fixed DB columns/UNIQUE constraints, dashboard
component names, and the 3-variation prompt shape) — making it editable is a
materially bigger change (variable-cardinality UI, migrations) and wasn't requested.
Only `SHOP_CONVENTIONS` and `MIDJOURNEY_CONVENTIONS` become editable.

## Target shape

`settings` table gains one row per convention field, namespaced so a `GET
/api/settings` dump isn't ambiguous about which subsystem owns a key:

```
sc_titleSeparator            '|'
sc_maxTitleLength            '140'
sc_tagsPerListing            '13'
sc_tagAlternates             '5'
sc_maxTagLength              '20'
sc_forbiddenTitleWords       '["frame","framed","frames"]'        (JSON-encoded array)
sc_aiDisclosurePhrases       '["ai generated", ...]'               (JSON-encoded array)
sc_deliveryDetailPhrases     '["ships in", ...]'                   (JSON-encoded array)
mj_version                   '--v 7'
mj_style                     '--style raw'
mj_stylizeMin                '50'
mj_stylizeMax                '150'
mj_defaultStylize            '100'
mj_aspectRatioByCategory     '{"portrait":"2:3","landscape":"3:2","square":"1:1"}'   (JSON-encoded object)
```

Values are always stored as strings (matching every other `settings` row —
`PATCH /api/settings` already does `String(value)` on write); numeric/array/object
fields get parsed back to their real type on read inside `getShopConventions()`, never
by callers.

Current hardcoded values in `backend/config/shop-conventions.js` become the defaults
used when a key is unset — same fallback pattern `getPipelineConfig()` already uses for
`pipeline_module_<name>_enabled`.

## File-by-file changes

### 1. `backend/config/shop-conventions.js`
- [x] Keep `LISTING_VARIATIONS` export unchanged.
- [x] Keep `SHOP_CONVENTIONS` / `MIDJOURNEY_CONVENTIONS` frozen exports **as the default
      values** (rename intent in comments: "defaults", not "the config") — don't delete
      them, `getShopConventions()` in `config/index.js` needs something to fall back to
      and other tests may still reference shape.
- [x] Update the file's top comment — it currently says "Hardcoded shop conventions...
      See ARCHITECTURE.md -> Module 2 -> 'Must hardcode shop conventions'". Replace with
      a note that these are now defaults for the dashboard-editable `settings`-table
      values, superseding that ARCHITECTURE.md line (see doc update below).

### 2. `backend/config/index.js`
- [x] Add `SETTING_KEY_MAP` (or similar) — the `sc_*`/`mj_*` key names above, mirroring
      `pipelineEnabledSettingKey()`'s naming-function pattern. (Implemented as
      `SHOP_CONVENTION_FIELDS`, an array of `{ key, group, field, type }` rather than a
      plain name map — needed the `type` alongside each key for
      parse/serialize/validate, so a flat map wasn't enough.)
- [x] Add `export function getShopConventions()`:
  - Reads all `sc_*`/`mj_*` rows from `settings` in one query (same
    `WHERE key IN (...)` pattern `getPipelineConfig()` uses).
  - For each field: if the row exists, parse it (Number(...) for numeric fields,
    `JSON.parse(...)` for array/object fields); if absent, fall back to the matching
    field on `SHOP_CONVENTIONS/MIDJOURNEY_CONVENTIONS` imported from
    `./shop-conventions.js`.
  - Returns `{ listing: {...}, midjourney: {...} }` — same shape the current
    `GET /api/config/shop-conventions` route already returns, so no response-shape
    change for existing frontend callers of that route.
  - **No caching** (unlike `getPipelineConfig()`) — this is called from
    `validate.js`/`prompt.js` on every generation, and there's no established
    invalidation hook analogous to `invalidatePipelineConfigCache()` yet. Revisit only
    if profiling shows it matters; `product_sizes`' `getProductSizes()` also queries
    fresh every call, so this matches that precedent, not `getPipelineConfig()`'s.
  - [x] Add `export function setShopConventions(partial)` — takes a partial
        `{ listing?: {...}, midjourney?: {...} }`, validates each provided field
        (see Validation below), upserts corresponding `sc_*`/`mj_*` settings rows in a
        transaction (same `INSERT ... ON CONFLICT DO UPDATE` as `PATCH /api/settings`),
        returns the fresh `getShopConventions()` result. Keep this in `config/index.js`
        (not inline in `server.js`) so it's unit-testable the same way
        `migratePipelineConfigSeed`/`getPipelineConfig` are.
- [x] Add `backend/config/index.test.js` cases: defaults-when-unset, round-trip after
      `setShopConventions`, partial update doesn't clobber untouched fields, invalid
      input rejected (see Validation).

### 3. Validation (inside `setShopConventions`)
Minimum bar — reject with a thrown `Error` (existing routes already catch config-layer
errors into a 400, e.g. `upsertConfiguredTemplate`'s pattern in `mockup-templates`):
- [x] `maxTitleLength`, `tagsPerListing`, `tagAlternates`, `maxTagLength`,
      `stylizeMin`, `stylizeMax`, `defaultStylize` — positive integers.
- [x] `stylizeMin <= defaultStylize <= stylizeMax`.
- [x] `titleSeparator`, `version`, `style` — non-empty strings.
- [x] `forbiddenTitleWords`, `aiDisclosurePhrases`, `deliveryDetailPhrases` — arrays of
      non-empty strings; empty arrays pass (matches plan — `.some(...)` over an empty
      array is vacuously false, so turning a filter off entirely is allowed). Not yet
      covered by an explicit test case (`index.test.js` only tests the reject paths and
      a happy-path with non-empty arrays) — worth adding one before relying on it
      further, but the behavior matches spec.
- [x] `aspectRatioByCategory` — plain object, values matching `W:H` shape. Implemented
      as a fresh regex (`/^\d+:\d+$/`) directly in `validateFieldValue` rather than
      reusing existing aspect-ratio parsing — did not find an existing shared
      parser/regex for this shape in `mockup-generator.js`/`psd-template.js` during
      implementation (only looked, didn't exhaustively grep every call site — worth a
      second check before Module 3 code and this drift apart).
- No cross-field validation against `product_sizes.orientation` values is required —
  keep `aspectRatioByCategory` keys free-form, same as today's hardcoded object; a
  mismatch is a content problem for the user to notice via `prompt.js`'s existing "size
  not in config" fallback text, not a load-bearing constraint here.

### 4. `backend/lib/listing-generator/validate.js`
- [x] Change `import { SHOP_CONVENTIONS } from '../../config/shop-conventions.js'` to
      `import { getShopConventions } from '../../config/index.js'`.
- [x] Inside `enforceConventions(variation)`, add `const SHOP_CONVENTIONS =
      getShopConventions().listing;` as the first line (keeps the rest of the function
      body untouched — every reference below it is already `SHOP_CONVENTIONS.xxx`).
- [x] `validate.test.js` — seed the `settings` table (env-var-before-import pattern,
      DB_PATH set before the dynamic import) instead of relying on the static import.
      Verified: 13/13 tests pass.

### 5. `backend/lib/listing-generator/prompt.js`
- [x] Same swap as validate.js: `getShopConventions().listing` in place of the static
      `SHOP_CONVENTIONS` import, `LISTING_VARIATIONS` stays a static import (unchanged,
      out of scope — see above).
- [x] `prompt.test.js` — same seeding approach as validate.test.js. Verified: 14/14 tests pass.

### 6. `backend/lib/prompt-helper/prompt.js` and `backend/lib/prompt-helper/validate.js`
- [x] Same swap, using `getShopConventions().midjourney` instead of the static
      `MIDJOURNEY_CONVENTIONS` import.
- [x] Updated `prompt-helper/prompt.test.js` and `prompt-helper/validate.test.js`
      accordingly. Verified: 11/11 and 12/12 tests pass.

### 7. `backend/lib/llm/fixture.test.js`
- [x] This test currently imports `SHOP_CONVENTIONS` directly from
      `shop-conventions.js` with a comment noting it wants to catch drift ("a future
      SHOP_CONVENTIONS/MIDJOURNEY_CONVENTIONS change that quietly..."). Decide during
      implementation whether this should move to `getShopConventions()` (to test the
      live/DB-backed path) or deliberately keep importing the static defaults (to keep
      testing that the *fixture* LLM provider's canned output matches the *shipped
      defaults* specifically, regardless of what a shop has since customized). Leaning
      toward: keep it on the static import, since fixture.js is deliberately
      deterministic/config-independent (used by the Playwright E2E suite per
      ARCHITECTURE.md) — but read the existing comment in full and use judgment before
      changing it.

  **Resolved:** kept `fixture.test.js` on the static `SHOP_CONVENTIONS`/`LISTING_VARIATIONS`
  import for building expected values in assertions (fixture.js's own output is meant to
  be deterministic/config-independent, matching the Playwright E2E suite's expectations).
  It does now dynamic-import `enforceConventions`/`enforceMidjourneyConventions` with
  `DB_PATH` set first, since those two run the fixture's output through the live
  DB-backed validators as a compliance check — same env-var-before-import pattern as the
  other updated test files. Verified: 8/8 tests pass.

### 8. `backend/server.js`
- [x] Updated the import: dropped the direct `import { SHOP_CONVENTIONS,
      MIDJOURNEY_CONVENTIONS } from './config/shop-conventions.js'` and now imports
      `getShopConventions, setShopConventions` from `./config/index.js` instead.
- [x] `GET /api/config/shop-conventions` now calls `getShopConventions()`. Comment
      updated — no longer says "read-only... not an editable-then-PATCH resource",
      points at the PATCH route below instead.
- [x] Added `PATCH /api/config/shop-conventions` — same shape as planned: catches
      `setShopConventions()`'s thrown validation errors into a 400, same pattern as
      `POST /api/mockup-templates`.
- [x] `backend/server.config-routes.test.js` — added: GET-returns-defaults-on-empty-DB
      (renamed from the old "returns the hardcoded..." description, since that's no
      longer accurate), PATCH updates-and-persists, PATCH rejects an invalid field with
      400 and writes nothing, PATCH rejects an invalid stylize trio, partial PATCH
      doesn't clobber unrelated fields. Verified: 7/7 new/updated tests pass; full
      backend suite run is 506/515 (the same 9 pre-existing `lib/tags/user-list.test.js`
      failures as before this step, unrelated `dryRun`-field drift, not touched by this
      branch).

### 9. Frontend — `frontend/src/App.jsx`
- [x] Extracted a new `frontend/src/ShopConventions.jsx` component (matching the
      `MockupTemplates.jsx` extraction precedent), replacing the old read-only
      `shopConventions` state/summary box in `App.jsx`. The component owns its own
      fetch of `GET /api/config/shop-conventions` rather than receiving it as a prop.
- [x] Editable form covering every `listing`/`midjourney` field. Array fields
      (`forbiddenTitleWords`, `aiDisclosurePhrases`, `deliveryDetailPhrases`) render as
      one-line-per-item textareas, split/joined to/from JSON arrays client-side at the
      request boundary. `aspectRatioByCategory` renders as addable/removable
      category/ratio row pairs.
- [x] Save button → `PATCH /api/config/shop-conventions`, sending the full `listing`/
      `midjourney` objects; local state updates from the response on success.
- [x] Validation errors (400 body's `error` string) surface inline in a dismissible
      banner within the form, not just a toast.
- [x] `frontend/src/ShopConventions.test.jsx` added (dedicated file, matching the
      `MockupTemplates.test.jsx` split precedent): initial render from fetched values,
      successful edit-and-save, and the 400 error-display path.
- [x] `frontend/src/App.test.jsx` — the one existing shop-conventions assertion
      (previously checking read-only text nodes) updated to `getByDisplayValue` since
      values now live in form inputs; renamed to reflect the editable form.

### 10. `ARCHITECTURE.md`
- [x] Module 6 -> Settings panel bullet updated from "...shop conventions
      (read-only — intentionally hardcoded)" to "shop conventions (dashboard-editable,
      see `getShopConventions`/`setShopConventions` in `config/index.js`)", mirroring
      the existing product-sizes bullet's phrasing in the same list.
- [x] Module 2's "Must hardcode shop conventions" heading reframed as "Default shop
      conventions (dashboard-editable, see `getShopConventions`/`setShopConventions` in
      `config/index.js`)" — the bullet list of values underneath is unchanged, still
      accurate as *defaults*.
- [x] Checked "Open Risks — Reviewed, Accepted As-Is" — nothing there assumes
      conventions are immutable (its two entries are about AI-disclosure content policy
      and multi-key Gemini ToS risk, unrelated), so no new line item needed.
- [x] Database Schema section, `settings` row description already said "(default price,
      delivery text, shop conventions, watcher config)" — confirmed accurate as-is, no
      change needed.

### 11. Backfill / migration
- [x] Confirmed: no DB schema migration was needed — `settings` stayed a generic
      key/value table throughout steps 1-3, no new migration file added.
- [x] Confirmed: no seed migration was needed either — `getShopConventions()`'s
      fallback-to-defaults behavior made an explicit one-time seed unnecessary, exactly
      as anticipated here.

## Rollout (do in this order)

1. [x] `config/index.js`: `getShopConventions()` + `setShopConventions()` + tests.
2. [x] Swap the four call sites (`validate.js` x2, `prompt.js` x2) to the getter +
       update their tests. Land 1+2 together — half-migrated call sites would mean some
       code paths honor dashboard edits and others silently don't, which is worse than
       not shipping yet. Done — full backend suite run confirms all 6 affected test
       files pass (74/74 tests); the only failures in a full `vitest run` are 9
       pre-existing failures in `lib/tags/user-list.test.js` (unrelated `dryRun`-field
       drift from a separate in-flight change, not touched by this branch).
3. [x] `server.js` GET/PATCH routes + `server.config-routes.test.js` cases. Done.
4. [x] Frontend editable form + tests. Done.
5. [ ] `ARCHITECTURE.md` updates.
6. [ ] Delete this `plan.md` in the same PR that lands step 5.

## Open questions (resolve during implementation, not blocking the start of step 1)

- Whether `mj_aspectRatioByCategory`'s keys should be validated against
  `product_sizes.orientation` values that actually exist, or stay free-form. Leaning
  free-form (see Validation section) but worth a second look once the frontend form
  exists and it's clearer what a mismatch would look like to the user.
- Whether `getShopConventions()` needs caching later if it shows up in profiling —
  explicitly deferred, not a blocker (see point 2 under `config/index.js` above).
