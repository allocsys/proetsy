import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  Download,
  Upload,
  Tag,
  TrendingUp,
  Store,
  Key,
  Bot,
  Check,
  X,
  Eye,
  EyeOff,
  FolderOpen,
  RefreshCw,
  Gauge,
  Wand2,
  Save,
} from 'lucide-react';
import { api } from '@/hooks/useApi';
import { useAsyncTask } from '@/hooks/useAsyncTask';
import { useConfirm } from '@/contexts/ConfirmContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ShopConventions from '@/ShopConventions';

// ─── Sub-tab 1: Tags & Trends ────────────────────────────────────────────

function TagsSection() {
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
    });
  }, [newTags, newCategory, saveTask, loadTags]);

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
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [csvTask, loadTags]);

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
      });
    },
    [confirm, deleteTask, loadTags]
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

function TrendsSection() {
  const [trends, setTrends] = useState([]);
  const [newTerm, setNewTerm] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const loadTask = useAsyncTask();
  const addTask = useAsyncTask();
  const deleteTask = useAsyncTask();
  const confirm = useConfirm();

  const loadTrends = useCallback(() => {
    loadTask.run(async () => {
      const data = await api.trends.list();
      setTrends(Array.isArray(data) ? data : []);
    });
  }, [loadTask]);

  useEffect(() => {
    loadTrends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddTrend = useCallback(() => {
    if (!newTerm.trim()) {
      toast.error('Enter a trend term');
      return;
    }
    addTask.run(async () => {
      await api.trends.add({ term: newTerm.trim(), category: newCategory.trim() || null });
      toast.success('Trend added');
      setNewTerm('');
      setNewCategory('');
      loadTrends();
    });
  }, [newTerm, newCategory, addTask, loadTrends]);

  const handleDeleteTrend = useCallback(
    async (trend) => {
      const ok = await confirm({
        title: 'Delete trend',
        description: `Delete "${trend.term}"?`,
      });
      if (!ok) return;
      deleteTask.run(async () => {
        await api.trends.delete(trend.id);
        toast.success('Trend deleted');
        loadTrends();
      });
    },
    [confirm, deleteTask, loadTrends]
  );

  return (
    <div className="space-y-4">
      {/* Add trend form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <TrendingUp className="size-4" />
            Add Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="trend-term" className="text-xs text-muted-foreground">Term</Label>
              <Input
                id="trend-term"
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                placeholder="e.g. cottagecore aesthetics"
                onKeyDown={(e) => e.key === 'Enter' && handleAddTrend()}
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="trend-category" className="text-xs text-muted-foreground">Category</Label>
              <Input
                id="trend-category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="e.g. style, theme"
                onKeyDown={(e) => e.key === 'Enter' && handleAddTrend()}
              />
            </div>
            <Button onClick={handleAddTrend} disabled={addTask.pending} className="gap-1.5 shrink-0">
              {addTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Add
            </Button>
          </div>
          {addTask.error && <p className="mt-2 text-xs text-destructive">{addTask.error}</p>}
        </CardContent>
      </Card>

      {/* Trends list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Current Trends</CardTitle>
            {trends.length > 0 && (
              <Badge variant="secondary" className="text-xs">{trends.length}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadTask.pending ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : loadTask.error ? (
            <p className="text-sm text-destructive">{loadTask.error}</p>
          ) : trends.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No trends tracked yet.</p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {trends.map((trend) => (
                <div
                  key={trend.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/30"
                >
                  <span className="flex-1 truncate text-sm text-foreground">{trend.term}</span>
                  {trend.category && (
                    <Badge variant="outline" className="text-[10px] shrink-0">{trend.category}</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDeleteTrend(trend)}
                    disabled={deleteTask.pending}
                    aria-label={`Delete ${trend.term}`}
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

function TagsAndTrendsTab() {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold text-foreground">Tags</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Manage your tag library for listing generation.
        </p>
      </div>
      <TagsSection />
      <Separator />
      <div>
        <h3 className="text-base font-semibold text-foreground">Trends</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Track trending terms to incorporate into listings.
        </p>
      </div>
      <TrendsSection />
    </div>
  );
}

// ─── Sub-tab 2: Shop & Pipeline ──────────────────────────────────────────

function ShopDefaultsSection({ settings, onSettingsChange }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Shop Defaults</CardTitle>
        <CardDescription>
          Default values applied to all new listings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="default-price" className="text-xs text-muted-foreground">Default Price</Label>
          <div className="relative max-w-xs">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              id="default-price"
              type="number"
              step="0.01"
              min="0"
              className="pl-6"
              placeholder="0.00"
              value={settings.defaultPrice ?? ''}
              onChange={(e) => onSettingsChange('defaultPrice', e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delivery-text" className="text-xs text-muted-foreground">Delivery Detail Text</Label>
          <Textarea
            id="delivery-text"
            value={settings.deliveryText ?? ''}
            onChange={(e) => onSettingsChange('deliveryText', e.target.value)}
            placeholder="e.g. Made to order. Ships within 3-5 business days."
            rows={3}
            className="max-w-lg resize-y"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineModulesSection({ pipelineConfig, onToggleModule }) {
  const MODULE_LABELS = {
    'image-analyzer': { name: 'Image Analyzer', desc: 'Analyzes artwork for colors, style, and composition' },
    'listing-generator': { name: 'Listing Generator', desc: 'Creates Etsy-optimized titles, descriptions, and tags' },
    'mockup-generator': { name: 'Mockup Generator', desc: 'Generates product mockups using PSD templates' },
    'taste-filter': { name: 'Taste Filter', desc: 'Ranks results against your shop style profile' },
  };

  if (!pipelineConfig || !pipelineConfig.pipeline) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading pipeline config…
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Pipeline Modules</CardTitle>
        <CardDescription>
          Toggle modules on or off. These defaults apply to new uploads.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {pipelineConfig.pipeline.map((mod) => {
            const label = MODULE_LABELS[mod.module] || { name: mod.module, desc: 'Pipeline module' };
            const isRequired = mod.required;
            return (
              <div
                key={mod.module}
                className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{label.name}</span>
                    {isRequired && (
                      <Badge variant="outline" className="text-[10px]">Required</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{label.desc}</p>
                </div>
                <Switch
                  checked={mod.enabled}
                  onCheckedChange={(checked) => onToggleModule(mod.module, checked)}
                  disabled={isRequired}
                  aria-label={`Toggle ${label.name}`}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function BackupRestoreSection() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  const handleDownload = useCallback(async () => {
    setExporting(true);
    try {
      const data = await api.config.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `proetsy-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup downloaded');
    } catch (err) {
      toast.error(err.message || 'Backup failed');
    } finally {
      setExporting(false);
    }
  }, []);

  const handleRestore = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bundle = JSON.parse(evt.target.result);
        await api.config.import(bundle);
        toast.success('Backup restored. Reload the page to see changes.');
      } catch (err) {
        toast.error(err.message || 'Restore failed');
      } finally {
        setImporting(false);
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Backup & Restore</CardTitle>
        <CardDescription>
          Export all settings as JSON, or restore from a previous backup.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={exporting}
            className="gap-1.5"
          >
            {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            Download Backup
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="gap-1.5"
          >
            {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Restore from File
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="sr-only"
            onChange={handleRestore}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ShopAndPipelineTab() {
  const [settings, setSettings] = useState({});
  const [pipelineConfig, setPipelineConfig] = useState(null);
  const loadTask = useAsyncTask();
  const saveTask = useAsyncTask();

  useEffect(() => {
    loadTask.run(async () => {
      const [settingsData, pipelineData] = await Promise.all([
        api.settings.get(),
        api.pipelineConfig(),
      ]);
      setSettings(settingsData || {});
      setPipelineConfig(pipelineData || null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSettingsChange = useCallback((key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleToggleModule = useCallback((moduleName, checked) => {
    setPipelineConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        pipeline: prev.pipeline.map((m) =>
          m.module === moduleName ? { ...m, enabled: checked } : m
        ),
      };
    });
  }, []);

  const handleSaveDefaults = useCallback(() => {
    saveTask.run(async () => {
      const updates = {};
      if (settings.defaultPrice !== undefined) {
        updates.default_price = parseFloat(settings.defaultPrice) || 0;
      }
      if (settings.deliveryText !== undefined) {
        updates.delivery_text = settings.deliveryText;
      }
      await api.settings.patch(updates);
      toast.success('Shop defaults saved');
    });
  }, [settings, saveTask]);

  const handleSavePipeline = useCallback(() => {
    if (!pipelineConfig?.pipeline) return;
    saveTask.run(async () => {
      const overrides = pipelineConfig.pipeline.map((m) => ({
        module: m.module,
        enabled: m.enabled,
      }));
      await api.settings.patch({ pipeline_defaults: overrides });
      toast.success('Pipeline defaults saved');
    });
  }, [pipelineConfig, saveTask]);

  return (
    <div className="space-y-6">
      {loadTask.error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{loadTask.error}</p>
          </CardContent>
        </Card>
      )}

      <ShopDefaultsSection
        settings={settings}
        onSettingsChange={handleSettingsChange}
        saveTask={saveTask}
      />
      <div className="flex gap-2">
        <Button onClick={handleSaveDefaults} disabled={saveTask.pending} size="sm" className="gap-1.5">
          {saveTask.pending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3.5" />}
          Save Defaults
        </Button>
        {saveTask.error && <p className="text-xs text-destructive">{saveTask.error}</p>}
      </div>

      <Separator />

      <div>
        <h3 className="text-base font-semibold text-foreground">Shop Conventions</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Configure listing rules and Midjourney settings.
        </p>
      </div>
      <ShopConventions />

      <Separator />

      <PipelineModulesSection
        pipelineConfig={pipelineConfig}
        onToggleModule={handleToggleModule}
        saveTask={saveTask}
      />
      <div className="flex gap-2">
        <Button onClick={handleSavePipeline} disabled={saveTask.pending} size="sm" className="gap-1.5">
          {saveTask.pending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3.5" />}
          Save Pipeline
        </Button>
      </div>

      <Separator />

      <BackupRestoreSection />
    </div>
  );
}

// ─── Sub-tab 3: API Keys ─────────────────────────────────────────────────

function ApiKeysTab() {
  const [keys, setKeys] = useState([]);
  const [newProvider, setNewProvider] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const loadTask = useAsyncTask();
  const addTask = useAsyncTask();
  const toggleTask = useAsyncTask();
  const deleteTask = useAsyncTask();
  const confirm = useConfirm();

  const loadKeys = useCallback(() => {
    loadTask.run(async () => {
      const data = await api.apiKeys.list();
      setKeys(Array.isArray(data) ? data : []);
    });
  }, [loadTask]);

  useEffect(() => {
    loadKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddKey = useCallback(() => {
    if (!newProvider || !newKeyValue.trim()) {
      toast.error('Provider and key value are required');
      return;
    }
    addTask.run(async () => {
      await api.apiKeys.add({
        provider: newProvider,
        key_value: newKeyValue.trim(),
        label: newLabel.trim() || null,
      });
      toast.success('API key added');
      setNewProvider('');
      setNewKeyValue('');
      setNewLabel('');
      loadKeys();
    });
  }, [newProvider, newKeyValue, newLabel, addTask, loadKeys]);

  const handleToggleKey = useCallback((id, enabled) => {
    toggleTask.run(async () => {
      await api.apiKeys.toggle(id, enabled);
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, enabled } : k))
      );
      toast.success(`Key ${enabled ? 'enabled' : 'disabled'}`);
    });
  }, [toggleTask]);

  const handleDeleteKey = useCallback(
    async (key) => {
      const ok = await confirm({
        title: 'Delete API key',
        description: `Delete the ${key.provider} key "${key.label || 'unnamed'}"? This cannot be undone.`,
      });
      if (!ok) return;
      deleteTask.run(async () => {
        await api.apiKeys.delete(key.id);
        toast.success('API key deleted');
        loadKeys();
      });
    },
    [confirm, deleteTask, loadKeys]
  );

  function maskKey(key) {
    if (!key) return '••••••••';
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  }

  return (
    <div className="space-y-6">
      {/* Add key form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Key className="size-4" />
            Add API Key
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full space-y-1.5 sm:w-40">
              <Label className="text-xs text-muted-foreground">Provider</Label>
              <Select value={newProvider} onValueChange={setNewProvider}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini">Gemini</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="midjourney">Midjourney</SelectItem>
                  <SelectItem value="replicate">Replicate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs text-muted-foreground">Key Value</Label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                  placeholder="sk-… or API key"
                  className="pr-8"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey(!showKey)}
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            </div>
            <div className="w-full space-y-1.5 sm:w-48">
              <Label className="text-xs text-muted-foreground">Label</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Primary Gemini Key"
              />
            </div>
            <Button onClick={handleAddKey} disabled={addTask.pending} className="gap-1.5 shrink-0">
              {addTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Add Key
            </Button>
          </div>
          {addTask.error && <p className="mt-2 text-xs text-destructive">{addTask.error}</p>}
        </CardContent>
      </Card>

      {/* Keys table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">API Keys</CardTitle>
            {keys.length > 0 && (
              <Badge variant="secondary" className="text-xs">{keys.length}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadTask.pending ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : loadTask.error ? (
            <p className="text-sm text-destructive">{loadTask.error}</p>
          ) : keys.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No API keys configured. Add one above to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.provider}</TableCell>
                    <TableCell>{key.label || '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {maskKey(key.key_masked || key.key)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={key.enabled ? 'default' : 'outline'}
                        className="text-[10px]"
                      >
                        {key.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleToggleKey(key.id, !key.enabled)}
                          disabled={toggleTask.pending}
                          aria-label={key.enabled ? 'Disable key' : 'Enable key'}
                        >
                          {key.enabled ? (
                            <X className="size-3 text-muted-foreground" />
                          ) : (
                            <Check className="size-3 text-emerald-500" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleDeleteKey(key)}
                          disabled={deleteTask.pending}
                          aria-label={`Delete ${key.label || 'key'}`}
                        >
                          <Trash2 className="size-3 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sub-tab 4: Automation & Diagnostics ─────────────────────────────────

function WatchFolderSection() {
  const [settings, setSettings] = useState({});
  const [watchStatus, setWatchStatus] = useState(null);
  const loadTask = useAsyncTask();
  const saveTask = useAsyncTask();
  const statusTask = useAsyncTask();

  const loadSettings = useCallback(() => {
    loadTask.run(async () => {
      const data = await api.settings.get();
      setSettings(data || {});
    });
  }, [loadTask]);

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefreshStatus = useCallback(() => {
    statusTask.run(async () => {
      const data = await api.tasteFilter.watchStatus();
      setWatchStatus(data);
    });
  }, [statusTask]);

  const handleToggleWatch = useCallback((checked) => {
    saveTask.run(async () => {
      await api.settings.patch({ taste_filter_watch_enabled: checked });
      setSettings((prev) => ({ ...prev, taste_filter_watch_enabled: String(checked) }));
      toast.success(`Watch folder ${checked ? 'enabled' : 'disabled'}`);
    });
  }, [saveTask]);

  const handleSaveConfig = useCallback(() => {
    saveTask.run(async () => {
      await api.settings.patch({
        taste_filter_watch_folder: settings.taste_filter_watch_folder || null,
        taste_filter_watch_category: settings.taste_filter_watch_category || null,
      });
      toast.success('Watch folder settings saved');
    });
  }, [settings.taste_filter_watch_folder, settings.taste_filter_watch_category, saveTask]);

  const handleUseDefault = useCallback(() => {
    setSettings((prev) => ({ ...prev, taste_filter_watch_folder: '/watch' }));
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FolderOpen className="size-4" />
              Watch Folder
            </CardTitle>
            <Switch
              checked={settings.taste_filter_watch_enabled === 'true'}
              onCheckedChange={handleToggleWatch}
              disabled={saveTask.pending}
              aria-label="Enable watch folder"
            />
          </div>
          <CardDescription>
            Automatically pick up new artwork files from a folder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="watch-path" className="text-xs text-muted-foreground">Folder Path</Label>
              <Input
                id="watch-path"
                value={settings.taste_filter_watch_folder || ''}
                onChange={(e) => setSettings((prev) => ({ ...prev, taste_filter_watch_folder: e.target.value }))}
                placeholder="/path/to/watch/folder"
                className="font-mono text-sm"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleUseDefault} className="shrink-0">
              Use Default
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="watch-category" className="text-xs text-muted-foreground">Category (optional)</Label>
              <Input
                id="watch-category"
                value={settings.taste_filter_watch_category || ''}
                onChange={(e) => setSettings((prev) => ({ ...prev, taste_filter_watch_category: e.target.value }))}
                placeholder="e.g. botanical"
              />
            </div>
            <Button size="sm" onClick={handleSaveConfig} disabled={saveTask.pending} className="gap-1.5 shrink-0">
              {saveTask.pending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3.5" />}
              Save
            </Button>
          </div>
          {saveTask.error && <p className="text-xs text-destructive">{saveTask.error}</p>}
        </CardContent>
      </Card>

      {/* Watch status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Watch Status</CardTitle>
            <Button variant="ghost" size="icon-xs" onClick={handleRefreshStatus}>
              <RefreshCw className={cn('size-3.5 text-muted-foreground', statusTask.pending && 'animate-spin')} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {statusTask.pending && !watchStatus ? (
            <Skeleton className="h-16 w-full" />
          ) : watchStatus ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={watchStatus.active ? 'default' : 'outline'} className="text-[10px]">
                  {watchStatus.active ? 'Watching' : 'Idle'}
                </Badge>
              </div>
              {watchStatus.folder && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Folder</span>
                  <span className="font-mono text-xs text-foreground">{watchStatus.folder}</span>
                </div>
              )}
              {watchStatus.category && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Category</span>
                  <span className="text-xs text-foreground">{watchStatus.category}</span>
                </div>
              )}
              {watchStatus.pendingCount !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Pending Candidates</span>
                  <span className="text-foreground">{watchStatus.pendingCount}</span>
                </div>
              )}
              {watchStatus.lastError && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Last Error</span>
                  <span className="text-right text-xs text-destructive">{watchStatus.lastError}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Click refresh to check watch folder status.
            </p>
          )}
          {statusTask.error && <p className="mt-2 text-xs text-destructive">{statusTask.error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function RateLimitsSection() {
  const [limits, setLimits] = useState([]);
  const loadTask = useAsyncTask();

  const loadLimits = useCallback(() => {
    loadTask.run(async () => {
      const data = await api.rateLimits();
      setLimits(Array.isArray(data) ? data : data.limits || []);
    });
  }, [loadTask]);

  useEffect(() => {
    loadLimits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function formatResetTime(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = d - now;
    if (diffMs <= 0) return 'Resetting…';
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    if (diffMin < 60) return `${diffMin}m`;
    return `${diffHr}h ${diffMin % 60}m`;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Gauge className="size-4" />
            Rate Limits
          </CardTitle>
          <Button variant="ghost" size="icon-xs" onClick={loadLimits}>
            <RefreshCw className={cn('size-3.5 text-muted-foreground', loadTask.pending && 'animate-spin')} />
          </Button>
        </div>
        <CardDescription>
          Current API rate limit status across providers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loadTask.pending && limits.length === 0 ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : loadTask.error ? (
          <p className="text-sm text-destructive">{loadTask.error}</p>
        ) : limits.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No rate limit data available.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Requests Remaining</TableHead>
                <TableHead>Reset In</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {limits.map((limit, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{limit.provider || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{limit.model || '—'}</TableCell>
                  <TableCell>
                    <span className={cn(
                      'tabular-nums',
                      (limit.remaining ?? 0) < 20 && 'font-medium text-amber-400',
                      (limit.remaining ?? 0) < 5 && 'text-destructive'
                    )}>
                      {limit.remaining ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatResetTime(limit.reset_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TasteFilterAutoSection() {
  const [settings, setSettings] = useState({});
  const [threshold, setThreshold] = useState(0.5);
  const loadTask = useAsyncTask();
  const saveTask = useAsyncTask();

  useEffect(() => {
    loadTask.run(async () => {
      const data = await api.settings.get();
      setSettings(data || {});
      if (data?.taste_filter_auto_threshold !== undefined) {
        const parsed = Number(data.taste_filter_auto_threshold);
        setThreshold(Number.isFinite(parsed) ? parsed : 0.5);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleAuto = useCallback((checked) => {
    saveTask.run(async () => {
      await api.settings.patch({ taste_filter_auto_enabled: checked });
      setSettings((prev) => ({ ...prev, taste_filter_auto_enabled: String(checked) }));
      toast.success(`Taste filter auto mode ${checked ? 'enabled' : 'disabled'}`);
    });
  }, [saveTask]);

  const handleSaveThreshold = useCallback(() => {
    saveTask.run(async () => {
      await api.settings.patch({ taste_filter_auto_threshold: threshold });
      toast.success('Threshold saved');
    });
  }, [threshold, saveTask]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Wand2 className="size-4" />
            Taste Filter Auto Mode
          </CardTitle>
          <Switch
            checked={settings.taste_filter_auto_enabled === 'true'}
            onCheckedChange={handleToggleAuto}
            disabled={saveTask.pending}
            aria-label="Enable taste filter auto mode"
          />
        </div>
        <CardDescription>
          Automatically approve or reject mockups based on taste filter score.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="taste-threshold" className="text-xs text-muted-foreground">
              Approval Threshold
            </Label>
            <span className="text-xs tabular-nums text-muted-foreground">{threshold.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="taste-threshold"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            />
            <Input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={threshold}
              onChange={(e) => setThreshold(Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)))}
              className="w-20 text-center font-mono text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Mockups scoring above this threshold will be auto-approved.
          </p>
        </div>
        <Button size="sm" onClick={handleSaveThreshold} disabled={saveTask.pending} className="gap-1.5">
          {saveTask.pending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3.5" />}
          Save Threshold
        </Button>
        {saveTask.error && <p className="text-xs text-destructive">{saveTask.error}</p>}
      </CardContent>
    </Card>
  );
}

function AutomationDiagnosticsTab() {
  return (
    <div className="space-y-6">
      <WatchFolderSection />
      <Separator />
      <RateLimitsSection />
      <Separator />
      <TasteFilterAutoSection />
    </div>
  );
}

// ─── Main SettingsView ───────────────────────────────────────────────────

export default function SettingsView({ onBack }) {
  return (
    <div className="space-y-6">
      {/* Page header with back button */}
      <div className="flex items-center gap-3">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Go back"
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure your shop, pipeline, API keys, and automation.
          </p>
        </div>
      </div>

      {/* Sub-tabs */}
      <Tabs defaultValue="tags-trends">
        <TabsList>
          <TabsTrigger value="tags-trends" className="gap-1.5">
            <Tag className="size-3.5" />
            <span className="hidden sm:inline">Tags</span> & <span className="hidden sm:inline">Trends</span>
            <span className="sm:hidden">Tags</span>
          </TabsTrigger>
          <TabsTrigger value="shop-pipeline" className="gap-1.5">
            <Store className="size-3.5" />
            <span className="hidden sm:inline">Shop & Pipeline</span>
            <span className="sm:hidden">Shop</span>
          </TabsTrigger>
          <TabsTrigger value="api-keys" className="gap-1.5">
            <Key className="size-3.5" />
            <span className="hidden sm:inline">API Keys</span>
            <span className="sm:hidden">Keys</span>
          </TabsTrigger>
          <TabsTrigger value="automation" className="gap-1.5">
            <Bot className="size-3.5" />
            <span className="hidden sm:inline">Automation</span>
            <span className="sm:hidden">Auto</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tags-trends" className="mt-6">
          <TagsAndTrendsTab />
        </TabsContent>

        <TabsContent value="shop-pipeline" className="mt-6">
          <ShopAndPipelineTab />
        </TabsContent>

        <TabsContent value="api-keys" className="mt-6">
          <ApiKeysTab />
        </TabsContent>

        <TabsContent value="automation" className="mt-6">
          <AutomationDiagnosticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
