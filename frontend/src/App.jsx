import { useEffect, useMemo, useState } from 'react';
import StatusPill from './components/StatusPill.jsx';
import JobArtworkAnalysisReview from './JobArtworkAnalysisReview.jsx';
import JobListingReview from './JobListingReview.jsx';
import JobMockupReview from './JobMockupReview.jsx';
import MockupTemplates from './MockupTemplates.jsx';
import ShopConventions from './ShopConventions.jsx';
import PromptHelper from './PromptHelper.jsx';
import TasteFilter from './TasteFilter.jsx';
import UpdaterStatus from './UpdaterStatus.jsx';

function StatusBadge({ status }) {
  const statusText = status || 'pending';
  return (
    <StatusPill variant={statusText} ariaLabel={`Status: ${statusText}`}>
      {statusText}
    </StatusPill>
  );
}

function NavIcon({ name }) {
  switch (name) {
    case 'upload':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      );
    case 'templates':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case 'history':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
      );
    case 'review':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 022 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 022 2h2a2 2 0 022-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      );
    case 'prompt':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'settings':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      );
    default:
      return null;
  }
}

const NAV_ITEMS = [
  { id: 'upload', label: 'Upload', group: 'Pipeline', icon: 'upload' },
  { id: 'mockup-templates', label: 'Mockup Templates', group: 'Pipeline', icon: 'templates' },
  { id: 'history', label: 'Listing History', group: 'Pipeline', icon: 'history' },
  { id: 'review', label: 'Review a Job', group: 'Pipeline', icon: 'review' },
  { id: 'prompt-helper', label: 'Prompt Helper', group: 'Modules', icon: 'prompt' },
  { id: 'settings', label: 'Shop Settings & Tags', group: 'Configuration', icon: 'settings' },
];

// plan.md step 7: Settings was one long scroll (tags, trends, shop conventions, API
// keys, automation/watch-folder config, rate-limit diagnostics) with sensitive key
// management sitting directly next to trivial fields. Split into sub-tabs so each
// concern gets its own screen -- API Keys (sensitive) now has a tab of its own,
// visually and navigationally separated from everything else.
const SETTINGS_TABS = [
  { id: 'tags-trends', label: 'Tags & Trends' },
  { id: 'general', label: 'Shop & Pipeline' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'automation', label: 'Automation & Diagnostics' },
];

