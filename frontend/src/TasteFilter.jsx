import { useEffect, useRef, useState, useMemo } from 'react';
import { RefreshCw, Upload, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, Send, ImageOff } from 'lucide-react';
import { toast } from 'sonner';
import { api, parseJsonResponse, friendlyErrorMessage } from '@/hooks/useApi';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const SCORE_STYLES = {
  'likely-keep': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  'likely-discard': 'bg-red-500/15 text-red-400 border-red-500/25',
  uncertain: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
};

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(0);
}

function ScoreBadge({ label, score, confident, prefix }) {
  if (score === null || score === undefined) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
        SCORE_STYLES[label] || SCORE_STYLES.uncertain
      )}
    >
      {label} ({score.toFixed(3)}){confident === false ? ' · cold start' : ''}
    </span>
  );
}

function ModelDownloadBar({ modelStatus }) {
  if (!modelStatus || modelStatus.status === 'ready' || modelStatus.status === 'idle') return null;

  if (modelStatus.status === 'error') {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-4">
          <p className="text-sm text-destructive font-medium">Model download failed: {modelStatus.error}</p>
          <p className="text-xs text-muted-foreground mt-1">Will retry automatically the next time you import images.</p>
        </CardContent>
      </Card>
    );
  }

  const { bytesDownloaded, totalBytes } = modelStatus;
  const pct = totalBytes ? Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100)) : null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">
            Downloading taste model
            {pct !== null && <span className="text-muted-foreground"> — {pct}%</span>}
          </p>
          <span className="text-xs text-muted-foreground font-mono">
            {formatMB(bytesDownloaded)} / {totalBytes ? formatMB(totalBytes) : '???'} MB
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
          <div
            role="progressbar"
            aria-valuenow={pct ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-full rounded-full bg-amber-500 transition-all duration-200"
            style={{ width: pct !== null ? `${pct}%` : '35%' }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">You can keep using the dashboard while this finishes.</p>
      </CardContent>
    </Card>
  );
}

