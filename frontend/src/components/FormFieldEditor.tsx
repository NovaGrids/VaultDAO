import { useState, type FC } from 'react';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import type { FormField, ValidationRule, FormFieldOption } from '../types/formBuilder';

interface FormFieldEditorProps {
  field: FormField;
  onUpdate: (updates: Partial<FormField>) => void;
}

const FormFieldEditor: FC<FormFieldEditorProps> = ({ field, onUpdate }: FormFieldEditorProps) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    validation: true,
    conditional: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const addValidationRule = () => {
    const newRule: ValidationRule = {
      id: `rule-${Date.now()}`,
      type: 'required',
      message: 'This field is required',
    };
    onUpdate({
      validationRules: [...field.validationRules, newRule],
    });
  };

  const updateValidationRule = (ruleId: string, updates: Partial<ValidationRule>) => {
    onUpdate({
      validationRules: field.validationRules.map(r =>
        r.id === ruleId ? { ...r, ...updates } : r
      ),
    });
  };

  const deleteValidationRule = (ruleId: string) => {
    onUpdate({
      validationRules: field.validationRules.filter(r => r.id !== ruleId),
    });
  };

  const addFieldOption = () => {
    const newOption: FormFieldOption = {
      value: `option-${Date.now()}`,
      label: 'New Option',
    };
    onUpdate({
      options: [...(field.options ?? []), newOption],
    });
  };

  const updateFieldOption = (index: number, updates: Partial<FormFieldOption>) => {
    const options = [...(field.options ?? [])];
    options[index] = { ...options[index], ...updates };
    onUpdate({ options });
  };

  const deleteFieldOption = (index: number) => {
    const options = field.options?.filter((_, i) => i !== index) ?? [];
    onUpdate({ options });
  };

  const needsOptions = ['select', 'multi-select', 'radio'].includes(field.type);

  return (
    <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4 sm:p-6 space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
      {/* Basic Settings */}
      <div className="border border-gray-700 rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('basic')}
          className="w-full flex items-center justify-between p-3 bg-gray-700/50 hover:bg-gray-700 transition-colors"
          type="button"
        >
          <span className="font-medium text-sm">Basic Settings</span>
          <ChevronDown size={16} className={`transition-transform ${expandedSections.basic ? 'rotate-180' : ''}`} />
        </button>

        {expandedSections.basic && (
          <div className="p-4 space-y-3 bg-gray-800/30">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Label</label>
              <input
                type="text"
                value={field.label}
                onChange={(e) => onUpdate({ label: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Field Name</label>
              <input
                type="text"
                value={field.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Placeholder</label>
              <input
                type="text"
                value={field.placeholder ?? ''}
                onChange={(e) => onUpdate({ placeholder: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Description</label>
              <textarea
                value={field.description ?? ''}
                onChange={(e) => onUpdate({ description: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-purple-500 resize-none"
                rows={2}
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => onUpdate({ required: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-300">Required</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.disabled ?? false}
                  onChange={(e) => onUpdate({ disabled: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-300">Disabled</span>
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Width</label>
              <select
                value={field.width ?? 'full'}
                onChange={(e) => onUpdate({ width: e.target.value as 'full' | 'half' | 'third' })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-purple-500"
              >
                <option value="full">Full Width</option>
                <option value="half">Half Width</option>
                <option value="third">Third Width</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Field Options (for select, multi-select, radio) */}
      {needsOptions && (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('options')}
            className="w-full flex items-center justify-between p-3 bg-gray-700/50 hover:bg-gray-700 transition-colors"
            type="button"
          >
            <span className="font-medium text-sm">Options</span>
            <ChevronDown size={16} className={`transition-transform ${expandedSections.options ? 'rotate-180' : ''}`} />
          </button>

          {expandedSections.options && (
            <div className="p-4 space-y-3 bg-gray-800/30">
              {field.options?.map((option, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    value={option.value}
                    onChange={(e) => updateFieldOption(idx, { value: e.target.value })}
                    placeholder="Value"
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-purple-500"
                  />
                  <input
                    type="text"
                    value={option.label}
                    onChange={(e) => updateFieldOption(idx, { label: e.target.value })}
                    placeholder="Label"
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-purple-500"
                  />
                  <button
                    onClick={() => deleteFieldOption(idx)}
                    className="p-2 hover:bg-red-500/20 rounded transition-colors text-gray-400 hover:text-red-400"
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}

              <button
                onClick={addFieldOption}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors"
                type="button"
              >
                <Plus size={16} />
                Add Option
              </button>
            </div>
          )}
        </div>
      )}

      {/* Validation Rules */}
      <div className="border border-gray-700 rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('validation')}
          className="w-full flex items-center justify-between p-3 bg-gray-700/50 hover:bg-gray-700 transition-colors"
          type="button"
        >
          <span className="font-medium text-sm">Validation Rules ({field.validationRules.length})</span>
          <ChevronDown size={16} className={`transition-transform ${expandedSections.validation ? 'rotate-180' : ''}`} />
        </button>

        {expandedSections.validation && (
          <div className="p-4 space-y-3 bg-gray-800/30">
            {field.validationRules.map((rule) => (
              <div key={rule.id} className="p-3 bg-gray-700/30 rounded border border-gray-600/50 space-y-2">
                <div className="flex items-center justify-between">
                  <select
                    value={rule.type}
                    onChange={(e) => updateValidationRule(rule.id, { type: e.target.value as ValidationRule['type'] })}
                    className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="required">Required</option>
                    <option value="email">Email</option>
                    <option value="url">URL</option>
                    <option value="min">Min Value</option>
                    <option value="max">Max Value</option>
                    <option value="minLength">Min Length</option>
                    <option value="maxLength">Max Length</option>
                    <option value="regex">Regex</option>
                  </select>
                  <button
                    onClick={() => deleteValidationRule(rule.id)}
                    className="p-1 hover:bg-red-500/20 rounded transition-colors text-gray-400 hover:text-red-400 ml-2"
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {['min', 'max', 'minLength', 'maxLength', 'regex'].includes(rule.type) && (
                  <input
                    type="text"
                    value={String(rule.value ?? '')}
                    onChange={(e) => updateValidationRule(rule.id, { value: e.target.value })}
                    placeholder="Value"
                    className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white focus:outline-none focus:border-purple-500"
                  />
                )}

                <input
                  type="text"
                  value={rule.message}
                  onChange={(e) => updateValidationRule(rule.id, { message: e.target.value })}
                  placeholder="Error message"
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            ))}

            <button
              onClick={addValidationRule}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors"
              type="button"
            >
              <Plus size={16} />
              Add Rule
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FormFieldEditor;
