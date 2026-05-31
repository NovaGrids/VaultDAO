/**
 * Tests for ProposalWizard component.
 *
 * Covers:
 *  - Step navigation (next/back, validation gates)
 *  - Draft persistence (save to localStorage, restore on open)
 *  - Validation errors shown inline
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProposalWizard } from '../modals/ProposalWizard';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../hooks/useVaultContract', () => ({
  useVaultContract: () => ({
    proposeTransfer: vi.fn().mockResolvedValue('mock-tx-hash'),
    simulateProposeTransfer: vi.fn().mockResolvedValue({
      success: true,
      fee: '100',
      feeXLM: '0.0000100',
      resourceFee: '50',
      stateChanges: [],
      timestamp: Date.now(),
    }),
  }),
}));

vi.mock('../../hooks/useWallet', () => ({
  useWallet: () => ({
    isConnected: true,
    address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
    network: 'TESTNET',
  }),
}));

vi.mock('../../hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WALLET = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';
const VALID_RECIPIENT = 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';

function renderWizard(props: Partial<React.ComponentProps<typeof ProposalWizard>> = {}) {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const result = render(
    <ProposalWizard
      isOpen={true}
      walletAddress={WALLET}
      onClose={onClose}
      onSuccess={onSuccess}
      {...props}
    />
  );
  return { ...result, onClose, onSuccess };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProposalWizard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders the wizard when isOpen is true', () => {
    renderWizard();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Create Proposal')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    renderWizard({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows step 1 content by default', () => {
    renderWizard();
    expect(screen.getByLabelText(/recipient address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
  });

  it('shows progress bar with 4 steps', () => {
    renderWizard();
    expect(screen.getByRole('navigation', { name: /progress/i })).toBeInTheDocument();
    // 4 step labels visible on desktop
    expect(screen.getByText('Basic Details')).toBeInTheDocument();
    expect(screen.getByText('Conditions')).toBeInTheDocument();
    expect(screen.getByText('Insurance')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  // ── Step navigation ────────────────────────────────────────────────────────

  it('blocks advancing to step 2 when required fields are empty', async () => {
    renderWizard();
    const nextBtn = screen.getByRole('button', { name: /next/i });
    await userEvent.click(nextBtn);

    // Should still be on step 1 — validation errors shown
    await waitFor(() => {
      expect(screen.getByText(/recipient address is required/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/recipient address/i)).toBeInTheDocument();
  });

  it('shows validation error for invalid Stellar address', async () => {
    renderWizard();
    const recipientInput = screen.getByLabelText(/recipient address/i);
    await userEvent.type(recipientInput, 'not-a-stellar-address');
    await userEvent.tab(); // trigger blur

    await waitFor(() => {
      expect(screen.getByText(/valid stellar address/i)).toBeInTheDocument();
    });
  });

  it('shows validation error for non-positive amount', async () => {
    renderWizard();
    const amountInput = screen.getByLabelText(/amount/i);
    await userEvent.type(amountInput, '-5');
    await userEvent.tab();

    await waitFor(() => {
      expect(screen.getByText(/positive number/i)).toBeInTheDocument();
    });
  });

  it('advances to step 2 when step 1 is valid', async () => {
    renderWizard();

    await userEvent.type(screen.getByLabelText(/recipient address/i), VALID_RECIPIENT);
    await userEvent.type(screen.getByLabelText(/amount/i), '100');

    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      // Step 2 content: conditions heading
      expect(screen.getByText(/execution conditions/i)).toBeInTheDocument();
    });
  });

  it('can navigate back from step 2 to step 1', async () => {
    renderWizard();

    // Fill step 1 and advance
    await userEvent.type(screen.getByLabelText(/recipient address/i), VALID_RECIPIENT);
    await userEvent.type(screen.getByLabelText(/amount/i), '100');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText(/execution conditions/i)).toBeInTheDocument();
    });

    // Go back
    await userEvent.click(screen.getByRole('button', { name: /back/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/recipient address/i)).toBeInTheDocument();
    });
  });

  it('back button is disabled on step 1', () => {
    renderWizard();
    const backBtn = screen.getByRole('button', { name: /already on first step/i });
    expect(backBtn).toBeDisabled();
  });

  it('shows Sign & Submit button on step 4', async () => {
    renderWizard();

    // Navigate through all steps
    await userEvent.type(screen.getByLabelText(/recipient address/i), VALID_RECIPIENT);
    await userEvent.type(screen.getByLabelText(/amount/i), '100');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByText(/execution conditions/i));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByText(/insurance coverage/i));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign.*submit/i })).toBeInTheDocument();
    });
  });

  // ── Draft persistence ──────────────────────────────────────────────────────

  it('saves draft to localStorage as user types', async () => {
    renderWizard();
    const recipientInput = screen.getByLabelText(/recipient address/i);
    await userEvent.type(recipientInput, VALID_RECIPIENT);

    await waitFor(() => {
      const key = `vaultdao_proposal_draft_${WALLET}`;
      const raw = localStorage.getItem(key);
      expect(raw).not.toBeNull();
      const draft = JSON.parse(raw!);
      expect(draft.recipient).toBe(VALID_RECIPIENT);
    });
  });

  it('restores draft from localStorage on open', async () => {
    // Pre-seed a draft
    const draftKey = `vaultdao_proposal_draft_${WALLET}`;
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        recipient: VALID_RECIPIENT,
        token: 'NATIVE',
        amount: '250',
        memo: 'Restored memo',
        priority: '1',
        conditions: [],
        conditionLogic: '0',
        dependsOnProposalId: '',
        insuranceAmount: '0',
        enableInsurance: false,
      })
    );

    renderWizard();

    await waitFor(() => {
      const recipientInput = screen.getByLabelText(/recipient address/i) as HTMLInputElement;
      expect(recipientInput.value).toBe(VALID_RECIPIENT);
    });

    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    expect(amountInput.value).toBe('250');
  });

  it('clears draft on successful submission', async () => {
    const draftKey = `vaultdao_proposal_draft_${WALLET}`;
    localStorage.setItem(draftKey, JSON.stringify({ recipient: VALID_RECIPIENT }));

    const { onSuccess } = renderWizard();

    // Fill and navigate to step 4
    await userEvent.type(screen.getByLabelText(/recipient address/i), VALID_RECIPIENT);
    await userEvent.type(screen.getByLabelText(/amount/i), '100');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => screen.getByText(/execution conditions/i));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => screen.getByText(/insurance coverage/i));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => screen.getByRole('button', { name: /sign.*submit/i }));

    await userEvent.click(screen.getByRole('button', { name: /sign.*submit/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('mock-tx-hash');
      expect(localStorage.getItem(draftKey)).toBeNull();
    });
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it('has role=dialog with aria-modal and aria-labelledby', () => {
    renderWizard();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'wizard-title');
  });

  it('closes on Escape key', async () => {
    const { onClose } = renderWizard();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('close button calls onClose', async () => {
    const { onClose } = renderWizard();
    await userEvent.click(screen.getByRole('button', { name: /close proposal wizard/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
