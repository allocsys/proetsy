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
// Sub-step 3 (electron-builder config) and sub-step 4 (better-sqlite3 native-module ABI
// handling for a packaged build) are NOT done yet -- see the "Known gap" comment near
// spawnBackend(). Without sub-step 4, a packaged build's spawned backend will fail at
// require-time on better-sqlite3, even though the paths/loading logic here is otherwise
// ready for it.

const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

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
let mainWindow = null;

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
function packagedBackendEnv() {
  if (!app.isPackaged) return {};
  const userDataDir = app.getPath('userData');
  return {
    DB_PATH: path.join(userDataDir, 'data', 'proetsy.db'),
    ARTWORK_UPLOADS_DIR: path.join(userDataDir, 'data', 'uploads'),
    TASTE_FILTER_CANDIDATES_DIR: path.join(userDataDir, 'data', 'taste-filter'),
    MOCKUP_OUTPUT_DIR: path.join(userDataDir, 'data', 'mockups'),
  };
}

// Known gap (packaged-mode, build-sequence sub-step 3/4, not solved here): a packaged
// app can't assume a system-wide `node` binary is on the target machine's PATH, and
// better-sqlite3 (backend/package.json) is a native module that must be built against
// Electron's own Node ABI when it's required from inside an Electron-spawned process --
// neither of those is solved here. Spawning via the system `node` binary is the right
// approach for local dev, where the backend already runs this exact same way via
// `npm run dev -w backend` / `npm start -w backend`, and is deliberately NOT yet the
// packaged-app strategy. The standard fix when sub-steps 3/4 land is spawning via
// `process.execPath` with `ELECTRON_RUN_AS_NODE=1` (Electron's own bundled Node) instead
// of relying on a system `node`, plus rebuilding better-sqlite3 against Electron's ABI
// via `@electron/rebuild` as part of the electron-builder packaging step.
function spawnBackend() {
  const backendDir = path.join(__dirname, '..', 'backend');
  const child = spawn('node', ['server.js'], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(BACKEND_PORT), ...packagedBackendEnv() },
    stdio: 'inherit',
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
function waitForBackend(url, { timeoutMs = 20000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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
    await mainWindow.loadFile(indexHtml);
  } else {
    await mainWindow.loadURL(DEV_FRONTEND_URL);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  backendProcess = spawnBackend();
  try {
    await waitForBackend(`${BACKEND_URL}/api/health`);
  } catch (err) {
    console.error(`[electron] ${err.message}`);
    app.quit();
    return;
  }
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Make sure the spawned backend doesn't outlive the Electron app -- without this, closing
// the window/quitting would leave an orphaned `node server.js` process (and its bound
// port) running in the background.
app.on('before-quit', () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
