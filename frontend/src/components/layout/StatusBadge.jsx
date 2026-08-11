import { cn } from '@/lib/utils';

const variantStyles = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  running: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  failed: 'bg-red-500/15 text-red-400 border-red-500/25',
  danger: 'bg-red-500/15 text-red-400 border-red-500/25',
  skipped: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
};

const dotStyles = {
  pending: 'bg-amber-400',
  completed: 'bg-emerald-400',
  success: 'bg-emerald-400',
  running: 'bg-blue-400',
  failed: 'bg-red-400',
  danger: 'bg-red-400',
  skipped: 'bg-zinc-400',
};

const labels = {
  pending: 'Pending',
  completed: 'Completed',
  success: 'Success',
  running: 'Running',
  failed: 'Failed',
  danger: 'Failed',
  skipped: 'Skipped',
};

export default function StatusBadge({ status, className }) {
  const key = status || 'pending';
  const validKey = variantStyles[key] ? key : 'pending';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        variantStyles[validKey],
        className
      )}
    >
      <span className={cn('size-1.5 rounded-full', dotStyles[validKey])} />
      {labels[validKey]}
    </span>
  );
}
