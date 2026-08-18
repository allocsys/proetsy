import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  Loader2,
  AlertCircle,
  Eye,
  Sparkles,
  FileText,
  Image as ImageIcon,
  Save,
  Copy,
  Check,
  RefreshCw,
  Camera,
} from 'lucide-react';
import { api } from '@/hooks/useApi';
import { useAsyncTask } from '@/hooks/useAsyncTask';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import StatusBadge from '@/components/layout/StatusBadge';

// ─── Helpers ──────────────────────────────────────────────────────────────

function listOrDash(items) {
  return Array.isArray(items) && items.length > 0 ? items.join(', ') : '—';
}

function tagsToText(tags) {
  return Array.isArray(tags) ? tags.join(', ') : '';
}

function textToTags(text) {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

const FALLBACK_CONVENTIONS = {
  maxTitleLength: 140,
  tagsPerListing: 13,
  maxTagLength: 20,
  forbiddenTitleWords: [],
  aiDisclosurePhrases: [],
  deliveryDetailPhrases: [],
};

// ─── Job Picker ───────────────────────────────────────────────────────────

function JobPicker({ initialJobId, onLoadJob }) {
  // jobs.id is an INTEGER PRIMARY KEY (see backend/db/schema.sql), not a UUID string --
  // initialJobId arrives as a number from App.jsx's selectedJobId. Normalize to a string
  // once here so inputValue (a controlled text input's value) is always a string; every
  // downstream .trim()/comparison on it depends on that.
  const initialJobIdStr = initialJobId != null ? String(initialJobId) : '';
  const [inputValue, setInputValue] = useState(initialJobIdStr);
  const [job, setJob] = useState(null);
  const loadTask = useAsyncTask();

  const handleLoad = useCallback(() => {
    const id = inputValue.trim();
    if (!id) return;
    loadTask.run(async () => {
      const data = await api.jobs.get(id);
      setJob(data);
      onLoadJob(id, data);
    });
  }, [inputValue, onLoadJob, loadTask]);

  // Sync with external jobId changes (e.g. navigating from history)
  useEffect(() => {
    if (initialJobIdStr && initialJobIdStr !== inputValue) {
      setInputValue(initialJobIdStr);
      // Auto-load if we got a job ID from navigation
      loadTask.run(async () => {
        const data = await api.jobs.get(initialJobIdStr);
        setJob(data);
        onLoadJob(initialJobIdStr, data);
      });
    }
    // Only run on initialJobId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobIdStr]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleLoad();
  }, [handleLoad]);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex flex-1 items-center gap-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            placeholder="Enter a job ID to review…"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 font-mono text-sm"
          />
        </div>
        <Button onClick={handleLoad} disabled={loadTask.pending || !inputValue.trim()} className="gap-1.5 shrink-0">
          {loadTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
          Load
        </Button>
        {job && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-xs">
              Job #{String(job.id ?? '').slice(0, 8)}
            </Badge>
            <StatusBadge status={job.overall_status || job.status} />
          </div>
        )}
      </CardContent>
      {loadTask.error && (
        <div className="border-t border-border px-4 py-2">
          <p className="text-xs text-destructive">{loadTask.error}</p>
        </div>
      )}
    </Card>
  );
}

// ─── Analysis Grid ────────────────────────────────────────────────────────

const ANALYSIS_FIELDS = [
  { key: 'subject', label: 'Subject' },
  { key: 'style', label: 'Style' },
  { key: 'mood', label: 'Mood' },
  { key: 'palette', label: 'Palette', isArray: true },
  { key: 'themes', label: 'Themes', isArray: true },
  { key: 'notable_elements', label: 'Notable Elements', isArray: true },
  { key: 'suggested_categories', label: 'Suggested Categories', isArray: true },
];

