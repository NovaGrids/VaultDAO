import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { FormField } from '../types/formBuilder';
import BasicSettings from './Form/Editor/BasicSettings';
import OptionsSettings from './Form/Editor/OptionsSettings';
import ValidationSettings from './Form/Editor/ValidationSettings';

interface FormFieldEditorProps { field: FormField; onUpdate: (updates: Partial<FormField>) => void; }

const FormFieldEditor: React.FC<FormFieldEditorProps> = ({ field, onUpdate }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ basic: true, options: true, validation: true });
  const toggle = (s: string) => setExpanded(p => ({ ...p, [s]: !p[s] }));

  const Section = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => (
    <div className="bg-gray-900/60 rounded-2xl border border-gray-800 overflow-hidden shadow-sm">
      <button onClick={() => toggle(id)} className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors">
        <span className="text-xs font-black uppercase tracking-widest text-gray-400">{label}</span>
        <ChevronDown size={16} className={`text-gray-500 transition-transform duration-300 ${expanded[id] ? 'rotate-180' : ''}`} />
      </button>
      {expanded[id] && <div className="p-4 pt-0 border-t border-gray-800/50 animate-in slide-in-from-top-2 duration-200">{children}</div>}
    </div>
  );

  return (
    <div className="space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto pr-2 custom-scrollbar">
      <Section id="basic" label="Identity & Layout">
        <BasicSettings field={field} onUpdate={onUpdate} />
      </Section>
      {['select', 'multi-select', 'radio'].includes(field.type) && (
        <Section id="options" label="Data Options">
          <OptionsSettings field={field} onUpdate={onUpdate} />
        </Section>
      )}
      <Section id="validation" label="Rules & Logic">
        <ValidationSettings field={field} onUpdate={onUpdate} />
      </Section>
    </div>
  );
};

export default FormFieldEditor;
