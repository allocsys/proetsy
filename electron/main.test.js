import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { EventEmitter } from 'node:events';

// electron/main.js does `const { app, BrowserWindow } = require('electron');` at module
// scope, so the mock below is what both main.js's internals AND this test file see --
// mutating `mockApp.isPackaged` from a test affects what the exported helpers read too,
// since it's the same object identity coming out of vi.mock's module cache.
const mockApp = {
  isPackaged: false,
  getPath: vi.fn(() => '/fake/userData'),
  whenReady: vi.fn(),
  on: vi.fn(),
  quit: vi.fn(),
  exit: vi.fn(),
  // Regression coverage for debug.md's "no single-instance lock" root-cause candidate:
  // defaults to granting the lock (true) so existing tests that don't care about this
  // behavior aren't affected; individual tests below override this to simulate a
  // second instance losing the race.
  requestSingleInstanceLock: vi.fn(() => true),
};

const mockBrowserWindowInstance = {
  loadFile: vi.fn().mockResolvedValue(undefined),
  loadURL: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  // on: regression coverage for issue #97's did-fail-load/render-process-gone handlers.
  webContents: { send: vi.fn(), on: vi.fn() },
  isDestroyed: vi.fn(() => false),
};
// A plain function expression, not an arrow function -- arrow functions are never
// constructible, and vi.fn's `construct` trap (used when this mock is invoked via
// `new BrowserWindow(...)`) calls the implementation via Reflect.construct, which
// throws "X is not a constructor" on an arrow function regardless of mocking.
const MockBrowserWindow = vi.fn(function BrowserWindowMock() {
  return mockBrowserWindowInstance;
});
MockBrowserWindow.getAllWindows = vi.fn(() => []);

// Rollout step 5: mocks for the select-folder IPC handler -- ipcMain.handle just needs
// to be a no-op vi.fn() here (main.js calls it unconditionally at module scope), and
// dialog.showOpenDialog is the one main.js's exported selectFolder() actually calls.
const mockIpcMain = { handle: vi.fn() };
// showErrorBox: regression coverage for debug.md's "silent app.quit() on backend
// startup timeout" root-cause candidate -- currently nothing in main.js calls this.
const mockDialog = { showOpenDialog: vi.fn(), showErrorBox: vi.fn() };

vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: MockBrowserWindow,
  ipcMain: mockIpcMain,
  dialog: mockDialog,
}));

// Auto-update: a real EventEmitter (not a plain vi.fn() object) so main.js's
// `autoUpdater.on('checking-for-update', ...)`-style wiring at module scope attaches
// real listeners this test file can then `.emit()` against, the same way the real
// electron-updater package's autoUpdater does. Kept as ONE persistent object across
// tests (mirroring mockApp/mockBrowserWindowInstance's own singleton-mock pattern) --
// vi.resetModules() re-executes main.js's module-scope `.on()` calls on every import,
// so beforeEach below must call removeAllListeners() first or listeners would pile up
// test over test.
const mockAutoUpdater = new EventEmitter();
mockAutoUpdater.autoDownload = true;
mockAutoUpdater.checkForUpdates = vi.fn(() => Promise.resolve({}));
mockAutoUpdater.downloadUpdate = vi.fn(() => Promise.resolve({}));
mockAutoUpdater.quitAndInstall = vi.fn();

vi.mock('electron-updater', () => ({ default: { autoUpdater: mockAutoUpdater } }));

// Fake child process: enough of Node's ChildProcess surface (an EventEmitter with
// .killed) for spawnBackend()'s own `.on('exit', ...)` wiring to attach without error.
function makeFakeChild() {
  const child = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn();
  return child;
}

const spawnMock = vi.fn(() => makeFakeChild());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const httpGetMock = vi.fn();
vi.mock('node:http', () => ({ get: httpGetMock }));

let main;

