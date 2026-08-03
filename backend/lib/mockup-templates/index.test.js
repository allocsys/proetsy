import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Jimp from 'jimp';
import { writePsdFixtureTo, PSD_FIXTURE } from '../__fixtures__/load-psd-fixture.js';

// Same "env vars set before dynamic import" pattern as mockup-generator.idempotency.test.js
// -- db/init.js and this module both read DB_PATH / MOCKUP_TEMPLATE_PREVIEWS_DIR at
// import time.
let getDb;
let scanTemplatesFolder;
let generateTemplatePreview;
let listConfiguredTemplates;
let upsertConfiguredTemplate;
let deleteConfiguredTemplate;
let _resetCachesForTests;
let tmpRoot;
let templatesDir;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-mockup-templates-'));
  templatesDir = path.join(tmpRoot, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  process.env.DB_PATH = path.join(tmpRoot, 'test.db');
  process.env.MOCKUP_TEMPLATE_PREVIEWS_DIR = path.join(tmpRoot, 'previews');
  process.env.MOCKUP_TEMPLATES_DIR = templatesDir;

  const flatTemplate = new Jimp(20, 10, 0x00000000);
  await flatTemplate.writeAsync(path.join(templatesDir, 'frame.png'));
  writePsdFixtureTo(path.join(templatesDir, 'framed-wall.psd'));
  // A non-template file that scanTemplatesFolder must ignore.
  fs.writeFileSync(path.join(templatesDir, 'notes.txt'), 'not a template');

  ({ getDb } = await import('../../db/init.js'));
  ({
    scanTemplatesFolder,
    generateTemplatePreview,
    listConfiguredTemplates,
    upsertConfiguredTemplate,
    deleteConfiguredTemplate,
    _resetCachesForTests,
  } = await import('./index.js'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  _resetCachesForTests();
  const db = getDb();
  db.prepare('DELETE FROM product_sizes').run();
});

describe('scanTemplatesFolder', () => {
  it('lists only template-shaped files, with correct dimensions and kind', async () => {
    const results = await scanTemplatesFolder(templatesDir);
    const byName = Object.fromEntries(results.map((r) => [r.filename, r]));

    expect(Object.keys(byName).sort()).toEqual(['frame.png', 'framed-wall.psd']);

    expect(byName['frame.png'].kind).toBe('flat');
    expect(byName['frame.png'].width).toBe(20);
    expect(byName['frame.png'].height).toBe(10);

    expect(byName['framed-wall.psd'].kind).toBe('psd');
    expect(byName['framed-wall.psd'].width).toBe(PSD_FIXTURE.documentWidth);
    expect(byName['framed-wall.psd'].height).toBe(PSD_FIXTURE.documentHeight);
  });

  it('marks alreadyAssignedTo when a file is configured as a product size, and omits it otherwise', async () => {
    const before = await scanTemplatesFolder(templatesDir);
    expect(before.find((r) => r.filename === 'frame.png').alreadyAssignedTo).toBeNull();

    upsertConfiguredTemplate({ size_key: '8x10', mockup_template: 'frame.png' });

    const after = await scanTemplatesFolder(templatesDir);
    expect(after.find((r) => r.filename === 'frame.png').alreadyAssignedTo).toBe('8x10');
    expect(after.find((r) => r.filename === 'framed-wall.psd').alreadyAssignedTo).toBeNull();
  });

  it('throws for a folder that does not exist', async () => {
    await expect(scanTemplatesFolder(path.join(tmpRoot, 'nope'))).rejects.toThrow(/does not exist/);
  });
});

describe('generateTemplatePreview', () => {
  it('produces a readable preview PNG for a flat template', async () => {
    const previewPath = await generateTemplatePreview(path.join(templatesDir, 'frame.png'), 'flat');
    expect(fs.existsSync(previewPath)).toBe(true);
    const preview = await Jimp.read(previewPath);
    expect(preview.bitmap.width).toBeGreaterThan(0);
    expect(preview.bitmap.height).toBeGreaterThan(0);
  });

  it('produces a readable, flattened preview PNG for a PSD template', async () => {
    const previewPath = await generateTemplatePreview(path.join(templatesDir, 'framed-wall.psd'), 'psd');
    expect(fs.existsSync(previewPath)).toBe(true);
    const preview = await Jimp.read(previewPath);
    expect(preview.bitmap.width).toBe(PSD_FIXTURE.documentWidth);
    expect(preview.bitmap.height).toBe(PSD_FIXTURE.documentHeight);
    // No leftover full-res intermediate file next to the cached preview.
    expect(fs.existsSync(`${previewPath}.full.png`)).toBe(false);
  });

  it('reuses the cached preview on a second call for an unchanged file', async () => {
    const first = await generateTemplatePreview(path.join(templatesDir, 'frame.png'), 'flat');
    const second = await generateTemplatePreview(path.join(templatesDir, 'frame.png'), 'flat');
    expect(second).toBe(first);
  });
});

describe('upsertConfiguredTemplate / deleteConfiguredTemplate / listConfiguredTemplates', () => {
  it('rejects a mockup_template that does not exist under the templates dir', () => {
    expect(() => upsertConfiguredTemplate({ size_key: '8x10', mockup_template: 'does-not-exist.png' })).toThrow(
      /Template file not found/
    );
  });

  it('upserts by size_key (create then update, not duplicate)', () => {
    upsertConfiguredTemplate({ size_key: '8x10', mockup_template: 'frame.png', dimensions: '8x10', dpi: 300 });
    upsertConfiguredTemplate({ size_key: '8x10', mockup_template: 'frame.png', dimensions: '8x10', dpi: 150 });

    const db = getDb();
    const rows = db.prepare('SELECT * FROM product_sizes WHERE size_key = ?').all('8x10');
    expect(rows).toHaveLength(1);
    expect(rows[0].dpi).toBe(150);
  });

  it('listConfiguredTemplates returns configured rows annotated with a preview_url', async () => {
    upsertConfiguredTemplate({ size_key: '8x10', mockup_template: 'frame.png' });
    upsertConfiguredTemplate({ size_key: 'framed-wall', mockup_template: 'framed-wall.psd', placement_layer: 'artwork' });

    const rows = await listConfiguredTemplates();
    const byKey = Object.fromEntries(rows.map((r) => [r.size_key, r]));

    expect(byKey['8x10'].preview_url).toMatch(/^\/mockup-template-previews\//);
    expect(byKey['framed-wall'].preview_url).toMatch(/^\/mockup-template-previews\//);
  });

  it('deleteConfiguredTemplate removes the row and reports whether anything was deleted', () => {
    upsertConfiguredTemplate({ size_key: '8x10', mockup_template: 'frame.png' });

    expect(deleteConfiguredTemplate('8x10')).toBe(true);
    expect(deleteConfiguredTemplate('8x10')).toBe(false);

    const db = getDb();
    expect(db.prepare('SELECT * FROM product_sizes WHERE size_key = ?').get('8x10')).toBeUndefined();
  });
});
