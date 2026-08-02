import { useState } from 'react';

// No styles here, using CSS classes.

function tagsToText(tags) {
  return Array.isArray(tags) ? tags.join(', ') : '';
}

function textToTags(text) {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * One listing variation's review/edit card (ARCHITECTURE.md -> Module 6 -> "Previews and
 * allows editing any generated field before publishing"). Local edit state is separate
 * from the loaded `listing` prop so typing doesn't round-trip through the parent on every
 * keystroke; Save sends only the edited fields to the step's PATCH route, which re-applies
 * enforceConventions() and returns the cleaned result (and any new warnings) to show.
 */
function ListingCard({ listing, onSaved }) {
  const [title, setTitle] = useState(listing.title || '');
  const [description, setDescription] = useState(listing.description || '');
  const [tagsText, setTagsText] = useState(tagsToText(listing.tags));
  const [tagAltText, setTagAltText] = useState(tagsToText(listing.tag_alternates));
  const [warnings, setWarnings] = useState(listing.warnings || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${listing.job_id}/listings/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          tags: textToTags(tagsText),
          tag_alternates: textToTags(tagAltText),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save listing');
      // The convention backstop may have adjusted what we sent (e.g. stripped a forbidden
      // word, capped tag count) — reflect the cleaned result back into the fields rather
      // than trusting what was typed.
      setTitle(data.title || '');
      setDescription(data.description || '');
      setTagsText(tagsToText(data.tags));
      setTagAltText(tagsToText(data.tag_alternates));
      setWarnings(data.warnings || []);
      onSaved(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function copyForEtsy() {
    const text = `${title}\n\n${description}\n\nTags: ${tagsText}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard copy failed — select and copy manually.');
    }
  }

  return (
    <div className="dark-panel" style={{ marginBottom: '1rem' }}>
      <h4 style={{ marginTop: 0, textTransform: 'capitalize', color: 'var(--cream)' }}>{listing.variation?.replace('_', ' ')}</h4>

      <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--cream-dim)', fontSize: '13px' }}>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--cream-dim)', fontSize: '13px' }}>
        Description
        <textarea
          style={{ minHeight: '4rem', marginTop: '0.25rem' }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--cream-dim)', fontSize: '13px' }}>
        Tags (comma-separated)
        <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
      </label>

      <label style={{ display: 'block', marginBottom: '1rem', color: 'var(--cream-dim)', fontSize: '13px' }}>
        Alternate tags (comma-separated)
        <input value={tagAltText} onChange={(e) => setTagAltText(e.target.value)} />
      </label>

      <div className="flex-row">
        <button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-secondary" data-testid="copy-for-etsy" onClick={copyForEtsy}>{copied ? 'Copied!' : 'Copy for Etsy'}</button>
      </div>

      {warnings.length > 0 && (
        <ul style={{ color: 'var(--state-pending)', fontSize: '13px', marginTop: '0.75rem', paddingLeft: '1.25rem' }}>
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {error && <p style={{ color: 'var(--state-danger)', fontSize: '13px', marginTop: '0.5rem' }}>{error}</p>}
    </div>
  );
}

/**
 * Loads and reviews a job's generated listings. Takes a jobId as a prop, same as
 * JobMockupReview — Module 6 (the real dashboard, still a skeleton) owns job
 * lookup/selection; this component only covers the review/edit step itself.
 */
export default function JobListingReview({ jobId }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function loadListings() {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/listings`);
      if (!res.ok) throw new Error('Failed to load listings');
      const data = await res.json();
      // GET returns bare listing rows (no job_id echoed back per-row is present already
      // since `listings.*` includes job_id) — kept as-is for the PATCH URL below.
      setListings(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSaved(updated) {
    setListings((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
  }

  return (
    <div>
      <button onClick={loadListings} disabled={!jobId || loading}>
        {loading ? 'Loading…' : 'Load listings'}
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {listings.map((l) => (
        <ListingCard key={l.id} listing={l} onSaved={handleSaved} />
      ))}
      {listings.length === 0 && !loading && !error && (
        <p style={{ color: '#888' }}>No listings loaded yet.</p>
      )}
    </div>
  );
}
