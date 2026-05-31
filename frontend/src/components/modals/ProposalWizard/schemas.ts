/**
 * Validation schemas for each step of the proposal creation wizard.
 *
 * These are plain TypeScript validation functions that mirror the Zod API.
 * When zod + @hookform/resolvers are installed (add them to package.json),
 * swap these out for proper z.object() schemas and zodResolver().
 */

// ─── Shared types ─────────────────────────────────────────────────────────────

export type ValidationResult = string | true;

/** Validate a single field value; returns an error string or true on success. */
export type FieldValidator<T = string> = (value: T) => ValidationResult;

// ─── Step 1: Basic Details ────────────────────────────────────────────────────

export interface Step1Data {
  recipient: string;
  token: string;
  amount: string;
  memo: string;
  priority: '0' | '1' | '2';
}

export const step1Validators = {
  recipient: (v: string): ValidationResult => {
    if (!v || v.trim() === '') return 'Recipient address is required';
    if (!/^G[A-Z2-7]{55}$/.test(v.trim()))
      return 'Must be a valid Stellar address (starts with G, 56 chars)';
    return true;
  },
  token: (v: string): ValidationResult => {
    if (!v || v.trim() === '') return 'Token is required';
    return true;
  },
  amount: (v: string): ValidationResult => {
    if (!v || v.trim() === '') return 'Amount is required';
    const n = parseFloat(v);
    if (isNaN(n) || n <= 0) return 'Amount must be a positive number';
    return true;
  },
  memo: (v: string): ValidationResult => {
    if (v && v.length > 28) return 'Memo must be 28 characters or fewer';
    return true;
  },
  priority: (_v: string): ValidationResult => true,
} satisfies Record<keyof Step1Data, FieldValidator>;

// ─── Step 2: Conditions & Dependencies ───────────────────────────────────────

export interface ConditionItem {
  type: 'time_lock' | 'min_balance' | 'proposal_dependency';
  value: string;
}

export interface Step2Data {
  conditions: ConditionItem[];
  conditionLogic: '0' | '1'; // 0 = And, 1 = Or
  dependsOnProposalId: string;
}

export const step2Validators = {
  conditions: (_v: ConditionItem[]): ValidationResult => true,
  conditionLogic: (_v: string): ValidationResult => true,
  dependsOnProposalId: (_v: string): ValidationResult => true,
} satisfies Record<keyof Step2Data, FieldValidator<unknown>>;

// ─── Step 3: Insurance & Staking ─────────────────────────────────────────────

export interface Step3Data {
  insuranceAmount: string;
  enableInsurance: boolean;
}

export const step3Validators = {
  insuranceAmount: (v: string): ValidationResult => {
    const n = parseFloat(v || '0');
    if (isNaN(n) || n < 0) return 'Insurance amount must be zero or positive';
    return true;
  },
  enableInsurance: (_v: boolean): ValidationResult => true,
} satisfies Record<keyof Step3Data, FieldValidator<unknown>>;

// ─── Combined wizard data ─────────────────────────────────────────────────────

export type WizardFormData = Step1Data & Step2Data & Step3Data;

export const WIZARD_DEFAULTS: WizardFormData = {
  recipient: '',
  token: 'NATIVE',
  amount: '',
  memo: '',
  priority: '1',
  conditions: [],
  conditionLogic: '0',
  dependsOnProposalId: '',
  insuranceAmount: '0',
  enableInsurance: false,
};
