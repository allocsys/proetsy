import Database from 'better-sqlite3';
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
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
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
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!/duplicate column/i.test(err.message)) throw err;
    }
  }
}
