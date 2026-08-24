// Preload script -- runs in a privileged context bridging the renderer (the React
// frontend, loaded via mainWindow.loadURL in main.js) and Node/Electron APIs. The
// frontend talks to the backend over plain HTTP for everything else (fetch to
// http://localhost:<port>/api/..., same as it already does in a regular browser tab),
// so contextIsolation stays enabled (main.js already sets contextIsolation: true,
// nodeIntegration: false) and this bridge is scoped to exactly the one privileged need
// that actually exists so far.
//
// Rollout step 5 (plan.md -> "Electron: real native folder picker"): the dashboard's
// Mockup Templates folder field wants a real OS "Browse…" folder picker when running
// inside Electron (MockupTemplates.jsx feature-detects window.mockupTemplatesAPI and
// falls back to the plain text field when it's undefined -- e.g. dev-in-browser, no
// Electron present). This is this file's first real contextBridge.exposeInMainWorld()
// call -- naming is scoped to this feature (`mockupTemplatesAPI`), not a generic
// grab-bag `window.electronAPI`, so a future privileged need gets its own similarly
// scoped bridge call rather than everything piling into one shared object.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mockupTemplatesAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
});

// Auto-update bridge (see main.js's autoUpdater wiring). Actions are invoke/response;
// updater lifecycle events are one-way main -> renderer, so each `on*` subscriber wraps
// ipcRenderer.on and unwraps the (event, payload) signature down to just `payload` for
// the renderer, and returns an unsubscribe function -- App.jsx's effect cleanup calls it
// on unmount so listeners don't pile up across re-renders/hot reloads.
contextBridge.exposeInMainWorld('updaterAPI', {
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onCheckingForUpdate: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('updater:checking-for-update', listener);
    return () => ipcRenderer.removeListener('updater:checking-for-update', listener);
  },
  onUpdateAvailable: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('updater:update-available', listener);
    return () => ipcRenderer.removeListener('updater:update-available', listener);
  },
  onUpdateNotAvailable: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('updater:update-not-available', listener);
    return () => ipcRenderer.removeListener('updater:update-not-available', listener);
  },
  onDownloadProgress: (cb) => {
    const listener = (_event, progress) => cb(progress);
    ipcRenderer.on('updater:download-progress', listener);
    return () => ipcRenderer.removeListener('updater:download-progress', listener);
  },
  onUpdateDownloaded: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('updater:update-downloaded', listener);
    return () => ipcRenderer.removeListener('updater:update-downloaded', listener);
  },
  onError: (cb) => {
    const listener = (_event, message) => cb(message);
    ipcRenderer.on('updater:error', listener);
    return () => ipcRenderer.removeListener('updater:error', listener);
  },
});
