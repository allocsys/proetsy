// Minimal CSV parsing shared by the trends and tags CSV-import paths (ARCHITECTURE.md ->
// Trends Provider Layer -> "CSV import in manual.js", and -> Module 6 -> Settings panel
// "Not yet done: ... CSV tag import"). Deliberately NOT a full RFC 4180 implementation —
// no dependency added for it (matches the project's existing zero-extra-dependency bias
// elsewhere, e.g. Module 7's WASM-over-native-binding choice, the in-process Map instead
// of Redis for LLM cooldowns) — just enough to handle a straightforward header-row export
// from a tool like eRank/EverBee (or a hand-made spreadsheet export): comma-separated
// fields, optional double-quote wrapping for fields that contain a comma, "" as an
// escaped quote inside a quoted field. Does not support multi-line quoted fields.

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Parses CSV text into an array of row objects keyed by the (lowercased) header row.
 * Blank lines are skipped. Returns [] for empty/whitespace-only input or a header-only
 * file with no data rows.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((key, idx) => {
      row[key] = cells[idx] !== undefined ? cells[idx] : '';
    });
    return row;
  });
}

/**
 * Reads a value from a parsed CSV row by trying each of several possible header names in
 * order (case-insensitive — parseCsv already lowercases headers), so a "term" column and
 * a "keyword" column from two different tools' exports both work without the caller
 * needing to know which one a given file used. Returns undefined if the row is missing
 * all candidate keys, or the cell was empty.
 * @param {Record<string, string>} row
 * @param {string[]} candidateKeys
 * @returns {string | undefined}
 */
export function firstColumn(row, candidateKeys) {
  for (const key of candidateKeys) {
    const value = row[key];
    if (value) return value;
  }
  return undefined;
}
