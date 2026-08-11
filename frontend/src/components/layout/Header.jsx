import { RefreshCw, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import UpdaterStatus from '@/UpdaterStatus.jsx';

export default function Header({
  health,
  onRefreshHealth,
  onSettingsToggle,
  isInSettings,
}) {
  const isHealthy = health?.status === 'ok';

  return (
    <header className="sticky top-0 z-30 flex h-[54px] shrink-0 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur-sm">
      {/* Left: Logo */}
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          M
        </div>
        <span className="text-base font-bold tracking-tight text-foreground">
          ProEtsy
        </span>
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-3">
        {/* Backend health indicator */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'size-2 rounded-full',
              isHealthy ? 'bg-emerald-500' : 'bg-red-500'
            )}
          />
          <span className="text-xs text-muted-foreground">
            {isHealthy ? 'Backend OK' : 'Backend Down'}
          </span>
          {!isHealthy && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onRefreshHealth}
              aria-label="Retry health check"
            >
              <RefreshCw className="size-3" />
            </Button>
          )}
        </div>

        {/* Updater status (Electron only) */}
        <UpdaterStatus />

        {/* Settings button */}
        <Button
          variant={isInSettings ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={onSettingsToggle}
          aria-label="Toggle settings"
        >
          <Settings className="size-4" />
        </Button>
      </div>
    </header>
  );
}