beforeEach(async () => {
  vi.resetModules();
  mockApp.isPackaged = false;
  // process.resourcesPath is a real global Electron injects into the process at
  // runtime (used by spawnBackend() to find the asarUnpack'd backend/ dir when
  // packaged) -- it does not exist under plain Node, which is what Vitest actually
  // runs under, so left unset it's `undefined` here rather than merely "unmocked".
  // Stubbed the same way the rest of this file stubs Electron's other injected
  // surface (mockApp, mockBrowserWindow, ...); restored in afterEach.
  process.resourcesPath = '/fake/resources';
  mockApp.getPath.mockClear().mockReturnValue('/fake/userData');
  mockApp.quit.mockClear();
  mockApp.exit.mockClear();
  mockApp.on.mockClear();
  mockApp.requestSingleInstanceLock.mockClear().mockReturnValue(true);
  mockDialog.showErrorBox.mockReset();
  spawnMock.mockClear();
  httpGetMock.mockReset();
  MockBrowserWindow.mockClear();
  mockBrowserWindowInstance.loadFile.mockClear();
  mockBrowserWindowInstance.loadURL.mockClear();
  mockBrowserWindowInstance.webContents.send.mockClear();
  mockBrowserWindowInstance.webContents.on.mockClear();
  mockBrowserWindowInstance.loadFile.mockReset().mockResolvedValue(undefined);
  mockBrowserWindowInstance.isDestroyed.mockReset().mockReturnValue(false);
  mockIpcMain.handle.mockClear();
  mockDialog.showOpenDialog.mockReset();
  mockAutoUpdater.removeAllListeners();
  mockAutoUpdater.checkForUpdates.mockClear().mockResolvedValue({});
  mockAutoUpdater.downloadUpdate.mockClear().mockResolvedValue({});
  mockAutoUpdater.quitAndInstall.mockClear();
  main = await import('./main.js');
});

afterEach(() => {
  vi.useRealTimers();
  delete process.resourcesPath;
});

describe('packagedBackendEnv', () => {
  it('returns {} in dev mode (backend keeps its own existing path defaults)', () => {
    mockApp.isPackaged = false;
    expect(main.packagedBackendEnv()).toEqual({});
  });

  it('points DB/uploads/taste-filter/mockup dirs at app.getPath("userData") when packaged', () => {
    mockApp.isPackaged = true;
    mockApp.getPath.mockReturnValue('/fake/userData');

    const env = main.packagedBackendEnv();

    expect(env.DB_PATH).toBe(path.join('/fake/userData', 'data', 'proetsy.db'));
    expect(env.ARTWORK_UPLOADS_DIR).toBe(path.join('/fake/userData', 'data', 'uploads'));
    expect(env.TASTE_FILTER_CANDIDATES_DIR).toBe(path.join('/fake/userData', 'data', 'taste-filter'));
    expect(env.MOCKUP_OUTPUT_DIR).toBe(path.join('/fake/userData', 'data', 'mockups'));
  });

  it('points the Taste Filter CLIP model at userData/models when packaged (install dir is read-only)', () => {
    mockApp.isPackaged = true;
    mockApp.getPath.mockReturnValue('/fake/userData');

    const env = main.packagedBackendEnv();

    expect(env.TASTE_FILTER_MODEL_PATH).toBe(
      path.join('/fake/userData', 'models', 'clip-vit-base-patch32.onnx')
    );
  });

  it('never includes MOCKUP_TEMPLATES_DIR -- templates ship with the app, not written at runtime', () => {
    mockApp.isPackaged = true;
    expect(main.packagedBackendEnv()).not.toHaveProperty('MOCKUP_TEMPLATES_DIR');
  });
});

