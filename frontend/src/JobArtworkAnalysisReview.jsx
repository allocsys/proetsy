import { useState } from 'react';

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
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [error, setError] = useState(null);

  async function loadJobAndAnalysis() {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const jobRes = await fetch(`/api/jobs/${jobId}`);
      const jobData = await jobRes.json();
      if (!jobRes.ok) throw new Error(jobData.error || 'Failed to load job');
      setJob(jobData);
      setManualNotes(jobData.manual_notes || '');

      const artworkRes = await fetch(`/api/artworks/${jobData.artwork_id}`);
      const artworkData = await artworkRes.json();
      if (!artworkRes.ok) throw new Error(artworkData.error || 'Failed to load artwork');
      setAnalysis(artworkData.image_analysis);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function runAnalysis() {
    if (!jobId) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/run/image-analyzer`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image analysis failed');
      setAnalysis(data.imageAnalysis);
      setJob(data.job);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  async function saveManualNotes() {
    if (!jobId) return;
    setSavingNotes(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/manual-notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: manualNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save manual notes');
      setJob(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingNotes(false);
    }
  }

  return (
    <div className="card artwork-analysis-card">
      <div className="flex-row mb-4" style={{ gap: 'var(--space-2)' }}>
        <button className="btn-primary" onClick={loadJobAndAnalysis} disabled={!jobId || loading}>
          {loading ? 'Loading…' : 'Load analysis'}
        </button>
        <button className="btn-secondary" onClick={runAnalysis} disabled={!jobId || running}>
          {running ? 'Running...' : 'Run image analyzer'}
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
            <label className="settings-field-label">Manual notes fallback</label>
            <span className="input-helper-text">Used by listing generator when AI analysis is skipped or fails.</span>
            <textarea
              className="listing-textarea input"
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
              placeholder="Enter custom style, subject, or mood notes..."
            />
          </div>
          <div className="mt-2">
            <button className="btn-primary" onClick={saveManualNotes} disabled={savingNotes}>
              {savingNotes ? 'Saving notes…' : 'Save manual notes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