function App() {
  const [health, setHealth] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const [pipelineDefault, setPipelineDefault] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [settings, setSettings] = useState({});
  const [trends, setTrends] = useState([]);
  const [newTrendTerm, setNewTrendTerm] = useState('');
  const [newTrendCategory, setNewTrendCategory] = useState('');
  const [tags, setTags] = useState([]);
  const [tagsText, setTagsText] = useState('');
  const [tagsCategory, setTagsCategory] = useState('');
  const [tagsSavedMessage, setTagsSavedMessage] = useState(null); // { text, ok }
  const [tagsCsvMessage, setTagsCsvMessage] = useState(null); // { text, ok }
  const [tagsBackfillMessage, setTagsBackfillMessage] = useState(null); // { text, ok }
  const [tagsBackfillRunning, setTagsBackfillRunning] = useState(false);
  const [tagsBackfillPreview, setTagsBackfillPreview] = useState(null); // { checked, updates } | null
  const [tagsBackfillPreviewLoading, setTagsBackfillPreviewLoading] = useState(false);
  const [watchStatus, setWatchStatus] = useState(null);
  const [rateLimits, setRateLimits] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyProvider, setNewKeyProvider] = useState('gemini');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [apiKeysMessage, setApiKeysMessage] = useState('');
  const [jobs, setJobs] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [jobIdInput, setJobIdInput] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeView, setActiveView] = useState('upload');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('proetsy_sidebar_collapsed');
      return stored === null ? false : stored === 'true';
    } catch {
      return false;
    }
  });
  const [fetchError, setFetchError] = useState(null);
  const [reviewTab, setReviewTab] = useState('analysis');
  const [activeJobInfo, setActiveJobInfo] = useState(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [previousView, setPreviousView] = useState('upload');
  const [tagsLoading, setTagsLoading] = useState(true);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [apiKeysLoading, setApiKeysLoading] = useState(true);
  const [rateLimitsLoading, setRateLimitsLoading] = useState(true);
  const [rateLimitsUpdatedAt, setRateLimitsUpdatedAt] = useState(null);
  const [savedFlashes, setSavedFlashes] = useState({});
  const [confirmAction, setConfirmAction] = useState(null); // { message, onConfirm } | null
  const [settingsTab, setSettingsTab] = useState('tags-trends'); // plan.md step 7: which Settings sub-tab is active
  const [configBackupMessage, setConfigBackupMessage] = useState('');
  const [configImportMessage, setConfigImportMessage] = useState(null); // { text, ok } | null
  const [configImporting, setConfigImporting] = useState(false);

  useEffect(() => {
    if (!activeJobId) {
      setActiveJobInfo(null);
      return;
    }
    fetch(`/api/jobs/${activeJobId}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((jobData) => {
        setActiveJobInfo({
          id: jobData.id,
          filePath: jobData.artwork_file_path || '',
          filename: jobData.artwork_file_path?.split('/').pop() || `Job #${jobData.id}`,
          status: jobData.overall_status,
        });
      })
      .catch(() => {
        setActiveJobInfo({
          id: activeJobId,
          filename: `Job #${activeJobId}`,
          status: 'unknown',
        });
      });
  }, [activeJobId]);

  function reportFetchError(source) {
    return (err) => setFetchError({ source, message: err.message });
  }

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

  // Shared in-app confirmation modal for destructive actions (tags, trends, API
  // keys), replacing native window.confirm() popups so the styling and UX stays
  // consistent with the rest of the dashboard.
  function requestConfirm(message, onConfirm) {
    setConfirmAction({ message, onConfirm });
  }

  async function confirmActionAccept() {
    if (!confirmAction) return;
    await confirmAction.onConfirm();
    setConfirmAction(null);
  }

  function confirmActionCancel() {
    setConfirmAction(null);
  }

  function goTo(view) {
    if (view === 'settings' && activeView !== 'settings') {
      setPreviousView(activeView);
    }
    setActiveView(view);
    if (view === 'settings') {
      refreshRateLimits();
      refreshApiKeys();
      refreshPipelineConfig();
    }
    if (view === 'review') {
      refreshJobs();
    }
  }

  function refreshHealth() {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'unreachable' }));
  }

  function refreshJobs() {
    fetch('/api/jobs')
      .then((r) => r.json())
      .then(setJobs)
      .catch(reportFetchError('refreshJobs'));
  }

  function refreshSetupStatus() {
    fetch('/api/setup-status')
      .then((r) => r.json())
      .then(setSetupStatus)
      .catch(reportFetchError('refreshSetupStatus'));
  }

  function refreshTrends() {
    fetch('/api/trends')
      .then((r) => r.json())
      .then((data) => { setTrends(data); setTrendsLoading(false); })
      .catch((err) => { setTrendsLoading(false); reportFetchError('refreshTrends')(err); });
  }

  function refreshTags() {
    fetch('/api/tags')
      .then((r) => r.json())
      .then((data) => { setTags(data); setTagsLoading(false); })
      .catch((err) => { setTagsLoading(false); reportFetchError('refreshTags')(err); });
  }

  function refreshWatchStatus() {
    fetch('/api/taste-filter/watch-status')
      .then((r) => r.json())
      .then(setWatchStatus)
      .catch(reportFetchError('refreshWatchStatus'));
  }

  function refreshRateLimits() {
    fetch('/api/llm/rate-limits')
      .then((r) => r.json())
      .then((data) => { setRateLimits(data); setRateLimitsLoading(false); setRateLimitsUpdatedAt(new Date()); })
      .catch((err) => { setRateLimitsLoading(false); reportFetchError('refreshRateLimits')(err); });
  }

  function refreshApiKeys() {
    fetch('/api/settings/api-keys')
      .then((r) => r.json())
      .then((data) => { setApiKeys(data); setApiKeysLoading(false); })
      .catch((err) => { setApiKeysLoading(false); reportFetchError('refreshApiKeys')(err); });
  }

  function refreshPipelineConfig() {
    fetch('/api/config/pipeline')
      .then((r) => r.json())
      .then((cfg) => {
        setPipelineDefault(cfg);
        setOverrides(Object.fromEntries(cfg.pipeline.map((m) => [m.module, m.enabled])));
      })
      .catch(reportFetchError('refreshPipelineConfig'));
  }

  useEffect(() => {
    refreshHealth();

    fetch('/api/config/pipeline')
      .then((r) => r.json())
      .then((cfg) => {
        setPipelineDefault(cfg);
        setOverrides(Object.fromEntries(cfg.pipeline.map((m) => [m.module, m.enabled])));
      })
      .catch(reportFetchError('pipelineConfig (initial load)'));

    fetch('/api/settings').then((r) => r.json()).then(setSettings).catch(reportFetchError('settings'));
    refreshSetupStatus();
    refreshJobs();
    refreshTrends();
    refreshTags();
    refreshWatchStatus();
    refreshRateLimits();
    refreshApiKeys();
  }, []);

  const tagCategories = useMemo(
    () => Array.from(new Set(tags.map((t) => t.category).filter(Boolean))).sort(),
    [tags]
  );

  const trendCategories = useMemo(
    () => Array.from(new Set(trends.map((t) => t.category).filter(Boolean))).sort(),
    [trends]
  );

  const [expandedBatches, setExpandedBatches] = useState({});

  const groupedJobs = useMemo(() => {
    const groups = [];
    const batchIndex = new Map();
    for (const job of jobs) {
      if (!job.batch_id) {
        groups.push({ type: 'single', job });
        continue;
      }
      if (batchIndex.has(job.batch_id)) {
        groups[batchIndex.get(job.batch_id)].jobs.push(job);
      } else {
        batchIndex.set(job.batch_id, groups.length);
        groups.push({ type: 'batch', batchId: job.batch_id, jobs: [job] });
      }
    }
    return groups;
  }, [jobs]);

  const statusCounts = useMemo(
    () =>
      jobs.reduce((acc, j) => {
        const key = j.overall_status || 'pending';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    [jobs]
  );

  const recentJobsSorted = useMemo(
    () => [...jobs].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
    [jobs]
  );

  async function runJobsBatch(jobIds) {
    await fetch('/api/jobs/run-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_ids: jobIds }),
    }).catch(reportFetchError('runJobsBatch'));
    refreshJobs();
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploadStatus(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);

    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));

    const batchId = files.length > 1 ? crypto.randomUUID() : null;

    try {
      const uploadRes = await fetch('/api/artworks/upload', { method: 'POST', body: formData });
      const { artworks, error } = await uploadRes.json();
      if (error) throw new Error(error);

      setUploadStatus(`Creating ${artworks.length} job${artworks.length > 1 ? 's' : ''}…`);
      const jobsRes = await fetch('/api/jobs/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artwork_ids: artworks.map((a) => a.id), pipeline_overrides: overrides, batch_id: batchId }),
      });
      const jobsData = await jobsRes.json();
      if (jobsData.error) throw new Error(jobsData.error);
      const jobIds = jobsData.jobs.map((job) => job.id);
      refreshJobs();

      setUploadStatus(`Running pipeline for ${jobIds.length} job${jobIds.length > 1 ? 's' : ''} on the server…`);
      await runJobsBatch(jobIds);
      setUploadStatus(`Done. ${jobIds.length} job${jobIds.length > 1 ? 's' : ''} processed — see history.`);
      if (jobIds.length === 1) setActiveJobId(String(jobIds[0]));
    } catch (err) {
      setUploadStatus(`Upload failed: ${err.message}`);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  }

  function toggleModule(module, required) {
    if (required) return;
    setOverrides((prev) => ({ ...prev, [module]: !prev[module] }));
  }

  async function saveTags() {
    const res = await fetch('/api/tags/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: tagsText, category: tagsCategory.trim() || null }),
    });
    const data = await res.json();
    setTagsSavedMessage({
      text: res.ok ? `Saved. ${data.inserted} new tag(s), ${data.total} total.` : (data.error || 'Failed to save tags'),
      ok: res.ok
    });
    if (res.ok) {
      setTagsText('');
    }
    refreshSetupStatus();
    refreshTags();
  }

  async function deleteTag(id, tagText) {
    requestConfirm(`Delete tag "${tagText}"? This can't be undone.`, async () => {
      await fetch(`/api/tags/${id}`, { method: 'DELETE' });
      refreshTags();
    });
  }

  async function deleteTrend(id, term) {
    requestConfirm(`Delete trend "${term}"? This can't be undone.`, async () => {
      await fetch(`/api/trends/${id}`, { method: 'DELETE' });
      refreshTrends();
    });
  }

  async function importTagsCsv(file) {
    if (!file) return;
    setTagsCsvMessage({ text: `Importing ${file.name}…`, ok: true });
    try {
      const csv = await file.text();
      const res = await fetch('/api/tags/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      setTagsCsvMessage({
        text: res.ok ? `Imported ${data.inserted} new tag(s) from ${file.name}.` : (data.error || 'Import failed'),
        ok: res.ok
      });
    } catch (err) {
      setTagsCsvMessage({ text: `Import failed: ${err.message}`, ok: false });
    }
    refreshSetupStatus();
    refreshTags();
  }

  // Step 1: fetch the proposed matches without writing anything (backend dry_run=true),
  // so the user can see exactly what would change before committing to it.
  async function previewBackfillTagCategories() {
    setTagsBackfillPreviewLoading(true);
    setTagsBackfillMessage(null);
    try {
      const res = await fetch('/api/tags/backfill-categories?dry_run=true', { method: 'POST' });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`No response from backend (status ${res.status}). Is the backend server running?`);
      }
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setTagsBackfillPreview({ checked: data.checked, updates: data.updates });
    } catch (err) {
      setTagsBackfillMessage({ text: `Preview failed: ${err.message}`, ok: false });
    }
    setTagsBackfillPreviewLoading(false);
  }

  // Step 2: user reviewed the preview and chose to apply it — commits the exact same
  // matches that were just shown (the matching logic is deterministic, see
  // user-list.js's suggestCategoriesForUncategorizedTags).
  async function applyBackfillTagCategories() {
    setTagsBackfillRunning(true);
    setTagsBackfillMessage({ text: 'Applying…', ok: true });
    try {
      const res = await fetch('/api/tags/backfill-categories', { method: 'POST' });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`No response from backend (status ${res.status}). Is the backend server running?`);
      }
      setTagsBackfillMessage({
        text: res.ok ? `Backfilled ${data.updated} of ${data.checked} uncategorized tag(s).` : (data.error || 'Backfill failed'),
        ok: res.ok
      });
    } catch (err) {
      setTagsBackfillMessage({ text: `Backfill failed: ${err.message}`, ok: false });
    }
    setTagsBackfillRunning(false);
    setTagsBackfillPreview(null);
    refreshTags();
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

  async function saveWatchSetting(updates) {
    await saveSettings(updates);
    refreshWatchStatus();
  }

  async function addApiKey() {
    if (!newKeyValue.trim()) return;
    setApiKeysMessage('Adding key…');
    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: newKeyProvider,
          key_value: newKeyValue.trim(),
          label: newKeyLabel.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add key');
      setNewKeyValue('');
      setNewKeyLabel('');
      setApiKeysMessage('');
      refreshApiKeys();
    } catch (err) {
      setApiKeysMessage(err.message);
    }
  }

  async function toggleApiKeyEnabled(key) {
    await fetch(`/api/settings/api-keys/${key.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !key.enabled }),
    });
    refreshApiKeys();
  }

  async function deleteApiKey(key) {
    requestConfirm(
      `Delete ${key.provider} key${key.label ? ` "${key.label}"` : ''} (${key.maskedKey})? This can't be undone.`,
      async () => {
        await fetch(`/api/settings/api-keys/${key.id}`, { method: 'DELETE' });
        refreshApiKeys();
      }
    );
  }

  async function togglePersistedModule(moduleName, currentlyEnabled, required) {
    if (required) return;
    await saveSettings({ [`pipeline_module_${moduleName}_enabled`]: !currentlyEnabled });
    refreshPipelineConfig();
  }

  // Downloads a full config backup (settings, product sizes/mockup templates, tag
  // library, API keys) as a JSON file via the browser's normal download flow -- same
  // mechanism on Windows/macOS/Linux, nothing platform-specific to install or configure.
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

  // Restores a previously downloaded backup file. Upserts/dedupes server-side rather
  // than wiping first, so this is safe to re-run without losing anything added since.
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
    refreshApiKeys();
    refreshTags();
    refreshWatchStatus();
  }

  async function addTrendFromSettings() {
    if (!newTrendTerm.trim()) return;
    await fetch('/api/trends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: newTrendTerm.trim(), category: newTrendCategory.trim() || null }),
    });
    setNewTrendTerm('');
    setNewTrendCategory('');
    refreshTrends();
  }

  function openJob(jobId) {
    setActiveJobId(String(jobId));
    setJobIdInput(String(jobId));
    goTo('review');
  }

  const navGroups = ['Pipeline', 'Modules', 'Configuration'];

  return (
    <div className="app-shell">
      <header className="app-titlebar nav">
        <div className="wordmark-container">
          <div className="logo-badge" aria-hidden="true">M</div>
          <h1 className="wordmark">ProEtsy</h1>
        </div>
        <div className="header-right">
          <div className="backend-status-row">
            <span className="text-muted mono-sm">
              Backend:{' '}
              <strong style={{ color: health?.status === 'unreachable' ? 'var(--state-danger)' : 'var(--state-success)' }}>
                {health ? health.status : 'checking...'}
              </strong>
            </span>
            <button
              className="btn-secondary btn-sm retry-btn"
              onClick={refreshHealth}
              title="Retry health check"
              aria-label="Retry health check"
            >
              <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              Retry
            </button>
          </div>
          <UpdaterStatus />
          <button className="btn-secondary" onClick={() => goTo(activeView === 'settings' ? previousView : 'settings')}>
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: '14px', height: '14px' }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            {activeView === 'settings' ? 'Close settings' : 'Settings'}
          </button>
        </div>
      </header>

      <div className="mobile-nav-strip nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`mobile-nav-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => goTo(item.id)}
          >
            <NavIcon name={item.icon} />
            {item.label}
          </button>
        ))}
      </div>

      <div className="app-body">
        <nav className={`sidebar sidebar-shell ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-toggle-row">
            <button
              className="sidebar-toggle-btn"
              onClick={() => setSidebarCollapsed((c) => {
                const next = !c;
                try {
                  localStorage.setItem('proetsy_sidebar_collapsed', String(next));
                } catch {
                  // ignore storage errors (e.g. private browsing)
                }
                return next;
              })}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg className="sidebar-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {sidebarCollapsed ? (
                  <path d="M8 5l7 7-7 7M15 5l7 7-7 7" />
                ) : (
                  <path d="M16 5l-7 7 7 7M9 5l-7 7 7 7" />
                )}
              </svg>
            </button>
          </div>
          {navGroups.map((group) => (
            <div key={group}>
              <div className="sidebar-group-title">{group}</div>
              {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  className={`sidebar-nav-item ${activeView === item.id ? 'active' : ''}`}
                  onClick={() => goTo(item.id)}
                  title={item.label}
                >
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}

          <div className="sidebar-spacer" />

          <div className="sidebar-pipeline-strip">
            <div className="sidebar-pipeline-title">Pipeline status</div>
            <div className="pipeline-bar">
              {Object.keys(statusCounts).length ? (
                Object.entries(statusCounts).map(([status, count]) => (
                  <span key={status} className={`pipeline-segment ${status}`} style={{ flexGrow: count }} />
                ))
              ) : (
                <span className="pipeline-segment empty" style={{ flexGrow: 1 }} />
              )}
            </div>
            <div className="pipeline-legend">
              {Object.keys(statusCounts).length ? (
                Object.entries(statusCounts).map(([status, count]) => (
                  <span key={status} className="pipeline-legend-item">
                    <span className={`legend-dot ${status}`} aria-hidden="true" />
                    {status} · {count}
                  </span>
                ))
              ) : (
                <span className="pipeline-legend-item">No jobs yet</span>
              )}
            </div>
          </div>

          <div className="sidebar-user-footer">
            <div className="user-avatar" aria-hidden="true">PS</div>
            <div className="user-info">
              <span className="user-name">Print Studio</span>
              <span className="user-role">Admin</span>
            </div>
          </div>
        </nav>

        <main className="content-pane">
          {health && health.status === 'unreachable' && (
            <div className="backend-banner">
              <span>Backend not running — start it with <code className="mono">npm run dev</code> from the backend/ folder.</span>
              <StatusBadge status="pending" />
            </div>
          )}

          {fetchError && (
            <div className="backend-banner" role="alert">
              <span>Background update failed ({fetchError.source}): {fetchError.message}</span>
              <button className="btn-secondary btn-sm" onClick={() => setFetchError(null)}>Dismiss</button>
            </div>
          )}

          {setupStatus && !setupStatus.readyToRun && (
            <div className="setup-alert">
              <strong>Setup incomplete</strong>
              <ul>
                <li><span style={{ color: setupStatus.geminiKeyConfigured ? 'var(--state-success)' : 'var(--state-pending)', fontWeight: 600 }}>{setupStatus.geminiKeyConfigured ? 'Ready' : 'Action Required'}</span> Gemini API key configured — add one below in Settings</li>
                <li><span style={{ color: setupStatus.hasTagLibrary ? 'var(--state-success)' : 'var(--state-pending)', fontWeight: 600 }}>{setupStatus.hasTagLibrary ? 'Ready' : 'Action Required'}</span> Tag library has at least one tag — add one below in Settings</li>
                <li><span style={{ color: setupStatus.hasProductSize ? 'var(--state-success)' : 'var(--studio-ink-soft)', fontWeight: 600 }}>{setupStatus.hasProductSize ? 'Ready' : 'Optional'}</span> At least one product size / mockup template configured</li>
              </ul>
            </div>
          )}

          {activeView === 'settings' && (
            <div>
              <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Shop Settings & Tags</h2>

              <div className="workspace-tabs settings-tabs-nav">
                {SETTINGS_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    className={`workspace-tab-btn ${settingsTab === tab.id ? 'active' : ''}`}
                    onClick={() => setSettingsTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="settings-dashboard-grid">

              {settingsTab === 'tags-trends' && (
              <div className="settings-section-card card settings-card-tags">
                <h3 className="settings-section-title">Tags & Trends</h3>

                <div className="settings-subsection">
                  <h4 className="settings-sub-heading">Tag library</h4>
                  <label htmlFor="settings-tags-textarea" className="settings-field-label" style={{ display: 'block', marginBottom: '0.25rem' }}>Add tags (one per line)</label>
                  <textarea
                    id="settings-tags-textarea"
                    rows={5}
                    className="mono input"
                    style={{ width: '100%', marginBottom: '0.75rem' }}
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder={'wall art\nboho decor\nminimalist print\n...'}
                  />
                  <div className="settings-field-row">
                    <div className="settings-field">
                      <label htmlFor="settings-tags-category" className="settings-field-label">Category (optional, applies to all)</label>
                      <input
                        id="settings-tags-category"
                        list="tag-category-options"
                        value={tagsCategory}
                        onChange={(e) => setTagsCategory(e.target.value)}
                        placeholder="e.g. botanical, boho, minimalist"
                      />
                      <datalist id="tag-category-options">
                        {tagCategories.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </div>
                    <button className="btn-primary" onClick={saveTags} disabled={!tagsText.trim()}>Save tags</button>
                    {tagsSavedMessage && (
                      <span className={`mono-sm ${tagsSavedMessage.ok ? 'text-success' : 'text-danger'}`}>
                        {tagsSavedMessage.text}
                      </span>
                    )}
                  </div>

                  <h4 className="settings-sub-heading" style={{ marginTop: '1rem' }}>Current tags</h4>
                  {tagsLoading ? (
                    <p className="empty-state">Loading…</p>
                  ) : tags.length ? (
                    <ul className="settings-compact-list">
                      {tags.map((t) => (
                        <li key={t.id || t.tag_text} className="settings-list-item">
                          <span>{t.tag_text}{t.category ? ` (${t.category})` : ''}</span>
                          <button
                            className="btn-secondary btn-xs"
                            onClick={() => deleteTag(t.id, t.tag_text)}
                            title="Delete tag"
                            aria-label={`Delete tag ${t.tag_text}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty-state">No tags added yet.</p>
                  )}
                </div>

                <div className="settings-subsection">
                  <h4 className="settings-sub-heading">Bulk tools</h4>
                  <div className="settings-actions-row">
                    <label className="settings-inline-action">
                      Import CSV
                      <input type="file" accept=".csv,text/csv" onChange={(e) => importTagsCsv(e.target.files?.[0])} />
                    </label>
                    {tagsCsvMessage && (
                      <span className={`mono-sm ${tagsCsvMessage.ok ? 'text-success' : 'text-danger'}`}>
                        {tagsCsvMessage.text}
                      </span>
                    )}
                    <button className="btn-secondary btn-sm" onClick={previewBackfillTagCategories} disabled={tagsBackfillPreviewLoading || tagsBackfillRunning}>
                      {tagsBackfillPreviewLoading ? 'Checking…' : 'Suggest categories for uncategorized tags'}
                    </button>
                    {tagsBackfillMessage && (
                      <span className={`mono-sm ${tagsBackfillMessage.ok ? 'text-success' : 'text-danger'}`}>
                        {tagsBackfillMessage.text}
                      </span>
                    )}
                  </div>

                  {tagsBackfillPreview && (
                    <div className="settings-readonly-box" style={{ marginTop: '0.75rem' }}>
                      <div className="settings-readonly-header">
                        <h4 className="settings-readonly-title">Preview — nothing saved yet</h4>
                      </div>
                      {tagsBackfillPreview.updates.length ? (
                        <>
                          <p className="text-muted mono-sm" style={{ marginTop: 0 }}>
                            {tagsBackfillPreview.updates.length} of {tagsBackfillPreview.checked} uncategorized tag(s) would be updated:
                          </p>
                          <ul className="settings-compact-list" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                            {tagsBackfillPreview.updates.map((u) => (
                              <li key={u.tagText} className="settings-list-item">
                                <span>{u.tagText} → <strong>{u.category}</strong></span>
                              </li>
                            ))}
                          </ul>
                          <div className="flex-row" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
                            <button className="btn-primary btn-sm" onClick={applyBackfillTagCategories} disabled={tagsBackfillRunning}>
                              Apply {tagsBackfillPreview.updates.length} change{tagsBackfillPreview.updates.length > 1 ? 's' : ''}
                            </button>
                            <button className="btn-secondary btn-sm" onClick={() => setTagsBackfillPreview(null)} disabled={tagsBackfillRunning}>
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="empty-state" style={{ margin: 0 }}>
                            No matches found among {tagsBackfillPreview.checked} uncategorized tag(s) — nothing to apply.
                          </p>
                          <button className="btn-secondary btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => setTagsBackfillPreview(null)}>
                            Close
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="settings-subsection" style={{ marginBottom: 0 }}>
                  <h4 className="settings-sub-heading">Trend list</h4>
                  {trendsLoading ? (
                    <p className="empty-state">Loading…</p>
                  ) : trends.length ? (
                    <ul className="settings-compact-list">
                      {trends.map((t) => (
                        <li key={t.id} className="settings-list-item">
                          <span>{t.term}{t.category ? ` (${t.category})` : ''}</span>
                          <button
                            className="btn-secondary btn-xs"
                            onClick={() => deleteTrend(t.id, t.term)}
                            title="Delete trend"
                            aria-label={`Delete trend ${t.term}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty-state">No trends added yet.</p>
                  )}
                  <div className="flex-row flex-wrap mt-2">
                    <div className="settings-field" style={{ flex: 1, minWidth: '140px' }}>
                      <label htmlFor="settings-trend-term" className="settings-field-label">Trend term</label>
                      <input
                        id="settings-trend-term"
                        value={newTrendTerm}
                        onChange={(e) => setNewTrendTerm(e.target.value)}
                        placeholder="Trend term"
                      />
                    </div>
                    <div className="settings-field" style={{ flex: 1, minWidth: '140px' }}>
                      <label htmlFor="settings-trend-category" className="settings-field-label">Category (optional)</label>
                      <input
                        id="settings-trend-category"
                        list="trend-category-options"
                        value={newTrendCategory}
                        onChange={(e) => setNewTrendCategory(e.target.value)}
                        placeholder="Category (optional)"
                      />
                      <datalist id="trend-category-options">
                        {trendCategories.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </div>
                    <button className="btn-primary btn-sm" onClick={addTrendFromSettings} disabled={!newTrendTerm.trim()}>Add trend</button>
                  </div>
                </div>
              </div>
              )}

              {settingsTab === 'general' && (
              <div className="settings-section-card card settings-full-width-card">
                <h3 className="settings-section-title">Backup & Restore</h3>
                <p className="text-muted mono-sm" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                  Downloads a JSON file with your shop/Midjourney conventions, pipeline settings, product sizes &amp; mockup templates, tag library, and API keys — not job/listing/mockup history. Restoring adds/updates from the file without deleting anything not covered by it.
                </p>
                <div className="settings-actions-row">
                  <button className="btn-primary btn-sm" onClick={downloadConfigBackup}>Download backup</button>
                  <label className="settings-inline-action">
                    Restore from file
                    <input
                      type="file"
                      accept=".json,application/json"
                      disabled={configImporting}
                      onChange={(e) => importConfigBackup(e.target.files?.[0])}
                    />
                  </label>
                </div>
                {configBackupMessage && <p className="text-muted mono-sm" style={{ marginTop: '0.5rem' }}>{configBackupMessage}</p>}
                {configImportMessage && (
                  <p className={`mono-sm ${configImportMessage.ok ? 'text-success' : 'text-danger'}`} style={{ marginTop: '0.5rem' }}>
                    {configImportMessage.text}
                  </p>
                )}
              </div>
              )}

              {settingsTab === 'general' && (
              <div className="settings-section-card card settings-card-defaults">
                <h3 className="settings-section-title">Shop Defaults & Conventions</h3>

                <div className="settings-subsection">
                  <div className="settings-field-row">
                    <div className="settings-field">
                      <label htmlFor="settings-default-price" className="settings-field-label">Default price{savedFlashes.default_price ? <span className="field-saved-hint">Saved</span> : null}</label>
                      <input
                        id="settings-default-price"
                        type="number"
                        step="0.01"
                        min="0"
                        value={settings.default_price || ''}
                        onChange={(e) => setSettings((s) => ({ ...s, default_price: e.target.value }))}
                        onBlur={(e) => saveSettings({ default_price: e.target.value })}
                        placeholder="24.00"
                      />
                    </div>
                    <div className="settings-field" style={{ flex: 1, minWidth: '240px' }}>
                      <label htmlFor="settings-delivery-text" className="settings-field-label">Delivery text{savedFlashes.delivery_text ? <span className="field-saved-hint">Saved</span> : null}</label>
                      <input
                        id="settings-delivery-text"
                        value={settings.delivery_text || ''}
                        onChange={(e) => setSettings((s) => ({ ...s, delivery_text: e.target.value }))}
                        onBlur={(e) => saveSettings({ delivery_text: e.target.value })}
                        placeholder="Digital file, no physical shipment"
                      />
                    </div>
                  </div>
                </div>

                <ShopConventions />

              </div>
              )}

              {settingsTab === 'api-keys' && (
              <div className="settings-section-card card settings-card-keys settings-full-width-card">
                <h3 className="settings-section-title">API Keys</h3>

                <div className="settings-subsection">
                  <p className="text-muted mono-sm" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                    Securely stored API keys for Gemini & Claude providers. Key values are masked after saving.
                  </p>
                  {apiKeysLoading ? (
                    <p className="empty-state">Loading…</p>
                  ) : apiKeys.length ? (
                    <div className="data-table-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Provider</th>
                            <th>Label</th>
                            <th>Key</th>
                            <th>Status</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {apiKeys.map((key) => (
                            <tr key={key.id}>
                              <td className="mono">{key.provider}</td>
                              <td>{key.label || <span className="text-muted">—</span>}</td>
                              <td className="mono mono-sm">{key.maskedKey}</td>
                              <td>
                                <StatusPill variant={key.enabled ? 'success' : 'pending'} ariaLabel={`API key status: ${key.enabled ? 'Enabled' : 'Disabled'}`}>
                                  {key.enabled ? 'Enabled' : 'Disabled'}
                                </StatusPill>
                              </td>
                              <td>
                                <div className="flex-row" style={{ gap: '0.5rem' }}>
                                  <button className="btn-secondary btn-sm" onClick={() => toggleApiKeyEnabled(key)}>
                                    {key.enabled ? 'Disable' : 'Enable'}
                                  </button>
                                  <button className="btn-secondary btn-sm" onClick={() => deleteApiKey(key)}>Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="empty-state">No dashboard-managed keys yet — add one below to enable Gemini/Claude calls.</p>
                  )}

                  <div className="settings-field-row" style={{ marginTop: '1rem' }}>
                    <div className="settings-field">
                      <label htmlFor="settings-key-provider" className="settings-field-label">Provider</label>
                      <select id="settings-key-provider" value={newKeyProvider} onChange={(e) => setNewKeyProvider(e.target.value)}>
                        <option value="gemini">Gemini</option>
                        <option value="claude">Claude</option>
                      </select>
                    </div>
                    <div className="settings-field" style={{ flex: 1, minWidth: '240px' }}>
                      <label htmlFor="settings-key-value" className="settings-field-label">Key value</label>
                      <input
                        id="settings-key-value"
                        type="password"
                        value={newKeyValue}
                        onChange={(e) => setNewKeyValue(e.target.value)}
                        placeholder="Paste API key"
                      />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="settings-key-label" className="settings-field-label">Label (optional)</label>
                      <input
                        id="settings-key-label"
                        value={newKeyLabel}
                        onChange={(e) => setNewKeyLabel(e.target.value)}
                        placeholder="e.g. backup key"
                      />
                    </div>
                    <button className="btn-primary" onClick={addApiKey} disabled={!newKeyValue.trim()}>Add key</button>
                  </div>
                  {apiKeysMessage && <p className="text-muted mono-sm" style={{ marginTop: '0.5rem' }}>{apiKeysMessage}</p>}
                </div>
              </div>
              )}

              {settingsTab === 'general' && (
              <div className="settings-section-card card settings-card-modules settings-full-width-card">
                <h3 className="settings-section-title">Pipeline Modules</h3>

                <div className="settings-subsection" style={{ marginBottom: 0 }}>
                  <p className="text-muted mono-sm" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                    This is the <strong>saved default</strong> used for every future upload. For a one-time change on a single upload instead, use the Pipeline toggles on the Upload page — those apply only to that run and don&apos;t affect this default.
                  </p>
                  <div className="flex-row flex-wrap" style={{ gap: '1.5rem' }}>
                    {pipelineDefault?.pipeline?.map((m) => (
                      <label
                        key={m.module}
                        className="settings-checkbox-row"
                        style={{ opacity: m.required ? 0.6 : 1, cursor: m.required ? 'not-allowed' : 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={!!m.enabled}
                          disabled={m.required}
                          onChange={() => togglePersistedModule(m.module, m.enabled, m.required)}
                        />
                        {m.module}
                        {m.required ? <span className="text-muted mono-sm"> (required)</span> : null}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              )}

              {settingsTab === 'automation' && (
              <div className="settings-section-card card settings-card-automation settings-full-width-card">
                <h3 className="settings-section-title">Automation & Diagnostics</h3>

                <div className="settings-subsection">
                  <h4 className="settings-sub-heading">Auto-import from folder</h4>
                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={settings.taste_filter_watch_enabled === 'true'}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setSettings((s) => ({ ...s, taste_filter_watch_enabled: String(enabled) }));
                        saveWatchSetting({ taste_filter_watch_enabled: enabled });
                      }}
                    />
                    Auto-import from folder
                  </label>
                  <div className="settings-field-row">
                    <div className="settings-field" style={{ flex: 1, minWidth: '260px' }}>
                      <label htmlFor="settings-watched-folder" className="settings-field-label">Watched folder path{savedFlashes.taste_filter_watch_folder ? <span className="field-saved-hint">Saved</span> : null}</label>
                      <input
                        id="settings-watched-folder"
                        value={settings.taste_filter_watch_folder || ''}
                        onChange={(e) => setSettings((s) => ({ ...s, taste_filter_watch_folder: e.target.value }))}
                        onBlur={(e) => saveWatchSetting({ taste_filter_watch_folder: e.target.value })}
                        placeholder="/home/you/midjourney-downloads"
                      />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="settings-watch-category" className="settings-field-label">Category (optional){savedFlashes.taste_filter_watch_category ? <span className="field-saved-hint">Saved</span> : null}</label>
                      <input
                        id="settings-watch-category"
                        value={settings.taste_filter_watch_category || ''}
                        onChange={(e) => setSettings((s) => ({ ...s, taste_filter_watch_category: e.target.value }))}
                        onBlur={(e) => saveWatchSetting({ taste_filter_watch_category: e.target.value })}
                        placeholder="e.g. square-canvas"
                      />
                    </div>
                  </div>
                  {watchStatus && (
                    <p className="text-muted mono-sm" style={{ marginTop: '0.75rem' }}>
                      <span style={{ color: watchStatus.active ? 'var(--state-success)' : 'var(--state-pending)', fontWeight: 600 }}>{watchStatus.active ? 'Active' : 'Inactive'}</span> {watchStatus.active ? `— Watching ${watchStatus.folder}` : '— Not currently watching'}
                      {watchStatus.category ? ` (category: ${watchStatus.category})` : ''}
                      {watchStatus.pendingCount ? ` — ${watchStatus.pendingCount} pending` : ''}
                      {watchStatus.lastError ? ` — ${watchStatus.lastError}` : ''}
                    </p>
                  )}
                </div>

                <div className="settings-subsection">
                  <h4 className="settings-sub-heading">Taste filter auto-sort</h4>
                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={settings.taste_filter_auto_enabled === 'true'}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setSettings((s) => ({ ...s, taste_filter_auto_enabled: String(enabled) }));
                        saveSettings({ taste_filter_auto_enabled: enabled });
                      }}
                    />
                    Auto-compute taste threshold
                  </label>
                  <div className="settings-field" style={{ maxWidth: '200px', opacity: settings.taste_filter_auto_enabled === 'true' ? 1 : 0.6 }}>
                    <label htmlFor="settings-auto-threshold" className="settings-field-label">Auto threshold (score cutoff){settings.taste_filter_auto_enabled === 'true' ? '' : ' (inactive — enable auto-compute above)'}{savedFlashes.taste_filter_auto_threshold ? <span className="field-saved-hint">Saved</span> : null}</label>
                    <input
                      id="settings-auto-threshold"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      disabled={settings.taste_filter_auto_enabled !== 'true'}
                      value={settings.taste_filter_auto_threshold ?? ''}
                      onChange={(e) => setSettings((s) => ({ ...s, taste_filter_auto_threshold: e.target.value }))}
                      onBlur={(e) => saveSettings({ taste_filter_auto_threshold: e.target.value })}
                      placeholder="0.3"
                    />
                  </div>
                </div>

                <div className="settings-subsection" style={{ marginBottom: 0 }}>
                  <div className="settings-readonly-box">
                    <div className="settings-readonly-header">
                      <h4 className="settings-readonly-title">LLM rate-limit status</h4>
                      <div className="flex-row" style={{ gap: '0.5rem' }}>
                        {rateLimitsUpdatedAt && (
                          <span className="text-muted mono-sm">Updated {rateLimitsUpdatedAt.toLocaleTimeString()}</span>
                        )}
                        <button className="btn-secondary btn-xs" onClick={refreshRateLimits} title="Refresh rate-limit status" aria-label="Refresh rate-limit status">⟳</button>
                        <span className="read-only-badge">Read-only</span>
                      </div>
                    </div>
                    {rateLimitsLoading ? (
                      <p className="empty-state" style={{ margin: 0 }}>Loading…</p>
                    ) : rateLimits.length ? (
                      <div className="data-table-wrapper">
                        <table className="data-table" style={{ marginBottom: 0 }}>
                          <thead>
                            <tr>
                              <th>Key #</th>
                              <th>Model</th>
                              <th>Status</th>
                              <th>Consecutive hits</th>
                              <th>Limited until</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rateLimits.map((r) => (
                              <tr key={`${r.keyIndex}-${r.model}`}>
                                <td className="mono">{r.keyIndex}</td>
                                <td className="mono">{r.model}</td>
                                <td>
                                  <StatusPill variant={r.currentlyLimited ? 'danger' : 'success'} ariaLabel={`Rate limit status: ${r.currentlyLimited ? 'Cooling down' : 'OK'}`}>
                                    {r.currentlyLimited ? 'Cooling down' : 'OK'}
                                  </StatusPill>
                                </td>
                                <td>{r.consecutiveHits}</td>
                                <td className="text-muted mono mono-sm">{r.currentlyLimited ? r.limitedUntil : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="empty-state" style={{ margin: 0 }}>No key/model pair has hit a rate limit yet.</p>
                    )}
                  </div>
                </div>
              </div>
              )}
              </div>
            </div>
          )}

          {activeView === 'upload' && (
            <section className="paper-card card upload-pipeline-card">
              <div className="upload-header-row">
                <div>
                  <h2 style={{ marginTop: 0, marginBottom: '0.25rem' }}>Upload & Curation Pipeline</h2>
                  <p className="upload-subtitle text-muted">Upload candidate images and curate them through the pipeline.</p>
                </div>
                <button
                  className="btn-secondary btn-sm how-it-works-btn"
                  onClick={() => setShowHowItWorks((prev) => !prev)}
                  type="button"
                >
                  <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  How it works
                </button>
              </div>

              {showHowItWorks && (
                <div className="how-it-works-info-box">
                  <strong>How the pipeline works:</strong>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '12.5px' }}>
                    Upload candidate images to score them with the Taste Filter curation model. High-scoring candidates can be promoted straight to full listing and mockup processing.
                  </p>
                </div>
              )}

              <div className="upload-lane">
                <h3 style={{ marginTop: 0 }}>Curation</h3>
                <TasteFilter overrides={overrides} refreshJobs={refreshJobs} />
              </div>

              <details className="upload-lane-collapsible">
                <summary className="direct-upload-summary">
                  <div className="direct-upload-title-group">
                    <svg className="summary-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span>Direct upload (skips curation — uploads go straight into the pipeline)</span>
                  </div>
                  <svg className="summary-chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </summary>
                <div className="upload-lane">
                  <h3>Pipeline</h3>
                  <p className="text-muted" style={{ marginTop: 0 }}>
                    These toggles apply <strong>only to artwork uploaded next</strong> — they don&apos;t change your saved default.
                    To change what every future upload starts with, go to <strong>Settings → Pipeline Modules</strong>.
                  </p>
                  <div className="flex-row flex-wrap" style={{ gap: '1.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                    {pipelineDefault?.pipeline?.map((m) => {
                      const isModified = !m.required && !!overrides[m.module] !== !!m.enabled;
                      return (
                        <label key={m.module} style={{ opacity: m.required ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: m.required ? 'not-allowed' : 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={!!overrides[m.module]}
                            disabled={m.required}
                            onChange={() => toggleModule(m.module, m.required)}
                          />
                          <span>{m.module}</span>
                          {m.required ? <span className="text-muted mono-sm">(required)</span> : null}
                          {isModified ? <span className="text-muted mono-sm" title="Different from your saved default, for this upload only"> (changed for this upload)</span> : null}
                        </label>
                      );
                    })}
                  </div>
                  {pipelineDefault?.pipeline?.some((m) => !m.required && !!overrides[m.module] !== !!m.enabled) && (
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      style={{ marginBottom: '1rem' }}
                      onClick={() => setOverrides(Object.fromEntries(pipelineDefault.pipeline.map((m) => [m.module, m.enabled])))}
                    >
                      Reset to saved default
                    </button>
                  )}

                  <div
                    className={`dropzone ${dragActive ? 'active' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={onDrop}
                  >
                    <p className="dropzone-title">Drag and drop artwork here (bulk supported)</p>
                    <p>or browse files from your computer</p>
                    <div style={{ marginTop: '1rem', display: 'inline-block' }}>
                      <input type="file" multiple accept="image/*" onChange={(e) => handleFiles(e.target.files)} />
                    </div>
                    {uploadStatus && <p className="mono taste-status" style={{ marginTop: '1rem' }}>{uploadStatus}</p>}
                  </div>
                </div>
              </details>

            </section>
          )}

          {activeView === 'history' && (
            <section className="paper-card card">
              <h2 style={{ marginTop: 0 }}>Listing History</h2>
              {jobs.length === 0 ? (
                <div className="empty-state-box" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--studio-ink-soft)' }}>
                  <svg style={{ width: '40px', height: '40px', opacity: 0.5, marginBottom: '0.75rem' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 3" />
                  </svg>
                  <p className="empty-state" style={{ margin: 0, fontStyle: 'normal', fontWeight: 500, fontSize: '13.5px' }}>No jobs yet — drop some artwork on the Upload view to get started.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Artwork</th>
                        <th>Status</th>
                        <th>Updated</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {groupedJobs.map((entry) => {
                        if (entry.type === 'single') {
                          const job = entry.job;
                          return (
                            <tr key={job.id}>
                              <td className="mono">#{job.id}</td>
                              <td style={{ wordBreak: 'break-all' }}>{job.artwork_file_path?.split('/').pop()}</td>
                              <td><StatusBadge status={job.overall_status} /></td>
                              <td className="text-muted mono mono-sm">{job.updated_at}</td>
                              <td>
                                <button className="btn-secondary btn-sm" onClick={() => openJob(job.id)}>
                                  <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                  Review
                                </button>
                              </td>
                            </tr>
                          );
                        }

                        const { batchId, jobs: batchJobs } = entry;
                        const expanded = !!expandedBatches[batchId];
                        const statusCountsForBatch = batchJobs.reduce((acc, j) => {
                          acc[j.overall_status] = (acc[j.overall_status] || 0) + 1;
                          return acc;
                        }, {});
                        const mostRecentUpdate = batchJobs.reduce(
                          (latest, j) => (j.updated_at > latest ? j.updated_at : latest),
                          batchJobs[0].updated_at
                        );
                        return (
                          <>
                            <tr key={`batch-${batchId}`} style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                              <td className="mono">
                                <button
                                  className="btn-secondary btn-sm"
                                  onClick={() => setExpandedBatches((prev) => ({ ...prev, [batchId]: !prev[batchId] }))}
                                  aria-label={expanded ? 'Collapse batch' : 'Expand batch'}
                                  title={expanded ? 'Collapse batch' : 'Expand batch'}
                                >
                                  {expanded ? '▾' : '▸'}
                                </button>
                              </td>
                              <td style={{ fontWeight: 600 }}>Batch — {batchJobs.length} artwork{batchJobs.length > 1 ? 's' : ''}</td>
                              <td>
                                <div className="flex-row flex-wrap" style={{ gap: '0.35rem' }}>
                                  {Object.entries(statusCountsForBatch).map(([status, count]) => (
                                    <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <StatusBadge status={status} /> <span className="text-muted mono mono-sm">x{count}</span>
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="text-muted mono mono-sm">{mostRecentUpdate}</td>
                              <td />
                            </tr>
                            {expanded && batchJobs.map((job) => (
                              <tr key={job.id} style={{ opacity: 0.9 }}>
                                <td className="mono" style={{ paddingLeft: '1.5rem' }}>#{job.id}</td>
                                <td style={{ wordBreak: 'break-all' }}>{job.artwork_file_path?.split('/').pop()}</td>
                                <td><StatusBadge status={job.overall_status} /></td>
                                <td className="text-muted mono mono-sm">{job.updated_at}</td>
                                <td>
                                  <button className="btn-secondary btn-sm" onClick={() => openJob(job.id)}>
                                    <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                      <circle cx="12" cy="12" r="3" />
                                    </svg>
                                    Review
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeView === 'review' && (
            <section className="paper-card" style={{ padding: 0, background: 'transparent', border: 'none', boxShadow: 'none' }}>
              <div className="paper-card card" style={{ marginBottom: '1rem' }}>
                <h2 style={{ marginTop: 0, marginBottom: '1rem' }}>Job Workspace</h2>
                <div className="settings-field-row" style={{ alignItems: 'flex-start' }}>
                  <div className="settings-field" style={{ flex: 1, minWidth: '220px' }}>
                    <label htmlFor="review-job-picker" className="settings-field-label">Pick a recent job</label>
                    <select
                      id="review-job-picker"
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        setJobIdInput(e.target.value);
                        setActiveJobId(e.target.value);
                        setReviewTab('analysis');
                      }}
                      disabled={!recentJobsSorted.length}
                    >
                      <option value="">{recentJobsSorted.length ? 'Select a job…' : 'No jobs yet'}</option>
                      {recentJobsSorted.slice(0, 25).map((j) => (
                        <option key={j.id} value={j.id}>
                          #{j.id} — {j.artwork_file_path?.split('/').pop() || 'untitled'} ({j.overall_status || 'pending'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-field">
                    <span className="settings-field-label">Or enter a Job ID directly</span>
                    <input
                      type="number"
                      placeholder="Job ID"
                      value={jobIdInput}
                      onChange={(e) => setJobIdInput(e.target.value)}
                      style={{ maxWidth: '160px' }}
                    />
                  </div>
                  <button className="btn-primary" onClick={() => { setActiveJobId(jobIdInput); setReviewTab('analysis'); }} disabled={!jobIdInput} style={{ height: '34px', marginTop: '1.25rem' }}>
                    Load job
                  </button>
                </div>
              </div>

              {activeJobId && activeJobInfo ? (
                <div>
                  <div className="workspace-artwork-preview-card">
                    {activeJobInfo.filePath && (
                      <img
                        src={`/artwork-files/${activeJobInfo.filePath.split('/').pop()}`}
                        alt={activeJobInfo.filename}
                        className="workspace-artwork-preview-img"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    )}
                    <div className="workspace-artwork-preview-info">
                      <span className="workspace-artwork-preview-filename">{activeJobInfo.filename}</span>
                      <span className="workspace-artwork-preview-jobid">Job ID: #{activeJobInfo.id} · <span className={`text-muted`}>{activeJobInfo.status}</span></span>
                    </div>
                  </div>

                  <div className="workspace-tabs">
                    <button
                      className={`workspace-tab-btn ${reviewTab === 'analysis' ? 'active' : ''}`}
                      onClick={() => setReviewTab('analysis')}
                    >
                      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px' }}>
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      Image Analysis
                    </button>
                    <button
                      className={`workspace-tab-btn ${reviewTab === 'listings' ? 'active' : ''}`}
                      onClick={() => setReviewTab('listings')}
                    >
                      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px' }}>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                      Listings
                    </button>
                    <button
                      className={`workspace-tab-btn ${reviewTab === 'mockups' ? 'active' : ''}`}
                      onClick={() => setReviewTab('mockups')}
                    >
                      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px' }}>
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                      Mockups
                    </button>
                  </div>

                  <div className="workspace-panel-body">
                    <div style={{ display: reviewTab === 'analysis' ? 'block' : 'none' }}>
                      <JobArtworkAnalysisReview jobId={activeJobId} />
                    </div>
                    <div style={{ display: reviewTab === 'listings' ? 'block' : 'none' }}>
                      <JobListingReview jobId={activeJobId} />
                    </div>
                    <div style={{ display: reviewTab === 'mockups' ? 'block' : 'none' }}>
                      <JobMockupReview jobId={activeJobId} />
                    </div>
                  </div>
                </div>
              ) : recentJobsSorted.length ? (
                <div className="paper-card card">
                  <p className="text-muted mono-sm" style={{ marginTop: 0 }}>Or pick a recent job:</p>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Job</th>
                          <th>Artwork</th>
                          <th>Status</th>
                          <th>Updated</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {recentJobsSorted.slice(0, 10).map((job) => (
                          <tr key={job.id}>
                            <td className="mono">#{job.id}</td>
                            <td style={{ wordBreak: 'break-all' }}>{job.artwork_file_path?.split('/').pop()}</td>
                            <td><StatusBadge status={job.overall_status} /></td>
                            <td className="text-muted mono mono-sm">{job.updated_at}</td>
                            <td>
                              <button className="btn-secondary btn-sm" onClick={() => openJob(job.id)}>Review</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="paper-card card">
                  <p className="empty-state">No jobs yet — drop some artwork on the Upload view to get started.</p>
                </div>
              )}
            </section>
          )}

          {activeView === 'prompt-helper' && (
            <section className="paper-card card">
              <h2 style={{ marginTop: 0 }}>Trend / Prompt Helper</h2>
              <PromptHelper />
            </section>
          )}

          {activeView === 'mockup-templates' && (
            <section className="paper-card card">
              <MockupTemplates />
            </section>
          )}

        </main>
      </div>

      {confirmAction && (
        <div className="modal-overlay" role="presentation" onClick={confirmActionCancel}>
          <div
            className="modal-box"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-message"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="confirm-dialog-message" className="modal-message">{confirmAction.message}</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={confirmActionCancel}>Cancel</button>
              <button className="btn-primary modal-btn-danger" onClick={confirmActionAccept}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;