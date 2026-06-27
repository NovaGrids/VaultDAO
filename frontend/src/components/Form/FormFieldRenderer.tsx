import React from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import type { FormField } from '../../types/formBuilder';
import { validateField } from '../../utils/formValidation';

interface FormFieldRendererProps {
  field: FormField;
  isDisabled: boolean;
  isRequired: boolean;
}

const FormFieldRenderer: React.FC<FormFieldRendererProps> = ({ field, isDisabled, isRequired }) => {
  const { control, formState: { errors } } = useFormContext();
  const fieldErrors = errors[field.id];

  const baseInputClasses = `w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors ${
    fieldErrors ? 'border-red-500' : 'border-gray-600'
  } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`;

  const commonRules = {
    required: isRequired ? `${field.label} is required` : false,
    validate: (value: unknown) => {
      const errors = validateField({ ...field, required: isRequired }, value);
      return errors.length === 0 ? true : errors[0];
    },
  };

  switch (field.type) {
    case 'text':
    case 'number':
    case 'date':
    case 'address':
      return (
        <Controller
          name={field.id}
          control={control}
          rules={commonRules}
          render={({ field: fieldProps }) => (
            <input
              {...fieldProps}
              type={field.type === 'address' ? 'text' : field.type}
              placeholder={field.placeholder}
              disabled={isDisabled}
              className={baseInputClasses}
              value={(fieldProps.value as string | number) ?? ''}
            />
          )}
        />
      );

    case 'textarea':
      return (
        <Controller
          name={field.id}
          control={control}
          rules={commonRules}
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
    case 'multi-select':
      return (
        <Controller
          name={field.id}
          control={control}
          rules={commonRules}
          render={({ field: fieldProps }) => (
            <select
              {...fieldProps}
              multiple={field.type === 'multi-select'}
              disabled={isDisabled}
              className={baseInputClasses}
              value={(fieldProps.value as string | string[]) ?? (field.type === 'multi-select' ? [] : '')}
            >
              {!field.type.includes('multi') && <option value="">Select an option</option>}
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
                className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-purple-500"
                checked={!!(fieldProps.value as boolean)}
                onChange={fieldProps.onChange}
                onBlur={fieldProps.onBlur}
                name={fieldProps.name}
                ref={fieldProps.ref}
              />
              <span className="text-gray-300 text-sm">{field.label}</span>
            </label>
          )}
        />
      );

    case 'radio':
      return (
        <Controller
          name={field.id}
          control={control}
          rules={commonRules}
          render={({ field: fieldProps }) => (
            <div className="space-y-2">
              {field.options?.map((option) => (
                <label key={option.value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    value={option.value}
                    disabled={isDisabled}
                    className="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 focus:ring-purple-500"
                    checked={(fieldProps.value as string) === option.value}
                    onChange={fieldProps.onChange}
                    onBlur={fieldProps.onBlur}
                    name={fieldProps.name}
                    ref={fieldProps.ref}
                  />
                  <span className="text-gray-300 text-sm">{option.label}</span>
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
          rules={commonRules}
          render={({ field: fieldProps }) => (
            <input
              type="file"
              disabled={isDisabled}
              accept={field.acceptedFileTypes?.join(',')}
              className={baseInputClasses}
              onChange={(e) => fieldProps.onChange(e.target.files)}
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

export default FormFieldRenderer;
