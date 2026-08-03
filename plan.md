# Plan: Curated Upload Flow — Nav Reorg, Collapsed Direct Upload, Mockup Categories

## Problem

Three related gaps in how the Upload → Curation → Mockup path is organized today:

1. **Mockup Templates is filed under "Configuration" in the nav**, alongside Shop
   Settings & Tags — but assigning templates is prep work for what Upload/Curation
   produces, not a one-time shop-config task. It reads as a settings page, not part of
   the pipeline flow it actually feeds.
2. **The Upload view's two lanes are equal-weight**, but they aren't equal in intent.
   Per the corrected understanding from the last conversation: **Curation** (the taste
   filter) is the primary, recommended path — you label a batch, later batches get
   scored against that model, you confirm keep/discard, kept ones get promoted. The
   **Pipeline lane's own dropzone** is a separate, *unfiltered* direct-upload path — it
   bypasses curation entirely and sends whatever's dropped straight into Image Analyzer →
   Listing Generator → Mockup Composer. Nothing in the UI today signals that distinction;
   both lanes render expanded, side by side, with the same visual weight.
3. **Mockup generation has no concept of "type" or "scene."** `product_sizes` today is
   just `size_key`/`dimensions`/`dpi`/`orientation`/`mockup_template_path`/
   `placement_layer` — there's no way to tag a template as "bedroom," "hallway," "mug,"
   "nature," "green space," "white space," etc. And when a job's mockup step actually
   runs, it doesn't ask — `runPendingModulesForJob()` (`backend/lib/pipeline-runner.js`)
   unconditionally loops **every** configured `size_key` and composes a mockup for each
   one, no selection step at all. For artwork coming out of curation, the ask is a
   manual gate: show the available mockup categories, let the user pick which ones apply
   to this piece, and only generate mockups for the templates in those categories.

## What already exists (and why this is additive, not a rebuel)

- `product_sizes` DB table (`backend/db/schema.sql`) already has a defensive-migration
  precedent to extend from: `placement_layer` was added the same way (`ALTER TABLE ...
  ADD COLUMN` in `backend/db/init.js`, guarded so it's a no-op against a DB that already
  has the column). Adding `category` follows the identical pattern.
- `backend/lib/mockup-templates/index.js`'s `upsertConfiguredTemplate()` /
  `listConfiguredTemplates()` / `scanTemplatesFolder()` already read/write
  `product_sizes` rows field-by-field — adding `category` to the read/write shape is a
  small, mechanical change to functions that already exist, not a new module.
  `frontend/src/MockupTemplates.jsx` already has a "Configured templates" edit grid and a
  bulk-assign form with exactly the free-text-field pattern (`dimensions`, `dpi`,
  `orientation`) a new `category` field slots into directly.
  A `<datalist>`-backed free-text input is also already an established convention in this
  codebase for "suggest known values, but don't force an enum" — see `App.jsx`'s
  `tag-category-options` datalist for the tag library's category field. `category` here
  follows the same pattern rather than a hardcoded `<select>`.
- `NAV_ITEMS` in `App.jsx` is a flat array of `{ id, label, group }` — reordering/
  regrouping an existing entry (`mockup-templates`) is a one-line change, not a new view.
- `runPendingModulesForJob()` already isolates the mockup-composer loop into its own
  block (`const sizeKeys = Object.keys(getProductSizes())`) — adding an optional filter
  parameter there is a small, contained change, not a rewrite of the runner.
- The Taste Filter → promote → pipeline hand-off (`POST /api/taste-filter/promote` in
  `backend/server.js`, confirmed in the last conversation) is unchanged by this plan —
  this plan only adds a manual category-selection gate *after* an artwork is already in
  the pipeline and about to get mockups, it doesn't touch promotion itself.

## Changes

### 1. Nav: move Mockup Templates under Upload

In `App.jsx`'s `NAV_ITEMS`, change the `mockup-templates` entry's `group` from
`'Configuration'` to `'Pipeline'`, and reorder it to sit directly after `upload`:

```js
const NAV_ITEMS = [
  { id: 'upload', label: 'Upload', group: 'Pipeline' },
  { id: 'mockup-templates', label: 'Mockup Templates', group: 'Pipeline' },
  { id: 'history', label: 'Listing History', group: 'Pipeline' },
  { id: 'review', label: 'Review a Job', group: 'Pipeline' },
  { id: 'prompt-helper', label: 'Prompt Helper', group: 'Modules' },
  { id: 'settings', label: 'Shop Settings & Tags', group: 'Configuration' },
];
```

No changes to the `mockup-templates` view's render branch or to `MockupTemplates.jsx`
itself for this part — same component, same route id, just repositioned in the sidebar
and mobile nav strip (both already render from `NAV_ITEMS` in order, grouped by
`group`, so this is purely data-driven).

### 2. Collapse the uncurated ("Pipeline") upload lane by default

In `App.jsx`'s `activeView === 'upload'` section, the existing "Pipeline" lane (pipeline
module-override checkboxes + the raw dropzone) gets wrapped in a collapsed-by-default
`<details>` block, relabeled to make the bypass explicit:

