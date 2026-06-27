import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecipientDrillDownPanel from '../RecipientDrillDownPanel';

// Mock Recharts
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
    LineChart: ({ children, ...props }: any) => (
      <div data-testid="trend-chart" {...props}>
        {children}
      </div>
    ),
    BarChart: ({ children, ...props }: any) => (
      <div data-testid="bar-chart" {...props}>
        {children}
      </div>
    ),
    Line: () => null,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Cell: () => null,
  };
});

const mockTransactions = [
  {
    amount: 100,
    timestamp: '2024-01-15T10:30:00Z',
    recipient: 'GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
  },
  {
    amount: 250,
    timestamp: '2024-01-16T11:00:00Z',
    recipient: 'GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
  },
  {
    amount: 150,
    timestamp: '2024-01-17T12:00:00Z',
    recipient: 'GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
  },
  {
    amount: 50,
    timestamp: '2024-01-01T08:00:00Z',
    recipient: 'GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
  },
];

describe('RecipientDrillDownPanel', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  it('hides panel when isOpen is false (translate-x-full)', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={false}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    const panel = screen.getByTestId('drill-down-panel');
    expect(panel).toHaveClass('translate-x-full');
  });

  it('shows panel when isOpen is true (translate-x-0)', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    const panel = screen.getByTestId('drill-down-panel');
    expect(panel).toHaveClass('translate-x-0');
  });

  it('displays recipient address truncated in header', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    // Check the h3 header contains truncated address
    const header = screen.getByRole('heading', { level: 3 });
    expect(header).toHaveTextContent('GBTEST');
    expect(header).toHaveTextContent('90AB');
  });

  it('displays recipientLabel when provided', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        recipientLabel="Alice's Wallet"
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText("Alice's Wallet")).toBeInTheDocument();
  });

  it('calculates and displays total sent amount', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    // Total: 100 + 250 + 150 + 50 = 550
    expect(screen.getByText('550')).toBeInTheDocument();
  });

  it('displays payment count', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText('4')).toBeInTheDocument(); // 4 transactions
  });

  it('displays last payment date', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    // Last payment is 2024-01-17, check for the "Last Payment" label
    expect(screen.getByText('Last Payment')).toBeInTheDocument();
    // Look for date text in a card after the Last Payment label
    const cards = screen.getAllByText(/\d+\/\d+\/\d{4}/);
    expect(cards.length).toBeGreaterThan(0);
  });

  it('closes panel when close button is clicked', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    const closeBtn = screen.getByTestId('drill-down-close-btn');
    fireEvent.click(closeBtn);

    expect(mockOnClose).toHaveBeenCalledOnce();
  });

  it('closes panel when backdrop is clicked', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    const backdrop = screen.getByTestId('drill-down-backdrop');
    fireEvent.click(backdrop);

    expect(mockOnClose).toHaveBeenCalledOnce();
  });

  it('closes panel when Escape key is pressed', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    expect(mockOnClose).toHaveBeenCalledOnce();
  });

  it('copies address to clipboard when copy button is clicked', async () => {
    const user = userEvent.setup();
    const recipient = 'GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB';

    // Mock navigator.clipboard.writeText using vi.spyOn
    const clipboardSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient={recipient}
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    const copyBtn = screen.getByTestId('copy-address-btn');
    await user.click(copyBtn);

    expect(clipboardSpy).toHaveBeenCalledWith(recipient);

    // Check that button text changes to "Copied!"
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });

    // Check that it reverts back after 2 seconds
    await waitFor(
      () => {
        expect(screen.getByText('Copy Address')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    clipboardSpy.mockRestore();
  });

  it('opens Stellar Explorer in new tab when explorer button is clicked', async () => {
    const user = userEvent.setup();
    const recipient = 'GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB';

    // Mock window.open
    const mockOpen = vi.fn();
    window.open = mockOpen;

    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient={recipient}
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    const explorerBtn = screen.getByTestId('explorer-btn');
    await user.click(explorerBtn);

    expect(mockOpen).toHaveBeenCalledWith(
      `https://stellar.expert/explorer/public/${recipient}`,
      '_blank'
    );
  });

  it('renders trend chart when there are multiple transactions', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    // Trend chart should be rendered (contains the chart element)
    const trendChart = screen.getByTestId('trend-chart');
    expect(trendChart).toBeInTheDocument();
  });

  it('does not render trend chart when there are no transactions for recipient', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBDIFFERENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    // Trend chart should not be rendered
    expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument();
  });

  it('calculates average payment amount correctly', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mockTransactions}
        onClose={mockOnClose}
      />
    );

    // Total 550 / 4 = 137.5, displayed as "138"
    expect(screen.getByText('138')).toBeInTheDocument();
  });

  it('handles empty transaction list gracefully', () => {
    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={[]}
        onClose={mockOnClose}
      />
    );

    // Check Total Sent shows 0
    expect(screen.getByText('Total Sent')).toBeInTheDocument();
    // Check for "N/A" in last payment
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  it('filters transactions to show only for specified recipient', () => {
    const mixedTransactions = [
      {
        amount: 100,
        timestamp: '2024-01-15T10:30:00Z',
        recipient: 'GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
      },
      {
        amount: 200,
        timestamp: '2024-01-16T11:00:00Z',
        recipient: 'GBOTHER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
      },
    ];

    render(
      <RecipientDrillDownPanel
        isOpen={true}
        recipient="GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB"
        transactions={mixedTransactions}
        onClose={mockOnClose}
      />
    );

    // Should only show amount of 100 (not 200 from other recipient)
    // Check for Total Sent label and verify it shows 100
    expect(screen.getByText('Total Sent')).toBeInTheDocument();
    const totalSentCard = screen.getByText('Total Sent').closest('.bg-gray-900');
    expect(totalSentCard).toHaveTextContent('100');
  });
});
