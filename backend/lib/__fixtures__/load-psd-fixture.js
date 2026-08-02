// Loader for the committed synthetic layered-PSD test fixture (ARCHITECTURE.md -> Module
// 3 -> "Status" note: "a real PSD test fixture checked into the repo" — previously the
// PSD-decode path was only verified during development via a throwaway PSD built and
// round-tripped in-memory through ag-psd's own writePsd/readPsd, never committed).
//
// The fixture itself (`framed-wall-test.psd.b64`) was generated once via ag-psd's
// writePsd() from a plain JS layer-tree description, then base64-encoded — committed as
// base64 TEXT rather than a raw binary blob because this repo's file-editing tooling
// writes plain-text file content; base64 round-trips exactly and Buffer.from(..,
// 'base64') below decodes it back to the identical original bytes with no loss. Verified
// during generation by reading it back through readPsd() + this project's actual
// pureimage-backed canvas shim (psd-canvas.js's initializeCanvas hook, the same one
// mockup-generator.js uses at runtime) and confirming every layer's name, bounds, and
// pixel data decode correctly — not just that the write call succeeded.
//
// Document layout (12x10px canvas — deliberately tiny, see below):
//   - 'background'   — full-canvas opaque layer (0,0)-(12,10)
//   - 'artwork'      — the placement layer product-sizes.json's DEFAULT_PLACEMENT_LAYER
//                       ('artwork') expects by default: (2,2)-(10,8), i.e. 8x6px
//   - 'frame group'  — a nested group containing 'top border' (0,0)-(12,2), exercising
//                       findPlacementLayer()/flattenPaintOrder()'s group-recursion paths
//                       against a real decoded PSD, not just hand-built plain objects
//                       (already covered separately in psd-template.test.js).
//
// Kept intentionally tiny (not, say, a more realistic 800x1000px template): the base64
// text has to be transcribed exactly through this repo's file-editing tooling, and a
// larger fixture proved too easy to silently corrupt in transit (an earlier ~6KB/5900-
// char version landed with a single corrupted byte and failed every PSD-fixture test
// with ag-psd's "incorrect header check" zlib error). Every layer's pixel content is
// still exercised end-to-end; only the pixel counts are trivial.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Bounds of the fixture's 'artwork' placement layer, for tests that need to size a
 * matching-aspect-ratio source artwork (keeping computeMismatchRatio() at 0 so a test
 * doesn't accidentally trigger a real outpaint/Gemini call). */
export const PSD_FIXTURE = {
  documentWidth: 12,
  documentHeight: 10,
  placementLayerBounds: { left: 2, top: 2, width: 8, height: 6 },
};

/**
 * Decodes the committed fixture and writes it out as a real .psd file at `destPath`, for
 * tests that need an actual file on disk (composeMockup() reads templates via
 * fs.readFileSync, not from memory).
 * @param {string} destPath
 */
export function writePsdFixtureTo(destPath) {
  const b64Path = path.join(__dirname, 'framed-wall-test.psd.b64');
  const base64 = fs.readFileSync(b64Path, 'utf8').trim();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(base64, 'base64'));
}
