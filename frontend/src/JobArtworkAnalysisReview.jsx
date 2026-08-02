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
    <dl style={{ margin: '1rem 0', display: 'grid', gridTemplateColumns: '150px 1fr', gap: '0.5rem 1rem' }}>
      <dt style={{ fontWeight: 600, color: 'var(--ink)' }}>Subject</dt>
      <dd style={{ margin: 0, color: 'var(--ink-soft)' }}>{analysis.subject || '—'}</dd>
      <dt style={{ fontWeight: 600, color: 'var(--ink)' }}>Style</dt>
      <dd style={{ margin: 0, color: 'var(--ink-soft)' }}>{analysis.style || '—'}</dd>
      <dt style={{ fontWeight: 600, color: 'var(--ink)' }}>Mood</dt>
      <dd style={{ margin: 0, color: 'var(--ink-soft)' }}>{analysis.mood || '—'}</dd>
      <dt style={{ fontWeight: 600, color: 'var(--ink)' }}>Palette</dt>
      <dd style={{ margin: 0, color: 'var(--ink-soft)' }}>{listOrDash(analysis.palette)}</dd>
      <dt style={{ fontWeight: 600, color: 'var(--ink)' }}>Themes</dt>
      <dd style={{ margin: 0, color: 'var(--ink-soft)' }}>{listOrDash(analysis.themes)}</dd>
      <dt style={{ fontWeight: 600, color: 'var(--ink)' }}>Notable elements</dt>
      <dd style={{ margin: 0, color: 'var(--ink-soft)' }}>{listOrDash(analysis.notable_elements)}</dd>
      <dt style={{ fontWeight: 600, color: 'var(--ink)' }}>Suggested categories</dt>
      <dd style={{ margin: 0, color: 'var(--ink-soft)' }}>{listOrDash(analysis.suggested_categories)}</dd>
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
    <div style={{ background: 'var(--paper-dim)', border: '1px solid var(--hairline-paper)', borderRadius: '6px', padding: '1rem', marginTop: '0.75rem' }}>
      <div className="flex-row mb-1">
        <button onClick={loadJobAndAnalysis} disabled={!jobId || loading}>
          {loading ? 'Loading…' : 'Load analysis'}
        </button>
        <button className="btn-secondary" onClick={runAnalysis} disabled={!jobId || running}>
          {running ? 'Analyzing…' : 'Run image analyzer'}
        </button>
      </div>

      {error && <p style={{ color: 'var(--state-danger)' }}>{error}</p>}

      {analysis ? (
        <AnalysisSummary analysis={analysis} />
      ) : (
        job && <p className="text-muted" style={{ margin: '0.5rem 0' }}>No analysis yet for this artwork — run it, or use manual notes below.</p>
      )}

      {job && (
        <div style={{ marginTop: '1rem' }}>
          <label style={{ display: 'block', fontWeight: 500, fontSize: '13px', color: 'var(--ink)' }}>
            Manual notes (fallback for Module 2 when analysis is skipped or fails)
            <textarea
              style={{ display: 'block', width: '100%', minHeight: '3rem', marginTop: '0.25rem', marginBottom: '0.5rem' }}
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
