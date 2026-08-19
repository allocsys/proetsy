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
  CheckCircle2,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import ShopConventions from '@/ShopConventions';
import { getModuleLabel } from '@/lib/pipelineModules';
import TagsSection from '@/components/TagsSection.jsx';

// ─── Sub-tab 1: Tags & Trends ────────────────────────────────────────────
// TagsSection lives in '@/components/TagsSection.jsx' so it can be reused by
// OnboardingWizard's starter-tags step without duplicating the CSV
// import / manual-entry logic (see plan.md Phase 3).

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

function TagsAndTrendsTab({ onSetupStatusChange }) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold text-foreground">Tags</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Manage your tag library for listing generation.
        </p>
      </div>
      <TagsSection onSetupStatusChange={onSetupStatusChange} />
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
            const label = getModuleLabel(mod.module);
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
                  <p className="mt-0.5 text-xs text-muted-foreground">{label.description}</p>
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

function ShopAndPipelineTab({ showAdvanced }) {
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

      {/* Pipeline module toggles are advanced -- most shops set these once (or
          never) and UploadView already defaults to whatever's configured here.
          Hidden behind the page-level "Show advanced settings" toggle. */}
      {showAdvanced ? (
        <>
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
        </>
      ) : (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">
              Pipeline module toggles are hidden. Turn on{' '}
              <span className="font-medium text-foreground">Show advanced settings</span> above to configure them.
            </p>
          </CardContent>
        </Card>
      )}

      <Separator />

      <BackupRestoreSection />
    </div>
  );
}

// ─── Sub-tab 3: API Keys ─────────────────────────────────────────────────

