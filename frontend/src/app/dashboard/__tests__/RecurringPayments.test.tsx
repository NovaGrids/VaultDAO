import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RecurringPayments from '../RecurringPayments';
import { makeVaultContractMock, makeActionReadinessMock, makeRecurringPayment } from '../../../test/mocks';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../../../hooks/useVaultContract');
vi.mock('../../../hooks/useActionReadiness');
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ notify: vi.fn() }) }));
vi.mock('../../../components/modals/CreateRecurringPaymentModal', () => ({ default: () => null }));
vi.mock('../../../components/modals/ConfirmationModal', () => ({ default: () => null }));
vi.mock('../../../components/ReadinessWarning', () => ({ default: () => null }));

import { useVaultContract } from '../../../hooks/useVaultContract';
import { useActionReadiness } from '../../../hooks/useActionReadiness';

const mockUseVaultContract = vi.mocked(useVaultContract);
const mockUseActionReadiness = vi.mocked(useActionReadiness);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('RecurringPayments page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActionReadiness.mockReturnValue(makeActionReadinessMock() as ReturnType<typeof useActionReadiness>);
  });

  it('shows a loading spinner while payments are being fetched', () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: true,
        getRecurringPayments: vi.fn(() => new Promise(() => {})),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RecurringPayments />);
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows empty state when no recurring payments exist', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getRecurringPayments: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RecurringPayments />);

    await waitFor(() => {
      expect(screen.getByText(/no recurring payments/i)).toBeInTheDocument();
    });
  });

  it('renders payment cards when payments are returned', async () => {
    const payments = [
      makeRecurringPayment({ id: 'rp-1', memo: 'Monthly salary', status: 'active' }),
      makeRecurringPayment({ id: 'rp-2', memo: 'Office rent', status: 'paused' }),
    ];

    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getRecurringPayments: vi.fn().mockResolvedValue(payments),
        getRecurringPaymentHistory: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RecurringPayments />);

    await waitFor(() => {
      expect(screen.getByText('Monthly salary')).toBeInTheDocument();
      expect(screen.getByText('Office rent')).toBeInTheDocument();
    });
  });

  it('shows due badge for payments that are past their next payment time', async () => {
    const duePayment = makeRecurringPayment({
      id: 'rp-due',
      memo: 'Overdue payment',
      status: 'active',
      nextPaymentTime: Date.now() - 1000, // already past
    });

    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getRecurringPayments: vi.fn().mockResolvedValue([duePayment]),
        getRecurringPaymentHistory: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RecurringPayments />);

    await waitFor(() => {
      expect(screen.getByText('Overdue payment')).toBeInTheDocument();
      // "Due now" countdown text
      expect(screen.getByText('Due now')).toBeInTheDocument();
    });
  });

  it('shows paused status for paused payments', async () => {
    const pausedPayment = makeRecurringPayment({
      id: 'rp-paused',
      memo: 'Paused subscription',
      status: 'paused',
    });

    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getRecurringPayments: vi.fn().mockResolvedValue([pausedPayment]),
        getRecurringPaymentHistory: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RecurringPayments />);

    await waitFor(() => {
      expect(screen.getByText('Paused subscription')).toBeInTheDocument();
    });
  });
});
