import { describe, it, expect } from 'vitest';
import { validateProposalForm, MAX_MEMO_LENGTH } from '../useProposalFormValidation';

const VALID_ADDRESS = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';

describe('validateProposalForm', () => {
  it('is invalid with all fields empty', () => {
    const result = validateProposalForm({ recipient: '', amount: '', memo: '' });
    expect(result.isValid).toBe(false);
    expect(result.errors.recipient).toBeTruthy();
    expect(result.errors.amount).toBeTruthy();
  });

  it('is valid for a well-formed recipient and positive amount', () => {
    const result = validateProposalForm({ recipient: VALID_ADDRESS, amount: '100', memo: 'ok' });
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('rejects a malformed recipient address', () => {
    const result = validateProposalForm({ recipient: 'not-an-address', amount: '100', memo: '' });
    expect(result.isValid).toBe(false);
    expect(result.errors.recipient).toMatch(/valid Stellar address/i);
  });

  it('surfaces an async whitelist/blacklist error for an otherwise valid address', () => {
    const result = validateProposalForm({
      recipient: VALID_ADDRESS,
      amount: '100',
      memo: '',
      recipientListError: 'This address is not on the whitelist',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.recipient).toBe('This address is not on the whitelist');
  });

  it('rejects zero and negative amounts', () => {
    expect(validateProposalForm({ recipient: VALID_ADDRESS, amount: '0', memo: '' }).errors.amount).toBeTruthy();
    expect(validateProposalForm({ recipient: VALID_ADDRESS, amount: '-5', memo: '' }).errors.amount).toBeTruthy();
  });

  it('rejects a non-numeric amount', () => {
    const result = validateProposalForm({ recipient: VALID_ADDRESS, amount: 'abc', memo: '' });
    expect(result.errors.amount).toBeTruthy();
  });

  it('rejects an amount over the per-proposal limit', () => {
    const result = validateProposalForm({
      recipient: VALID_ADDRESS,
      amount: '1500',
      memo: '',
      proposalLimit: '1000',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.amount).toMatch(/per-proposal limit/i);
  });

  it('allows an amount exactly at the per-proposal limit', () => {
    const result = validateProposalForm({
      recipient: VALID_ADDRESS,
      amount: '1000',
      memo: '',
      proposalLimit: '1000',
    });
    expect(result.isValid).toBe(true);
  });

  it('ignores a zero/undefined proposal limit (no limit configured)', () => {
    const result = validateProposalForm({
      recipient: VALID_ADDRESS,
      amount: '999999',
      memo: '',
      proposalLimit: '0',
    });
    expect(result.isValid).toBe(true);
  });

  it('rejects an amount that exceeds available balance', () => {
    const result = validateProposalForm({
      recipient: VALID_ADDRESS,
      amount: '50',
      memo: '',
      availableBalance: '10',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.amount).toMatch(/available balance/i);
  });

  it('allows an amount within available balance', () => {
    const result = validateProposalForm({
      recipient: VALID_ADDRESS,
      amount: '5',
      memo: '',
      availableBalance: '10',
    });
    expect(result.isValid).toBe(true);
  });

  it('checks the proposal limit before falling back to balance', () => {
    const result = validateProposalForm({
      recipient: VALID_ADDRESS,
      amount: '2000',
      memo: '',
      proposalLimit: '1000',
      availableBalance: '5000',
    });
    expect(result.errors.amount).toMatch(/per-proposal limit/i);
  });

  it('rejects a memo longer than the max length', () => {
    const result = validateProposalForm({
      recipient: VALID_ADDRESS,
      amount: '10',
      memo: 'x'.repeat(MAX_MEMO_LENGTH + 1),
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.memo).toBeTruthy();
  });

  it('allows a memo exactly at the max length', () => {
    const result = validateProposalForm({
      recipient: VALID_ADDRESS,
      amount: '10',
      memo: 'x'.repeat(MAX_MEMO_LENGTH),
    });
    expect(result.isValid).toBe(true);
  });

  it('allows an empty memo', () => {
    const result = validateProposalForm({ recipient: VALID_ADDRESS, amount: '10', memo: '' });
    expect(result.isValid).toBe(true);
  });
});
