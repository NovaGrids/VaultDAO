import type { FormField, ValidationRule, FormSubmissionData, FormValidationResult } from '../types/formBuilder';

/**
 * Validate a single field value against its validation rules
 */
export const validateField = (field: FormField, value: unknown): string[] => {
  const errors: string[] = [];

  // Check required
  if (field.required) {
    if (value === undefined || value === null || value === '') {
      errors.push(`${field.label} is required`);
      return errors;
    }
    if (Array.isArray(value) && value.length === 0) {
      errors.push(`${field.label} is required`);
      return errors;
    }
  }

  // Skip further validation if field is empty and not required
  if (!field.required && (value === undefined || value === null || value === '')) {
    return errors;
  }

  // Apply validation rules
  for (const rule of field.validationRules) {
    const ruleError = validateRule(rule, value);
    if (ruleError) {
      errors.push(ruleError);
    }
  }

  return errors;
};

/**
 * Validate a value against a specific rule
 */
const validateRule = (rule: ValidationRule, value: unknown): string | null => {
  const stringValue = String(value ?? '');
  const numValue = Number(value);

  switch (rule.type) {
    case 'required':
      return !value ? rule.message : null;

    case 'email':
      return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue) ? rule.message : null;

    case 'url':
      try {
        new URL(stringValue);
        return null;
      } catch {
        return rule.message;
      }

    case 'min':
      return numValue < Number(rule.value) ? rule.message : null;

    case 'max':
      return numValue > Number(rule.value) ? rule.message : null;

    case 'minLength':
      return stringValue.length < Number(rule.value) ? rule.message : null;

    case 'maxLength':
      return stringValue.length > Number(rule.value) ? rule.message : null;

    case 'regex':
      if (rule.value instanceof RegExp) {
        return !rule.value.test(stringValue) ? rule.message : null;
      }
      try {
        const regex = new RegExp(String(rule.value));
        return !regex.test(stringValue) ? rule.message : null;
      } catch {
        return rule.message;
      }

    case 'custom':
      if (rule.customValidator) {
        return !rule.customValidator(value) ? rule.message : null;
      }
      return null;

    default:
      return null;
  }
};

/**
 * Validate entire form submission
 */
export const validateForm = (
  fields: FormField[],
  data: FormSubmissionData,
  conditionalVisibility?: Record<string, boolean>
): FormValidationResult => {
  const errors: Record<string, string[]> = {};

  for (const field of fields) {
    // Skip validation for hidden fields
    if (conditionalVisibility && !conditionalVisibility[field.id]) {
      continue;
    }

    const fieldErrors = validateField(field, data[field.id]);
    if (fieldErrors.length > 0) {
      errors[field.id] = fieldErrors;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

/**
 * Sanitize form data
 */
export const sanitizeFormData = (data: FormSubmissionData): FormSubmissionData => {
  const sanitized: FormSubmissionData = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      // Remove potentially dangerous characters
      sanitized[key] = value
        .replace(/[<>]/g, '')
        .trim();
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(v =>
        typeof v === 'string' ? v.replace(/[<>]/g, '').trim() : v
      );
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

/**
 * Format field value for display
 */
export const formatFieldValue = (value: unknown, fieldType: string): string => {
  if (value === null || value === undefined) return '';

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (fieldType === 'date' && typeof value === 'string') {
    try {
      return new Date(value).toLocaleDateString();
    } catch {
      return String(value);
    }
  }

  if (fieldType === 'number') {
    return Number(value).toLocaleString();
  }

  return String(value);
};

/**
 * Parse field value from string input
 */
export const parseFieldValue = (value: string, fieldType: string): unknown => {
  switch (fieldType) {
    case 'number':
      return value === '' ? undefined : Number(value);
    case 'checkbox':
      return value === 'true' || value === '1';
    case 'date':
      return value === '' ? undefined : new Date(value).toISOString();
    default:
      return value === '' ? undefined : value;
  }
};
