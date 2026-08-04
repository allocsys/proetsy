// Dashboard-editable API key store (plan.md -> "Editable Settings & API Keys from
// Dashboard"). Source of truth is the `api_keys` DB table; backend/.env's
// GEMINI_API_KEYS / CLAUDE_API_KEY are only used as a fallback when this table has no
// enabled rows for a given provider, so an existing local-dev .env setup keeps working
// unchanged until someone adds a key via the dashboard.
//
// Full key values are only ever read here and inside the provider modules that actually
// call the LLM APIs (gemini.js / claude.js) -- every other caller (routes, the frontend)
// only ever sees masked values via listKeysMasked().

import { getDb } from '../../db/init.js';

const ENV_KEYS_BY_PROVIDER = {
  gemini: () =>
    (process.env.GEMINI_API_KEYS || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  claude: () => (process.env.CLAUDE_API_KEY ? [process.env.CLAUDE_API_KEY.trim()] : []),
};

/**
 * Returns the ordered list of enabled key values for a provider ('gemini' | 'claude'),
 * DB rows first (oldest first, so an existing key pool's rotation order doesn't shuffle
 * every time a new key is added), falling back to the corresponding .env variable(s)
 * only when the DB has zero enabled rows for that provider.
 *
 * @returns {string[]}
 */
export function getKeysForProvider(provider) {
  const db = getDb();
  const rows = db
    .prepare('SELECT key_value FROM api_keys WHERE provider = ? AND enabled = 1 ORDER BY id')
    .all(provider);
  if (rows.length) return rows.map((r) => r.key_value);

  const envFn = ENV_KEYS_BY_PROVIDER[provider];
  return envFn ? envFn() : [];
}

// Last 4 chars visible, everything else replaced -- enough for a user to tell keys
// apart in the dashboard without ever re-exposing the full value over the API.
function maskKey(value) {
  if (!value) return '';
  const tail = value.slice(-4);
  return value.length <= 4 ? '*'.repeat(value.length) : `${'*'.repeat(Math.min(value.length - 4, 8))}...${tail}`;
}

/**
 * Lists all stored keys (any provider), masked -- the shape GET /api/settings/api-keys
 * returns. Does not include .env-sourced keys, since those aren't rows in this table and
 * have no id to enable/disable/delete; the dashboard's list is DB-managed keys only.
 */
export function listKeysMasked() {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, provider, key_value, label, enabled, created_at FROM api_keys ORDER BY provider, id')
    .all();
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    label: r.label,
    enabled: Boolean(r.enabled),
    createdAt: r.created_at,
    maskedKey: maskKey(r.key_value),
  }));
}

export function addKey({ provider, key_value, label }) {
  if (!provider || !key_value) {
    throw new Error('provider and key_value are required');
  }
  const db = getDb();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO api_keys (provider, key_value, label, enabled) VALUES (?, ?, ?, 1)')
    .run(provider, key_value, label || null);
  const row = db.prepare('SELECT id, provider, label, enabled, created_at FROM api_keys WHERE id = ?').get(lastInsertRowid);
  return { ...row, enabled: Boolean(row.enabled), maskedKey: maskKey(key_value) };
}

export function setKeyEnabled(id, enabled) {
  const db = getDb();
  const result = db.prepare('UPDATE api_keys SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

export function deleteKey(id) {
  const db = getDb();
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  return result.changes > 0;
}
