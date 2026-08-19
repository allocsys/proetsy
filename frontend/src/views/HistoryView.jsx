import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock,
  ChevronDown,
  ChevronRight,
  Eye,
  Loader2,
  AlertCircle,
  Play,
  RotateCcw,
  CheckCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/hooks/useApi';
import { useAsyncTask } from '@/hooks/useAsyncTask';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/layout/StatusBadge';

function formatTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function extractFilename(path) {
  if (!path) return 'Unknown file';
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function statusBreakdown(jobs) {
  const counts = {};
  for (const job of jobs) {
    const s = job.overall_status || 'pending';
    counts[s] = (counts[s] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${count} ${status}${count !== 1 ? 's' : ''}`)
    .join(', ');
}

// Shared checkbox visual -- native input styled with the theme's accent color, matching
// the existing `accent-*`/theme-token convention used elsewhere (e.g. MockupCategorySelector's
// pill-style checkboxes in ReviewView.jsx). Kept as a plain <input> rather than a new
// shadcn Checkbox component since there isn't one in components/ui yet and this is a
// small, self-contained control.
function RowCheckbox({ checked, onChange, ariaLabel }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
      className="size-4 shrink-0 cursor-pointer rounded border-border accent-primary"
    />
  );
}

function BatchGroup({ batchId, jobs, onOpenJob, selectedIds, onToggleJob, onToggleBatch }) {
  const [open, setOpen] = useState(true);

  const breakdown = useMemo(() => statusBreakdown(jobs), [jobs]);
  const allSelected = jobs.length > 0 && jobs.every((j) => selectedIds.has(j.id));
  const someSelected = !allSelected && jobs.some((j) => selectedIds.has(j.id));

  return (
    <Card>
      <div className="flex w-full items-center gap-3 px-4 py-3 hover:bg-muted/30">
        <RowCheckbox
          checked={allSelected}
          onChange={() => onToggleBatch(jobs, !allSelected)}
          ariaLabel={`Select all jobs in batch ${batchId}`}
        />
        <button
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="shrink-0 text-muted-foreground">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                Batch {batchId.length > 12 ? batchId.slice(0, 12) + '…' : batchId}
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {jobs.length} job{jobs.length !== 1 ? 's' : ''}
              </Badge>
              {someSelected && (
                <Badge variant="outline" className="text-[10px]">
                  {jobs.filter((j) => selectedIds.has(j.id)).length} of {jobs.length} selected
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{breakdown}</p>
          </div>
        </button>
      </div>
      {open && (
        <>
          <Separator />
          <div className="divide-y divide-border">
            {jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                onOpenJob={onOpenJob}
                selected={selectedIds.has(job.id)}
                onToggleSelect={() => onToggleJob(job.id)}
              />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function JobRow({ job, onOpenJob, selected, onToggleSelect }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/20',
        selected && 'bg-primary/5'
      )}
    >
      <RowCheckbox
        checked={selected}
        onChange={onToggleSelect}
        ariaLabel={`Select job ${extractFilename(job.artwork_file_path)}`}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium text-foreground">
          {extractFilename(job.artwork_file_path)}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Created {formatTime(job.created_at)}</span>
          {job.updated_at && job.updated_at !== job.created_at && (
            <span>Updated {formatTime(job.updated_at)}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <StatusBadge status={job.overall_status} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenJob?.(job.id)}
          className="gap-1.5"
        >
          <Eye className="size-3.5" />
          Review
        </Button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted">
          <Clock className="size-7 text-muted-foreground" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">No jobs yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload artwork to start the pipeline and view your listing history here.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// plan.md Phase 6: "HistoryView.jsx: add row multi-select + bulk action bar (Approve
// all, Regenerate all flagged, Re-run pipeline)". Sticky-ish bar shown once 1+ rows are
// selected. "Re-run pipeline" and "Regenerate flagged" both call POST /api/jobs/run-batch
// (api.jobs.runBatch) -- the existing bulk endpoint already re-runs whatever's currently
// pending/failed per job (see backend/lib/pipeline-runner.js's runPendingModulesForJob),
// so "regenerate" and "re-run" are the same server-side operation; the two buttons just
// differ in which job ids get sent. "Approve all" has no backend meaning yet -- jobs only
// carry overall_status (pending/running/success/failed), nothing like an approved flag --
// so it's shown disabled with an explanatory tooltip rather than wired to a no-op.
function BulkActionBar({ selectedCount, failedCount, onRerun, onRegenerateFlagged, onClear, pending }) {
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-wrap items-center gap-3 py-3">
        <Badge className="gap-1 text-xs">
          {selectedCount} selected
        </Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onRerun}
            disabled={pending}
            className="gap-1.5"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Re-run pipeline
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onRegenerateFlagged}
            disabled={pending || failedCount === 0}
            className="gap-1.5"
            title={failedCount === 0 ? 'No failed jobs in the current selection' : undefined}
          >
            <RotateCcw className="size-3.5" />
            Regenerate flagged{failedCount > 0 ? ` (${failedCount})` : ''}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled
            className="gap-1.5"
            title="Not available yet -- there's no 'approved' state on jobs in the backend today. Let me know if you'd like that added."
          >
            <CheckCheck className="size-3.5" />
            Approve all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClear}
            disabled={pending}
            className="gap-1.5"
          >
            <X className="size-3.5" />
            Clear
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HistoryView({ onOpenJob }) {
  const [jobs, setJobs] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const task = useAsyncTask();
  const bulkTask = useAsyncTask();

  const fetchJobs = useCallback(async () => {
    const data = await api.jobs.list();
    const list = Array.isArray(data) ? data : data.jobs || [];
    setJobs(list);
    // Prune any selected ids that no longer exist in the fetched list (e.g. a manual
    // Refresh after data changed elsewhere), so selection never silently references a
    // job that isn't on screen anymore.
    setSelectedIds((prev) => {
      const validIds = new Set(list.map((j) => j.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  useEffect(() => {
    task.run(fetchJobs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchJobs]);

  // Group jobs by batch_id
  const groups = useMemo(() => {
    const batchMap = new Map();
    const soloJobs = [];

    for (const job of jobs) {
      if (job.batch_id) {
        if (!batchMap.has(job.batch_id)) {
          batchMap.set(job.batch_id, []);
        }
        batchMap.get(job.batch_id).push(job);
      } else {
        soloJobs.push(job);
      }
    }

    // Sort batches by latest job date descending
    const batches = Array.from(batchMap.entries())
      .map(([batchId, batchJobs]) => ({
        batchId,
        jobs: batchJobs.sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        ),
      }))
      .sort((a, b) => {
        const aLatest = Math.max(...a.jobs.map((j) => new Date(j.created_at)));
        const bLatest = Math.max(...b.jobs.map((j) => new Date(j.created_at)));
        return bLatest - aLatest;
      });

    return { batches, soloJobs: soloJobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) };
  }, [jobs]);

  const totalJobs = jobs.length;
  const selectedCount = selectedIds.size;
  const allSelected = totalJobs > 0 && selectedCount === totalJobs;

  const toggleJob = useCallback((jobId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }, []);

  const toggleBatch = useCallback((batchJobs, shouldSelect) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const job of batchJobs) {
        if (shouldSelect) next.add(job.id);
        else next.delete(job.id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => (prev.size === jobs.length ? new Set() : new Set(jobs.map((j) => j.id))));
  }, [jobs]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const failedSelectedIds = useMemo(
    () => jobs.filter((j) => selectedIds.has(j.id) && j.overall_status === 'failed').map((j) => j.id),
    [jobs, selectedIds]
  );

  const runBulk = useCallback(
    async (jobIds, { emptyMessage } = {}) => {
      if (!jobIds.length) {
        if (emptyMessage) toast.info(emptyMessage);
        return;
      }
      const result = await bulkTask.run(async () => api.jobs.runBatch({ job_ids: jobIds }));
      if (!result) return; // bulkTask already captured the error
      const outcomes = Array.isArray(result.outcomes) ? result.outcomes : [];
      const succeeded = outcomes.filter((o) => o.ok).length;
      const failed = outcomes.length - succeeded;
      if (failed > 0) {
        toast.warning(`Re-ran ${outcomes.length} job(s) — ${succeeded} succeeded, ${failed} failed`);
      } else {
        toast.success(`Re-ran ${succeeded} job${succeeded !== 1 ? 's' : ''}`);
      }
      clearSelection();
      await fetchJobs();
    },
    [bulkTask, clearSelection, fetchJobs]
  );

  const handleRerun = useCallback(() => {
    runBulk([...selectedIds]);
  }, [runBulk, selectedIds]);

  const handleRegenerateFlagged = useCallback(() => {
    runBulk(failedSelectedIds, { emptyMessage: 'No failed jobs in the current selection' });
  }, [runBulk, failedSelectedIds]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Listing History</h1>
            {totalJobs > 0 && (
              <Badge variant="secondary" className="text-xs">
                {totalJobs} job{totalJobs !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Review past pipeline runs and their results.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {totalJobs > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <RowCheckbox checked={allSelected} onChange={toggleAll} ariaLabel="Select all jobs" />
              Select all
            </label>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => task.run(fetchJobs)}
            disabled={task.pending}
            className="gap-1.5"
          >
            <Loader2 className={cn('size-3.5', task.pending && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <BulkActionBar
          selectedCount={selectedCount}
          failedCount={failedSelectedIds.length}
          onRerun={handleRerun}
          onRegenerateFlagged={handleRegenerateFlagged}
          onClear={clearSelection}
          pending={bulkTask.pending}
        />
      )}

      {/* Bulk action error */}
      {bulkTask.error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{bulkTask.error}</p>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {task.error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{task.error}</p>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {task.pending && !task.error && jobs.length === 0 && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-4 rounded" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!task.pending && !task.error && totalJobs === 0 && <EmptyState />}

      {/* Job list */}
      {totalJobs > 0 && (
        <div className="space-y-3">
          {/* Batch groups */}
          {groups.batches.map((batch) => (
            <BatchGroup
              key={batch.batchId}
              batchId={batch.batchId}
              jobs={batch.jobs}
              onOpenJob={onOpenJob}
              selectedIds={selectedIds}
              onToggleJob={toggleJob}
              onToggleBatch={toggleBatch}
            />
          ))}

          {/* Solo jobs */}
          {groups.soloJobs.map((job) => (
            <Card key={job.id}>
              <JobRow
                job={job}
                onOpenJob={onOpenJob}
                selected={selectedIds.has(job.id)}
                onToggleSelect={() => toggleJob(job.id)}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
