import { useEffect, useMemo, useState } from 'react';
import { useAsyncTask } from './hooks/useAsyncTask.js';

/**
 * One mockup's review card.
 */
function MockupCard({ mockup, onVariantChange }) {
  const { pending: saving, error, run } = useAsyncTask();

  function selectVariant(variant) {
    run(async () => {
      const res = await fetch(`/api/jobs/${mockup.job_id}/mockups/${mockup.id}/variant`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update variant');
      onVariantChange(data);
    });
  }

  return (
    <div className="card paper-card mb-4">
      <div className="settings-readonly-header mb-4">
        <h4 className="m-0 font-bold text-ink">
          {mockup.size_key} {mockup.dimensions ? `(${mockup.dimensions})` : ''}
        </h4>
        <span className="read-only-badge">
          {mockup.needs_review ? 'Review Required' : `Selected: ${mockup.selected_variant || 'default'}`}
        </span>
      </div>

      {mockup.needs_review ? (
        <>
          <p className="mockup-review-status mb-3">Needs review — pick a variant:</p>
          <div className="mockup-variants-row">
            <div className="mockup-variant-col">
              <span className="mockup-variant-label">Option A: Smart Crop</span>
              {mockup.smart_crop_url && (
                <div className="surface p-2 m-0">
                  <img src={mockup.smart_crop_url} alt="Smart crop variant" className="mockup-variant-image" />
                </div>
              )}
              <button className="btn-secondary" disabled={saving} onClick={() => selectVariant('smart_crop')}>
                Use smart crop
              </button>
            </div>
            <div className="mockup-variant-col">
              <span className="mockup-variant-label">Option B: AI Extended</span>
              {mockup.ai_extended_url && (
                <div className="surface p-2 m-0">
                  <img src={mockup.ai_extended_url} alt="AI-extended variant" className="mockup-variant-image" />
                </div>
              )}
              <button className="btn-primary" disabled={saving} onClick={() => selectVariant('ai_extended')}>
                Use AI extended
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="mockup-variant-col" style={{ alignItems: 'flex-start' }}>
          {mockup.file_url && (
            <div className="surface p-3 m-0">
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
 * Manual category-selection gate for the curated flow.
 *
 * Deliberately left off useAsyncTask: `loaded` here means "has the initial
 * categories/templates fetch ever succeeded," not "is a fetch currently in flight" --
 * on failure it's meant to stay false forever (the component renders nothing rather
 * than a stuck error state) rather than flip back to not-pending like a normal
 * request would. That's different enough from useAsyncTask's pending/error shape
 * that forcing it through the hook would risk changing this existing behavior.
 */
function MockupCategorySelector({ jobId, onGenerated }) {
  const [categories, setCategories] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [checked, setChecked] = useState({});
  const [status, setStatus] = useState('');
  const { pending: running, error, run } = useAsyncTask();

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
      .catch(() => {});
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
    setStatus('Generating mockups…');
    // useAsyncTask's run() catches internally rather than rejecting, so it always
    // resolves -- use its return value (the task's own return, or undefined on
    // failure) to tell success from failure here, rather than a .catch().
    const succeeded = await run(async () => {
      const res = await fetch(`/api/jobs/${jobId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size_keys: resolvedSizeKeys }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate mockups');
      setStatus(`Generated mockups for ${resolvedSizeKeys.length} template${resolvedSizeKeys.length === 1 ? '' : 's'}.`);
      onGenerated?.();
      return true;
    });
    if (!succeeded) setStatus('');
  }

  if (!loaded) return null;

  return (
    <div className="panel paper-card mockup-category-selector">
      <h4 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Select Mockup Categories to Generate</h4>
      {categories.length ? (
        <>
          <div className="mockup-category-checklist">
            {categories.map((c) => (
              <label key={c} className="settings-checkbox-row">
                <input type="checkbox" className="input" checked={!!checked[c]} onChange={() => toggleCategory(c)} />
                <span style={{ fontWeight: 600 }}>{c}</span>
              </label>
            ))}
          </div>
          <div className="mt-3">
            <button className="btn-primary" onClick={handleGenerate} disabled={running || !resolvedSizeKeys.length}>
              {running ? 'Generating mockups…' : 'Generate mockups for selected categories'}
            </button>
          </div>
        </>
      ) : (
        <p className="empty-state" style={{ margin: 0 }}>
          No mockup categories configured yet.
        </p>
      )}
      {status && <p className="mono taste-status mt-2">{status}</p>}
      {error && <p className="text-danger mt-2">{error}</p>}
    </div>
  );
}

/**
 * Loads and reviews a job's mockups.
 */
export default function JobMockupReview({ jobId }) {
  const [mockups, setMockups] = useState([]);
  const { pending: loading, error, run } = useAsyncTask();

  function loadMockups() {
    if (!jobId) return;
    run(async () => {
      const res = await fetch(`/api/jobs/${jobId}/mockups`);
      if (!res.ok) throw new Error('Failed to load mockups');
      setMockups(await res.json());
    });
  }

  function handleVariantChange() {
    loadMockups();
  }

  return (
    <div>
      <MockupCategorySelector jobId={jobId} onGenerated={loadMockups} />
      <div className="mb-4">
        <button className="btn-secondary" onClick={loadMockups} disabled={!jobId || loading}>
          {loading ? 'Loading mockups…' : 'Load mockups'}
        </button>
      </div>
      {error && <p className="text-danger mb-3">{error}</p>}
      {mockups.map((m) => (
        <MockupCard key={m.id} mockup={m} onVariantChange={handleVariantChange} />
      ))}
      {mockups.length === 0 && !loading && !error && (
        <p className="empty-state">No mockups loaded yet.</p>
      )}
    </div>
  );
}
