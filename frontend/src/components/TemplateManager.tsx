import React from 'react';
import TemplateMarketplace from './TemplateMarketplace';

export function TemplateManager() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-white mb-6">Template Manager</h1>
      <TemplateMarketplace />
    </div>
  );
}

export default TemplateManager;
