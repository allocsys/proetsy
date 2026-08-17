import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Field names here must match GET /api/setup-status's actual response shape
// (backend/server.js) -- geminiKeyConfigured / hasTagLibrary / hasProductSize,
// not display-friendly guesses. See server.core-routes.test.js for the
// authoritative shape.
//
// "Setup Incomplete" itself is gated on the backend's own `readyToRun` flag (see
// isSetupIncomplete below), not on every item in this list being ready -- backend has
// never required Product Sizes to run (readyToRun = geminiKeyConfigured && hasTagLibrary).
// It stays in this list purely as an informational item so the user still sees its
// status, but a missing product size alone no longer flags the whole setup as
// incomplete, matching what the backend actually requires.
const checks = [
  {
    key: 'geminiApiKey',
    label: 'Gemini API Key',
    ready: (s) => !!s?.geminiKeyConfigured,
  },
  {
    key: 'tagLibrary',
    label: 'Tag Library',
    ready: (s) => !!s?.hasTagLibrary,
  },
  {
    key: 'productSizes',
    label: 'Product Sizes',
    ready: (s) => !!s?.hasProductSize,
  },
];

function isSetupIncomplete(setupStatus) {
  if (!setupStatus) return true;
  return !setupStatus.readyToRun;
}

export default function SetupBanner({ setupStatus }) {
  if (!isSetupIncomplete(setupStatus)) return null;

  const incompleteCount = checks.filter((c) => !c.ready(setupStatus)).length;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
      <div className="flex-1 space-y-2">
        <p className="text-sm font-medium text-amber-300">
          Setup Incomplete
          <span className="ml-2 text-xs font-normal text-amber-400/70">
            {incompleteCount} item{incompleteCount !== 1 ? 's' : ''} need action
          </span>
        </p>
        <ul className="space-y-1">
          {checks.map(({ key, label, ready }) => {
            const isReady = ready(setupStatus);
            return (
              <li key={key} className="flex items-center gap-2 text-xs">
                {isReady ? (
                  <CheckCircle2 className="size-3.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="size-3.5 text-amber-400" />
                )}
                <span
                  className={cn(
                    isReady ? 'text-emerald-400' : 'text-amber-300'
                  )}
                >
                  {label}
                </span>
                <span
                  className={cn(
                    'ml-auto text-[11px] font-medium',
                    isReady ? 'text-emerald-400/70' : 'text-amber-400'
                  )}
                >
                  {isReady ? 'Ready' : 'Action Required'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
