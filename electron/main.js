// Electron main process -- see ARCHITECTURE.md -> Suggested build order, step 6
// ("Electron packaging (Windows exe)") and its "Electron packaging -- build sequence"
// subsection for the full status/rationale. This file covers sub-steps 1 and 2 of that
// sequence: a skeleton that opens a BrowserWindow and spawns the existing Express
// backend (backend/server.js) as a child process -- Electron isn't replacing the app's
// existing process model (a Node backend + a React frontend talking to it over HTTP),
// just wrapping it in a native window instead of a browser tab -- plus packaged-mode
// support: loading the built frontend/dist bundle instead of a dev server, and pointing
// the backend's data directories at a writable per-user location instead of paths
// relative to the (read-only, once installed) app directory.
//
// Sub-step 3 (electron-builder config, root package.json's `build` key) and sub-step 4
// (better-sqlite3 native-module ABI handling, backendExecutable() below +
// `build.npmRebuild`) are both implemented. What issue #97 found is that "configured"
// and "actually loads on a clean machine" are different questions: the release CI's
// asar-verify step only checked that better_sqlite3.node was *present* after unpacking,
// not that it *loads* under Electron's ABI -- see release.yml's "Verify better-sqlite3
// loads under Electron's Node ABI" step, added for #97, which actually require()s it
// and runs a query.
//
// ESM, not CJS: Vitest's vi.mock() only intercepts static `import` statements (it
// rewrites them to check the mock registry); a literal require() call is never
// intercepted, regardless of dependency externalization settings. This file used to be
// CommonJS, which meant electron/main.test.js's vi.mock('electron'/'node:child_process'/
// 'node:http', ...) silently never took effect -- every "mocked" dependency was actually
// the real one. Root package.json now sets `"type": "module"` so this file (no local
// package.json of its own) parses as ESM.

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import electronUpdaterPkg from 'electron-updater';
const { autoUpdater } = electronUpdaterPkg;
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { get } from 'node:http';
import { fileURLToPath } from 'node:url';

// ESM has no CJS-style __dirname/__filename globals.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_PORT = process.env.PORT || 4000;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
// In dev, the frontend is Vite's own dev server (`npm run dev -w frontend`, default port
// 5173) for HMR -- start it separately, alongside this file, via root package.json's
// `electron:dev` script (uses `concurrently`, same pattern the existing `dev` script
// already uses for backend+frontend). ELECTRON_START_URL overrides this for testing
// against a different port/host. Packaged builds ignore this entirely -- see
// createWindow() below.
const DEV_FRONTEND_URL = process.env.ELECTRON_START_URL || 'http://localhost:5173';

let backendProcess = null;
let mainWindow;

// Packaged-mode data directories (sub-step 2). Dev mode leaves these unset so the
// backend falls back to its own existing defaults (backend/data/... resolved against
// the backend package root -- see backend/db/init.js, backend/server.js, and
// backend/lib/mockup-generator.js, all of which already support these exact env-var
// overrides). A packaged app's install directory (e.g. Program Files on Windows) isn't
// writable, so a packaged build needs its DB/uploads/mockups pointed at
// app.getPath('userData') instead -- Electron's standard per-OS, per-user, writable
// app-data location (e.g. %APPDATA%/proetsy on Windows).
//
// MOCKUP_TEMPLATES_DIR is deliberately NOT included here: mockup templates ship as part
// of the app bundle (ARCHITECTURE.md -> Module 3: "uses the user's own mockup files",
// configured via product-sizes.json), not written to at runtime the way the DB/uploads/
// generated-mockups directories are, so there's no writability problem to solve for it
// yet. Revisit if/when template management becomes dashboard-editable rather than
// config-file-edited (see Module 6's "product-sizes are shown read-only" status note).
export function packagedBackendEnv() {
  if (!app.isPackaged) return {};
  const userDataDir = app.getPath('userData');
  return {
    DB_PATH: path.join(userDataDir, 'data', 'proetsy.db'),
    ARTWORK_UPLOADS_DIR: path.join(userDataDir, 'data', 'uploads'),
    TASTE_FILTER_CANDIDATES_DIR: path.join(userDataDir, 'data', 'taste-filter'),
    MOCKUP_OUTPUT_DIR: path.join(userDataDir, 'data', 'mockups'),
    // The downloaded CLIP model (~350MB, fetched on first use by
    // backend/lib/taste-filter/embeddings.js) -- without this override it defaults to a
    // path inside the app's own install directory, which is read-only once packaged (e.g.
    // Program Files on Windows), so every download attempt would fail with a permissions
    // error instead of succeeding once and persisting like every other directory here.
    TASTE_FILTER_MODEL_PATH: path.join(userDataDir, 'models', 'clip-vit-base-patch32.onnx'),
  };
}

