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
  const text = `${label} (${score.toFixed(3)})${confident === false ? ' · cold start' : ''}`;
  return (
    <span className={`status-pill ${LABEL_CLASS[label] || 'skipped'}`} aria-label={`Score: ${text}`}>
      <span className="status-dot" aria-hidden="true" />
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
// `overrides` / `refreshJobs`: the same pipeline-module-overrides state and
// Listing-History-refresh function App.jsx already tracks for the direct-upload
// dropzone (see App.jsx's handleFiles), passed down as props so "Keep & send to
// pipeline" below can create a job identically to a direct upload.
function TasteFilter({ overrides, refreshJobs } = {}) {
  const [category, setCategory] = useState('');
  const [promptId, setPromptId] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [status, setStatus] = useState('');
  // Step 2.9 — candidates the backend auto-decided (Step 2.6's `autoDecision` field on
  // each candidate, set only when taste_filter_auto_enabled is on and the score clears
  // the confidence + threshold bars from the Step 2.4 decision rule) render into their
  // own collapsed section instead of the main grid. Collapsed by default so a big
  // auto-sorted batch doesn't bury the candidates that actually need manual review.
  const [autoSortedExpanded, setAutoSortedExpanded] = useState(false);
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

  // Does everything Keep does (records the training-signal label, removes the card),
  // then promotes the candidate straight into the pipeline: POST /api/taste-filter/promote
  // (Step 1.2) copies the file into UPLOADS_DIR and creates the `artworks` row, then
  // POST /api/jobs creates a job for it using the same pipeline `overrides` the
  // direct-upload dropzone uses, then refreshJobs() so it shows up in Listing History
  // immediately. Nothing enters the pipeline as a side effect of Keep alone -- this is a
  // separate, explicit opt-in per image.
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

  // Step 2.9 — split into the main grid (needs manual review: autoDecision missing/null,
  // same set shown today when auto mode is off) and the collapsed Auto-sorted section
  // (autoDecision === 'keep' | 'discard'). Same card markup and the same Keep/Discard/
  // Keep & send to pipeline actions render in both, so correcting a wrong auto-decision
  // is just clicking the same buttons — handleLabel already re-labels via the same
  // /taste-filter/label route regardless of which section the card came from, and the
  // backend clears `auto_labeled` on any manual label per Step 2.2.
  const mainCandidates = candidates.filter((c) => c.autoDecision == null);
  const autoSortedCandidates = candidates.filter((c) => c.autoDecision != null);

  function renderCandidateCard(c) {
    return (
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
              <button className="btn-secondary flex-1" onClick={() => handleKeepAndSendToPipeline(c)}>Keep &amp; send to pipeline</button>
            </div>
          </>
        )}
      </div>
    );
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

      {mainCandidates.length > 0 && (
        <div className="taste-grid">
          {mainCandidates.map((c) => renderCandidateCard(c))}
        </div>
      )}

      {autoSortedCandidates.length > 0 && (
        <div className="taste-auto-sorted-section">
          <button
            className="btn-secondary"
            onClick={() => setAutoSortedExpanded((prev) => !prev)}
          >
            <span aria-hidden="true">{autoSortedExpanded ? '▾' : '▸'}</span> Auto-sorted ({autoSortedCandidates.length})
          </button>
          {autoSortedExpanded && (
            <div className="taste-grid" style={{ marginTop: '0.75rem' }}>
              {autoSortedCandidates.map((c) => renderCandidateCard(c))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TasteFilter;
