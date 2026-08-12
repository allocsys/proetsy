import { useEffect, useState } from 'react';
import { Loader2, Download, RotateCcw, AlertCircle, RefreshCw } from 'lucide-react';
import StatusBadge from '@/components/layout/StatusBadge';
import { Button } from '@/components/ui/button';

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
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Checking for updates…
      </span>
    );
  }

  if (phase === 'available') {
    return (
      <div className="flex items-center gap-2">
        <StatusBadge status="pending">
          {version ? `Update v${version} available` : 'Update available'}
        </StatusBadge>
        <Button size="xs" onClick={handleDownload}>
          <Download className="size-3" />
          Download
        </Button>
      </div>
    );
  }

  if (phase === 'downloading') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Downloading… {percent}%
      </span>
    );
  }

  if (phase === 'downloaded') {
    return (
      <div className="flex items-center gap-2">
        <StatusBadge status="success">
          {version ? `Update v${version} ready` : 'Update ready'}
        </StatusBadge>
        <Button size="xs" onClick={handleInstall}>
          <RotateCcw className="size-3" />
          Restart
        </Button>
      </div>
    );
  }

  if (phase === 'not-available') {
    return (
      <div className="flex items-center gap-2">
        <StatusBadge status="success">Up to date</StatusBadge>
        <Button variant="ghost" size="xs" onClick={handleCheck}>
          <RefreshCw className="size-3" />
          Check
        </Button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="size-3" />
          {errorMsg}
        </span>
        <Button variant="secondary" size="xs" onClick={handleCheck}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <Button variant="ghost" size="xs" onClick={handleCheck}>
      <RefreshCw className="size-3" />
      Check for updates
    </Button>
  );
}

export default UpdaterStatus;