// Packaged-mode process strategy (sub-step 4). Dev mode spawns the backend via the
// system `node` binary -- simplest, and matches how the backend already runs under
// `npm run dev -w backend` / `npm start -w backend` outside Electron entirely, so no
// native-module rebuild is needed there (better-sqlite3 just runs against whatever
// system Node ABI is already on the dev machine). A packaged app can't assume a
// system-wide `node` binary exists on the target machine's PATH, so packaged mode
// instead spawns Electron's OWN bundled Node binary (`process.execPath`) with
// `ELECTRON_RUN_AS_NODE=1` set, which makes that child process behave like a plain Node
// process (no BrowserWindow/app APIs) running against Electron's bundled Node runtime --
// no external Node dependency for the end user. The tradeoff: better-sqlite3
// (backend/package.json) is a native module, and a native module must be compiled
// against the exact Node ABI that loads it, so it has to be rebuilt against *Electron's*
// ABI rather than left at whatever ABI a plain `npm install` originally built it
// against. package.json's `build.npmRebuild` (electron-builder config) handles this
// automatically via `@electron/rebuild` during packaging; `npm run electron:rebuild`
// (`electron-builder install-app-deps`) does the same rebuild on demand -- e.g. after
// changing backend dependencies -- without doing a full package build.
// NOT YET VERIFIED end-to-end on a real packaged build -- this is the standard,
// documented fix for this exact situation, wired up per electron-builder's own guidance,
// but nothing here has actually been packaged and run on a real machine yet.
export function backendExecutable() {
  if (!app.isPackaged) return { command: 'node', extraEnv: {} };
  return { command: process.execPath, extraEnv: { ELECTRON_RUN_AS_NODE: '1' } };
}

// Issue #97: a packaged build whose spawned backend crashes at startup (e.g. a native
// module ABI mismatch) previously left no trace anywhere reachable by someone who just
// double-clicked the exe -- spawnBackend() used `stdio: 'inherit'`, which only goes
// somewhere visible when Electron itself was launched from a terminal. In packaged
// mode, redirect the backend's stdout/stderr to a log file under
// app.getPath('userData') instead, so "why didn't anything happen" is answerable
// without attaching a debugger. Best-effort: if the log directory can't be created for
// any reason, this quietly falls back to no logging rather than taking down
// spawnBackend() over a diagnostics feature.
function ensureLogDir() {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    return logDir;
  } catch {
    return null;
  }
}

export function getBackendLogPath() {
  if (!app.isPackaged) return null;
  const logDir = ensureLogDir();
  return logDir ? path.join(logDir, 'backend.log') : null;
}

export function spawnBackend() {
  const backendDir = path.join(__dirname, '..', 'backend');
  const { command, extraEnv } = backendExecutable();

  let stdio = 'inherit';
  const logPath = getBackendLogPath();
  if (logPath) {
    try {
      const logStream = fs.createWriteStream(logPath, { flags: 'a' });
      logStream.write(`\n--- ProEtsy backend starting ${new Date().toISOString()} ---\n`);
      stdio = ['ignore', logStream, logStream];
    } catch {
      // Fall back to 'inherit' -- see ensureLogDir()'s comment above.
      stdio = 'inherit';
    }
  }

  const child = spawn(command, ['server.js'], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(BACKEND_PORT), ...packagedBackendEnv(), ...extraEnv },
    stdio,
  });
  child.on('exit', (code, signal) => {
    console.log(`[electron] backend process exited (code=${code}, signal=${signal})`);
    backendProcess = null;
  });
  return child;
}

// Polls the backend's existing GET /api/health route (backend/server.js already exposes
// this) until it responds, so the window isn't created/loaded against a backend that's
// still mid-startup (e.g. still running getDb()'s schema init or
// initRateLimitCache()'s rehydration). Same "fail loud, not silent" philosophy as
// ARCHITECTURE.md's First-Run Setup section -- if the backend never comes up, this
// rejects instead of leaving a blank window with no explanation.
export function waitForBackend(url, { timeoutMs = 20000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      function retry() {
        if (Date.now() > deadline) {
          reject(new Error(`Backend did not become healthy within ${timeoutMs}ms (${url})`));
          return;
        }
        setTimeout(attempt, intervalMs);
      }
    };
    attempt();
  });
}

