import React, { useState, useCallback, useMemo } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { FormField, FormConfig, FieldType } from '../types/formBuilder';
import { validateConditionalLogic } from '../utils/conditionalLogic';
import FormBuilderHeader from './Form/FormBuilderHeader';
import FormBuilderControls from './Form/FormBuilderControls';
import FormFieldEditor from './FormFieldEditor';
import FormFieldItem from './FormFieldItem';
import FormPreview from './FormPreview';

interface FormBuilderProps { initialConfig?: FormConfig; onSave?: (config: FormConfig) => void; onCancel?: () => void; }

const FormBuilder: React.FC<FormBuilderProps> = ({ initialConfig, onSave, onCancel }) => {
  const [fields, setFields] = useState<FormField[]>(initialConfig?.fields ?? []);
  const [selectedFieldId, setSelectedFieldId] = useState<string | undefined>();
  const [previewMode, setPreviewMode] = useState(false);
  const [formName, setFormName] = useState(initialConfig?.name ?? '');
  const [formDescription, setFormDescription] = useState(initialConfig?.description ?? '');
  const [isDirty, setIsDirty] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const selectedField = useMemo(() => fields.find(f => f.id === selectedFieldId), [fields, selectedFieldId]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = fields.findIndex(f => f.id === active.id), newIndex = fields.findIndex(f => f.id === over.id);
      setFields(arrayMove(fields, oldIndex, newIndex).map((f, i) => ({ ...f, order: i + 1 })));
      setIsDirty(true);
    }
  };

  const addField = useCallback((type: FieldType) => {
    const id = `f-${Date.now()}`;
    const newField: FormField = { id, name: id, label: `New ${type} Field`, type, required: false, validationRules: [], order: fields.length + 1, width: 'full' };
    setFields([...fields, newField]); setSelectedFieldId(id); setIsDirty(true);
  }, [fields]);

  const updateField = (id: string, upd: Partial<FormField>) => { setFields(fields.map(f => f.id === id ? { ...f, ...upd } : f)); setIsDirty(true); };
  const deleteField = (id: string) => { setFields(fields.filter(f => f.id !== id)); if (selectedFieldId === id) setSelectedFieldId(undefined); setIsDirty(true); };
  const duplicateField = (id: string) => { const f = fields.find(x => x.id === id); if (f) addField(f.type); };

  const onSaveClick = () => {
    if (!validateConditionalLogic(fields).valid) return alert('Circular dependencies in logic!');
    onSave?.({ id: initialConfig?.id ?? `form-${Date.now()}`, name: formName || 'Untitled', description: formDescription, fields, createdAt: initialConfig?.createdAt ?? Date.now(), updatedAt: Date.now(), version: (initialConfig?.version ?? 0) + 1 });
  };

  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = (ev) => {
      const c = JSON.parse(ev.target?.result as string) as FormConfig;
      setFormName(c.name); setFormDescription(c.description); setFields(c.fields); setIsDirty(true);
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white selection:bg-purple-500/30">
      <div className="max-w-7xl mx-auto p-4 sm:p-8">
        <FormBuilderHeader name={formName} description={formDescription} onNameChange={setFormName} onDescChange={setFormDescription} previewMode={previewMode} onTogglePreview={() => setPreviewMode(!previewMode)} onExport={() => {}} onImport={onImport} onSave={onSaveClick} isDirty={isDirty} onCancel={onCancel} />
        {previewMode ? <FormPreview fields={fields} /> : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-8 bg-gray-900/40 rounded-3xl border border-gray-800 p-8 min-h-[600px] shadow-2xl">
              <h2 className="text-xl font-bold mb-8 flex items-center gap-3">Structure <span className="text-xs bg-gray-800 text-gray-500 px-2 py-1 rounded-full font-mono">{fields.length}</span></h2>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-4">{fields.map(f => <FormFieldItem key={f.id} field={f} isSelected={selectedFieldId === f.id} onSelect={() => setSelectedFieldId(f.id)} onDelete={() => deleteField(f.id)} onDuplicate={() => duplicateField(f.id)} />)}</div>
                </SortableContext>
              </DndContext>
            </div>
            <div className="lg:col-span-4 space-y-6">
              <FormBuilderControls onAddField={addField} />
              {selectedField ? <FormFieldEditor field={selectedField} onUpdate={(u) => updateField(selectedFieldId!, u)} /> : <div className="p-12 text-center bg-gray-900/20 rounded-2xl border border-gray-800 border-dashed text-gray-600 text-sm">Select a field to customize</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FormBuilder;
