# Plan: Editable Settings & API Keys from Dashboard

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
2. **Should JSON config files (`pipeline.config.json` etc.) move into the DB too, or stay
   as files the backend reads/writes?**
   - Recommendation: migrate `pipeline.config.json` into the `settings` table (same pattern
     already used for other settings) so there's one editable-settings mechanism, not two.
     `shop-conventions.js` stays hardcoded/read-only (it's referenced as intentionally fixed).

## Implementation Steps

### Backend (`backend/server.js`, `backend/lib/`)
1. Add DB migration: new `api_keys` table (id, provider, key_value, label, created_at,
   enabled) — or extend `llm_rate_limits` if simpler.
2. Add endpoints:
   - `GET /api/settings/api-keys` — list keys (masked, e.g. last 4 chars only)
   - `POST /api/settings/api-keys` — add a new key
   - `DELETE /api/settings/api-keys/:id` — remove a key
   - `PATCH /api/settings/api-keys/:id` — enable/disable a key
3. Update the provider layer (wherever `GEMINI_API_KEYS` is currently read from
   `process.env`) to read from the DB instead, falling back to `.env` if the DB table
   is empty (smooth migration path).
4. Migrate `pipeline.config.json` module toggles into the `settings` table; update
   whatever reads `pipeline.config.json` today to read from `GET /api/settings` instead.
   Keep the JSON file as a one-time seed, same pattern as `product-sizes.json`.
5. Add basic validation (key format sanity check) and avoid ever logging full key values.

### Frontend (`frontend/src/App.jsx`)
1. Extend the Settings panel with a new "API Keys" section:
   - List existing keys (masked) with enable/disable toggle and delete button.
   - Form to add a new key (provider dropdown + key input).
2. Extend the Settings panel (or add a "Pipeline" sub-section) to edit the module
   toggles currently in `pipeline.config.json`, using the same `PATCH /api/settings`
   pattern already used for price/delivery text.
3. Add basic client-side masking/confirmation (e.g. "Delete this key?" prompt) since
   this is destructive/sensitive data.

### Security Notes
- Never return full key values from the API after creation — mask on every read.
- Restrict these endpoints if there's any auth layer; if the dashboard is currently
  unauthenticated, flag this as a prerequisite before exposing key management.
- Do not log key values anywhere (server logs, error messages).

## Rollout Order
1. DB migration + backend endpoints for API keys (Option B storage).
2. Update provider layer to read keys from DB with `.env` fallback.
3. Frontend API Keys UI.
4. Migrate `pipeline.config.json` into `settings` table + backend/frontend wiring.
5. Remove `.env` dependency once DB-backed keys are confirmed working (keep
   `.env.example` for local dev documentation only).

## Open Question for User
Confirm whether the dashboard has (or needs) an auth layer before exposing API key
management — this changes the security posture of step 3 above.
