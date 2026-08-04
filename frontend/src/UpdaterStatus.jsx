import { useEffect, useState } from 'react';

// Auto-update button (see electron/main.js's autoUpdater wiring and preload.js's
// updaterAPI bridge). Renders nothing outside Electron (dev-in-browser, or any
// context where preload.js never ran) -- same feature-detect convention
// MockupTemplates.jsx already established for window.mockupTemplatesAPI.
//
// State machine mirrors the six updater:* events forwarded from the main process:
// idle -> checking -> (not-available | available -> downloading -> downloaded) | error.
// Checking for updates never auto-downloads (autoDownload is false in main.js) -- the
// download and the install/restart are each their own explicit user click.
function UpdaterStatus() {
  const [phase, setPhase] = useState('idle');
  const [version, setVersion] = useState(null);
  const [percent, setPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!window.updaterAPI) return undefined;

    const unsubscribers = [
      window.updaterAPI.onCheckingForUpdate(() => setPhase('checking')),
      window.updaterAPI.onUpdateAvailable((info) => {
        setPhase('available');
        setVersion(info?.version || null);
      }),
      window.updaterAPI.onUpdateNotAvailable(() => setPhase('not-available')),
      window.updaterAPI.onDownloadProgress((progress) => {
        setPhase('downloading');
        setPercent(Math.round(progress?.percent ?? 0));
      }),
      window.updaterAPI.onUpdateDownloaded((info) => {
        setPhase('downloaded');
        setVersion(info?.version || null);
      }),
      window.updaterAPI.onError((message) => {
        setPhase('error');
        setErrorMsg(message || 'Update check failed');
      }),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe && unsubscribe());
  }, []);

  if (!window.updaterAPI) return null;

  async function handleCheck() {
    setErrorMsg('');
    setPhase('checking');
    try {
      // Dev/unpackaged builds resolve { skipped: true } instead of firing any
      // updater:* event (main.js's checkForUpdates() short-circuits before calling
      // electron-updater at all) -- fall back to idle rather than sitting on
      // "Checking..." forever.
      const result = await window.updaterAPI.checkForUpdates();
      if (result?.skipped) setPhase('idle');
    } catch (err) {
      setPhase('error');
      setErrorMsg(err?.message || 'Update check failed');
    }
  }

  function handleDownload() {
    window.updaterAPI.downloadUpdate().catch((err) => {
      setPhase('error');
      setErrorMsg(err?.message || 'Download failed');
    });
  }

  function handleInstall() {
    window.updaterAPI.quitAndInstall();
  }

  if (phase === 'checking') {
    return <span className="text-muted mono-sm" data-testid="updater-status">Checking for updates…</span>;
  }

  if (phase === 'available') {
    return (
      <span className="flex-row" style={{ gap: '0.5rem' }} data-testid="updater-status">
        <span className="status-pill pending" aria-label="Update available">
          <span className="status-dot" aria-hidden="true" />
          Update {version ? `v${version}` : ''} available
        </span>
        <button className="btn-primary btn-sm" onClick={handleDownload}>Download update</button>
      </span>
    );
  }

  if (phase === 'downloading') {
    return (
      <span className="text-muted mono-sm" data-testid="updater-status">
        Downloading update… {percent}%
      </span>
    );
  }

  if (phase === 'downloaded') {
    return (
      <span className="flex-row" style={{ gap: '0.5rem' }} data-testid="updater-status">
        <span className="status-pill success" aria-label="Update ready to install">
          <span className="status-dot" aria-hidden="true" />
          Update {version ? `v${version}` : ''} ready
        </span>
        <button className="btn-primary btn-sm" onClick={handleInstall}>Restart & install</button>
      </span>
    );
  }

  if (phase === 'not-available') {
    return (
      <span className="flex-row" style={{ gap: '0.5rem' }} data-testid="updater-status">
        <span className="status-pill success" aria-label="Up to date">
          <span className="status-dot" aria-hidden="true" />
          Up to date
        </span>
        <button className="btn-secondary btn-sm" onClick={handleCheck}>Check again</button>
      </span>
    );
  }

  if (phase === 'error') {
    return (
      <span className="flex-row" style={{ gap: '0.5rem' }} data-testid="updater-status">
        <span className="text-danger mono-sm">{errorMsg}</span>
        <button className="btn-secondary btn-sm" onClick={handleCheck}>Retry</button>
      </span>
    );
  }

  return (
    <button className="btn-secondary btn-sm" onClick={handleCheck} data-testid="updater-status">
      Check for updates
    </button>
  );
}

export default UpdaterStatus;