// Single-instance lock (debug.md §2 candidate A / §4 planned fix #1). Must be requested
// before any window/backend spawning happens: if this returns false, a prior instance
// already holds the lock and this process should get out of the way immediately rather
// than going on to spawn a second backend against the same port -- that duplicate-
// backend spawn is the actual mechanism behind debug.md's reported "10 background
// processes". The 'second-instance' handler is what makes surviving that useful for the
// user, rather than just silently exiting a duplicate launch: it hands the *original*
// instance a chance to bring its own window to the front, so double-clicking the exe
// again while it's already starting up (a very natural reaction to "nothing happened
// yet") feels like "oh, there it is" instead of a no-op.
export function acquireSingleInstanceLock() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  return true;
}

// debug.md §2 candidate B / §4 planned fix #2: the previous behavior on a backend
// startup failure (timeout or otherwise) was `console.error(...)` + `app.quit()` --
// invisible to anyone not watching a terminal, so it looked exactly like "nothing
// happened" from the user's side. dialog.showErrorBox() is synchronous/native and needs
// no BrowserWindow to already exist, so it works even when createWindow() was never
// reached.
export function reportBackendStartupFailure(err) {
  const logPath = getBackendLogPath();
  const hint = logPath ? `\n\nBackend logs: ${logPath}` : '';
  dialog.showErrorBox('ProEtsy failed to start', `${err.message}${hint}`);
  app.quit();
}

// Rollout step 5 (plan.md -> "Electron: real native folder picker"): opens a native OS
// folder picker and returns the chosen path, or null if the user cancelled. Called via
// the 'select-folder' IPC channel below -- preload.js's window.mockupTemplatesAPI is
// the renderer-side bridge to it (contextIsolation stays on, so the renderer never
// gets direct access to `dialog` itself). Kept as its own exported function (rather than
// inlined into the ipcMain.handle call) so it's directly unit-testable, same as
// spawnBackend()/waitForBackend()/createWindow() above.
export async function selectFolder() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
}

// Registered unconditionally at module scope (not gated behind the isMainModule guard
// below) -- ipcMain.handle() only registers a callback, it doesn't touch the app
// lifecycle, so there's no harm in this running whenever the module loads (including
// under electron/main.test.js's vi.resetModules()-per-test import), and it means the
// renderer's 'select-folder' invoke always has a handler as soon as the module is
// loaded, dev or packaged, without needing its own spot in the whenReady() chain below.
ipcMain.handle('select-folder', selectFolder);

// Auto-update (release.yml already tags+publishes NSIS installers to GitHub Releases --
// this wires the packaged app up to that same feed via electron-updater's default
// GitHub provider, driven by root package.json's `build.publish` config rather than an
// explicit setFeedURL() call). Mirrors the folder-picker's own shape immediately above:
// a small set of directly-testable exported functions, an unconditional
// ipcMain.handle() registration per action, and events forwarded to the renderer over
// their own 'updater:*' channels -- see preload.js's `updaterAPI` bridge and
// App.jsx's update button for the renderer side.
//
// autoDownload is deliberately false: "auto update BUTTON" means the user drives it --
// checking happens without asking, but the (potentially large, metered-connection-
// unfriendly) download itself only starts on an explicit click, and install only
// happens on a second explicit click (quitAndInstall closes the app).
autoUpdater.autoDownload = false;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

autoUpdater.on('checking-for-update', () => sendToRenderer('updater:checking-for-update'));
autoUpdater.on('update-available', (info) => sendToRenderer('updater:update-available', info));
autoUpdater.on('update-not-available', (info) => sendToRenderer('updater:update-not-available', info));
autoUpdater.on('download-progress', (progress) => sendToRenderer('updater:download-progress', progress));
autoUpdater.on('update-downloaded', (info) => sendToRenderer('updater:update-downloaded', info));
autoUpdater.on('error', (err) => sendToRenderer('updater:error', err ? err.message : 'Unknown update error'));

// Dev mode has no `app-update.yml` (electron-builder only writes that into a packaged
// build) and no published feed to check against, so these short-circuit instead of
// letting autoUpdater throw a confusing "Cannot find latest.yml" error at a developer
// who wasn't asking for update behavior in the first place. The renderer-side button
// only renders when window.updaterAPI exists at all (same feature-detect convention as
// mockupTemplatesAPI), so in practice these dev-mode branches are mostly a safety net
// for direct calls (e.g. from a test or a stray IPC invoke), not the normal path.
export function checkForUpdates() {
  if (!app.isPackaged) return Promise.resolve({ skipped: true, reason: 'not packaged' });
  return autoUpdater.checkForUpdates();
}

