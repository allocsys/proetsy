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
};

const mockBrowserWindowInstance = {
  loadFile: vi.fn().mockResolvedValue(undefined),
  loadURL: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};
const MockBrowserWindow = vi.fn(() => mockBrowserWindowInstance);
MockBrowserWindow.getAllWindows = vi.fn(() => []);

vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: MockBrowserWindow,
}));

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
  mockApp.getPath.mockClear().mockReturnValue('/fake/userData');
  spawnMock.mockClear();
  httpGetMock.mockReset();
  MockBrowserWindow.mockClear();
  mockBrowserWindowInstance.loadFile.mockClear();
  mockBrowserWindowInstance.loadURL.mockClear();
  main = await import('./main.js');
});

afterEach(() => {
  vi.useRealTimers();
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

describe('createWindow', () => {
  it('constructs the BrowserWindow with preload/contextIsolation/nodeIntegration options', async () => {
    mockApp.isPackaged = false;
    await main.createWindow();

    expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
    const [options] = MockBrowserWindow.mock.calls[0];
    expect(options.webPreferences).toMatchObject({
      preload: path.join(__dirname, 'preload.js'),
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
