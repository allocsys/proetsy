import { useCallback, useMemo, useState } from 'react';
import { useToast } from '../components/Toast.jsx';

// plan.md Step 4: tag library + trend list state, both driven by the same
// Settings > Tags & Trends tab, extracted together since they share the
// refreshSetupStatus/requestConfirm dependencies and a lot of the same shape.
export function useTagsAndTrends(reportFetchError, requestConfirm, refreshSetupStatus) {
  const { showToast } = useToast();

  const [tags, setTags] = useState([]);
  const [tagsText, setTagsText] = useState('');
  const [tagsCategory, setTagsCategory] = useState('');
  const [tagsBackfillRunning, setTagsBackfillRunning] = useState(false);
  const [tagsBackfillPreview, setTagsBackfillPreview] = useState(null);
  const [tagsBackfillPreviewLoading, setTagsBackfillPreviewLoading] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(true);

  const [trends, setTrends] = useState([]);
  const [newTrendTerm, setNewTrendTerm] = useState('');
  const [newTrendCategory, setNewTrendCategory] = useState('');
  const [trendsLoading, setTrendsLoading] = useState(true);

  const refreshTags = useCallback(() => {
    fetch('/api/tags')
      .then((r) => r.json())
      .then((data) => { setTags(data); setTagsLoading(false); })
      .catch((err) => { setTagsLoading(false); reportFetchError('refreshTags')(err); });
  }, [reportFetchError]);

  const refreshTrends = useCallback(() => {
    fetch('/api/trends')
      .then((r) => r.json())
      .then((data) => { setTrends(data); setTrendsLoading(false); })
      .catch((err) => { setTrendsLoading(false); reportFetchError('refreshTrends')(err); });
  }, [reportFetchError]);

  const tagCategories = useMemo(
    () => Array.from(new Set(tags.map((t) => t.category).filter(Boolean))).sort(),
    [tags]
  );

  const trendCategories = useMemo(
    () => Array.from(new Set(trends.map((t) => t.category).filter(Boolean))).sort(),
    [trends]
  );

  async function saveTags() {
    const res = await fetch('/api/tags/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: tagsText, category: tagsCategory.trim() || null }),
    });
    const data = await res.json();
    showToast(
      res.ok ? `Saved. ${data.inserted} new tag(s), ${data.total} total.` : (data.error || 'Failed to save tags'),
      res.ok ? 'success' : 'error'
    );
    if (res.ok) {
      setTagsText('');
    }
    refreshSetupStatus();
    refreshTags();
  }

  async function deleteTag(id, tagText) {
    requestConfirm(`Delete tag "${tagText}"? This can't be undone.`, async () => {
      const res = await fetch(`/api/tags/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        let message = 'Failed to delete tag';
        try {
          message = (await res.json()).error || message;
        } catch {
          // no JSON body -- keep the generic message
        }
        showToast(message, 'error');
        return;
      }
      showToast(`Deleted tag "${tagText}".`, 'success');
      refreshTags();
    });
  }

  async function deleteTrend(id, term) {
    requestConfirm(`Delete trend "${term}"? This can't be undone.`, async () => {
      const res = await fetch(`/api/trends/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        let message = 'Failed to delete trend';
        try {
          message = (await res.json()).error || message;
        } catch {
          // no JSON body -- keep the generic message
        }
        showToast(message, 'error');
        return;
      }
      showToast(`Deleted trend "${term}".`, 'success');
      refreshTrends();
    });
  }

  async function importTagsCsv(file) {
    if (!file) return;
    try {
      const csv = await file.text();
      const res = await fetch('/api/tags/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      showToast(
        res.ok ? `Imported ${data.inserted} new tag(s) from ${file.name}.` : (data.error || 'Import failed'),
        res.ok ? 'success' : 'error'
      );
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    }
    refreshSetupStatus();
    refreshTags();
  }

  // Step 1: fetch the proposed matches without writing anything (backend dry_run=true),
  // so the user can see exactly what would change before committing to it.
  async function previewBackfillTagCategories() {
    setTagsBackfillPreviewLoading(true);
    try {
      const res = await fetch('/api/tags/backfill-categories?dry_run=true', { method: 'POST' });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`No response from backend (status ${res.status}). Is the backend server running?`);
      }
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setTagsBackfillPreview({ checked: data.checked, updates: data.updates });
    } catch (err) {
      showToast(`Preview failed: ${err.message}`, 'error');
    }
    setTagsBackfillPreviewLoading(false);
  }

  // Step 2: user reviewed the preview and chose to apply it — commits the exact same
  // matches that were just shown (the matching logic is deterministic).
  async function applyBackfillTagCategories() {
    setTagsBackfillRunning(true);
    try {
      const res = await fetch('/api/tags/backfill-categories', { method: 'POST' });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`No response from backend (status ${res.status}). Is the backend server running?`);
      }
      showToast(
        res.ok ? `Backfilled ${data.updated} of ${data.checked} uncategorized tag(s).` : (data.error || 'Backfill failed'),
        res.ok ? 'success' : 'error'
      );
    } catch (err) {
      showToast(`Backfill failed: ${err.message}`, 'error');
    }
    setTagsBackfillRunning(false);
    setTagsBackfillPreview(null);
    refreshTags();
  }

  async function addTrendFromSettings() {
    if (!newTrendTerm.trim()) return;
    await fetch('/api/trends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: newTrendTerm.trim(), category: newTrendCategory.trim() || null }),
    });
    setNewTrendTerm('');
    setNewTrendCategory('');
    refreshTrends();
  }

  return {
    tags,
    tagsText,
    setTagsText,
    tagsCategory,
    setTagsCategory,
    tagsBackfillRunning,
    tagsBackfillPreview,
    setTagsBackfillPreview,
    tagsBackfillPreviewLoading,
    tagsLoading,
    refreshTags,
    tagCategories,
    saveTags,
    deleteTag,
    importTagsCsv,
    previewBackfillTagCategories,
    applyBackfillTagCategories,
    trends,
    newTrendTerm,
    setNewTrendTerm,
    newTrendCategory,
    setNewTrendCategory,
    trendsLoading,
    refreshTrends,
    trendCategories,
    deleteTrend,
    addTrendFromSettings,
  };
}
