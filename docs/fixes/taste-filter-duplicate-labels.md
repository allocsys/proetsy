# Fix scope: duplicate/contradictory rows in `image_preferences`

**Status:** implemented and tested (steps 1-3 of the proposed fix below). Full backend suite green (519/519). Step 4 (route change) confirmed as "no change needed."
**Found during:** functional correctness review, 2026-08-09.

## Bug

`POST /api/taste-filter/label` → `addImagePreference()` (`backend/lib/taste-filter/store.js`)
is a plain `INSERT`, with no lookup by `image_path`:

```
INSERT INTO image_preferences (image_path, embedding, label, category, prompt_id, auto_labeled)
VALUES (...)
```

When "auto-compute" is enabled (Settings → Taste Filter), `POST /api/taste-filter/import`
can already write a row for a candidate with `auto_labeled = 1`, *before* a human looks at
it. If the user then opens the "Auto-sorted" section and clicks Keep/Discard on that same
candidate, the label route inserts a **second** row for the same `image_path` — with no
guarantee it agrees with the first. `centroids.js` has no dedup step; it averages every
row in the table. Net effect: a corrected auto-decision can leave two rows with opposite
labels both feeding the kept/discarded centroids, and both counted toward the
`COLD_START_MIN_EXAMPLES` (30) confidence threshold.

The `auto_labeled` column comment in `schema.sql` already claims this is handled
("cleared back to 0 if the user manually corrects an auto-sorted candidate") — that
behavior does not exist anywhere in the codebase today. This fix makes the code match
that comment.

## Root cause locations

- `backend/lib/taste-filter/store.js` — `addImagePreference()`: unconditional `INSERT`.
- `backend/db/schema.sql` — `image_preferences` table: no uniqueness constraint on `image_path`.
- `backend/lib/taste-filter/centroids.js` — no dedup when aggregating rows for centroid math.
- `backend/server.js` — `POST /api/taste-filter/label`: passes straight through to `addImagePreference()`.

## Proposed fix

1. **Schema:** add a unique index on `image_path`:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_image_preferences_image_path ON image_preferences(image_path);
   ```
   Added via `runDefensiveMigrations()` in `backend/db/init.js` (the existing pattern for
   evolving tables on dev DBs created before a schema change), **not** a plain
   `ALTER TABLE`, since SQLite's `ALTER TABLE` can't add a `UNIQUE` constraint directly —
   a unique index is the standard workaround.
2. **Data migration (required before step 1 can succeed):** any existing dev/prod DB may
   already contain duplicate `image_path` rows caused by this bug. Creating the unique
   index will fail on those DBs unless duplicates are resolved first. Add a one-time
   cleanup step ahead of the `CREATE UNIQUE INDEX` migration that, for each duplicate
   `image_path`, keeps the most recent manually-labeled row if one exists, else the most
   recent row overall, and deletes the rest.
3. **Code:** change `addImagePreference()` to an upsert:
   ```sql
   INSERT INTO image_preferences (image_path, embedding, label, category, prompt_id, auto_labeled)
   VALUES (...)
   ON CONFLICT(image_path) DO UPDATE SET
     embedding = excluded.embedding,
     label = excluded.label,
     category = excluded.category,
     prompt_id = excluded.prompt_id,
     auto_labeled = excluded.auto_labeled
   ```
   `POST /api/taste-filter/label` already never passes `autoLabeled` (defaults to
   `false`/0), so a manual Keep/Discard correction on an auto-sorted candidate will
   naturally clear `auto_labeled` back to 0 as a side effect of the upsert — no separate
   "clear" code path needed.
4. **No change needed** to `POST /api/taste-filter/import`'s auto-decision write path —
   it already calls the same `addImagePreference()`, so it gets upsert semantics for free
   (relevant if a watched-folder re-import ever re-scores the same file path).

## Explicitly out of scope for this fix

- **`prompt_terms.kept_count` / `discarded_count` double-counting.** `tallyPromptTermsForLabel()`
  is additive (`+1` per label call) and isn't touched by this fix. Relabeling an image will
  still increment the *new* label's count without decrementing the *old* one, so term
  stats can still drift after a correction. Tracked as a separate follow-up — it needs its
  own before/after diff logic, not just an upsert. **Fixed separately, see
  `docs/fixes/prompt-terms-double-count.md`.**
- **Whether "auto-compute" should exist at all.** ARCHITECTURE.md's Module 7 section
  states labels are always user-confirmed; the auto-compute setting (default off) is a
  real, shipped feature that isn't reflected there. Reconciling the doc is a separate,
  non-code task.

## Test plan

- `store.test.js`: relabeling the same `image_path` updates the existing row (same `id`,
  new `label`), not a second row; `auto_labeled` flips from `1` to `0` on manual correction.
- `store.test.js`: unique-index migration runs cleanly against a fixture DB pre-seeded
  with duplicate `image_path` rows (covers the pre-existing-data case).
- `centroids.test.js` / a small regression test: centroid computation over a labeled set
  is unaffected by a prior duplicate-then-corrected label (i.e. the corrected label alone
  determines the contribution, not both).
- `server.taste-filter-routes.test.js`: `POST /api/taste-filter/label` called twice for
  the same `image_path` with different labels results in exactly one row in the DB.

## Risk / rollout notes

- The data-migration step (2) touches existing rows and is the highest-risk part of this
  change — needs to run once, idempotently, and be safe to no-op on a DB with no
  duplicates.
- No API contract changes — `POST /api/taste-filter/label`'s request/response shape is
  unchanged; only the DB-level effect of a repeat call changes (update instead of insert).
