import { useState } from 'react';

const cardStyle = {
  border: '1px solid #ccc',
  borderRadius: 8,
  padding: '1rem',
  marginBottom: '1rem',
};

const variantColumnStyle = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' };

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
    <div style={cardStyle}>
      <h4 style={{ marginTop: 0 }}>
        {mockup.size_key} {mockup.dimensions ? `(${mockup.dimensions})` : ''}
      </h4>

      {mockup.needs_review ? (
        <>
          <p style={{ color: '#b45309', marginTop: 0 }}>Needs review — pick a variant:</p>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <div style={variantColumnStyle}>
              <strong>Smart crop</strong>
              {mockup.smart_crop_url && (
                <img src={mockup.smart_crop_url} alt="Smart crop variant" width={200} />
              )}
              <button disabled={saving} onClick={() => selectVariant('smart_crop')}>
                Use smart crop
              </button>
            </div>
            <div style={variantColumnStyle}>
              <strong>AI extended</strong>
              {mockup.ai_extended_url && (
                <img src={mockup.ai_extended_url} alt="AI-extended variant" width={200} />
              )}
              <button disabled={saving} onClick={() => selectVariant('ai_extended')}>
                Use AI extended
              </button>
            </div>
          </div>
        </>
      ) : (
        <div style={variantColumnStyle}>
          <span>Selected: {mockup.selected_variant}</span>
          {mockup.file_url && <img src={mockup.file_url} alt="Selected mockup" width={200} />}
        </div>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
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
      <button onClick={loadMockups} disabled={!jobId || loading}>
        {loading ? 'Loading…' : 'Load mockups'}
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {mockups.map((m) => (
        <MockupCard key={m.id} mockup={m} onVariantChange={handleVariantChange} />
      ))}
      {mockups.length === 0 && !loading && !error && (
        <p style={{ color: '#888' }}>No mockups loaded yet.</p>
      )}
    </div>
  );
}
