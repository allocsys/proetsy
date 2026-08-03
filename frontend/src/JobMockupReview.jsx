import { useEffect, useMemo, useState } from 'react';

// Using CSS classes.

/**
 * One mockup's review card. When `needs_review` is set (see ARCHITECTURE.md -> Module 3
 * -> "AI-outpainting fallback"), shows the smart-crop and AI-extended variants side by
 * side with a button per variant; otherwise just shows whichever variant is currently
 * selected. Selecting a variant calls the step-6 PATCH route, which syncs `file_path`,
 * clears `needs_review`, and returns the updated row.
 */
function MockupCard({ mockup, onVariantChange }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function selectVariant(variant) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${mockup.job_id}/mockups/${mockup.id}/variant`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update variant');
      onVariantChange(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dark-panel mockup-card">
      <h4>
        {mockup.size_key} {mockup.dimensions ? `(${mockup.dimensions})` : ''}
      </h4>

      {mockup.needs_review ? (
        <>
          <p className="mockup-review-status">Needs review — pick a variant:</p>
          <div className="mockup-variants-row">
            <div className="mockup-variant-col">
              <strong className="mockup-variant-label">Smart crop</strong>
              {mockup.smart_crop_url && (
                <img src={mockup.smart_crop_url} alt="Smart crop variant" className="mockup-variant-image" />
              )}
              <button className="btn-secondary" disabled={saving} onClick={() => selectVariant('smart_crop')}>
                Use smart crop
              </button>
            </div>
            <div className="mockup-variant-col">
              <strong className="mockup-variant-label">AI extended</strong>
              {mockup.ai_extended_url && (
                <img src={mockup.ai_extended_url} alt="AI-extended variant" className="mockup-variant-image" />
              )}
              <button className="btn-secondary" disabled={saving} onClick={() => selectVariant('ai_extended')}>
                Use AI extended
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="mockup-variant-col">
          <span className="mockup-selected-label">Selected: {mockup.selected_variant}</span>
          {mockup.file_url && <img src={mockup.file_url} alt="Selected mockup" className="mockup-variant-image" />}
        </div>
      )}

      {error && <p className="text-danger mt-1">{error}</p>}
    </div>
  );
}

/**
 * Manual category-selection gate for the curated flow (plan.md -> "Mockup categories").
 * A job created from the curated (Taste Filter promote) path has already had Image
 * Analyzer + Listing Generator run for it, but hasn't had mockups generated yet since
 * the direct/uncurated lane is the only caller of POST /api/jobs/:id/run today — this is
 * that missing "generate" trigger for the curated path, gated by category rather than
 * blanket-generating every configured size.
 *
 * Fetches the distinct configured categories plus every configured template, resolves
 * whichever categories are checked to their underlying size_keys client-side (a template
 * with no category set is never reachable here — only from the direct-upload lane's
 * unfiltered "run everything" behavior), and on submit calls POST /api/jobs/:id/run with
 * just those size_keys. Additive only: a job that never visits this step keeps getting
 * mockups for every configured size, exactly as before this step existed.
 */
function MockupCategorySelector({ jobId, onGenerated }) {
  const [categories, setCategories] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [checked, setChecked] = useState({}); // category -> boolean
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoaded(false);
    Promise.all([
      fetch('/api/mockup-templates/categories').then((r) => r.json()),
      fetch('/api/mockup-templates').then((r) => r.json()),
    ])
      .then(([cats, tpls]) => {
        setCategories(cats);
        setTemplates(tpls);
        setLoaded(true);
      })
      .catch((err) => setError(err.message));
  }, [jobId]);

  function toggleCategory(category) {
    setChecked((prev) => ({ ...prev, [category]: !prev[category] }));
  }

  const resolvedSizeKeys = useMemo(() => {
    const checkedCategories = new Set(Object.keys(checked).filter((c) => checked[c]));
    if (!checkedCategories.size) return [];
    // Uncategorized templates (category: null) are deliberately excluded — they're only
    // reachable via the direct-upload lane's unfiltered "run everything" behavior.
    return templates.filter((t) => t.category && checkedCategories.has(t.category)).map((t) => t.size_key);
  }, [checked, templates]);

  async function handleGenerate() {
    if (!jobId || !resolvedSizeKeys.length) return;
    setRunning(true);
    setStatus('Generating mockups…');
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size_keys: resolvedSizeKeys }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate mockups');
      setStatus(`Generated mockups for ${resolvedSizeKeys.length} template${resolvedSizeKeys.length === 1 ? '' : 's'}.`);
      onGenerated?.();
    } catch (err) {
      setError(err.message);
      setStatus('');
    } finally {
      setRunning(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="dark-panel mockup-category-selector">
      <h4 style={{ marginTop: 0 }}>Choose mockup categories</h4>
      {categories.length ? (
        <>
          <div className="mockup-category-checklist">
            {categories.map((c) => (
              <label key={c} className="settings-checkbox-row">
                <input type="checkbox" checked={!!checked[c]} onChange={() => toggleCategory(c)} />
                <span>{c}</span>
              </label>
            ))}
          </div>
          <button className="btn-primary" onClick={handleGenerate} disabled={running || !resolvedSizeKeys.length}>
            {running ? 'Generating…' : 'Generate mockups for selected categories'}
          </button>
        </>
      ) : (
        <p className="empty-state" style={{ margin: 0 }}>
          No mockup categories configured yet — tag templates with a category in Mockup Templates.
        </p>
      )}
      {status && <p className="mono taste-status">{status}</p>}
      {error && <p className="text-danger mt-1">{error}</p>}
    </div>
  );
}

/**
 * Loads and reviews a job's mockups. Takes a jobId as a prop rather than doing its own
 * job lookup/selection UI — Module 6 (the real dashboard, still a skeleton per
 * ARCHITECTURE.md) owns that; this component only covers the review step itself.
 */
export default function JobMockupReview({ jobId }) {
  const [mockups, setMockups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function loadMockups() {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/mockups`);
      if (!res.ok) throw new Error('Failed to load mockups');
      setMockups(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleVariantChange() {
    // The PATCH response is a bare mockups row (no joined size_key/urls) — simplest to
    // just reload the list rather than reconstructing the joined shape client-side.
    loadMockups();
  }

  return (
    <div>
      <MockupCategorySelector jobId={jobId} onGenerated={loadMockups} />
      <button onClick={loadMockups} disabled={!jobId || loading}>
        {loading ? 'Loading…' : 'Load mockups'}
      </button>
      {error && <p className="text-danger mt-1">{error}</p>}
      {mockups.map((m) => (
        <MockupCard key={m.id} mockup={m} onVariantChange={handleVariantChange} />
      ))}
      {mockups.length === 0 && !loading && !error && (
        <p className="text-muted mt-2">No mockups loaded yet.</p>
      )}
    </div>
  );
}
