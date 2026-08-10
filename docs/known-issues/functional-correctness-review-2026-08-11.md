# Functional Correctness Review Findings

**Repo:** allocsys/proetsy
**Found:** functional correctness review, 2026-08-11
**Status:** Open, not yet fixed

An initial automated pass (12-step delegated agent review) reported no functional
bugs. Manual review of the core routes/modules found that verdict was too shallow —
the three issues below turned up on direct source inspection, cross-checked with
repo-wide searches.

---

## 1. `jobs.overall_status` never reaches a terminal success state
**Severity:** High — affects every job, every run

### Summary
A job's `overall_status` column is only ever written as `'pending'`, `'running'`, or
`'failed'` anywhere in the codebase. There is no code path that sets it to a terminal
success value (`'success'`, `'completed'`, `'done'`, etc.) once every module has
finished. A job that completes its entire pipeline successfully is left permanently
at `overall_status = 'running'` — indistinguishable, from the DB's point of view, from
a job that is still mid-flight.

### Where it happens
`backend/lib/jobs.js`, `setModuleStatus()`:

```js
if (status === 'failed' && required) {
  db.prepare("UPDATE jobs SET overall_status = 'failed' WHERE id = ?").run(jobId);
} else if (status === 'success') {
  db.prepare(
    "UPDATE jobs SET overall_status = CASE WHEN overall_status = 'failed' THEN overall_status ELSE 'running' END WHERE id = ?"
  ).run(jobId);
}
```

Every module success just re-asserts `'running'` (unless the job already failed). No
caller — not `pipeline-runner.js`, not any of the `/run/*` routes in `server.js` —
ever checks "are all modules now done?" and flips `overall_status` to a terminal
value. Confirmed via a full-repo search: `'pending'`, `'running'`, and `'failed'` are
the only three literal values ever assigned to `overall_status` anywhere in
`backend/`.

### Impact
`overall_status` is read throughout the frontend as the source of truth for "is this
job done":
- `frontend/src/App.jsx`'s `StatusBadge` in the Listing History table
- The sidebar's "Pipeline status" segmented bar and legend (`statusCounts`, derived
  from `jobs.reduce(... j.overall_status ...)`)
- Batch summaries in the grouped-jobs history view (`statusCountsForBatch`)

A fully finished job (all modules `success`) shows as `running` forever in every one
of these. Users have no way to tell "done" from "still processing" from the job list
or the sidebar without opening the job and checking each module's status
individually. Any future code that branches on `overall_status === 'success'` (e.g. a
future "only show completed jobs" filter) would never match anything.

### Suggested fix
After a module transitions to `success`, check whether every *pending-eligible*
module for that job (i.e. not `skipped`) is now in a terminal state (`success` or
`failed`, with no required module `failed`), and if so, set
`overall_status = 'success'`. This check belongs in `setModuleStatus()` itself (or a
small helper it calls) so every caller — the individual `/run/*` routes and
`pipeline-runner.js` — gets it for free rather than needing to duplicate the logic.

---

## 2. Frontend calls DELETE routes for tags/trends that don't exist on the backend
**Severity:** High — user-facing feature is silently broken

### Summary
The Settings panel's "Delete tag" and "Delete trend" buttons call backend routes
that were never implemented. Both requests 404, but the frontend doesn't check the
response status before refreshing its local list, so the confirmation modal closes
as if the deletion succeeded and the (still-undeleted) row simply reappears on
refresh — there is no visible error at all.

### Where it happens
`frontend/src/App.jsx`:

```js
async function deleteTag(id, tagText) {
  requestConfirm(`Delete tag "${tagText}"? This can't be undone.`, async () => {
    await fetch(`/api/tags/${id}`, { method: 'DELETE' });
    refreshTags();
  });
}

async function deleteTrend(id, term) {
  requestConfirm(`Delete trend "${term}"? This can't be undone.`, async () => {
    await fetch(`/api/trends/${id}`, { method: 'DELETE' });
    refreshTrends();
  });
}
```

`backend/server.js` has exactly one `app.delete(...)` route in the entire file:

```js
app.delete('/api/settings/api-keys/:id', (req, res) => { ... });
```

There is no `app.delete('/api/tags/:id', ...)` and no `app.delete('/api/trends/:id', ...)`.
Confirmed by a full-file search for `app.delete` — API keys is the only match.

### Impact
Clicking "Delete tag" or "Delete trend" in Settings → Tags & Trends:
1. Shows the confirmation modal ("Delete tag \"X\"? This can't be undone.")
2. On confirm, fires a DELETE request that 404s
3. `refreshTags()`/`refreshTrends()` runs unconditionally regardless of the response,
   re-fetching the *unchanged* list
4. The modal closes and the tag/trend is still there — no error message, no
   indication anything went wrong

Users have no way to remove a tag or trend from the dashboard at all, and nothing in
the UI tells them why.

### Suggested fix
- Add `app.delete('/api/tags/:id', ...)` and `app.delete('/api/trends/:id', ...)`
  routes to `backend/server.js`, following the existing pattern used by
  `DELETE /api/settings/api-keys/:id` and `DELETE /api/mockup-templates/:sizeKey`
  (404 with `{ error: ... }` if the row doesn't exist, `204` on success).
- Separately, harden `deleteTag`/`deleteTrend` in `App.jsx` to check `res.ok` and
  surface an error message (matching the pattern already used by `saveTags`,
  `importTagsCsv`, etc.) instead of silently refreshing either way — this would have
  surfaced the missing routes immediately instead of failing silently.

---

## 3. Pipeline runner attempts mockup composition for sizes with no template configured
**Severity:** Low — wasted work and noisy failures, not a correctness break

### Summary
`backend/lib/pipeline-runner.js`'s mockup-composer step defaults to attempting
*every* configured product size, instead of only the sizes that actually have a
mockup template configured. `backend/lib/listing-generator/index.js` already filters
for this correctly elsewhere in the same codebase, so the two modules are
inconsistent.

### Where it happens
`backend/lib/pipeline-runner.js`:

```js
const sizeKeys = options.sizeKeys ?? Object.keys(getProductSizes());
```

Compare with `backend/lib/listing-generator/index.js`:

```js
const availableSizes = Object.entries(productSizesConfig)
  .filter(([, size]) => Boolean(size.mockup_template))
  .map(([size_key, size]) => ({ size_key, ...size }));
```

### Impact
`composeMockup()` in `backend/lib/mockup-generator.js` throws a clear error for a
size with no `mockup_template` configured, and the per-size `try/catch` in
`pipeline-runner.js` handles that gracefully (it doesn't crash the job) — so this is
not a hard functional break. But every job with any untemplated product size
configured will:
- Attempt (and fail) mockup composition for that size on every run
- Produce a `perSize` failure entry with a "no mockup_template configured" error
  that a reviewer has to recognize as expected/ignorable rather than a real problem

### Suggested fix
Filter `Object.keys(getProductSizes())` down to sizes with a truthy
`mockup_template`, mirroring `listing-generator/index.js`'s `availableSizes` filter,
before using it as the default `sizeKeys` list in `pipeline-runner.js`.
