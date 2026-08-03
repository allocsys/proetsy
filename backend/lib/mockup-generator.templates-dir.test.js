import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Jimp from 'jimp';

// Same "env vars set before dynamic import" pattern as
// mockup-generator.idempotency.test.js -- mockup-generator.js and its dependencies read
// DB_PATH/MOCKUP_OUTPUT_DIR/MOCKUP_TEMPLATES_DIR at import time.
let getDb;
let resolveTemplatesBaseDir;
let composeMockup;
let tmpRoot;
let envTemplatesDir;
let settingTemplatesDir;
let artworkPath;

const TEST_SIZE_KEY = 'test-size';

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-templates-dir-'));
  envTemplatesDir = path.join(tmpRoot, 'env-templates');
  settingTemplatesDir = path.join(tmpRoot, 'setting-templates');
  fs.mkdirSync(envTemplatesDir, { recursive: true });
  fs.mkdirSync(settingTemplatesDir, { recursive: true });

  process.env.DB_PATH = path.join(tmpRoot, 'test.db');
  process.env.MOCKUP_OUTPUT_DIR = path.join(tmpRoot, 'mockups-out');
  process.env.MOCKUP_TEMPLATES_DIR = envTemplatesDir;

  // The template only exists under settingTemplatesDir, not envTemplatesDir -- so a test
  // that composes successfully against it proves the settings value actually won, not
  // just that the env fallback happened to also resolve.
  const template = new Jimp(16, 16, 0x00000000);
  await template.writeAsync(path.join(settingTemplatesDir, 'test-template.png'));

  // Matching aspect ratio keeps computeMismatchRatio() at 0, well under the default
  // LARGE_MISMATCH_RATIO -- composeMockup takes the smart-crop-only path and never calls
  // generateImage()/Gemini. This suite is about templates-dir resolution, not outpainting.
  const artworkDir = path.join(tmpRoot, 'artwork');
  fs.mkdirSync(artworkDir, { recursive: true });
  const artwork = new Jimp(16, 16, 0x3366ccff);
  artworkPath = path.join(artworkDir, 'test-artwork.png');
  await artwork.writeAsync(artworkPath);

  ({ getDb } = await import('../db/init.js'));
  ({ resolveTemplatesBaseDir, composeMockup } = await import('./mockup-generator.js'));

  const db = getDb();
  db.prepare(
    `INSERT INTO product_sizes (size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(TEST_SIZE_KEY, '4x4', 300, 'square', 'test-template.png', null);
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// See plan.md -> "Backend changes" -> "2." and ARCHITECTURE.md -> Module 3 -> Rollout
// step 3: TEMPLATES_BASE_DIR was a module-load-time constant before this pass; it's now
// a function read fresh on every call, settings-first.
describe('resolveTemplatesBaseDir', () => {
  it('falls back to MOCKUP_TEMPLATES_DIR when no mockup_templates_dir setting is saved', () => {
    expect(resolveTemplatesBaseDir()).toBe(envTemplatesDir);
  });

  it('prefers the mockup_templates_dir setting once one is saved, with no re-import needed', () => {
    const db = getDb();
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('mockup_templates_dir', settingTemplatesDir);

    // Same already-imported mockup-generator.js module, same process -- proves this
    // takes effect immediately rather than needing a server restart, matching
    // syncWatcherFromSettings()'s existing "no restart needed" behavior for Module 7.
    expect(resolveTemplatesBaseDir()).toBe(settingTemplatesDir);
  });
});

describe('composeMockup with a dynamically-set templates dir', () => {
  it('composes against the folder named by the mockup_templates_dir setting, not MOCKUP_TEMPLATES_DIR', async () => {
    const db = getDb();
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('mockup_templates_dir', settingTemplatesDir);

    // The template file only exists under settingTemplatesDir (see beforeAll) -- if
    // composeMockup were still reading the old env-only constant, this would throw
    // "Mockup template not found" instead of succeeding.
    const { outputPath } = await composeMockup(artworkPath, TEST_SIZE_KEY);

    expect(fs.existsSync(outputPath)).toBe(true);
  });
});
