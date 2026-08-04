import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

// plan.md -> Tests: "No route tests yet for /api/settings/api-keys (add/list/enable/
// disable/delete via supertest, mirroring server.config-routes.test.js's pattern)".
// Same fresh-DB-per-suite pattern as server.config-routes.test.js -- DB_PATH must be set
// before server.js (and everything it imports, including db/init.js) is first imported.
let app;

const VALID_KEY = 'AIzaSyD-fake-key-1234567890';

beforeAll(async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-api-keys-routes-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');
  ({ default: app } = await import('./server.js'));
});

describe('GET /api/settings/api-keys', () => {
  it('returns an empty array when no keys have been added', async () => {
    const res = await request(app).get('/api/settings/api-keys');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/settings/api-keys', () => {
  it('adds a key and returns it masked, never the full value', async () => {
    const res = await request(app)
      .post('/api/settings/api-keys')
      .send({ provider: 'gemini', key_value: VALID_KEY, label: 'primary' });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe('gemini');
    expect(res.body.label).toBe('primary');
    expect(res.body.enabled).toBe(true);
    expect(res.body.maskedKey.endsWith(VALID_KEY.slice(-4))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(VALID_KEY);
    expect(Object.keys(res.body)).not.toContain('key_value');
  });

  it('400s when provider is missing', async () => {
    const res = await request(app).post('/api/settings/api-keys').send({ key_value: VALID_KEY });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('400s when key_value is missing', async () => {
    const res = await request(app).post('/api/settings/api-keys').send({ provider: 'gemini' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('400s when key_value fails plausibility validation (too short)', async () => {
    const res = await request(app)
      .post('/api/settings/api-keys')
      .send({ provider: 'gemini', key_value: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too short/);
  });

  it('now appears in the listing', async () => {
    const res = await request(app).get('/api/settings/api-keys');
    expect(res.status).toBe(200);
    expect(res.body.some((k) => k.label === 'primary')).toBe(true);
  });
});

describe('PATCH /api/settings/api-keys/:id', () => {
  it('enables/disables an existing key', async () => {
    const created = await request(app)
      .post('/api/settings/api-keys')
      .send({ provider: 'claude', key_value: `${VALID_KEY}-claude` });
    const id = created.body.id;

    const disableRes = await request(app).patch(`/api/settings/api-keys/${id}`).send({ enabled: false });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.enabled).toBe(false);
    expect(disableRes.body.id).toBe(id);

    const enableRes = await request(app).patch(`/api/settings/api-keys/${id}`).send({ enabled: true });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.enabled).toBe(true);
  });

  it('400s when enabled is missing or not a boolean', async () => {
    const created = await request(app)
      .post('/api/settings/api-keys')
      .send({ provider: 'gemini', key_value: `${VALID_KEY}-2` });

    const res = await request(app).patch(`/api/settings/api-keys/${created.body.id}`).send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/enabled \(boolean\) is required/);
  });

  it('404s for a nonexistent id', async () => {
    const res = await request(app).patch('/api/settings/api-keys/999999').send({ enabled: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/settings/api-keys/:id', () => {
  it('deletes an existing key', async () => {
    const created = await request(app)
      .post('/api/settings/api-keys')
      .send({ provider: 'gemini', key_value: `${VALID_KEY}-3` });
    const id = created.body.id;

    const deleteRes = await request(app).delete(`/api/settings/api-keys/${id}`);
    expect(deleteRes.status).toBe(204);

    const listRes = await request(app).get('/api/settings/api-keys');
    expect(listRes.body.some((k) => k.id === id)).toBe(false);
  });

  it('404s for a nonexistent id', async () => {
    const res = await request(app).delete('/api/settings/api-keys/999999');
    expect(res.status).toBe(404);
  });
});