```jsx
<details className="upload-lane-collapsible">
  <summary>Direct upload (skips curation — uploads go straight into the pipeline)</summary>
  {/* existing "Pipeline" lane content, unchanged */}
</details>
```

The "Curation" lane (`<TasteFilter />`) stays exactly as it is today — expanded, first,
no wrapper — since it's the recommended path. `<details>` is chosen over a
`useState`-driven collapse for this one: it needs no new state, no click handler, and
degrades fine with JS-disabled dev tooling; nothing here needs the animated/controlled
behavior a JS-driven collapse would justify. Add a matching `.upload-lane-collapsible`
CSS rule to `styles.css` (padding/border consistent with `.upload-lane`, plus
`summary { cursor: pointer }`).

No backend change for this item — purely a frontend structure/CSS change; the direct
dropzone's own upload/job-creation behavior (`handleFiles`, `runJobsBatch`) is untouched.

### 3. Mockup categories

**Backend**

- `backend/db/schema.sql`: add `category TEXT` (nullable, freeform — no `CHECK`
  constraint, same reasoning as `orientation`'s existing freeform string) to
  `product_sizes`.
- `backend/db/init.js`: a defensive `ALTER TABLE product_sizes ADD COLUMN category TEXT`
  migration, guarded the same way `placement_layer`'s existing migration is (wrapped so
  it's a silent no-op against a DB that already has the column), so an existing dev DB
  picks up the column without a manual reset.
- `backend/lib/mockup-templates/index.js`:
  - `upsertConfiguredTemplate({ size_key, dimensions, dpi, orientation, mockup_template,
    placement_layer, category })` — accepts and stores the new field, included in the
    existing `ON CONFLICT(size_key) DO UPDATE` upsert's column list.
  - `listConfiguredTemplates()` — includes `category` in its `SELECT` and in each
    returned/`preview_url`-annotated row.
  - `scanTemplatesFolder()`'s `alreadyAssignedTo` cross-reference is unaffected (still
    keyed by filename → `size_key`); no change needed there.
- New route `GET /api/mockup-templates/categories` in `backend/server.js` — returns the
  distinct, non-null `category` values currently configured (`SELECT DISTINCT category
  FROM product_sizes WHERE category IS NOT NULL ORDER BY category`), so the
  category-selection step (below) can populate its checklist from what's actually
  configured rather than a hardcoded list baked into the frontend.
