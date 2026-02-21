import React, { useMemo, useState } from 'react';
import {
  getAllTemplates,
  searchTemplates,
  TEMPLATE_CATEGORIES,
  type ProposalTemplate,
  type TemplateCategory,
} from '../../utils/templates';

type CategoryFilter = 'All' | TemplateCategory;

interface ProposalTemplatesProps {
  onUseTemplate?: (template: ProposalTemplate) => void;
  showUseButton?: boolean;
  title?: string;
}

const ProposalTemplates: React.FC<ProposalTemplatesProps> = ({
  onUseTemplate,
  showUseButton = true,
  title = 'Proposal Templates',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('All');

  const templates = useMemo(() => {
    const searched = searchQuery.trim() ? searchTemplates(searchQuery) : getAllTemplates();
    if (selectedCategory === 'All') {
      return searched;
    }
    return searched.filter((template) => template.category === selectedCategory);
  }, [searchQuery, selectedCategory]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xl font-semibold">{title}</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates"
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none sm:w-56"
          />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as CategoryFilter)}
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none sm:w-44"
          >
            <option value="All">All Categories</option>
            {TEMPLATE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-6 text-sm text-gray-400">
          No templates match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <article
              key={template.id}
              className="flex h-full flex-col rounded-xl border border-gray-700 bg-gray-800 p-4"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <h4 className="text-base font-semibold text-white">{template.name}</h4>
                <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-xs text-purple-300">
                  {template.category}
                </span>
              </div>
              <p className="mb-4 text-sm text-gray-300 line-clamp-2">{template.description}</p>
              {showUseButton && onUseTemplate && (
                <button
                  type="button"
                  onClick={() => onUseTemplate(template)}
                  className="mt-auto min-h-[44px] rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
                >
                  Use Template
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProposalTemplates;