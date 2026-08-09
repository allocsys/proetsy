# Fix scope: `prompt_terms.kept_count`/`discarded_count` double-counting on relabel

**Status:** implemented and tested.
**Tracked as a follow-up from:** `docs/fixes/taste-filter-duplicate-labels.md` ("Explicitly out of scope" section).

## Bug

`tallyPromptTermsForLabel()` (`backend/lib/taste-filter/store.js`) was purely additive —
every call to `POST /api/taste-filter/label` bumped whichever column (`kept_count` or
`discarded_count`) matched the label being applied, by `+1`, with no memory of any prior
label for that image.

`image_preferences` upserts on `image_path` (one row per image — see
`taste-filter-duplicate-labels.md`), so relabeling the same image is a normal, expected
flow: correcting an auto-sorted candidate, or fixing a manual mis-click. But
`tallyPromptTermsForLabel()` only ever added — it never decremented the *old* label's
contribution. Net effect: a term's `kept_count`/`discarded_count` drifted further out of
sync with the actual current set of labeled images the more relabeling happened, since
every correction left a phantom `+1` behind on the label it moved away from. Module 4's
`getStyleHints()` (`backend/lib/prompt-helper/index.js`) reads `WHERE kept_count >
discarded_count` to surface style-hint terms, so this drift could bias which terms
Module 4 suggests.

## Root cause location

- `backend/lib/taste-filter/store.js` — `tallyPromptTermsForLabel(promptId, label)`: an
  unconditional `+1` upsert, no lookup of the image's previous label/prompt.

## Fix

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

## Follow-ups (issue #59) — now fixed in this same branch/PR

Both items originally called out below as out of scope are fixed here too, rather than
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

## Test plan

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