- `backend/config/index.js`'s `getProductSizes()` / `GET /api/config/product-sizes`:
  `category` flows through automatically once it's in the `SELECT` — both already return
  whatever columns the query includes, so this is covered by the `listConfiguredTemplates`
  change above where the two overlap, and otherwise additive (Listing Generator, the only
  other consumer, ignores fields it doesn't use — confirmed no breaking change there).
- `backend/lib/pipeline-runner.js`'s `runPendingModulesForJob(jobId, options)`: add an
  optional `options.sizeKeys` array. When provided, the mockup-composer loop iterates
  that list instead of `Object.keys(getProductSizes())`; when omitted, behavior is
  **exactly** what it is today (every configured size) — so the existing direct-upload /
  "run everything" path (`POST /api/jobs/:id/run`, `POST /api/jobs/run-batch`, both
  currently called with no size filter from the collapsed direct-upload lane) needs zero
  changes to keep working as-is.
- `POST /api/jobs/:id/run` gains an optional `size_keys` body field, threaded straight
  into `runPendingModulesForJob(jobId, { sizeKeys: size_keys })`. `POST
  /api/jobs/run-batch` is deliberately **not** extended the same way in this pass — bulk
  mode's whole point is "run everything for a big batch," and per-job category selection
  doesn't fit a batch shape cleanly; a curated single-artwork job uses the single-job
  route instead (see the frontend piece below).

**Frontend**

- `MockupTemplates.jsx`:
  - Add a "Category" field to the bulk-assign form (scan-and-select grid) — an
    `<input list="mockup-category-options">` + a `<datalist>` seeded with a small set of
    suggestions (`bedroom`, `hallway`, `mug`, `nature`, `green space`, `white space`) plus
    whatever distinct categories `GET /api/mockup-templates/categories` already returns,
    merged — same free-text-with-suggestions convention as `App.jsx`'s
    `tag-category-options`. Included in each per-file `POST /api/mockup-templates` call
    the bulk-assign submit already makes.
  - Add the same field to the "Configured templates" inline-edit grid (next to
    Dimensions/DPI/Orientation), wired through `updateConfiguredEdit`/
    `getConfiguredValue`/`saveConfiguredEdit` exactly like the existing three fields.
- New category-selection step for the curated flow — a small addition surfaced where a
  promoted/curated artwork's job is about to get mockups (in or alongside
  `JobMockupReview.jsx`, exact placement to be settled at implementation time since that
  component today only *reviews already-generated* mockups and has no "generate" trigger
  of its own yet):
  - Fetches `GET /api/mockup-templates/categories` for the checklist, and
    `GET /api/mockup-templates` to resolve each checked category to its underlying
    `size_key`s (a template with no category set is excluded from this picker entirely —
    uncategorized templates aren't reachable from the curated flow's category gate, only
    from the direct-upload lane's "run everything" behavior).
  - On submit, calls `POST /api/jobs/:id/run` with `{ size_keys: [...resolved keys] }`,
    so only the chosen categories' templates get composed for that job — not the
    blanket "every configured size" behavior the direct/uncurated lane still uses
    unchanged.
  - This is additive UI, not a replacement: a job that never visits this step (e.g. one
    created via the still-unfiltered direct-upload lane, or via `run-batch`) keeps
    getting mockups for every configured size, exactly as today.

## Testing

- `backend/db/init.test.js` (or wherever `placement_layer`'s migration is currently
  covered): a matching case for `category`'s `ALTER TABLE` migration — no-op against a DB
  that already has the column, adds it against one that doesn't.
- `backend/lib/mockup-templates/index.test.js`: extend the existing upsert/list round-trip
  cases to cover `category` (set, unset/null, and updated on a re-upsert).
- `backend/server.mockup-templates-routes.test.js`: extend `POST`/`GET
  /api/mockup-templates` cases for the new field; new test for `GET
  /api/mockup-templates/categories` (empty when nothing's categorized, distinct/sorted
  list once some are, excludes null).
- `backend/lib/pipeline-runner.test.js` (new or extended): `runPendingModulesForJob`
  with no `sizeKeys` option behaves exactly as before (regression guard); with a
  `sizeKeys` filter, only those sizes are attempted — confirmed against
  `generateMockupForJob` call counts/args, not just the returned summary shape.
- `backend/server.pipeline-runner-routes.test.js`: extend for `POST /api/jobs/:id/run`'s
  new optional `size_keys` body field, including the "omitted → runs everything" case.
- `frontend/src/MockupTemplates.test.jsx`: extend for the new Category field on both the
  bulk-assign form and the configured-template edit grid.
- New frontend test for the category-selection step (mocks `GET
  /api/mockup-templates/categories`, `GET /api/mockup-templates`, and the `POST
  /api/jobs/:id/run` call with `size_keys`).
- `App.test.jsx`: nav-order assertion updated for `mockup-templates` moving into the
  `Pipeline` group; new case for the direct-upload `<details>` block rendering collapsed
  by default and expanding on click, with the Curation lane unaffected.

## Rollout

1. `category` column + migration (`schema.sql` + `db/init.js`).
2. `upsertConfiguredTemplate`/`listConfiguredTemplates` support for `category`, plus the
   new `GET /api/mockup-templates/categories` route — backend-only, no UI change yet.
3. `MockupTemplates.jsx`: Category field on the bulk-assign form and the configured-
   templates edit grid — usable end-to-end for tagging templates at this point.
4. `pipeline-runner.js`'s optional `sizeKeys` filter + `POST /api/jobs/:id/run`'s
   `size_keys` body field — backend-only; omitted-filter behavior unchanged, so nothing
   downstream breaks before the frontend catches up.
5. Category-selection step wired into the curated-artwork mockup-generation flow
   (exact component placement decided against `JobMockupReview.jsx`'s current shape at
   implementation time).
6. Nav reorg: move `mockup-templates` into the `Pipeline` group, directly after `upload`.
7. Collapse the direct/uncurated Pipeline lane behind a `<details>`, collapsed by
   default; Curation lane unchanged.

## Out of scope

- Enforcing `category` as a strict enum/fixed taxonomy. Kept freeform (datalist
  suggestions, not a hardcoded `<select>`) so new categories don't require a code change
  — matches how `orientation` and the tag library's `category` field already work in this
  codebase. Revisit only if an unconstrained free-text field turns out to cause real
  duplication/typo problems in practice (e.g. "green space" vs. "greenspace" fragmenting
  the picker) once there's real usage to look at.
- Auto-suggesting categories from artwork content (e.g. inferring "this looks like a
  bedroom piece" from Module 1's image analysis). This pass is manual selection only —
  an AI-assisted suggestion could layer on top later without changing the underlying
  `category` field or the selection UI's shape.
- Changing what the direct/uncurated Pipeline lane's own upload does — it keeps
  generating mockups for every configured size, unfiltered, exactly as today. Only the
  curated flow gets the new category-gated step; collapsing the lane behind `<details>`
  (item 2) is a visibility change, not a behavior change.
- Extending `POST /api/jobs/run-batch` with a per-job category filter — bulk mode stays
  "run everything," per the reasoning in the backend section above. Revisit if bulk
  curated-batch runs turn out to be common enough to justify a per-job filter shape
  there.
- Multi-category selection *combining* templates from different categories into a single
  composed mockup (e.g. "artwork in a bedroom AND on a mug in the same image") — each
  selected category just resolves to its own template(s), composed independently, same
  as today's one-mockup-per-`size_key` model. A true multi-template composite is a
  different, larger feature.
