import { useEffect, useMemo, useState } from 'react';
import JobArtworkAnalysisReview from './JobArtworkAnalysisReview.jsx';
import JobListingReview from './JobListingReview.jsx';
import JobMockupReview from './JobMockupReview.jsx';
import MockupTemplates from './MockupTemplates.jsx';
import PromptHelper from './PromptHelper.jsx';
import TasteFilter from './TasteFilter.jsx';
import UpdaterStatus from './UpdaterStatus.jsx';

function StatusBadge({ status }) {
  const statusText = status || 'pending';
  return (
    <span className={`status-pill ${statusText}`} aria-label={`Status: ${statusText}`}>
      <span className="status-dot" aria-hidden="true" />
      {statusText}
    </span>
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
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
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

function App() {
  const [health, setHealth] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const [pipelineDefault, setPipelineDefault] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [shopConventions, setShopConventions] = useState(null);
  const [settings, setSettings] = useState({});
  const [trends, setTrends] = useState([]);
  const [newTrendTerm, setNewTrendTerm] = useState('');
  const [newTrendCategory, setNewTrendCategory] = useState('');
  const [tags, setTags] = useState([]);
  const [tagsText, setTagsText] = useState('');
  const [tagsCategory, setTagsCategory] = useState('');
  const [tagsSavedMessage, setTagsSavedMessage] = useState('');
  const [tagsCsvMessage, setTagsCsvMessage] = useState('');
  const [tagsBackfillMessage, setTagsBackfillMessage] = useState('');
  const [tagsBackfillRunning, setTagsBackfillRunning] = useState(false);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  // Shared handler for background/status fetches (refreshJobs, refreshTrends, etc.) so a
  // failed request (backend down, 500, network drop) surfaces to the user instead of
  // silently leaving stale data on screen with no indication anything went wrong. Not used
  // for user-initiated actions that already have their own try/catch + message state
  // (addApiKey, saveTags, backfillTagCategories, etc.) -- those already report inline.
  function reportFetchError(source) {
    return (err) => setFetchError({ source, message: err.message });
  }

  function goTo(view) {
    setActiveView(view);
    if (view === 'settings') {
      refreshRateLimits();
      refreshApiKeys();
      refreshPipelineConfig();
    }
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
      .then(setTrends)
      .catch(reportFetchError('refreshTrends'));
  }

  function refreshTags() {
    fetch('/api/tags')
      .then((r) => r.json())
      .then(setTags)
      .catch(reportFetchError('refreshTags'));
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
      .then(setRateLimits)
      .catch(reportFetchError('refreshRateLimits'));
  }

  function refreshApiKeys() {
    fetch('/api/settings/api-keys')
      .then((r) => r.json())
      .then(setApiKeys)
      .catch(reportFetchError('refreshApiKeys'));
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
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'unreachable' }));

    fetch('/api/config/pipeline')
      .then((r) => r.json())
      .then((cfg) => {
        setPipelineDefault(cfg);
        setOverrides(Object.fromEntries(cfg.pipeline.map((m) => [m.module, m.enabled])));
      })
      .catch(reportFetchError('pipelineConfig (initial load)'));

    fetch('/api/config/shop-conventions').then((r) => r.json()).then(setShopConventions).catch(reportFetchError('shopConventions'));
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
      const jobIds = [];
      for (const artwork of artworks) {
        const jobRes = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artwork_id: artwork.id, pipeline_overrides: overrides, batch_id: batchId }),
        });
        const job = await jobRes.json();
        jobIds.push(job.id);
      }
      refreshJobs();

      setUploadStatus(`Running pipeline for ${jobIds.length} job${jobIds.length > 1 ? 's' : ''} on the server… (bulk mode — each runs independently; safe to navigate away)`);
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
    setTagsSavedMessage(res.ok ? `Saved. ${data.inserted} new tag(s), ${data.total} total.` : data.error);
    setTagsText('');
    refreshSetupStatus();
    refreshTags();
  }

  async function importTagsCsv(file) {
    if (!file) return;
    setTagsCsvMessage(`Importing ${file.name}…`);
    try {
      const csv = await file.text();
      const res = await fetch('/api/tags/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      setTagsCsvMessage(res.ok ? `Imported ${data.inserted} new tag(s) from ${file.name}.` : data.error);
    } catch (err) {
      setTagsCsvMessage(`Import failed: ${err.message}`);
    }
    refreshSetupStatus();
    refreshTags();
  }

  async function backfillTagCategories() {
    setTagsBackfillRunning(true);
    setTagsBackfillMessage('Checking uncategorized tags…');
    try {
      const res = await fetch('/api/tags/backfill-categories', { method: 'POST' });
      let data;
      try {
        data = await res.json();
      } catch {
        // res.json() only throws like this on an empty/non-JSON body -- not a missing
        // JSON file (this route never reads one). In practice this means nothing was
        // listening on the other end of the fetch, so say that plainly instead of
        // surfacing the raw 'Unexpected end of JSON input' parse error.
        throw new Error(`No response from backend (status ${res.status}). Is the backend server running?`);
      }
      setTagsBackfillMessage(
        res.ok
          ? `Backfilled ${data.updated} of ${data.checked} uncategorized tag(s).`
          : data.error
      );
    } catch (err) {
      setTagsBackfillMessage(`Backfill failed: ${err.message}`);
    }
    setTagsBackfillRunning(false);
    refreshTags();
  }

  async function saveSettings(updates) {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    setSettings(await res.json());
  }

  async function saveWatchSetting(updates) {
    await saveSettings(updates);
    refreshWatchStatus();
  }

  // plan.md -> "Editable Settings & API Keys from Dashboard" -> Frontend step 1. Full key
  // values only ever leave the input field here on the way to POST -- every response from
  // the backend (including this add call's own response) only ever contains maskedKey,
  // never key_value, so nothing round-trips the raw value back into state.
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
    if (!window.confirm(`Delete ${key.provider} key${key.label ? ` "${key.label}"` : ''} (${key.maskedKey})? This can't be undone.`)) return;
    await fetch(`/api/settings/api-keys/${key.id}`, { method: 'DELETE' });
    refreshApiKeys();
  }

  // plan.md -> Frontend step 2: dashboard-editable pipeline module toggles, backed by
  // the same `pipeline_module_<name>_enabled` settings keys getPipelineConfig() reads
  // (backend/config/index.js). Distinct from toggleModule()/`overrides` above, which is
  // a per-upload-session override that's never persisted -- this PATCHes the saved
  // default straight away, then re-fetches so pipelineDefault (and the Upload view's
  // checkboxes, which start from it) reflect the new default immediately.
  async function togglePersistedModule(moduleName, currentlyEnabled, required) {
    if (required) return;
    await saveSettings({ [`pipeline_module_${moduleName}_enabled`]: !currentlyEnabled });
    refreshPipelineConfig();
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
      <header className="app-titlebar glass-nav">
        <div className="wordmark-container">
          <div className="wordmark-crop">
            <h1 className="wordmark">ProEtsy</h1>
          </div>
          <span className="status-pill success" aria-label="Status: Local Print Pipeline active">
            <span className="status-dot" aria-hidden="true" />
            Local Print Pipeline
          </span>
        </div>
        <div className="header-right">
          <span className="text-muted mono-sm">
            Backend:{' '}
            <strong style={{ color: health?.status === 'unreachable' ? 'var(--state-danger)' : 'var(--state-success)' }}>
              {health ? health.status : 'checking...'}
            </strong>
          </span>
          <UpdaterStatus />
          <button className="btn-secondary" onClick={() => goTo(activeView === 'settings' ? 'upload' : 'settings')}>
            {activeView === 'settings' ? 'Close settings' : '⚙ Settings'}
          </button>
        </div>
      </header>

      <div className="mobile-nav-strip glass-nav">
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
        <nav className={`sidebar glass-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-toggle-row">
            <button
              className="sidebar-toggle-btn"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? '»' : '«'}
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
                <li>{setupStatus.geminiKeyConfigured ? '✅' : '⚠️'} Gemini API key configured — add one below in Settings</li>
                <li>{setupStatus.hasTagLibrary ? '✅' : '⚠️'} Tag library has at least one tag — add one below in Settings</li>
                <li>{setupStatus.hasProductSize ? '✅' : '⚠️ (optional)'} At least one product size / mockup template configured</li>
              </ul>
            </div>
          )}

          {activeView === 'settings' && (
            <div>
              <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Shop Settings & Tag Library</h2>

              <div className="settings-section-card glass-card">
                <h3 className="settings-section-title">Tags & Trends</h3>

                <div className="settings-subsection">
                  <h4 className="settings-sub-heading">Tag library</h4>
                  <textarea
                    rows={5}
                    className="mono glass-input"
                    style={{ width: '100%', marginBottom: '0.75rem' }}
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder={'wall art\nboho decor\nminimalist print\n...'}
                  />
                  <div className="settings-field-row">
                    <div className="settings-field">
                      <span className="settings-field-label">Category (optional, applies to all)</span>
                      <input
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
                    {tagsSavedMessage && <span className="text-muted mono-sm">{tagsSavedMessage}</span>}
                  </div>
                </div>

                <div className="settings-subsection">
                  <h4 className="settings-sub-heading">Bulk tools</h4>
                  <div className="settings-actions-row">
                    <label className="settings-inline-action">
                      Import CSV
                      <input type="file" accept=".csv,text/csv" onChange={(e) => importTagsCsv(e.target.files?.[0])} />
                    </label>
                    {tagsCsvMessage && <span className="text-muted mono-sm">{tagsCsvMessage}</span>}
                    <button onClick={backfillTagCategories} disabled={tagsBackfillRunning}>
                      Suggest categories for uncategorized tags
                    </button>
                    {tagsBackfillMessage && <span className="text-muted mono-sm">{tagsBackfillMessage}</span>}
                  </div>
                </div>

                <div className="settings-subsection" style={{ marginBottom: 0 }}>
                  <h4 className="settings-sub-heading">Trend list</h4>
                  {trends.length ? (
                    <ul className="settings-compact-list">
                      {trends.map((t) => (
                        <li key={t.id}>
                          {t.term}{t.category ? ` (${t.category})` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty-state">No trends added yet.</p>
                  )}
                  <div className="flex-row flex-wrap mt-2">
                    <input
                      value={newTrendTerm}
                      onChange={(e) => setNewTrendTerm(e.target.value)}
                      placeholder="Trend term"
                    />
                    <input
                      value={newTrendCategory}
                      onChange={(e) => setNewTrendCategory(e.target.value)}
                      placeholder="Category (optional)"
                    />
                    <button onClick={addTrendFromSettings} disabled={!newTrendTerm.trim()}>Add trend</button>
                  </div>
                </div>
              </div>

              <div className="settings-section-card glass-card">
                <h3 className="settings-section-title">Shop Defaults & Conventions</h3>

                <div className="settings-subsection">
                  <div className="settings-field-row">
                    <div className="settings-field">
                      <span className="settings-field-label">Default price</span>
                      <input
                        value={settings.default_price || ''}
                        onChange={(e) => setSettings((s) => ({ ...s, default_price: e.target.value }))}
                        onBlur={(e) => saveSettings({ default_price: e.target.value })}
                        placeholder="24.00"
                      />
                    </div>
                    <div className="settings-field" style={{ flex: 1, minWidth: '240px' }}>
                      <span className="settings-field-label">Delivery text</span>
                      <input
                        value={settings.delivery_text || ''}
                        onChange={(e) => setSettings((s) => ({ ...s, delivery_text: e.target.value }))}
                        onBlur={(e) => saveSettings({ delivery_text: e.target.value })}
                        placeholder="Digital file, no physical shipment"
                      />
                    </div>
                  </div>
                </div>

                <div className="settings-subsection">
                  <div className="settings-readonly-box">
                    <div className="settings-readonly-header">
                      <h4 className="settings-readonly-title">Shop conventions</h4>
                      <span className="read-only-badge">Read-only</span>
                    </div>
                    {shopConventions ? (
                      <ul className="settings-compact-list">
                        <li>Title separator: <code>{shopConventions.listing.titleSeparator}</code></li>
                        <li>Max title length: {shopConventions.listing.maxTitleLength}</li>
                        <li>Tags per listing: {shopConventions.listing.tagsPerListing} (+{shopConventions.listing.tagAlternates} alternates, max {shopConventions.listing.maxTagLength} chars)</li>
                        <li>Forbidden title words: {shopConventions.listing.forbiddenTitleWords.join(', ')}</li>
                        <li>Midjourney: {shopConventions.midjourney.version}, {shopConventions.midjourney.style}, stylize {shopConventions.midjourney.stylizeMin}–{shopConventions.midjourney.stylizeMax}</li>
                      </ul>
                    ) : (
                      <p className="empty-state" style={{ margin: 0 }}>Loading…</p>
                    )}
                  </div>
                </div>

              </div>

              <div className="settings-section-card glass-card">
                <h3 className="settings-section-title">API Keys</h3>

                <div className="settings-subsection">
                  <p className="text-muted" style={{ marginTop: 0 }}>
                    Keys are stored in the database — this is the only place the app reads API keys from. Values are never shown again after saving — only the last 4 characters are kept visible.
                  </p>
                  {apiKeys.length ? (
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
                            <td>{key.enabled ? '✅ Enabled' : '⚪ Disabled'}</td>
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
                  ) : (
                    <p className="empty-state">No dashboard-managed keys yet — add one below to enable Gemini/Claude calls.</p>
                  )}

                  <div className="settings-field-row" style={{ marginTop: '1rem' }}>
                    <div className="settings-field">
                      <span className="settings-field-label">Provider</span>
                      <select value={newKeyProvider} onChange={(e) => setNewKeyProvider(e.target.value)}>
                        <option value="gemini">Gemini</option>
                        <option value="claude">Claude</option>
                      </select>
                    </div>
                    <div className="settings-field" style={{ flex: 1, minWidth: '240px' }}>
                      <span className="settings-field-label">Key value</span>
                      <input
                        type="password"
                        value={newKeyValue}
                        onChange={(e) => setNewKeyValue(e.target.value)}
                        placeholder="Paste API key"
                      />
                    </div>
                    <div className="settings-field">
                      <span className="settings-field-label">Label (optional)</span>
                      <input
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

              <div className="settings-section-card glass-card">
                <h3 className="settings-section-title">Pipeline Modules</h3>

                <div className="settings-subsection" style={{ marginBottom: 0 }}>
                  <p className="text-muted" style={{ marginTop: 0 }}>
                    Default enable/disable for each pipeline module. Applies to new uploads going forward — matches the checkboxes on the Upload view, but saved here instead of one-off per session.
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

              <div className="settings-section-card glass-card">
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
                      <span className="settings-field-label">Watched folder path</span>
                      <input
                        value={settings.taste_filter_watch_folder || ''}
                        onChange={(e) => setSettings((s) => ({ ...s, taste_filter_watch_folder: e.target.value }))}
                        onBlur={(e) => saveWatchSetting({ taste_filter_watch_folder: e.target.value })}
                        placeholder="/home/you/midjourney-downloads"
                      />
                    </div>
                    <div className="settings-field">
                      <span className="settings-field-label">Category (optional)</span>
                      <input
                        value={settings.taste_filter_watch_category || ''}
                        onChange={(e) => setSettings((s) => ({ ...s, taste_filter_watch_category: e.target.value }))}
                        onBlur={(e) => saveWatchSetting({ taste_filter_watch_category: e.target.value })}
                        placeholder="e.g. square-canvas"
                      />
                    </div>
                  </div>
                  {watchStatus && (
                    <p className="text-muted mono-sm" style={{ marginTop: '0.75rem' }}>
                      {watchStatus.active ? `✅ Watching ${watchStatus.folder}` : '⚠️ Not currently watching'}
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
                  <div className="settings-field" style={{ maxWidth: '200px' }}>
                    <span className="settings-field-label">Auto threshold (score cutoff)</span>
                    <input
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
                      <span className="read-only-badge">Read-only</span>
                    </div>
                    {rateLimits.length ? (
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
                              <td>{r.currentlyLimited ? '⚠️ Cooling down' : '✅ OK'}</td>
                              <td>{r.consecutiveHits}</td>
                              <td className="text-muted mono mono-sm">{r.currentlyLimited ? r.limitedUntil : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="empty-state" style={{ margin: 0 }}>No key/model pair has hit a rate limit yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeView === 'upload' && (
            <section className="paper-card glass-card">
              <h2 style={{ marginTop: 0 }}>Upload & Curation Pipeline</h2>

              <div className="upload-lane">
                <h3 style={{ marginTop: 0 }}>Curation</h3>
                <TasteFilter overrides={overrides} refreshJobs={refreshJobs} />
              </div>

              <details className="upload-lane-collapsible">
                <summary>Direct upload (skips curation — uploads go straight into the pipeline)</summary>
                <div className="upload-lane">
                  <h3>Pipeline</h3>
                  <p className="text-muted" style={{ marginTop: 0 }}>Defaults come from <code>pipeline.config.json</code>; toggles here apply only to artwork uploaded next.</p>
                  <div className="flex-row flex-wrap" style={{ gap: '1.5rem', marginBottom: '1.5rem' }}>
                    {pipelineDefault?.pipeline?.map((m) => (
                      <label key={m.module} style={{ opacity: m.required ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: m.required ? 'not-allowed' : 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!overrides[m.module]}
                          disabled={m.required}
                          onChange={() => toggleModule(m.module, m.required)}
                        />
                        <span>{m.module}</span>
                        {m.required ? <span className="text-muted mono-sm">(required)</span> : null}
                      </label>
                    ))}
                  </div>

                  <div
                    className={`dropzone crop-frame ${dragActive ? 'active' : ''}`}
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
            <section className="paper-card glass-card">
              <h2 style={{ marginTop: 0 }}>Listing History</h2>
              {jobs.length === 0 ? (
                <p className="empty-state">No jobs yet — drop some artwork on the Upload view to get started.</p>
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
                                <button onClick={() => openJob(job.id)}>Review</button>
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
                                  <button onClick={() => openJob(job.id)}>Review</button>
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
            <section className="paper-card glass-card">
              <h2 style={{ marginTop: 0 }}>Review a Specific Job</h2>
              <div className="flex-row mb-2">
                <input
                  type="number"
                  placeholder="Job ID"
                  value={jobIdInput}
                  onChange={(e) => setJobIdInput(e.target.value)}
                  style={{ maxWidth: '160px' }}
                />
                <button className="btn-primary" onClick={() => setActiveJobId(jobIdInput)} disabled={!jobIdInput}>
                  Load job
                </button>
              </div>
              {activeJobId ? (
                <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div>
                    <h3 style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.4rem' }}>Image Analysis</h3>
                    <JobArtworkAnalysisReview jobId={activeJobId} />
                  </div>
                  <div>
                    <h3 style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.4rem' }}>Listings</h3>
                    <JobListingReview jobId={activeJobId} />
                  </div>
                  <div>
                    <h3 style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.4rem' }}>Mockups</h3>
                    <JobMockupReview jobId={activeJobId} />
                  </div>
                </div>
              ) : (
                <p className="empty-state">Enter a job ID above, or open one from Listing History.</p>
              )}
            </section>
          )}

          {activeView === 'prompt-helper' && (
            <section className="paper-card glass-card">
              <h2 style={{ marginTop: 0 }}>Trend / Prompt Helper</h2>
              <PromptHelper />
            </section>
          )}

          {activeView === 'mockup-templates' && (
            <section className="paper-card glass-card">
              <MockupTemplates />
            </section>
          )}

        </main>
      </div>
    </div>
  );
}

export default App;
