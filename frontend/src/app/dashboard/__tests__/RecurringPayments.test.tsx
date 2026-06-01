import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RecurringPayments from '../RecurringPayments';
import {
  makeVaultContractMock,
  makeActionReadinessMock,
  makeRecurringPayment,
} from '../../../test/mocks';

// ─── Module mocks ─────────────────────────────────────────────────────────────
vi.mock('../../../hooks/useVaultContract');
vi.mock('../../../hooks/useActionReadiness');
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ notify: vi.fn() }) }));
vi.mock('../../../components/modals/CreateRecurringPaymentModal', () => ({ default: () => null }));
vi.mock('../../../components/modals/ConfirmationModal', () => ({
  default: ({ isOpen, title, onConfirm }: { isOpen: boolean; title: string; onConfirm: () => void }) =>
    isOpen ? (
      <div data-testid="confirmation-modal">
        <span>{title}</span>
        <button onClick={onConfirm}>confirm</button>
      </div>
    ) : null,
}));
vi.mock('../../../components/ReadinessWarning', () => ({ default: () => null }));

// Mock recharts so it renders without canvas errors in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScatterChart: ({ children }: { children: React.ReactNode }) => <div data-testid="scatter-chart">{children}</div>,
  Scatter: ({ data }: { data: unknown[] }) => (
    <div data-testid="scatter-data" data-count={data?.length ?? 0} />
  ),
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Cell: () => null,
}));

import { useVaultContract } from '../../../hooks/useVaultContract';
import { useActionReadiness } from '../../../hooks/useActionReadiness';

const mockUseVaultContract = vi.mocked(useVaultContract);
const mockUseActionReadiness = vi.mocked(useActionReadiness);

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('RecurringPayments page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    mockUseActionReadiness.mockReturnValue(
      makeActionReadinessMock() as ReturnType<typeof useActionReadiness>,
    );
  });

  it('shows a loading spinner while payments are being fetched', () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: true,
        getRecurringPayments: vi.fn(() => new Promise(() => {})),
      }) as ReturnType<typeof useVaultContract>,
    );

    render(<RecurringPayments />);
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows empty state when no recurring payments exist', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getRecurringPayments: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>,
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
      }) as ReturnType<typeof useVaultContract>,
    );

    render(<RecurringPayments />);

    await waitFor(() => {
      expect(screen.getByText('Monthly salary')).toBeInTheDocument();
      expect(screen.getByText('Office rent')).toBeInTheDocument();
    });
  });

  it('shows overdue red badge for payments past their next payment time', async () => {
    const overduePayment = makeRecurringPayment({
      id: 'rp-overdue',
      memo: 'Overdue payment',
      status: 'active',
      nextPaymentTime: Date.now() - 10_000, // already past
    });

    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getRecurringPayments: vi.fn().mockResolvedValue([overduePayment]),
        getRecurringPaymentHistory: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>,
    );

    render(<RecurringPayments />);

    await waitFor(() => {
      expect(screen.getByText('Overdue payment')).toBeInTheDocument();
      // The Overdue status badge should be present
      expect(screen.getByText('Overdue')).toBeInTheDocument();
    });
  });

  it('shows paused status badge for paused payments', async () => {
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
      }) as ReturnType<typeof useVaultContract>,
    );

    render(<RecurringPayments />);

    await waitFor(() => {
      expect(screen.getByText('Paused subscription')).toBeInTheDocument();
      expect(screen.getByText('Paused')).toBeInTheDocument();
    });
  });

  it('calls cancelRecurringPayment when Pause is confirmed (Treasurer role)', async () => {
    const cancelFn = vi.fn().mockResolvedValue(undefined);
    const activePayment = makeRecurringPayment({
      id: 'rp-active',
      memo: 'Active payment',
      status: 'active',
      nextPaymentTime: Date.now() + 86_400_000,
    });

    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getRecurringPayments: vi.fn().mockResolvedValue([activePayment]),
        getRecurringPaymentHistory: vi.fn().mockResolvedValue([]),
        cancelRecurringPayment: cancelFn,
        // Treasurer role = 1
        getVaultConfig: vi.fn().mockResolvedValue({ currentUserRole: 1 }),
      }) as ReturnType<typeof useVaultContract>,
    );

    render(<RecurringPayments />);

    // Wait for the card to render
    await waitFor(() => expect(screen.getByText('Active payment')).toBeInTheDocument());

    // Click the Pause button
    const pauseBtn = screen.getByRole('button', { name: /pause/i });
    fireEvent.click(pauseBtn);

    // Confirmation modal should appear
    await waitFor(() => expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument());

    // Confirm the action
    fireEvent.click(screen.getByText('confirm'));

    await waitFor(() => {
      expect(cancelFn).toHaveBeenCalledWith('rp-active');
    });
  });

  it('renders the calendar view with payment dots when toggled', async () => {
    const payments = [
      makeRecurringPayment({ id: 'rp-1', memo: 'Salary', status: 'active', nextPaymentTime: Date.now() + 5 * 86_400_000 }),
      makeRecurringPayment({ id: 'rp-2', memo: 'Rent',   status: 'active', nextPaymentTime: Date.now() + 10 * 86_400_000 }),
    ];

    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getRecurringPayments: vi.fn().mockResolvedValue(payments),
        getRecurringPaymentHistory: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>,
    );

    render(<RecurringPayments />);

    await waitFor(() => expect(screen.getByText('Salary')).toBeInTheDocument());

    // Switch to calendar view
    const calendarBtn = screen.getByRole('button', { name: /calendar view/i });
    fireEvent.click(calendarBtn);

    // The scatter chart should be rendered
    await waitFor(() => {
      expect(screen.getByTestId('scatter-chart')).toBeInTheDocument();
      // Both payments should appear as dots
      const scatter = screen.getByTestId('scatter-data');
      expect(Number(scatter.getAttribute('data-count'))).toBe(2);
    });
  });

  it('shows missed payments warning badge when missedPayments > 0', async () => {
    // Simulate backend returning overdue data with missedPayments
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              paymentId: 'rp-missed',
              computedStatus: 'overdue',
              missedPayments: 3,
              ledgersUntilDue: -300,
            },
          ],
        }),
      }),
    );

    const payment = makeRecurringPayment({
      id: 'rp-missed',
      memo: 'Missed payment',
      status: 'active',
      nextPaymentTime: Date.now() - 10_000,
    });

    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getRecurringPayments: vi.fn().mockResolvedValue([payment]),
        getRecurringPaymentHistory: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>,
    );

    render(<RecurringPayments />);

    await waitFor(() => {
      expect(screen.getByText('Missed payment')).toBeInTheDocument();
      expect(screen.getByText(/3 missed/i)).toBeInTheDocument();
    });
  });
});
