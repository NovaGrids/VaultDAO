import { useState } from 'react';
import { getAllTemplates, getTemplatesByCategory, searchTemplates, stroopsToXLM, type VaultTemplate } from '../utils/vaultTemplates';

interface TemplateMarketplaceProps {
    onSelectTemplate: (template: VaultTemplate) => void;
    onClose: () => void;
}

export default function TemplateMarketplace({ onSelectTemplate, onClose }: TemplateMarketplaceProps) {
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState<VaultTemplate | null>(null);

    const categories = ['All', 'DAO', 'Payroll', 'Investment', 'Business', 'Custom'];

    const getFilteredTemplates = () => {
        if (searchQuery) {
            return searchTemplates(searchQuery);
        }
        if (selectedCategory === 'All') {
            return getAllTemplates();
        }
        return getTemplatesByCategory(selectedCategory);
    };

    const templates = getFilteredTemplates();

    const handleUseTemplate = (template: VaultTemplate) => {
        onSelectTemplate(template);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-6xl max-h-[90vh] rounded-xl border border-gray-700 bg-gray-900 overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-gray-700">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-bold text-white">Template Marketplace</h2>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white transition-colors"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* Search and Filter */}
                    <div className="flex flex-col sm:flex-row gap-3">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search templates..."
                            className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                        />
                        <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
                            {categories.map((category) => (
                                <button
                                    key={category}
                                    onClick={() => setSelectedCategory(category)}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${selectedCategory === category
                                            ? 'bg-purple-600 text-white'
                                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                        }`}
                                >
                                    {category}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Templates Grid */}
                <div className="flex-1 overflow-y-auto p-6">
                    {templates.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-gray-400">No templates found</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {templates.map((template) => (
                                <div
                                    key={template.id}
                                    onClick={() => setSelectedTemplate(template)}
                                    className={`cursor-pointer rounded-lg border p-4 transition-all hover:border-purple-500 ${selectedTemplate?.id === template.id
                                            ? 'border-purple-500 bg-purple-500/10'
                                            : 'border-gray-700 bg-gray-800/50'
                                        }`}
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-3xl">{template.icon}</span>
                                            <div>
                                                <h3 className="font-semibold text-white">{template.name}</h3>
                                                <span className="text-xs text-gray-400">{template.category}</span>
                                            </div>
                                        </div>
                                        {template.recommended && (
                                            <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">
                                                Recommended
                                            </span>
                                        )}
                                    </div>

                                    <p className="text-sm text-gray-400 mb-3 line-clamp-2">{template.description}</p>

                                    <div className="space-y-2 text-xs">
                                        <div className="flex justify-between text-gray-500">
                                            <span>Threshold:</span>
                                            <span className="text-gray-300">{template.config.threshold} signatures</span>
                                        </div>
                                        <div className="flex justify-between text-gray-500">
                                            <span>Spending Limit:</span>
                                            <span className="text-gray-300">{stroopsToXLM(template.config.spendingLimit)} XLM</span>
                                        </div>
                                        <div className="flex justify-between text-gray-500">
                                            <span>Daily Limit:</span>
                                            <span className="text-gray-300">{stroopsToXLM(template.config.dailyLimit)} XLM</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Template Preview */}
                {selectedTemplate && (
                    <div className="border-t border-gray-700 p-6 bg-gray-800/50">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-white mb-2">{selectedTemplate.name}</h3>
                                <ul className="space-y-1">
                                    {selectedTemplate.features.map((feature, index) => (
                                        <li key={index} className="text-sm text-gray-400 flex items-center gap-2">
                                            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                            {feature}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <button
                                onClick={() => handleUseTemplate(selectedTemplate)}
                                className="w-full sm:w-auto min-h-[44px] px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
                            >
                                Use This Template
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
