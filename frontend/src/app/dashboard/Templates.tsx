import React from 'react';
import ProposalTemplates from '../../components/proposals/ProposalTemplates';
import TemplateManager from '../../components/TemplateManager';

const Templates: React.FC = () => {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">Templates</h2>
      <div className="rounded-xl border border-gray-700 bg-gray-800 p-4 sm:p-6">
        <ProposalTemplates showUseButton={false} title="Browse Templates" />
      </div>
      <div className="rounded-xl border border-gray-700 bg-gray-800 p-4 sm:p-6">
        <TemplateManager />
      </div>
    </div>
  );
};

export default Templates;
