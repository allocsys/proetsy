import { useEffect, useMemo, useState } from 'react';
import JobArtworkAnalysisReview from './JobArtworkAnalysisReview.jsx';
import JobListingReview from './JobListingReview.jsx';
import JobMockupReview from './JobMockupReview.jsx';
import PromptHelper from './PromptHelper.jsx';
import TasteFilter from './TasteFilter.jsx';

const STATUS_COLORS = {
  pending: '#999',
  running: '#2b6cb0',
  success: '#2f855a',
  failed: '#c53030',
  skipped: '#a0a0a0',
};

function StatusBadge({ status }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.1rem 0.5rem',
        borderRadius: '999px',
        fontSize: '0.75rem',
        color: 'white',
        background: STATUS_COLORS[status] || '#666',
      }}
    >
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
  }, []);

  const sizeKeys = useMemo(() => Object.keys(productSizes || {}), [productSizes]);

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
          body: JSON.stringify({ artwork_id: artwork.id, pipeline_overrides: overrides }),
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
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>ProEtsy</h1>
        <button onClick={() => setShowSettings((s) => !s)}>{showSettings ? 'Close settings' : '⚙ Settings'}</button>
      </div>
      <p style={{ color: '#888' }}>Backend status: {health ? health.status : 'checking...'}</p>

      {setupStatus && !setupStatus.readyToRun && (
        <div style={{ background: '#fff8e1', border: '1px solid #f0c36d', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '1.5rem' }}>
          <strong>Setup incomplete</strong>
          <ul style={{ margin: '0.5rem 0 0' }}>
            <li>{setupStatus.geminiKeyConfigured ? '✅' : '⚠️'} Gemini API key configured (.env)</li>
            <li>{setupStatus.hasTagLibrary ? '✅' : '⚠️'} Tag library has at least one tag — add one below in Settings</li>
            <li>{setupStatus.hasProductSize ? '✅' : '⚠️ (optional)'} At least one product size / mockup template configured</li>
          </ul>
        </div>
      )}

      {showSettings && (
        <section style={{ border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>Settings</h2>

          <h3>Tag library</h3>
          <p style={{ color: '#888', marginTop: 0 }}>Paste tags (one per line, or comma-separated). Module 2 matches listings against this list.</p>
          <textarea
            rows={5}
            style={{ width: '100%', fontFamily: 'monospace' }}
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder={'wall art\nboho decor\nminimalist print\n...'}
          />
          <div>
            <button onClick={saveTags} disabled={!tagsText.trim()}>Save tags</button>
            {tagsSavedMessage && <span style={{ marginLeft: '0.75rem', color: '#666' }}>{tagsSavedMessage}</span>}
          </div>

          <p style={{ color: '#888', marginBottom: '0.25rem' }}>Or import a CSV export from a tag-research tool (needs a <code>tag_text</code>/<code>tag</code>/<code>text</code>/<code>keyword</code> column, and an optional <code>category</code> column):</p>
          <div>
            <input type="file" accept=".csv,text/csv" onChange={(e) => importTagsCsv(e.target.files?.[0])} />
            {tagsCsvMessage && <span style={{ marginLeft: '0.75rem', color: '#666' }}>{tagsCsvMessage}</span>}
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
              style={{ width: '60%' }}
              value={settings.delivery_text || ''}
              onChange={(e) => setSettings((s) => ({ ...s, delivery_text: e.target.value }))}
              onBlur={(e) => saveSettings({ delivery_text: e.target.value })}
              placeholder="Digital file, no physical shipment"
            />
          </label>

          <h3>Trend list</h3>
          <p style={{ color: '#888', marginTop: 0 }}>Shared by Module 2 (trend-aware listing angles) and Module 4 (prompt helper).</p>
          {trends.length ? (
            <ul>
              {trends.map((t) => (
                <li key={t.id}>
                  {t.term}{t.category ? ` (${t.category})` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: '#888' }}>No trends added yet.</p>
          )}
          <div>
            <input
              value={newTrendTerm}
              onChange={(e) => setNewTrendTerm(e.target.value)}
              placeholder="Trend term"
            />{' '}
            <input
              value={newTrendCategory}
              onChange={(e) => setNewTrendCategory(e.target.value)}
              placeholder="Category (optional)"
            />{' '}
            <button onClick={addTrendFromSettings} disabled={!newTrendTerm.trim()}>Add trend</button>
          </div>

          <h3>Shop conventions</h3>
          <p style={{ color: '#888', marginTop: 0 }}>Hardcoded (see ARCHITECTURE.md -> Module 2), shown here read-only for reference.</p>
          {shopConventions ? (
            <ul>
              <li>Title separator: <code>{shopConventions.listing.titleSeparator}</code></li>
              <li>Max title length: {shopConventions.listing.maxTitleLength}</li>
              <li>Tags per listing: {shopConventions.listing.tagsPerListing} (+{shopConventions.listing.tagAlternates} alternates, max {shopConventions.listing.maxTagLength} chars)</li>
              <li>Forbidden title words: {shopConventions.listing.forbiddenTitleWords.join(', ')}</li>
              <li>Midjourney: {shopConventions.midjourney.version}, {shopConventions.midjourney.style}, stylize {shopConventions.midjourney.stylizeMin}–{shopConventions.midjourney.stylizeMax}</li>
            </ul>
          ) : (
            <p style={{ color: '#888' }}>Loading…</p>
          )}

          <h3>Product sizes / mockup templates</h3>
          {sizeKeys.length ? (
            <ul>
              {sizeKeys.map((k) => (
                <li key={k}>
                  <code>{k}</code> — {productSizes[k].dimensions} @ {productSizes[k].dpi}dpi ({productSizes[k].orientation})
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: '#888' }}>None configured yet — edit <code>backend/config/product-sizes.json</code>.</p>
          )}
        </section>
      )}

      <section style={{ border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Pipeline config for this run</h2>
        <p style={{ color: '#888', marginTop: 0 }}>Defaults come from <code>pipeline.config.json</code>; toggles here apply only to artwork uploaded next.</p>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          {pipelineDefault?.pipeline?.map((m) => (
            <label key={m.module} style={{ opacity: m.required ? 0.6 : 1 }}>
              <input
                type="checkbox"
                checked={!!overrides[m.module]}
                disabled={m.required}
                onChange={() => toggleModule(m.module, m.required)}
              />{' '}
              {m.module}
              {m.required ? ' (required)' : ''}
            </label>
          ))}
        </div>
      </section>

      <section
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragActive ? '#2b6cb0' : '#ccc'}`,
          borderRadius: 8,
          padding: '2rem',
          textAlign: 'center',
          marginBottom: '1.5rem',
          background: dragActive ? '#ebf5ff' : 'transparent',
        }}
      >
        <p>Drag and drop artwork here (bulk supported — drop multiple files at once)</p>
        <p style={{ color: '#888' }}>or</p>
        <input type="file" multiple accept="image/*" onChange={(e) => handleFiles(e.target.files)} />
        {uploadStatus && <p style={{ marginTop: '1rem' }}>{uploadStatus}</p>}
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2>Listing history</h2>
        {jobs.length === 0 ? (
          <p style={{ color: '#888' }}>No jobs yet — drop some artwork above to get started.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                <th style={{ padding: '0.4rem' }}>Job</th>
                <th style={{ padding: '0.4rem' }}>Artwork</th>
                <th style={{ padding: '0.4rem' }}>Status</th>
                <th style={{ padding: '0.4rem' }}>Updated</th>
                <th style={{ padding: '0.4rem' }} />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '0.4rem' }}>#{job.id}</td>
                  <td style={{ padding: '0.4rem' }}>{job.artwork_file_path?.split('/').pop()}</td>
                  <td style={{ padding: '0.4rem' }}><StatusBadge status={job.overall_status} /></td>
                  <td style={{ padding: '0.4rem', color: '#888' }}>{job.updated_at}</td>
                  <td style={{ padding: '0.4rem' }}>
                    <button onClick={() => { setActiveJobId(String(job.id)); setJobIdInput(String(job.id)); }}>Review</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2>Review a specific job</h2>
        <div style={{ marginBottom: '1rem' }}>
          <input
            type="number"
            placeholder="Job ID"
            value={jobIdInput}
            onChange={(e) => setJobIdInput(e.target.value)}
          />
          <button onClick={() => setActiveJobId(jobIdInput)} disabled={!jobIdInput}>
            Load job
          </button>
        </div>
        {activeJobId && (
          <>
            <h3>Image analysis</h3>
            <JobArtworkAnalysisReview jobId={activeJobId} />
            <h3>Listings</h3>
            <JobListingReview jobId={activeJobId} />
            <h3>Mockups</h3>
            <JobMockupReview jobId={activeJobId} />
          </>
        )}
      </section>

      <h2>Trend / Prompt Helper (Module 4)</h2>
      <PromptHelper />

      <h2>Taste Filter (Module 7)</h2>
      <TasteFilter />
    </div>
  );
}

export default App;
