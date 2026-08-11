/**
 * CSS-only loading placeholder. See styles.css's "plan.md step 2" section for
 * the shimmer animation (neutralized automatically by the existing
 * prefers-reduced-motion rule at the top of that file).
 */
export default function Skeleton({ variant = 'lines', count = 3 }) {
  const items = Array.from({ length: count });

  if (variant === 'table') {
    return (
      <div className="skeleton-table" aria-hidden="true">
        {items.map((_, i) => (
          <div key={i} className="skeleton-table-row" />
        ))}
      </div>
    );
  }

  return (
    <div className="skeleton-lines" aria-hidden="true">
      {items.map((_, i) => (
        <div key={i} className={`skeleton-line${i === items.length - 1 ? ' short' : ''}`} />
      ))}
    </div>
  );
}
