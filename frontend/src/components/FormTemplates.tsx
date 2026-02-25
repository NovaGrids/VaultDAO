import React, { useState, useMemo } from 'react';
import { Copy, Trash2, Download, Upload } from 'lucide-react';
import type { FormTemplate } from '../types/formBuilder';
import {
  getAllTemplates,
  deleteCustomTemplate,
  exportTemplateAsJSON,
  importTemplateFromJSON,
  saveCustomTemplate,
} from '../utils/formTemplates';

interface FormTemplatesProps {
  onSelectTemplate?: (template: FormTemplate) => void;
}

const FormTemplates: React.FC<FormTemplatesProps> = ({ onSelectTemplate }: FormTemplatesProps) => {
  const [templates, setTemplates] = useState<FormTemplate[]>(getAllTemplates());
  const [filterCategory, setFilterCategory] = useState<'all' | 'standard' | 'payroll' | 'invoice' | 'custom'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTemplates = useMemo(() => {
    return templates.filter(t => {
      const matchesCategory = filterCategory === 'all' || t.category === filterCategory;
      const matchesSearch = !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [templates, filterCategory, searchQuery]);

  const handleDeleteTemplate = (id: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      deleteCustomTemplate(id);
      setTemplates(getAllTemplates());
    }
  };

  const handleExportTemplate = (template: FormTemplate) => {
    const json = exportTemplateAsJSON(template);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.name}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTemplate = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const template = importTemplateFromJSON(json);
        if (template) {
          template.id = `template-${Date.now()}`;
          template.isPublic = false;
          saveCustomTemplate(template);
          setTemplates(getAllTemplates());
          alert('Template imported successfully!');
        } else {
          alert('Invalid template format');
        }
      } catch (error) {
        alert('Failed to import template');
      }
    };
    reader.readAsText(file);
  };

  const handleDuplicateTemplate = (template: FormTemplate) => {
    const newTemplate: FormTemplate = {
      ...template,
      id: `template-${Date.now()}`,
      name: `${template.name} (Copy)`,
      isPublic: false,
    };
    saveCustomTemplate(newTemplate);
    setTemplates(getAllTemplates());
  };

  const categoryOptions = [
    { value: 'all', label: 'All Templates' },
    { value: 'standard', label: 'Standard' },
    { value: 'payroll', label: 'Payroll' },
    { value: 'invoice', label: 'Invoice' },
    { value: 'custom', label: 'Custom' },
  ];

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      standard: 'bg-blue-500/20 text-blue-400',
      payroll: 'bg-green-500/20 text-green-400',
      invoice: 'bg-purple-500/20 text-purple-400',
      custom: 'bg-orange-500/20 text-orange-400',
    };
    return colors[category] || 'bg-gray-500/20 text-gray-400';
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Form Templates</h1>
          <p className="text-gray-400">Choose a template to get started or create your own</p>
        </div>

        {/* Controls */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1 flex flex-col gap-3 sm:flex-row sm:gap-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value as any)}
              className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
            >
              {categoryOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors cursor-pointer font-medium min-h-[44px]">
            <Upload size={18} />
            <span className="hidden sm:inline">Import</span>
            <input
              type="file"
              accept=".json"
              onChange={handleImportTemplate}
              className="hidden"
            />
          </label>
        </div>

        {/* Templates Grid */}
        {filteredTemplates.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 sm:p-6 hover:border-purple-500/50 transition-all group"
              >
                <div className="mb-4">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-lg font-semibold text-white flex-1">{template.name}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ml-2 ${getCategoryColor(template.category)}`}>
                      {template.category}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 line-clamp-2">{template.description}</p>
                </div>

                <div className="mb-4 p-3 bg-gray-700/30 rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Fields: <span className="text-white font-medium">{template.fields.length}</span></p>
                  <div className="flex flex-wrap gap-1">
                    {template.fields.slice(0, 3).map((field) => (
                      <span key={field.id} className="px-2 py-0.5 bg-gray-600/50 rounded text-xs text-gray-300">
                        {field.type}
                      </span>
                    ))}
                    {template.fields.length > 3 && (
                      <span className="px-2 py-0.5 bg-gray-600/50 rounded text-xs text-gray-300">
                        +{template.fields.length - 3}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => onSelectTemplate?.(template)}
                    className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors min-h-[44px] sm:min-h-[40px]"
                  >
                    Use Template
                  </button>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDuplicateTemplate(template)}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-sm min-h-[44px] sm:min-h-[40px]"
                      title="Duplicate template"
                    >
                      <Copy size={16} />
                      <span className="hidden sm:inline">Copy</span>
                    </button>

                    <button
                      onClick={() => handleExportTemplate(template)}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-sm min-h-[44px] sm:min-h-[40px]"
                      title="Export template"
                    >
                      <Download size={16} />
                      <span className="hidden sm:inline">Export</span>
                    </button>

                    {!template.isPublic && (
                      <button
                        onClick={() => handleDeleteTemplate(template.id)}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors text-sm min-h-[44px] sm:min-h-[40px]"
                        title="Delete template"
                      >
                        <Trash2 size={16} />
                        <span className="hidden sm:inline">Delete</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-gray-800/30 rounded-xl border border-gray-700">
            <p className="text-gray-400 mb-4">No templates found</p>
            <button
              onClick={() => setSearchQuery('')}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FormTemplates;
