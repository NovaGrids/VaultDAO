/**
 * Proposal template utility for Issue #28.
 * 
 * Provides template management, variable interpolation, usage tracking, and localStorage persistence.
 * Follows patterns established in notifications.ts for consistency.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export const TEMPLATE_CATEGORIES = [
  'Payroll',
  'Operations',
  'Treasury',
  'Governance',
  'Custom'
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/**
 * Core template structure matching proposal fields from useVaultContract.
 * Fields may contain {{variable}} placeholders for interpolation.
 */
export interface ProposalTemplate {
  /** Unique identifier (UUID for custom, fixed string for defaults) */
  id: string;
  /** Display name */
  name: string;
  /** Category for filtering */
  category: TemplateCategory;
  /** Human-readable description */
  description: string;
  /** Recipient address (may contain {{variables}}) */
  recipient: string;
  /** Amount string (may contain {{variables}}) */
  amount: string;
  /** Token contract address */
  token: string;
  /** Memo/description (may contain {{variables}}) */
  memo: string;
  /** Whether this is a default template (immutable) */
  isDefault: boolean;
  /** Number of times this template has been used */
  usageCount: number;
  /** ISO timestamp of last usage */
  lastUsedAt: string | null;
  /** ISO timestamp of creation */
  createdAt: string;
}

/**
 * Variable extraction result for interpolation prompts.
 * Used by UI to determine which variables need user input.
 */
export interface TemplateVariables {
  /** Map of variable name -> example value or empty string */
  variables: Record<string, string>;
  /** Array of variable names in order of first appearance */
  variableNames: string[];
}

/**
 * Interpolated template ready for proposal submission.
 * All {{variables}} have been replaced with actual values.
 */
export interface InterpolatedTemplate {
  recipient: string;
  amount: string;
  token: string;
  memo: string;
}

// ============================================================================
// ERRORS
// ============================================================================

