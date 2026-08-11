import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, ChevronDown, ChevronRight, Eye, Loader2, AlertCircle } from 'lucide-react';
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

function BatchGroup({ batchId, jobs, onOpenJob }) {
  const [open, setOpen] = useState(true);

  const breakdown = useMemo(() => statusBreakdown(jobs), [jobs]);

  return (
    <Card>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
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
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{breakdown}</p>
        </div>
      </button>
      {open && (
        <>
          <Separator />
          <div className="divide-y divide-border">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} onOpenJob={onOpenJob} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function JobRow({ job, onOpenJob }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/20">
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
    <Card className="py-12">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-4">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted">
          <Clock className="size-7 text-muted-foreground" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">No jobs yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload artwork to get started.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HistoryView({ onOpenJob }) {
  const [jobs, setJobs] = useState([]);
  const task = useAsyncTask();

  const fetchJobs = useCallback(async () => {
    const data = await api.jobs.list();
    setJobs(Array.isArray(data) ? data : data.jobs || []);
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
        <div className="ml-auto">
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
            />
          ))}

          {/* Solo jobs */}
          {groups.soloJobs.map((job) => (
            <Card key={job.id}>
              <JobRow job={job} onOpenJob={onOpenJob} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
