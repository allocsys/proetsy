import { useState } from 'react';

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
    <div className="dark-panel listing-card">
      <h4 className="listing-card-title">{listing.variation?.replace('_', ' ')}</h4>

      <label className="listing-field-label" htmlFor={`listing-title-${listing.id}`}>
        Title
      </label>
      <input
        id={`listing-title-${listing.id}`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <label className="listing-field-label" htmlFor={`listing-desc-${listing.id}`}>
        Description
      </label>
      <textarea
        id={`listing-desc-${listing.id}`}
        className="listing-textarea"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label className="listing-field-label" htmlFor={`listing-tags-${listing.id}`}>
        Tags (comma-separated)
      </label>
      <input
        id={`listing-tags-${listing.id}`}
        value={tagsText}
        onChange={(e) => setTagsText(e.target.value)}
      />

      <label className="listing-field-label" htmlFor={`listing-alt-tags-${listing.id}`}>
        Alternate tags (comma-separated)
      </label>
      <input
        id={`listing-alt-tags-${listing.id}`}
        value={tagAltText}
        onChange={(e) => setTagAltText(e.target.value)}
      />

      <div className="flex-row">
        <button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-secondary" data-testid="copy-for-etsy" onClick={copyForEtsy}>{copied ? 'Copied!' : 'Copy for Etsy'}</button>
      </div>

      {warnings.length > 0 && (
        <ul className="listing-warnings-list">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-danger listing-error">{error}</p>}
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
      {error && <p className="text-danger">{error}</p>}
      {listings.map((l) => (
        <ListingCard key={l.id} listing={l} onSaved={handleSaved} />
      ))}
      {listings.length === 0 && !loading && !error && (
        <p className="text-muted">No listings loaded yet.</p>
      )}
    </div>
  );
}
