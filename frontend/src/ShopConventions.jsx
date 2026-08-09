import { useEffect, useState } from 'react';

function ShopConventions() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [titleSeparator, setTitleSeparator] = useState('|');
  const [maxTitleLength, setMaxTitleLength] = useState(140);
  const [tagsPerListing, setTagsPerListing] = useState(13);
  const [tagAlternates, setTagAlternates] = useState(5);
  const [maxTagLength, setMaxTagLength] = useState(20);
  const [forbiddenTitleWordsText, setForbiddenTitleWordsText] = useState('');
  const [aiDisclosurePhrasesText, setAiDisclosurePhrasesText] = useState('');
  const [deliveryDetailPhrasesText, setDeliveryDetailPhrasesText] = useState('');

  const [mjVersion, setMjVersion] = useState('--v 6.0');
  const [mjStyle, setMjStyle] = useState('--style raw');
  const [stylizeMin, setStylizeMin] = useState(0);
  const [stylizeMax, setStylizeMax] = useState(1000);
  const [defaultStylize, setDefaultStylize] = useState(250);
  const [aspectRatios, setAspectRatios] = useState([]);

  useEffect(() => {
    fetch('/api/config/shop-conventions')
      .then((r) => {
        if (!r.ok) throw new Error(`Server returned status ${r.status}`);
        return r.json();
      })
      .then((cfg) => {
        setLoading(false);
        if (cfg.listing) {
          setTitleSeparator(cfg.listing.titleSeparator ?? '|');
          setMaxTitleLength(cfg.listing.maxTitleLength ?? 140);
          setTagsPerListing(cfg.listing.tagsPerListing ?? 13);
          setTagAlternates(cfg.listing.tagAlternates ?? 5);
          setMaxTagLength(cfg.listing.maxTagLength ?? 20);
          setForbiddenTitleWordsText((cfg.listing.forbiddenTitleWords || []).join('\n'));
          setAiDisclosurePhrasesText((cfg.listing.aiDisclosurePhrases || []).join('\n'));
          setDeliveryDetailPhrasesText((cfg.listing.deliveryDetailPhrases || []).join('\n'));
        }
        if (cfg.midjourney) {
          setMjVersion(cfg.midjourney.version ?? '--v 6.0');
          setMjStyle(cfg.midjourney.style ?? '--style raw');
          setStylizeMin(cfg.midjourney.stylizeMin ?? 0);
          setStylizeMax(cfg.midjourney.stylizeMax ?? 1000);
          setDefaultStylize(cfg.midjourney.defaultStylize ?? 250);
          const arObj = cfg.midjourney.aspectRatioByCategory || {};
          setAspectRatios(
            Object.entries(arObj).map(([category, ratio]) => ({ category, ratio }))
          );
        }
      })
      .catch((err) => {
        setLoading(false);
        setErrorMessage(`Failed to load shop conventions: ${err.message}`);
      });
  }, []);

  function addAspectRatioRow() {
    setAspectRatios((prev) => [...prev, { category: '', ratio: '1:1' }]);
  }

  function updateAspectRatioRow(index, field, value) {
    setAspectRatios((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function removeAspectRatioRow(index) {
    setAspectRatios((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setErrorMessage('');
    setSuccessMessage('');

    const listingPayload = {
      titleSeparator,
      maxTitleLength: Number(maxTitleLength),
      tagsPerListing: Number(tagsPerListing),
      tagAlternates: Number(tagAlternates),
      maxTagLength: Number(maxTagLength),
      forbiddenTitleWords: forbiddenTitleWordsText.split('\n').map((s) => s.trim()).filter(Boolean),
      aiDisclosurePhrases: aiDisclosurePhrasesText.split('\n').map((s) => s.trim()).filter(Boolean),
      deliveryDetailPhrases: deliveryDetailPhrasesText.split('\n').map((s) => s.trim()).filter(Boolean),
    };

    const aspectRatioByCategory = Object.fromEntries(
      aspectRatios.filter((r) => r.category.trim()).map((r) => [r.category.trim(), r.ratio.trim()])
    );

    const midjourneyPayload = {
      version: mjVersion,
      style: mjStyle,
      stylizeMin: Number(stylizeMin),
      stylizeMax: Number(stylizeMax),
      defaultStylize: Number(defaultStylize),
      aspectRatioByCategory,
    };

    try {
      const res = await fetch('/api/config/shop-conventions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing: listingPayload, midjourney: midjourneyPayload }),
      });
      let result;
      try {
        result = await res.json();
      } catch {
        throw new Error(`Server returned status ${res.status}`);
      }
      if (!res.ok) {
        throw new Error(result.error || 'Failed to save shop conventions');
      }
      setSuccessMessage('Shop conventions saved successfully.');
    } catch (err) {
      setErrorMessage(err.message);
    }
    setSaving(false);
  }

  if (loading) {
    return <p className="empty-state">Loading shop conventions…</p>;
  }

  return (
    <div className="settings-section-card card settings-full-width-card">
      <h3 className="settings-section-title">Shop Conventions & Midjourney Settings</h3>

      {errorMessage && (
        <div className="backend-banner" role="alert" style={{ marginBottom: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--state-danger)' }}>
          <span className="text-danger">Error: {errorMessage}</span>
          <button className="btn-secondary btn-sm" onClick={() => setErrorMessage('')}>Dismiss</button>
        </div>
      )}

      {successMessage && (
        <div className="backend-banner" role="alert" style={{ marginBottom: '1rem', background: 'rgba(34, 197, 94, 0.1)', borderColor: 'var(--state-success)' }}>
          <span className="text-success">{successMessage}</span>
          <button className="btn-secondary btn-sm" onClick={() => setSuccessMessage('')}>Dismiss</button>
        </div>
      )}

      <div className="settings-subsection">
        <h4 className="settings-sub-heading">Listing conventions</h4>
        <div className="settings-field-row">
          <div className="settings-field">
            <label htmlFor="shop-conv-title-separator" className="settings-field-label">Title separator</label>
            <input
              id="shop-conv-title-separator"
              className="input"
              value={titleSeparator}
              onChange={(e) => setTitleSeparator(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="shop-conv-max-title-length" className="settings-field-label">Max title length</label>
            <input
              id="shop-conv-max-title-length"
              type="number"
              className="input"
              value={maxTitleLength}
              onChange={(e) => setMaxTitleLength(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="shop-conv-tags-per-listing" className="settings-field-label">Tags per listing</label>
            <input
              id="shop-conv-tags-per-listing"
              type="number"
              className="input"
              value={tagsPerListing}
              onChange={(e) => setTagsPerListing(e.target.value)}
            />
          </div>
        </div>

        <div className="settings-field-row" style={{ marginTop: '1rem' }}>
          <div className="settings-field">
            <label htmlFor="shop-conv-tag-alternates" className="settings-field-label">Tag alternates</label>
            <input
              id="shop-conv-tag-alternates"
              type="number"
              className="input"
              value={tagAlternates}
              onChange={(e) => setTagAlternates(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="shop-conv-max-tag-length" className="settings-field-label">Max tag length</label>
            <input
              id="shop-conv-max-tag-length"
              type="number"
              className="input"
              value={maxTagLength}
              onChange={(e) => setMaxTagLength(e.target.value)}
            />
          </div>
        </div>

        <div className="settings-field-row" style={{ marginTop: '1rem', alignItems: 'stretch' }}>
          <div className="settings-field" style={{ flex: 1 }}>
            <label htmlFor="shop-conv-forbidden-words" className="settings-field-label">Forbidden title words (one per line)</label>
            <textarea
              id="shop-conv-forbidden-words"
              rows={4}
              className="mono input"
              style={{ width: '100%' }}
              value={forbiddenTitleWordsText}
              onChange={(e) => setForbiddenTitleWordsText(e.target.value)}
            />
          </div>
          <div className="settings-field" style={{ flex: 1 }}>
            <label htmlFor="shop-conv-ai-disclosure" className="settings-field-label">AI disclosure phrases (one per line)</label>
            <textarea
              id="shop-conv-ai-disclosure"
              rows={4}
              className="mono input"
              style={{ width: '100%' }}
              value={aiDisclosurePhrasesText}
              onChange={(e) => setAiDisclosurePhrasesText(e.target.value)}
            />
          </div>
        </div>

        <div className="settings-field" style={{ marginTop: '1rem' }}>
          <label htmlFor="shop-conv-delivery-phrases" className="settings-field-label">Delivery detail phrases (one per line)</label>
          <textarea
            id="shop-conv-delivery-phrases"
            rows={3}
            className="mono input"
            style={{ width: '100%' }}
            value={deliveryDetailPhrasesText}
            onChange={(e) => setDeliveryDetailPhrasesText(e.target.value)}
          />
        </div>
      </div>

      <div className="settings-subsection">
        <h4 className="settings-sub-heading">Midjourney conventions</h4>
        <div className="settings-field-row">
          <div className="settings-field">
            <label htmlFor="shop-conv-mj-version" className="settings-field-label">Version</label>
            <input
              id="shop-conv-mj-version"
              className="input"
              value={mjVersion}
              onChange={(e) => setMjVersion(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="shop-conv-mj-style" className="settings-field-label">Style</label>
            <input
              id="shop-conv-mj-style"
              className="input"
              value={mjStyle}
              onChange={(e) => setMjStyle(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="shop-conv-default-stylize" className="settings-field-label">Default stylize</label>
            <input
              id="shop-conv-default-stylize"
              type="number"
              className="input"
              value={defaultStylize}
              onChange={(e) => setDefaultStylize(e.target.value)}
            />
          </div>
        </div>

        <div className="settings-field-row" style={{ marginTop: '1rem' }}>
          <div className="settings-field">
            <label htmlFor="shop-conv-stylize-min" className="settings-field-label">Stylize min</label>
            <input
              id="shop-conv-stylize-min"
              type="number"
              className="input"
              value={stylizeMin}
              onChange={(e) => setStylizeMin(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="shop-conv-stylize-max" className="settings-field-label">Stylize max</label>
            <input
              id="shop-conv-stylize-max"
              type="number"
              className="input"
              value={stylizeMax}
              onChange={(e) => setStylizeMax(e.target.value)}
            />
          </div>
        </div>

        <div className="settings-subsection" style={{ marginTop: '1rem', marginBottom: 0 }}>
          <h5 className="settings-sub-heading" style={{ fontSize: '13px' }}>Aspect ratio by category</h5>
          {aspectRatios.map((row, index) => (
            <div key={index} className="settings-field-row" style={{ alignItems: 'center', marginBottom: '0.5rem' }}>
              <div className="settings-field" style={{ flex: 1 }}>
                <input
                  className="input"
                  placeholder="Category (e.g. botanical)"
                  value={row.category}
                  onChange={(e) => updateAspectRatioRow(index, 'category', e.target.value)}
                />
              </div>
              <div className="settings-field" style={{ width: '120px' }}>
                <input
                  className="input"
                  placeholder="Ratio (e.g. 3:4)"
                  value={row.ratio}
                  onChange={(e) => updateAspectRatioRow(index, 'ratio', e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => removeAspectRatioRow(index)}
                title="Remove category ratio"
                aria-label="Remove category ratio"
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn-secondary btn-sm" onClick={addAspectRatioRow} style={{ marginTop: '0.5rem' }}>
            + Add category aspect ratio
          </button>
        </div>
      </div>

      <div className="flex-row" style={{ marginTop: '1.5rem', gap: '1rem' }}>
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save shop conventions'}
        </button>
      </div>
    </div>
  );
}

export default ShopConventions;
