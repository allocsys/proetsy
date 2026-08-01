import { getDb } from '../../db/init.js';

// v1 implementation: trends entered by the user directly (dashboard) or via CSV import
// from a tool like eRank/EverBee's own export feature — no scraping, no automation
// against a third-party site's interface.
export async function getTrends(category) {
  const db = getDb();
  if (category) {
    return db.prepare('SELECT * FROM trends WHERE category = ? ORDER BY added_at DESC').all(category);
  }
  return db.prepare('SELECT * FROM trends ORDER BY added_at DESC').all();
}

// Bulk-inserts rows parsed from an imported CSV export, tagging their source as 'csv'
// so it's distinguishable from hand-typed ('manual') entries later.
export function importFromCsvRows(rows) {
  const db = getDb();
  const insert = db.prepare('INSERT INTO trends (term, category, source) VALUES (?, ?, ?)');
  const insertMany = db.transaction((items) => {
    for (const item of items) insert.run(item.term, item.category ?? null, 'csv');
  });
  insertMany(rows);
}
