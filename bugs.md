# Known Issues / Tech Debt

Findings from a code review pass on 2026-08-26. Ordered by impact, most important first.

## 1. Transaction nesting bug (correctness risk)

**Files:** `backend/db/init.js` (`withTransaction`), `backend/lib/taste-filter/store.js` (`recomputeCentroids`)

`withTransaction` wraps `node:sqlite`'s `DatabaseSync` in a manual `BEGIN`/`COMMIT`/`ROLLBACK` block. SQLite does not support nesting these statements without savepoints — if any code path calls `withTransaction` from inside another `withTransaction`, it will throw or leave the database in an inconsistent state.

`recomputeCentroids()` in `store.js` runs multi-statement update/insert work per category inside a single transaction, which is exactly the kind of call site that's at risk if it (directly or indirectly) triggers a nested transaction.

**Fix:** Implement a savepoint-based nesting helper (`SAVEPOINT spX` / `RELEASE spX` / `ROLLBACK TO spX`) so `withTransaction` is safe to call from within itself.

## 2. Blocking / heavy work on startup or first request

**Files:** `backend/lib/taste-filter/embeddings.js` (`ensureModelReady`, `getSession`), `backend/server.js` (boot sequence)

`ensureModelReady()` downloads the CLIP vision model (~350MB) via `fetch()` on first use. Even though it's async, triggering this implicitly on first request (or at startup) can cause request timeouts or memory pressure on constrained hosts.

`backend/server.js` also runs `syncWatcherFromSettings()` and `initRateLimitCache()` synchronously during boot. With a large watched folder, `chokidar`'s recursive scan can delay the server binding its port.

**Fix:** Defer model downloads and heavy watcher initialization until after `/api/health` passes and the server is listening, rather than doing this at import/module-load time.

## 3. Resource leaks (file descriptors, watchers)

**Files:** `electron/main.js` (`spawnBackend`), `backend/lib/taste-filter/watcher.js` (`_resetForTests`)

`spawnBackend()` opens a log file descriptor via `fs.openSync(logPath, 'a')` and only closes it in the `spawn` event handler. If the child process fails to spawn or errors before `spawn` fires, the fd leaks.

`watcher.js` keeps a module-level chokidar watcher and relies entirely on tests manually calling `_resetForTests()` to close it. Concurrent or careless test runs leave watchers open, holding OS file handles — a likely source of flaky tests and EPERM errors on Windows.

**Fix:** Wrap process spawning in `try/finally` to guarantee fd cleanup. Give watcher modules a proper lifecycle hook / process-exit cleanup instead of relying on test-only reset functions.

## 4. Windows packaging workarounds (tech debt from #110/#118/#119)

**Files:** `electron/main.js` (`spawnBackend`, `packagedBackendEnv`), `backend/scripts/bundle.js`

The recent esbuild-bundling + `node:sqlite` migration work (to fix Windows install/perf issues) introduced several fragile, undocumented workarounds:

- `spawnBackend` has to explicitly target `resources/app.asar.unpacked/backend/dist` because `spawn()` can't resolve paths inside `app.asar`.
- `bundle.js` injects CJS shims (`__dirname`, `require`) via an esbuild banner to make the bundle work under Electron's runtime.
- Multiple log files (`startup.log`, `backend.log`) exist specifically to debug silent crashes from native module ABI mismatches (`better-sqlite3` / `onnxruntime-web`).

None of this is wrong, but it's fragile glue with no documentation, and easy to break silently in future changes.

**Fix:** Document the ABI requirements and build/packaging steps in an `ARCHITECTURE.md`. Add a CI check that verifies native modules actually load under Electron's Node ABI before shipping a build artifact.

## 5. Silent failure swallowing

**Files:** `backend/lib/mockup-generator.js` (`generateMockupForJob`), `backend/lib/pipeline-runner.js` (`runPendingModulesForJob`)

`generateMockupForJob()` cleans up generated files on error, but wraps the `fs.unlinkSync` cleanup call in an empty `catch {}` — so disk permission issues or leftover orphan files go completely unlogged.

`runPendingModulesForJob()` catches and records per-size failures in the mockup composer step, but overall module status reporting on partial failure could be clearer for diagnosing issues client-side.

**Fix:** At minimum, log cleanup failures instead of swallowing them silently. Improve pipeline status reporting to surface partial failures more clearly.
