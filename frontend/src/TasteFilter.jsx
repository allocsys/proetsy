import { useEffect, useRef, useState } from 'react';
import StatusPill from './components/StatusPill.jsx';

const LABEL_CLASS = {
  'likely-keep': 'success',
  'likely-discard': 'danger',
  uncertain: 'pending',
};

function ScoreBadge({ label, score, confident }) {
  if (score === null || score === undefined) return <span className="text-muted mono">—</span>;
  const text = `${label} (${score.toFixed(3)})${confident === false ? ' · cold start' : ''}`;
  return (
    <StatusPill variant={LABEL_CLASS[label] || 'skipped'} ariaLabel={`Score: ${text}`}>
      {text}
    </StatusPill>
  );
}

function TasteFilter({ overrides, refreshJobs } = {}) {
  const [category, setCategory] = useState('');
  const [promptId, setPromptId] = useState('');
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [promptOptions, setPromptOptions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [status, setStatus] = useState('');
  const [autoSortedExpanded, setAutoSortedExpanded] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const seenPathsRef = useRef(new Set());

  useEffect(() => {
    // Populates the Category and Prompt ID datalists so previously-used values are
    // selectable instead of needing to be retyped exactly. Categories come from taste
    // centroids (every category a batch has actually been scored against, minus the
    // null/global row); prompt IDs come from the full Module 4 prompt history.
    fetch('/api/taste-filter/centroids')
      .then((r) => r.json())
      .then((rows) => {
        const cats = Array.from(new Set(rows.map((r) => r.category).filter((c) => c && c !== 'global'))).sort();
        setCategoryOptions(cats);
      })
      .catch(() => {});
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((prompts) => setPromptOptions(Array.isArray(prompts) ? prompts : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Module 7 -> "Auto-import via watched folder" (step 7): a live push connection
    // instead of polling GET /api/taste-filter/pending on a timer. The backend's
    // chokidar watcher (watcher.js) already reacts to a new file the instant it lands;
    // this closes the last remaining gap, where the dashboard used to wait for the next
    // poll tick to notice. The stream sends one `data:` event per candidate -- whatever
    // was already pending when the connection opened, then one more per newly-detected
    // file for as long as the connection stays open -- so the merge/dedupe logic below
    // is unchanged from the old poll handler, just triggered by a push instead of a
    // timer. EventSource reconnects automatically on a transient network drop, so
    // there's no manual retry loop to write here.
    const source = new EventSource('/api/taste-filter/pending/stream');
    source.onmessage = (event) => {
      let candidate;
      try {
        candidate = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!candidate || !candidate.imagePath || seenPathsRef.current.has(candidate.imagePath)) return;
      seenPathsRef.current.add(candidate.imagePath);
      setCandidates((prev) => [candidate, ...prev]);
    };
    return () => source.close();
  }, []);

  async function handleImport(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setStatus(`Scoring ${files.length} image${files.length > 1 ? 's' : ''}…`);

    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    if (category) formData.append('category', category);
    if (promptId) formData.append('prompt_id', promptId);

    try {
      const res = await fetch('/api/taste-filter/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      data.candidates.forEach((c) => seenPathsRef.current.add(c.imagePath));
      setCandidates((prev) => [...data.candidates, ...prev]);
      setStatus(`Scored ${data.candidates.length} image${data.candidates.length > 1 ? 's' : ''}.`);
      // Makes a just-used new category immediately selectable for the next batch in this
      // same session, without waiting for a fresh /api/taste-filter/centroids fetch.
      if (category && !categoryOptions.includes(category)) {
        setCategoryOptions((prev) => [...prev, category].sort());
      }
    } catch (err) {
      setStatus(`Import failed: ${err.message}`);
    }
  }

  function handleFileChange(e) {
    const files = e.target.files;
    if (files && files.length > 0) {
      if (files.length === 1) {
        setSelectedFileName(files[0].name);
      } else {
        setSelectedFileName(`${files.length} files selected`);
      }
      handleImport(files);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      if (files.length === 1) {
        setSelectedFileName(files[0].name);
      } else {
        setSelectedFileName(`${files.length} files selected`);
      }
      handleImport(files);
    }
  }

  async function handleLabel(candidate, label) {
    try {
      await fetch('/api/taste-filter/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_path: candidate.imagePath,
          embedding: candidate.embedding,
          label,
          category: candidate.category,
          prompt_id: candidate.promptId,
        }),
      });
      setCandidates((prev) => prev.filter((c) => c.imagePath !== candidate.imagePath));
    } catch {
      setStatus('Failed to save label — try again.');
    }
  }

  async function handleKeepAndSendToPipeline(candidate) {
    await handleLabel(candidate, 'keep');
    try {
      const promoteRes = await fetch('/api/taste-filter/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_path: candidate.imagePath }),
      });
      const promoteData = await promoteRes.json();
      if (!promoteRes.ok) throw new Error(promoteData.error || 'Promote failed');

      await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artwork_id: promoteData.artwork.id, pipeline_overrides: overrides }),
      });
      if (refreshJobs) refreshJobs();
    } catch (err) {
      setStatus(`Kept, but failed to send to pipeline: ${err.message}`);
    }
  }

  async function handleRecompute() {
    setStatus('Recomputing centroids…');
    const res = await fetch('/api/taste-filter/recompute', { method: 'POST' });
    const data = await res.json();
    const global = data.counts.global || { keptCount: 0, discardedCount: 0 };
    setStatus(`Recomputed. Global: ${global.keptCount} kept / ${global.discardedCount} discarded.`);
  }

  const mainCandidates = candidates.filter((c) => c.autoDecision == null);
  const autoSortedCandidates = candidates.filter((c) => c.autoDecision != null);

  function renderCandidateCard(c) {
    return (
      <div key={c.imagePath} className="card p-4">
        {c.error ? (
          <p className="text-danger">{c.error}</p>
        ) : (
          <>
            <div className="taste-card-img-frame mb-2" style={{ aspectRatio: '1/1', background: '#000', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              <img src={c.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <div className="mb-2">
              <span className="text-muted mr-1">Global:</span> <ScoreBadge label={c.globalLabel} score={c.globalScore} confident={c.globalConfident} />
            </div>
            {c.category && (
              <div className="mb-2">
                <span className="text-muted mr-1">{c.category}:</span> <ScoreBadge label={c.categoryLabel} score={c.categoryScore} confident={c.categoryConfident} />
              </div>
            )}
            <div className="flex-row" style={{ gap: '0.5rem' }}>
              <button onClick={() => handleLabel(c, 'keep')} className="btn-primary flex-1">Keep</button>
              <button onClick={() => handleLabel(c, 'discard')} className="btn-secondary flex-1">Discard</button>
              <button onClick={() => handleKeepAndSendToPipeline(c)} className="btn-secondary flex-1">Keep & send to pipeline</button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="panel p-5">
      <div className="control-row mb-4" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="taste-input-field" style={{ flex: '1', minWidth: '160px' }}>
          <label htmlFor="taste-category-input" className="sr-only">Category</label>
          <input
            id="taste-category-input"
            className="input"
            list="taste-category-options"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. square-canvas"
          />
          <datalist id="taste-category-options">
            {categoryOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <span className="input-helper-text">Curation name (optional)</span>
        </div>
        <div className="taste-input-field" style={{ flex: '1', minWidth: '160px' }}>
          <label htmlFor="taste-prompt-id-input" className="sr-only">Prompt ID</label>
          <input
            id="taste-prompt-id-input"
            className="input"
            list="taste-prompt-id-options"
            value={promptId}
            onChange={(e) => setPromptId(e.target.value)}
            placeholder="links to Module 4"
          />
          <datalist id="taste-prompt-id-options">
            {promptOptions.map((p) => (
              <option key={p.id} value={p.id} label={p.prompt_text ? p.prompt_text.slice(0, 60) : undefined} />
            ))}
          </datalist>
          <span className="input-helper-text">Module link (optional)</span>
        </div>
        <button className="btn-primary recompute-btn" onClick={handleRecompute} type="button">
          <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          Recompute now
        </button>
      </div>

      <div
        className={`dropzone taste-dropzone ${dragActive ? 'active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <div className="dropzone-icon-badge">
          <svg className="upload-cloud-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 16l-4-4m0 0l-4 4m4-4v12" />
            <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
          </svg>
        </div>
        <p className="dropzone-title">Drag & drop a batch of candidate images here</p>
        <p className="dropzone-subtitle">Supports JPG, PNG, WEBP • Max 50MB per file</p>
        <div className="dropzone-file-control">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose Files
          </button>
          <span className="dropzone-file-name">{selectedFileName || 'No file chosen'}</span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            aria-label="Upload candidate images"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>
      {status && <p className="text-muted mono-sm mb-2 mt-2">{status}</p>}

      {mainCandidates.length > 0 && (
        <div className="card-grid">
          {mainCandidates.map((c) => renderCandidateCard(c))}
        </div>
      )}

      {autoSortedCandidates.length > 0 && (
        <div className="mt-4">
          <button className="btn-ghost" onClick={() => setAutoSortedExpanded(!autoSortedExpanded)}>
            <span aria-hidden="true">{autoSortedExpanded ? '▾' : '▸'}</span>{' '}
            <span>Auto-sorted ({autoSortedCandidates.length})</span>
          </button>
          {autoSortedExpanded && (
            <div className="card-grid mt-2">
              {autoSortedCandidates.map((c) => renderCandidateCard(c))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TasteFilter;