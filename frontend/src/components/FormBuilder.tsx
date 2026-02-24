import React, { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus, Eye, EyeOff, Download, Upload, Save } from 'lucide-react';
import type { FormField, FormConfig } from '../types/formBuilder';
import { validateConditionalLogic } from '../utils/conditionalLogic';
import FormFieldEditor from './FormFieldEditor';
import FormFieldItem from './FormFieldItem';
import FormPreview from './FormPreview';

interface FormBuilderProps {
  initialConfig?: FormConfig;
  onSave?: (config: FormConfig) => void;
  onCancel?: () => void;
}

const FormBuilder: React.FC<FormBuilderProps> = ({ initialConfig, onSave, onCancel }: FormBuilderProps) => {
  const [fields, setFields] = useState<FormField[]>(initialConfig?.fields ?? []);
  const [selectedFieldId, setSelectedFieldId] = useState<string | undefined>();
  const [previewMode, setPreviewMode] = useState(false);
  const [formName, setFormName] = useState(initialConfig?.name ?? '');
  const [formDescription, setFormDescription] = useState(initialConfig?.description ?? '');
  const [isDirty, setIsDirty] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const selectedField = useMemo(
    () => fields.find(f => f.id === selectedFieldId),
    [fields, selectedFieldId]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = fields.findIndex(f => f.id === active.id);
      const newIndex = fields.findIndex(f => f.id === over.id);

      const newFields = arrayMove(fields, oldIndex, newIndex);
      // Update order
      const updatedFields = newFields.map((f: FormField, idx: number) => ({ ...f, order: idx + 1 }));
      setFields(updatedFields);
      setIsDirty(true);
    }
  };

  const addField = useCallback((fieldType: string) => {
    const newField: FormField = {
      id: `field-${Date.now()}`,
      name: `field_${fields.length + 1}`,
      label: `Field ${fields.length + 1}`,
      type: fieldType as FormField['type'],
      required: false,
      validationRules: [],
      order: fields.length + 1,
      width: 'full',
    };

    setFields([...fields, newField]);
    setSelectedFieldId(newField.id);
    setIsDirty(true);
  }, [fields]);

  const updateField = useCallback((fieldId: string, updates: Partial<FormField>): void => {
    setFields(fields.map(f => f.id === fieldId ? { ...f, ...updates } : f));
    setIsDirty(true);
  }, [fields]);

  const deleteField = useCallback((fieldId: string) => {
    setFields(fields.filter(f => f.id !== fieldId));
    if (selectedFieldId === fieldId) {
      setSelectedFieldId(undefined);
    }
    setIsDirty(true);
  }, [fields, selectedFieldId]);

  const duplicateField = useCallback((fieldId: string) => {
    const fieldToDuplicate = fields.find(f => f.id === fieldId);
    if (!fieldToDuplicate) return;

    const newField: FormField = {
      ...fieldToDuplicate,
      id: `field-${Date.now()}`,
      order: fields.length + 1,
    };

    setFields([...fields, newField]);
    setSelectedFieldId(newField.id);
    setIsDirty(true);
  }, [fields]);

  const handleSave = useCallback(() => {
    const validation = validateConditionalLogic(fields);
    if (!validation.valid) {
      alert(`Validation errors:\n${validation.errors.join('\n')}`);
      return;
    }

    const config: FormConfig = {
      id: initialConfig?.id ?? `form-${Date.now()}`,
      name: formName || 'Untitled Form',
      description: formDescription,
      fields,
      createdAt: initialConfig?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      version: (initialConfig?.version ?? 0) + 1,
    };

    onSave?.(config);
  }, [fields, formName, formDescription, initialConfig, onSave]);

  const handleExport = useCallback(() => {
    const config: FormConfig = {
      id: initialConfig?.id ?? `form-${Date.now()}`,
      name: formName || 'Untitled Form',
      description: formDescription,
      fields,
      createdAt: initialConfig?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      version: (initialConfig?.version ?? 0) + 1,
    };

    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${formName || 'form'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [fields, formName, formDescription, initialConfig]);

  const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const config = JSON.parse(json) as FormConfig;
        setFormName(config.name);
        setFormDescription(config.description);
        setFields(config.fields);
        setIsDirty(true);
      } catch {
        alert('Failed to import form. Invalid JSON format.');
      }
    };
    reader.readAsText(file);
  }, []);

  const fieldTypes = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'select', label: 'Select' },
    { value: 'multi-select', label: 'Multi-Select' },
    { value: 'textarea', label: 'Textarea' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'radio', label: 'Radio' },
    { value: 'file-upload', label: 'File Upload' },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <input
              type="text"
              value={formName}
              onChange={(e) => { setFormName(e.target.value); setIsDirty(true); }}
              placeholder="Form Name"
              className="w-full text-2xl font-bold bg-transparent border-b border-gray-700 pb-2 focus:outline-none focus:border-purple-500 mb-2"
            />
            <textarea
              value={formDescription}
              onChange={(e) => { setFormDescription(e.target.value); setIsDirty(true); }}
              placeholder="Form Description"
              className="w-full text-sm bg-transparent border-b border-gray-700 pb-2 focus:outline-none focus:border-purple-500 resize-none"
              rows={2}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setPreviewMode(!previewMode)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors min-h-[44px]"
            >
              {previewMode ? <EyeOff size={18} /> : <Eye size={18} />}
              <span className="hidden sm:inline">{previewMode ? 'Edit' : 'Preview'}</span>
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors min-h-[44px]"
            >
              <Download size={18} />
              <span className="hidden sm:inline">Export</span>
            </button>
            <label className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors cursor-pointer min-h-[44px]">
              <Upload size={18} />
              <span className="hidden sm:inline">Import</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
            </label>
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition-colors min-h-[44px]"
            >
              <Save size={18} />
              <span className="hidden sm:inline">Save</span>
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors min-h-[44px]"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {previewMode ? (
          <FormPreview fields={fields} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Field List */}
            <div className="lg:col-span-2">
              <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4 sm:p-6">
                <h2 className="text-lg font-semibold mb-4">Form Fields</h2>

                {fields.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <p>No fields yet. Add one to get started.</p>
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={fields.map(f => f.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {fields.map((field) => (
                          <FormFieldItem
                            key={field.id}
                            field={field}
                            isSelected={selectedFieldId === field.id}
                            onSelect={() => setSelectedFieldId(field.id)}
                            onDelete={() => deleteField(field.id)}
                            onDuplicate={() => duplicateField(field.id)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            </div>

            {/* Field Editor & Add Field */}
            <div className="space-y-4">
              {/* Add Field */}
              <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4 sm:p-6">
                <h3 className="text-sm font-semibold mb-3 uppercase tracking-wider text-gray-400">Add Field</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
                  {fieldTypes.map((type) => (
                    <button
                      key={type.value}
                      onClick={() => addField(type.value)}
                      className="flex items-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-medium transition-colors min-h-[44px] sm:min-h-[40px]"
                    >
                      <Plus size={14} />
                      <span className="hidden sm:inline">{type.label}</span>
                      <span className="sm:hidden">{type.label.slice(0, 3)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Field Editor */}
              {selectedField ? (
                <FormFieldEditor
                  field={selectedField}
                  onUpdate={(updates: Partial<FormField>) => updateField(selectedFieldId!, updates)}
                />
              ) : (
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4 sm:p-6 text-center text-gray-400">
                  <p className="text-sm">Select a field to edit</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FormBuilder;
