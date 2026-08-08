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
 * One listing variation's review/edit card — polished to match the dark unified
 * design system, spacing scale, and visual hierarchy.
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
  const [copiedField, setCopiedField] = useState(null);

  async function handleCopyField(text, fieldName) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setError('Clipboard copy failed — copy manually.');
    }
  }

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
    <div className="card paper-card mb-4">
      <div className="settings-readonly-header mb-4">
        <h4 className="listing-card-title">{listing.variation?.replace('_', ' ')}</h4>
        <span className="read-only-badge">AI Listing</span>
      </div>

      <div className="settings-field mb-3">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 'var(--space-1)' }}>
          <label className="settings-field-label" htmlFor={`listing-title-${listing.id}`}>
            Title (max 140 chars)
          </label>
          <button
            type="button"
            className="btn-secondary btn-xs"
            onClick={() => handleCopyField(title, 'title')}
            title="Copy Title to clipboard"
            aria-label="Copy Title to clipboard"
            style={{ padding: '2px 8px', height: 'auto', minHeight: '18px' }}
          >
            {copiedField === 'title' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <input
          id={`listing-title-${listing.id}`}
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="settings-field mb-3">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 'var(--space-1)' }}>
          <label className="settings-field-label" htmlFor={`listing-desc-${listing.id}`}>
            Description
          </label>
          <button
            type="button"
            className="btn-secondary btn-xs"
            onClick={() => handleCopyField(description, 'desc')}
            title="Copy Description to clipboard"
            aria-label="Copy Description to clipboard"
            style={{ padding: '2px 8px', height: 'auto', minHeight: '18px' }}
          >
            {copiedField === 'desc' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <textarea
          id={`listing-desc-${listing.id}`}
          className="listing-textarea input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="settings-field mb-3">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 'var(--space-1)' }}>
          <label className="settings-field-label" htmlFor={`listing-tags-${listing.id}`}>
            Tags (comma-separated, max 13)
          </label>
          <button
            type="button"
            className="btn-secondary btn-xs"
            onClick={() => handleCopyField(tagsText, 'tags')}
            title="Copy Tags to clipboard"
            aria-label="Copy Tags to clipboard"
            style={{ padding: '2px 8px', height: 'auto', minHeight: '18px' }}
          >
            {copiedField === 'tags' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <input
          id={`listing-tags-${listing.id}`}
          className="input"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
        />
      </div>

      <div className="settings-field mb-4">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 'var(--space-1)' }}>
          <label className="settings-field-label" htmlFor={`listing-alt-tags-${listing.id}`}>
            Alternate tags (comma-separated)
          </label>
          <button
            type="button"
            className="btn-secondary btn-xs"
            onClick={() => handleCopyField(tagAltText, 'altTags')}
            title="Copy Alternate Tags to clipboard"
            aria-label="Copy Alternate Tags to clipboard"
            style={{ padding: '2px 8px', height: 'auto', minHeight: '18px' }}
          >
            {copiedField === 'altTags' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <input
          id={`listing-alt-tags-${listing.id}`}
          className="input"
          value={tagAltText}
          onChange={(e) => setTagAltText(e.target.value)}
        />
      </div>

      <div className="flex-row">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving changes…' : 'Save'}
        </button>
        <button className="btn-secondary" data-testid="copy-for-etsy" onClick={copyForEtsy}>
          {copied ? 'Copied!' : 'Copy for Etsy'}
        </button>
      </div>

      {warnings.length > 0 && (
        <ul className="listing-warnings-list">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-danger listing-error mt-2">{error}</p>}
    </div>
  );
}

/**
 * Loads and reviews a job's generated listings — polished to match the app shell.
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
      <div className="mb-4">
        <button className="btn-primary" onClick={loadListings} disabled={!jobId || loading}>
          {loading ? 'Loading listings…' : 'Load listings'}
        </button>
      </div>
      {error && <p className="text-danger mb-3">{error}</p>}
      {listings.map((l) => (
        <ListingCard key={l.id} listing={l} onSaved={handleSaved} />
      ))}
      {listings.length === 0 && !loading && !error && (
        <p className="empty-state">No listings loaded yet.</p>
      )}
    </div>
  );
}
