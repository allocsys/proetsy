
# Plan: Replace better-sqlite3 with node:sqlite (#104)

Spike verified against Node v22.22.2 (proxy for Electron 35's bundled Node) — see
comment on #104 for full spike output. Summary: most of the API surface is a drop-in
match; two call sites need real code changes, not just a dependency swap.

## Spike findings (already confirmed, no need to re-verify)

**Works unchanged:** `.exec()`, `.prepare()`, `.run()`, `.get()`, `.all()`, `@name`
named-parameter binding, window functions (`ROW_NUMBER() OVER (PARTITION BY ...)`),
`ON CONFLICT ... DO UPDATE` upserts, `ALTER TABLE ADD COLUMN` + the "duplicate column"
error-message check, and BLOB round-trip for the Float32Array embedding vectors (BLOBs
come back as `Uint8Array` instead of `Buffer`, but `blobToVector()`'s slice logic works
unchanged since both have `.buffer`/`.byteOffset`/`.byteLength`).

**Needs a code change:**
1. No `.pragma()` method — `db.pragma('journal_mode = WAL')` must become
   `db.exec('PRAGMA journal_mode = WAL')`.
2. No `db.transaction()` — needs a manual `BEGIN`/`COMMIT`/`ROLLBACK` wrapper.
   Confirmed a small wrapper reproduces identical commit/rollback behavior, including
   correct rollback on a mid-transaction throw.

**Note:** `node:sqlite` prints an `ExperimentalWarning` to stderr on every run. Relevant
to #103, whose diagnostic assumed an empty stderr — don't let this warning be
mistaken for a new failure signal there.

## Steps (do in order)

1. **Branch:** `fix/104-node-sqlite-migration` off default branch.
2. **`backend/db/init.js`:** swap `import Database from 'better-sqlite3'` for
   `import { DatabaseSync } from 'node:sqlite'`; replace `new Database(DB_PATH)` with
   `new DatabaseSync(DB_PATH)`; replace both `db.pragma(...)` calls with
   `db.exec('PRAGMA ...')`.
3. **`backend/lib/taste-filter/store.js`:** add a small `withTransaction(db, fn)` helper
   (`BEGIN` / `COMMIT` / `ROLLBACK` on throw) and use it in place of `db.transaction()`
   in `recomputeCentroids()`, `recomputePromptTerms()`, and `adjustPromptTermCounts()`'s
   inner `run`. Update the JSDoc `@param {import('better-sqlite3').Database} db` type
   reference in `prompt-helper/index.js` to `node:sqlite`'s `DatabaseSync`.
4. **Run the existing test suite** (`npm run test:electron`, `npm run test -w backend`)
   against the branch — `init.js`, `init.test.js`, and `store.js`'s callers
   (`taste-filter` tests) are the ones that touch the DB layer directly.
5. **If clean:** remove `better-sqlite3` from `backend/package.json` and root
   `package.json` dependencies.
6. **`package.json` build config cleanup:** remove `asarUnpack` entry for
   `better-sqlite3`, confirm `npmRebuild: false` is now moot (no native module left to
   rebuild) and remove it if so.
7. **`release.yml` cleanup:** remove the `better-sqlite3`-specific rebuild/verification
   steps this whole saga (#97) added — the asar native-binary path check, the
   `ELECTRON_JOB_NODE_VERSION` pin, and the Windows Build Tools install step — since
   there's no native module left to rebuild or verify.
8. **Re-run release CI** on the branch to confirm: fewer steps, no native-module
   failures, and the packaged exe still passes the "Launch packaged app and verify
   health check + window" check from #97/#103.
9. **Open PR**, referencing #104 and noting #103 is separate and not expected to be
   fixed by this change.

## Explicitly out of scope here
- #103's zero-output-before-spawnBackend() investigation — separate issue, separate fix.
- Any data-migration concern for existing user DBs — same underlying SQLite file format,
  not expected to need one, but worth a quick sanity check with a real `proetsy.db` file
  during step 4 rather than only `:memory:` spikes.
