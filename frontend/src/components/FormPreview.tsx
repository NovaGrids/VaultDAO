import React, { useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import type { FormField, FormSubmissionData } from '../types/formBuilder';
import { validateField } from '../utils/formValidation';
import { calculateFieldVisibility, calculateFieldDisabledState, calculateFieldRequiredState } from '../utils/conditionalLogic';

interface FormPreviewProps {
  fields: FormField[];
  onSubmit?: (data: FormSubmissionData) => void;
}

const FormPreview: React.FC<FormPreviewProps> = ({ fields, onSubmit }: FormPreviewProps) => {
  const { control, watch, handleSubmit, formState: { errors } } = useForm<FormSubmissionData>({
    mode: 'onChange',
  });

  const formData = watch();

  const fieldVisibility = useMemo(
    () => calculateFieldVisibility(fields, formData),
    [fields, formData]
  );

  const fieldDisabledState = useMemo(
    () => calculateFieldDisabledState(fields, formData),
    [fields, formData]
  );

  const fieldRequiredState = useMemo(
    () => calculateFieldRequiredState(fields, formData),
    [fields, formData]
  );

  const sortedFields = [...fields].sort((a, b) => a.order - b.order);

  const getFieldsByWidth = (width: string | undefined) => {
    return sortedFields.filter(f => (f.width ?? 'full') === width && fieldVisibility[f.id]);
  };

  const renderField = (field: FormField) => {
    const isDisabled = fieldDisabledState[field.id];
    const isRequired = fieldRequiredState[field.id];
    const fieldErrors = errors[field.id];

    const baseInputClasses = `w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors ${
      fieldErrors ? 'border-red-500' : 'border-gray-600'
    } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`;

    switch (field.type) {
      case 'text':
        return (
          <Controller
            name={field.id}
            control={control}
            rules={{
              required: isRequired ? `${field.label} is required` : false,
              validate: (value) => {
                const errors = validateField({ ...field, required: isRequired }, value);
                return errors.length === 0 ? true : errors[0];
              },
            }}
            render={({ field: fieldProps }) => (
              <input
                {...fieldProps}
                type="text"
                placeholder={field.placeholder}
                disabled={isDisabled}
                className={baseInputClasses}
                value={(fieldProps.value as string) ?? ''}
              />
            )}
          />
        );

      case 'number':
        return (
          <Controller
            name={field.id}
            control={control}
            rules={{
              required: isRequired ? `${field.label} is required` : false,
              validate: (value) => {
                const errors = validateField({ ...field, required: isRequired }, value);
                return errors.length === 0 ? true : errors[0];
              },
            }}
            render={({ field: fieldProps }) => (
              <input
                {...fieldProps}
                type="number"
                placeholder={field.placeholder}
                disabled={isDisabled}
                className={baseInputClasses}
                value={(fieldProps.value as string | number) ?? ''}
              />
            )}
          />
        );

      case 'date':
        return (
          <Controller
            name={field.id}
            control={control}
            rules={{
              required: isRequired ? `${field.label} is required` : false,
            }}
            render={({ field: fieldProps }) => (
              <input
                {...fieldProps}
                type="date"
                disabled={isDisabled}
                className={baseInputClasses}
                value={(fieldProps.value as string) ?? ''}
              />
            )}
          />
        );

      case 'textarea':
        return (
          <Controller
            name={field.id}
            control={control}
            rules={{
              required: isRequired ? `${field.label} is required` : false,
              validate: (value) => {
                const errors = validateField({ ...field, required: isRequired }, value);
                return errors.length === 0 ? true : errors[0];
              },
            }}
            render={({ field: fieldProps }) => (
              <textarea
                {...fieldProps}
                placeholder={field.placeholder}
                disabled={isDisabled}
                className={`${baseInputClasses} resize-none`}
                rows={4}
                value={(fieldProps.value as string) ?? ''}
              />
            )}
          />
        );

      case 'select':
        return (
          <Controller
            name={field.id}
            control={control}
            rules={{
              required: isRequired ? `${field.label} is required` : false,
            }}
            render={({ field: fieldProps }) => (
              <select
                {...fieldProps}
                disabled={isDisabled}
                className={baseInputClasses}
                value={(fieldProps.value as string) ?? ''}
              >
                <option value="">Select an option</option>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          />
        );

      case 'multi-select':
        return (
          <Controller
            name={field.id}
            control={control}
            rules={{
              required: isRequired ? `${field.label} is required` : false,
            }}
            render={({ field: fieldProps }) => (
              <select
                {...fieldProps}
                multiple
                disabled={isDisabled}
                className={baseInputClasses}
                value={(fieldProps.value as string[]) ?? []}
              >
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          />
        );

      case 'checkbox':
        return (
          <Controller
            name={field.id}
            control={control}
            render={({ field: fieldProps }) => (
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={isDisabled}
                  className="w-5 h-5 rounded"
                  checked={!!(fieldProps.value as boolean)}
                  onChange={fieldProps.onChange}
                  onBlur={fieldProps.onBlur}
                  name={fieldProps.name}
                  ref={fieldProps.ref}
                />
                <span className="text-white">{field.label}</span>
              </label>
            )}
          />
        );

      case 'radio':
        return (
          <Controller
            name={field.id}
            control={control}
            rules={{
              required: isRequired ? `${field.label} is required` : false,
            }}
            render={({ field: fieldProps }) => (
              <div className="space-y-2">
                {field.options?.map((option) => (
                  <label key={option.value} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      value={option.value}
                      disabled={isDisabled}
                      className="w-4 h-4"
                      checked={(fieldProps.value as string) === option.value}
                      onChange={fieldProps.onChange}
                      onBlur={fieldProps.onBlur}
                      name={fieldProps.name}
                      ref={fieldProps.ref}
                    />
                    <span className="text-white">{option.label}</span>
                  </label>
                ))}
              </div>
            )}
          />
        );

      case 'file-upload':
        return (
          <Controller
            name={field.id}
            control={control}
            rules={{
              required: isRequired ? `${field.label} is required` : false,
            }}
            render={({ field: fieldProps }) => (
              <input
                type="file"
                disabled={isDisabled}
                accept={field.acceptedFileTypes?.join(',')}
                className={baseInputClasses}
                onChange={fieldProps.onChange}
                onBlur={fieldProps.onBlur}
                name={fieldProps.name}
                ref={fieldProps.ref}
              />
            )}
          />
        );

      default:
        return null;
    }
  };

  const fullWidthFields = getFieldsByWidth('full');
  const halfWidthFields = getFieldsByWidth('half');
  const thirdWidthFields = getFieldsByWidth('third');

  return (
    <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4 sm:p-6">
      <h2 className="text-lg font-semibold mb-6">Form Preview</h2>

      <form onSubmit={handleSubmit(onSubmit ?? (() => {}))} className="space-y-6">
        {/* Full width fields */}
        {fullWidthFields.map((field) => (
          <div key={field.id}>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {field.label}
              {fieldRequiredState[field.id] && <span className="text-red-400 ml-1">*</span>}
            </label>
            {renderField(field)}
            {errors[field.id] && (
              <p className="mt-1 text-sm text-red-400">{String(errors[field.id]?.message)}</p>
            )}
            {field.helpText && (
              <p className="mt-1 text-xs text-gray-400">{field.helpText}</p>
            )}
          </div>
        ))}

        {/* Half width fields */}
        {halfWidthFields.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {halfWidthFields.map((field) => (
              <div key={field.id}>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {field.label}
                  {fieldRequiredState[field.id] && <span className="text-red-400 ml-1">*</span>}
                </label>
                {renderField(field)}
                {errors[field.id] && (
                  <p className="mt-1 text-sm text-red-400">{String(errors[field.id]?.message)}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Third width fields */}
        {thirdWidthFields.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {thirdWidthFields.map((field) => (
              <div key={field.id}>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {field.label}
                  {fieldRequiredState[field.id] && <span className="text-red-400 ml-1">*</span>}
                </label>
                {renderField(field)}
                {errors[field.id] && (
                  <p className="mt-1 text-sm text-red-400">{String(errors[field.id]?.message)}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <button
          type="submit"
          className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors min-h-[44px]"
        >
          Submit
        </button>
      </form>
    </div>
  );
};

export default FormPreview;