function CandidateCard({ candidate, onLabel, onKeepAndPipeline }) {
  const [busy, setBusy] = useState(null);

  async function handleKeep() {
    setBusy('keep');
    try {
      await onLabel(candidate, 'keep');
    } finally {
      setBusy(null);
    }
  }

  async function handleDiscard() {
    setBusy('discard');
    try {
      await onLabel(candidate, 'discard');
    } finally {
      setBusy(null);
    }
  }

  async function handlePipeline() {
    setBusy('pipeline');
    try {
      await onKeepAndPipeline(candidate);
    } finally {
      setBusy(null);
    }
  }

  if (candidate.error) {
    return (
      <Card className="gap-0 border-destructive/30">
        <CardContent className="p-4">
          <p className="text-sm text-destructive">{candidate.error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-0">
      <div className="overflow-hidden rounded-t-xl bg-black">
        <img
          src={candidate.imageUrl}
          alt=""
          className="w-full aspect-square object-contain"
        />
      </div>
      <CardContent className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Global:</span>
          <ScoreBadge label={candidate.globalLabel} score={candidate.globalScore} confident={candidate.globalConfident} />
        </div>
        {candidate.category && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{candidate.category}:</span>
            <ScoreBadge label={candidate.categoryLabel} score={candidate.categoryScore} confident={candidate.categoryConfident} prefix={`${candidate.category} `} />
          </div>
        )}
        <div className="flex flex-col gap-1.5 mt-1">
          <Button size="xs" onClick={handleKeep} disabled={busy} className="w-full">
            <ThumbsUp className="size-3" />
            Keep
          </Button>
          <Button variant="destructive" size="xs" onClick={handleDiscard} disabled={busy} className="w-full">
            <ThumbsDown className="size-3" />
            Discard
          </Button>
          <Button variant="outline" size="xs" onClick={handlePipeline} disabled={busy} className="w-full">
            <Send className="size-3" />
            Keep + Pipeline
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TasteFilter({ overrides, refreshJobs } = {}) {
  const [category, setCategory] = useState('');
  const [promptId, setPromptId] = useState('');
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [promptOptions, setPromptOptions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [status, setStatus] = useState('');
  const [autoSortedExpanded, setAutoSortedExpanded] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [modelStatus, setModelStatus] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  const seenPathsRef = useRef(new Set());

  // Load datalist options
  useEffect(() => {
    api.tasteFilter.centroids()
      .then((rows) => {
        const cats = Array.from(new Set(rows.map((r) => r.category).filter((c) => c && c !== 'global'))).sort();
        setCategoryOptions(cats);
      })
      .catch(() => {});
    api.prompts.list('portrait')
      .then((prompts) => setPromptOptions(Array.isArray(prompts) ? prompts : []))
      .catch(() => {});
  }, []);

  // SSE: pending candidates stream
  useEffect(() => {
    const source = new EventSource('/api/taste-filter/pending/stream');
    source.onmessage = (event) => {
      let candidate;
      try {
        candidate = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!candidate || !candidate.imagePath || seenPathsRef.current.has(candidate.imagePath)) return;
      seenPathsRef.current.add(candidate.imagePath);
      setCandidates((prev) => [candidate, ...prev]);
    };
    return () => source.close();
  }, []);

  // SSE: model status stream
  useEffect(() => {
    const source = new EventSource('/api/taste-filter/model-status/stream');
    source.onmessage = (event) => {
      try {
        setModelStatus(JSON.parse(event.data));
      } catch {
        // keep existing state
      }
    };
    return () => source.close();
  }, []);

  async function handleImport(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setImporting(true);
    setStatus(`Scoring ${files.length} image${files.length > 1 ? 's' : ''}…`);

    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    if (category) formData.append('category', category);
    if (promptId) formData.append('prompt_id', promptId);

    try {
      const res = await fetch('/api/taste-filter/import', { method: 'POST', body: formData });
      const data = await parseJsonResponse(res);
      data.candidates.forEach((c) => seenPathsRef.current.add(c.imagePath));
      setCandidates((prev) => [...data.candidates, ...prev]);
      setStatus(`Scored ${data.candidates.length} image${data.candidates.length > 1 ? 's' : ''}.`);
      toast.success(`Scored ${data.candidates.length} image${data.candidates.length > 1 ? 's' : ''}`);
      if (category && !categoryOptions.includes(category)) {
        setCategoryOptions((prev) => [...prev, category].sort());
      }
    } catch (err) {
      const msg = friendlyErrorMessage(err);
      setStatus(`Import failed: ${msg}`);
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  }

  function handleFileChange(e) {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFileName(files.length === 1 ? files[0].name : `${files.length} files selected`);
      handleImport(files);
      e.target.value = '';
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setSelectedFileName(files.length === 1 ? files[0].name : `${files.length} files selected`);
      handleImport(files);
    }
  }

  async function handleLabel(candidate, label) {
    try {
      await api.tasteFilter.label({
        image_path: candidate.imagePath,
        embedding: candidate.embedding,
        label,
        category: candidate.category,
        prompt_id: candidate.promptId,
      });
      setCandidates((prev) => prev.filter((c) => c.imagePath !== candidate.imagePath));
      toast.success(label === 'keep' ? 'Kept' : 'Discarded');
    } catch (err) {
      toast.error(`Failed to save label: ${friendlyErrorMessage(err)}`);
      throw err;
    }
  }

  async function handleKeepAndPipeline(candidate) {
    try {
      await handleLabel(candidate, 'keep');
      const promoteRes = await fetch('/api/taste-filter/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_path: candidate.imagePath }),
      });
      const promoteData = await parseJsonResponse(promoteRes);

      await api.jobs.create({
        artwork_id: promoteData.artwork.id,
        pipeline_overrides: overrides,
      });
      toast.success('Sent to pipeline');
      if (refreshJobs) refreshJobs();
    } catch (err) {
      toast.error(`Pipeline send failed: ${friendlyErrorMessage(err)}`);
    }
  }

  async function handleRecompute() {
    setStatus('Recomputing centroids…');
    try {
      const res = await fetch('/api/taste-filter/recompute', { method: 'POST' });
      const data = await parseJsonResponse(res);
      const global = data.counts?.global || { keptCount: 0, discardedCount: 0 };
      setStatus(`Recomputed. Global: ${global.keptCount} kept / ${global.discardedCount} discarded.`);
      toast.success(`Recomputed: ${global.keptCount} kept / ${global.discardedCount} discarded`);
    } catch (err) {
      const msg = friendlyErrorMessage(err);
      setStatus(`Recompute failed: ${msg}`);
      toast.error(msg);
    }
  }

  const mainCandidates = useMemo(
    () => candidates.filter((c) => c.autoDecision == null),
    [candidates]
  );
  const autoSortedCandidates = useMemo(
    () => candidates.filter((c) => c.autoDecision != null),
    [candidates]
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Taste Filter</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Score and curate candidate artwork with CLIP-based taste filtering.
        </p>
      </div>

      {/* Controls Row */}
      <div className="flex flex-col sm:flex-row gap-3 items-end">
        <div className="flex-1 w-full min-w-0">
          <Label htmlFor="taste-category" className="text-xs text-muted-foreground mb-1.5">
            Category
          </Label>
          <Input
            id="taste-category"
            list="taste-category-options"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. square-canvas"
          />
          <datalist id="taste-category-options">
            {categoryOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="flex-1 w-full min-w-0">
          <Label htmlFor="taste-prompt-id" className="text-xs text-muted-foreground mb-1.5">
            Prompt ID
          </Label>
          <Input
            id="taste-prompt-id"
            list="taste-prompt-id-options"
            value={promptId}
            onChange={(e) => setPromptId(e.target.value)}
            placeholder="Links to Module 4"
          />
          <datalist id="taste-prompt-id-options">
            {promptOptions.map((p) => (
              <option key={p.id} value={p.id} label={p.prompt_text ? p.prompt_text.slice(0, 60) : undefined} />
            ))}
          </datalist>
        </div>
        <Button
          variant="outline"
          onClick={handleRecompute}
          className="shrink-0"
        >
          <RefreshCw className="size-3.5" />
          Recompute now
        </Button>
      </div>

      {/* Model Download Progress */}
      <ModelDownloadBar modelStatus={modelStatus} />

      {/* Drag-and-Drop Zone */}
      <div
        className={cn(
          'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors cursor-pointer',
          dragActive
            ? 'border-amber-500 bg-amber-500/5'
            : 'border-border hover:border-amber-500/50 hover:bg-muted/30'
        )}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => !importing && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
      >
        {importing ? (
          <>
            <Skeleton className="size-10 rounded-full mb-3" />
            <Skeleton className="h-4 w-48 mb-1" />
            <Skeleton className="h-3 w-32" />
          </>
        ) : (
          <>
            <div className="flex items-center justify-center size-10 rounded-full bg-amber-500/10 mb-3">
              <Upload className="size-5 text-amber-400" />
            </div>
            <p className="text-sm font-medium">Drag & drop candidate images here</p>
            <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP · Max 50MB per file</p>
            <Button variant="ghost" size="xs" className="mt-3">
              Choose Files
            </Button>
            {selectedFileName && (
              <p className="text-xs text-muted-foreground mt-1.5">{selectedFileName}</p>
            )}
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          aria-label="Upload candidate images"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {status && !importing && (
        <p className="text-xs text-muted-foreground font-mono">{status}</p>
      )}

      {/* Main Candidates Grid */}
      {mainCandidates.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-medium">Candidates</h3>
            <Badge variant="secondary">{mainCandidates.length}</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {mainCandidates.map((c) => (
              <CandidateCard
                key={c.imagePath}
                candidate={c}
                onLabel={handleLabel}
                onKeepAndPipeline={handleKeepAndPipeline}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {candidates.length === 0 && !importing && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ImageOff className="size-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No candidates yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Drop images above or they will stream in from the watch folder.</p>
        </div>
      )}

      {/* Auto-Sorted Collapsible Section */}
      {autoSortedCandidates.length > 0 && (
        <div>
          <button
            onClick={() => setAutoSortedExpanded(!autoSortedExpanded)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2"
          >
            {autoSortedExpanded
              ? <ChevronDown className="size-4" />
              : <ChevronRight className="size-4" />
            }
            Auto-sorted
            <Badge variant="outline" className="ml-1">{autoSortedCandidates.length}</Badge>
          </button>
          {autoSortedExpanded && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mt-2">
              {autoSortedCandidates.map((c) => (
                <CandidateCard
                  key={c.imagePath}
                  candidate={c}
                  onLabel={handleLabel}
                  onKeepAndPipeline={handleKeepAndPipeline}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TasteFilter;
