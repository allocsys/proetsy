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
3. **`tallyPromptTermsForLabel()`** now takes an optional `previous` argument. When given
   and it differs from the `(promptId, label)` being applied — a real relabel, not a
   redundant re-submit of the same state — it first undoes the previous state's
   contribution (`-1`, via a new `adjustPromptTermCounts()` helper, clamped at 0 with
   `MAX(column - 1, 0)` so a term can never go negative) before tallying the new one
   (`+1`). No `previous`, or an identical `previous`, behaves exactly as the
   original increment-only version did.

The clamp-at-0 matters for rows written before this fix shipped: an old relabel's
increment was never reversed, so decrementing today's relabel against that
already-inflated count must not push it negative.

## Explicitly out of scope for this fix

- **Auto-decided labels never tally at all.** `POST /api/taste-filter/import`'s
  auto-compute decision path calls `addImagePreference()` directly and never calls
  `tallyPromptTermsForLabel()` — an auto-applied keep/discard currently contributes
  nothing to `prompt_terms`, whether it's a first decision or later manually corrected via
  `POST /api/taste-filter/label` (which *would* tally, per this fix, but only sees its own
  call — an auto-decision's "previous" state exists in `image_preferences` but was never
  reflected in `prompt_terms` to begin with, so there's nothing consistent to undo).
  Deciding whether/how auto-decided labels should feed this link is a separate,
  product-level question, not addressed here.
- **Backfilling historical drift.** Rows already inflated by the pre-fix bug are not
  corrected retroactively — this fix only prevents *new* drift going forward.

## Test plan

- `store.test.js`: relabeling the same prompt from `keep` to `discard` moves the term's
  count from one column to the other rather than leaving both incremented; a redundant
  re-label with an identical `(promptId, label)` is a pure no-op; a decrement never goes
  below 0; `getImagePreferenceState()` round-trips what `addImagePreference()` just wrote
  and returns `null` for an image that's never been labeled.
- `server.taste-filter-routes.test.js`: `POST /api/taste-filter/label` called twice for
  the same `image_path` with opposite labels (same `prompt_id`) results in the term's
  `kept_count`/`discarded_count` reflecting only the current label, not both.
