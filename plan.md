# Plan: Editable Settings & API Keys from Dashboard

## Status (2026-08-04)
Backend key-store plumbing and the pipeline-config read side are done. Still open: the
`/api/settings/api-keys` HTTP routes, wiring `migratePipelineConfigSeed()` into startup,
tests for the new key-store module, and all of the frontend work. See the checkboxes
below for exactly what's done vs. left in each step.

## Goal
Allow settings (currently split across the `settings` DB table and JSON files in
`backend/config/`) and API keys (currently `.env`-only) to be viewed and edited
directly from the dashboard, instead of requiring manual file/DB edits.

## Current State (for reference)
- **General settings**: SQLite `settings` table, served via `GET/PATCH /api/settings`.
- **JSON config files** (`backend/config/`):
  - `pipeline.config.json` — module enable/disable toggles
  - `product-sizes.json` — legacy seed, DB (`product_sizes` table) is now source of truth
  - `trends.json` — empty, DB-driven
  - `shop-conventions.js` — hardcoded, currently read-only in the UI
- **API keys**: `backend/.env` (`GEMINI_API_KEYS`, optional Claude key), pooled/rate-limited
  via the `llm_rate_limits` table. Not exposed to the UI at all today.
- **Dashboard**: "⚙ Settings" panel in `frontend/src/App.jsx` already edits tags, trends,
  price/delivery text, and the taste-filter watcher config. Shop-conventions and rate-limit
  status are shown but not editable.

## Decisions to Make First
1. **Where do API keys live going forward?**
   - Option A: Keep `.env` as source of truth; backend writes to the file on disk when
     updated via the UI (requires the node process to have write access, and a restart or
     hot-reload strategy to pick up new values).
   - Option B: Move API keys into a DB table (e.g. `api_keys`), read at runtime instead of
     `process.env`. Cleaner for multi-key pooling and rate-limit tracking, avoids file I/O,
     but is a bigger refactor of the provider layer.
   - **Recommendation**: Option B — keys are already pooled/rate-limited via a DB table
     (`llm_rate_limits`), so storing the keys themselves in the DB keeps everything in one
     place and avoids editing `.env` from a running process.
   - **Decided: Option B.** Implemented in `backend/lib/llm/key-store.js` (DB-backed,
     `.env` fallback when the DB has no enabled rows for a provider).
2. **Should JSON config files (`pipeline.config.json` etc.) move into the DB too, or stay
   as files the backend reads/writes?**
   - Recommendation: migrate `pipeline.config.json` into the `settings` table (same pattern
     already used for other settings) so there's one editable-settings mechanism, not two.
     `shop-conventions.js` stays hardcoded/read-only (it's referenced as intentionally fixed).
   - **Decided as recommended.** Implemented in `backend/config/index.js` (`getPipelineConfig()` /
     `migratePipelineConfigSeed()`). Module order/required-ness stay in the JSON file; only
     `enabled` moves to `settings`.

## Implementation Steps

### Backend (`backend/server.js`, `backend/lib/`)
1. [x] Add DB migration: new `api_keys` table (id, provider, key_value, label, created_at,
   enabled). Done in `backend/db/schema.sql`.
2. [ ] Add endpoints (not yet added to `backend/server.js`):
   - `GET /api/settings/api-keys` — list keys (masked, e.g. last 4 chars only)
   - `POST /api/settings/api-keys` — add a new key
   - `DELETE /api/settings/api-keys/:id` — remove a key
   - `PATCH /api/settings/api-keys/:id` — enable/disable a key
   - (The underlying functions — `listKeysMasked`, `addKey`, `setKeyEnabled`, `deleteKey`
     — already exist in `backend/lib/llm/key-store.js`; this step is just wiring them to
     routes.)
3. [x] Update the provider layer (`backend/lib/llm/gemini.js`, `backend/lib/llm/claude.js`)
   to read from `getKeysForProvider()` (DB-first, `.env` fallback) instead of parsing
   `process.env` once at import.
4. [x] Migrate `pipeline.config.json` module toggles into the `settings` table
   (`getPipelineConfig()` in `backend/config/index.js` now reads `enabled` from `settings`,
   falling back to the JSON seed value). [ ] Still open: `migratePipelineConfigSeed()` is
   written but not called from `backend/server.js` startup (`migrateProductSizesSeed()` is
   the pattern to mirror — see where that's called today).
5. [ ] Add basic validation (key format sanity check) beyond the existing
   provider/key_value presence check in `addKey()`, and avoid ever logging full key
   values (masking helper already exists — just needs applying consistently once routes
   are added).

### Frontend (`frontend/src/App.jsx`)
1. [ ] Extend the Settings panel with a new "API Keys" section:
   - List existing keys (masked) with enable/disable toggle and delete button.
   - Form to add a new key (provider dropdown + key input).
2. [ ] Extend the Settings panel (or add a "Pipeline" sub-section) to edit the module
   toggles currently in `pipeline.config.json`, using the same `PATCH /api/settings`
   pattern already used for price/delivery text.
3. [ ] Add basic client-side masking/confirmation (e.g. "Delete this key?" prompt) since
   this is destructive/sensitive data.
   - None of the above three has been started — `frontend/src/App.jsx` is unchanged on
     this branch so far.

### Tests
- [ ] No test file yet for `backend/lib/llm/key-store.js` (every other lib module in this
  repo has a co-located `*.test.js` — this one should too).
- [ ] No route tests yet for the (not-yet-added) `/api/settings/api-keys` endpoints.
- [ ] No test yet for `migratePipelineConfigSeed()` in `backend/config/index.test.js`
  (mirroring the existing `migrateProductSizesSeed` describe block).

### Security Notes
- Never return full key values from the API after creation — mask on every read.
- Restrict these endpoints if there's any auth layer; if the dashboard is currently
  unauthenticated, flag this as a prerequisite before exposing key management.
- Do not log key values anywhere (server logs, error messages).

## Rollout Order
1. [x] DB migration + backend endpoints for API keys (Option B storage). (Migration done;
   endpoints still open — see Implementation Steps above.)
2. [x] Update provider layer to read keys from DB with `.env` fallback.
3. [ ] Frontend API Keys UI.
4. [~] Migrate `pipeline.config.json` into `settings` table + backend/frontend wiring.
   (Backend read side done; startup seed-wiring and frontend UI still open.)
5. [ ] Remove `.env` dependency once DB-backed keys are confirmed working (keep
   `.env.example` for local dev documentation only).

## Open Question for User
Confirm whether the dashboard has (or needs) an auth layer before exposing API key
management — this changes the security posture of step 3 above.

**Still unresolved as of this status update.** Proceeding with routes now on the
assumption the dashboard is single-user/local (consistent with the rest of the app —
no auth middleware exists anywhere in `backend/server.js` today), but this should be
revisited before any multi-user or hosted deployment.
