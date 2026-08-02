import { useState } from 'react';

const LABEL_CLASS = {
  'likely-keep': 'success',
  'likely-discard': 'danger',
  uncertain: 'pending',
};

function ScoreBadge({ label, score, confident }) {
  if (score === null || score === undefined) return <span className="text-muted mono">—</span>;
  return (
    <span className={`status-pill ${LABEL_CLASS[label] || 'skipped'}`}>
      <span className="status-dot" />
      {label} ({score.toFixed(3)}){confident === false ? ' · cold start' : ''}
    </span>
  );
}

// Module 7 — Taste Filter (Curation). See ARCHITECTURE.md -> Module 7. Not job-scoped
// (mirrors PromptHelper.jsx's shape, not JobListingReview.jsx's) — a batch is keyed only
// by an optional category + prompt, same as the backend routes. Candidates from an
// import call are held in local component state only; nothing is persisted server-side
// until the user clicks Keep/Discard on it (see backend/server.js -> "Module 7 (Taste
// Filter) routes" for why).
function TasteFilter() {
  const [category, setCategory] = useState('');
  const [promptId, setPromptId] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [status, setStatus] = useState('');

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
      setCandidates((prev) => [...data.candidates, ...prev]);
      setStatus(`Scored ${data.candidates.length} image${data.candidates.length > 1 ? 's' : ''}.`);
    } catch (err) {
      setStatus(`Import failed: ${err.message}`);
    }
  }

  // Records the keep/discard decision — the training signal. Removes the candidate from
  // the ranked batch either way; nothing is auto-deleted from disk, this only records the
  // label (ARCHITECTURE.md -> Module 7: "Nothing is auto-deleted [...] the user confirms
  // keep/discard, and that confirmation is the training signal").
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

  async function handleRecompute() {
    setStatus('Recomputing centroids…');
    const res = await fetch('/api/taste-filter/recompute', { method: 'POST' });
    const data = await res.json();
    const global = data.counts.global || { keptCount: 0, discardedCount: 0 };
    setStatus(`Recomputed. Global: ${global.keptCount} kept / ${global.discardedCount} discarded.`);
  }

  return (
    <div className="dark-panel">
      <p className="text-muted" style={{ marginTop: 0 }}>
        Drop a raw Midjourney batch to rank it against your taste model before it enters the
        main pipeline. Nothing is auto-discarded — confirm each one below.
      </p>

      <div className="flex-row flex-wrap" style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Category:{' '}
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. square-canvas" style={{ width: 'auto' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Prompt ID (optional):{' '}
          <input value={promptId} onChange={(e) => setPromptId(e.target.value)} placeholder="links to Module 4" style={{ width: 'auto' }} />
        </label>
        <button className="btn-secondary" onClick={handleRecompute}>Recompute now</button>
      </div>

      <div
        className="dropzone crop-frame"
        style={{ marginBottom: '1rem' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleImport(e.dataTransfer.files); }}
      >
        <p style={{ fontWeight: 600, fontSize: '15px', color: 'var(--ink)' }}>Drag and drop a batch of candidate images here</p>
        <input type="file" multiple accept="image/*" onChange={(e) => handleImport(e.target.files)} style={{ width: 'auto', marginTop: '0.5rem' }} />
      </div>
      {status && <p className="mono" style={{ color: 'var(--accent)' }}>{status}</p>}

      {candidates.length > 0 && (
        <div className="taste-grid">
          {candidates.map((c) => (
            <div key={c.imagePath} className="taste-card">
              {c.error ? (
                <p style={{ color: 'var(--state-danger)', fontSize: '13px' }}>{c.error}</p>
              ) : (
                <>
                  <div className="crop-frame" style={{ marginBottom: '0.5rem' }}>
                    <img src={c.imageUrl} alt="" />
                  </div>
                  <p style={{ fontSize: '13px', margin: '0.4rem 0', color: 'var(--ink)' }}>
                    Global: <ScoreBadge label={c.globalLabel} score={c.globalScore} confident={c.globalConfident} />
                  </p>
                  {c.category && (
                    <p style={{ fontSize: '13px', margin: '0.4rem 0', color: 'var(--ink)' }}>
                      {c.category}: <ScoreBadge label={c.categoryLabel} score={c.categoryScore} confident={c.categoryConfident} />
                    </p>
                  )}
                  <div className="flex-row" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button onClick={() => handleLabel(c, 'keep')} style={{ flex: 1 }}>Keep</button>
                    <button className="btn-secondary" onClick={() => handleLabel(c, 'discard')} style={{ flex: 1 }}>Discard</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TasteFilter;
