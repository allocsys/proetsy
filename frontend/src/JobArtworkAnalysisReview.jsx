import { useState } from 'react';

const cardStyle = {
  border: '1px solid #ccc',
  borderRadius: 8,
  padding: '1rem',
  marginBottom: '1rem',
};

const fieldStyle = { display: 'block', width: '100%', marginBottom: '0.5rem' };

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
    <dl>
      <dt>
        <strong>Subject</strong>
      </dt>
      <dd>{analysis.subject || '—'}</dd>
      <dt>
        <strong>Style</strong>
      </dt>
      <dd>{analysis.style || '—'}</dd>
      <dt>
        <strong>Mood</strong>
      </dt>
      <dd>{analysis.mood || '—'}</dd>
      <dt>
        <strong>Palette</strong>
      </dt>
      <dd>{listOrDash(analysis.palette)}</dd>
      <dt>
        <strong>Themes</strong>
      </dt>
      <dd>{listOrDash(analysis.themes)}</dd>
      <dt>
        <strong>Notable elements</strong>
      </dt>
      <dd>{listOrDash(analysis.notable_elements)}</dd>
      <dt>
        <strong>Suggested categories</strong>
      </dt>
      <dd>{listOrDash(analysis.suggested_categories)}</dd>
    </dl>
  );
}

/**
 * Module 1 (Image Analyzer) review surface — the "dashboard surface" ARCHITECTURE.md
 * flagged as not yet built (analysis was previously only visible via a raw
 * GET /api/artworks/:id call). Mirrors JobListingReview/JobMockupReview's prop shape
 * (jobId in, self-contained load/action state) so it wires into App.jsx the same way.
 *
 * Covers the module's full optional-module flow (ARCHITECTURE.md -> Partial Failure
 * Handling): run analysis, view the result, or — since Module 1 is optional and can
 * fail without blocking Module 2 — fall back to hand-typed manual notes via
 * PATCH /api/jobs/:id/manual-notes.
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
      // A 422 here is Module 1's optional-module failure path (ARCHITECTURE.md ->
      // Partial Failure Handling) — the job itself isn't blocked, so surface the error
      // inline and let the user fall back to manual notes below, rather than treating
      // this like a hard failure.
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
    <div style={cardStyle}>
      <div style={{ marginBottom: '0.75rem' }}>
        <button onClick={loadJobAndAnalysis} disabled={!jobId || loading}>
          {loading ? 'Loading…' : 'Load analysis'}
        </button>{' '}
        <button onClick={runAnalysis} disabled={!jobId || running}>
          {running ? 'Analyzing…' : 'Run image analyzer'}
        </button>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {analysis ? (
        <AnalysisSummary analysis={analysis} />
      ) : (
        job && <p style={{ color: '#888' }}>No analysis yet for this artwork — run it, or use manual notes below.</p>
      )}

      {job && (
        <div>
          <label>
            Manual notes (fallback for Module 2 when analysis is skipped or fails)
            <textarea
              style={{ ...fieldStyle, minHeight: '3rem' }}
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
            />
          </label>
          <button onClick={saveManualNotes} disabled={savingNotes}>
            {savingNotes ? 'Saving…' : 'Save manual notes'}
          </button>
        </div>
      )}
    </div>
  );
}
