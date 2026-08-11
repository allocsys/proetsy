import { useEffect, useMemo, useState } from 'react';
import { FolderSearch, FolderOpen, Plus, Trash2, Save, ImageOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/hooks/useApi';
import { useAsyncTask } from '@/hooks/useAsyncTask';
import { useConfirm } from '@/contexts/ConfirmContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function slugify(filename) {
  const base = filename.replace(/\.[^/.]+$/, '');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function FormField({ label, value, onChange, placeholder, list, className }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        list={list}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8"
      />
    </div>
  );
}

function TemplatePreview({ url, alt }) {
  if (!url) {
    return (
      <div className="flex items-center justify-center aspect-[4/3] rounded-lg bg-muted">
        <ImageOff className="size-8 text-muted-foreground/40" />
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg bg-black">
      <img
        src={url}
        alt={alt}
        className="w-full aspect-[4/3] object-contain"
      />
    </div>
  );
}

function ConfiguredTemplateCard({ row, categoryOptions, onSave, onRemove }) {
  const [edits, setEdits] = useState({});
  const isPsd = row.mockup_template_path?.toLowerCase().endsWith('.psd');

  function getValue(field) {
    if (field in edits) return edits[field];
    if (field === 'dpi') return row.dpi ?? '';
    return row[field] ?? '';
  }

  function updateField(field, value) {
    setEdits((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <Card className="gap-0">
      <TemplatePreview url={row.preview_url} alt={row.size_key} />
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-sm font-medium truncate">{row.size_key}</p>
        <div className="grid grid-cols-2 gap-2">
          <FormField
            label="Dimensions"
            value={getValue('dimensions')}
            onChange={(v) => updateField('dimensions', v)}
            placeholder="8x10"
          />
          <FormField
            label="DPI"
            value={getValue('dpi')}
            onChange={(v) => updateField('dpi', v)}
            placeholder="300"
          />
          <FormField
            label="Orientation"
            value={getValue('orientation')}
            onChange={(v) => updateField('orientation', v)}
            placeholder="portrait"
          />
          <FormField
            label="Category"
            value={getValue('category')}
            onChange={(v) => updateField('category', v)}
            placeholder="e.g. bedroom"
            list="mockup-category-options"
          />
        </div>
        {isPsd && (
          <FormField
            label="Placement Layer"
            value={getValue('placement_layer')}
            onChange={(v) => updateField('placement_layer', v)}
            placeholder="e.g. artwork"
          />
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => onSave(row, getValue('dimensions'), getValue('dpi'), getValue('orientation'), getValue('category'), getValue('placement_layer'))}
          >
            <Save className="size-3.5" />
            Save
          </Button>
          <Button variant="destructive" size="sm" onClick={() => onRemove(row.size_key)}>
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MockupTemplates() {
  const [folder, setFolder] = useState('');
  const [scanFiles, setScanFiles] = useState([]);
  const [selected, setSelected] = useState({});
  const [bulkDimensions, setBulkDimensions] = useState('');
  const [bulkDpi, setBulkDpi] = useState('');
  const [bulkOrientation, setBulkOrientation] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [perFileSizeKey, setPerFileSizeKey] = useState({});
  const [perFilePlacementLayer, setPerFilePlacementLayer] = useState({});
  const [configured, setConfigured] = useState([]);
  const [configuredKey, setConfiguredKey] = useState(0);

  const listTask = useAsyncTask();
  const scanTask = useAsyncTask();
  const assignTask = useAsyncTask();
  const confirm = useConfirm();

  const hasFolderPicker = typeof window !== 'undefined' && !!window.mockupTemplatesAPI;

  function refreshConfigured() {
    api.mockups.templates
      .list()
      .then(setConfigured)
      .catch(() => {});
  }

  useEffect(() => {
    listTask.run(async () => {
      const [settings, cats] = await Promise.all([
        api.settings.get(),
        api.mockups.templates.categories(),
      ]);
      setFolder(settings.mockup_templates_dir || '');
      const defaults = ['bedroom', 'hallway', 'mug', 'nature', 'green space', 'white space'];
      const merged = Array.from(new Set([...defaults, ...cats])).sort();
      setCategoryOptions(merged);
    });
    refreshConfigured();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveFolder(value) {
    try {
      await api.settings.patch({ mockup_templates_dir: value });
      toast.success('Folder path saved');
    } catch {
      toast.error('Failed to save folder path');
    }
  }

  async function handleBrowse() {
    if (!hasFolderPicker) return;
    const picked = await window.mockupTemplatesAPI.selectFolder();
    if (!picked) return;
    setFolder(picked);
    await saveFolder(picked);
  }

  function handleScan() {
    if (!folder.trim()) {
      toast.error('Enter a folder path first');
      return;
    }
    scanTask.run(async () => {
      const data = await api.mockups.templates.scan(folder.trim());
      setScanFiles(data.files || []);
      setSelected({});
      const defaults = {};
      (data.files || []).forEach((f) => {
        defaults[f.path] = slugify(f.filename);
      });
      setPerFileSizeKey(defaults);
      setPerFilePlacementLayer({});
      toast.success(`Found ${(data.files || []).length} file${(data.files || []).length === 1 ? '' : 's'}`);
    });
  }

  function toggleSelected(path) {
    setSelected((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  const selectedFiles = useMemo(
    () => scanFiles.filter((f) => selected[f.path]),
    [scanFiles, selected]
  );

  function handleBulkAssign() {
    if (!selectedFiles.length) return;
    assignTask.run(async () => {
      let succeeded = 0;
      const errors = [];
      for (const file of selectedFiles) {
        const sizeKey = (perFileSizeKey[file.path] || '').trim();
        if (!sizeKey) {
          errors.push(`${file.filename}: size key is required`);
          continue;
        }
        try {
          await api.mockups.templates.add({
            size_key: sizeKey,
            dimensions: bulkDimensions || null,
            dpi: bulkDpi ? Number(bulkDpi) : null,
            orientation: bulkOrientation || null,
            mockup_template: file.filename,
            placement_layer: file.kind === 'psd' ? perFilePlacementLayer[file.path] || null : null,
            category: bulkCategory || null,
          });
          succeeded += 1;
        } catch (err) {
          errors.push(`${file.filename}: ${err.message}`);
        }
      }

      if (errors.length) {
        toast.error(`Assigned ${succeeded} of ${selectedFiles.length}. Errors: ${errors.join('; ')}`);
      } else {
        toast.success(`Assigned ${succeeded} file${succeeded === 1 ? '' : 's'}`);
      }
      setSelected({});
      refreshConfigured();
      handleScan();
    });
  }

  async function handleConfiguredSave(row, dimensions, dpi, orientation, category, placementLayer) {
    try {
      await api.mockups.templates.add({
        size_key: row.size_key,
        dimensions: dimensions || null,
        dpi: dpi ? Number(dpi) : null,
        orientation: orientation || null,
        mockup_template: row.mockup_template_path,
        placement_layer: placementLayer || null,
        category: category || null,
      });
      toast.success(`Saved ${row.size_key}`);
      refreshConfigured();
      setConfiguredKey((k) => k + 1);
    } catch (err) {
      toast.error(`Save failed: ${err.message}`);
    }
  }

  async function handleConfiguredRemove(sizeKey) {
    const ok = await confirm({
      title: 'Remove template',
      description: `Remove the "${sizeKey}" template? This cannot be undone.`,
      confirmText: 'Remove',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await api.mockups.templates.delete(sizeKey);
      toast.success(`Removed ${sizeKey}`);
      refreshConfigured();
    } catch (err) {
      toast.error(`Remove failed: ${err.message}`);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Mockup Templates</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Scan folders for mockup files and configure template assignments.
        </p>
      </div>

      {/* Templates Folder Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="size-4 text-amber-400" />
            Templates Folder
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Label htmlFor="folder-path" className="text-xs text-muted-foreground mb-1.5">Folder path</Label>
              <Input
                id="folder-path"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                onBlur={(e) => saveFolder(e.target.value)}
                placeholder="/home/you/etsy-mockup-packs"
              />
            </div>
            <div className="flex items-end gap-2">
              {hasFolderPicker && (
                <Button variant="outline" onClick={handleBrowse} className="shrink-0">
                  <FolderOpen className="size-3.5" />
                  Browse…
                </Button>
              )}
              <Button onClick={handleScan} disabled={scanTask.pending} className="shrink-0">
                {scanTask.pending ? 'Scanning…' : 'Scan folder'}
                <FolderSearch className="size-3.5" />
              </Button>
            </div>
          </div>
          {listTask.error && (
            <p className="text-sm text-destructive mt-3">{listTask.error}</p>
          )}
        </CardContent>
      </Card>

      {/* Scan Results */}
      {scanTask.pending && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="gap-0">
              <Skeleton className="aspect-[4/3] w-full rounded-t-xl" />
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {scanFiles.length > 0 && !scanTask.pending && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-4 text-amber-400" />
              Select Templates to Configure
              <Badge variant="secondary">{scanFiles.length} files</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-h-96 overflow-y-auto">
              {scanFiles.map((f) => (
                <div
                  key={f.path}
                  className={cn(
                    'rounded-xl border p-3 transition-colors',
                    selected[f.path]
                      ? 'border-amber-500/50 bg-amber-500/5'
                      : 'border-border bg-card'
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={!!selected[f.path]}
                      onChange={() => toggleSelected(f.path)}
                      className="rounded border-input accent-amber-500"
                    />
                    <span className="text-sm font-medium truncate flex-1" title={f.filename}>
                      {f.filename}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {f.width}×{f.height}px
                  </p>
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    {f.kind.toUpperCase()}
                  </Badge>
                  {f.alreadyAssignedTo && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      already used as <span className="font-medium text-foreground">{f.alreadyAssignedTo}</span>
                    </p>
                  )}
                  {selected[f.path] && (
                    <div className="flex flex-col gap-1.5 mt-3 pt-3 border-t border-border">
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs text-muted-foreground">Size key</Label>
                        <Input
                          value={perFileSizeKey[f.path] ?? ''}
                          onChange={(e) =>
                            setPerFileSizeKey((prev) => ({ ...prev, [f.path]: e.target.value }))
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                      {f.kind === 'psd' && (
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs text-muted-foreground">Placement layer</Label>
                          <Input
                            value={perFilePlacementLayer[f.path] ?? ''}
                            onChange={(e) =>
                              setPerFilePlacementLayer((prev) => ({ ...prev, [f.path]: e.target.value }))
                            }
                            placeholder="e.g. artwork"
                            className="h-7 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Bulk Assign */}
            {selectedFiles.length > 0 && (
              <div className="mt-6 pt-4 border-t border-border">
                <p className="text-sm font-medium mb-3">
                  Bulk assign {selectedFiles.length} selected file{selectedFiles.length === 1 ? '' : 's'}
                </p>
                <div className="flex flex-col sm:flex-row gap-3 items-end">
                  <FormField
                    label="Dimensions"
                    value={bulkDimensions}
                    onChange={setBulkDimensions}
                    placeholder="8x10"
                    className="flex-1 min-w-0"
                  />
                  <FormField
                    label="DPI"
                    value={bulkDpi}
                    onChange={setBulkDpi}
                    placeholder="300"
                    className="w-24"
                  />
                  <FormField
                    label="Orientation"
                    value={bulkOrientation}
                    onChange={setBulkOrientation}
                    placeholder="portrait"
                    className="w-32"
                  />
                  <FormField
                    label="Category"
                    value={bulkCategory}
                    onChange={setBulkCategory}
                    placeholder="e.g. bedroom"
                    list="mockup-category-options"
                    className="flex-1 min-w-0"
                  />
                  <Button
                    onClick={handleBulkAssign}
                    disabled={assignTask.pending}
                    className="shrink-0"
                  >
                    {assignTask.pending ? 'Assigning…' : `Assign ${selectedFiles.length}`}
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                {assignTask.error && (
                  <p className="text-sm text-destructive mt-2">{assignTask.error}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Configured Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageOff className="size-4 text-amber-400" />
            Configured Templates
            {configured.length > 0 && <Badge variant="secondary">{configured.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {listTask.pending ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="gap-0">
                  <Skeleton className="aspect-[4/3] w-full rounded-t-xl" />
                  <CardContent className="p-4 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <div className="grid grid-cols-2 gap-2">
                      <Skeleton className="h-7 w-full" />
                      <Skeleton className="h-7 w-full" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : configured.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {configured.map((row) => (
                <ConfiguredTemplateCard
                  key={`${row.size_key}-${configuredKey}`}
                  row={row}
                  categoryOptions={categoryOptions}
                  onSave={handleConfiguredSave}
                  onRemove={handleConfiguredRemove}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ImageOff className="size-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                No templates configured yet — scan a folder above and assign some.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <datalist id="mockup-category-options">
        {categoryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}
