import { useEffect, useState } from 'react';
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

// Used only until GET /api/config/shop-conventions resolves (or if it fails) -- mirrors
// backend/config/shop-conventions.js's SHOP_CONVENTIONS numeric defaults so the live
// character/tag-count feedback below never shows a blank/zero limit during the brief
// loading window. The phrase lists default to empty rather than a hardcoded guess, since
// a false negative (no warning shown) is safer here than a warning for a phrase list
// that might not match whatever the real backend list actually is.
const FALLBACK_CONVENTIONS = {
  maxTitleLength: 140,
  tagsPerListing: 13,
  maxTagLength: 20,
  forbiddenTitleWords: [],
  aiDisclosurePhrases: [],
  deliveryDetailPhrases: [],
};

function findPhraseHits(text, phrases) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return phrases.filter((p) => lower.includes(p.toLowerCase()));
}

/**
 * One listing variation's review/edit card — polished to match the dark unified
 * design system, spacing scale, and visual hierarchy.
 */
function ListingCard({ listing, onSaved, conventions }) {
  const [title, setTitle] = useState(listing.title || '');
  const [description, setDescription] = useState(listing.description || '');
  const [tagsText, setTagsText] = useState(tagsToText(listing.tags));
  const [tagAltText, setTagAltText] = useState(tagsToText(listing.tag_alternates));
  const [warnings, setWarnings] = useState(listing.warnings || []);
  const { pending: saving, error, setError, run } = useAsyncTask();
  const [copied, setCopied] = useState(false);

  const parsedTags = textToTags(tagsText);
  const titleOverLimit = title.length > conventions.maxTitleLength;
  const tagsOverLimit = parsedTags.length > conventions.tagsPerListing;
  const oversizedTagCount = parsedTags.filter((t) => t.length > conventions.maxTagLength).length;
  // Live preview of what enforceConventions() (backend/lib/listing-generator/validate.js)
  // will silently strip on save -- same three phrase lists, same case-insensitive
  // substring match, so a reviewer sees this coming instead of only finding out from the
  // post-save warnings list below.
  const forbiddenTitleHits = findPhraseHits(title, conventions.forbiddenTitleWords);
  const aiDisclosureHits = findPhraseHits(description, conventions.aiDisclosurePhrases);
  const deliveryDetailHits = findPhraseHits(description, conventions.deliveryDetailPhrases);

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
          Title (max {conventions.maxTitleLength} chars)
        </label>
        <input
          id={`listing-title-${listing.id}`}
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <span className={`input-helper-text${titleOverLimit ? ' text-danger' : ''}`}>
          {title.length}/{conventions.maxTitleLength}{titleOverLimit ? ' — over limit, will be truncated on save' : ''}
        </span>
        {forbiddenTitleHits.length > 0 && (
          <span className="input-helper-text text-danger">
            Contains forbidden word(s), will be removed on save: {forbiddenTitleHits.join(', ')}
          </span>
        )}
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
        {aiDisclosureHits.length > 0 && (
          <span className="input-helper-text text-danger">
            Contains AI-disclosure phrase(s), will be removed on save: {aiDisclosureHits.join(', ')}
          </span>
        )}
        {deliveryDetailHits.length > 0 && (
          <span className="input-helper-text text-danger">
            Contains delivery-detail phrase(s), will be removed on save: {deliveryDetailHits.join(', ')}
          </span>
        )}
      </div>

      <div className="settings-field mb-3">
        <label className="settings-field-label" htmlFor={`listing-tags-${listing.id}`}>
          Tags (comma-separated, max {conventions.tagsPerListing})
        </label>
        <input
          id={`listing-tags-${listing.id}`}
          className="input"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
        />
        <span className={`input-helper-text${tagsOverLimit || oversizedTagCount ? ' text-danger' : ''}`}>
          {parsedTags.length}/{conventions.tagsPerListing} tags{oversizedTagCount ? `, ${oversizedTagCount} over ${conventions.maxTagLength} chars` : ''}{tagsOverLimit ? ' — extra tags will be dropped on save' : ''}
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
  const [conventions, setConventions] = useState(FALLBACK_CONVENTIONS);
  const { pending: loading, error, run } = useAsyncTask();

  // Live feedback in ListingCard is compared against the real backend conventions
  // instead of a second hardcoded copy of them (see FALLBACK_CONVENTIONS above for the
  // brief window before this resolves). Mirrors the read-only "Shop conventions" panel
  // in Settings (App.jsx), which fetches the same route -- this is a second, independent
  // fetch rather than shared state, since JobListingReview can mount without App's
  // settings panel ever having been opened.
  useEffect(() => {
    fetch('/api/config/shop-conventions')
      .then((r) => r.json())
      .then((data) => {
        if (data?.listing) setConventions(data.listing);
      })
      .catch(() => {});
  }, []);

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
        <ListingCard key={l.id} listing={l} onSaved={handleSaved} conventions={conventions} />
      ))}
      {listings.length === 0 && !loading && !error && (
        <p className="empty-state">No listings loaded yet.</p>
      )}
    </div>
  );
}
