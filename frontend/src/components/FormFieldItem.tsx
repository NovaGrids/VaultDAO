import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Copy } from 'lucide-react';
import type { FormField } from '../types/formBuilder';

interface FormFieldItemProps {
  field: FormField;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

const FormFieldItem: React.FC<FormFieldItemProps> = ({
  field,
  isSelected,
  onSelect,
  onDelete,
  onDuplicate,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const fieldTypeColors: Record<string, string> = {
    text: 'bg-blue-500/20 text-blue-400',
    number: 'bg-green-500/20 text-green-400',
    date: 'bg-purple-500/20 text-purple-400',
    select: 'bg-yellow-500/20 text-yellow-400',
    'multi-select': 'bg-orange-500/20 text-orange-400',
    textarea: 'bg-pink-500/20 text-pink-400',
    checkbox: 'bg-indigo-500/20 text-indigo-400',
    radio: 'bg-cyan-500/20 text-cyan-400',
    'file-upload': 'bg-red-500/20 text-red-400',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`p-3 rounded-lg border transition-all cursor-pointer group ${
        isSelected
          ? 'bg-purple-500/20 border-purple-500/50'
          : 'bg-gray-700/30 border-gray-600/50 hover:border-gray-500/50'
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          {...attributes}
          {...listeners}
          className="p-1 text-gray-500 hover:text-gray-300 cursor-grab active:cursor-grabbing"
          type="button"
        >
          <GripVertical size={16} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium text-white truncate">{field.label}</h4>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${fieldTypeColors[field.type] || 'bg-gray-500/20 text-gray-400'}`}>
              {field.type}
            </span>
            {field.required && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">
                Required
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 truncate">{field.name}</p>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="p-1.5 hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-white"
            type="button"
            title="Duplicate field"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 hover:bg-red-500/20 rounded transition-colors text-gray-400 hover:text-red-400"
            type="button"
            title="Delete field"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default FormFieldItem;
