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

## 3. Resource leaks: fd leak confirmed in spawnBackend; watcher cleanup claim was overstated

**Files:** `electron/main.js` (`spawnBackend`), `backend/lib/taste-filter/watcher.js` (`_resetForTests`)

**Verified 2026-08-26:**

- **Confirmed real:** `spawnBackend()` opens the backend's log file descriptor synchronously via `fs.openSync(logPath, 'a')`, and only closes it inside the `child.on('spawn', ...)` handler. `spawn()`'s `'error'` event (bad command, `ENOENT`, `EACCES` — cases where the child process never actually launches) is mutually exclusive with `'spawn'` firing, so if the backend fails to spawn, `logFd` is never closed and leaks for the remaining life of the Electron process. Narrow in practice — it only triggers when the backend has already failed to start, a state the app already surfaces via `reportBackendStartupFailure()`'s error dialog, likely leading to an app restart anyway — but still a genuine, fixable leak.
- **Overstated:** the claim that watcher cleanup relies entirely on tests remembering to call `_resetForTests()`, risking flaky/EPERM test runs, doesn't hold up against the actual test suite. Every `describe` block in `watcher.test.js` reliably calls `_resetForTests()` in `afterEach` — there's no current flakiness pattern. And in production, `syncWatcherFromSettings()` already correctly closes the old chokidar watcher whenever settings change (`if (watcher && (!shouldRun || folderChanged)) { watcher.close(); ... }`), so there's no production leak either. The real (much smaller) risk is just that nothing *enforces* this cleanup for a future test author who might skip it — a maintainability note, not an active bug.

**Fix:** Wrap the `spawn()` call and its fd handling in `electron/main.js` in `try/finally` (or close `logFd` in the `'error'` handler too) to guarantee cleanup on a failed launch. No action needed for the watcher — current behavior is already correct.

## 4. Windows packaging workarounds (real, but already well-managed — see correction)

**Files:** `electron/main.js` (`spawnBackend`, `packagedBackendEnv`), `backend/scripts/bundle.js`, `.github/workflows/release.yml`, `ARCHITECTURE.md`

**Verified 2026-08-26:** the workarounds themselves are accurately described, but my "undocumented, no CI safety net" framing was wrong on both counts.

- `spawnBackend()` does target `resources/app.asar.unpacked/backend/dist` because `spawn()` can't resolve paths inside `app.asar` — confirmed, with a detailed explanatory comment in the code itself.
- `bundle.js` does inject CJS shims (`__dirname`, `__filename`, `require`) via an esbuild banner, since several bundled CJS deps (e.g. Jimp's plugins) reference `__dirname` internally and esbuild's ESM output doesn't provide it — confirmed.
- **Wrong:** "native module ABI mismatches (better-sqlite3 / onnxruntime-web)" as the reason for `startup.log`/`backend.log`. `better-sqlite3` no longer exists in this codebase at all — issue #104 replaced it with `node:sqlite` (a built-in, no native binary, no ABI to mismatch). `release.yml` explicitly confirms this: "A third layer -- requiring the better-sqlite3 native binary under Electron's Node ABI -- was removed once #104 replaced better-sqlite3 with node:sqlite, leaving no native module to verify." `onnxruntime-web` isn't a native-ABI risk either — it runs on WASM, not compiled bindings; its one real packaging issue (#114, fixed by #119) was a plain missing-dependency (`MODULE_NOT_FOUND`) from an incomplete `electron-builder` `files` list, not an ABI mismatch. The two log files exist for a broader reason: diagnosing *any* silent packaged-app startup failure (issue #97/#103), not specifically native-module ABI issues.
- **Wrong: "no documentation."** `ARCHITECTURE.md` already exists and is referenced extensively throughout the codebase (`README.md`, every CI workflow, `electron/main.js`) with a dedicated "Electron packaging — build sequence" section covering exactly this history and rationale.
- **Wrong: "no CI check."** `release.yml` already goes well beyond what I suggested. It doesn't just check a native module loads — it verifies the packaged asar contains the expected files (non-empty, syntax-checked), then **launches the actual packaged Windows exe**, polls its real `/api/health` endpoint from outside the process, confirms a real window appears, and captures screenshots + Windows Event Log entries + all app log files on any failure. This is more thorough than an ABI-load check would have been.

Net: the workarounds are real and inherently a bit fragile (that part of the original write-up stands), but the team has already built solid documentation and CI coverage around them. There's no gap to close here.

**Fix:** None needed. No action item.

## 5. Silent failure swallowing

**Files:** `backend/lib/mockup-generator.js` (`generateMockupForJob`), `backend/lib/pipeline-runner.js` (`runPendingModulesForJob`)

`generateMockupForJob()` cleans up generated files on error, but wraps the `fs.unlinkSync` cleanup call in an empty `catch {}` — so disk permission issues or leftover orphan files go completely unlogged.

`runPendingModulesForJob()` catches and records per-size failures in the mockup composer step, but overall module status reporting on partial failure could be clearer for diagnosing issues client-side.

**Fix:** At minimum, log cleanup failures instead of swallowing them silently. Improve pipeline status reporting to surface partial failures more clearly.
