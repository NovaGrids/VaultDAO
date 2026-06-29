import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import RecurringPaymentCalendar from '../RecurringPaymentCalendar';
import type { RecurringPayment } from '../../hooks/useVaultContract';

const MS_PER_DAY = 86_400_000;
const REAL_NOW = Date.now();
const REAL_DATE = new Date();
const CURRENT_YEAR = REAL_DATE.getFullYear();
const CURRENT_MONTH = REAL_DATE.getMonth();
const CURRENT_DAY = REAL_DATE.getDate();

const makePayment = (overrides: Partial<RecurringPayment> = {}): RecurringPayment => ({
  id: 'rp-1',
  recipient: 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
  token: 'NATIVE',
  amount: '50000000',
  memo: 'Monthly salary',
  interval: 2592000,
  nextPaymentTime: REAL_NOW + 86400000,
  totalPayments: 5,
  status: 'active',
  createdAt: REAL_NOW - 86400000 * 30,
  creator: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
  ...overrides,
});

vi.mock('lucide-react', () => ({
  ChevronLeft: (props: Record<string, unknown>) => <span data-testid="chevron-left" {...props}>←</span>,
  ChevronRight: (props: Record<string, unknown>) => <span data-testid="chevron-right" {...props}>→</span>,
  Calendar: (props: Record<string, unknown>) => <span data-testid="calendar-icon" {...props}>📅</span>,
  DollarSign: (props: Record<string, unknown>) => <span data-testid="dollar-icon" {...props}>$</span>,
  TrendingUp: (props: Record<string, unknown>) => <span data-testid="trending-icon" {...props}>↗</span>,
}));