describe('backendExecutable', () => {
  it('spawns via the system node binary with no extra env in dev mode', () => {
    mockApp.isPackaged = false;
    expect(main.backendExecutable()).toEqual({ command: 'node', extraEnv: {} });
  });

  it('spawns via Electron\'s own bundled Node with ELECTRON_RUN_AS_NODE=1 when packaged', () => {
    mockApp.isPackaged = true;
    expect(main.backendExecutable()).toEqual({
      command: process.execPath,
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });
});

describe('spawnBackend', () => {
  it('spawns "node server.js" against the backend dir in dev mode', () => {
    mockApp.isPackaged = false;
    main.spawnBackend();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe('node');
    expect(args).toEqual(['server.js']);
    expect(options.cwd).toBe(path.join(__dirname, '..', 'backend'));
    expect(options.env.PORT).toBe(String(main.BACKEND_PORT));
    // Dev mode: no packaged-only env vars merged in.
    expect(options.env.DB_PATH).toBeUndefined();
  });

  it('spawns via process.execPath with packaged env + ELECTRON_RUN_AS_NODE when packaged', () => {
    mockApp.isPackaged = true;
    mockApp.getPath.mockReturnValue('/fake/userData');
    main.spawnBackend();

    const [command, , options] = spawnMock.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(options.env.DB_PATH).toBe(path.join('/fake/userData', 'data', 'proetsy.db'));
  });

  // Regression coverage for the ENOENT root-caused in release CI run #64: backend/ is
  // packed into app.asar (package.json's `files`) but also unpacked onto real disk via
  // `asarUnpack`, at resources/app.asar.unpacked/backend -- cwd must point at that real
  // path, not the __dirname-relative one, which resolves *inside* app.asar and isn't
  // usable by spawn()'s underlying OS process-creation call.
  it('uses the asarUnpack destination (resourcesPath/app.asar.unpacked/backend) as cwd when packaged', () => {
    mockApp.isPackaged = true;
    process.resourcesPath = '/fake/resources';
    main.spawnBackend();

    const [, , options] = spawnMock.mock.calls[0];
    expect(options.cwd).toBe(path.join('/fake/resources', 'app.asar.unpacked', 'backend'));
  });

  it('registers an exit handler on the spawned child without throwing', () => {
    mockApp.isPackaged = false;
    const child = main.spawnBackend();
    expect(() => child.emit('exit', 0, null)).not.toThrow();
  });
});

describe('waitForBackend', () => {
  function respondOnce(statusCode) {
    httpGetMock.mockImplementationOnce((_url, cb) => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.resume = vi.fn();
      cb(res);
      return new EventEmitter();
    });
  }

  function errorOnce() {
    httpGetMock.mockImplementationOnce(() => {
      const req = new EventEmitter();
      // Fire the error on the next tick so the caller has a chance to attach its
      // `.on('error', ...)` handler first (mirrors how a real ClientRequest behaves).
      setTimeout(() => req.emit('error', new Error('ECONNREFUSED')), 0);
      return req;
    });
  }

  it('resolves as soon as a 200 response comes back', async () => {
    respondOnce(200);
    await expect(main.waitForBackend('http://localhost:4000/api/health')).resolves.toBeUndefined();
    expect(httpGetMock).toHaveBeenCalledTimes(1);
  });

  it('retries through non-200 responses until one succeeds', async () => {
    respondOnce(503);
    respondOnce(200);
    await expect(
      main.waitForBackend('http://localhost:4000/api/health', { intervalMs: 1 })
    ).resolves.toBeUndefined();
    expect(httpGetMock).toHaveBeenCalledTimes(2);
  });

  it('retries through request errors (e.g. backend not listening yet) until one succeeds', async () => {
    errorOnce();
    respondOnce(200);
    await expect(
      main.waitForBackend('http://localhost:4000/api/health', { intervalMs: 1 })
    ).resolves.toBeUndefined();
    expect(httpGetMock).toHaveBeenCalledTimes(2);
  });

  it('rejects with a clear timeout error if the backend never becomes healthy', async () => {
    httpGetMock.mockImplementation(() => {
      const req = new EventEmitter();
      setTimeout(() => req.emit('error', new Error('ECONNREFUSED')), 0);
      return req;
    });

    await expect(
      main.waitForBackend('http://localhost:4000/api/health', { timeoutMs: 5, intervalMs: 1 })
    ).rejects.toThrow(/did not become healthy within 5ms/);
  });
});

describe('select-folder IPC handler (Rollout step 5)', () => {
  it('registers a handler for the \'select-folder\' channel on module load', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith('select-folder', main.selectFolder);
  });

  it('returns the chosen path when the user picks a folder', async () => {
    mockDialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/me/mockup-packs'] });

    await expect(main.selectFolder()).resolves.toBe('/Users/me/mockup-packs');
    expect(mockDialog.showOpenDialog).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ properties: ['openDirectory'] })
    );
  });

  it('returns null when the user cancels the dialog', async () => {
    mockDialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(main.selectFolder()).resolves.toBeNull();
  });

  it('passes the current mainWindow to showOpenDialog once a window exists', async () => {
    mockDialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    mockApp.isPackaged = false;
    await main.createWindow();

    await main.selectFolder();

    expect(mockDialog.showOpenDialog).toHaveBeenCalledWith(
      mockBrowserWindowInstance,
      expect.objectContaining({ properties: ['openDirectory'] })
    );
  });
});

