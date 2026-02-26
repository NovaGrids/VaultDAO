import type { FormTemplate } from '../types/formBuilder';

/**
 * Standard Transfer Template
 */
export const STANDARD_TRANSFER_TEMPLATE: FormTemplate = {
  id: 'template-standard-transfer',
  name: 'Standard Transfer',
  description: 'Simple fund transfer between accounts',
  category: 'standard',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isPublic: true,
  fields: [
    {
      id: 'recipient-address',
      name: 'recipient',
      label: 'Recipient Address',
      type: 'text',
      placeholder: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      required: true,
      order: 1,
      width: 'full',
      validationRules: [
        {
          id: 'recipient-required',
          type: 'required',
          message: 'Recipient address is required',
        },
        {
          id: 'recipient-format',
          type: 'regex',
          value: /^G[A-Z2-7]{55}$/,
          message: 'Invalid Stellar public key format',
        },
      ],
    },
    {
      id: 'token-address',
      name: 'token',
      label: 'Token',
      type: 'select',
      required: true,
      order: 2,
      width: 'half',
      defaultValue: 'native',
      options: [
        { value: 'native', label: 'XLM (Native)' },
        { value: 'usdc', label: 'USDC' },
      ],
      validationRules: [
        {
          id: 'token-required',
          type: 'required',
          message: 'Token is required',
        },
      ],
    },
    {
      id: 'amount',
      name: 'amount',
      label: 'Amount',
      type: 'number',
      placeholder: '0.00',
      required: true,
      order: 3,
      width: 'half',
      validationRules: [
        {
          id: 'amount-required',
          type: 'required',
          message: 'Amount is required',
        },
        {
          id: 'amount-min',
          type: 'min',
          value: 0.0000001,
          message: 'Amount must be greater than 0',
        },
      ],
    },
    {
      id: 'memo',
      name: 'memo',
      label: 'Memo',
      type: 'textarea',
      placeholder: 'Enter transfer description',
      required: false,
      order: 4,
      width: 'full',
      validationRules: [
        {
          id: 'memo-max',
          type: 'maxLength',
          value: 500,
          message: 'Memo cannot exceed 500 characters',
        },
      ],
    },
  ],
};

/**
 * Payroll Template
 */
export const PAYROLL_TEMPLATE: FormTemplate = {
  id: 'template-payroll',
  name: 'Payroll Payment',
  description: 'Recurring payroll distribution',
  category: 'payroll',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isPublic: true,
  fields: [
    {
      id: 'employee-name',
      name: 'employeeName',
      label: 'Employee Name',
      type: 'text',
      placeholder: 'John Doe',
      required: true,
      order: 1,
      width: 'half',
      validationRules: [
        {
          id: 'name-required',
          type: 'required',
          message: 'Employee name is required',
        },
        {
          id: 'name-length',
          type: 'minLength',
          value: 2,
          message: 'Name must be at least 2 characters',
        },
      ],
    },
    {
      id: 'employee-id',
      name: 'employeeId',
      label: 'Employee ID',
      type: 'text',
      placeholder: 'EMP-001',
      required: true,
      order: 2,
      width: 'half',
      validationRules: [
        {
          id: 'id-required',
          type: 'required',
          message: 'Employee ID is required',
        },
      ],
    },
    {
      id: 'recipient-address',
      name: 'recipient',
      label: 'Wallet Address',
      type: 'text',
      placeholder: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      required: true,
      order: 3,
      width: 'full',
      validationRules: [
        {
          id: 'address-required',
          type: 'required',
          message: 'Wallet address is required',
        },
        {
          id: 'address-format',
          type: 'regex',
          value: /^G[A-Z2-7]{55}$/,
          message: 'Invalid Stellar public key format',
        },
      ],
    },
    {
      id: 'salary-amount',
      name: 'salaryAmount',
      label: 'Salary Amount',
      type: 'number',
      placeholder: '5000.00',
      required: true,
      order: 4,
      width: 'half',
      validationRules: [
        {
          id: 'salary-required',
          type: 'required',
          message: 'Salary amount is required',
        },
        {
          id: 'salary-min',
          type: 'min',
          value: 0,
          message: 'Salary must be a positive number',
        },
      ],
    },
    {
      id: 'payment-period',
      name: 'paymentPeriod',
      label: 'Payment Period',
      type: 'select',
      required: true,
      order: 5,
      width: 'half',
      options: [
        { value: 'weekly', label: 'Weekly' },
        { value: 'biweekly', label: 'Bi-weekly' },
        { value: 'monthly', label: 'Monthly' },
      ],
      validationRules: [
        {
          id: 'period-required',
          type: 'required',
          message: 'Payment period is required',
        },
      ],
    },
    {
      id: 'notes',
      name: 'notes',
      label: 'Notes',
      type: 'textarea',
      placeholder: 'Additional notes',
      required: false,
      order: 6,
      width: 'full',
      validationRules: [
        {
          id: 'notes-max',
          type: 'maxLength',
          value: 500,
          message: 'Notes cannot exceed 500 characters',
        },
      ],
    },
  ],
};

