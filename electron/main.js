// Electron main process -- see ARCHITECTURE.md -> Suggested build order, step 6
// ("Electron packaging (Windows exe)") and its "Electron packaging -- build sequence"
// subsection for the full status/rationale. This file is sub-step 1 of that sequence: a
// skeleton that opens a BrowserWindow and spawns the existing Express backend
// (backend/server.js) as a child process -- Electron isn't replacing the app's existing
// process model (a Node backend + a React frontend talking to it over HTTP), just
// wrapping it in a native window instead of a browser tab.
//
// Dev-mode only for now. Packaged-mode loading of the built frontend/dist bundle (and
// the native-module ABI handling that packaging needs -- see the "Known gap" comment
// near spawnBackend()) is sub-step 2, not built here.

const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const BACKEND_PORT = process.env.PORT || 4000;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
// In dev, the frontend is Vite's own dev server (`npm run dev -w frontend`, default port
// 5173) for HMR -- start it separately, alongside this file, via root package.json's new
// `electron:dev` script (uses `concurrently`, same pattern the existing `dev` script
// already uses for backend+frontend). ELECTRON_START_URL overrides this for testing
// against a different port/host.
const DEV_FRONTEND_URL = process.env.ELECTRON_START_URL || 'http://localhost:5173';

let backendProcess = null;
let mainWindow = null;

// Known gap (packaged-mode, build-sequence sub-step 2/3, not this step): a packaged app
// can't assume a system-wide `node` binary is on the target machine's PATH, and
// better-sqlite3 (backend/package.json) is a native module that must be built against
// Electron's own Node ABI when it's required from inside an Electron-spawned process --
// neither of those is solved here. Spawning via the system `node` binary is the right
// approach for local dev, where the backend already runs this exact same way via
// `npm run dev -w backend` / `npm start -w backend`, and is deliberately NOT yet the
// packaged-app strategy. The standard fix when sub-steps 2/3 land is spawning via
// `process.execPath` with `ELECTRON_RUN_AS_NODE=1` (Electron's own bundled Node) instead
// of relying on a system `node`, plus rebuilding better-sqlite3 against Electron's ABI
// via `@electron/rebuild` as part of the electron-builder packaging step.
function spawnBackend() {
  const backendDir = path.join(__dirname, '..', 'backend');
  const child = spawn('node', ['server.js'], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(BACKEND_PORT) },
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
    // Sub-step 2 (not built yet): load frontend/dist's built index.html from packaged
    // resources instead of a dev server. Failing loudly here rather than silently
    // pointing a packaged build at localhost:5173 -- which would just show a blank
    // window with no explanation once electron-builder packaging (sub-step 3) exists.
    throw new Error(
      'Packaged-mode frontend loading is not implemented yet (ARCHITECTURE.md -> ' +
        'Electron packaging -- build sequence, sub-step 2). This main process only ' +
        'supports dev mode today.'
    );
  }

  await mainWindow.loadURL(DEV_FRONTEND_URL);
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
