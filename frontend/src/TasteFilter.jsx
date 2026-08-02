import { useState } from 'react';

const LABEL_COLORS = {
  'likely-keep': '#2f855a',
  'likely-discard': '#c53030',
  uncertain: '#a0a0a0',
};

function ScoreBadge({ label, score, confident }) {
  if (score === null || score === undefined) return <span style={{ color: '#aaa' }}>—</span>;
  return (
    <span style={{ color: LABEL_COLORS[label] || '#666' }}>
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
    <div>
      <p style={{ color: '#888', marginTop: 0 }}>
        Drop a raw Midjourney batch to rank it against your taste model before it enters the
        main pipeline. Nothing is auto-discarded — confirm each one below.
      </p>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <label>
          Category:{' '}
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. square-canvas" />
        </label>
        <label>
          Prompt ID (optional):{' '}
          <input value={promptId} onChange={(e) => setPromptId(e.target.value)} placeholder="links to Module 4" />
        </label>
        <button onClick={handleRecompute}>Recompute now</button>
      </div>

      <div
        style={{ border: '2px dashed #ccc', borderRadius: 8, padding: '1.5rem', textAlign: 'center', marginBottom: '1rem' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleImport(e.dataTransfer.files); }}
      >
        <p>Drag and drop a batch of candidate images here</p>
        <input type="file" multiple accept="image/*" onChange={(e) => handleImport(e.target.files)} />
      </div>
      {status && <p style={{ color: '#666' }}>{status}</p>}

      {candidates.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          {candidates.map((c) => (
            <div key={c.imagePath} style={{ border: '1px solid #eee', borderRadius: 8, padding: '0.5rem' }}>
              {c.error ? (
                <p style={{ color: '#c53030', fontSize: '0.85rem' }}>{c.error}</p>
              ) : (
                <>
                  <img src={c.imageUrl} alt="" style={{ width: '100%', borderRadius: 4, display: 'block' }} />
                  <p style={{ fontSize: '0.8rem', margin: '0.4rem 0' }}>
                    Global: <ScoreBadge label={c.globalLabel} score={c.globalScore} confident={c.globalConfident} />
                  </p>
                  {c.category && (
                    <p style={{ fontSize: '0.8rem', margin: '0.4rem 0' }}>
                      {c.category}: <ScoreBadge label={c.categoryLabel} score={c.categoryScore} confident={c.categoryConfident} />
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => handleLabel(c, 'keep')} style={{ flex: 1 }}>Keep</button>
                    <button onClick={() => handleLabel(c, 'discard')} style={{ flex: 1 }}>Discard</button>
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
