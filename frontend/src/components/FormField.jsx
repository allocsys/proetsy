import React from 'react';

/**
 * Reusable FormField primitive (label + input/textarea/select + saved-flash).
 * Reuses existing .settings-field, .settings-field-label, and .field-saved-hint CSS classes.
 *
 * @param {string} id - ID for input and htmlFor on label
 * @param {string} [label] - Label text
 * @param {boolean} [saved] - Whether to show the "Saved" flash hint
 * @param {string} [as] - Element type to render ('input', 'textarea', 'select')
 * @param {React.ReactNode} [children] - Child elements (e.g. select options)
 * @param {object} [wrapperStyle] - Inline styles for the outer settings-field wrapper div
 * @param {object} [style] - Inline styles for the inner input/textarea/select element
 * @param {string} [className] - Optional extra CSS class names
 */
export default function FormField({
  id,
  label,
  saved = false,
  as = 'input',
  children,
  wrapperStyle,
  style,
  className,
  ...rest
}) {
  const Component = as;

  return (
    <div className={`settings-field ${className || ''}`} style={wrapperStyle}>
      {label && (
        <label htmlFor={id} className="settings-field-label">
          {label}
          {saved && <span className="field-saved-hint">Saved</span>}
        </label>
      )}
      <Component id={id} style={style} {...rest}>
        {children}
      </Component>
    </div>
  );
}