/**
 * Invoice Payment Template
 */
export const INVOICE_PAYMENT_TEMPLATE: FormTemplate = {
  id: 'template-invoice',
  name: 'Invoice Payment',
  description: 'Payment for vendor invoices',
  category: 'invoice',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isPublic: true,
  fields: [
    {
      id: 'invoice-number',
      name: 'invoiceNumber',
      label: 'Invoice Number',
      type: 'text',
      placeholder: 'INV-2024-001',
      required: true,
      order: 1,
      width: 'half',
      validationRules: [
        {
          id: 'invoice-required',
          type: 'required',
          message: 'Invoice number is required',
        },
      ],
    },
    {
      id: 'vendor-name',
      name: 'vendorName',
      label: 'Vendor Name',
      type: 'text',
      placeholder: 'Vendor Inc.',
      required: true,
      order: 2,
      width: 'half',
      validationRules: [
        {
          id: 'vendor-required',
          type: 'required',
          message: 'Vendor name is required',
        },
      ],
    },
    {
      id: 'vendor-address',
      name: 'vendorAddress',
      label: 'Vendor Wallet Address',
      type: 'text',
      placeholder: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      required: true,
      order: 3,
      width: 'full',
      validationRules: [
        {
          id: 'vendor-address-required',
          type: 'required',
          message: 'Vendor address is required',
        },
        {
          id: 'vendor-address-format',
          type: 'regex',
          value: /^G[A-Z2-7]{55}$/,
          message: 'Invalid Stellar public key format',
        },
      ],
    },
    {
      id: 'invoice-amount',
      name: 'invoiceAmount',
      label: 'Invoice Amount',
      type: 'number',
      placeholder: '1000.00',
      required: true,
      order: 4,
      width: 'half',
      validationRules: [
        {
          id: 'amount-required',
          type: 'required',
          message: 'Invoice amount is required',
        },
        {
          id: 'amount-min',
          type: 'min',
          value: 0,
          message: 'Amount must be positive',
        },
      ],
    },
    {
      id: 'invoice-date',
      name: 'invoiceDate',
      label: 'Invoice Date',
      type: 'date',
      required: true,
      order: 5,
      width: 'half',
      validationRules: [
        {
          id: 'date-required',
          type: 'required',
          message: 'Invoice date is required',
        },
      ],
    },
    {
      id: 'description',
      name: 'description',
      label: 'Description',
      type: 'textarea',
      placeholder: 'Invoice description and details',
      required: true,
      order: 6,
      width: 'full',
      validationRules: [
        {
          id: 'desc-required',
          type: 'required',
          message: 'Description is required',
        },
        {
          id: 'desc-min',
          type: 'minLength',
          value: 10,
          message: 'Description must be at least 10 characters',
        },
      ],
    },
  ],
};

/**
 * Get all built-in templates
 */
export const getBuiltInTemplates = (): FormTemplate[] => [
  STANDARD_TRANSFER_TEMPLATE,
  PAYROLL_TEMPLATE,
  INVOICE_PAYMENT_TEMPLATE,
];

/**
 * Get template by ID
 */
export const getTemplateById = (id: string): FormTemplate | undefined => {
  return getBuiltInTemplates().find(t => t.id === id);
};

/**
 * Save custom template to localStorage
 */
export const saveCustomTemplate = (template: FormTemplate): void => {
  const templates = getCustomTemplates();
  const index = templates.findIndex(t => t.id === template.id);

  if (index >= 0) {
    templates[index] = template;
  } else {
    templates.push(template);
  }

  localStorage.setItem('formTemplates', JSON.stringify(templates));
};

/**
 * Get custom templates from localStorage
 */
export const getCustomTemplates = (): FormTemplate[] => {
  try {
    const stored = localStorage.getItem('formTemplates');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

/**
 * Delete custom template
 */
export const deleteCustomTemplate = (id: string): void => {
  const templates = getCustomTemplates().filter(t => t.id !== id);
  localStorage.setItem('formTemplates', JSON.stringify(templates));
};

/**
 * Get all templates (built-in + custom)
 */
export const getAllTemplates = (): FormTemplate[] => [
  ...getBuiltInTemplates(),
  ...getCustomTemplates(),
];

/**
 * Export template as JSON
 */
export const exportTemplateAsJSON = (template: FormTemplate): string => {
  return JSON.stringify(template, null, 2);
};

/**
 * Import template from JSON
 */
export const importTemplateFromJSON = (json: string): FormTemplate | null => {
  try {
    const template = JSON.parse(json) as FormTemplate;
    // Validate template structure
    if (!template.id || !template.name || !Array.isArray(template.fields)) {
      return null;
    }
    return template;
  } catch {
    return null;
  }
};
