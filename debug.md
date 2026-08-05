# Debug log — Silent error audit (2026-08-05)

Review scope: full-repo audit for "silent errors" — code that fails quietly now
but will produce hard-to-debug symptoms later (swallowed exceptions, unsurfaced
async failures, stub logic masquerading as working code).

Before logging new findings, the previous entry (product_sizes DB migration
review, 2026-08-04) was re-verified against the current `main` branch. All 5 of
those fixes are still present and correct:

- `PATCH /api/jobs/:id/listings/:listingId` — still wrapped in `db.transaction()`.
- `/api/setup-status` `hasProductSize` — still requires non-empty `dimensions`
  AND `mockup_template_path`, not just `COUNT(*) > 0`.
- `getProductSizes()` — still has `isValidProductSizeRow()`, skips invalid rows
  with `console.warn` instead of throwing.
- `claude.js` — `generateImage` stub confirmed removed, with a comment
  explaining `llm/index.js` hardcodes image gen to `gemini.js`.
- `getPipelineConfig()` — still cached via `pipelineConfigCache`, invalidated on
  writes, still returns a shallow copy per call.

Superseding that entry with this one since it's fully absorbed above.

Sequenced in priority order (most dangerous silence first).

## Issue 1 — OPEN — `backend/lib/llm/queue.js:77` (`withRequestSlot`)

**Problem:**
```javascript
export function withRequestSlot(keyIndex, fn) {
  const previousTail = perKeyTail.get(keyIndex) || Promise.resolve();
  const runPromise = previousTail.then(
    () => runSpacedAndBounded(keyIndex, fn),
    () => runSpacedAndBounded(keyIndex, fn)
  );
  perKeyTail.set(keyIndex, runPromise.catch(() => {}));
  return runPromise;
}
```
`runPromise.catch(() => {})` swallows the rejection used purely for tail
sequencing, but there's no logging anywhere in that path. A key that's
persistently failing (bad auth, sustained 429s) produces no signal — the queue
just keeps dispatching against it forever, one silent failure at a time.

**Proposed fix:** keep the swallow (it needs to stay non-throwing so the chain
never stalls) but add visibility: `runPromise.catch((err) => { console.warn(\`withRequestSlot: request on key ${keyIndex} failed:\`, err.message); })`.
Consider also tracking a per-key consecutive-failure counter so a persistently
broken key can be surfaced to `/api/setup-status` or the rate-limits panel
instead of only living in server logs.

## Issue 2 — OPEN — `frontend/src/App.jsx` (empty `.catch(() => {})` on fetch calls)

**Problem:** Every background fetch swallows its error with no UI feedback:
`refreshJobs()` (126), `refreshSetupStatus()` (134), `refreshTrends()` (142),
`refreshTags()` (150), `refreshWatchStatus()` (158), `refreshRateLimits()` (166),
`refreshApiKeys()` (174), `refreshPipelineConfig()` (185), the initial
`useEffect` fetches for `/api/config/pipeline`, `/api/config/shop-conventions`,
`/api/settings` (200–203), and `runJobsBatch()` (237). If the backend is down or
a query 500s, the dashboard just stops updating with no indication anything is
wrong — it can look "stuck" indefinitely.

**Proposed fix:** introduce one shared error-state setter (e.g. a small
`useFetchError()` hook or a top-level `lastFetchError` state) and replace each
`.catch(() => {})` with `.catch((err) => setLastFetchError({ source: 'refreshJobs', err }))`,
then render a lightweight banner/toast when it's set. `refreshJobs`,
`refreshTrends`, and `runJobsBatch` should be prioritized first since they gate
whether the user believes a run actually happened.

## Issue 3 — PARTIALLY MITIGATED — `backend/lib/mockup-generator.js:174-180` (`outpaintArtwork` temp-file cleanup)

**Current state (already better than initially assumed):**
```javascript
} finally {
  fs.promises.rm(tempPath, { force: true }).catch((err) => {
    console.warn(`outpaintArtwork: failed to clean up temp file ${tempPath}:`, err.message);
  });
}
```
This already logs via `console.warn` rather than swallowing silently — correcting
the earlier read of this line. It's still a *soft* silent failure though: a
`console.warn` with no dashboard/metric surface means repeated cleanup failures
(permissions, locked files) only show up as an eventual, unrelated-looking
"no space left on device" error, well after the actual cause.

**Proposed fix:** track a cumulative cleanup-failure counter (module-level or in
the jobs table) and surface it on `/api/setup-status` or a health endpoint once
it crosses a small threshold, so disk pressure is visible before it becomes an
outage.

## Issue 4 — OPEN — Stub logic presented as configured functionality

**a. `backend/lib/llm/claude.js:16`**
```javascript
export async function generateText(prompt, _options = {}) {
  if (!getClaudeKey()) {
    throw new Error('Claude fallback is not configured. Add a Claude key from the dashboard Settings panel.');
  }
  // TODO: call Claude's messages API.
  return { text: `[stub] Claude text response for: ${prompt}`, provider: 'claude' };
}
```
**b. `backend/lib/trends/etsy-api.js:6-11`**
```javascript
// TODO: implement the actual GET /listings/active call + frequency tally.
export async function getTrends(_category) {
```
Both modules pass their "is configured" checks (a Claude key is present; the
Etsy provider is selected) and return successfully, but produce fabricated or
empty output. Nothing throws, so a user relying on Claude as a fallback
provider or Etsy trend data has no way to know it's a stub short of reading
source.

**Proposed fix:** at minimum, tag stub responses so callers/logs can tell —
e.g. `{ text: ..., provider: 'claude', stub: true }` — and have
`/api/setup-status` (or wherever provider health is reported) flag `stub: true`
responses distinctly from real ones, rather than only distinguishing
configured/not-configured.
