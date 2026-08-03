# Plan: Merge Upload & Taste Filter, and Auto-Compute Taste Threshold

Status: proposed, not yet implemented.
Source branch for current behavior: `redesign/v2-overhaul`.

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

### 1.1 UI changes (`frontend/src/App.jsx`, `frontend/src/TasteFilter.jsx`)

- Collapse the two `NAV_ITEMS` entries (`pipeline`, `taste-filter`) into one:
  `{ id: 'upload', label: 'Upload', group: 'Pipeline' }`.
- Update `activeView` state, the sidebar nav, and `.mobile-nav-strip`
  rendering to match — same pattern already used for `settings`/`history`/
  `review`.
- The merged `'upload'` view renders two lanes in one `paper-card` section:
  - **Curation lane** — the existing `<TasteFilter />` component
    (unchanged internally except for the addition below).
  - **Pipeline lane** — the existing pipeline-module toggle checkboxes +
    direct dropzone (`handleFiles`/`onDrop`), unchanged.
- No change to `JobArtworkAnalysisReview.jsx`, `JobListingReview.jsx`,
  `JobMockupReview.jsx`, `PromptHelper.jsx`, or the `history`/`review`/
  `settings` views.

### 1.2 Backend: promote-candidate bridge

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
3. Inserts an `artworks` row exactly like `POST /api/artworks/upload` does
   today (`INSERT INTO artworks (file_path, original_filename) VALUES (?, ?)`).
4. Returns `{ artwork }` in the same shape `POST /api/artworks/upload`
   returns per-file (`{ ...row, file_url: '/artwork-files/...' }`).

Implementation note: factor the artwork-insert logic (currently inline in
the `/api/artworks/upload` handler) into a small shared helper,
`insertArtworkRecord(filePath, originalFilename)`, called from both routes.
No existing route's request/response shape changes.

### 1.3 Frontend: "Keep & send to pipeline"

In `TasteFilter.jsx`, add a second action button alongside the existing
Keep/Discard pair on each candidate card:

- **Keep** — unchanged. Records the label (training signal), removes the
  card. This must keep working exactly as today even after this change.
- **Discard** — unchanged.
- **Keep & send to pipeline** (new) — does everything Keep does, then:
  1. `POST /api/taste-filter/promote` with the candidate's `image_path`.
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

### 1.4 Tests

- `frontend/src/App.test.jsx` — update nav-click assertions for the merged
  `'upload'` view id/label.
- `frontend/src/TasteFilter.test.jsx` — add coverage for the new "Keep &
  send to pipeline" button: asserts `/taste-filter/label`,
  `/taste-filter/promote`, and `/api/jobs` are all called, in that order,
  and the card is removed from the grid afterward.
- New backend test for `POST /api/taste-filter/promote`: candidate file
  copied into `UPLOADS_DIR`, `artworks` row created, 400 on a path outside
  `CANDIDATES_DIR`.

### 1.5 Explicitly out of scope for this change

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
mislabel files with zero human-visible trace — see 2.3.

### 2.1 New setting

Added to the existing `settings` key/value table (same pattern as
`taste_filter_watch_*`):

| key | type | default | meaning |
|---|---|---|---|
| `taste_filter_auto_enabled` | `'true' \| 'false'` | `'false'` | master on/off |
| `taste_filter_auto_threshold` | numeric string | `'0.3'` | absolute score cutoff |

Surfaced in the Settings view (`App.jsx`) next to the existing "Auto-import
from folder" section, same checkbox + input pattern.

### 2.2 Decision rule

Applied per-candidate, per-centroid-pair (global and category scored
independently, same as today), only when auto mode is enabled:

```
if not isConfident(counts):              -> manual review (cold start, unchanged)
elif score >  auto_threshold:             -> auto-keep
elif score < -auto_threshold:             -> auto-discard
else:                                      -> manual review (uncertain band)
```

`isConfident` and `COLD_START_MIN_EXAMPLES` are unchanged — auto-compute
only ever acts on centroid pairs that already clear the existing cold-start
bar.

### 2.3 What "auto" actually does

Auto-decided candidates are **not** silently applied with no trace:

- They still get an `image_preferences` row inserted (same
  `addImagePreference` call an explicit click would trigger), with a new
  `auto_labeled` column (boolean, default `false`) set to `true` for these
  rows only, so training history can distinguish "user clicked" from
  "auto-sorted" after the fact.
- They still trigger `recomputeCentroids()`, same as a manual label.
- They do **not** disappear from the UI. `TasteFilter.jsx` renders them in a
  separate, collapsed "Auto-sorted (12)" section — visible, one-click
  expandable, each card still showing its Keep/Discard/Keep & send to
  pipeline actions so a wrong auto-decision can be corrected same as any
  other card. Correcting one re-labels it and clears `auto_labeled`.
- Files are never deleted in either the auto-discard or manual-discard
  case — unchanged from current behavior.

### 2.4 Backend changes

- `backend/db/schema.sql` — add `auto_labeled INTEGER DEFAULT 0` to
  `image_preferences`.
- `backend/lib/taste-filter/store.js` — `addImagePreference` accepts an
  optional `autoLabeled` flag, defaulting to `false` (no change to existing
  callers).
- `POST /api/taste-filter/import` — after scoring each candidate, if
  `taste_filter_auto_enabled` is on, apply the rule in 2.2 server-side and
  include the outcome in the response: each candidate gets an added
  `autoDecision: 'keep' | 'discard' | null` field. `null` means "needs
  manual review," same set of candidates the UI shows today when auto mode
  is off.
- No change to `POST /api/taste-filter/label` — manual correction of an
  auto-sorted candidate goes through the same route it already does.

### 2.5 Frontend changes

- `TasteFilter.jsx`: candidates with `autoDecision !== null` render into the
  collapsed "Auto-sorted" section instead of the main grid; everything else
  is unchanged.
- Settings view: the two new fields from 2.1.

### 2.6 Tests

- `backend/lib/taste-filter/scoring.test.js` (or equivalent) — unit tests
  for the 2.2 decision rule at the threshold boundary and just inside the
  cold-start gate.
- Backend route test — `taste_filter_auto_enabled=true` with a seeded
  confident centroid pair produces `autoDecision` on extreme-score
  candidates and `null` on mid-range ones; `auto_labeled=1` row exists for
  the former.
- `TasteFilter.test.jsx` — auto-sorted candidates render in the collapsed
  section, not the main grid; correcting one calls the same
  `/taste-filter/label` path as a manual card.

### 2.7 Explicitly out of scope for this change

- No change to `COLD_START_MIN_EXAMPLES` or the cold-start gate itself.
- No automatic file deletion under any threshold setting.
- No change to the watched-folder auto-import route's own behavior beyond
  it also passing through the same `/import` scoring path (it already does
  today).
