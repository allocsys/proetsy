import { getDb } from '../../db/init.js';
import { parseCsv, firstColumn } from '../csv.js';

// plan.md Rollout step 3: "Suggest categories for uncategorized tags" one-time admin
// action. Not a fresh classifier -- it runs each uncategorized tag's own text against the
// set of categories that already exist elsewhere in the library (the same free-text
// values the category <datalist> in the Tag Library UI already surfaces), so a shop that
// has categorized even a handful of tags (e.g. 'botanical', 'boho') gets the obvious
// substring matches ("botanical print" -> 'botanical') backfilled without a full manual
// re-tag. Deliberately conservative: only ever assigns a category that's already in use
// by at least one other tag, never invents a new one, and never touches a tag that
// already has a category (no silent overwrites).
// `dryRun: true` computes the same matches without writing anything -- lets the
// dashboard show the user exactly which tags would get which category before
// committing (see server.js's POST /api/tags/backfill-categories?dry_run=true). The
// matching logic itself is pure/deterministic (substring match against
// already-in-use categories), so a dry run and a real run against the same tag data
// always agree -- there's no risk of the preview promising something the real run
// then does differently.
export function suggestCategoriesForUncategorizedTags({ dryRun = false } = {}) {
  const db = getDb();
  const allTags = db.prepare('SELECT * FROM tags').all();

  const knownCategories = Array.from(
    new Set(allTags.map((t) => t.category).filter(Boolean))
  );

  const update = db.prepare('UPDATE tags SET category = ? WHERE id = ?');
  const uncategorized = allTags.filter((t) => !t.category);
  const updates = [];

  const computeMatches = () => {
    for (const tag of uncategorized) {
      const haystack = tag.tag_text.toLowerCase();
      // First matching known category wins; longest-first so a more specific category
      // (e.g. 'nursery decor') isn't shadowed by a shorter one (e.g. 'decor') that also
      // happens to substring-match.
      const match = [...knownCategories]
        .sort((a, b) => b.length - a.length)
        .find((category) => haystack.includes(category.toLowerCase()));
      if (!match) continue;
      if (!dryRun) update.run(match, tag.id);
      updates.push({ tagText: tag.tag_text, category: match });
    }
  };

  if (dryRun) {
    computeMatches();
  } else {
    db.transaction(computeMatches)();
  }

  return {
    dryRun,
    checked: uncategorized.length,
    updated: dryRun ? 0 : updates.length,
    updates,
  };
}

// v2: still requires the existing substring overlap against Module 1's image analysis
// output (so behavior for uncategorized tags — the bulk of most libraries today — is
// unchanged), but now ranks candidates by whether the tag's own `category` corroborates
// the artwork's detected style/suggested_categories. A tag whose category actively
// conflicts with the artwork's style is demoted (not dropped — still returned, just later
// in the list) rather than excluded outright, since `category` is free-text and a mismatch
// isn't proof the tag is wrong, just weaker evidence than a corroborated match.
export function getTagCandidates(imageAnalysis = {}) {
  const db = getDb();
  const allTags = db.prepare('SELECT * FROM tags').all();
  const haystack = JSON.stringify(imageAnalysis).toLowerCase();

  const style = typeof imageAnalysis.style === 'string' ? imageAnalysis.style.toLowerCase() : null;
  const suggestedCategories = Array.isArray(imageAnalysis.suggested_categories)
    ? imageAnalysis.suggested_categories
        .filter((c) => typeof c === 'string')
        .map((c) => c.toLowerCase())
    : [];

  const scored = allTags
    .filter((tag) => haystack.includes(tag.tag_text.toLowerCase()))
    .map((tag) => {
      const category = tag.category ? tag.category.toLowerCase() : null;
      let score = 1; // baseline: substring match only, no category to corroborate either way

      if (category) {
        const corroborated = category === style || suggestedCategories.includes(category);
        score = corroborated ? 2 : 0.5;
      }

      return { tag, score };
    });

  // Stable sort: ties (equal score) keep their original DB order rather than being
  // shuffled, so results stay deterministic across runs.
  return scored
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.tag);
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