export class TemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Template not found: ${id}`);
    this.name = 'TemplateNotFoundError';
  }
}

export class ImmutableTemplateError extends Error {
  constructor(id: string) {
    super(`Template is immutable (default template): ${id}`);
    this.name = 'ImmutableTemplateError';
  }
}

export class MissingVariableError extends Error {
  constructor(variable: string) {
    super(`Missing required variable: ${variable}`);
    this.name = 'MissingVariableError';
  }
}

export class InvalidTemplateError extends Error {
  constructor(message: string) {
    super(`Invalid template: ${message}`);
    this.name = 'InvalidTemplateError';
  }
}

// ============================================================================
// STORAGE KEYS
// ============================================================================

const STORAGE_KEY_TEMPLATES = 'vaultdao_proposal_templates';
const STORAGE_KEY_USAGE = 'vaultdao_template_usage';

// ============================================================================
// DEFAULT TEMPLATES (IMMUTABLE)
// ============================================================================

const DEFAULT_TEMPLATES: ProposalTemplate[] = [
  {
    id: 'default-payroll',
    name: 'Monthly Payroll',
    category: 'Payroll',
    description: 'Template for monthly employee salary payments',
    recipient: '{{employee_address}}',
    amount: '{{salary}}',
    token: '',
    memo: 'Monthly Salary - {{month}}',
    isDefault: true,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'default-vendor',
    name: 'Vendor Payment',
    category: 'Operations',
    description: 'Template for vendor invoice payments',
    recipient: '{{vendor_address}}',
    amount: '{{invoice_amount}}',
    token: '',
    memo: 'Invoice #{{invoice_number}}',
    isDefault: true,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'default-swap',
    name: 'Token Swap',
    category: 'Treasury',
    description: 'Template for token swap operations',
    recipient: '{{dex_address}}',
    amount: '{{swap_amount}}',
    token: '',
    memo: 'Token Swap',
    isDefault: true,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00Z'
  }
];

// ============================================================================
// STORAGE HELPERS
// ============================================================================

interface StoredTemplates {
  custom: ProposalTemplate[];
}

interface TemplateUsage {
  [templateId: string]: {
    count: number;
    lastUsedAt: string;
  };
}

function loadCustomTemplates(): ProposalTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TEMPLATES);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredTemplates;
    return parsed.custom || [];
  } catch {
    return [];
  }
}

function saveCustomTemplates(templates: ProposalTemplate[]): void {
  try {
    const stored: StoredTemplates = { custom: templates };
    localStorage.setItem(STORAGE_KEY_TEMPLATES, JSON.stringify(stored));
  } catch {
    // localStorage may be full or disabled
  }
}

function loadUsage(): TemplateUsage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_USAGE);
    if (!raw) return {};
    return JSON.parse(raw) as TemplateUsage;
  } catch {
    return {};
  }
}

function saveUsage(usage: TemplateUsage): void {
  try {
    localStorage.setItem(STORAGE_KEY_USAGE, JSON.stringify(usage));
  } catch {
    // ignore
  }
}

function mergeUsageIntoTemplates(templates: ProposalTemplate[]): ProposalTemplate[] {
  const usage = loadUsage();
  return templates.map(t => {
    const usageData = usage[t.id];
    if (usageData) {
      return {
        ...t,
        usageCount: usageData.count,
        lastUsedAt: usageData.lastUsedAt
      };
    }
    return t;
  });
}

// ============================================================================
// VALIDATION
// ============================================================================

function validateCategory(category: string): category is TemplateCategory {
  return TEMPLATE_CATEGORIES.includes(category as TemplateCategory);
}

function validateTemplate(template: Partial<ProposalTemplate>): void {
  if (!template.name || template.name.trim().length === 0) {
    throw new InvalidTemplateError('Name is required');
  }
  if (template.name.length > 100) {
    throw new InvalidTemplateError('Name must be 100 characters or less');
  }
  if (!template.category || !validateCategory(template.category)) {
    throw new InvalidTemplateError(`Category must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`);
  }
  if (!template.recipient || template.recipient.trim().length === 0) {
    throw new InvalidTemplateError('Recipient is required');
  }
  if (!template.amount || template.amount.trim().length === 0) {
    throw new InvalidTemplateError('Amount is required');
  }
  if (!template.token || template.token.trim().length === 0) {
    throw new InvalidTemplateError('Token is required');
  }
  if (!template.memo || template.memo.trim().length === 0) {
    throw new InvalidTemplateError('Memo is required');
  }
}

// ============================================================================
// VARIABLE INTERPOLATION
// ============================================================================

const VARIABLE_REGEX = /\{\{(\w+)\}\}/g;

/**
 * Extract all unique variables from template fields.
 * Returns variables in order of first appearance.
 * 
 * @param template - Template to extract variables from
 * @returns Object with variables map and ordered variable names array
 */
export function extractTemplateVariables(template: ProposalTemplate): TemplateVariables {
  const variableSet = new Set<string>();
  const variableOrder: string[] = [];
  
  const fields = [template.recipient, template.amount, template.memo];
  
  for (const field of fields) {
    let match;
    while ((match = VARIABLE_REGEX.exec(field)) !== null) {
      const varName = match[1];
      if (!variableSet.has(varName)) {
        variableSet.add(varName);
        variableOrder.push(varName);
      }
    }
  }
  
  const variables: Record<string, string> = {};
  for (const name of variableOrder) {
    variables[name] = '';
  }
  
  return { variables, variableNames: variableOrder };
}

/**
 * Interpolate template with provided variable values.
 * Replaces all {{variable}} occurrences with values from the map.
 * Throws MissingVariableError if any required variable is missing.
 * 
 * @param template - Template to interpolate
 * @param variables - Map of variable name -> value
 * @returns Interpolated template with all variables replaced
 * @throws MissingVariableError if required variable is missing
 */
export function interpolateTemplate(
  template: ProposalTemplate,
  variables: Record<string, string>
): InterpolatedTemplate {
  const required = extractTemplateVariables(template).variableNames;
  
  for (const varName of required) {
    if (!(varName in variables)) {
      throw new MissingVariableError(varName);
    }
  }
  
  const interpolate = (text: string): string => {
    return text.replace(VARIABLE_REGEX, (match, varName) => {
      return variables[varName] ?? match;
    });
  };
  
  return {
    recipient: interpolate(template.recipient),
    amount: interpolate(template.amount),
    token: template.token, // Token doesn't support variables per requirements
    memo: interpolate(template.memo)
  };
}

// ============================================================================
// TEMPLATE CRUD OPERATIONS
// ============================================================================

/**
 * Get all templates (defaults + custom), sorted by usage count (most used first).
 * Usage data is merged from separate storage.
 * 
 * @returns Array of all templates sorted by usage
 */
export function getAllTemplates(): ProposalTemplate[] {
  const custom = loadCustomTemplates();
  const all = [...DEFAULT_TEMPLATES, ...custom];
  const withUsage = mergeUsageIntoTemplates(all);
  return withUsage.sort((a, b) => b.usageCount - a.usageCount);
}

/**
 * Get templates filtered by category.
 * 
 * @param category - Category to filter by
 * @returns Array of templates in the specified category
 */
export function getTemplatesByCategory(category: TemplateCategory): ProposalTemplate[] {
  return getAllTemplates().filter(t => t.category === category);
}

/**
 * Get a single template by ID.
 * 
 * @param id - Template ID
 * @returns Template if found, null otherwise
 */
export function getTemplateById(id: string): ProposalTemplate | null {
  const all = getAllTemplates();
  return all.find(t => t.id === id) ?? null;
}

/**
 * Get most frequently used templates (for quick actions).
 * 
 * @param limit - Maximum number of templates to return (default: 5)
 * @returns Array of most used templates
 */
export function getMostUsedTemplates(limit: number = 5): ProposalTemplate[] {
  const all = getAllTemplates();
  return all
    .filter(t => t.usageCount > 0)
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, limit);
}

/**
 * Create a new custom template.
 * Validates fields, assigns UUID, and persists to localStorage.
 * 
 * @param name - Template name
 * @param category - Template category
 * @param description - Template description
 * @param recipient - Recipient address (may contain {{variables}})
 * @param amount - Amount string (may contain {{variables}})
 * @param token - Token contract address
 * @param memo - Memo text (may contain {{variables}})
 * @returns Created template
 * @throws InvalidTemplateError if validation fails
 */
export function createTemplate(
  name: string,
  category: TemplateCategory,
  description: string,
  recipient: string,
  amount: string,
  token: string,
  memo: string
): ProposalTemplate {
  const template: Partial<ProposalTemplate> = {
    name,
    category,
    description,
    recipient,
    amount,
    token,
    memo
  };
  
  validateTemplate(template);
  
  const newTemplate: ProposalTemplate = {
    id: `custom-${crypto.randomUUID()}`,
    name: name.trim(),
    category,
    description: description.trim(),
    recipient: recipient.trim(),
    amount: amount.trim(),
    token: token.trim(),
    memo: memo.trim(),
    isDefault: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: new Date().toISOString()
  };
  
  const custom = loadCustomTemplates();
  custom.push(newTemplate);
  saveCustomTemplates(custom);
  
  return newTemplate;
}

/**
 * Update an existing custom template.
 * Throws if template is default (immutable) or not found.
 * 
 * @param id - Template ID
 * @param updates - Partial template fields to update
 * @returns Updated template
 * @throws TemplateNotFoundError if template doesn't exist
 * @throws ImmutableTemplateError if template is default
 * @throws InvalidTemplateError if validation fails
 */
export function updateTemplate(
  id: string,
  updates: Partial<Omit<ProposalTemplate, 'id' | 'isDefault' | 'usageCount' | 'lastUsedAt' | 'createdAt'>>
): ProposalTemplate {
  const custom = loadCustomTemplates();
  const index = custom.findIndex(t => t.id === id);
  
  if (index === -1) {
    // Check if it's a default template
    const defaultTemplate = DEFAULT_TEMPLATES.find(t => t.id === id);
    if (defaultTemplate) {
      throw new ImmutableTemplateError(id);
    }
    throw new TemplateNotFoundError(id);
  }
  
  const existing = custom[index];
  const updated = { ...existing, ...updates };
  validateTemplate(updated);
  
  custom[index] = {
    ...updated,
    id: existing.id,
    isDefault: false,
    usageCount: existing.usageCount,
    lastUsedAt: existing.lastUsedAt,
    createdAt: existing.createdAt
  };
  
  saveCustomTemplates(custom);
  return custom[index];
}

/**
 * Delete a custom template.
 * Throws if template is default (immutable) or not found.
 * 
 * @param id - Template ID
 * @throws TemplateNotFoundError if template doesn't exist
 * @throws ImmutableTemplateError if template is default
 */
export function deleteTemplate(id: string): void {
  const custom = loadCustomTemplates();
  const index = custom.findIndex(t => t.id === id);
  
  if (index === -1) {
    // Check if it's a default template
    const defaultTemplate = DEFAULT_TEMPLATES.find(t => t.id === id);
    if (defaultTemplate) {
      throw new ImmutableTemplateError(id);
    }
    throw new TemplateNotFoundError(id);
  }
  
  custom.splice(index, 1);
  saveCustomTemplates(custom);
  
  // Also remove usage tracking
  const usage = loadUsage();
  delete usage[id];
  saveUsage(usage);
}

/**
 * Record template usage (increments counter, updates lastUsedAt).
 * Called automatically when template is used to create proposal.
 * Works for both default and custom templates.
 * 
 * @param id - Template ID
 */
export function recordTemplateUsage(id: string): void {
  const usage = loadUsage();
  const existing = usage[id] || { count: 0, lastUsedAt: '' };
  
  usage[id] = {
    count: existing.count + 1,
    lastUsedAt: new Date().toISOString()
  };
  
  saveUsage(usage);
}

/**
 * Search templates by name or description.
 * Case-insensitive partial matching.
 * 
 * @param query - Search query string
 * @returns Array of matching templates
 */
export function searchTemplates(query: string): ProposalTemplate[] {
  const all = getAllTemplates();
  const lowerQuery = query.toLowerCase().trim();
  
  if (!lowerQuery) return all;
  
  return all.filter(t => 
    t.name.toLowerCase().includes(lowerQuery) ||
    t.description.toLowerCase().includes(lowerQuery)
  );
}