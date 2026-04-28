import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { FormField, FormFieldOption } from '../../../types/formBuilder';

interface OptionsSettingsProps { field: FormField; onUpdate: (u: Partial<FormField>) => void; }

const OptionsSettings: React.FC<OptionsSettingsProps> = ({ field, onUpdate }) => {
  const options = field.options ?? [];

  const add = () => onUpdate({ options: [...options, { value: `opt-${Date.now()}`, label: 'New Option' }] });
  const upd = (idx: number, u: Partial<FormFieldOption>) => {
    const next = [...options]; next[idx] = { ...next[idx], ...u };
    onUpdate({ options: next });
  };
  const del = (idx: number) => onUpdate({ options: options.filter((_, i) => i !== idx) });

  return (
    <div className="space-y-3">
      {options.map((opt, i) => (
        <div key={i} className="flex gap-2 group animate-in slide-in-from-right-2 duration-200">
          <input
            type="text"
            value={opt.label}
            onChange={(e) => upd(i, { label: e.target.value, value: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
            placeholder="Label"
            className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-purple-500 transition-all"
          />
          <button onClick={() => del(i)} className="p-2 bg-gray-800/50 hover:bg-red-500/10 text-gray-500 hover:text-red-400 rounded-lg border border-gray-700/50 transition-all">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="w-full flex items-center justify-center gap-2 py-3 bg-gray-800/20 hover:bg-gray-800/50 text-purple-400 border border-dashed border-gray-700 rounded-xl transition-all text-xs font-bold"
      >
        <Plus size={14} /> Add Option
      </button>
    </div>
  );
};

export default OptionsSettings;
