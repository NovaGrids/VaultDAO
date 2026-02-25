// Form field types
export type FieldType = 'text' | 'number' | 'date' | 'select' | 'multi-select' | 'file-upload' | 'textarea' | 'checkbox' | 'radio';

// Validation rule types
export type ValidationRuleType = 'required' | 'min' | 'max' | 'minLength' | 'maxLength' | 'regex' | 'custom' | 'email' | 'url';

// Conditional logic operators
export type ConditionalOperator = 'equals' | 'notEquals' | 'greaterThan' | 'lessThan' | 'contains' | 'isEmpty' | 'isNotEmpty';

// Field configuration
export interface FormField {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  description?: string;
  required: boolean;
  defaultValue?: string | number | boolean | string[];
  options?: FormFieldOption[]; // For select, multi-select, radio
  validationRules: ValidationRule[];
  conditionalLogic?: ConditionalLogicRule[];
  order: number;
  width?: 'full' | 'half' | 'third'; // For responsive layout
  helpText?: string;
  disabled?: boolean;
  maxFileSize?: number; // In MB, for file uploads
  acceptedFileTypes?: string[]; // MIME types
}

export interface FormFieldOption {
  value: string;
  label: string;
  description?: string;
}

// Validation rule
export interface ValidationRule {
  id: string;
  type: ValidationRuleType;
  value?: string | number | RegExp;
  message: string;
  customValidator?: (value: unknown) => boolean;
}

// Conditional logic rule
export interface ConditionalLogicRule {
  id: string;
  condition: {
    fieldId: string;
    operator: ConditionalOperator;
    value: string | number | boolean;
  };
  action: {
    type: 'show' | 'hide' | 'disable' | 'enable' | 'setRequired' | 'setOptional';
    targetFieldIds: string[];
  };
}

// Form template
export interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: 'standard' | 'payroll' | 'invoice' | 'custom';
  fields: FormField[];
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
}

// Form configuration
export interface FormConfig {
  id: string;
  name: string;
  description: string;
  fields: FormField[];
  templateId?: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

// Form submission data
export interface FormSubmissionData {
  [fieldId: string]: unknown;
}

// Form validation result
export interface FormValidationResult {
  isValid: boolean;
  errors: Record<string, string[]>;
  warnings?: Record<string, string[]>;
}

// Form state for builder
export interface FormBuilderState {
  fields: FormField[];
  selectedFieldId?: string;
  previewMode: boolean;
  isDirty: boolean;
}
