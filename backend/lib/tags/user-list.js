import { getDb } from '../../db/init.js';
import { parseCsv, firstColumn } from '../csv.js';

// v1 implementation: matches the user's pre-made tag library against Module 1's image
// analysis output. Naive substring overlap for the skeleton stage — refine once Module 1
// (Image Analyzer) and Module 2 (Listing Generator) are actually being built.
export function getTagCandidates(imageAnalysis = {}) {
  const db = getDb();
  const allTags = db.prepare('SELECT * FROM tags').all();
  const haystack = JSON.stringify(imageAnalysis).toLowerCase();
  return allTags.filter((tag) => haystack.includes(tag.tag_text.toLowerCase()));
}

// Turns raw CSV text into the { tagText, category } row shape importTagsFromCsvRows
// expects — same tolerant-header-name approach as trends/manual.js's rowsFromCsvText,
// since a tag-research tool's export won't necessarily use the same column name as a
// trend export. Rows with no usable tag-text column are skipped.
export function tagRowsFromCsvText(text) {
  return parseCsv(text)
    .map((row) => ({
      tagText: firstColumn(row, ['tag_text', 'tag', 'text', 'keyword']),
      category: firstColumn(row, ['category', 'cat']) ?? null,
    }))
    .filter((row) => row.tagText);
}

// Bulk-inserts CSV-imported tag rows, tagging their source as 'csv' (mirrors
// trends/manual.js's importFromCsvRows) so a CSV-imported tag is distinguishable later
// from one entered via the existing paste-a-list POST /api/tags/bulk route (source
// 'manual'). Dedupes against tag_text already in the library, same as that route already
// does, so importing a CSV that overlaps with the existing library doesn't create
// duplicate rows. Returns the number of rows actually inserted.
export function importTagsFromCsvRows(rows) {
  const db = getDb();
  const existing = new Set(db.prepare('SELECT tag_text FROM tags').all().map((r) => r.tag_text));
  const insert = db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)');
  const insertMany = db.transaction((items) => {
    let inserted = 0;
    for (const item of items) {
      if (existing.has(item.tagText)) continue;
      insert.run(item.tagText, item.category ?? null, 'csv');
      existing.add(item.tagText);
      inserted += 1;
    }
    return inserted;
  });
  return insertMany(rows);
}
