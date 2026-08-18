import { useCallback, useEffect, useRef, useState } from 'react';
import { Tag, Upload, Save, Eye, Check, Trash2, Loader2 } from 'lucide-react';
import { api } from '@/hooks/useApi';
import { useAsyncTask } from '@/hooks/useAsyncTask';
import { useConfirm } from '@/contexts/ConfirmContext';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

// Manages the tag library: add tags (manual or CSV), suggest categories via
// AI backfill, and list/delete existing tags. Extracted from SettingsView so
// OnboardingWizard's "starter tags" step can reuse the same CSV import /
// manual-entry flow instead of duplicating it (see plan.md Phase 3).
export default function TagsSection({ onSetupStatusChange }) {
  const [tags, setTags] = useState([]);
  const [newTags, setNewTags] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [tagCategories, setTagCategories] = useState([]);
  const loadTask = useAsyncTask();
  const saveTask = useAsyncTask();
  const csvTask = useAsyncTask();
  const deleteTask = useAsyncTask();
  const backfillPreviewTask = useAsyncTask();
  const backfillApplyTask = useAsyncTask();
  const confirm = useConfirm();
  const csvInputRef = useRef(null);

  const loadTags = useCallback(() => {
    loadTask.run(async () => {
      const data = await api.tags.list();
      setTags(Array.isArray(data) ? data : []);
    });
  }, [loadTask]);

  useEffect(() => {
    loadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Extract unique categories from existing tags for datalist
  useEffect(() => {
    const cats = new Set(tags.map((t) => t.category).filter(Boolean));
    setTagCategories(Array.from(cats).sort());
  }, [tags]);

  const handleSaveTags = useCallback(() => {
    const lines = newTags.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.error('Enter at least one tag (one per line)');
      return;
    }
    saveTask.run(async () => {
      await api.tags.bulk({
        tags: lines,
        category: newCategory.trim() || null,
      });
      toast.success(`${lines.length} tag(s) saved`);
      setNewTags('');
      setNewCategory('');
      loadTags();
      onSetupStatusChange?.();
    });
  }, [newTags, newCategory, saveTask, loadTags, onSetupStatusChange]);

  const handleCsvImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const csv = evt.target.result;
      csvTask.run(async () => {
        const data = await api.tags.csv(csv);
        toast.success(data.message || 'CSV imported');
        loadTags();
        onSetupStatusChange?.();
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [csvTask, loadTags, onSetupStatusChange]);

  const handleDeleteTag = useCallback(
    async (tag) => {
      const ok = await confirm({
        title: 'Delete tag',
        description: `Delete "${tag.tag_text}"? This cannot be undone.`,
      });
      if (!ok) return;
      deleteTask.run(async () => {
        await api.tags.delete(tag.id);
        toast.success('Tag deleted');
        loadTags();
        onSetupStatusChange?.();
      });
    },
    [confirm, deleteTask, loadTags, onSetupStatusChange]
  );

  const handleBackfillPreview = useCallback(() => {
    backfillPreviewTask.run(async () => {
      const data = await api.tags.backfillPreview();
      if (data.preview && data.preview.length > 0) {
        toast.info(`${data.preview.length} category suggestion(s) available`);
      } else {
        toast.info('No category suggestions available');
      }
    });
  }, [backfillPreviewTask]);

  const handleBackfillApply = useCallback(async () => {
    const ok = await confirm({
      title: 'Apply category suggestions',
      description: 'This will update categories on tags based on AI suggestions. Continue?',
      variant: 'default',
    });
    if (!ok) return;
    backfillApplyTask.run(async () => {
      const data = await api.tags.backfillApply();
      toast.success(data.message || 'Categories applied');
      loadTags();
    });
  }, [confirm, backfillApplyTask, loadTags]);

  return (
    <div className="space-y-6">
      {/* Add tags */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Tag className="size-4" />
            Tag Library
          </CardTitle>
          <CardDescription>
            Add tags one per line. Optionally assign a category.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-tags" className="text-xs text-muted-foreground">Tags (one per line)</Label>
            <Textarea
              id="new-tags"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="watercolor art&#10;botanical print&#10;minimalist poster"
              rows={5}
              className="resize-y font-mono text-sm"
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="tag-category" className="text-xs text-muted-foreground">Category (optional)</Label>
              <Input
                id="tag-category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="e.g. style, subject, color"
                list="tag-category-list"
              />
              <datalist id="tag-category-list">
                {tagCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveTags} disabled={saveTask.pending} className="gap-1.5">
                {saveTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save Tags
              </Button>
              <Button variant="outline" onClick={() => csvInputRef.current?.click()} className="gap-1.5">
                <Upload className="size-3.5" />
                CSV Import
              </Button>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.txt"
                className="sr-only"
                onChange={handleCsvImport}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Suggest categories */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Category Suggestions</CardTitle>
          <CardDescription>Use AI to suggest categories for uncategorized tags.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackfillPreview}
              disabled={backfillPreviewTask.pending}
              className="gap-1.5"
            >
              {backfillPreviewTask.pending ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3.5" />}
              Preview Suggestions
            </Button>
            <Button
              size="sm"
              onClick={handleBackfillApply}
              disabled={backfillApplyTask.pending}
              className="gap-1.5"
            >
              {backfillApplyTask.pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3.5" />}
              Apply Suggestions
            </Button>
          </div>
          {backfillPreviewTask.error && <p className="mt-2 text-xs text-destructive">{backfillPreviewTask.error}</p>}
          {backfillApplyTask.error && <p className="mt-2 text-xs text-destructive">{backfillApplyTask.error}</p>}
        </CardContent>
      </Card>

      {/* Current tags list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Current Tags</CardTitle>
            {tags.length > 0 && (
              <Badge variant="secondary" className="text-xs">{tags.length}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadTask.pending ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : loadTask.error ? (
            <p className="text-sm text-destructive">{loadTask.error}</p>
          ) : tags.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No tags in library yet.</p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/30"
                >
                  <span className="flex-1 truncate text-sm text-foreground">{tag.tag_text}</span>
                  {tag.category && (
                    <Badge variant="outline" className="text-[10px] shrink-0">{tag.category}</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDeleteTag(tag)}
                    disabled={deleteTask.pending}
                    aria-label={`Delete ${tag.tag_text}`}
                  >
                    <Trash2 className="size-3 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
