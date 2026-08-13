import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2, Eye, Settings2 } from 'lucide-react';
import { api } from '@/hooks/useApi';
import { useAsyncTask } from '@/hooks/useAsyncTask';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';

// Keys must match the module names in backend/config/pipeline.config.json
// (image_analyzer, listing_generator, mockup_composer), not display-friendly
// slugs -- mod.module from GET /api/config/pipeline is looked up directly
// against this object below. See docs/known-issues/frontend-rebuild-logic-review-2026-08-12.md #7.
const MODULE_LABELS = {
  image_analyzer: { name: 'Image Analyzer', description: 'Analyzes artwork for colors, style, and composition' },
  listing_generator: { name: 'Listing Generator', description: 'Creates Etsy-optimized titles, descriptions, and tags' },
  mockup_composer: { name: 'Mockup Composer', description: 'Generates product mockups using PSD templates' },
};

export default function UploadView({ onNavigate, onJobsChanged }) {
  const [files, setFiles] = useState([]);
  const [pipelineModules, setPipelineModules] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [uploadStep, setUploadStep] = useState(null); // null | 'uploading' | 'creating' | 'running' | 'done'
  const [createdJobIds, setCreatedJobIds] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);

  const configTask = useAsyncTask();
  const uploadTask = useAsyncTask();

  // Fetch pipeline config on mount
  useEffect(() => {
    configTask.run(async () => {
      const data = await api.pipelineConfig();
      setPipelineModules(data.pipeline || []);
      const initial = {};
      for (const mod of data.pipeline || []) {
        initial[mod.module] = mod.enabled;
      }
      setOverrides(initial);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build pipeline_overrides from toggle state. backend/lib/jobs.js's
  // createJob/createJobsBulk read this as a plain object keyed by module name
  // (`overrides[moduleName]`) -- see its own doc comment: "overrides (optional):
  // { [module_name]: boolean }". App.jsx's tasteFilterOverrides builds the same
  // shape via Object.fromEntries for the same reason.
  const pipelineOverrides = useMemo(() => {
    return Object.fromEntries(
      pipelineModules.map((mod) => [mod.module, overrides[mod.module] ?? mod.enabled])
    );
  }, [pipelineModules, overrides]);

  // Handle toggle change
  const handleToggleChange = useCallback((moduleName, checked) => {
    setOverrides((prev) => ({ ...prev, [moduleName]: checked }));
  }, []);

  // Validate file types
  const isValidFile = useCallback((file) => {
    return file.type.startsWith('image/');
  }, []);

  // Add files from file list
  const addFiles = useCallback((fileList) => {
    const newFiles = Array.from(fileList).filter(isValidFile);
    setFiles((prev) => [...prev, ...newFiles]);
  }, [isValidFile]);

  // Drag handlers
  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleInputChange = useCallback((e) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
  }, [addFiles]);

  // Remove file from list
  const removeFile = useCallback((index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Main upload flow
  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;

    setUploadStep('uploading');
    setCreatedJobIds([]);

    try {
      // Step 1: Upload files
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }
      const uploadResult = await api.artworks.upload(formData);
      const artworkIds = uploadResult.artworks.map((a) => a.id);

      // Step 2: Create jobs
      setUploadStep('creating');
      const createResult = await api.jobs.createBulk({
        artwork_ids: artworkIds,
        pipeline_overrides: pipelineOverrides,
      });
      const jobIds = createResult.jobs.map((j) => j.id);
      setCreatedJobIds(jobIds);
      onJobsChanged?.();

      // Step 3: Run pipeline
      setUploadStep('running');
      await api.jobs.runBatch({ job_ids: jobIds });
      onJobsChanged?.();

      // Done
      setUploadStep('done');
      toast.success(`${files.length} artwork${files.length > 1 ? 's' : ''} submitted to pipeline`);

      // Clear files
      setFiles([]);
    } catch (err) {
      setUploadStep(null);
      toast.error(err.message || 'Upload failed');
    }
  }, [files, pipelineOverrides, onJobsChanged]);

  // Navigate to review after single-job upload
  const handleGoToReview = useCallback(() => {
    if (createdJobIds.length === 1 && onNavigate) {
      onNavigate('review', { jobId: createdJobIds[0] });
    }
  }, [createdJobIds, onNavigate]);

  const isUploading = uploadStep === 'uploading' || uploadStep === 'creating' || uploadStep === 'running';
  const isDone = uploadStep === 'done';
  const canUpload = files.length > 0 && !isUploading;

  const stepLabels = {
    uploading: 'Uploading artwork files...',
    creating: 'Creating pipeline jobs...',
    running: 'Starting pipeline run...',
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload Artwork</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop images here to start the listing pipeline — analyze artwork, generate listings,
          create mockups, and filter by taste.
        </p>
      </div>

      {/* Dropzone */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div
            role="button"
            tabIndex={0}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            className={cn(
              'flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed transition-colors sm:min-h-[240px]',
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30',
              isUploading && 'pointer-events-none opacity-60'
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={handleInputChange}
            />

            {isUploading ? (
              <>
                <Loader2 className="size-10 animate-spin text-primary" />
                <p className="text-sm font-medium text-foreground">{stepLabels[uploadStep]}</p>
              </>
            ) : isDone ? (
              <>
                <CheckCircle2 className="size-10 text-emerald-500" />
                <p className="text-sm font-medium text-foreground">Pipeline started successfully!</p>
              </>
            ) : (
              <>
                <div className={cn(
                  'flex size-14 items-center justify-center rounded-full transition-colors',
                  dragActive ? 'bg-primary/10' : 'bg-muted'
                )}>
                  <Upload className={cn(
                    'size-7 transition-colors',
                    dragActive ? 'text-primary' : 'text-muted-foreground'
                  )} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">
                    Drag & drop artwork files here, or click to browse
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Supports PNG, JPG, SVG, WEBP
                  </p>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* File list */}
      {files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Selected Files ({files.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {files.map((file, i) => (
                <div
                  key={`${file.name}-${i}`}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="truncate text-foreground">{file.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                    {!isUploading && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                        aria-label={`Remove ${file.name}`}
                      >
                        ×
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="mt-4 flex items-center gap-3">
              <Button
                onClick={handleUpload}
                disabled={!canUpload}
                className="gap-2"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="size-4" />
                    Start Pipeline
                  </>
                )}
              </Button>

              {!isUploading && files.length > 0 && (
                <Button variant="ghost" onClick={() => setFiles([])}>
                  Clear
                </Button>
              )}

              {isDone && createdJobIds.length === 1 && (
                <Button variant="outline" onClick={handleGoToReview} className="gap-2">
                  <Eye className="size-4" />
                  Review Job
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload error */}
      {uploadTask.error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-3">
            <p className="text-sm text-destructive">{uploadTask.error}</p>
          </CardContent>
        </Card>
      )}

      {/* Pipeline Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-muted-foreground" />
            <CardTitle>Pipeline Configuration</CardTitle>
          </div>
          <CardDescription>
            Toggle modules on or off. Disabled modules will be skipped when running the pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {configTask.pending ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-5 w-9 rounded-full" />
                </div>
              ))}
            </div>
          ) : configTask.error ? (
            <p className="text-sm text-destructive">Failed to load pipeline config: {configTask.error}</p>
          ) : (
            <div className="space-y-4">
              {pipelineModules.map((mod) => {
                const label = MODULE_LABELS[mod.module] || {
                  name: mod.module,
                  description: 'Pipeline module',
                };
                const isDisabled = mod.required;
                const isChecked = overrides[mod.module] ?? mod.enabled;

                return (
                  <div
                    key={mod.module}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {label.name}
                        </span>
                        {isDisabled && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Required
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {label.description}
                      </p>
                    </div>
                    <Switch
                      checked={isChecked}
                      onCheckedChange={(checked) => handleToggleChange(mod.module, checked)}
                      disabled={isDisabled || isUploading}
                      aria-label={`Toggle ${label.name}`}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
