// Shared status-pill (colored dot + label) component. Previously reimplemented
// independently in four places -- App.jsx's StatusBadge (job status), two more inline
// copies inside App.jsx (API key enabled/disabled row, LLM rate-limit row), and
// TasteFilter.jsx's ScoreBadge -- plus a fifth, visually different, dot-less variant in
// UpdaterStatus.jsx. Consolidated here so all five now render identically (with the dot);
// see the frontend design review handoff for the history.
//
// `variant` should match one of the `.status-pill.<variant>` modifier classes defined in
// styles.css: success, danger (or failed), pending, running, skipped.
export default function StatusPill({ variant, children, ariaLabel }) {
  return (
    <span className={`status-pill ${variant}`} aria-label={ariaLabel}>
      <span className="status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}
