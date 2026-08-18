import { useCallback, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Key,
  Loader2,
  Sparkles,
  Tags as TagsIcon,
  Image as ImageIcon,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { api } from '@/hooks/useApi';
import { useAsyncTask } from '@/hooks/useAsyncTask';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import TagsSection from '@/components/TagsSection.jsx';
import MockupTemplates from '@/MockupTemplates.jsx';

const STEPS = [
  { key: 'api-key', label: 'Connect API Key', icon: Key },
  { key: 'tags', label: 'Starter Tags', icon: TagsIcon },
  { key: 'product-sizes', label: 'Product Sizes', icon: ImageIcon },
];

// ─── Step 1: Connect API key ─────────────────────────────────────────────
// Deliberately simpler than the full multi-provider form in Settings > API
// Keys (see plan.md Phase 3 step 1): just a single "Connect Gemini" action,
// since Gemini is the only key required to run the pipeline at all.

function ConnectApiKeyStep({ alreadyConnected, onConnected }) {
  const [keyValue, setKeyValue] = useState('');
  const connectTask = useAsyncTask();

  const handleConnect = useCallback(() => {
    if (!keyValue.trim()) {
      toast.error('Enter your Gemini API key');
      return;
    }
    connectTask.run(async () => {
      await api.apiKeys.add({
        provider: 'gemini',
        key_value: keyValue.trim(),
        label: 'Gemini',
      });
      toast.success('Gemini connected');
      setKeyValue('');
      onConnected?.();
    });
  }, [keyValue, connectTask, onConnected]);

  if (alreadyConnected) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-8 text-emerald-400" />
          <p className="text-sm font-medium text-foreground">Gemini is connected</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            You can manage or add more keys later from Settings → API Keys.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Key className="size-4" />
          Connect Gemini
        </CardTitle>
        <CardDescription>
          Proetsy uses Gemini to analyze artwork and generate listings. Paste your API key to get started.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-gemini-key" className="text-xs text-muted-foreground">Gemini API Key</Label>
          <Input
            id="onboarding-gemini-key"
            type="password"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder="AIza…"
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
          />
        </div>
        <Button onClick={handleConnect} disabled={connectTask.pending} className="gap-1.5">
          {connectTask.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Connect Gemini
        </Button>
        {connectTask.error && <p className="text-xs text-destructive">{connectTask.error}</p>}
        <p className="text-xs text-muted-foreground">
          Other providers (OpenAI, Midjourney, Replicate) can be added later from Settings → API Keys.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Wizard shell ─────────────────────────────────────────────────────────

function StepIndicator({ currentIndex }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                isDone && 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
                isCurrent && !isDone && 'border-primary bg-primary/10 text-primary',
                !isDone && !isCurrent && 'border-border text-muted-foreground'
              )}
            >
              {isDone ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
            </div>
            <span
              className={cn(
                'hidden text-xs sm:inline',
                isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground'
              )}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={cn('h-px w-6 sm:w-10', isDone ? 'bg-emerald-500/50' : 'bg-border')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function OnboardingWizard({ setupStatus, onComplete, onSetupStatusChange }) {
  const [stepIndex, setStepIndex] = useState(0);
  // Tracks connection made *during this wizard session* so step 1 flips to
  // its "done" state immediately, without waiting for setupStatus to refetch.
  const [justConnected, setJustConnected] = useState(false);

  const geminiConnected = justConnected || !!setupStatus?.geminiKeyConfigured;

  const goNext = useCallback(() => {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }, []);

  const goBack = useCallback(() => {
    setStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  const handleApiKeyConnected = useCallback(() => {
    setJustConnected(true);
    onSetupStatusChange?.();
  }, [onSetupStatusChange]);

  const handleFinish = useCallback(() => {
    onSetupStatusChange?.();
    onComplete?.();
  }, [onSetupStatusChange, onComplete]);

  const isLastStep = stepIndex === STEPS.length - 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Proetsy</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Let&rsquo;s get your shop set up. This only takes a minute.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleFinish} className="shrink-0 text-muted-foreground">
          Skip setup
        </Button>
      </div>

      <StepIndicator currentIndex={stepIndex} />

      <div>
        {stepIndex === 0 && (
          <ConnectApiKeyStep alreadyConnected={geminiConnected} onConnected={handleApiKeyConnected} />
        )}
        {stepIndex === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Import or add starter tags</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Paste tags one per line, or import a CSV. You can add more anytime from Settings.
              </p>
            </div>
            <TagsSection onSetupStatusChange={onSetupStatusChange} />
          </div>
        )}
        {stepIndex === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Set up product sizes</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Scan a folder of mockup templates and assign at least one product size. You can add more anytime.
              </p>
            </div>
            <MockupTemplates onSetupStatusChange={onSetupStatusChange} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={goBack}
          disabled={stepIndex === 0}
          className="gap-1.5"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
        {isLastStep ? (
          <Button onClick={handleFinish} className="gap-1.5">
            <Check className="size-3.5" />
            Finish
          </Button>
        ) : (
          <Button onClick={goNext} className="gap-1.5">
            Next
            <ArrowRight className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