// Regression tests for debug.md §2 "Root cause candidate A -- no single-instance
// lock". These are written against the fix, not the current code -- main.js does not
// yet export acquireSingleInstanceLock, so every test in this block currently fails
// (TypeError: main.acquireSingleInstanceLock is not a function). That failure, surfaced
// by CI's existing `electron-test` job (ci.yml, runs on every push/PR), is the checked-in
// proof the bug exists. They should go green once main.js gains this export and calls it
// from the isMainModule startup block in place of the missing lock check.
describe('acquireSingleInstanceLock (regression -- debug.md §2 candidate A)', () => {
  it('requests the OS-level single-instance lock on startup', () => {
    main.acquireSingleInstanceLock();
    expect(mockApp.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
  });

  it('quits this process immediately when the lock cannot be acquired (a prior instance already holds it)', () => {
    mockApp.requestSingleInstanceLock.mockReturnValue(false);

    main.acquireSingleInstanceLock();

    // Use app.exit() (or app.quit()) here, not silently falling through to spawn a
    // second backend against the same port -- that duplicate-backend spawn is the
    // actual mechanism behind debug.md's reported "10 background processes".
    expect(mockApp.quit.mock.calls.length + mockApp.exit.mock.calls.length).toBeGreaterThan(0);
  });

  it('does NOT quit when this process successfully acquires the lock', () => {
    mockApp.requestSingleInstanceLock.mockReturnValue(true);

    main.acquireSingleInstanceLock();

    expect(mockApp.quit).not.toHaveBeenCalled();
    expect(mockApp.exit).not.toHaveBeenCalled();
  });

  it('registers a \'second-instance\' handler so a later duplicate launch focuses the existing window instead of spawning its own backend', () => {
    main.acquireSingleInstanceLock();

    expect(mockApp.on).toHaveBeenCalledWith('second-instance', expect.any(Function));
  });
});

// Regression tests for debug.md §2 "Root cause candidate B -- slow first-run backend
// startup exceeding the 20s waitForBackend timeout". Currently the isMainModule block's
// catch does only `console.error(...)` + `app.quit()` -- invisible to the user, so a
// timeout looks identical to "nothing happened". main.js does not yet export
// reportBackendStartupFailure, so these fail today the same way as the block above.
describe('reportBackendStartupFailure (regression -- debug.md §2 candidate B)', () => {
  it('shows a native error dialog instead of quitting silently', () => {
    main.reportBackendStartupFailure(new Error('Backend did not become healthy within 20000ms (http://localhost:4000/api/health)'));

    expect(mockDialog.showErrorBox).toHaveBeenCalledTimes(1);
    const [, message] = mockDialog.showErrorBox.mock.calls[0];
    expect(message).toMatch(/did not become healthy/);
  });

  it('still quits the app after the user has been shown why', () => {
    main.reportBackendStartupFailure(new Error('boom'));
    expect(mockApp.quit).toHaveBeenCalledTimes(1);
  });
});

describe('createWindow', () => {
  it('constructs the BrowserWindow with preload/contextIsolation/nodeIntegration options', async () => {
    mockApp.isPackaged = false;
    await main.createWindow();

    expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
    const [options] = MockBrowserWindow.mock.calls[0];
    expect(options.webPreferences).toMatchObject({
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    });
  });

  it('loads the dev frontend URL when not packaged', async () => {
    mockApp.isPackaged = false;
    await main.createWindow();

    expect(mockBrowserWindowInstance.loadURL).toHaveBeenCalledWith(main.DEV_FRONTEND_URL);
    expect(mockBrowserWindowInstance.loadFile).not.toHaveBeenCalled();
  });

  it('loads frontend/dist/index.html when packaged', async () => {
    mockApp.isPackaged = true;
    await main.createWindow();

    expect(mockBrowserWindowInstance.loadFile).toHaveBeenCalledWith(
      path.join(__dirname, '..', 'frontend', 'dist', 'index.html')
    );
    expect(mockBrowserWindowInstance.loadURL).not.toHaveBeenCalled();
  });
});

// Regression tests for issue #97: packaged builds that spawned three background
// processes with no window and no error dialog. getBackendLogPath() covers the new
// backend-log-file diagnostics; the createWindow() block below covers the new
// did-fail-load/render-process-gone handlers and the loadFile() rejection path.
describe('getBackendLogPath (regression -- issue #97)', () => {
  it('returns null in dev mode (no log file needed outside a packaged build)', () => {
    mockApp.isPackaged = false;
    expect(main.getBackendLogPath()).toBeNull();
  });
});

// Regression tests for issue #103: packaged runs with no backend.log, no window, and no
// visible stdout/stderr at all -- meaning the failure happens before spawnBackend() ever
// creates that log stream. logStartup() is the earlier, separate log this adds to catch
// that window; child.on('error', ...) covers the specific silent-crash mechanism a failed
// spawn() call could otherwise cause (an unhandled 'error' event throwing back out of the
// emit site with no trace left anywhere).
describe('logStartup (regression -- issue #103)', () => {
  it('always logs to console, even in dev mode where there is no startup.log file', () => {
    mockApp.isPackaged = false;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    main.logStartup('some checkpoint reached');

    expect(consoleSpy).toHaveBeenCalledWith('[electron] some checkpoint reached');
    consoleSpy.mockRestore();
  });

  it('does not throw when packaged and the log directory is unavailable (best-effort diagnostics only)', () => {
    mockApp.isPackaged = true;
    mockApp.getPath.mockImplementation(() => {
      throw new Error('no such path');
    });

    expect(() => main.logStartup('checkpoint')).not.toThrow();
  });
});

describe("spawnBackend's child 'error' handler (regression -- issue #103)", () => {
  it('does not throw when the spawned child emits an unhandled-by-default \'error\' event', () => {
    mockApp.isPackaged = false;
    const child = main.spawnBackend();

    // Node's EventEmitter re-throws an 'error' event synchronously if no listener is
    // attached -- this only stays silent (the #103 failure mode) if spawnBackend()
    // itself attaches one, which is exactly what this asserts.
    expect(() => child.emit('error', new Error('spawn ENOENT'))).not.toThrow();
  });
});

describe('createWindow failure reporting (regression -- issue #97)', () => {
  it('reports via the error dialog (and does not throw) if loadFile() rejects when packaged', async () => {
    mockApp.isPackaged = true;
    mockBrowserWindowInstance.loadFile.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

    await expect(main.createWindow()).resolves.toBeUndefined();

    expect(mockDialog.showErrorBox).toHaveBeenCalledTimes(1);
    expect(mockDialog.showErrorBox.mock.calls[0][1]).toMatch(/ENOENT/);
    expect(mockApp.quit).toHaveBeenCalledTimes(1);
  });

  it('registers a did-fail-load handler that reports non-ERR_ABORTED failures via the error dialog', async () => {
    mockApp.isPackaged = false;
    await main.createWindow();

    const call = mockBrowserWindowInstance.webContents.on.mock.calls.find(([ch]) => ch === 'did-fail-load');
    expect(call).toBeDefined();
    const [, handler] = call;

    handler(null, -6, 'FILE_NOT_FOUND', 'file:///app/frontend/dist/index.html');

    expect(mockDialog.showErrorBox).toHaveBeenCalledTimes(1);
    expect(mockDialog.showErrorBox.mock.calls[0][1]).toMatch(/FILE_NOT_FOUND/);
  });

  it('ignores ERR_ABORTED (-3) from did-fail-load as a benign redirect/cancel', async () => {
    mockApp.isPackaged = false;
    await main.createWindow();

    const [, handler] = mockBrowserWindowInstance.webContents.on.mock.calls.find(([ch]) => ch === 'did-fail-load');

    handler(null, -3, 'ERR_ABORTED', 'http://localhost:5173/');

    expect(mockDialog.showErrorBox).not.toHaveBeenCalled();
  });

  it('registers a render-process-gone handler that reports renderer crashes via the error dialog', async () => {
    mockApp.isPackaged = false;
    await main.createWindow();

    const [, handler] = mockBrowserWindowInstance.webContents.on.mock.calls.find(
      ([ch]) => ch === 'render-process-gone'
    );

    handler(null, { reason: 'crashed' });

    expect(mockDialog.showErrorBox).toHaveBeenCalledTimes(1);
    expect(mockDialog.showErrorBox.mock.calls[0][1]).toMatch(/crashed/);
  });
});

describe('auto-update (electron-updater wiring)', () => {
  it('disables autoDownload so downloads only start on an explicit click', () => {
    expect(mockAutoUpdater.autoDownload).toBe(false);
  });

  it('registers ipcMain handlers for check-for-updates, download-update, and quit-and-install', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith('check-for-updates', main.checkForUpdates);
    expect(mockIpcMain.handle).toHaveBeenCalledWith('download-update', main.downloadUpdate);
    expect(mockIpcMain.handle).toHaveBeenCalledWith('quit-and-install', main.quitAndInstall);
  });

  describe('checkForUpdates', () => {
    it('skips without calling autoUpdater in dev mode', async () => {
      mockApp.isPackaged = false;
      await expect(main.checkForUpdates()).resolves.toEqual({ skipped: true, reason: 'not packaged' });
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
    });

    it('delegates to autoUpdater.checkForUpdates() when packaged', async () => {
      mockApp.isPackaged = true;
      await main.checkForUpdates();
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    });
  });

  describe('downloadUpdate', () => {
    it('skips without calling autoUpdater in dev mode', async () => {
      mockApp.isPackaged = false;
      await expect(main.downloadUpdate()).resolves.toEqual({ skipped: true, reason: 'not packaged' });
      expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled();
    });

    it('delegates to autoUpdater.downloadUpdate() when packaged', async () => {
      mockApp.isPackaged = true;
      await main.downloadUpdate();
      expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('quitAndInstall', () => {
    it('skips without calling autoUpdater in dev mode', () => {
      mockApp.isPackaged = false;
      expect(main.quitAndInstall()).toEqual({ skipped: true, reason: 'not packaged' });
      expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
    });

    it('delegates to autoUpdater.quitAndInstall() when packaged', () => {
      mockApp.isPackaged = true;
      expect(main.quitAndInstall()).toEqual({ skipped: false });
      expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    });
  });

  describe('forwarding autoUpdater events to the renderer', () => {
    it('does nothing (no throw) if no window has been created yet', () => {
      expect(() => mockAutoUpdater.emit('checking-for-update')).not.toThrow();
      expect(mockBrowserWindowInstance.webContents.send).not.toHaveBeenCalled();
    });

    it('sends each lifecycle event to the renderer over its own updater:* channel once a window exists', async () => {
      await main.createWindow();

      mockAutoUpdater.emit('checking-for-update');
      expect(mockBrowserWindowInstance.webContents.send).toHaveBeenCalledWith('updater:checking-for-update', undefined);

      mockAutoUpdater.emit('update-available', { version: '1.2.3' });
      expect(mockBrowserWindowInstance.webContents.send).toHaveBeenCalledWith('updater:update-available', { version: '1.2.3' });

      mockAutoUpdater.emit('update-not-available', {});
      expect(mockBrowserWindowInstance.webContents.send).toHaveBeenCalledWith('updater:update-not-available', {});

      mockAutoUpdater.emit('download-progress', { percent: 50 });
      expect(mockBrowserWindowInstance.webContents.send).toHaveBeenCalledWith('updater:download-progress', { percent: 50 });

      mockAutoUpdater.emit('update-downloaded', { version: '1.2.3' });
      expect(mockBrowserWindowInstance.webContents.send).toHaveBeenCalledWith('updater:update-downloaded', { version: '1.2.3' });

      mockAutoUpdater.emit('error', new Error('boom'));
      expect(mockBrowserWindowInstance.webContents.send).toHaveBeenCalledWith('updater:error', 'boom');
    });

    it('falls back to a generic message when the error event has no Error object', async () => {
      await main.createWindow();

      mockAutoUpdater.emit('error', null);
      expect(mockBrowserWindowInstance.webContents.send).toHaveBeenCalledWith('updater:error', 'Unknown update error');
    });

    it('does not send once the window has been destroyed', async () => {
      await main.createWindow();
      mockBrowserWindowInstance.isDestroyed.mockReturnValue(true);

      mockAutoUpdater.emit('checking-for-update');

      expect(mockBrowserWindowInstance.webContents.send).not.toHaveBeenCalled();
    });
  });
});
