import { useEffect, useMemo, useState } from 'react';
import JobArtworkAnalysisReview from './JobArtworkAnalysisReview.jsx';
import JobListingReview from './JobListingReview.jsx';
import JobMockupReview from './JobMockupReview.jsx';
import PromptHelper from './PromptHelper.jsx';
import TasteFilter from './TasteFilter.jsx';

function StatusBadge({ status }) {
  return (
    <span className={`status-pill ${status || 'pending'}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}

// Module 6 — Control Dashboard. See ARCHITECTURE.md -> Module 6 for the target feature
// set: drag-and-drop artwork, a per-run pipeline config panel, bulk mode, a listing
// history log, and a settings panel. Individual per-job review screens
// (JobArtworkAnalysisReview / JobListingReview / JobMockupReview) already existed;
// this component is the shell that ties them to real upload + orchestration + history.
function App() {
  const [health, setHealth] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const [pipelineDefault, setPipelineDefault] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [productSizes, setProductSizes] = useState({});
  const [shopConventions, setShopConventions] = useState(null);
  const [settings, setSettings] = useState({});
  const [trends, setTrends] = useState([]);
  const [newTrendTerm, setNewTrendTerm] = useState('');
  const [newTrendCategory, setNewTrendCategory] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [tagsSavedMessage, setTagsSavedMessage] = useState('');
  const [tagsCsvMessage, setTagsCsvMessage] = useState('');
  const [watchStatus, setWatchStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [jobIdInput, setJobIdInput] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  function refreshJobs() {
    fetch('/api/jobs')
      .then((r) => r.json())
      .then(setJobs)
      .catch(() => {});
  }

  function refreshSetupStatus() {
    fetch('/api/setup-status')
      .then((r) => r.json())
      .then(setSetupStatus)
      .catch(() => {});
  }

  function refreshTrends() {
    fetch('/api/trends')
      .then((r) => r.json())
      .then(setTrends)
      .catch(() => {});
  }

  // Module 7 -> "Auto-import via watched folder" (step 7) -> "Activation": read-only
  // status (active/folder/category/pending count/last error) for the Settings panel,
  // driven entirely by the taste_filter_watch_* keys below.
  function refreshWatchStatus() {
    fetch('/api/taste-filter/watch-status')
      .then((r) => r.json())
      .then(setWatchStatus)
      .catch(() => {});
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
      .catch(() => {});

    fetch('/api/config/product-sizes').then((r) => r.json()).then(setProductSizes).catch(() => {});
    fetch('/api/config/shop-conventions').then((r) => r.json()).then(setShopConventions).catch(() => {});
    fetch('/api/settings').then((r) => r.json()).then(setSettings).catch(() => {});
    refreshSetupStatus();
    refreshJobs();
    refreshTrends();
    refreshWatchStatus();
  }, []);

  const sizeKeys = useMemo(() => Object.keys(productSizes || {}), [productSizes]);

  const [expandedBatches, setExpandedBatches] = useState({});

  // Module 6 -> "consolidated single-page 'bulk batch' view": groups jobs sharing the
  // same batch_id (set at creation time for a multi-file drop, see handleFiles below)
  // into one entry, so a bulk drop shows as a single collapsible row in the history table
  // instead of N indistinguishable ones. Jobs without a batch_id (single-artwork uploads)
  // pass through unchanged. Preserves the API's newest-first ordering by grouping at each
  // batch's first-seen position rather than re-sorting.
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

  // Runs a batch of jobs' full pipelines via the server-side runner
  // (backend/lib/pipeline-runner.js), one request for the whole batch instead of the
  // dashboard sequencing each module call itself. Each job still proceeds independently
  // server-side (Partial Failure Handling's bulk-mode rule), and — unlike the old
  // client-side sequencing — the work isn't tied to this browser tab staying open once
  // the request has been sent.
  async function runJobsBatch(jobIds) {
    await fetch('/api/jobs/run-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_ids: jobIds }),
    }).catch(() => {});
    refreshJobs();
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploadStatus(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);

    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));

    // Multi-file drops get a shared batch_id (a client-generated UUID) so the history
    // table below can group their jobs into one row instead of N separate ones. A
    // single-file drop stays ungrouped (batch_id omitted) since there's nothing to group.
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
      // Server-side batch runner: each job proceeds independently, one failure doesn't
      // block the rest, and — unlike the old client-side sequencing — the run isn't
      // cancelled by closing this tab once the request has been sent.
      await runJobsBatch(jobIds);
      setUploadStatus(`Done. ${jobIds.length} job${jobIds.length > 1 ? 's' : ''} processed — see history below.`);
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
      body: JSON.stringify({ tags: tagsText }),
    });
    const data = await res.json();
    setTagsSavedMessage(res.ok ? `Saved. ${data.inserted} new tag(s), ${data.total} total.` : data.error);
    setTagsText('');
    refreshSetupStatus();
  }

  // CSV tag import (ARCHITECTURE.md -> Module 6 -> Settings panel). Reads the picked
  // file as plain text client-side (no upload/multipart route needed for this — it's a
  // small text file) and posts its contents to POST /api/tags/csv, which expects a
  // header row with a tag_text/tag/text/keyword column and an optional category column.
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
  }

  async function saveSettings(updates) {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    setSettings(await res.json());
  }

  // Module 7 -> "Activation": toggling/editing any of the watch settings takes effect
  // immediately server-side (syncWatcherFromSettings runs on every PATCH /api/settings),
  // so re-fetching status right after a save reflects it without a page reload.
  async function saveWatchSetting(updates) {
    await saveSettings(updates);
    refreshWatchStatus();
  }

  // Trend-list management, consolidated into Settings (Module 4's own PromptHelper.jsx
  // keeps its own add-a-trend form too — this is an additional view, not a replacement).
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="wordmark-container">
          <div className="wordmark-crop">
            <h1 className="wordmark">ProEtsy</h1>
          </div>
          <span className="status-pill success">
            <span className="status-dot" />
            Local Print Pipeline
          </span>
        </div>
        <div className="header-right">
          <span className="text-muted" style={{ fontSize: '13px' }}>
            Backend: <strong style={{ color: health?.status === 'unreachable' ? 'var(--state-danger)' : 'var(--state-success)' }}>{health ? health.status : 'checking...'}</strong>
          </span>
          <button className="btn-secondary" onClick={() => setShowSettings((s) => !s)}>
            {showSettings ? 'Close settings' : '⚙ Settings'}
          </button>
        </div>
      </header>

      <div className="mobile-tab-strip">
        <a href="#section-pipeline" className="mobile-tab">Pipeline & Upload</a>
        <a href="#section-history" className="mobile-tab">History</a>
        <a href="#section-review" className="mobile-tab">Review Job</a>
        <a href="#section-prompt-helper" className="mobile-tab">04 Prompt Helper</a>
        <a href="#section-taste-filter" className="mobile-tab">07 Taste Filter</a>
        <a href="#section-settings" className="mobile-tab">Settings</a>
      </div>

      <div className="app-body-layout">
        <nav className="nav-rail">
          <div className="nav-section-title">Pipeline Control</div>
          <a href="#section-pipeline" className="nav-link">Pipeline & Upload</a>
          <a href="#section-history" className="nav-link">Listing History</a>
          <a href="#section-review" className="nav-link">Review a Job</a>
          
          <div className="nav-section-title">Modules</div>
          <a href="#section-prompt-helper" className="nav-link">04 Prompt Helper</a>
          <a href="#section-taste-filter" className="nav-link">07 Taste Filter</a>

          <div className="nav-section-title">Configuration</div>
          <a href="#section-settings" className="nav-link" onClick={(e) => { e.preventDefault(); setShowSettings(true); }}>
            Shop Settings & Tags
          </a>
        </nav>

        <main className="main-content">
          {health && health.status === 'unreachable' && (
            <div className="backend-banner">
              <span>Backend not running — start it with <code className="mono">npm run dev</code> from the backend/ folder.</span>
              <StatusBadge status="pending" />
            </div>
          )}

          {setupStatus && !setupStatus.readyToRun && (
            <div className="setup-alert">
              <strong>Setup incomplete</strong>
              <ul>
                <li>{setupStatus.geminiKeyConfigured ? '✅' : '⚠️'} Gemini API key configured (.env)</li>
                <li>{setupStatus.hasTagLibrary ? '✅' : '⚠️'} Tag library has at least one tag — add one below in Settings</li>
                <li>{setupStatus.hasProductSize ? '✅' : '⚠️ (optional)'} At least one product size / mockup template configured</li>
              </ul>
            </div>
          )}

          {showSettings && (
            <section id="section-settings" className="paper-card">
              <h2 style={{ marginTop: 0 }}>Shop Settings & Tag Library</h2>

              <h3>Tag library</h3>
              <p className="text-muted" style={{ marginTop: 0 }}>Paste tags (one per line, or comma-separated). Module 2 matches listings against this list.</p>
              <textarea
                rows={5}
                className="mono"
                style={{ width: '100%', marginBottom: '1rem' }}
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder={'wall art\nboho decor\nminimalist print\n...'}
              />
              <div className="flex-row mb-2">
                <button onClick={saveTags} disabled={!tagsText.trim()}>Save tags</button>
                {tagsSavedMessage && <span className="text-muted" style={{ fontSize: '13px' }}>{tagsSavedMessage}</span>}
              </div>

              <p className="text-muted" style={{ marginBottom: '0.25rem' }}>Or import a CSV export from a tag-research tool (needs a <code>tag_text</code>/<code>tag</code>/<code>text</code>/<code>keyword</code> column, and an optional <code>category</code> column):</p>
              <div className="flex-row mb-2">
                <input type="file" accept=".csv,text/csv" onChange={(e) => importTagsCsv(e.target.files?.[0])} />
                {tagsCsvMessage && <span className="text-muted" style={{ fontSize: '13px' }}>{tagsCsvMessage}</span>}
              </div>

              <h3>Shop defaults</h3>
              <label style={{ display: 'block', margin: '0.5rem 0' }}>
                Default price:{' '}
                <input
                  value={settings.default_price || ''}
                  onChange={(e) => setSettings((s) => ({ ...s, default_price: e.target.value }))}
                  onBlur={(e) => saveSettings({ default_price: e.target.value })}
                  placeholder="24.00"
                />
              </label>
              <label style={{ display: 'block', margin: '0.5rem 0' }}>
                Delivery text:{' '}
                <input
                  style={{ width: '100%', maxWidth: '600px' }}
                  value={settings.delivery_text || ''}
                  onChange={(e) => setSettings((s) => ({ ...s, delivery_text: e.target.value }))}
                  onBlur={(e) => saveSettings({ delivery_text: e.target.value })}
                  placeholder="Digital file, no physical shipment"
                />
              </label>

              <h3>Trend list</h3>
              <p className="text-muted" style={{ marginTop: 0 }}>Shared by Module 2 (trend-aware listing angles) and Module 4 (prompt helper).</p>
              {trends.length ? (
                <ul style={{ marginBottom: '1rem', paddingLeft: '1.25rem' }}>
                  {trends.map((t) => (
                    <li key={t.id}>
                      {t.term}{t.category ? ` (${t.category})` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">No trends added yet.</p>
              )}
              <div className="flex-row flex-wrap">
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

              <h3>Shop conventions</h3>
              <p className="text-muted" style={{ marginTop: 0 }}>Hardcoded (see ARCHITECTURE.md, Module 2), shown here read-only for reference.</p>
              {shopConventions ? (
                <ul style={{ paddingLeft: '1.25rem' }}>
                  <li>Title separator: <code>{shopConventions.listing.titleSeparator}</code></li>
                  <li>Max title length: {shopConventions.listing.maxTitleLength}</li>
                  <li>Tags per listing: {shopConventions.listing.tagsPerListing} (+{shopConventions.listing.tagAlternates} alternates, max {shopConventions.listing.maxTagLength} chars)</li>
                  <li>Forbidden title words: {shopConventions.listing.forbiddenTitleWords.join(', ')}</li>
                  <li>Midjourney: {shopConventions.midjourney.version}, {shopConventions.midjourney.style}, stylize {shopConventions.midjourney.stylizeMin}–{shopConventions.midjourney.stylizeMax}</li>
                </ul>
              ) : (
                <p className="empty-state">Loading…</p>
              )}

              <h3>Product sizes / mockup templates</h3>
              {sizeKeys.length ? (
                <ul style={{ paddingLeft: '1.25rem' }}>
                  {sizeKeys.map((k) => (
                    <li key={k}>
                      <code>{k}</code> — {productSizes[k].dimensions} @ {productSizes[k].dpi}dpi ({productSizes[k].orientation})
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">None configured yet — edit <code>backend/config/product-sizes.json</code>.</p>
              )}

              <h3>Auto-import from folder (Module 7)</h3>
              <p className="text-muted" style={{ marginTop: 0 }}>
                Watches a local folder for new Midjourney downloads and pulls them into the Taste Filter queue automatically, without a manual drag-and-drop. Off by default.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.5rem 0' }}>
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
              <label style={{ display: 'block', margin: '0.5rem 0' }}>
                Watched folder path:{' '}
                <input
                  style={{ width: '100%', maxWidth: '500px' }}
                  value={settings.taste_filter_watch_folder || ''}
                  onChange={(e) => setSettings((s) => ({ ...s, taste_filter_watch_folder: e.target.value }))}
                  onBlur={(e) => saveWatchSetting({ taste_filter_watch_folder: e.target.value })}
                  placeholder="/home/you/midjourney-downloads"
                />
              </label>
              <label style={{ display: 'block', margin: '0.5rem 0' }}>
                Category (optional):{' '}
                <input
                  value={settings.taste_filter_watch_category || ''}
                  onChange={(e) => setSettings((s) => ({ ...s, taste_filter_watch_category: e.target.value }))}
                  onBlur={(e) => saveWatchSetting({ taste_filter_watch_category: e.target.value })}
                  placeholder="e.g. square-canvas"
                />
              </label>
              {watchStatus && (
                <p className="text-muted" style={{ fontSize: '13px' }}>
                  {watchStatus.active ? `✅ Watching ${watchStatus.folder}` : '⚠️ Not currently watching'}
                  {watchStatus.category ? ` (category: ${watchStatus.category})` : ''}
                  {watchStatus.pendingCount ? ` — ${watchStatus.pendingCount} pending` : ''}
                  {watchStatus.lastError ? ` — ${watchStatus.lastError}` : ''}
                </p>
              )}
            </section>
          )}

          <section id="section-pipeline" className="paper-card">
            <h2 style={{ marginTop: 0 }}>Pipeline Config & Upload</h2>
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
                  {m.required ? <span className="text-muted" style={{ fontSize: '12px' }}>(required)</span> : null}
                </label>
              ))}
            </div>

            <div
              className={`dropzone crop-frame ${dragActive ? 'active' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
            >
              <p style={{ fontWeight: 600, fontSize: '16px', color: 'var(--ink)' }}>Drag and drop artwork here (bulk supported)</p>
              <p>or browse files from your computer</p>
              <div style={{ marginTop: '1rem', display: 'inline-block' }}>
                <input type="file" multiple accept="image/*" onChange={(e) => handleFiles(e.target.files)} />
              </div>
              {uploadStatus && <p className="mono" style={{ marginTop: '1rem', color: 'var(--accent)' }}>{uploadStatus}</p>}
            </div>
          </section>

          <section id="section-history" className="paper-card">
            <h2 style={{ marginTop: 0 }}>Listing History</h2>
            {jobs.length === 0 ? (
              <p className="empty-state">No jobs yet — drop some artwork above to get started.</p>
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
                            <td className="text-muted mono" style={{ fontSize: '13px' }}>{job.updated_at}</td>
                            <td>
                              <button onClick={() => { setActiveJobId(String(job.id)); setJobIdInput(String(job.id)); }}>Review</button>
                            </td>
                          </tr>
                        );
                      }

                      // Bulk batch: one summary row (item count + per-status breakdown),
                      // expandable to the same per-job rows a single upload would show.
                      const { batchId, jobs: batchJobs } = entry;
                      const expanded = !!expandedBatches[batchId];
                      const statusCounts = batchJobs.reduce((acc, j) => {
                        acc[j.overall_status] = (acc[j.overall_status] || 0) + 1;
                        return acc;
                      }, {});
                      const mostRecentUpdate = batchJobs.reduce(
                        (latest, j) => (j.updated_at > latest ? j.updated_at : latest),
                        batchJobs[0].updated_at
                      );
                      return (
                        <>
                          <tr key={`batch-${batchId}`} style={{ background: 'var(--paper-shade, rgba(0,0,0,0.02))' }}>
                            <td className="mono">
                              <button
                                className="btn-secondary"
                                style={{ padding: '0.1rem 0.5rem' }}
                                onClick={() => setExpandedBatches((prev) => ({ ...prev, [batchId]: !prev[batchId] }))}
                              >
                                {expanded ? '▾' : '▸'}
                              </button>
                            </td>
                            <td style={{ fontWeight: 600 }}>Batch — {batchJobs.length} artwork{batchJobs.length > 1 ? 's' : ''}</td>
                            <td>
                              <div className="flex-row flex-wrap" style={{ gap: '0.35rem' }}>
                                {Object.entries(statusCounts).map(([status, count]) => (
                                  <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <StatusBadge status={status} /> <span className="text-muted mono" style={{ fontSize: '12px' }}>x{count}</span>
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="text-muted mono" style={{ fontSize: '13px' }}>{mostRecentUpdate}</td>
                            <td />
                          </tr>
                          {expanded && batchJobs.map((job) => (
                            <tr key={job.id} style={{ opacity: 0.9 }}>
                              <td className="mono" style={{ paddingLeft: '1.5rem' }}>#{job.id}</td>
                              <td style={{ wordBreak: 'break-all' }}>{job.artwork_file_path?.split('/').pop()}</td>
                              <td><StatusBadge status={job.overall_status} /></td>
                              <td className="text-muted mono" style={{ fontSize: '13px' }}>{job.updated_at}</td>
                              <td>
                                <button onClick={() => { setActiveJobId(String(job.id)); setJobIdInput(String(job.id)); }}>Review</button>
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

          <section id="section-review" className="paper-card">
            <h2 style={{ marginTop: 0 }}>Review a Specific Job</h2>
            <div className="flex-row mb-2">
              <input
                type="number"
                placeholder="Job ID"
                value={jobIdInput}
                onChange={(e) => setJobIdInput(e.target.value)}
                style={{ maxWidth: '160px' }}
              />
              <button onClick={() => setActiveJobId(jobIdInput)} disabled={!jobIdInput}>
                Load job
              </button>
            </div>
            {activeJobId && (
              <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div>
                  <h3 style={{ borderBottom: '1px solid var(--hairline-paper)', paddingBottom: '0.4rem' }}>Image Analysis</h3>
                  <JobArtworkAnalysisReview jobId={activeJobId} />
                </div>
                <div>
                  <h3 style={{ borderBottom: '1px solid var(--hairline-paper)', paddingBottom: '0.4rem' }}>Listings</h3>
                  <JobListingReview jobId={activeJobId} />
                </div>
                <div>
                  <h3 style={{ borderBottom: '1px solid var(--hairline-paper)', paddingBottom: '0.4rem' }}>Mockups</h3>
                  <JobMockupReview jobId={activeJobId} />
                </div>
              </div>
            )}
          </section>

          <section id="section-prompt-helper" className="paper-card">
            <h2 style={{ marginTop: 0 }}>04 Trend / Prompt Helper</h2>
            <PromptHelper />
          </section>

          <section id="section-taste-filter" className="paper-card">
            <h2 style={{ marginTop: 0 }}>07 Taste Filter (Curation)</h2>
            <TasteFilter />
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
