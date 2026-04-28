import React, { useMemo } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import type { FormField, FormSubmissionData, FormConfig } from '../types/formBuilder';
import { calculateFieldVisibility, calculateFieldDisabledState, calculateFieldRequiredState } from '../utils/conditionalLogic';
import FormFieldRenderer from './Form/FormFieldRenderer';

interface FormRendererProps {
  config: FormConfig;
  onSubmit: (data: FormSubmissionData) => void | Promise<void>;
  loading?: boolean;
  submitButtonText?: string;
}

const FormRenderer: React.FC<FormRendererProps> = ({ config, onSubmit, loading = false, submitButtonText = 'Submit' }) => {
  const methods = useForm<FormSubmissionData>({ mode: 'onChange' });
  const { handleSubmit, watch, formState: { errors } } = methods;
  const formData = watch();

  const visibility = useMemo(() => calculateFieldVisibility(config.fields, formData), [config.fields, formData]);
  const disabled = useMemo(() => calculateFieldDisabledState(config.fields, formData), [config.fields, formData]);
  const required = useMemo(() => calculateFieldRequiredState(config.fields, formData), [config.fields, formData]);

  const renderFieldGroup = (fields: FormField[], gridCols = 1) => (
    <div className={`grid grid-cols-1 ${gridCols > 1 ? `sm:grid-cols-${gridCols}` : ''} gap-6`}>
      {fields.map((field) => visibility[field.id] && (
        <div key={field.id} className="space-y-2">
          <label className="block text-sm font-semibold text-gray-300">
            {field.label}
            {required[field.id] && <span className="text-red-400 ml-1">*</span>}
          </label>
          <FormFieldRenderer field={field} isDisabled={disabled[field.id] || loading} isRequired={required[field.id]} />
          {errors[field.id] && <p className="text-xs text-red-400 mt-1 animate-in fade-in slide-in-from-top-1">{String(errors[field.id]?.message)}</p>}
          {field.helpText && <p className="text-xs text-gray-500 mt-1">{field.helpText}</p>}
        </div>
      ))}
    </div>
  );

  const sorted = [...config.fields].sort((a, b) => a.order - b.order);
  const groups = {
    full: sorted.filter(f => (f.width ?? 'full') === 'full'),
    half: sorted.filter(f => f.width === 'half'),
    third: sorted.filter(f => f.width === 'third'),
  };

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 animate-in fade-in duration-500">
        {renderFieldGroup(groups.full)}
        {groups.half.length > 0 && renderFieldGroup(groups.half, 2)}
        {groups.third.length > 0 && renderFieldGroup(groups.third, 3)}
        
        <button
          type="submit"
          disabled={loading}
          className="w-full h-12 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all shadow-lg shadow-purple-500/20 active:scale-[0.98]"
        >
          {loading ? <div className="flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Processing...</div> : submitButtonText}
        </button>
      </form>
    </FormProvider>
  );
};

export default FormRenderer;
