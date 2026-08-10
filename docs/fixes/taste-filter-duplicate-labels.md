# Fix scope: `image_preferences` label integrity (duplicate rows + prompt-term double-counting)

**Status:** implemented and tested. Full backend suite green (519/519).
**Found during:** functional correctness review, 2026-08-09 (bug 1), with bug 2 tracked
as an explicit follow-up and fixed in the same branch/PR shortly after.

Two related bugs in how a relabeled taste-filter candidate is persisted, fixed together
here since the second is a direct consequence of the first's dedup logic:

1. **Duplicate/contradictory rows in `image_preferences`** — relabeling a candidate could
   insert a second row instead of correcting the first, corrupting centroid math.
2. **`prompt_terms.kept_count`/`discarded_count` double-counting** — even after (1) was
   fixed to upsert by `image_path`, the term-tally side of a relabel was still purely
   additive, so a correction left a phantom `+1` behind on the label it moved away from.

---

## Bug 1: duplicate/contradictory rows in `image_preferences`

`POST /api/taste-filter/label` → `addImagePreference()` (`backend/lib/taste-filter/store.js`)
was a plain `INSERT`, with no lookup by `image_path`:

```
INSERT INTO image_preferences (image_path, embedding, label, category, prompt_id, auto_labeled)
VALUES (...)
```

When "auto-compute" is enabled (Settings → Taste Filter), `POST /api/taste-filter/import`
can already write a row for a candidate with `auto_labeled = 1`, *before* a human looks at
it. If the user then opens the "Auto-sorted" section and clicks Keep/Discard on that same
candidate, the label route inserted a **second** row for the same `image_path` — with no
guarantee it agreed with the first. `centroids.js` has no dedup step; it averages every
row in the table. Net effect: a corrected auto-decision could leave two rows with opposite
labels both feeding the kept/discarded centroids, and both counted toward the
`COLD_START_MIN_EXAMPLES` (30) confidence threshold.

The `auto_labeled` column comment in `schema.sql` already claimed this was handled
("cleared back to 0 if the user manually corrects an auto-sorted candidate") — that
behavior didn't exist anywhere in the codebase before this fix. This fix makes the code
match that comment.

### Root cause locations
- `backend/lib/taste-filter/store.js` — `addImagePreference()`: unconditional `INSERT`.
- `backend/db/schema.sql` — `image_preferences` table: no uniqueness constraint on `image_path`.
- `backend/lib/taste-filter/centroids.js` — no dedup when aggregating rows for centroid math.
- `backend/server.js` — `POST /api/taste-filter/label`: passed straight through to `addImagePreference()`.

