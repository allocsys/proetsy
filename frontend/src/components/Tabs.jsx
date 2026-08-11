import React from 'react';

/**
 * Generic reusable Tabs primitive.
 * Reuses existing .workspace-tabs and .workspace-tab-btn CSS classes.
 *
 * @param {Array<{ id: string, label: string, icon?: React.ReactNode }>} tabs - Array of tab objects
 * @param {string} activeId - Currently active tab ID
 * @param {function(string): void} onChange - Callback when a tab is clicked
 * @param {string} [className] - Optional extra CSS class names (e.g. 'settings-tabs-nav')
 */
export default function Tabs({ tabs, activeId, onChange, className }) {
  const containerClass = className ? `workspace-tabs ${className}` : 'workspace-tabs';

  return (
    <div className={containerClass}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            className={`workspace-tab-btn ${isActive ? 'active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
