import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'proetsy.db');

let db;

export function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    db.exec(schema);
    runDefensiveMigrations(db);
  }
  return db;
}

// `CREATE TABLE IF NOT EXISTS` above only creates a table's *initial* shape — it does
// nothing for a column added to schema.sql after a dev DB already has that table. There's
// no real migration system yet (see ARCHITECTURE.md -> Module 3 -> "Schema for the review
// step" for the same pattern used elsewhere), so new columns get a defensive
// `ALTER TABLE ... ADD COLUMN`, wrapped in try/catch for the "duplicate column" error
// SQLite throws when the column already exists (from a fresh CREATE TABLE that already
// included it, or a previous run of this same migration).
function runDefensiveMigrations(db) {
  const migrations = [
    // PSD template support — see ARCHITECTURE.md -> Module 3 -> "Template formats".
    'ALTER TABLE product_sizes ADD COLUMN placement_layer TEXT',
    // AI-outpainting review step — see ARCHITECTURE.md -> Module 3 -> "AI-outpainting
    // fallback" step 5.
    'ALTER TABLE mockups ADD COLUMN ai_extended_path TEXT',
    // Lets the step-6 PATCH variant route restore the smart-crop file after file_path has
    // been synced to ai_extended_path — see schema.sql for the full rationale.
    'ALTER TABLE mockups ADD COLUMN smart_crop_path TEXT',
    "ALTER TABLE mockups ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE mockups ADD COLUMN selected_variant TEXT NOT NULL DEFAULT 'smart_crop'",
    // Taste Filter scoring's cold-start confidence check — see ARCHITECTURE.md ->
    // Module 7 -> "Build sequence" step 3 and schema.sql's taste_centroids comment.
    "ALTER TABLE taste_centroids ADD COLUMN kept_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE taste_centroids ADD COLUMN discarded_count INTEGER NOT NULL DEFAULT 0",
    // Groups a bulk drop's jobs for the dashboard history view — see schema.sql's
    // jobs.batch_id comment. The index is created here too (not in schema.sql) since it
    // must run after this column exists on a pre-existing dev DB.
    'ALTER TABLE jobs ADD COLUMN batch_id TEXT',
    'CREATE INDEX IF NOT EXISTS idx_jobs_batch_id ON jobs(batch_id)',
    // Auto-compute taste threshold (plan.md Part 2, Step 2.1) -- flags an
    // image_preferences row as written by the auto-sort decision rule rather than a
    // manual Keep/Discard. See schema.sql's auto_labeled comment.
    'ALTER TABLE image_preferences ADD COLUMN auto_labeled INTEGER DEFAULT 0',
    // Mockup categories (plan.md -> "Mockup categories") -- tags a product_sizes row as
    // "bedroom," "hallway," "mug," etc. See schema.sql's category comment.
    'ALTER TABLE product_sizes ADD COLUMN category TEXT',
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!/duplicate column/i.test(err.message)) throw err;
    }
  }

  // One-time cleanup ahead of the idx_image_preferences_image_path unique index below.
  // A DB created before that index existed may already hold duplicate image_path rows --
  // e.g. a manual Keep/Discard
  // that "corrected" an auto-labeled candidate before this fix, which inserted a second,
  // contradictory row instead of updating the first. Creating the unique index above
  // would fail against any such DB, so duplicates must be resolved first. For each
  // image_path with more than one row, keep exactly one: prefer a manually-labeled row
  // (auto_labeled = 0) over an auto-labeled one, then the most recently created, then
  // the highest id as a final tiebreak; delete the rest. A no-op (0 rows affected) on a
  // DB that's never had a duplicate, so safe to run on every startup.
  //
  // This must run AFTER the migrations loop above, not before: the ORDER BY references
  // auto_labeled, which on a pre-existing DB only exists once its ALTER TABLE (in the
  // loop above) has run. Running the DELETE first throws "no such column: auto_labeled"
  // on any such DB, which is unhandled and crashes the backend on startup.
  db.exec(`
    DELETE FROM image_preferences
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY image_path
            ORDER BY auto_labeled ASC, created_at DESC, id DESC
          ) AS rn
        FROM image_preferences
      )
      WHERE rn = 1
    );
  `);

  // One row per image -- must run AFTER the dedup DELETE above, not as part of the
  // migrations loop: creating a unique index over data that still has duplicates fails
  // immediately with "UNIQUE constraint failed", before the DELETE ever gets a chance to
  // clean them up. This index enforces the fix for a prior bug where relabeling could
  // insert a duplicate, contradictory row instead of updating the existing one.
  // IF NOT EXISTS makes this idempotent across repeated startups the same way
  // idx_jobs_batch_id above already is.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_image_preferences_image_path ON image_preferences(image_path)');
}
