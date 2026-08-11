import { useEffect } from 'react';
import {
  Upload,
  LayoutGrid,
  Clock,
  ClipboardCheck,
  Zap,
  Filter,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';

const navGroups = [
  {
    label: 'Pipeline',
    items: [
      { id: 'upload', label: 'Upload', icon: Upload },
      { id: 'mockup-templates', label: 'Mockup Templates', icon: LayoutGrid },
      { id: 'history', label: 'Listing History', icon: Clock },
      { id: 'review', label: 'Review a Job', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Modules',
    items: [
      { id: 'prompt-helper', label: 'Prompt Helper', icon: Zap },
      { id: 'taste-filter', label: 'Taste Filter', icon: Filter },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

const statusColors = {
  pending: 'bg-amber-500',
  completed: 'bg-emerald-500',
  running: 'bg-blue-500',
  failed: 'bg-red-500',
};

export default function Sidebar({
  activeView,
  onViewChange,
  sidebarCollapsed,
  onToggleSidebar,
  statusCounts = {},
}) {
  useEffect(() => {
    localStorage.setItem('proetsy-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  const totalJobs = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  function NavItem({ item }) {
    const Icon = item.icon;
    const isActive = activeView === item.id;

    const btn = (
      <button
        onClick={() => onViewChange(item.id)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <Icon className="size-4 shrink-0" />
        {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
      </button>
    );

    if (sidebarCollapsed) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{btn}</TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      );
    }

    return btn;
  }

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200',
        'max-[900px]:hidden',
        sidebarCollapsed ? 'w-[52px]' : 'w-[220px]',
        'flex'
      )}
    >
      <div className="flex items-center justify-end p-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </Button>
      </div>

      <ScrollArea className="flex-1 px-2">
        <nav className="flex flex-col gap-1">
          {navGroups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              {!sidebarCollapsed && (
                <span className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </span>
              )}
              {sidebarCollapsed && <Separator className="my-1" />}
              {group.items.map((item) => (
                <NavItem key={item.id} item={item} />
              ))}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Pipeline status bar */}
      <div className="border-t border-border p-3">
        {totalJobs > 0 && (
          <div className="space-y-2">
            {!sidebarCollapsed && (
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pipeline
              </span>
            )}
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              {Object.entries(statusCounts).map(([key, count]) =>
                count > 0 ? (
                  <div
                    key={key}
                    className={statusColors[key] || 'bg-zinc-500'}
                    style={{ width: `${(count / totalJobs) * 100}%` }}
                  />
                ) : null
              )}
            </div>
            {!sidebarCollapsed && (
              <div className="flex gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  {statusCounts.pending ?? 0}
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {statusCounts.completed ?? 0}
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-blue-500" />
                  {statusCounts.running ?? 0}
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-red-500" />
                  {statusCounts.failed ?? 0}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* User footer */}
      <div className="border-t border-border p-3">
        <div
          className={cn(
            'flex items-center gap-3',
            sidebarCollapsed && 'justify-center'
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            PS
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col overflow-hidden">
              <span className="truncate text-sm font-medium">Print Studio</span>
              <span className="truncate text-xs text-muted-foreground">Admin</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
