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
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mockupTemplatesAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
});
