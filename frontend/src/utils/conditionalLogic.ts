import type { FormField, ConditionalLogicRule, ConditionalOperator, FormSubmissionData } from '../types/formBuilder';

/**
 * Evaluate a conditional operator
 */
const evaluateOperator = (
  operator: ConditionalOperator,
  fieldValue: unknown,
  conditionValue: string | number | boolean
): boolean => {
  const stringFieldValue = String(fieldValue ?? '');
  const stringConditionValue = String(conditionValue);

  switch (operator) {
    case 'equals':
      return stringFieldValue === stringConditionValue;

    case 'notEquals':
      return stringFieldValue !== stringConditionValue;

    case 'greaterThan':
      return Number(fieldValue) > Number(conditionValue);

    case 'lessThan':
      return Number(fieldValue) < Number(conditionValue);

    case 'contains':
      return stringFieldValue.includes(stringConditionValue);

    case 'isEmpty':
      return !fieldValue || fieldValue === '' || (Array.isArray(fieldValue) && fieldValue.length === 0);

    case 'isNotEmpty':
      return !!fieldValue && fieldValue !== '' && (!Array.isArray(fieldValue) || fieldValue.length > 0);

    default:
      return false;
  }
};

/**
 * Evaluate a single conditional logic rule
 */
const evaluateRule = (
  rule: ConditionalLogicRule,
  formData: FormSubmissionData
): boolean => {
  const fieldValue = formData[rule.condition.fieldId];
  return evaluateOperator(rule.condition.operator, fieldValue, rule.condition.value);
};

/**
 * Calculate field visibility based on conditional logic
 */
export const calculateFieldVisibility = (
  fields: FormField[],
  formData: FormSubmissionData
): Record<string, boolean> => {
  const visibility: Record<string, boolean> = {};

  // Initialize all fields as visible
  for (const field of fields) {
    visibility[field.id] = true;
  }

  // Apply conditional logic
  for (const field of fields) {
    if (!field.conditionalLogic || field.conditionalLogic.length === 0) {
      continue;
    }

    for (const rule of field.conditionalLogic) {
      const conditionMet = evaluateRule(rule, formData);

      switch (rule.action.type) {
        case 'show':
          if (!conditionMet) {
            for (const targetId of rule.action.targetFieldIds) {
              visibility[targetId] = false;
            }
          }
          break;

        case 'hide':
          if (conditionMet) {
            for (const targetId of rule.action.targetFieldIds) {
              visibility[targetId] = false;
            }
          }
          break;

        case 'disable':
        case 'enable':
        case 'setRequired':
        case 'setOptional':
          // These are handled separately in field state management
          break;
      }
    }
  }

  return visibility;
};

/**
 * Calculate field disabled state based on conditional logic
 */
export const calculateFieldDisabledState = (
  fields: FormField[],
  formData: FormSubmissionData
): Record<string, boolean> => {
  const disabled: Record<string, boolean> = {};

  for (const field of fields) {
    disabled[field.id] = field.disabled ?? false;
  }

  for (const field of fields) {
    if (!field.conditionalLogic || field.conditionalLogic.length === 0) {
      continue;
    }

    for (const rule of field.conditionalLogic) {
      const conditionMet = evaluateRule(rule, formData);

      if (rule.action.type === 'disable' && conditionMet) {
        for (const targetId of rule.action.targetFieldIds) {
          disabled[targetId] = true;
        }
      } else if (rule.action.type === 'enable' && conditionMet) {
        for (const targetId of rule.action.targetFieldIds) {
          disabled[targetId] = false;
        }
      }
    }
  }

  return disabled;
};

/**
 * Calculate field required state based on conditional logic
 */
export const calculateFieldRequiredState = (
  fields: FormField[],
  formData: FormSubmissionData
): Record<string, boolean> => {
  const required: Record<string, boolean> = {};

  for (const field of fields) {
    required[field.id] = field.required;
  }

  for (const field of fields) {
    if (!field.conditionalLogic || field.conditionalLogic.length === 0) {
      continue;
    }

    for (const rule of field.conditionalLogic) {
      const conditionMet = evaluateRule(rule, formData);

      if (rule.action.type === 'setRequired' && conditionMet) {
        for (const targetId of rule.action.targetFieldIds) {
          required[targetId] = true;
        }
      } else if (rule.action.type === 'setOptional' && conditionMet) {
        for (const targetId of rule.action.targetFieldIds) {
          required[targetId] = false;
        }
      }
    }
  }

  return required;
};

/**
 * Get all affected fields for a given field (fields that depend on it)
 */
export const getAffectedFields = (
  fields: FormField[],
  fieldId: string
): string[] => {
  const affected = new Set<string>();

  for (const field of fields) {
    if (!field.conditionalLogic) continue;

    for (const rule of field.conditionalLogic) {
      if (rule.condition.fieldId === fieldId) {
        for (const targetId of rule.action.targetFieldIds) {
          affected.add(targetId);
        }
      }
    }
  }

  return Array.from(affected);
};

/**
 * Validate conditional logic for circular dependencies
 */
export const validateConditionalLogic = (fields: FormField[]): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const hasCycle = (fieldId: string): boolean => {
    visited.add(fieldId);
    recursionStack.add(fieldId);

    const field = fields.find(f => f.id === fieldId);
    if (!field || !field.conditionalLogic) {
      recursionStack.delete(fieldId);
      return false;
    }

    for (const rule of field.conditionalLogic) {
      for (const targetId of rule.action.targetFieldIds) {
        if (!visited.has(targetId)) {
          if (hasCycle(targetId)) {
            return true;
          }
        } else if (recursionStack.has(targetId)) {
          return true;
        }
      }
    }

    recursionStack.delete(fieldId);
    return false;
  };

  for (const field of fields) {
    if (!visited.has(field.id)) {
      if (hasCycle(field.id)) {
        errors.push(`Circular dependency detected involving field: ${field.label}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};