export function downloadUpdate() {
  if (!app.isPackaged) return Promise.resolve({ skipped: true, reason: 'not packaged' });
  return autoUpdater.downloadUpdate();
}

export function quitAndInstall() {
  if (!app.isPackaged) return { skipped: true, reason: 'not packaged' };
  autoUpdater.quitAndInstall();
  return { skipped: false };
}

ipcMain.handle('check-for-updates', checkForUpdates);
ipcMain.handle('download-update', downloadUpdate);
ipcMain.handle('quit-and-install', quitAndInstall);

export async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Issue #97: previously an error thrown/rejected here (e.g. `frontend/dist/index.html`
  // missing from a bad package) propagated out of createWindow() uncaught by anything in
  // the isMainModule startup chain, leaving the backend + Electron helper processes
  // running with no window and no explanation. Now surfaced via the same
  // reportBackendStartupFailure() error dialog used for a failed backend startup.
  if (app.isPackaged) {
    // Loads the built frontend straight from disk (or transparently from inside the
    // asar archive -- Electron's loadFile/net stack understands asar paths natively, no
    // unpacking needed for static assets like these). Expects `frontend/dist` to sit
    // alongside `electron/` at the packaged app's root, mirroring this repo's own
    // layout (electron/ and frontend/ as siblings) -- sub-step 3's electron-builder
    // `files`/`extraResources` config is what actually needs to guarantee that layout
    // in the packaged output; nothing exists to enforce it yet, so this is the expected
    // contract that step still needs to satisfy, not a verified one.
    const indexHtml = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
    try {
      await mainWindow.loadFile(indexHtml);
    } catch (err) {
      reportBackendStartupFailure(new Error(`Failed to load app UI (${indexHtml}): ${err.message}`));
      return;
    }
  } else {
    await mainWindow.loadURL(DEV_FRONTEND_URL);
  }

  // Issue #97: a load that *resolves* (or a navigation after load) can still fail --
  // did-fail-load fires for those cases (e.g. a bad asar path that Electron's loader
  // doesn't reject loadFile()'s promise for) and render-process-gone fires if the
  // renderer crashes outright. Both previously left the window blank/gone with nothing
  // in Task Manager to explain why; both now go through the same error dialog.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED -- typically a benign redirect/cancel, not a real failure.
    reportBackendStartupFailure(
      new Error(`Failed to load ${validatedURL || 'app UI'}: ${errorDescription} (${errorCode})`)
    );
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    reportBackendStartupFailure(new Error(`Renderer process crashed (reason: ${details.reason})`));
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

export { BACKEND_PORT, BACKEND_URL, DEV_FRONTEND_URL };

// Only run the actual Electron app lifecycle when this file is executed directly as the
// app's entry point (`electron electron/main.js`, or via package.json's `main` field) --
// not when a test file imports it just to reach the exported helpers above. ESM has no
// `require.main === module` -- the equivalent here is comparing this file's own path to
// the path Node/Electron was actually launched with (process.argv[1]), which is set the
// same way for an ESM entry point as it is for a CJS one.
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  // Must happen before any backend/window spawning -- see acquireSingleInstanceLock()
  // above. A losing second instance already called app.quit() inside that function and
  // has nothing further to do here.
  if (acquireSingleInstanceLock()) {
    app.whenReady().then(async () => {
      backendProcess = spawnBackend();
      try {
        await waitForBackend(`${BACKEND_URL}/api/health`);
      } catch (err) {
        reportBackendStartupFailure(err);
        return;
      }
      try {
        await createWindow();
      } catch (err) {
        // Issue #97: createWindow() throwing synchronously (as opposed to the
        // did-fail-load/render-process-gone handlers registered inside it, which cover
        // failures *after* construction) is the last uncovered silent-failure path --
        // route it through the same error dialog rather than letting it propagate
        // uncaught out of this .then().
        reportBackendStartupFailure(err);
        return;
      }

      // Silent startup check -- only fires 'checking-for-update'/'update-available'/etc.
      // events to the renderer (see above); never auto-downloads (autoDownload is false).
      // Swallowed rather than surfaced as a startup failure: no network / no publish feed
      // yet / GitHub rate-limited should never block the app from opening, the update
      // button in the renderer already surfaces its own 'updater:error' event for a
      // user-triggered check.
      checkForUpdates().catch(() => {});

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });

    // Make sure the spawned backend doesn't outlive the Electron app -- without this,
    // closing the window/quitting would leave an orphaned `node server.js` process (and
    // its bound port) running in the background.
    app.on('before-quit', () => {
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill();
      }
    });
  }
}
