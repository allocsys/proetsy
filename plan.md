# Plan: Style/Category-Aware Tag Matching

## Problem

Titles and descriptions are already generated per-artwork from that artwork's own
`image_analysis` (Module 1), so there's no style bleed there. Tags are a different story.

`getTagCandidates()` in `backend/lib/tags/user-list.js` currently does:

```js
export function getTagCandidates(imageAnalysis = {}) {
  const allTags = db.prepare('SELECT * FROM tags').all();
  const haystack = JSON.stringify(imageAnalysis).toLowerCase();
  return allTags.filter((tag) => haystack.includes(tag.tag_text.toLowerCase()));
}
```

This treats the whole tag library as one flat pool and keeps any tag whose text happens
to substring-match somewhere in the artwork's analysis JSON blob. It ignores the `category`
column that already exists on the `tags` table, so a tag imported under "boho" can get
suggested for a botanical piece just because the word "boho" shows up somewhere in that
artwork's `themes` or `notable_elements`.

Root cause is really two problems, not one:
1. **Matching logic doesn't use category at all**, even when a tag has one.
2. **Categories are barely populated today** — the CSV import path supports a `category`
   column, but the manual paste-into-textarea flow in the Tag Library UI never sends one,
   so most tags in practice have `category = NULL`.

## Goal

Tag candidates fed into the Module 2 (Listing Generator) prompt should be weighted/filtered
toward the artwork's actual detected style, not just whatever substring happens to match.
This should degrade gracefully for tags that have no category (most of the existing library
today), rather than breaking or hiding those tags entirely.

## Relevant fields already available

`image_analysis` (Module 1 output) already contains style signal we aren't using for tags:

```json
{
  "subject": "...",
  "style": "watercolor",
  "palette": ["..."],
  "mood": "...",
  "themes": ["..."],
  "notable_elements": ["..."],
  "suggested_categories": ["botanical", "nursery decor"]
}
```

`suggested_categories` and `style` are the natural join keys against `tags.category`.

## Proposed changes

### 1. Score, don't just filter (`backend/lib/tags/user-list.js`)

Replace the boolean substring filter with a scored ranking:

- **Category match (strong signal):** if `tag.category` is non-null and matches
  (case-insensitive) any entry in `imageAnalysis.suggested_categories`, or equals
  `imageAnalysis.style`, score it high.
- **Substring match (existing signal, kept as fallback):** if the tag text appears in the
  full analysis JSON blob (current behavior), keep a lower base score so uncategorized tags
  (the majority today) still surface instead of disappearing.
- **Category mismatch (negative signal):** if `tag.category` is non-null and does *not*
  match the artwork's style/suggested_categories, deprioritize it even if the substring
  match fires — this is the actual bug case (e.g. "boho" tag with `category: 'boho'`
  matching a botanical piece just because the word appears in `themes`).
- Return candidates sorted by score, not an unordered filter result, so the LLM prompt lists
  the most relevant tags first (useful since the prompt caps how many it shows/uses).

This keeps the function's signature and behavior backward compatible for tags with
`category = NULL` (the common case right now), while fixing the miscategorization bug for
any tag that does have a category set.

### 2. Make category actually populated (`frontend/src/App.jsx`, `backend/server.js`)

Right now the paste-a-list flow in Tag Library settings never sends a category, so this fix
has limited effect until the library actually has categories on it. Add:

- A category dropdown/input next to the tag paste textarea (reuse
  `suggested_categories`-style values, e.g. sourced from existing distinct `tags.category`
  values plus free text) so `POST /api/tags/bulk` receives a real `category` instead of
  relying on `null`.
- Optionally, a one-time "Suggest categories for uncategorized tags" admin action that runs
  existing tags' text against a small set of known category keywords, for backfilling the
  current library without forcing a full manual re-tag. This is a nice-to-have, not required
  for the core fix.

### 3. No change needed to `getTagCandidates()` call site — ✅ confirmed

`backend/lib/listing-generator/index.js` and `prompt.js` don't need changes — they already
just take whatever `getTagCandidates()` returns and pass tag text into the prompt. Only the
ordering/scoring inside `user-list.js` changes.

Confirmed by reading both files: `index.js` passes `getTagCandidates()`'s return value
straight through to `buildListingPrompt()` as `tagCandidates` with no inspection of order or
shape beyond array-ness, and `prompt.js` only reads `t.tag_text` per candidate and
`tagCandidates.length` for the empty-state message. No edits made here.

## Testing

- Update `backend/lib/tags/user-list.test.js` — ✅ done:
  - Existing substring-match tests should still pass unchanged (uncategorized tags).
  - New test: a tag with a category matching `suggested_categories` outranks a tag with a
    mismatched category, even when both substring-match the analysis blob.
  - New test: a tag with no category behaves exactly as today (pure substring match, no
    score penalty).
- No changes expected to `backend/lib/tags/index.test.js` (provider wrapper) unless the
  return shape changes (e.g. adding a `score` field) — confirm and update if so. ✅
  Confirmed: that test mocks `user-list.js`'s `getTagCandidates` directly and only checks
  pass-through delegation, so it doesn't assert anything about tag shape or ordering. No
  update needed.
- Add a fixture in `backend/lib/llm/fixture.test.js` / listing-generator idempotency tests
  covering a mixed-category tag library to guard against regressing this fix later. — ✅
  done, in `index.idempotency.test.js` rather than `fixture.test.js`: the fixture LLM
  provider's output doesn't depend on tag content (it returns fixed variations regardless
  of what's in the prompt), so a fixture.test.js test wouldn't actually exercise
  `getTagCandidates()` scoring at all. Added
  `generateListingsForJob tag candidate ordering (mixed-category regression guard)` to
  `index.idempotency.test.js` instead: seeds the real `tags` table with a
  category-corroborated, an uncategorized, and a category-conflicting tag, runs the real
  Module 2 pipeline, and asserts the category-corroborated tag appears before the
  uncategorized tag before the conflicting one in the actual prompt string sent to the LLM
  provider — confirming the scoring order in `user-list.js` survives all the way through
  `listing-generator/index.js` and `prompt.js` into what the model actually sees. Full
  backend suite (45 files / 424 tests) passes with this added.

## Rollout

1. Land the scoring change in `user-list.js` alone first (safe — no schema/API changes,
   pure ranking logic, degrades to current behavior for uncategorized tags).
2. Land the Tag Library UI category input as a separate follow-up PR.
3. Consider the backfill/auto-suggest admin action last, once real usage data shows how much
   of the existing library actually needs categorizing.

## Out of scope

- Changing the `tags` table schema (the `category TEXT` column already exists and is
  sufficient).
- Any change to per-artwork title/description generation — that path is already correctly
  isolated per artwork and not part of this bug.
