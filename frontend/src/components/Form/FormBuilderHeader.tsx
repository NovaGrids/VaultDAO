import React from 'react';
import { Eye, EyeOff, Download, Upload, Save, X } from 'lucide-react';

interface FormBuilderHeaderProps {
  name: string;
  description: string;
  onNameChange: (val: string) => void;
  onDescChange: (val: string) => void;
  previewMode: boolean;
  onTogglePreview: () => void;
  onExport: () => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  isDirty: boolean;
  onCancel?: () => void;
}

const FormBuilderHeader: React.FC<FormBuilderHeaderProps> = ({
  name, description, onNameChange, onDescChange, previewMode, onTogglePreview, 
  onExport, onImport, onSave, isDirty, onCancel
}) => (
  <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between p-6 bg-gray-800/40 rounded-2xl border border-gray-700/50 backdrop-blur-md">
    <div className="flex-1 space-y-3">
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Form Name"
        className="w-full text-3xl font-black bg-transparent border-none p-0 focus:ring-0 placeholder-gray-600"
      />
      <textarea
        value={description}
        onChange={(e) => onDescChange(e.target.value)}
        placeholder="Describe the purpose of this form..."
        className="w-full text-sm text-gray-400 bg-transparent border-none p-0 focus:ring-0 resize-none h-10"
      />
    </div>
    <div className="flex flex-wrap gap-2 shrink-0">
      <HeaderButton onClick={onTogglePreview} icon={previewMode ? <EyeOff size={18}/> : <Eye size={18}/>} text={previewMode ? 'Edit' : 'Preview'} />
      <HeaderButton onClick={onExport} icon={<Download size={18}/>} text="Export" />
      <label className="flex items-center gap-2 px-4 py-2 bg-gray-700/50 hover:bg-gray-700 rounded-xl transition-all cursor-pointer border border-gray-600/50 hover:border-purple-500/50">
        <Upload size={18}/> <span className="text-sm font-medium">Import</span>
        <input type="file" accept=".json" onChange={onImport} className="hidden" />
      </label>
      <button 
        onClick={onSave} 
        disabled={!isDirty} 
        className="flex items-center gap-2 px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-800 disabled:text-gray-600 rounded-xl transition-all font-bold shadow-lg shadow-purple-500/20"
      >
        <Save size={18}/> Save
      </button>
      {onCancel && (
        <button onClick={onCancel} className="p-2 bg-gray-800 hover:bg-red-500/20 hover:text-red-400 rounded-xl transition-all border border-gray-700">
          <X size={20}/>
        </button>
      )}
    </div>
  </div>
);

const HeaderButton = ({ onClick, icon, text }: { onClick: () => void, icon: React.ReactNode, text: string }) => (
  <button onClick={onClick} className="flex items-center gap-2 px-4 py-2 bg-gray-700/50 hover:bg-gray-700 rounded-xl transition-all border border-gray-600/50 hover:border-purple-500/50 text-sm font-medium">
    {icon} {text}
  </button>
);

export default FormBuilderHeader;
