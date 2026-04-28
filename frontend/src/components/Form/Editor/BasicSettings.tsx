import React from 'react';
import type { FormField } from '../../../types/formBuilder';

interface BasicSettingsProps { field: FormField; onUpdate: (u: Partial<FormField>) => void; }

const BasicSettings: React.FC<BasicSettingsProps> = ({ field, onUpdate }) => (
  <div className="space-y-4">
    <InputGroup label="Field Label" value={field.label} onChange={(v) => onUpdate({ label: v })} />
    <InputGroup label="Technical Name" value={field.name} onChange={(v) => onUpdate({ name: v })} />
    <InputGroup label="Placeholder" value={field.placeholder ?? ''} onChange={(v) => onUpdate({ placeholder: v })} />
    
    <div className="grid grid-cols-2 gap-4">
      <Toggle label="Required" checked={field.required} onChange={(v) => onUpdate({ required: v })} />
      <Toggle label="Disabled" checked={field.disabled ?? false} onChange={(v) => onUpdate({ disabled: v })} />
    </div>

    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Field Width</label>
      <div className="grid grid-cols-3 gap-2">
        {(['full', 'half', 'third'] as const).map(w => (
          <button
            key={w}
            onClick={() => onUpdate({ width: w })}
            className={`py-2 text-[10px] font-bold rounded-lg border transition-all ${
              (field.width ?? 'full') === w ? 'bg-purple-600/20 border-purple-500 text-purple-400' : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600'
            }`}
          >
            {w.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  </div>
);

const InputGroup = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <div className="space-y-1.5">
    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">{label}</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
    />
  </div>
);

const Toggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl border border-gray-700/50 cursor-pointer hover:bg-gray-800/50 transition-all">
    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</span>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-purple-500" />
  </label>
);

export default BasicSettings;
