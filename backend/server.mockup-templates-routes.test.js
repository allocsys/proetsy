import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import Jimp from 'jimp';
import { writePsdFixtureTo } from './lib/__fixtures__/load-psd-fixture.js';

// Same "env vars set before dynamic import" pattern as server.mockup-routes.test.js --
// server.js (and the mockup-templates module it imports) read
// DB_PATH/MOCKUP_TEMPLATE_PREVIEWS_DIR/MOCKUP_TEMPLATES_DIR at import time.
let app;
let getDb;
let tmpRoot;
let templatesDir;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-mockup-templates-routes-'));
  templatesDir = path.join(tmpRoot, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  process.env.DB_PATH = path.join(tmpRoot, 'test.db');
  process.env.MOCKUP_OUTPUT_DIR = path.join(tmpRoot, 'mockups-out');
  process.env.MOCKUP_TEMPLATES_DIR = templatesDir;
  process.env.MOCKUP_TEMPLATE_PREVIEWS_DIR = path.join(tmpRoot, 'previews');
  process.env.ARTWORK_UPLOADS_DIR = path.join(tmpRoot, 'uploads');
  process.env.TASTE_FILTER_CANDIDATES_DIR = path.join(tmpRoot, 'taste-filter');

  const flatTemplate = new Jimp(20, 10, 0x00000000);
  await flatTemplate.writeAsync(path.join(templatesDir, 'frame.png'));
  writePsdFixtureTo(path.join(templatesDir, 'framed-wall.psd'));

  ({ getDb } = await import('./db/init.js'));
  ({ default: app } = await import('./server.js'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('GET /api/mockup-templates/scan', () => {
  it('scans the given folder and returns template-shaped files', async () => {
    const res = await request(app).get('/api/mockup-templates/scan').query({ folder: templatesDir });

    expect(res.status).toBe(200);
    expect(res.body.folder).toBe(templatesDir);
    const filenames = res.body.files.map((f) => f.filename).sort();
    expect(filenames).toEqual(['frame.png', 'framed-wall.psd']);
  });

  it('falls back to the saved mockup_templates_dir setting when folder is omitted', async () => {
    await request(app).patch('/api/settings').send({ mockup_templates_dir: templatesDir });

    const res = await request(app).get('/api/mockup-templates/scan');

    expect(res.status).toBe(200);
    expect(res.body.folder).toBe(templatesDir);
  });

  it('400s for a nonexistent folder', async () => {
    const res = await request(app).get('/api/mockup-templates/scan').query({ folder: path.join(tmpRoot, 'nope') });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not exist/);
  });
});

describe('POST /api/mockup-templates + GET /api/mockup-templates', () => {
  it('creates a configured template and lists it back with a preview_url', async () => {
    const createRes = await request(app)
      .post('/api/mockup-templates')
      .send({
        size_key: '8x10',
        dimensions: '8x10',
        dpi: 300,
        orientation: 'portrait',
        mockup_template: 'frame.png',
        category: 'bedroom',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.size_key).toBe('8x10');
    expect(createRes.body.category).toBe('bedroom');

    const listRes = await request(app).get('/api/mockup-templates');
    expect(listRes.status).toBe(200);
    const entry = listRes.body.find((r) => r.size_key === '8x10');
    expect(entry).toBeTruthy();
    expect(entry.preview_url).toMatch(/^\/mockup-template-previews\//);
    expect(entry.category).toBe('bedroom');
  });

  it('creates a PSD-backed configured template with a working preview', async () => {
    const createRes = await request(app)
      .post('/api/mockup-templates')
      .send({ size_key: 'framed-wall', mockup_template: 'framed-wall.psd', placement_layer: 'artwork' });

    expect(createRes.status).toBe(201);

    const listRes = await request(app).get('/api/mockup-templates');
    const entry = listRes.body.find((r) => r.size_key === 'framed-wall');
    expect(entry.preview_url).toMatch(/^\/mockup-template-previews\//);

    const previewRes = await request(app).get(entry.preview_url);
    expect(previewRes.status).toBe(200);
  });

  it('rejects a mockup_template path that does not exist under the templates dir', async () => {
    const res = await request(app)
      .post('/api/mockup-templates')
      .send({ size_key: 'bad', mockup_template: 'does-not-exist.png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Template file not found/);
  });

  it('upserting the same size_key again updates rather than duplicates', async () => {
    await request(app).post('/api/mockup-templates').send({ size_key: 'dup-test', mockup_template: 'frame.png', dpi: 150 });
    await request(app).post('/api/mockup-templates').send({ size_key: 'dup-test', mockup_template: 'frame.png', dpi: 300 });

    const db = getDb();
    const rows = db.prepare('SELECT * FROM product_sizes WHERE size_key = ?').all('dup-test');
    expect(rows).toHaveLength(1);
    expect(rows[0].dpi).toBe(300);
  });
});

describe('GET /api/mockup-templates/categories', () => {
  // Unlike the rest of this file's tests (which rely on distinct size_keys since
  // there's no cross-test cleanup), the categories route reads across every configured
  // row -- an earlier describe block's '8x10' row (category: 'bedroom') would otherwise
  // leak into these assertions. Clear product_sizes first so each test here starts from
  // a known category set.
  beforeEach(() => {
    getDb().prepare('DELETE FROM product_sizes').run();
  });

  it('returns an empty array when nothing is categorized', async () => {
    await request(app)
      .post('/api/mockup-templates')
      .send({ size_key: 'no-category-test', mockup_template: 'frame.png' });

    const res = await request(app).get('/api/mockup-templates/categories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns the distinct, sorted list once some templates are categorized', async () => {
    await request(app)
      .post('/api/mockup-templates')
      .send({ size_key: 'cat-a', mockup_template: 'frame.png', category: 'nature' });
    await request(app)
      .post('/api/mockup-templates')
      .send({ size_key: 'cat-b', mockup_template: 'framed-wall.psd', category: 'bedroom' });
    await request(app)
      .post('/api/mockup-templates')
      .send({ size_key: 'cat-c', mockup_template: 'frame.png', category: 'bedroom' });

    const res = await request(app).get('/api/mockup-templates/categories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['bedroom', 'nature']);
  });
});

describe('DELETE /api/mockup-templates/:sizeKey', () => {
  it('deletes a configured template', async () => {
    await request(app).post('/api/mockup-templates').send({ size_key: 'to-delete', mockup_template: 'frame.png' });

    const deleteRes = await request(app).delete('/api/mockup-templates/to-delete');
    expect(deleteRes.status).toBe(204);

    const listRes = await request(app).get('/api/mockup-templates');
    expect(listRes.body.find((r) => r.size_key === 'to-delete')).toBeUndefined();
  });

  it('404s deleting a size_key that was never configured', async () => {
    const res = await request(app).delete('/api/mockup-templates/never-existed');
    expect(res.status).toBe(404);
  });
});
