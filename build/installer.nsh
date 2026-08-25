; Custom NSIS uninstall cleanup for ProEtsy.
;
; electron-builder's own uninstaller already runs `RMDir /r $INSTDIR`, which recursively
; wipes the entire install directory -- including any files an app wrote there after
; installation, not just the files the installer itself put there. That already covers
; this app's primary data location: electron/main.js's packagedDataRoot() deliberately
; prefers <install dir>/data (plus /models for the downloaded CLIP model, /logs for
; backend.log/startup.log) right alongside the app itself, precisely so it lives inside
; $INSTDIR and gets removed automatically. Nothing extra is needed for that path -- see
; that function's own comments in electron/main.js for the full rationale.
;
; What default $INSTDIR removal does NOT cover, and why this script exists:
;
;  1. packagedDataRoot()'s fallback: when the install directory isn't writable (e.g. a
;     per-machine install to Program Files without elevation), the DB, uploads,
;     taste-filter candidates, generated mockups, the downloaded CLIP model, and both
;     log files all land in app.getPath('userData') instead.
;     `nsis.deleteAppDataOnUninstall` looks like the built-in fix for exactly this, but
;     it's documented as *one-click installer only* -- this app's `oneClick: false`
;     (required for allowToChangeInstallationDirectory) makes that option a silent no-op.
;
;  2. electron-updater manages its own download cache entirely independently of
;     packagedDataRoot() -- always at %LOCALAPPDATA%\<app name>-updater.
;
;  3. The issue #103 startup sentinel file (see main.js's isMainModule block), written
;     straight to the OS temp dir via node:fs/node:os with no Electron API involved at
;     all, specifically so it works even if a crash happens before Electron's own app
;     module has finished initializing. Its location doesn't depend on either path above.
;
; Folder naming: Electron's app.getPath('userData') (and app.name, which
; electron-updater's own cache path is also keyed on) resolve from this project's root
; package.json "name" field ("proetsy"), NOT the NSIS-only nested build.productName
; ("ProEtsy") used for the install directory / Start Menu shortcut / branding. This is a
; well-documented electron-builder gotcha -- see electron-builder issue #2057, where
; relying on the builtin ${APP_FILENAME} NSIS define (rather than the actual package.json
; name) silently pointed at the wrong folder. Both casings are covered below regardless,
; since RMDir/Delete on a path that doesn't exist is a silent no-op in NSIS -- cheap
; insurance against ever being wrong about which one Electron actually used.
!macro customUnInstall
  RMDir /r "$APPDATA\proetsy"
  RMDir /r "$APPDATA\ProEtsy"
  RMDir /r "$LOCALAPPDATA\proetsy-updater"
  RMDir /r "$LOCALAPPDATA\ProEtsy-updater"
  Delete "$TEMP\proetsy-sentinel.log"
!macroend
