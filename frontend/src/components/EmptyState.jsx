function DefaultIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

/**
 * @param {object} [cta] - optional { label, onClick } to render a button below the message
 * @param {boolean} [compact] - trims padding/icon size for use inside an already-bordered box
 */
export default function EmptyState({ icon, message, cta, compact = false }) {
  return (
    <div className={`empty-state-box${compact ? ' compact' : ''}`}>
      <div className="empty-state-icon">{icon || <DefaultIcon />}</div>
      <p className="empty-state-message">{message}</p>
      {cta && (
        <button type="button" className="btn-secondary btn-sm empty-state-cta" onClick={cta.onClick}>
          {cta.label}
        </button>
      )}
    </div>
  );
}
