import React from 'react';

/**
 * Skip links for keyboard navigation
 * Allows users to skip to main content, navigation, or footer
 */
export function SkipLinks() {
  return (
    <div className="skip-links">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <a href="#navigation" className="skip-link">
        Skip to navigation
      </a>
      <a href="#wallet-controls" className="skip-link">
        Skip to wallet controls
      </a>
    </div>
  );
}

export default SkipLinks;
