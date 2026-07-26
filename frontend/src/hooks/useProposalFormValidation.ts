import { useMemo } from 'react';
import { isValidStellarAddress } from '../utils/proposalValidation';

/** Free-text memo field cap; generous enough for a note, bounded to avoid unbounded input. */
export const MAX_MEMO_LENGTH = 500;

export interface ProposalFormValidationInput {
  recipient: string;
  amount: string;
  memo: string;
  /** Per-proposal spending limit, decimal (e.g. XLM), 0/undefined = no limit. */
  proposalLimit?: string;
  /** Available balance for the selected token, decimal. */
  availableBalance?: string;
  /** Async whitelist/blacklist check result for the recipient, if any. */
  recipientListError?: string | null;
}

export interface ProposalFormErrors {
  recipient?: string;
  amount?: string;
  memo?: string;
}

export interface ProposalFormValidationResult {
  errors: ProposalFormErrors;
  isValid: boolean;
}

/** Pure validation function so it can be unit tested without rendering a component. */
export function validateProposalForm(
  input: ProposalFormValidationInput,
): ProposalFormValidationResult {
  const errors: ProposalFormErrors = {};

  if (!input.recipient) {
    errors.recipient = 'Recipient address is required';
  } else if (!isValidStellarAddress(input.recipient)) {
    errors.recipient = 'Enter a valid Stellar address (G… or M…)';
  } else if (input.recipientListError) {
    errors.recipient = input.recipientListError;
  }

  if (!input.amount) {
    errors.amount = 'Amount is required';
  } else {
    const numericAmount = Number(input.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      errors.amount = 'Amount must be a positive number';
    } else {
      const limit = input.proposalLimit ? Number(input.proposalLimit) : 0;
      const balance =
        input.availableBalance !== undefined ? Number(input.availableBalance) : undefined;

      if (limit > 0 && numericAmount > limit) {
        errors.amount = `Amount exceeds the per-proposal limit of ${input.proposalLimit}`;
      } else if (balance !== undefined && Number.isFinite(balance) && numericAmount > balance) {
        errors.amount = `Amount exceeds available balance of ${input.availableBalance}`;
      }
    }
  }

  if (input.memo && input.memo.length > MAX_MEMO_LENGTH) {
    errors.memo = `Memo must be ${MAX_MEMO_LENGTH} characters or fewer`;
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}

/** Recomputes validation on every change to formData so errors show up as-you-type. */
export function useProposalFormValidation(
  input: ProposalFormValidationInput,
): ProposalFormValidationResult {
  return useMemo(() => validateProposalForm(input), [input]);
}
