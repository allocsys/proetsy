# Known Issues / Tech Debt

Findings from a code review pass on 2026-08-26. Ordered by impact, most important first.

## 1. Transaction nesting has no savepoint support (latent risk, not currently triggered)

**Files:** `backend/db/init.js` (`withTransaction`)

**Verified 2026-08-26:** `withTransaction(db, fn)` is a manual `db.exec('BEGIN')` / `COMMIT` / `ROLLBACK` wrapper, with no savepoint logic. `node:sqlite`'s `DatabaseSync` has no built-in `db.transaction()` helper (unlike `better-sqlite3`), so this was written as a replacement during the #104 migration. If it's ever called from inside another `withTransaction` call, the inner `BEGIN` will throw ("cannot start a transaction within a transaction").

I checked every current call site — `store.js` (`recomputeCentroids`, `tallyPromptTermsForLabel`, `recomputePromptTerms`), `jobs.js` (`createJob`, `createJobsBulk`), `config/index.js` (`migratePipelineConfigSeed`, `importAllConfig`, `setShopConventions`), and `listing-generator/index.js` (`generateListingsForJob`) — and **none of them currently nest a `withTransaction` call inside another one**. Each opens exactly one transaction and doesn't call another `withTransaction`-wrapped function from within it. So this is not an active bug today; the database behaves correctly as of this review.

The risk is structural: there's no protection against a future refactor introducing nesting, and no test guards against it. It'll fail loudly (an unhandled throw) rather than silently corrupting data, which limits the blast radius, but it'll still take down whichever request triggers it.

**Fix:** Implement a savepoint-based nesting helper (`SAVEPOINT spX` / `RELEASE spX` / `ROLLBACK TO spX`) so `withTransaction` is safe to call from within itself, even though nothing currently requires it.

## 2. Blocking / heavy work on startup or first request (mostly not true — see correction)

**Files:** `backend/lib/taste-filter/embeddings.js` (`ensureModelReady`, `getSession`), `backend/server.js` (boot sequence), `backend/lib/taste-filter/watcher.js`, `backend/lib/llm/rate-limits.js`

**Verified 2026-08-26:** most of the original claim here was wrong. Correcting it:

- **Model download is NOT blocking.** `ensureModelReady()` (the ~350MB CLIP model fetch) is explicitly fire-and-forget in `server.js`, kicked off *alongside* (not before) `app.listen()` — there's a code comment confirming this was a deliberate design choice: "Taste Filter is one module among many, and a download/disk failure here shouldn't take down job/listing/mockup routes." A failure is logged, not thrown, and the port binds regardless. `embedImage()` also calls `ensureModelReady()` itself on first real use, so a boot-time failure just means the first import request retries the download — it doesn't stall a request or crash the process.
- **The watcher does NOT do a recursive scan.** `syncWatcherFromSettings()` does run synchronously before `app.listen()`, but `chokidar.watch()` itself is non-blocking (hands off to async fs internally) and is configured with `depth: 0` — it only watches the top-level folder, not subfolders. A folder with thousands of files does not cause a deep synchronous scan.
- **`initRateLimitCache()` is real but trivial.** It does run a synchronous SQL query (`SELECT ... FROM llm_rate_limits`) before the port binds, but it's a small table read, not a meaningful delay.

Net: there's no actual blocking/heavy-startup problem here. The one real (very minor) item is that `initRateLimitCache()` and `syncWatcherFromSettings()` both add a small amount of synchronous DB work to boot before `app.listen()`, but neither is a performance concern at realistic data sizes.

**Fix:** None needed. No action item.

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
