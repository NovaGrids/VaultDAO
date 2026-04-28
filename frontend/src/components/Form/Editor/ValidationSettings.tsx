import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { FormField, ValidationRule, ValidationRuleType } from '../../../types/formBuilder';

interface ValidationSettingsProps { field: FormField; onUpdate: (u: Partial<FormField>) => void; }

const ValidationSettings: React.FC<ValidationSettingsProps> = ({ field, onUpdate }) => {
  const rules = field.validationRules ?? [];

  const add = () => onUpdate({ validationRules: [...rules, { id: `r-${Date.now()}`, type: 'required', message: 'Required field' }] });
  const upd = (id: string, u: Partial<ValidationRule>) => onUpdate({ validationRules: rules.map(r => r.id === id ? { ...r, ...u } : r) });
  const del = (id: string) => onUpdate({ validationRules: rules.filter(r => r.id !== id) });

  return (
    <div className="space-y-4">
      {rules.map((rule) => (
        <div key={rule.id} className="p-4 bg-gray-800/30 border border-gray-700/50 rounded-2xl space-y-3 animate-in fade-in duration-300">
          <div className="flex items-center justify-between gap-3">
            <select
              value={rule.type}
              onChange={(e) => upd(rule.id, { type: e.target.value as ValidationRuleType })}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-[10px] font-bold text-gray-300 uppercase tracking-widest focus:ring-1 focus:ring-purple-500 outline-none"
            >
              {['required', 'email', 'url', 'min', 'max', 'minLength', 'maxLength', 'regex'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={() => del(rule.id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"><Trash2 size={14}/></button>
          </div>

          {['min', 'max', 'minLength', 'maxLength', 'regex'].includes(rule.type) && (
            <input
              type="text"
              value={String(rule.value ?? '')}
              onChange={(e) => upd(rule.id, { value: e.target.value })}
              placeholder="Comparison Value"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 outline-none"
            />
          )}

          <input
            type="text"
            value={rule.message}
            onChange={(e) => upd(rule.id, { message: e.target.value })}
            placeholder="Error Message"
            className="w-full bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-2 text-[11px] text-gray-400 italic outline-none"
          />
        </div>
      ))}
      <button onClick={add} className="w-full py-3 bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 rounded-xl border border-purple-500/20 transition-all text-xs font-bold flex items-center justify-center gap-2">
        <Plus size={14}/> Add Rule
      </button>
    </div>
  );
};

export default ValidationSettings;
