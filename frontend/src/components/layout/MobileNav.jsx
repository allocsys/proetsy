import {
  Upload,
  LayoutGrid,
  Clock,
  ClipboardCheck,
  Zap,
  Filter,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

const navItems = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'mockup-templates', label: 'Templates', icon: LayoutGrid },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'review', label: 'Review', icon: ClipboardCheck },
  { id: 'prompt-helper', label: 'Prompt', icon: Zap },
  { id: 'taste-filter', label: 'Taste', icon: Filter },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function MobileNav({ activeView, onViewChange }) {
  return (
    <nav className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-2 py-1.5 min-[900px]:hidden">
      <ScrollArea orientation="horizontal" className="w-full">
        <div className="flex gap-1">
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = activeView === id;
            return (
              <button
                key={id}
                onClick={() => onViewChange(id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </nav>
  );
}
