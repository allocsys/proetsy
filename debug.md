# Debug log — Windows install: installer prompts for C:\ dir, then clicking the app does nothing but spawns background processes

Reported symptom: on Windows, the NSIS installer prompts to choose an install
directory under `C:\...`; after installing, clicking the app produces no visible
window, but ~10 processes show up in the background.

## 1. The C:\ install-directory prompt — not a bug

`package.json`'s `build.nsis` config sets:

```json
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true
}
```

`oneClick: false` + `allowToChangeInstallationDirectory: true` is what makes NSIS show
the "choose install location" page (default suggestion is typically under
`C:\Users\<user>\AppData\Local\Programs\ProEtsy` or `Program Files`, but the user can
browse elsewhere). This is expected installer behavior, not a symptom of anything
broken.

## 2. "Nothing happens, but background processes appear"

### Root cause candidate A (most likely) — no single-instance lock

`electron/main.js` never calls `app.requestSingleInstanceLock()`. Startup sequence:

1. `app.whenReady()` → `spawnBackend()` spawns the Node backend as a child process
   bound to `PORT` (default 4000).
2. `waitForBackend()` polls `GET /api/health` for up to 20s (`timeoutMs: 20000`).
3. Only once that resolves does `createWindow()` run and a window appear.
4. If `waitForBackend()` times out, the code does `console.error(...)` and
   `app.quit()` — **silently**, no dialog shown to the user.

If the first launch is still inside that up-to-20s window (or a window did open but
off-screen/behind other windows) and the user clicks the exe again — which is a very
natural reaction to "nothing happened" — Windows launches a **second, fully separate
instance**. That second instance spawns its *own* backend child process, which tries
to bind the same port 4000 already held by the first instance's backend, fails
(`EADDRINUSE`), health-check never succeeds, and that instance times out and quits
too — again silently. Each additional click compounds more orphaned/short-lived
processes without ever producing a visible window. This matches the reported "10
background processes, nothing visible."

### Root cause candidate B — slow first-run backend startup exceeding the 20s timeout

The bundled backend does SQLite schema init (`backend/db/init.js`) and loads
`onnxruntime-web` on first run. On a slower disk/first run this could plausibly
exceed the hardcoded 20s `waitForBackend` timeout, causing the same silent
`app.quit()` path as above — no error dialog, so it looks like nothing happened even
with only one instance running.

### Root cause candidate C — SmartScreen / unsigned installer

The installer is unsigned (`ARCHITECTURE.md` → Open Discussions → "Unsigned Windows
exe / SmartScreen"). Release notes tell users to click "More info → Run anyway" on
first launch. If a user's Defender/AV config silently blocks or quarantines instead of
prompting, the app may fail to run at all. Worth ruling out but doesn't by itself
explain 10 background processes.

### Ruled out — the packaged backend itself (better-sqlite3 / missing deps)

`ARCHITECTURE.md`'s "Electron packaging — build sequence" documents CI runs #1–#6
tracking down and fixing exactly this class of failure (root `package.json` missing a
`dependencies` block so electron-builder's production-dependency walk didn't discover
backend's runtime deps; `better-sqlite3` ABI mismatch against Electron's Node version).
Run #6 (workflow_dispatch, commit `276e20e`) confirmed via an asar-inspection CI step
that `better-sqlite3` (and, by the same fix, the rest of backend's deps) are correctly
present in `app.asar` and unpacked at `app.asar.unpacked`. The published `v0.1.0`
release (run #7, commit `2639c4f`) has an identical `package.json` to the verified
commit, so the packaged backend itself is not expected to be missing dependencies or
failing to `require()` at startup.

## 3. How to confirm which candidate, on the affected Windows machine

- Task Manager: check for **multiple** `ProEtsy.exe` / `electron.exe` process groups
  (as opposed to one instance's normal Chromium helper-process footprint — GPU,
  network service, crashpad, 1–2 renderers — which is itself normally ~6–9 processes
  for a single instance and is not by itself a sign of a bug).
- `netstat -ano | findstr :4000` — reveals whether something is already bound to the
  backend's port from a stuck earlier launch.
- Launch via `cmd.exe` instead of double-clicking, to see
  `[electron] backend process exited (code=..., signal=...)` or the
  `waitForBackend` timeout error printed to console instead of disappearing silently.
- Check whether SmartScreen showed a warning dialog on first run and whether "Run
  anyway" was clicked.

## 4. Planned fix (not yet applied)

Two changes to `electron/main.js`:

1. Add `app.requestSingleInstanceLock()` near the top of the file; if a second
   instance launches while one is already running, focus/restore the existing
   window instead of spawning a duplicate backend+window stack.
2. Replace the silent `app.quit()` in `waitForBackend`'s catch block with
   `dialog.showErrorBox(...)` (or similar user-visible feedback) so a startup
   failure is visible instead of looking like a no-op.
