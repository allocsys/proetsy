# Plan: Editable Settings & API Keys from Dashboard

## Status (2026-08-04, updated again)
All implementation and test work is done: backend routes, DB migration, provider-layer
wiring, frontend UI, and every item on the Tests checklist (route tests for
`/api/settings/api-keys`, the `migratePipelineConfigSeed()` test, and the frontend
Settings-section tests) all landed in later commits and pass (`21` backend tests across
`server.api-keys-routes.test.js` + `config/index.test.js`, `30` frontend tests in
`App.test.jsx`, verified locally on this branch). Only two things are left, and both are
decisions/confirmations rather than code:
- Rollout step 5 (dropping the `.env` dependency) — needs the DB-backed path confirmed
  working in real usage first, not just in tests.
- The open auth question below — still unresolved and blocks nothing today since the
  dashboard is single-user/local, but should be answered before any multi-user/hosted
  deployment.

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
2. [x] Add endpoints (in `backend/server.js`):
   - `GET /api/settings/api-keys` — list keys (masked, e.g. last 4 chars only)
   - `POST /api/settings/api-keys` — add a new key
   - `DELETE /api/settings/api-keys/:id` — remove a key
   - `PATCH /api/settings/api-keys/:id` — enable/disable a key
   - Backed by `listKeysMasked`, `addKey`, `setKeyEnabled`, `deleteKey` in
     `backend/lib/llm/key-store.js`. [x] `backend/server.api-keys-routes.test.js` now
     covers add/list/enable-disable/delete, mirroring the existing
     `server.*-routes.test.js` pattern.
3. [x] Update the provider layer (`backend/lib/llm/gemini.js`, `backend/lib/llm/claude.js`)
   to read from `getKeysForProvider()` (DB-first, `.env` fallback) instead of parsing
   `process.env` once at import.
4. [x] Migrate `pipeline.config.json` module toggles into the `settings` table
   (`getPipelineConfig()` in `backend/config/index.js` now reads `enabled` from `settings`,
   falling back to the JSON seed value). `migratePipelineConfigSeed()` is now called from
   `backend/server.js` startup, alongside `migrateProductSizesSeed()`. [x]
   `backend/config/index.test.js` now has a `migratePipelineConfigSeed()` describe block
   (mirroring the existing `migrateProductSizesSeed` one).
5. [x] Add basic validation: `key-store.js`'s `addKey()` now rejects a `key_value` under
   16 chars or containing whitespace (`assertPlausibleKey()`), on top of the existing
   provider/key_value presence check. Full key values are never logged; routes only ever
   return `listKeysMasked()`-shaped objects.

### Frontend (`frontend/src/App.jsx`)
1. [x] Extend the Settings panel with a new "API Keys" section:
   - Lists existing keys (masked, via `GET /api/settings/api-keys`) with enable/disable
     toggle and delete button.
   - Form to add a new key (provider dropdown, key input, optional label).
2. [x] Extend the Settings panel with a "Pipeline Modules" section that edits the
   persisted `pipeline_module_<name>_enabled` settings keys via `PATCH /api/settings`,
   same pattern already used for price/delivery text. Kept distinct from the existing
   per-upload-session override checkboxes on the Upload view (those still default from
   this persisted value but don't write back to it).
3. [x] Client-side confirmation on delete (`window.confirm`, naming the provider/label/
   masked key); the key input itself uses `type="password"` so a pasted value isn't
   shown in plaintext while typing.

### Tests
- [x] `backend/lib/llm/key-store.test.js` — covers `getKeysForProvider` (.env fallback,
  DB-first, disabled-row exclusion), `addKey` (validation + masking), `listKeysMasked`,
  `setKeyEnabled`, `deleteKey`.
- [x] `backend/server.api-keys-routes.test.js` — add/list/enable/disable/delete via
  supertest, mirroring `server.config-routes.test.js`'s pattern.
- [x] `backend/config/index.test.js` — `migratePipelineConfigSeed()` describe block,
  mirroring the existing `migrateProductSizesSeed` one.
- [x] `frontend/src/App.test.jsx` — API Keys list renders, add/enable/disable/delete call
  the right endpoints (and the add form never leaks the plaintext key into a visible
  field), and the Pipeline Modules checkboxes PATCH `/api/settings`.

All four test files verified passing locally on this branch: 21 backend tests
(`server.api-keys-routes.test.js` + `config/index.test.js`) and 30 frontend tests
(`App.test.jsx`).

### Security Notes
- Never return full key values from the API after creation — mask on every read.
- Restrict these endpoints if there's any auth layer; if the dashboard is currently
  unauthenticated, flag this as a prerequisite before exposing key management.
- Do not log key values anywhere (server logs, error messages).

## Rollout Order
1. [x] DB migration + backend endpoints for API keys (Option B storage).
2. [x] Update provider layer to read keys from DB with `.env` fallback.
3. [x] Frontend API Keys UI.
4. [x] Migrate `pipeline.config.json` into `settings` table + backend/frontend wiring.
   All planned tests (backend routes, seed migration, frontend Settings sections) done
   and passing.
5. [ ] Remove `.env` dependency once DB-backed keys are confirmed working (keep
   `.env.example` for local dev documentation only). Not started — this is a
   confirm-in-practice step, not just a code change, so it's the last thing left before
   this plan is fully closed out.

## Open Question for User
Confirm whether the dashboard has (or needs) an auth layer before exposing API key
management — this changes the security posture of step 3 above.

**Still unresolved as of this status update.** Proceeding with routes now on the
assumption the dashboard is single-user/local (consistent with the rest of the app —
no auth middleware exists anywhere in `backend/server.js` today), but this should be
revisited before any multi-user or hosted deployment.
