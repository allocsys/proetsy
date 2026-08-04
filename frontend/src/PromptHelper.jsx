import { useEffect, useState } from 'react';

const CATEGORIES = ['portrait', 'landscape', 'square'];

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
  }
}

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
    <div className="module-panel">
      <div className="control-row">
        <div className="control-group">
          <label className="control-label" htmlFor="prompt-category-select">Category:</label>
          <select id="prompt-category-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label className="control-label">Trend</label>
          <select value={selectedTrendId} onChange={(e) => setSelectedTrendId(e.target.value)} disabled={loadingTrends}>
            <option value="">(none)</option>
            {trends.map((t) => (
              <option key={t.id} value={t.id}>{t.term}{t.category ? ` (${t.category})` : ''}</option>
            ))}
          </select>
        </div>
        <button className="btn-primary" onClick={generate} disabled={generating}>
          {generating ? 'Generating…' : 'Generate prompts'}
        </button>
      </div>

      <div className="control-row" style={{ marginTop: '1rem' }}>
        <input
          placeholder="Add a new trend"
          aria-label="Add a new trend"
          value={newTrendTerm}
          onChange={(e) => setNewTrendTerm(e.target.value)}
        />
        <input
          placeholder="Category"
          aria-label="Trend category"
          value={newTrendCategory}
          onChange={(e) => setNewTrendCategory(e.target.value)}
        />
        <button className="btn-secondary" onClick={addTrend} disabled={addingTrend || !newTrendTerm.trim()}>
          {addingTrend ? 'Adding…' : 'Add trend'}
        </button>
      </div>

      <div className="mt-2 text-muted mono-sm">
        Import CSV (<code>term</code>, <code>category</code>): <input type="file" accept=".csv,text/csv" onChange={(e) => importTrendsCsv(e.target.files?.[0])} />
        {csvMessage && <span className="ml-1">{csvMessage}</span>}
      </div>

      {error && <p className="status-error mt-2">{error}</p>}

      {generated.length > 0 && (
        <div className="mt-4">
          <h4 className="settings-sub-heading">Generated</h4>
          {generated.map((p) => (
            <div key={p.id} className="settings-section-card" style={{ marginBottom: '0.75rem' }}>
              <code className="block mb-2">{p.prompt_text}</code>
              <button className="btn-secondary btn-sm" onClick={() => copyToClipboard(p.prompt_text)}>Copy</button>
              {p.warnings.length > 0 && (
                <ul className="text-danger mt-2">
                  {p.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <h4 className="settings-sub-heading">History: &quot;{category}&quot;</h4>
          <ul className="settings-compact-list">
            {history.map((p) => (
              <li key={p.id} className="flex-row items-center justify-between">
                <code className="mono-sm">{p.prompt_text}</code> 
                <button className="btn-ghost btn-sm" onClick={() => copyToClipboard(p.prompt_text)}>Copy</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
