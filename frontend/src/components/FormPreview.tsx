import React from 'react';
import type { FormField } from '../types/formBuilder';
import FormRenderer from './FormRenderer';

interface FormPreviewProps {
  fields: FormField[];
  onPreviewSubmit?: (data: unknown) => void;
}

const FormPreview: React.FC<FormPreviewProps> = ({ fields, onPreviewSubmit }) => {
  const config = {
    id: 'preview',
    name: 'Live Preview',
    description: 'This is a preview of how your form will look to users.',
    fields,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
  };

  return (
    <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/50 shadow-2xl p-6 sm:p-8 animate-in zoom-in-95 duration-300">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Live Preview</h2>
          <p className="text-gray-400 text-sm mt-1">{config.description}</p>
        </div>
        <div className="px-3 py-1 bg-purple-500/10 text-purple-400 text-xs font-bold rounded-full border border-purple-500/20 uppercase tracking-widest">
          Draft
        </div>
      </div>

      <FormRenderer
        config={config}
        onSubmit={(data) => {
          console.log('Preview form submitted:', data);
          onPreviewSubmit?.(data);
          alert('Form submitted successfully (Preview Mode)');
        }}
        submitButtonText="Submit Proposal"
      />

      <div className="mt-8 pt-6 border-t border-gray-800">
        <p className="text-center text-xs text-gray-500 italic">
          This is a sandboxed preview. Real submissions will be stored in the vault.
        </p>
      </div>
    </div>
  );
};

export default FormPreview;