function AnalysisGrid({ analysis }) {
  if (!analysis) return null;
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
      {ANALYSIS_FIELDS.map(({ key, label, isArray }) => (
        <Fragment key={key}>
          <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </dt>
          <dd className="text-sm text-foreground">
            {isArray ? listOrDash(analysis[key]) : (analysis[key] || '—')}
          </dd>
        </Fragment>
      ))}
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(7)].map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
          <Skeleton className="h-3 w-28 shrink-0" />
          <Skeleton className="h-4 w-full max-w-xs" />
        </div>
      ))}
    </div>
  );
}

// ─── Tab 1: Analysis ─────────────────────────────────────────────────────

function AnalysisTab({ jobId }) {
  const [job, setJob] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [manualNotes, setManualNotes] = useState('');
  const loadTask = useAsyncTask();
  const analyzeTask = useAsyncTask();
  const notesTask = useAsyncTask();

  const hasData = job || analysis;
  const error = loadTask.error || analyzeTask.error || notesTask.error;

  const handleLoadAnalysis = useCallback(() => {
    if (!jobId) return;
    loadTask.run(async () => {
      const jobData = await api.jobs.get(jobId);
      setJob(jobData);
      setManualNotes(jobData.manual_notes || '');
      if (jobData.artwork_id) {
        const artworkData = await api.artworks.get(jobData.artwork_id);
        setAnalysis(artworkData.image_analysis);
      }
    });
  }, [jobId, loadTask]);

  const handleRunAnalyzer = useCallback(() => {
    if (!jobId) return;
    analyzeTask.run(async () => {
      const data = await api.jobs.runImageAnalyzer(jobId);
      setAnalysis(data.imageAnalysis);
      if (data.job) setJob(data.job);
      toast.success('Image analysis completed');
    });
  }, [jobId, analyzeTask]);

  const handleSaveNotes = useCallback(() => {
    if (!jobId) return;
    notesTask.run(async () => {
      const data = await api.jobs.patchManualNotes(jobId, manualNotes);
      setJob(data);
      toast.success('Manual notes saved');
    });
  }, [jobId, manualNotes, notesTask]);

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={handleLoadAnalysis}
          disabled={!jobId || loadTask.pending}
          className="gap-1.5"
        >
          {loadTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
          Load Analysis
        </Button>
        <Button
          variant="outline"
          onClick={handleRunAnalyzer}
          disabled={!jobId || analyzeTask.pending}
          className="gap-1.5"
        >
          {analyzeTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Run Image Analyzer
        </Button>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loadTask.pending && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-3 w-64" />
          </CardHeader>
          <CardContent>
            <AnalysisSkeleton />
          </CardContent>
        </Card>
      )}

      {/* Analysis result */}
      {!loadTask.pending && analysis && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>AI Analysis Result</CardTitle>
              <Badge variant="secondary" className="text-[10px]">AI Generated</Badge>
            </div>
            <CardDescription>Artwork analysis from the image analyzer module.</CardDescription>
          </CardHeader>
          <CardContent>
            <AnalysisGrid analysis={analysis} />
          </CardContent>
        </Card>
      )}

      {/* No analysis yet */}
      {!loadTask.pending && hasData && !analysis && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Eye className="size-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">No analysis yet for this artwork</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click &ldquo;Run Image Analyzer&rdquo; to generate one.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty - no job loaded */}
      {!loadTask.pending && !hasData && !error && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <FileText className="size-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">Load a job to see analysis</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Enter a job ID above and click Load.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual notes */}
      {job && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Manual Notes Fallback</CardTitle>
            <CardDescription>
              Used by the listing generator when AI analysis is skipped or fails.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
              placeholder="Enter custom style, subject, or mood notes…"
              rows={4}
              className="resize-y"
            />
            <Button
              onClick={handleSaveNotes}
              disabled={notesTask.pending}
              className="gap-1.5"
            >
              {notesTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save Notes
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 2: Listings ─────────────────────────────────────────────────────

function ListingCard({ listing, conventions, onSaved }) {
  const [title, setTitle] = useState(listing.title || '');
  const [description, setDescription] = useState(listing.description || '');
  const [tagsText, setTagsText] = useState(tagsToText(listing.tags));
  const [tagAltText, setTagAltText] = useState(tagsToText(listing.tag_alternates));
  const [warnings, setWarnings] = useState(listing.warnings || []);
  const saveTask = useAsyncTask();
  const [copied, setCopied] = useState(false);

  const parsedTags = textToTags(tagsText);
  const titleOverLimit = title.length > conventions.maxTitleLength;
  const tagsOverLimit = parsedTags.length > conventions.tagsPerListing;
  const oversizedTagCount = parsedTags.filter((t) => t.length > conventions.maxTagLength).length;

  const handleSave = useCallback(() => {
    saveTask.run(async () => {
      const data = await api.listings.patch(listing.job_id, listing.id, {
        title,
        description,
        tags: textToTags(tagsText),
        tag_alternates: textToTags(tagAltText),
      });
      setTitle(data.title || '');
      setDescription(data.description || '');
      setTagsText(tagsToText(data.tags));
      setTagAltText(tagsToText(data.tag_alternates));
      const newWarnings = data.warnings || [];
      setWarnings(newWarnings);
      onSaved(data);
      // Post-save diff notice (plan.md Phase 4): the server silently strips forbidden
      // words / AI-disclosure / delivery-detail phrases via enforceConventions. Rather
      // than asking the reviewer to notice and pre-emptively fix these before saving,
      // surface exactly what changed after the fact. Full detail also stays visible in
      // the inline warnings note below.
      if (newWarnings.length > 0) {
        toast.success('Listing saved', { description: newWarnings.join(' · ') });
      } else {
        toast.success('Listing saved');
      }
    });
  }, [listing, title, description, tagsText, tagAltText, onSaved, saveTask]);

  const handleCopyForEtsy = useCallback(async () => {
    const text = `${title}\n\n${description}\n\nTags: ${tagsText}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Clipboard copy failed — select and copy manually.');
    }
  }, [title, description, tagsText]);

  const variationLabel = listing.variation ? listing.variation.replace(/_/g, ' ') : 'Listing';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm capitalize">{variationLabel}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">AI Listing</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Title */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`title-${listing.id}`} className="text-xs text-muted-foreground">
              Title (max {conventions.maxTitleLength} chars)
            </Label>
            <span className={cn('text-xs tabular-nums', titleOverLimit ? 'font-medium text-destructive' : 'text-muted-foreground')}>
              {title.length}/{conventions.maxTitleLength}
            </span>
          </div>
          <Input
            id={`title-${listing.id}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={titleOverLimit}
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label htmlFor={`desc-${listing.id}`} className="text-xs text-muted-foreground">
            Description
          </Label>
          <Textarea
            id={`desc-${listing.id}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            className="resize-y"
          />
        </div>

        {/* Tags */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`tags-${listing.id}`} className="text-xs text-muted-foreground">
              Tags (comma-separated, max {conventions.tagsPerListing})
            </Label>
            <span className={cn('text-xs tabular-nums', tagsOverLimit ? 'font-medium text-destructive' : 'text-muted-foreground')}>
              {parsedTags.length}/{conventions.tagsPerListing}
            </span>
          </div>
          <Input
            id={`tags-${listing.id}`}
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
          />
          {(tagsOverLimit || oversizedTagCount > 0) && (
            <p className="text-xs text-destructive">
              {oversizedTagCount > 0 && `${oversizedTagCount} tag(s) over ${conventions.maxTagLength} chars. `}
              {tagsOverLimit && 'Extra tags will be dropped on save.'}
            </p>
          )}
        </div>

        {/* Alternate Tags */}
        <div className="space-y-1.5">
          <Label htmlFor={`alt-tags-${listing.id}`} className="text-xs text-muted-foreground">
            Alternate Tags (comma-separated)
          </Label>
          <Input
            id={`alt-tags-${listing.id}`}
            value={tagAltText}
            onChange={(e) => setTagAltText(e.target.value)}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={saveTask.pending} className="gap-1.5">
            {saveTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={handleCopyForEtsy}
            data-testid="copy-for-etsy"
            className="gap-1.5"
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied!' : 'Copy for Etsy'}
          </Button>
        </div>

        {/* Server-side warnings */}
        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
            <ul className="space-y-1 text-xs text-amber-400">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Save error */}
        {saveTask.error && (
          <p className="text-xs text-destructive">{saveTask.error}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ListingsSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(2)].map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-8 w-full" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-24 w-full" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-8 w-full" />
            </div>
            <Skeleton className="h-8 w-40" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ListingsTab({ jobId }) {
  const [listings, setListings] = useState([]);
  const [conventions, setConventions] = useState(FALLBACK_CONVENTIONS);
  const loadTask = useAsyncTask();

  // Fetch shop conventions for validation
  useEffect(() => {
    api.shopConventions
      .get()
      .then((data) => {
        if (data?.listing) setConventions(data.listing);
      })
      .catch(() => {});
  }, []);

  const handleLoadListings = useCallback(() => {
    if (!jobId) return;
    loadTask.run(async () => {
      const data = await api.listings.get(jobId);
      setListings(Array.isArray(data) ? data : []);
    });
  }, [jobId, loadTask]);

  const handleSaved = useCallback((updated) => {
    setListings((prev) =>
      prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l))
    );
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={handleLoadListings}
          disabled={!jobId || loadTask.pending}
          className="gap-1.5"
        >
          {loadTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
          Load Listings
        </Button>
        {listings.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {listings.length} listing{listings.length !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* Error */}
      {loadTask.error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{loadTask.error}</p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loadTask.pending && <ListingsSkeleton />}

      {/* Listings */}
      {!loadTask.pending && listings.length > 0 && (
        <div className="space-y-4">
          {listings.map((l) => (
            <ListingCard
              key={l.id}
              listing={l}
              conventions={conventions}
              onSaved={handleSaved}
            />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loadTask.pending && listings.length === 0 && !loadTask.error && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <FileText className="size-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">No listings loaded yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {jobId
                  ? 'Click "Load Listings" to fetch generated listings for this job.'
                  : 'Load a job first, then fetch its listings.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 3: Mockups ───────────────────────────────────────────────────────

// plan.md Phase 5: a single flat `settings` key (same generic key/value table every
// other settings field already uses -- see api.settings.get/patch) holding a JSON array
// of category names, e.g. '["wall art","mugs"]'. Shop-wide, not per-job -- "last used"
// intentionally carries across jobs so the next upload starts pre-checked too.
const MOCKUP_LAST_CATEGORIES_SETTING = 'mockup_last_categories';

function parseLastCategories(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || '[]');
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

function MockupCategorySelector({ jobId, onGenerated }) {
  const [categories, setCategories] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [checked, setChecked] = useState({});
  const [status, setStatus] = useState('');
  const runTask = useAsyncTask();

  useEffect(() => {
    setLoaded(false);
    Promise.all([
      api.mockups.templates.categories(),
      api.mockups.templates.list(),
      api.settings.get(),
    ])
      .then(([cats, tpls, settings]) => {
        const resolvedCategories = Array.isArray(cats) ? cats : [];
        setCategories(resolvedCategories);
        setTemplates(Array.isArray(tpls) ? tpls : []);
        // Pre-check whatever category selection was last used for a generate run,
        // instead of starting from nothing every time (plan.md Phase 5). Only
        // pre-checks categories that still exist, in case templates were removed
        // since the last run.
        const lastUsed = parseLastCategories(settings?.[MOCKUP_LAST_CATEGORIES_SETTING]);
        const stillValid = lastUsed.filter((c) => resolvedCategories.includes(c));
        if (stillValid.length) {
          setChecked(Object.fromEntries(stillValid.map((c) => [c, true])));
        }
        setLoaded(true);
      })
      .catch(() => {});
  }, [jobId]);

  const toggleCategory = useCallback((category) => {
    setChecked((prev) => ({ ...prev, [category]: !prev[category] }));
  }, []);

  // "All enabled templates" quick-select (plan.md Phase 5) -- checks every category
  // that currently has at least one configured template, in one click.
  const selectAllEnabled = useCallback(() => {
    setChecked(Object.fromEntries(categories.map((c) => [c, true])));
  }, [categories]);

  const checkedCategoryNames = useMemo(
    () => Object.keys(checked).filter((c) => checked[c]),
    [checked]
  );

  const resolvedSizeKeys = useMemo(() => {
    const checkedCategories = new Set(checkedCategoryNames);
    if (!checkedCategories.size) return [];
    return templates
      .filter((t) => t.category && checkedCategories.has(t.category))
      .map((t) => t.size_key);
  }, [checkedCategoryNames, templates]);

  const handleGenerate = useCallback(async () => {
    if (!jobId || !resolvedSizeKeys.length) return;
    setStatus('Generating mockups…');
    const succeeded = await runTask.run(async () => {
      const data = await api.jobs.runModule(jobId, { size_keys: resolvedSizeKeys });
      // Persist this run's category selection as "last used" for next time (plan.md
      // Phase 5). Best-effort -- a failure here shouldn't surface as a generate
      // failure, since the mockups themselves already generated successfully.
      api.settings
        .patch({ [MOCKUP_LAST_CATEGORIES_SETTING]: JSON.stringify(checkedCategoryNames) })
        .catch(() => {});
      setStatus(`Generated mockups for ${resolvedSizeKeys.length} template${resolvedSizeKeys.length === 1 ? '' : 's'}.`);
      onGenerated?.();
      toast.success(`Mockups generated for ${resolvedSizeKeys.length} size(s)`);
      return data;
    });
    if (!succeeded) setStatus('');
  }, [jobId, resolvedSizeKeys, checkedCategoryNames, runTask, onGenerated]);

  if (!loaded) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Select Mockup Categories</CardTitle>
        <CardDescription>
          Choose categories to generate mockups for. Checked categories will include all their templates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {categories.length > 0 ? (
          <>
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllEnabled}
                className="gap-1.5"
              >
                All enabled templates
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {categories.map((c) => (
                <label
                  key={c}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                    checked[c]
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-muted/30 text-foreground'
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={!!checked[c]}
                    onChange={() => toggleCategory(c)}
                  />
                  <span className="font-medium">{c}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {templates.filter((t) => t.category === c).length}
                  </span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No mockup categories configured yet.</p>
        )}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleGenerate}
            disabled={runTask.pending || !resolvedSizeKeys.length}
            className="gap-1.5"
          >
            {runTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
            Generate Mockups
          </Button>
          {status && !runTask.pending && (
            <span className="text-xs text-muted-foreground">{status}</span>
          )}
        </div>
        {runTask.error && (
          <p className="text-xs text-destructive">{runTask.error}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MockupCard({ mockup, onVariantChange }) {
  const saveTask = useAsyncTask();

  const selectVariant = useCallback((variant) => {
    saveTask.run(async () => {
      const data = await api.mockups.setVariant(mockup.job_id, mockup.id, variant);
      onVariantChange(data);
      toast.success('Mockup variant selected');
    });
  }, [mockup, onVariantChange, saveTask]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-mono">
            {mockup.size_key}
            {mockup.dimensions && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({mockup.dimensions})
              </span>
            )}
          </CardTitle>
          {mockup.needs_review ? (
            <Badge variant="destructive" className="text-[10px]">Review Required</Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">
              Selected: {mockup.selected_variant || 'default'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {mockup.needs_review ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Smart Crop */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Option A: Smart Crop</p>
              {mockup.smart_crop_url ? (
                <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
                  <img
                    src={mockup.smart_crop_url}
                    alt="Smart crop variant"
                    className="aspect-square w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted/20">
                  <ImageIcon className="size-8 text-muted-foreground/40" />
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5"
                disabled={saveTask.pending}
                onClick={() => selectVariant('smart_crop')}
              >
                Use Smart Crop
              </Button>
            </div>
            {/* AI Extended */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Option B: AI Extended</p>
              {mockup.ai_extended_url ? (
                <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
                  <img
                    src={mockup.ai_extended_url}
                    alt="AI-extended variant"
                    className="aspect-square w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted/20">
                  <ImageIcon className="size-8 text-muted-foreground/40" />
                </div>
              )}
              <Button
                size="sm"
                className="w-full gap-1.5"
                disabled={saveTask.pending}
                onClick={() => selectVariant('ai_extended')}
              >
                Use AI Extended
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            {mockup.file_url ? (
              <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
                <img
                  src={mockup.file_url}
                  alt="Selected mockup"
                  className="max-h-80 w-auto object-contain"
                />
              </div>
            ) : (
              <div className="flex h-48 w-48 items-center justify-center rounded-lg border border-border bg-muted/20">
                <ImageIcon className="size-8 text-muted-foreground/40" />
              </div>
            )}
          </div>
        )}

        {saveTask.error && (
          <p className="mt-3 text-xs text-destructive">{saveTask.error}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MockupsSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-32 font-mono" />
              <Skeleton className="h-5 w-24" />
            </div>
          </CardHeader>
          <CardContent>
            <Skeleton className="aspect-square w-full max-w-xs" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MockupsTab({ jobId }) {
  const [mockups, setMockups] = useState([]);
  const loadTask = useAsyncTask();

  const handleLoadMockups = useCallback(() => {
    if (!jobId) return;
    loadTask.run(async () => {
      const data = await api.mockups.get(jobId);
      setMockups(Array.isArray(data) ? data : []);
    });
  }, [jobId, loadTask]);

  const handleVariantChange = useCallback(() => {
    handleLoadMockups();
  }, [handleLoadMockups]);

  return (
    <div className="space-y-4">
      {/* Category selector */}
      {jobId && <MockupCategorySelector jobId={jobId} onGenerated={handleLoadMockups} />}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={handleLoadMockups}
          disabled={!jobId || loadTask.pending}
          className="gap-1.5"
        >
          {loadTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Load Mockups
        </Button>
        {mockups.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {mockups.length} mockup{mockups.length !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* Error */}
      {loadTask.error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{loadTask.error}</p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loadTask.pending && <MockupsSkeleton />}

      {/* Mockups grid */}
      {!loadTask.pending && mockups.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {mockups.map((m) => (
            <MockupCard key={m.id} mockup={m} onVariantChange={handleVariantChange} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loadTask.pending && mockups.length === 0 && !loadTask.error && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <ImageIcon className="size-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">No mockups loaded yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {jobId
                  ? 'Select categories above and generate, or load existing mockups.'
                  : 'Load a job first to work with mockups.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main ReviewView ─────────────────────────────────────────────────────

export default function ReviewView({ jobId: initialJobId }) {
  const [activeJobId, setActiveJobId] = useState(initialJobId || null);

  const handleLoadJob = useCallback((id, _jobData) => {
    setActiveJobId(id);
  }, []);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Job Review</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Inspect analysis, review listings, and select mockup variants.
        </p>
      </div>

      {/* Job Picker */}
      <JobPicker initialJobId={initialJobId} onLoadJob={handleLoadJob} />

      {/* Tabs */}
      <Tabs defaultValue="analysis">
        <TabsList>
          <TabsTrigger value="analysis" className="gap-1.5">
            <Sparkles className="size-3.5" />
            Analysis
          </TabsTrigger>
          <TabsTrigger value="listings" className="gap-1.5">
            <FileText className="size-3.5" />
            Listings
          </TabsTrigger>
          <TabsTrigger value="mockups" className="gap-1.5">
            <ImageIcon className="size-3.5" />
            Mockups
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analysis" className="mt-4">
          <AnalysisTab jobId={activeJobId} />
        </TabsContent>

        <TabsContent value="listings" className="mt-4">
          <ListingsTab jobId={activeJobId} />
        </TabsContent>

        <TabsContent value="mockups" className="mt-4">
          <MockupsTab jobId={activeJobId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
