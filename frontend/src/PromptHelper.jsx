import { useEffect, useState } from 'react';

const CATEGORIES = ['portrait', 'landscape', 'square'];

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
  }
}

/**
 * Module 4 (Trend/Prompt Helper) dashboard surface. Unlike JobListingReview/
 * JobMockupReview, this isn't job-scoped — no jobId prop — it's keyed only by an
 * optional selected trend + a target category, per ARCHITECTURE.md -> Module 4 and its
 * isolation from the main pipeline (Partial Failure Handling).
 *
 * Covers: browsing/creating trends (GET/POST /api/trends), generating a fresh batch of
 * ready-to-paste Midjourney prompts (POST /api/prompts/generate), and a browsable
 * history of previously generated batches (GET /api/prompts) for the selected category.
 */
export default function PromptHelper() {
  const [trends, setTrends] = useState([]);
  const [selectedTrendId, setSelectedTrendId] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [newTrendTerm, setNewTrendTerm] = useState('');
  const [newTrendCategory, setNewTrendCategory] = useState('');
  const [generated, setGenerated] = useState([]);
  const [history, setHistory] = useState([]);
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [addingTrend, setAddingTrend] = useState(false);
  const [csvMessage, setCsvMessage] = useState('');
  const [error, setError] = useState(null);

  async function loadTrends() {
    setLoadingTrends(true);
    try {
      const res = await fetch('/api/trends');
      const data = await res.json();
      if (res.ok) setTrends(data);
    } finally {
      setLoadingTrends(false);
    }
  }

  async function loadHistory(forCategory) {
    const res = await fetch(`/api/prompts?category=${encodeURIComponent(forCategory)}`);
    const data = await res.json();
    if (res.ok) setHistory(data);
  }

  useEffect(() => {
    loadTrends();
  }, []);

  useEffect(() => {
    loadHistory(category);
  }, [category]);

  async function addTrend() {
    if (!newTrendTerm.trim()) return;
    setAddingTrend(true);
    setError(null);
    try {
      const res = await fetch('/api/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term: newTrendTerm, category: newTrendCategory || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add trend');
      setNewTrendTerm('');
      setNewTrendCategory('');
      await loadTrends();
      setSelectedTrendId(String(data.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingTrend(false);
    }
  }

  // CSV trend import (ARCHITECTURE.md -> Trends Provider Layer -> "CSV import in
  // manual.js"). Reads the picked file as plain text client-side and posts it to
  // POST /api/trends/csv, which expects a header row with a term/keyword/trend column
  // and an optional category column -- the tool's own export feature, not automation
  // against its site, same ToS-clean framing as the rest of this provider layer.
  async function importTrendsCsv(file) {
    if (!file) return;
    setCsvMessage(`Importing ${file.name}…`);
    try {
      const csv = await file.text();
      const res = await fetch('/api/trends/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      setCsvMessage(res.ok ? `Imported ${data.imported} trend(s) from ${file.name}.` : data.error);
      if (res.ok) await loadTrends();
    } catch (err) {
      setCsvMessage(`Import failed: ${err.message}`);
    }
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/prompts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trend_id: selectedTrendId ? Number(selectedTrendId) : null,
          category,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Prompt generation failed');
      setGenerated(data.prompts);
      await loadHistory(category);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="dark-panel">
      <div className="prompt-filter-row">
        <label className="prompt-filter-label" htmlFor="prompt-category-select">
          Category:
        </label>
        <select id="prompt-category-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="prompt-filter-label" htmlFor="prompt-trend-select">
          Trend:
        </label>
        <select id="prompt-trend-select" value={selectedTrendId} onChange={(e) => setSelectedTrendId(e.target.value)} disabled={loadingTrends}>
          <option value="">(none)</option>
          {trends.map((t) => (
            <option key={t.id} value={t.id}>{t.term}{t.category ? ` (${t.category})` : ''}</option>
          ))}
        </select>
      </div>

      <div className="prompt-add-row">
        <input
          id="new-trend-term-input"
          className="prompt-flex-input"
          aria-label="Add a new trend"
          placeholder="Add a new trend"
          value={newTrendTerm}
          onChange={(e) => setNewTrendTerm(e.target.value)}
        />
        <input
          id="new-trend-category-input"
          className="prompt-flex-input"
          aria-label="Trend category"
          placeholder="Trend category"
          value={newTrendCategory}
          onChange={(e) => setNewTrendCategory(e.target.value)}
        />
        <button className="btn-secondary" onClick={addTrend} disabled={addingTrend || !newTrendTerm.trim()}>
          {addingTrend ? 'Adding…' : 'Add trend'}
        </button>
      </div>

      <div className="prompt-csv-container">
        <label className="prompt-csv-label" htmlFor="csv-file-input">
          Or import a CSV export (<code>term</code> column, optional <code>category</code>):{' '}
        </label>
        <input id="csv-file-input" type="file" accept=".csv,text/csv" onChange={(e) => importTrendsCsv(e.target.files?.[0])} />
        {csvMessage && <span className="prompt-csv-message">{csvMessage}</span>}
      </div>

      <button onClick={generate} disabled={generating}>
        {generating ? 'Generating…' : 'Generate prompts'}
      </button>

      {error && <p className="text-danger mt-1">{error}</p>}

      {generated.length > 0 && (
        <div className="mt-3">
          <h4 className="prompt-section-title">Generated prompts</h4>
          {generated.map((p) => (
            <div key={p.id} className="prompt-item-card">
              <code className="prompt-code-block">{p.prompt_text}</code>
              <button className="btn-secondary btn-sm" onClick={() => copyToClipboard(p.prompt_text)}>Copy</button>
              {p.warnings.length > 0 && (
                <ul className="prompt-warnings-list">
                  {p.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-3">
          <h4 className="prompt-section-title">History for &quot;{category}&quot;</h4>
          <ul className="prompt-history-list">
            {history.map((p) => (
              <li key={p.id} className="prompt-history-item">
                <code className="mono-sm">{p.prompt_text}</code> <button className="btn-secondary btn-xs" onClick={() => copyToClipboard(p.prompt_text)}>Copy</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
