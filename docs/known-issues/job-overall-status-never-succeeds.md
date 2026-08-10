# `jobs.overall_status` Never Reaches a Terminal Success State

**Repo:** allocsys/proetsy
**Found:** functional correctness review, 2026-08-11
**Severity:** High — affects every job, every run
**Status:** Open, not yet fixed

## Summary
A job's `overall_status` column is only ever written as `'pending'`, `'running'`, or
`'failed'` anywhere in the codebase. There is no code path that sets it to a terminal
success value (`'success'`, `'completed'`, `'done'`, etc.) once every module has
finished. A job that completes its entire pipeline successfully is left permanently
at `overall_status = 'running'` — indistinguishable, from the DB's point of view, from
a job that is still mid-flight.

## Where it happens
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

## Impact
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

## Suggested fix
After a module transitions to `success`, check whether every *pending-eligible*
module for that job (i.e. not `skipped`) is now in a terminal state (`success` or
`failed`, with no required module `failed`), and if so, set
`overall_status = 'success'`. This check belongs in `setModuleStatus()` itself (or a
small helper it calls) so every caller — the individual `/run/*` routes and
`pipeline-runner.js` — gets it for free rather than needing to duplicate the logic.

## How this was found
Manual review of `backend/lib/jobs.js`, `backend/lib/pipeline-runner.js`, and
`backend/server.js`, cross-checked with a repo-wide search for every
`overall_status` assignment, after an initial automated pass (12-step delegated
agent review) reported no functional bugs and was found to be too shallow on
follow-up.