const monthName = (m: number) => [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'][m];

describe('RecurringPaymentCalendar', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(REAL_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders empty calendar with no payments', () => {
    render(<RecurringPaymentCalendar payments={[]} />);
    expect(screen.getByText(`${monthName(CURRENT_MONTH)} ${CURRENT_YEAR}`)).toBeInTheDocument();
    expect(screen.getByText('Next 30 Days Summary')).toBeInTheDocument();
  });

  it('renders payments on their correct due dates', () => {
    const payments = [
      makePayment({
        id: 'rp-1',
        memo: 'Salary',
        nextPaymentTime: REAL_NOW + 1 * MS_PER_DAY,
      }),
      makePayment({
        id: 'rp-2',
        memo: 'Rent',
        nextPaymentTime: REAL_NOW,
      }),
    ];

    render(<RecurringPaymentCalendar payments={payments} />);

    const todayLabel = new RegExp(`${CURRENT_DAY} ${monthName(CURRENT_MONTH)}`);
    const todayBtns = screen.getAllByRole('button', { name: todayLabel });
    expect(todayBtns[0].querySelector('.rounded-full')).toBeInTheDocument();

    const futureDay = CURRENT_DAY + 1;
    const futureLabel = new RegExp(`${futureDay} ${monthName(CURRENT_MONTH)}`);
    const futureBtns = screen.getAllByRole('button', { name: futureLabel });
    expect(futureBtns[0].querySelector('.rounded-full')).toBeInTheDocument();
  });

  it('clicking a date shows detail panel with payment info', () => {
    const payments = [
      makePayment({
        id: 'rp-1',
        memo: 'Test payment',
        amount: '10000000',
        nextPaymentTime: REAL_NOW,
      }),
    ];

    render(<RecurringPaymentCalendar payments={payments} />);

    const todayLabel = new RegExp(`${CURRENT_DAY} ${monthName(CURRENT_MONTH)}`);
    const todayBtns = screen.getAllByRole('button', { name: todayLabel });
    fireEvent.click(todayBtns[0]);

    expect(screen.getByText('Test payment')).toBeInTheDocument();
    expect(screen.getAllByText(/1.00 XLM/).length).toBeGreaterThan(0);
  });

  it('navigation changes displayed month', () => {
    render(<RecurringPaymentCalendar payments={[]} />);

    expect(screen.getByText(`${monthName(CURRENT_MONTH)} ${CURRENT_YEAR}`)).toBeInTheDocument();

    const nextBtn = screen.getByRole('button', { name: /next month/i });
    fireEvent.click(nextBtn);

    const nextMonth = CURRENT_MONTH + 1 > 11 ? 0 : CURRENT_MONTH + 1;
    const nextYear = CURRENT_MONTH + 1 > 11 ? CURRENT_YEAR + 1 : CURRENT_YEAR;
    expect(screen.getByText(`${monthName(nextMonth)} ${nextYear}`)).toBeInTheDocument();
    expect(screen.queryByText(`${monthName(CURRENT_MONTH)} ${CURRENT_YEAR}`)).not.toBeInTheDocument();

    const prevBtn = screen.getByRole('button', { name: /previous month/i });
    fireEvent.click(prevBtn);

    expect(screen.getByText(`${monthName(CURRENT_MONTH)} ${CURRENT_YEAR}`)).toBeInTheDocument();
  });

  it('shows next 30 days summary with correct totals', () => {
    const payments = [
      makePayment({
        id: 'rp-1',
        amount: '10000000',
        nextPaymentTime: REAL_NOW + 5 * MS_PER_DAY,
      }),
      makePayment({
        id: 'rp-2',
        amount: '20000000',
        nextPaymentTime: REAL_NOW + 10 * MS_PER_DAY,
      }),
      makePayment({
        id: 'rp-3',
        amount: '5000000',
        nextPaymentTime: REAL_NOW + 60 * MS_PER_DAY,
      }),
    ];

    render(<RecurringPaymentCalendar payments={payments} />);

    expect(screen.getByText('Total Outflow').parentElement?.textContent).toMatch(/3.00 XLM/);
    expect(screen.getByText('Largest Single Payment').parentElement?.textContent).toMatch(/2.00 XLM/);
  });

  it('shows colored dots by recipient', () => {
    const payments = [
      makePayment({
        id: 'rp-1',
        recipient: 'GAAA1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
        nextPaymentTime: REAL_NOW,
      }),
      makePayment({
        id: 'rp-2',
        recipient: 'GBBB1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
        nextPaymentTime: REAL_NOW,
      }),
    ];

    render(<RecurringPaymentCalendar payments={payments} />);

    const todayLabel = new RegExp(`${CURRENT_DAY} ${monthName(CURRENT_MONTH)}`);
    const todayBtns = screen.getAllByRole('button', { name: todayLabel });
    const dots = todayBtns[0].querySelectorAll('.rounded-full');
    expect(dots.length).toBe(2);
  });

  it('clicking an empty date shows no payments message', () => {
    const payments = [
      makePayment({
        id: 'rp-1',
        nextPaymentTime: REAL_NOW + 5 * MS_PER_DAY,
      }),
    ];

    render(<RecurringPaymentCalendar payments={payments} />);

    const targetDay = CURRENT_DAY + 5 > 28 ? CURRENT_DAY - 3 : CURRENT_DAY + 5;
    const targetLabel = new RegExp(`${targetDay} ${monthName(CURRENT_MONTH)}`);
    const targetBtns = screen.getAllByRole('button', { name: targetLabel });
    fireEvent.click(targetBtns[0]);

    expect(screen.getByText(/No payments due on this date/i)).toBeInTheDocument();
  });

  it('today has ring highlight', () => {
    render(<RecurringPaymentCalendar payments={[]} />);

    const todayLabel = new RegExp(`${CURRENT_DAY} ${monthName(CURRENT_MONTH)}`);
    const todayBtns = screen.getAllByRole('button', { name: todayLabel });
    expect(todayBtns[0].className).toContain('ring-2');
    expect(todayBtns[0].className).toContain('ring-purple-500');
  });

  it('ledgerToDate utility uses 5s per ledger', async () => {
    const GENESIS = 1436387400000;
    const LEDGER_MS = 5000;
    const ledger = 100;
    const expected = new Date(GENESIS + ledger * LEDGER_MS);

    const mod = await import('../RecurringPaymentCalendar');
    const ledgerToDate: (n: number) => Date = mod.ledgerToDate;
    expect(ledgerToDate(100).getTime()).toBe(expected.getTime());
  });
});