function ApiKeysTab({ onSetupStatusChange }) {
  const [keys, setKeys] = useState([]);
  const [newKeyValue, setNewKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
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
    if (!newKeyValue.trim()) {
      toast.error('Enter your Gemini API key');
      return;
    }
    addTask.run(async () => {
      await api.apiKeys.add({
        provider: 'gemini',
        key_value: newKeyValue.trim(),
        label: 'Gemini',
      });
      toast.success('Gemini API key connected');
      setNewKeyValue('');
      setIsModalOpen(false);
      loadKeys();
      onSetupStatusChange?.();
    });
  }, [newKeyValue, addTask, loadKeys, onSetupStatusChange]);

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
        onSetupStatusChange?.();
      });
    },
    [confirm, deleteTask, loadKeys, onSetupStatusChange]
  );

  function maskKey(key) {
    if (!key) return '••••••••';
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  }

  const geminiKey = keys.find((k) => k.provider === 'gemini');

  return (
    <div className="space-y-6">
      {/* Connect Gemini card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Key className="size-4" />
            Gemini API Key
          </CardTitle>
          <CardDescription>
            Proetsy uses Gemini to analyze artwork and generate listings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {geminiKey ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3 bg-muted/20">
              <div className="flex items-center gap-3 min-w-0">
                <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">Gemini</span>
                    <Badge variant="default" className="text-[10px]">Connected</Badge>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground truncate mt-0.5">
                    {maskKey(geminiKey.maskedKey)} {geminiKey.label ? `(${geminiKey.label})` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => setIsModalOpen(true)}>
                  Change
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteKey(geminiKey)}
                  disabled={deleteTask.pending}
                  className="text-destructive hover:text-destructive"
                >
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">No Gemini API key connected yet.</p>
              <Button onClick={() => setIsModalOpen(true)} className="gap-1.5 shrink-0">
                <Key className="size-3.5" />
                Connect Gemini
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connect modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Gemini API Key</DialogTitle>
            <DialogDescription>
              Enter your Gemini API key to enable listing generation and artwork analysis.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="gemini-key-input" className="text-xs text-muted-foreground">API Key</Label>
              <div className="relative">
                <Input
                  id="gemini-key-input"
                  type={showKey ? 'text' : 'password'}
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                  placeholder="AIza…"
                  className="pr-8"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
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
            {addTask.error && <p className="text-xs text-destructive">{addTask.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddKey} disabled={addTask.pending} className="gap-1.5">
              {addTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Save Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              No API keys configured. Connect Gemini above to get started.
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
                      {maskKey(key.maskedKey)}
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
                <TableHead>Key</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reset In</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {limits.map((limit, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">
                    {limit.keyIndex !== undefined ? `Key ${limit.keyIndex}` : '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{limit.model || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={limit.currentlyLimited ? 'destructive' : 'default'}
                        className="text-[10px]"
                      >
                        {limit.currentlyLimited ? 'Limited' : 'OK'}
                      </Badge>
                      {limit.consecutiveHits > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {limit.consecutiveHits} hit{limit.consecutiveHits === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {limit.currentlyLimited ? formatResetTime(limit.limitedUntil) : '—'}
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

// Sane default approval threshold -- most shops never need to tune this until
// they've accumulated enough taste-filter ratings for it to matter, so ship a
// reasonable starting point (0.7) rather than a neutral coin-flip (0.5).
const DEFAULT_TASTE_THRESHOLD = 0.7;

function TasteFilterAutoSection() {
  const [settings, setSettings] = useState({});
  const [threshold, setThreshold] = useState(DEFAULT_TASTE_THRESHOLD);
  const loadTask = useAsyncTask();
  const saveTask = useAsyncTask();

  useEffect(() => {
    loadTask.run(async () => {
      const data = await api.settings.get();
      setSettings(data || {});
      if (data?.taste_filter_auto_threshold !== undefined) {
        const parsed = Number(data.taste_filter_auto_threshold);
        setThreshold(Number.isFinite(parsed) ? parsed : DEFAULT_TASTE_THRESHOLD);
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

function AutomationDiagnosticsTab({ showAdvanced }) {
  // Watch Folder, Rate Limits, and Taste Filter Auto Mode are all advanced /
  // diagnostic settings that most users never touch. The whole tab is gated
  // behind the page-level "Show advanced settings" toggle rather than showing
  // three low-priority cards by default.
  if (!showAdvanced) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <Bot className="size-7 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">Advanced automation settings are hidden</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Watch folders, rate limit diagnostics, and taste-filter auto-approval live here.
            Turn on <span className="font-medium text-foreground">Show advanced settings</span> above to configure them.
          </p>
        </CardContent>
      </Card>
    );
  }

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

export default function SettingsView({ onBack, onSetupStatusChange }) {
  // Persisted like App.jsx's sidebar-collapsed flag -- a one-time choice that
  // shouldn't reset every time Settings is opened. Most shops never need
  // Pipeline Modules or the Automation tab's contents (watch folder, rate
  // limits, taste-filter threshold), so those stay hidden until explicitly
  // opted into here.
  const [showAdvanced, setShowAdvanced] = useState(() => {
    try {
      return localStorage.getItem('proetsy-settings-advanced') === '1';
    } catch {
      return false;
    }
  });

  const handleToggleAdvanced = useCallback((checked) => {
    setShowAdvanced(checked);
    try {
      localStorage.setItem('proetsy-settings-advanced', checked ? '1' : '0');
    } catch {
      // localStorage unavailable (e.g. private browsing) -- toggle still works
      // for this session, it just won't persist across reloads.
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Page header with back button */}
      <div className="flex items-center justify-between gap-3">
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
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span className="hidden sm:inline">Show advanced settings</span>
          <span className="sm:hidden">Advanced</span>
          <Switch
            checked={showAdvanced}
            onCheckedChange={handleToggleAdvanced}
            aria-label="Show advanced settings"
          />
        </label>
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
          <TagsAndTrendsTab onSetupStatusChange={onSetupStatusChange} />
        </TabsContent>

        <TabsContent value="shop-pipeline" className="mt-6">
          <ShopAndPipelineTab showAdvanced={showAdvanced} />
        </TabsContent>

        <TabsContent value="api-keys" className="mt-6">
          <ApiKeysTab onSetupStatusChange={onSetupStatusChange} />
        </TabsContent>

        <TabsContent value="automation" className="mt-6">
          <AutomationDiagnosticsTab showAdvanced={showAdvanced} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
