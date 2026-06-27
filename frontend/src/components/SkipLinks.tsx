import React from 'react';

/**
 * Skip links for keyboard navigation — visible only on focus.
 * Targets: #main-content and #navigation landmarks.
 */
export function SkipLinks() {
  return (
    <div className="skip-links" aria-label="Skip navigation links">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <a href="#navigation" className="skip-link">
        Skip to navigation
      </a>
    </div>
  );
}

export default SkipLinks;
