import { useEffect } from 'react';

/**
 * Generic reusable Modal primitive.
 * Reuses existing .modal-overlay, .modal-box CSS classes.
 *
 * @param {boolean} open - Whether the modal is open
 * @param {function} onClose - Called when clicking overlay or pressing Escape
 * @param {React.ReactNode} children - Modal content
 * @param {string} [labelledBy] - Element ID for aria-labelledby
 * @param {string} [ariaLabel] - Direct aria-label string
 * @param {string} [role='dialog'] - ARIA role ('dialog' or 'alertdialog')
 */
export default function Modal({
  open = true,
  onClose,
  children,
  labelledBy,
  ariaLabel,
  role = 'dialog',
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal-box"
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy || undefined}
        aria-label={ariaLabel || undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
