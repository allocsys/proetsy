import { getDb } from '../../db/init.js';
import { parseCsv, firstColumn } from '../csv.js';

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

// Turns raw CSV text (e.g. an eRank/EverBee export, or a hand-made spreadsheet export)
// into the { term, category } row shape importFromCsvRows expects. Tolerant of a few
// likely header names for the term column, since different tools' exports won't agree on
// one — a row with none of them present is skipped rather than inserted with an empty
// term.
export function rowsFromCsvText(text) {
  return parseCsv(text)
    .map((row) => ({
      term: firstColumn(row, ['term', 'keyword', 'trend']),
      category: firstColumn(row, ['category', 'cat']) ?? null,
    }))
    .filter((row) => row.term);
}

// Single-entry manual add — the dashboard's one-at-a-time trend entry path, distinct
// from importFromCsvRows' bulk path. Tagged source 'manual' so it's distinguishable from
// a CSV-imported row.
export function addManualTrend(term, category) {
  const db = getDb();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO trends (term, category, source) VALUES (?, ?, ?)')
    .run(term, category ?? null, 'manual');
  return db.prepare('SELECT * FROM trends WHERE id = ?').get(lastInsertRowid);
}
