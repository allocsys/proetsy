import { useState } from 'react';
import { useAsyncTask } from './hooks/useAsyncTask.js';

function listOrDash(items) {
  return Array.isArray(items) && items.length > 0 ? items.join(', ') : '—';
}

/**
 * Read-only display of a completed Module 1 analysis. Field names/shape mirror
 * buildImageAnalysisPrompt()'s requested JSON exactly (backend/lib/image-analyzer/
 * prompt.js) — subject/style/mood are short strings, palette/themes/notable_elements/
 * suggested_categories are string arrays.
 */
function AnalysisSummary({ analysis }) {
  return (
    <dl className="analysis-summary-grid">
      <dt>Subject</dt>
      <dd>{analysis.subject || '—'}</dd>
      <dt>Style</dt>
      <dd>{analysis.style || '—'}</dd>
      <dt>Mood</dt>
      <dd>{analysis.mood || '—'}</dd>
      <dt>Palette</dt>
      <dd>{listOrDash(analysis.palette)}</dd>
      <dt>Themes</dt>
      <dd>{listOrDash(analysis.themes)}</dd>
      <dt>Notable elements</dt>
      <dd>{listOrDash(analysis.notable_elements)}</dd>
      <dt>Suggested categories</dt>
      <dd>{listOrDash(analysis.suggested_categories)}</dd>
    </dl>
  );
}

/**
 * Module 1 (Image Analyzer) review surface.
 */
export default function JobArtworkAnalysisReview({ jobId }) {
  const [job, setJob] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [manualNotes, setManualNotes] = useState('');
  // Three independent operations, each with its own useAsyncTask instance rather than
  // one shared loading/error pair -- the original shared `error` state meant starting
  // any operation cleared whatever error the *last* operation left behind, but no test
  // (or user-facing behavior) actually depends on that cross-operation clearing; each
  // action's own error naturally clears the next time that same action runs, and the
  // three are rendered together below exactly as the single shared error was.
  const load = useAsyncTask();
  const analyze = useAsyncTask();
  const notes = useAsyncTask();

  function loadJobAndAnalysis() {
    if (!jobId) return;
    load.run(async () => {
      const jobRes = await fetch(`/api/jobs/${jobId}`);
      const jobData = await jobRes.json();
      if (!jobRes.ok) throw new Error(jobData.error || 'Failed to load job');
      setJob(jobData);
      setManualNotes(jobData.manual_notes || '');

      const artworkRes = await fetch(`/api/artworks/${jobData.artwork_id}`);
      const artworkData = await artworkRes.json();
      if (!artworkRes.ok) throw new Error(artworkData.error || 'Failed to load artwork');
      setAnalysis(artworkData.image_analysis);
    });
  }

  function runAnalysis() {
    if (!jobId) return;
    analyze.run(async () => {
      const res = await fetch(`/api/jobs/${jobId}/run/image-analyzer`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image analysis failed');
      setAnalysis(data.imageAnalysis);
      setJob(data.job);
    });
  }

  function saveManualNotes() {
    if (!jobId) return;
    notes.run(async () => {
      const res = await fetch(`/api/jobs/${jobId}/manual-notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: manualNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save manual notes');
      setJob(data);
    });
  }

  const error = load.error || analyze.error || notes.error;

  return (
    <div className="card artwork-analysis-card">
      <div className="flex-row mb-4" style={{ gap: 'var(--space-2)' }}>
        <button className="btn-primary" onClick={loadJobAndAnalysis} disabled={!jobId || load.pending}>
          {load.pending ? 'Loading…' : 'Load analysis'}
        </button>
        <button className="btn-secondary" onClick={runAnalysis} disabled={!jobId || analyze.pending}>
          {analyze.pending ? 'Running...' : 'Run image analyzer'}
        </button>
      </div>

      {error && <p className="text-danger mt-2">{error}</p>}

      {analysis ? (
        <div className="settings-readonly-box panel" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
          <div className="settings-readonly-header">
            <span className="settings-readonly-title">AI Analysis Result</span>
            <span className="read-only-badge">AI Generated</span>
          </div>
          <AnalysisSummary analysis={analysis} />
        </div>
      ) : (
        job && <p className="text-muted my-3 empty-state">No analysis yet for this artwork</p>
      )}

      {job && (
        <div className="manual-notes-section">
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="job-manual-notes">Manual notes fallback</label>
            <span className="input-helper-text">Used by listing generator when AI analysis is skipped or fails.</span>
            <textarea
              id="job-manual-notes"
              className="listing-textarea input"
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
              placeholder="Enter custom style, subject, or mood notes..."
            />
          </div>
          <div className="mt-2">
            <button className="btn-primary" onClick={saveManualNotes} disabled={notes.pending}>
              {notes.pending ? 'Saving notes…' : 'Save manual notes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
