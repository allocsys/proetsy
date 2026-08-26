# Known Issues / Tech Debt

Findings from a code review pass on 2026-08-26, verified directly against the code. Ordered by impact.

## 1. `withTransaction` has no savepoint support

**File:** `backend/db/init.js` (`withTransaction`)

`withTransaction(db, fn)` is a manual `db.exec('BEGIN')` / `COMMIT` / `ROLLBACK` wrapper around `node:sqlite`'s `DatabaseSync`, which has no built-in `db.transaction()` helper (unlike `better-sqlite3`, which this replaced in #104). It has no savepoint logic, so if it's ever called from inside another `withTransaction` call, the inner `BEGIN` will throw ("cannot start a transaction within a transaction").

No current call site nests two `withTransaction` calls (checked `store.js`, `jobs.js`, `config/index.js`, `listing-generator/index.js`), so this isn't an active bug today. But there's no structural protection against a future refactor introducing nesting, and no test guards against it.

**Fix:** Implement a savepoint-based nesting helper (`SAVEPOINT spX` / `RELEASE spX` / `ROLLBACK TO spX`) so `withTransaction` is safe to call from within itself.

## 2. `spawnBackend()` leaks a file descriptor on failed spawn

**File:** `electron/main.js` (`spawnBackend`)

The backend's log file descriptor is opened synchronously via `fs.openSync(logPath, 'a')` and only closed inside the `child.on('spawn', ...)` handler. `spawn()`'s `'error'` event (bad command, `ENOENT`, `EACCES` — cases where the child process never actually launches) is mutually exclusive with `'spawn'` firing, so if the backend fails to spawn, `logFd` is never closed and leaks for the remaining life of the Electron process.

**Fix:** Close `logFd` in the `'error'` handler too (or wrap the spawn + fd handling in `try/finally`).

## 3. Mockup cleanup failures aren't logged

**File:** `backend/lib/mockup-generator.js` (`generateMockupForJob`)

When a DB write fails after mockup files have already been written to disk, the function tries to delete those files and wraps the `fs.unlinkSync` cleanup in an empty `catch {}` — deliberately, per an existing comment, so a cleanup failure doesn't mask the original (re-thrown) DB error. But that means the cleanup failure itself goes completely unlogged, silently leaving an orphaned file on disk.

The same file already has a better pattern for this exact situation: `outpaintArtwork()`'s own temp-file cleanup logs via `console.warn` and increments a tracked `tempCleanupFailureCount`, surfaced through `/api/setup-status` once it crosses a threshold.

**Fix:** Add a `console.warn` in the cleanup `catch {}` block, mirroring `outpaintArtwork()`'s existing pattern. This surfaces the failure without risking masking the original re-thrown error.
