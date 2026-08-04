import { useEffect, useRef, useState } from 'react';

const PENDING_POLL_INTERVAL_MS = 5000;

const LABEL_CLASS = {
  'likely-keep': 'success',
  'likely-discard': 'danger',
  uncertain: 'pending',
};

function ScoreBadge({ label, score, confident }) {
  if (score === null || score === undefined) return <span className="text-muted mono">—</span>;
  const text = `${label} (${score.toFixed(3)})${confident === false ? ' · cold start' : ''}`;
  return (
    <span className={`status-pill ${LABEL_CLASS[label] || 'skipped'}`} aria-label={`Score: ${text}`}>
      <span className="status-dot" aria-hidden="true" />
      {label} ({score.toFixed(3)})${confident === false ? ' · cold start' : ''}
    </span>
  );
}

function TasteFilter({ overrides, refreshJobs } = {}) {
  const [category, setCategory] = useState('');
  const [promptId, setPromptId] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [status, setStatus] = useState('');
  const [autoSortedExpanded, setAutoSortedExpanded] = useState(false);
  const seenPathsRef = useRef(new Set());

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/taste-filter/pending');
        if (!res.ok) return;
        const data = await res.json();
        const fresh = (data.candidates || []).filter((c) => !seenPathsRef.current.has(c.imagePath));
        if (!fresh.length) return;
        fresh.forEach((c) => seenPathsRef.current.add(c.imagePath));
        setCandidates((prev) => [...fresh, ...prev]);
      } catch {
        // Ignore transient polling errors; next interval tick will retry.
      }
    }, PENDING_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
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
    } catch (err) {
      setStatus(`Import failed: ${err.message}`);
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
      <div key={c.imagePath} className="glass-card p-4">
        {c.error ? (
          <p className="text-danger">{c.error}</p>
        ) : (
          <>
            <div className="crop-frame mb-2" style={{ aspectRatio: '1/1', background: '#000', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
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
    <div className="glass-panel p-5">
      <div className="control-row mb-4" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="taste-category-input" className="sr-only">Category</label>
        <input
          id="taste-category-input"
          className="glass-input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. square-canvas"
          style={{ flex: '1', minWidth: '160px' }}
        />
        <label htmlFor="taste-prompt-id-input" className="sr-only">Prompt ID</label>
        <input
          id="taste-prompt-id-input"
          className="glass-input"
          value={promptId}
          onChange={(e) => setPromptId(e.target.value)}
          placeholder="links to Module 4"
          style={{ flex: '1', minWidth: '160px' }}
        />
        <button className="btn-secondary" onClick={handleRecompute}>Recompute now</button>
      </div>

      <div
        className="dropzone crop-frame my-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleImport(e.dataTransfer.files); }}
      >
        <p className="dropzone-title">Drag and drop a batch of candidate images here</p>
        <input type="file" multiple accept="image/*" aria-label="Upload candidate images" onChange={(e) => handleImport(e.target.files)} />
      </div>
      {status && <p className="text-muted mono-sm mb-2">{status}</p>}

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