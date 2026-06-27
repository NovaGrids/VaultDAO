import React from 'react';
import { Plus, Type, Hash, Calendar, List, CheckSquare, MapPin, AlignLeft, MousePointer2, FileUp } from 'lucide-react';
import type { FieldType } from '../../types/formBuilder';

interface FormBuilderControlsProps {
  onAddField: (type: FieldType) => void;
}

const FIELD_TYPES: { type: FieldType; label: string; icon: React.ReactNode; color: string }[] = [
  { type: 'text', label: 'Short Text', icon: <Type size={16}/>, color: 'text-blue-400' },
  { type: 'textarea', label: 'Long Text', icon: <AlignLeft size={16}/>, color: 'text-pink-400' },
  { type: 'number', label: 'Number', icon: <Hash size={16}/>, color: 'text-green-400' },
  { type: 'date', label: 'Date', icon: <Calendar size={16}/>, color: 'text-purple-400' },
  { type: 'address', label: 'Stellar Addr', icon: <MapPin size={16}/>, color: 'text-cyan-400' },
  { type: 'select', label: 'Dropdown', icon: <List size={16}/>, color: 'text-yellow-400' },
  { type: 'radio', label: 'Single Choice', icon: <MousePointer2 size={16}/>, color: 'text-orange-400' },
  { type: 'checkbox', label: 'Checkboxes', icon: <CheckSquare size={16}/>, color: 'text-indigo-400' },
  { type: 'file-upload', label: 'File Upload', icon: <FileUp size={16}/>, color: 'text-red-400' },
];

const FormBuilderControls: React.FC<FormBuilderControlsProps> = ({ onAddField }) => (
  <div className="bg-gray-800/40 rounded-2xl border border-gray-700/50 p-6 backdrop-blur-md">
    <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500 mb-6">Add Elements</h3>
    <div className="grid grid-cols-1 gap-2">
      {FIELD_TYPES.map((field) => (
        <button
          key={field.type}
          onClick={() => onAddField(field.type)}
          className="flex items-center gap-3 p-3 bg-gray-700/30 hover:bg-gray-700 hover:scale-[1.02] active:scale-[0.98] rounded-xl transition-all border border-gray-600/30 group"
        >
          <div className={`p-2 rounded-lg bg-gray-800/50 ${field.color} group-hover:scale-110 transition-transform`}>
            {field.icon}
          </div>
          <span className="text-sm font-semibold text-gray-300 group-hover:text-white transition-colors">{field.label}</span>
          <Plus size={14} className="ml-auto text-gray-600 group-hover:text-gray-400"/>
        </button>
      ))}
    </div>
  </div>
);

export default FormBuilderControls;
