import { useEffect, useState } from 'react';

const cardStyle = {
  border: '1px solid #ccc',
  borderRadius: 8,
  padding: '1rem',
  marginBottom: '1rem',
};

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
    <div style={cardStyle}>
      <div style={{ marginBottom: '0.75rem' }}>
        <label>
          Category:{' '}
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Trend:{' '}
          <select value={selectedTrendId} onChange={(e) => setSelectedTrendId(e.target.value)} disabled={loadingTrends}>
            <option value="">(none)</option>
            {trends.map((t) => (
              <option key={t.id} value={t.id}>
                {t.term}
                {t.category ? ` (${t.category})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <input
          placeholder="Add a new trend"
          value={newTrendTerm}
          onChange={(e) => setNewTrendTerm(e.target.value)}
        />
        <input
          placeholder="Trend category (optional)"
          value={newTrendCategory}
          onChange={(e) => setNewTrendCategory(e.target.value)}
        />
        <button onClick={addTrend} disabled={addingTrend || !newTrendTerm.trim()}>
          {addingTrend ? 'Adding…' : 'Add trend'}
        </button>
      </div>

      <button onClick={generate} disabled={generating}>
        {generating ? 'Generating…' : 'Generate prompts'}
      </button>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {generated.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Generated prompts</h4>
          {generated.map((p) => (
            <div key={p.id} style={{ marginBottom: '0.5rem' }}>
              <code>{p.prompt_text}</code>{' '}
              <button onClick={() => copyToClipboard(p.prompt_text)}>Copy</button>
              {p.warnings.length > 0 && (
                <ul style={{ color: '#888', fontSize: '0.85em' }}>
                  {p.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h4>History for &quot;{category}&quot;</h4>
          <ul style={{ fontSize: '0.9em', color: '#555' }}>
            {history.map((p) => (
              <li key={p.id}>
                <code>{p.prompt_text}</code> <button onClick={() => copyToClipboard(p.prompt_text)}>Copy</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
