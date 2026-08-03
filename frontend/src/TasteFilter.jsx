import { useEffect, useRef, useState } from 'react';

// How often to poll for whatever the watched-folder auto-importer (see
// backend/lib/taste-filter/watcher.js) has detected + scored since the last poll.
// ARCHITECTURE.md -> Module 7 -> "Auto-import via watched folder" doesn't specify a
// cadence -- a few seconds is frequent enough to feel responsive for a single-user local
// app without hammering the backend while a batch of Midjourney downloads trickles in.
const PENDING_POLL_INTERVAL_MS = 5000;

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
  // Tracks every imagePath already shown (imported manually, polled in from the
  // watcher, or already labeled-and-removed) so a re-poll of /pending doesn't re-add a
  // candidate that's already on screen or was just labeled a moment ago -- the pending
  // queue on the server only forgets a candidate once removePendingCandidate() runs,
  // which happens right after the label POST resolves, not before.
  const seenPathsRef = useRef(new Set());

  // Module 7 -> "Auto-import via watched folder" (step 7): merges whatever the backend
  // watcher has queued into the same grid a manual drag-and-drop import populates.
  // Interval-only (no fetch on mount) so this never fires before the watcher itself has
  // had a chance to be configured, and so it doesn't collide with an in-flight manual
  // import/label call in tests or real usage.
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
        // Silent -- a missed poll just gets picked up on the next tick, no need to
        // surface a transient network error for a background refresh.
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
      <p className="text-muted taste-intro">
        Drop a raw Midjourney batch to rank it against your taste model before it enters the
        main pipeline. Nothing is auto-discarded — confirm each one below.
      </p>

      <div className="flex-row flex-wrap mb-2">
        <label className="taste-field-label" htmlFor="taste-category-input">
          Category:{' '}
        </label>
        <input
          id="taste-category-input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. square-canvas"
          className="input-auto"
        />
        <label className="taste-field-label" htmlFor="taste-prompt-id-input">
          Prompt ID (optional):{' '}
        </label>
        <input
          id="taste-prompt-id-input"
          value={promptId}
          onChange={(e) => setPromptId(e.target.value)}
          placeholder="links to Module 4"
          className="input-auto"
        />
        <button className="btn-secondary" onClick={handleRecompute}>Recompute now</button>
      </div>

      <div
        className="dropzone crop-frame mb-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleImport(e.dataTransfer.files); }}
      >
        <p className="dropzone-title">Drag and drop a batch of candidate images here</p>
        <input
          id="taste-dropzone-file-input"
          type="file"
          multiple
          accept="image/*"
          aria-label="Upload candidate images"
          onChange={(e) => handleImport(e.target.files)}
          className="input-auto taste-file-input"
        />
      </div>
      {status && <p className="mono taste-status">{status}</p>}

      {candidates.length > 0 && (
        <div className="taste-grid">
          {candidates.map((c) => (
            <div key={c.imagePath} className="taste-card">
              {c.error ? (
                <p className="taste-error">{c.error}</p>
              ) : (
                <>
                  <div className="crop-frame taste-card-img-frame">
                    <img src={c.imageUrl} alt="" />
                  </div>
                  <p className="taste-card-meta">
                    Global: <ScoreBadge label={c.globalLabel} score={c.globalScore} confident={c.globalConfident} />
                  </p>
                  {c.category && (
                    <p className="taste-card-meta">
                      {c.category}: <ScoreBadge label={c.categoryLabel} score={c.categoryScore} confident={c.categoryConfident} />
                    </p>
                  )}
                  <div className="flex-row taste-card-actions">
                    <button onClick={() => handleLabel(c, 'keep')} className="flex-1">Keep</button>
                    <button className="btn-secondary flex-1" onClick={() => handleLabel(c, 'discard')}>Discard</button>
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
