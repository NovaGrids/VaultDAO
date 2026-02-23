import React from 'react';

const SkipLinks: React.FC = () => {
  return (
    <div className="skip-links">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <a href="#navigation" className="skip-link">
        Skip to navigation
      </a>
      <a href="#wallet-section" className="skip-link">
        Skip to wallet
      </a>
    </div>
  );
};

export default SkipLinks;
