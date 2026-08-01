import { getDb } from '../../db/init.js';

// v1 implementation: matches the user's pre-made tag library against Module 1's image
// analysis output. Naive substring overlap for the skeleton stage — refine once Module 1
// (Image Analyzer) and Module 2 (Listing Generator) are actually being built.
export function getTagCandidates(imageAnalysis = {}) {
  const db = getDb();
  const allTags = db.prepare('SELECT * FROM tags').all();
  const haystack = JSON.stringify(imageAnalysis).toLowerCase();
  return allTags.filter((tag) => haystack.includes(tag.tag_text.toLowerCase()));
}
