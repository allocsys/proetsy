import { useEffect, useMemo, useState } from 'react';

/**
 * One mockup's review card — polished to match the dark unified design system,
 * spacing scale, and clear image preview presentation with side-by-side smart-crop
 * vs AI-extended review comparison.
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
      <div className="settings-readonly-header" style={{ marginBottom: '1rem' }}>
        <h4 style={{ margin: 0, fontWeight: 700, color: 'var(--ink)' }}>
          {mockup.size_key} {mockup.dimensions ? `(${mockup.dimensions})` : ''}
        </h4>
        <span className="read-only-badge">
          {mockup.needs_review ? 'Review Required' : `Selected: ${mockup.selected_variant || 'default'}`}
        </span>
      </div>

      {mockup.needs_review ? (
        <>
          <p className="mockup-review-status mb-3">AI outpainting fallback triggered — please inspect and select a preferred variant below:</p>
          <div className="mockup-variants-row">
            <div className="mockup-variant-col">
              <span className="mockup-variant-label">Option A: Smart Crop</span>
              {mockup.smart_crop_url && (
                <div className="settings-readonly-box" style={{ padding: '0.5rem', margin: 0 }}>
                  <img src={mockup.smart_crop_url} alt="Smart crop variant" className="mockup-variant-image" />
                </div>
              )}
              <button className="btn-secondary" disabled={saving} onClick={() => selectVariant('smart_crop')}>
                Use Smart Crop
              </button>
            </div>
            <div className="mockup-variant-col">
              <span className="mockup-variant-label">Option B: AI Extended</span>
              {mockup.ai_extended_url && (
                <div className="settings-readonly-box" style={{ padding: '0.5rem', margin: 0 }}>
                  <img src={mockup.ai_extended_url} alt="AI-extended variant" className="mockup-variant-image" />
                </div>
              )}
              <button className="btn-primary" disabled={saving} onClick={() => selectVariant('ai_extended')}>
                Use AI Extended
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="mockup-variant-col" style={{ alignItems: 'flex-start' }}>
          {mockup.file_url && (
            <div className="settings-readonly-box" style={{ padding: '0.75rem', margin: 0 }}>
              <img src={mockup.file_url} alt="Selected mockup" className="mockup-variant-image" style={{ width: 'min(240px, 100%)' }} />
            </div>
          )}
        </div>
      )}

      {error && <p className="text-danger mt-2">{error}</p>}
    </div>
  );
}

/**
 * Manual category-selection gate for the curated flow (plan.md -> "Mockup categories").
 * Polished to match the dark unified design system, checkboxes, and spacing scale.
 */
function MockupCategorySelector({ jobId, onGenerated }) {
  const [categories, setCategories] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [checked, setChecked] = useState({});
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
      <h4 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Select Mockup Categories to Generate</h4>
      {categories.length ? (
        <>
          <div className="mockup-category-checklist">
            {categories.map((c) => (
              <label key={c} className="settings-checkbox-row">
                <input type="checkbox" checked={!!checked[c]} onChange={() => toggleCategory(c)} />
                <span style={{ fontWeight: 600 }}>{c}</span>
              </label>
            ))}
          </div>
          <div className="mt-3">
            <button className="btn-primary" onClick={handleGenerate} disabled={running || !resolvedSizeKeys.length}>
              {running ? 'Generating mockups…' : '✦ Generate Mockups for Selected Categories'}
            </button>
          </div>
        </>
      ) : (
        <p className="empty-state" style={{ margin: 0 }}>
          No mockup categories configured yet — tag templates with a category in Mockup Templates.
        </p>
      )}
      {status && <p className="mono taste-status mt-2">{status}</p>}
      {error && <p className="text-danger mt-2">{error}</p>}
    </div>
  );
}

/**
 * Loads and reviews a job's mockups — polished to match the app shell.
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
    loadMockups();
  }

  return (
    <div>
      <MockupCategorySelector jobId={jobId} onGenerated={loadMockups} />
      <div className="mb-4">
        <button className="btn-secondary" onClick={loadMockups} disabled={!jobId || loading}>
          {loading ? 'Loading mockups…' : 'Load generated mockups'}
        </button>
      </div>
      {error && <p className="text-danger mb-3">{error}</p>}
      {mockups.map((m) => (
        <MockupCard key={m.id} mockup={m} onVariantChange={handleVariantChange} />
      ))}
      {mockups.length === 0 && !loading && !error && (
        <p className="empty-state">No mockups generated or loaded yet for this job.</p>
      )}
    </div>
  );
}
