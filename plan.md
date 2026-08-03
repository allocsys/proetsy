# Plan: Merge Upload & Taste Filter, and Auto-Compute Taste Threshold

Status: Part 1 (Steps 1.1-1.7) implemented. Part 2 not yet implemented.
Source branch for current behavior: `redesign/v2-overhaul`.

Steps within each part are meant to be done **in order** — each one should
leave the app in a working, testable state before moving to the next.

---

## Part 1 — Merge "Upload & Config" and "Taste Filter" into one page

### Why

Today these are two separate nav views backed by two separate storage
directories:

- **Upload & Config** (`frontend/src/App.jsx`) — dropzone posts to
  `POST /api/artworks/upload`, files land in `UPLOADS_DIR`
  (`backend/data/uploads`), and immediately becomes an `artworks` row that a
  job can be created against.
- **Taste Filter** (`frontend/src/TasteFilter.jsx`) — dropzone posts to
  `POST /api/taste-filter/import`, files land in `CANDIDATES_DIR`
  (`backend/data/taste-filter`), get embedded + scored against taste
  centroids, and are labeled keep/discard by the user. Nothing here ever
  becomes an `artworks` row automatically — per the existing code comment in
  `backend/server.js`, a kept candidate is "not an artwork until/unless it's
  later dragged into Upload Artwork," which today means manually re-uploading
  the same file from disk a second time.

The merge target is not "delete one of these" — both flows solve different
problems (pre-pipeline curation vs. pipeline entry). The merge closes the gap
between them so a kept candidate can flow straight into the pipeline without
a manual re-upload.

### Step 1.1 — Backend: shared artwork-insert helper ✅ done

Before anything else, factor the artwork-insert logic that currently lives
inline in the `POST /api/artworks/upload` handler in `backend/server.js`
into a small shared helper, `insertArtworkRecord(filePath, originalFilename)`.
Update `/api/artworks/upload` to call it. No request/response shape changes
for this route. This is pure refactor — land it and confirm existing upload
tests still pass before touching anything else.

### Step 1.2 — Backend: promote-candidate route ✅ done

New route in `backend/server.js`, adjacent to the existing Module 7 routes:

```
POST /api/taste-filter/promote
Body: { image_path: string, original_filename?: string }
```

Behavior:
1. Validates `image_path` is inside `CANDIDATES_DIR` (reject otherwise).
2. Copies the file into `UPLOADS_DIR` (same naming scheme as
   `uploadStorage.filename` in the existing multer config — timestamp +
   random + sanitized original name).
3. Calls `insertArtworkRecord` from Step 1.1 to create the `artworks` row.
4. Returns `{ artwork }` in the same shape `POST /api/artworks/upload`
   returns per-file (`{ ...row, file_url: '/artwork-files/...' }`).

### Step 1.3 — Backend: promote-route tests ✅ done

New backend test for `POST /api/taste-filter/promote`: candidate file
copied into `UPLOADS_DIR`, `artworks` row created, 400 on a path outside
`CANDIDATES_DIR`. Land and confirm green before touching the frontend —
Steps 1.4+ depend on this route existing and behaving correctly.

### Step 1.4 — Frontend: "Keep & send to pipeline" button ✅ done

In `TasteFilter.jsx`, add a second action button alongside the existing
Keep/Discard pair on each candidate card:

- **Keep** — unchanged. Records the label (training signal), removes the
  card. This must keep working exactly as today even after this change.
- **Discard** — unchanged.
- **Keep & send to pipeline** (new) — does everything Keep does, then:
  1. `POST /api/taste-filter/promote` with the candidate's `image_path`
     (the route landed in Step 1.2).
  2. `POST /api/jobs` with the returned `artwork.id` and the current
     pipeline `overrides` (the same overrides state `App.jsx` already
     tracks for the direct-upload dropzone — passed down to `TasteFilter`
     as a prop, or the promotion call is lifted into `App.jsx` and passed
     down as a callback prop, e.g. `onPromoteToPipeline(candidate)`).
  3. Calls the existing `refreshJobs()` so the new job shows up in
     Listing History immediately.

This keeps "Keep" as a pure training-signal action (no behavior change) and
makes pipeline-promotion an explicit, separate opt-in per image — nothing
enters the pipeline as a side effect of curation alone.

### Step 1.5 — Frontend: button tests ✅ done

`frontend/src/TasteFilter.test.jsx` — add coverage for the new "Keep &
send to pipeline" button: asserts `/taste-filter/label`,
`/taste-filter/promote`, and `/api/jobs` are all called, in that order,
and the card is removed from the grid afterward. Land and confirm green
before the nav/layout merge in Step 1.6 — that way any regression found
next is isolated to the nav change, not the new button logic.

### Step 1.6 — Frontend: merge the nav views ✅ done (commit 2a734f9)

- Collapse the two `NAV_ITEMS` entries (`pipeline`, `taste-filter`) into one:
  `{ id: 'upload', label: 'Upload', group: 'Pipeline' }`.
- Update `activeView` state, the sidebar nav, and `.mobile-nav-strip`
  rendering to match — same pattern already used for `settings`/`history`/
  `review`.
- The merged `'upload'` view renders two lanes in one `paper-card` section:
  - **Curation lane** — the existing `<TasteFilter />` component (already
    carrying the Step 1.4 button, unchanged internally beyond that).
  - **Pipeline lane** — the existing pipeline-module toggle checkboxes +
    direct dropzone (`handleFiles`/`onDrop`), unchanged.
- No change to `JobArtworkAnalysisReview.jsx`, `JobListingReview.jsx`,
  `JobMockupReview.jsx`, `PromptHelper.jsx`, or the `history`/`review`/
  `settings` views.

### Step 1.7 — Frontend: nav tests ✅ done (commit 8bc38df)