### Fix
1. **Schema:** added a unique index on `image_path`:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_image_preferences_image_path ON image_preferences(image_path);
   ```
   Added via `runDefensiveMigrations()` in `backend/db/init.js` (the existing pattern for
   evolving tables on dev DBs created before a schema change), **not** a plain
   `ALTER TABLE`, since SQLite's `ALTER TABLE` can't add a `UNIQUE` constraint directly —
   a unique index is the standard workaround.
2. **Data migration (required before step 1 could succeed):** any existing dev/prod DB may
   already have contained duplicate `image_path` rows caused by this bug. Creating the
   unique index would fail on those DBs unless duplicates were resolved first. A one-time
   cleanup step runs ahead of the `CREATE UNIQUE INDEX` migration that, for each duplicate
   `image_path`, keeps the most recent manually-labeled row if one exists, else the most
   recent row overall, and deletes the rest.
3. **Code:** changed `addImagePreference()` to an upsert:
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
   `false`/0), so a manual Keep/Discard correction on an auto-sorted candidate naturally
   clears `auto_labeled` back to 0 as a side effect of the upsert — no separate "clear"
   code path needed.
4. **No change needed** to `POST /api/taste-filter/import`'s auto-decision write path —
   it already calls the same `addImagePreference()`, so it gets upsert semantics for free
   (relevant if a watched-folder re-import ever re-scores the same file path).

### Test plan
- `store.test.js`: relabeling the same `image_path` updates the existing row (same `id`,
  new `label`), not a second row; `auto_labeled` flips from `1` to `0` on manual correction.
- `store.test.js`: unique-index migration runs cleanly against a fixture DB pre-seeded
  with duplicate `image_path` rows (covers the pre-existing-data case).
- `centroids.test.js` / a small regression test: centroid computation over a labeled set
  is unaffected by a prior duplicate-then-corrected label (i.e. the corrected label alone
  determines the contribution, not both).
- `server.taste-filter-routes.test.js`: `POST /api/taste-filter/label` called twice for
  the same `image_path` with different labels results in exactly one row in the DB.

### Risk / rollout notes
- The data-migration step (2) touches existing rows and was the highest-risk part of this
  change — runs once, idempotently, and safely no-ops on a DB with no duplicates.
- No API contract changes — `POST /api/taste-filter/label`'s request/response shape is
  unchanged; only the DB-level effect of a repeat call changed (update instead of insert).

---

## Bug 2: `prompt_terms.kept_count`/`discarded_count` double-counting on relabel

Explicitly called out as out of scope when Bug 1 was fixed, then fixed here as a direct
follow-up.

`tallyPromptTermsForLabel()` (`backend/lib/taste-filter/store.js`) was purely additive —
every call to `POST /api/taste-filter/label` bumped whichever column (`kept_count` or
`discarded_count`) matched the label being applied, by `+1`, with no memory of any prior
label for that image.

`image_preferences` now upserts on `image_path` (Bug 1, above), so relabeling the same
image is a normal, expected flow: correcting an auto-sorted candidate, or fixing a manual
mis-click. But `tallyPromptTermsForLabel()` only ever added — it never decremented the
*old* label's contribution. Net effect: a term's `kept_count`/`discarded_count` drifted
further out of sync with the actual current set of labeled images the more relabeling
happened, since every correction left a phantom `+1` behind on the label it moved away
from. Module 4's `getStyleHints()` (`backend/lib/prompt-helper/index.js`) reads
`WHERE kept_count > discarded_count` to surface style-hint terms, so this drift could bias
which terms Module 4 suggests.

### Root cause location
- `backend/lib/taste-filter/store.js` — `tallyPromptTermsForLabel(promptId, label)`: an
  unconditional `+1` upsert, no lookup of the image's previous label/prompt.

### Fix
1. **New read helper**, `getImagePreferenceState(imagePath)` — returns the image's
   current `{ promptId, label }` (or `null` if it's never been labeled), read from
   `image_preferences` *before* `addImagePreference()`'s upsert overwrites that row.
2. **`server.js`**'s `POST /api/taste-filter/label` route calls
   `getImagePreferenceState(image_path)` before `addImagePreference()`, and passes the
   result as `tallyPromptTermsForLabel(promptId, label, previousState)`'s third argument.
3. **`tallyPromptTermsForLabel()`** now takes an optional `previous` argument, with three
   cases: no `previous` given behaves as a fresh `+1` tally (same as the original
   increment-only version, for callers that don't track state); `previous` differing from
   the `(promptId, label)` being applied is a real relabel -- undoes the previous state's
   contribution first (`-1`, via a new `adjustPromptTermCounts()` helper, clamped at 0
   with `MAX(column - 1, 0)` so a term can never go negative) before tallying the new one
   (`+1`); `previous` identical to the new state is a redundant re-label -- a pure no-op,
   returned early before either the decrement or increment runs, since it already
   contributed its `+1` the first time.

The clamp-at-0 matters for rows written before this fix shipped: an old relabel's
increment was never reversed, so decrementing today's relabel against that
already-inflated count must not push it negative.

### Follow-ups (issue #59) — now fixed in this same branch/PR

Both items originally called out as out of scope for Bug 1 are fixed here too, rather than
left as separate work:

1. **Auto-decided labels now tally.** `POST /api/taste-filter/import`'s auto-compute
   decision branch now calls `getImagePreferenceState()` before `addImagePreference()`
   and passes it into `tallyPromptTermsForLabel(promptId, decision, previousState)`,
   exactly like the manual label route does. An auto-applied keep/discard is a real
   training signal and now feeds `prompt_terms` like any other label.
2. **Historical drift is now correctable.** New `recomputePromptTerms()` (`store.js`)
   rebuilds every `prompt_terms` row's counts from the *current* `image_preferences`
   table, the same "full recompute over the current labeled set" pattern
   `recomputeCentroids()` already uses for centroids — since it reads each image's
   current label directly rather than trusting a running delta, it can't drift no matter
   how much relabeling happened, and self-heals any counts left inflated from before this
   fix shipped. Wired into the existing `POST /api/taste-filter/recompute` ("Recompute
   now") route, alongside its centroid recompute.

### Test plan
- `store.test.js`: relabeling the same prompt from `keep` to `discard` moves the term's
  count from one column to the other rather than leaving both incremented; a redundant
  re-label with an identical `(promptId, label)` is a pure no-op; a decrement never goes
  below 0; `getImagePreferenceState()` round-trips what `addImagePreference()` just wrote
  and returns `null` for an image that's never been labeled; `recomputePromptTerms()`
  corrects an artificially-inflated count to match the real labeled set, reflects
  multiple images sharing a prompt, ignores rows with no `prompt_id`, and is idempotent.
- `server.taste-filter-routes.test.js`: `POST /api/taste-filter/label` called twice for
  the same `image_path` with opposite labels (same `prompt_id`) results in the term's
  `kept_count`/`discarded_count` reflecting only the current label, not both; an
  auto-decided candidate from `POST /api/taste-filter/import` now shows up in
  `prompt_terms` the same as a manual label would.
