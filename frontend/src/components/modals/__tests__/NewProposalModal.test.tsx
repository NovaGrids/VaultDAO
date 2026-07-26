import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NewProposalModal, { type NewProposalFormData } from '../NewProposalModal';

const mockGetListMode = vi.fn().mockResolvedValue('Disabled');
const mockIsWhitelisted = vi.fn().mockResolvedValue(true);
const mockIsBlacklisted = vi.fn().mockResolvedValue(false);
const mockShowToast = vi.fn();

vi.mock('../../../hooks/useVaultContract', () => ({
  useVaultContract: () => ({
    getListMode: mockGetListMode,
    isWhitelisted: mockIsWhitelisted,
    isBlacklisted: mockIsBlacklisted,
  }),
}));

vi.mock('../../../hooks/useToast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const VALID_ADDRESS = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';

type ModalOverrides = Partial<React.ComponentProps<typeof NewProposalModal>> & {
  formData?: Partial<NewProposalFormData>;
};

function StatefulModal({ formData: initialFormData, ...overrides }: ModalOverrides) {
  const [formData, setFormData] = React.useState<NewProposalFormData>({
    recipient: '',
    token: 'NATIVE',
    amount: '',
    memo: '',
    ...initialFormData,
  });

  return (
    <NewProposalModal
      isOpen
      loading={false}
      selectedTemplateName={null}
      formData={formData}
      onFieldChange={(field, value) => setFormData((prev) => ({ ...prev, [field]: value }))}
      onSubmit={vi.fn((e) => e.preventDefault())}
      onOpenTemplateSelector={vi.fn()}
      onSaveAsTemplate={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

function renderModal(overrides: ModalOverrides = {}) {
  return render(<StatefulModal {...overrides} />);
}

describe('NewProposalModal real-time validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetListMode.mockResolvedValue('Disabled');
    mockIsWhitelisted.mockResolvedValue(true);
    mockIsBlacklisted.mockResolvedValue(false);
  });

  it('does not show errors before the user interacts with the form', async () => {
    renderModal();
    await waitFor(() => expect(mockGetListMode).toHaveBeenCalled());

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables submit while the form is invalid (empty fields)', async () => {
    renderModal();
    await waitFor(() => expect(mockGetListMode).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: /submit proposal/i })).toBeDisabled();
  });

  it('shows an inline error after leaving an invalid recipient field', async () => {
    renderModal();
    await waitFor(() => expect(mockGetListMode).toHaveBeenCalled());

    const recipientInput = screen.getByPlaceholderText('Recipient address');
    fireEvent.change(recipientInput, { target: { value: 'not-a-valid-address' } });
    fireEvent.blur(recipientInput);

    expect(await screen.findByText(/valid stellar address/i)).toBeInTheDocument();
  });

  it('shows an inline error for a non-positive amount', async () => {
    renderModal();
    await waitFor(() => expect(mockGetListMode).toHaveBeenCalled());

    const amountInput = screen.getByPlaceholderText('Amount');
    fireEvent.change(amountInput, { target: { value: '0' } });
    fireEvent.blur(amountInput);

    expect(await screen.findByText(/positive number/i)).toBeInTheDocument();
  });

  it('shows an inline error when amount exceeds the per-proposal limit', async () => {
    renderModal({ proposalLimit: '1000' });
    await waitFor(() => expect(mockGetListMode).toHaveBeenCalled());

    const amountInput = screen.getByPlaceholderText('Amount');
    fireEvent.change(amountInput, { target: { value: '5000' } });
    fireEvent.blur(amountInput);

    expect(await screen.findByText(/per-proposal limit/i)).toBeInTheDocument();
  });

  it('shows an inline error when amount exceeds available balance', async () => {
    renderModal({ availableBalance: '10' });
    await waitFor(() => expect(mockGetListMode).toHaveBeenCalled());

    const amountInput = screen.getByPlaceholderText('Amount');
    fireEvent.change(amountInput, { target: { value: '50' } });
    fireEvent.blur(amountInput);

    expect(await screen.findByText(/available balance/i)).toBeInTheDocument();
  });

  it('flags a recipient rejected by the whitelist', async () => {
    mockGetListMode.mockResolvedValue('Whitelist');
    mockIsWhitelisted.mockResolvedValue(false);

    renderModal({ formData: { recipient: '', token: 'NATIVE', amount: '', memo: '' } });
    await waitFor(() => expect(mockGetListMode).toHaveBeenCalled());

    const recipientInput = screen.getByPlaceholderText('Recipient address');
    fireEvent.change(recipientInput, { target: { value: VALID_ADDRESS } });

    expect(await screen.findByText(/not on the whitelist/i)).toBeInTheDocument();
  });

  it('enables submit once recipient and amount are both valid', async () => {
    renderModal({
      formData: { recipient: VALID_ADDRESS, token: 'NATIVE', amount: '10', memo: '' },
    });
    await waitFor(() => expect(mockGetListMode).toHaveBeenCalled());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submit proposal/i })).not.toBeDisabled();
    });
  });
});
