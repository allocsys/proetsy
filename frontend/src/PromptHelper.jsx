import { useEffect, useState } from 'react';

const CATEGORIES = ['portrait', 'landscape', 'square'];

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
  }
}

const COPIED_FEEDBACK_MS = 1500;

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
  const [copiedId, setCopiedId] = useState(null);

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

  function handleCopy(id, text) {
    copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, COPIED_FEEDBACK_MS);
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
    <div className="panel" style={{ padding: '2rem', border: 'none', background: 'transparent', boxShadow: 'none' }}>
      <h2 style={{ marginTop: 0, marginBottom: '1.5rem', fontFamily: 'var(--font-body)', fontWeight: 700 }}>Prompt Helper & Trends</h2>
      
      <div className="card settings-section-card">
        <h3 className="settings-section-title">Generate Prompts</h3>
        <div className="settings-field-row mb-3">
          <div className="settings-field flex-1">
            <label className="settings-field-label" htmlFor="prompt-category-select">Category:</label>
            <select 
              className="input" 
              id="prompt-category-select"
              value={category} 
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="settings-field flex-1">
            <span className="settings-field-label" id="prompt-trend-label">Trend</span>
            <select 
              className="input" 
              aria-labelledby="prompt-trend-label"
              value={selectedTrendId} 
              onChange={(e) => setSelectedTrendId(e.target.value)} 
              disabled={loadingTrends}
            >
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
      </div>

      <div className="card settings-section-card">
        <h3 className="settings-section-title">Add Trend</h3>
        <div className="settings-field-row mb-3">
          <div className="settings-field flex-1">
            <span className="settings-field-label">New trend term</span>
            <input
              className="input"
              placeholder="Add a new trend"
              aria-label="Add a new trend"
              value={newTrendTerm}
              onChange={(e) => setNewTrendTerm(e.target.value)}
            />
          </div>
          <div className="settings-field flex-1">
            <span className="settings-field-label">Category</span>
            <input
              className="input"
              placeholder="Category"
              aria-label="Trend category"
              value={newTrendCategory}
              onChange={(e) => setNewTrendCategory(e.target.value)}
            />
          </div>
          <button className="btn-secondary" onClick={addTrend} disabled={addingTrend || !newTrendTerm.trim()}>
            {addingTrend ? 'Adding…' : 'Add trend'}
          </button>
        </div>

        <div className="mt-2 text-muted mono-sm mb-2 settings-field" style={{ marginTop: '1rem' }}>
          <span className="settings-field-label">Import CSV (<code>term</code>, <code>category</code>)</span>
          <div className="settings-field-row" style={{ marginTop: '0.35rem' }}>
            <input className="input input-auto" id="csv-file-input" type="file" accept=".csv,text/csv" onChange={(e) => importTrendsCsv(e.target.files?.[0])} />
            {csvMessage && <span className="text-muted mono-sm">{csvMessage}</span>}
          </div>
        </div>
      </div>

      {error && <p className="text-danger mt-2">{error}</p>}

      {generated.length > 0 && (
        <div className="card settings-section-card">
          <h3 className="settings-section-title">Generated Prompts</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {generated.map((p) => (
              <div key={p.id} className="surface p-4" style={{ padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                <code className="prompt-code-block block mb-2">{p.prompt_text}</code>
                <button className="btn-secondary btn-sm" onClick={() => handleCopy(`generated-${p.id}`, p.prompt_text)}>
                  {copiedId === `generated-${p.id}` ? 'Copied!' : 'Copy'}
                </button>
                {p.warnings.length > 0 && (
                  <ul className="prompt-warnings-list mt-2">
                    {p.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="card settings-section-card">
          <h3 className="settings-section-title">History: &quot;{category}&quot;</h3>
          <ul className="prompt-history-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {history.map((p) => (
              <li key={p.id} className="prompt-history-item flex-row items-center justify-between surface" style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <code className="mono-sm" style={{ wordBreak: 'break-all', marginRight: '1rem' }}>{p.prompt_text}</code> 
                <button className="btn-ghost btn-sm" onClick={() => handleCopy(`history-${p.id}`, p.prompt_text)}>
                  {copiedId === `history-${p.id}` ? 'Copied!' : 'Copy'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