`frontend/src/App.test.jsx` — update nav-click assertions for the merged
`'upload'` view id/label.

### Step 1.8 — Explicitly out of scope for this part

- No change to the watched-folder auto-import mechanism
  (`backend/lib/taste-filter/watcher.js`) or its polling.
- No change to centroid scoring/recompute logic.
- No change to `/api/artworks/upload` behavior for users who skip curation
  entirely.

---

## Part 2 — Auto-compute taste threshold

### Why

`backend/lib/taste-filter/scoring.js` already computes a confidence flag
(`isConfident`, gated on `COLD_START_MIN_EXAMPLES = 30` labeled examples per
centroid pair) and a raw score, but today both are purely advisory — every
candidate requires a manual Keep/Discard click regardless of how confident
or extreme the score is. This adds an opt-in mode where sufficiently
confident, sufficiently extreme scores get auto-sorted, while everything
else still requires manual review.

Existing design constraint to preserve: per the current code comment in
`scoring.js`, "Nothing is auto-deleted... this is advisory only, the user
always confirms." Auto-compute must not silently delete or silently
mislabel files with zero human-visible trace — see Step 2.5.

### Step 2.1 — Schema: `auto_labeled` column ✅ done (commits 3b99ae5, 46a57fc)

`backend/db/schema.sql` — add `auto_labeled INTEGER DEFAULT 0` to
`image_preferences`. Land this migration first, on its own, so every
later step in this part can rely on the column existing.

### Step 2.2 — Backend: `addImagePreference` flag ✅ done

`backend/lib/taste-filter/store.js` — `addImagePreference` accepts an
optional `autoLabeled` flag, defaulting to `false` (no change to existing
callers' behavior). Small, isolated change — confirm existing store tests
still pass before wiring anything into it.

### Step 2.3 — New setting keys ✅ done

Added to the existing `settings` key/value table (same pattern as
`taste_filter_watch_*`):

| key | type | default | meaning |
|---|---|---|---|
| `taste_filter_auto_enabled` | `'true' \| 'false'` | `'false'` | master on/off |
| `taste_filter_auto_threshold` | numeric string | `'0.3'` | absolute score cutoff |

Backend only for this step: make sure the settings table accepts and
returns these keys (default `false`/`'0.3'` when unset). Settings UI comes
later, in Step 2.8.

### Step 2.4 — Backend: decision rule in the scoring path ✅ done

Applied per-candidate, per-centroid-pair (global and category scored
independently, same as today), only when `taste_filter_auto_enabled` is on:

```
if not isConfident(counts):              -> manual review (cold start, unchanged)
elif score >  auto_threshold:             -> auto-keep
elif score < -auto_threshold:             -> auto-discard
else:                                      -> manual review (uncertain band)
```

`isConfident` and `COLD_START_MIN_EXAMPLES` are unchanged — auto-compute
only ever acts on centroid pairs that already clear the existing cold-start
bar. Implement this rule as a small, independently testable function in
`scoring.js` before wiring it into the `/import` route in Step 2.5.

### Step 2.5 — Backend: decision-rule unit tests ✅ done

`backend/lib/taste-filter/scoring.test.js` (or equivalent) — unit tests
for the Step 2.4 decision rule at the threshold boundary and just inside
the cold-start gate. Land and confirm green before touching the route.

### Step 2.6 — Backend: wire the rule into `/api/taste-filter/import` ✅ done

`POST /api/taste-filter/import` — after scoring each candidate, if
`taste_filter_auto_enabled` is on, apply the Step 2.4 rule server-side and
include the outcome in the response: each candidate gets an added
`autoDecision: 'keep' | 'discard' | null` field. `null` means "needs
manual review," same set of candidates the UI shows today when auto mode
is off. For each auto-decided candidate:

- Insert an `image_preferences` row via `addImagePreference` (Step 2.2),
  with `autoLabeled: true`.
- Trigger `recomputeCentroids()`, same as a manual label.
- Never delete the underlying file, in either the auto-discard or
  manual-discard case — unchanged from current behavior.

No change to `POST /api/taste-filter/label` — manual correction of an
auto-sorted candidate goes through the same route it already does.

### Step 2.7 — Backend: route-level test ✅ done

Backend route test — `taste_filter_auto_enabled=true` with a seeded
confident centroid pair produces `autoDecision` on extreme-score
candidates and `null` on mid-range ones; `auto_labeled=1` row exists for
the former. Land and confirm green before starting frontend work —
Steps 2.8+ assume this response shape is stable.

### Step 2.8 — Frontend: Settings view fields

Settings view (`App.jsx`) — add the two Step 2.3 fields next to the
existing "Auto-import from folder" section, same checkbox + input pattern.

### Step 2.9 — Frontend: collapsed "Auto-sorted" section

`TasteFilter.jsx`: candidates with `autoDecision !== null` render into a
separate, collapsed "Auto-sorted (12)" section instead of the main grid —
visible, one-click expandable, each card still showing its
Keep/Discard/Keep & send to pipeline actions (from Part 1, Step 1.4) so a
wrong auto-decision can be corrected same as any other card. Correcting
one re-labels it and clears `auto_labeled`. Everything else in
`TasteFilter.jsx` is unchanged.

### Step 2.10 — Frontend: tests

`TasteFilter.test.jsx` — auto-sorted candidates render in the collapsed
section, not the main grid; correcting one calls the same
`/taste-filter/label` path as a manual card.

### Step 2.11 — Explicitly out of scope for this part

- No change to `COLD_START_MIN_EXAMPLES` or the cold-start gate itself.
- No automatic file deletion under any threshold setting.
- No change to the watched-folder auto-import route's own behavior beyond
  it also passing through the same `/import` scoring path (it already does
  today).
