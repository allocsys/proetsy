import { useCallback, useState } from 'react';

// plan.md Step 4: shop settings, pipeline config/overrides, watch-folder
// automation, rate-limit diagnostics, and config backup/import -- everything
// SettingsView's 'general' and 'automation' tabs need, plus the pipeline
// overrides UploadView needs for its per-upload toggles.
export function useSettings(reportFetchError, dependentRefreshers = {}) {
  const { refreshApiKeys, refreshTags } = dependentRefreshers;

  const [settings, setSettings] = useState({});
  const [savedFlashes, setSavedFlashes] = useState({});
  const [pipelineDefault, setPipelineDefault] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [watchStatus, setWatchStatus] = useState(null);
  const [suggestedWatchFolder, setSuggestedWatchFolder] = useState(null);
  const [rateLimits, setRateLimits] = useState([]);
  const [rateLimitsLoading, setRateLimitsLoading] = useState(true);
  const [rateLimitsUpdatedAt, setRateLimitsUpdatedAt] = useState(null);
  const [configBackupMessage, setConfigBackupMessage] = useState('');
  const [configImportMessage, setConfigImportMessage] = useState(null);
  const [configImporting, setConfigImporting] = useState(false);

  function flashSaved(field) {
    setSavedFlashes((prev) => ({ ...prev, [field]: true }));
    setTimeout(() => {
      setSavedFlashes((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }, 2000);
  }

  async function saveSettings(updates) {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    setSettings(data);
    if (res.ok) {
      Object.keys(updates).forEach(flashSaved);
    }
    return data;
  }

  const refreshWatchStatus = useCallback(() => {
    fetch('/api/taste-filter/watch-status')
      .then((r) => r.json())
      .then(setWatchStatus)
      .catch(reportFetchError('refreshWatchStatus'));
  }, [reportFetchError]);

  async function saveWatchSetting(updates) {
    await saveSettings(updates);
    refreshWatchStatus();
  }

  // One-click default for the watched-folder field -- fills the field with the
  // suggested Downloads folder and turns watching on in one action, instead of
  // requiring the user to hand-type a full path first.
  async function useDefaultWatchFolder() {
    let suggestion = suggestedWatchFolder;
    if (!suggestion) {
      try {
        const res = await fetch('/api/system/default-watch-folder');
        suggestion = await res.json();
        setSuggestedWatchFolder(suggestion);
      } catch {
        return;
      }
    }
    setSettings((s) => ({ ...s, taste_filter_watch_folder: suggestion.suggested, taste_filter_watch_enabled: 'true' }));
    await saveWatchSetting({ taste_filter_watch_folder: suggestion.suggested, taste_filter_watch_enabled: true });
  }

  const refreshRateLimits = useCallback(() => {
    fetch('/api/llm/rate-limits')
      .then((r) => r.json())
      .then((data) => { setRateLimits(data); setRateLimitsLoading(false); setRateLimitsUpdatedAt(new Date()); })
      .catch((err) => { setRateLimitsLoading(false); reportFetchError('refreshRateLimits')(err); });
  }, [reportFetchError]);

  function refreshPipelineConfig() {
    fetch('/api/config/pipeline')
      .then((r) => r.json())
      .then((cfg) => {
        setPipelineDefault(cfg);
        setOverrides(Object.fromEntries(cfg.pipeline.map((m) => [m.module, m.enabled])));
      })
      .catch(reportFetchError('refreshPipelineConfig'));
  }

  function toggleModule(module, required) {
    if (required) return;
    setOverrides((prev) => ({ ...prev, [module]: !prev[module] }));
  }

  async function togglePersistedModule(moduleName, currentlyEnabled, required) {
    if (required) return;
    await saveSettings({ [`pipeline_module_${moduleName}_enabled`]: !currentlyEnabled });
    refreshPipelineConfig();
  }

  // Downloads a full config backup (settings, product sizes/mockup templates, tag
  // library, API keys) as a JSON file via the browser's normal download flow.
  async function downloadConfigBackup() {
    setConfigBackupMessage('Preparing backup…');
    try {
      const res = await fetch('/api/config/export');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to export config');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `proetsy-config-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setConfigBackupMessage(`Backup downloaded (${data.settings.length} setting(s), ${data.productSizes.length} product size(s), ${data.tags.length} tag(s), ${data.apiKeys.length} API key(s)).`);
    } catch (err) {
      setConfigBackupMessage(`Backup failed: ${err.message}`);
    }
  }

  // Restores a previously downloaded backup file. Upserts/dedupes server-side
  // rather than wiping first, so this is safe to re-run without losing anything.
  async function importConfigBackup(file) {
    if (!file) return;
    setConfigImporting(true);
    setConfigImportMessage({ text: `Importing ${file.name}…`, ok: true });
    try {
      const text = await file.text();
      let bundle;
      try {
        bundle = JSON.parse(text);
      } catch {
        throw new Error('That file is not valid JSON — pick a backup downloaded from this app.');
      }
      const res = await fetch('/api/config/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      const c = data.imported;
      setConfigImportMessage({
        text: `Imported: ${c.settings} setting(s), ${c.productSizes} product size(s), ${c.tags} new tag(s), ${c.apiKeys} new API key(s).`,
        ok: true,
      });
    } catch (err) {
      setConfigImportMessage({ text: `Import failed: ${err.message}`, ok: false });
    }
    setConfigImporting(false);
    // Refresh every panel a restored bundle could have touched.
    fetch('/api/settings').then((r) => r.json()).then(setSettings).catch(() => {});
    refreshPipelineConfig();
    if (refreshApiKeys) refreshApiKeys();
    if (refreshTags) refreshTags();
    refreshWatchStatus();
  }

  return {
    settings,
    setSettings,
    savedFlashes,
    saveSettings,
    flashSaved,
    pipelineDefault,
    overrides,
    setOverrides,
    refreshPipelineConfig,
    toggleModule,
    togglePersistedModule,
    watchStatus,
    refreshWatchStatus,
    saveWatchSetting,
    useDefaultWatchFolder,
    suggestedWatchFolder,
    rateLimits,
    rateLimitsLoading,
    rateLimitsUpdatedAt,
    refreshRateLimits,
    configBackupMessage,
    configImportMessage,
    configImporting,
    downloadConfigBackup,
    importConfigBackup,
  };
}
