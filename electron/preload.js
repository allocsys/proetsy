// Preload script -- runs in a privileged context bridging the renderer (the React
// frontend, loaded via mainWindow.loadURL in main.js) and Node/Electron APIs. Empty for
// now: the frontend talks to the backend over plain HTTP (fetch to
// http://localhost:<port>/api/..., same as it already does in a regular browser tab), so
// no contextBridge-exposed API is needed yet. Kept as its own file so contextIsolation
// can stay enabled by default (main.js already sets contextIsolation: true,
// nodeIntegration: false) and a future privileged need -- e.g. a native file-save dialog
// for exported listings, or reading the app's userData path once packaged-mode storage
// (ARCHITECTURE.md -> Electron packaging -- build sequence, sub-step 2) lands -- has an
// obvious place to add a contextBridge.exposeInMainWorld() call without restructuring
// main.js.
