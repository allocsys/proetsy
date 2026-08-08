import { useState } from 'react';
import { useAsyncTask } from './hooks/useAsyncTask.js';

function tagsToText(tags) {
  return Array.isArray(tags) ? tags.join(', ') : '';
}

function textToTags(text) {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

// Mirrors backend/config/shop-conventions.js's SHOP_CONVENTIONS. Kept as local
// constants (not fetched) since these are baked-in, non-editable conventions -- see
// the read-only "Shop conventions" panel in Settings (App.jsx) which shows the same
// values from GET /api/config/shop-conventions. Used here only for live inline
// character/tag-count feedback before Save; the backend's enforceConventions()
// remains the actual source of truth and re-applies these rules on every PATCH
// regardless of what this shows.
const MAX_TITLE_LENGTH = 140;
const TAGS_PER_LISTING = 13;
const MAX_TAG_LENGTH = 20;

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
  const { pending: saving, error, setError, run } = useAsyncTask();
  const [copied, setCopied] = useState(false);

  const parsedTags = textToTags(tagsText);
  const titleOverLimit = title.length > MAX_TITLE_LENGTH;
  const tagsOverLimit = parsedTags.length > TAGS_PER_LISTING;
  const oversizedTagCount = parsedTags.filter((t) => t.length > MAX_TAG_LENGTH).length;

  function save() {
    run(async () => {
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
    });
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
        <label className="settings-field-label" htmlFor={`listing-title-${listing.id}`}>
          Title (max 140 chars)
        </label>
        <input
          id={`listing-title-${listing.id}`}
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <span className={`input-helper-text${titleOverLimit ? ' text-danger' : ''}`}>
          {title.length}/{MAX_TITLE_LENGTH}{titleOverLimit ? ' — over limit, will be truncated on save' : ''}
        </span>
      </div>

      <div className="settings-field mb-3">
        <label className="settings-field-label" htmlFor={`listing-desc-${listing.id}`}>
          Description
        </label>
        <textarea
          id={`listing-desc-${listing.id}`}
          className="listing-textarea input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="settings-field mb-3">
        <label className="settings-field-label" htmlFor={`listing-tags-${listing.id}`}>
          Tags (comma-separated, max 13)
        </label>
        <input
          id={`listing-tags-${listing.id}`}
          className="input"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
        />
        <span className={`input-helper-text${tagsOverLimit || oversizedTagCount ? ' text-danger' : ''}`}>
          {parsedTags.length}/{TAGS_PER_LISTING} tags{oversizedTagCount ? `, ${oversizedTagCount} over ${MAX_TAG_LENGTH} chars` : ''}{tagsOverLimit ? ' — extra tags will be dropped on save' : ''}
        </span>
      </div>

      <div className="settings-field mb-4">
        <label className="settings-field-label" htmlFor={`listing-alt-tags-${listing.id}`}>
          Alternate tags (comma-separated)
        </label>
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
  const { pending: loading, error, run } = useAsyncTask();

  function loadListings() {
    if (!jobId) return;
    run(async () => {
      const res = await fetch(`/api/jobs/${jobId}/listings`);
      if (!res.ok) throw new Error('Failed to load listings');
      const data = await res.json();
      setListings(data);
    });
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
