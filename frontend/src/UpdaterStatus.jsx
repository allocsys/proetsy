import { useEffect, useState } from 'react';
import StatusPill from './components/StatusPill.jsx';

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
    return <span className="text-muted mono-sm">Checking for updates…</span>;
  }

  if (phase === 'available') {
    return (
      <div className="flex-row flex-wrap" style={{ gap: '0.5rem' }}>
        <StatusPill variant="pending">Update {version ? `v${version}` : ''} available</StatusPill>
        <button className="btn-primary btn-sm" onClick={handleDownload}>Download update</button>
      </div>
    );
  }

  if (phase === 'downloading') {
    return <span className="text-muted mono-sm">Downloading update… {percent}%</span>;
  }

  if (phase === 'downloaded') {
    return (
      <div className="flex-row flex-wrap" style={{ gap: '0.5rem' }}>
        <StatusPill variant="success">Update {version ? `v${version}` : ''} ready</StatusPill>
        <button className="btn-primary btn-sm" onClick={handleInstall}>Restart & install</button>
      </div>
    );
  }

  if (phase === 'not-available') {
    return (
      <div className="flex-row flex-wrap" style={{ gap: '0.5rem' }}>
        <StatusPill variant="success">Up to date</StatusPill>
        <button className="btn-ghost btn-sm" onClick={handleCheck}>Check again</button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex-row flex-wrap" style={{ gap: '0.5rem' }}>
        <span className="text-danger mono-sm">{errorMsg}</span>
        <button className="btn-secondary btn-sm" onClick={handleCheck}>Retry</button>
      </div>
    );
  }

  return (
    <button className="btn-ghost btn-sm" onClick={handleCheck}>
      Check for updates
    </button>
  );
}

export default UpdaterStatus;
