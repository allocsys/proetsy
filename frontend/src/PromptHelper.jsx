import { useEffect, useState, useCallback } from 'react';
import { Sparkles, Plus, Upload, Copy, Check, Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/hooks/useApi';
import { useAsyncTask } from '@/hooks/useAsyncTask';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const ORIENTATIONS = ['portrait', 'landscape', 'square'];
const COPIED_FEEDBACK_MS = 1500;

function CopyButton({ text, id, copiedId, setCopiedId }) {
  const isCopied = copiedId === id;
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId((c) => (c === id ? null : c)), COPIED_FEEDBACK_MS);
      }}
    >
      {isCopied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
      {isCopied ? 'Copied!' : 'Copy'}
    </Button>
  );
}

function PromptCard({ prompt, copiedId, setCopiedId }) {
  return (
    <Card className="gap-0">
      <CardContent className="p-4">
        <pre className="bg-muted/60 rounded-lg p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all max-h-40 overflow-y-auto mb-3">
          {prompt.prompt_text}
        </pre>
        <div className="flex items-center justify-between gap-2">
          <CopyButton
            text={prompt.prompt_text}
            id={`gen-${prompt.id}`}
            copiedId={copiedId}
            setCopiedId={setCopiedId}
          />
        </div>
        {prompt.warnings?.length > 0 && (
          <ul className="mt-3 space-y-1">
            {prompt.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="size-3 shrink-0 mt-0.5" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryRow({ prompt, copiedId, setCopiedId }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <code className="text-xs font-mono text-muted-foreground break-all flex-1 min-w-0">
        {prompt.prompt_text}
      </code>
      <CopyButton
        text={prompt.prompt_text}
        id={`hist-${prompt.id}`}
        copiedId={copiedId}
        setCopiedId={setCopiedId}
      />
    </div>
  );
}

export default function PromptHelper() {
  const [trends, setTrends] = useState([]);
  const [selectedTrendId, setSelectedTrendId] = useState('');
  const [orientation, setOrientation] = useState('portrait');
  const [newTrendTerm, setNewTrendTerm] = useState('');
  const [newTrendCategory, setNewTrendCategory] = useState('');
  const [generated, setGenerated] = useState([]);
  const [history, setHistory] = useState([]);
  const [copiedId, setCopiedId] = useState(null);
  const [historyTab, setHistoryTab] = useState('portrait');

  const trendsTask = useAsyncTask();
  const addTrendTask = useAsyncTask();
  const generateTask = useAsyncTask();
  const historyTasks = { portrait: useAsyncTask(), landscape: useAsyncTask(), square: useAsyncTask() };

  const loadTrends = useCallback(() => {
    trendsTask.run(async () => {
      const data = await api.trends.list();
      setTrends(Array.isArray(data) ? data : []);
    });
  }, [trendsTask]);

  const loadHistory = useCallback((o) => {
    historyTasks[o].run(async () => {
      const data = await api.prompts.list(o);
      setHistory(Array.isArray(data) ? data : []);
    });
  }, [historyTasks]);

  useEffect(() => { loadTrends(); }, [loadTrends]);
  useEffect(() => { loadHistory(historyTab); }, [historyTab, loadHistory]);

  function handleAddTrend() {
    if (!newTrendTerm.trim()) {
      toast.error('Enter a trend term');
      return;
    }
    addTrendTask.run(async () => {
      const data = await api.trends.add({
        term: newTrendTerm,
        category: newTrendCategory || undefined,
      });
      toast.success(`Added trend: ${newTrendTerm}`);
      setNewTrendTerm('');
      setNewTrendCategory('');
      await loadTrends();
      if (data?.id) setSelectedTrendId(String(data.id));
    });
  }

  async function handleCsvImport(file) {
    if (!file) return;
    try {
      const csv = await file.text();
      const data = await api.trends.csv(csv);
      toast.success(`Imported ${data.imported} trend(s) from ${file.name}`);
      await loadTrends();
    } catch (err) {
      toast.error(`CSV import failed: ${err.message}`);
    }
  }

  function handleGenerate() {
    generateTask.run(async () => {
      const data = await api.prompts.generate({
        trend_id: selectedTrendId ? Number(selectedTrendId) : null,
        orientation,
      });
      setGenerated(data.prompts || []);
      toast.success(`Generated ${(data.prompts || []).length} prompt${(data.prompts || []).length === 1 ? '' : 's'}`);
      await loadHistory(orientation);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Prompt Helper</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Generate product listing prompts from current design trends.
        </p>
      </div>

      {/* Generate Prompts Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber-400" />
            Generate Prompts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 w-full min-w-0">
              <Label className="text-xs text-muted-foreground mb-1.5">Orientation</Label>
              <Select value={orientation} onValueChange={setOrientation}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORIENTATIONS.map((o) => (
                    <SelectItem key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 w-full min-w-0">
              <Label className="text-xs text-muted-foreground mb-1.5">Trend</Label>
              <Select value={selectedTrendId} onValueChange={setSelectedTrendId} disabled={trendsTask.pending}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={trendsTask.pending ? 'Loading…' : '(none)'} />
                </SelectTrigger>
                <SelectContent>
                  {trends.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.term}{t.category ? ` (${t.category})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleGenerate} disabled={generateTask.pending} className="shrink-0">
              {generateTask.pending ? 'Generating…' : 'Generate prompts'}
              <Sparkles className="size-3.5" />
            </Button>
          </div>
          {(trendsTask.error || generateTask.error) && (
            <p className="text-sm text-destructive mt-3">{trendsTask.error || generateTask.error}</p>
          )}
        </CardContent>
      </Card>

      {/* Add Trend Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4 text-amber-400" />
            Add Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 w-full min-w-0">
              <Label className="text-xs text-muted-foreground mb-1.5">New trend term</Label>
              <Input
                value={newTrendTerm}
                onChange={(e) => setNewTrendTerm(e.target.value)}
                placeholder="Add a new trend"
                onKeyDown={(e) => e.key === 'Enter' && handleAddTrend()}
              />
            </div>
            <div className="flex-1 w-full min-w-0">
              <Label className="text-xs text-muted-foreground mb-1.5">Category</Label>
              <Input
                value={newTrendCategory}
                onChange={(e) => setNewTrendCategory(e.target.value)}
                placeholder="Category"
                onKeyDown={(e) => e.key === 'Enter' && handleAddTrend()}
              />
            </div>
            <Button
              variant="outline"
              onClick={handleAddTrend}
              disabled={addTrendTask.pending || !newTrendTerm.trim()}
              className="shrink-0"
            >
              {addTrendTask.pending ? 'Adding…' : 'Add trend'}
              <Plus className="size-3.5" />
            </Button>
          </div>

          <div className="mt-4 pt-4 border-t border-border">
            <Label className="text-xs text-muted-foreground mb-1.5">
              Import CSV <span className="font-mono">(term, category)</span>
            </Label>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.csv,text/csv';
                  input.onchange = (e) => handleCsvImport(e.target.files?.[0]);
                  input.click();
                }}
              >
                <Upload className="size-3.5" />
                Choose CSV file
              </Button>
            </div>
          </div>

          {addTrendTask.error && (
            <p className="text-sm text-destructive mt-3">{addTrendTask.error}</p>
          )}
        </CardContent>
      </Card>

      {/* Generated Prompts */}
      {generateTask.pending && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-400" />
              Generated Prompts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-20 w-full rounded-lg" />
                  <Skeleton className="h-7 w-20" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {generated.length > 0 && !generateTask.pending && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-400" />
              Generated Prompts
              <Badge variant="secondary">{generated.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {generated.map((p) => (
                <PromptCard
                  key={p.id}
                  prompt={p}
                  copiedId={copiedId}
                  setCopiedId={setCopiedId}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-amber-400" />
            History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={historyTab} onValueChange={setHistoryTab}>
            <TabsList>
              {ORIENTATIONS.map((o) => (
                <TabsTrigger key={o} value={o}>
                  {o.charAt(0).toUpperCase() + o.slice(1)}
                </TabsTrigger>
              ))}
            </TabsList>

            {ORIENTATIONS.map((o) => (
              <TabsContent key={o} value={o}>
                {historyTasks[o].pending ? (
                  <div className="space-y-2 mt-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full rounded-lg" />
                    ))}
                  </div>
                ) : history.length > 0 ? (
                  <div className="flex flex-col gap-2 mt-3 max-h-96 overflow-y-auto">
                    {history.map((p) => (
                      <HistoryRow
                        key={p.id}
                        prompt={p}
                        copiedId={copiedId}
                        setCopiedId={setCopiedId}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Clock className="size-8 text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">No prompts generated for {o} yet.</p>
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
