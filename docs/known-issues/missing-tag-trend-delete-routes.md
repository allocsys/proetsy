# Frontend Calls DELETE Routes for Tags/Trends That Don't Exist on the Backend

**Repo:** allocsys/proetsy
**Found:** functional correctness review, 2026-08-11
**Severity:** High — user-facing feature is silently broken
**Status:** Open, not yet fixed

## Summary
The Settings panel's "Delete tag" and "Delete trend" buttons call backend routes
that were never implemented. Both requests 404, but the frontend doesn't check the
response status before refreshing its local list, so the confirmation modal closes
as if the deletion succeeded and the (still-undeleted) row simply reappears on
refresh — there is no visible error at all.

## Where it happens
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

## Impact
Clicking "Delete tag" or "Delete trend" in Settings → Tags & Trends:
1. Shows the confirmation modal ("Delete tag \"X\"? This can't be undone.")
2. On confirm, fires a DELETE request that 404s
3. `refreshTags()`/`refreshTrends()` runs unconditionally regardless of the response,
   re-fetching the *unchanged* list
4. The modal closes and the tag/trend is still there — no error message, no
   indication anything went wrong

Users have no way to remove a tag or trend from the dashboard at all, and nothing in
the UI tells them why.

## Suggested fix
- Add `app.delete('/api/tags/:id', ...)` and `app.delete('/api/trends/:id', ...)`
  routes to `backend/server.js`, following the existing pattern used by
  `DELETE /api/settings/api-keys/:id` and `DELETE /api/mockup-templates/:sizeKey`
  (404 with `{ error: ... }` if the row doesn't exist, `204` on success).
- Separately, harden `deleteTag`/`deleteTrend` in `App.jsx` to check `res.ok` and
  surface an error message (matching the pattern already used by `saveTags`,
  `importTagsCsv`, etc.) instead of silently refreshing either way — this would have
  surfaced the missing routes immediately instead of failing silently.

## How this was found
Manual review of `backend/server.js`'s full route list cross-checked against every
`fetch(...)` call in `frontend/src/App.jsx`, after an initial automated pass
(12-step delegated agent review) reported no functional bugs and was found to be
too shallow on follow-up.
