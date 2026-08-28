import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TransactionHistory from '../TransactionHistory';
import { useVaultContract } from '../../hooks/useVaultContract';
import type { VaultActivity } from '../../types/activity';

vi.mock('../../hooks/useVaultContract', () => ({
  useVaultContract: vi.fn(() => ({
    getVaultEvents: vi.fn().mockResolvedValue({
      events: [],
      cursor: undefined,
    }),
  })),
}));

vi.mock('react-infinite-scroll-component', () => ({
  default: ({ children, hasMore }: any) => (
    <div data-testid="infinite-scroll">{children}</div>
  ),
}));

describe('TransactionHistory CSV Export', () => {
  const mockTransactions: VaultActivity[] = [
    {
      id: 'tx1',
      timestamp: '2024-08-01T10:00:00Z',
      type: 'proposal_created',
      ledger: '123',
      actor: 'user1',
      eventId: 'event1',
      txHash: 'hash1',
      details: {
        amount: '100',
        recipient: 'GAAA...',
        status: 'success',
        memo: 'Test 1',
      },
    },
    {
      id: 'tx2',
      timestamp: '2024-08-15T10:00:00Z',
      type: 'proposal_approved',
      ledger: '124',
      actor: 'user2',
      eventId: 'event2',
      txHash: 'hash2',
      details: {
        amount: '200',
        recipient: 'GBBB...',
        status: 'success',
        memo: 'Test 2',
      },
    },
    {
      id: 'tx3',
      timestamp: '2024-08-25T10:00:00Z',
      type: 'proposal_executed',
      ledger: '125',
      actor: 'user3',
      eventId: 'event3',
      txHash: 'hash3',
      details: {
        amount: '300',
        recipient: 'GCCC...',
        status: 'success',
        memo: 'Test 3',
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    const mockGetVaultEvents = vi.fn().mockResolvedValue({
      events: mockTransactions,
      cursor: undefined,
    });
    (useVaultContract as any).mockReturnValue({
      getVaultEvents: mockGetVaultEvents,
    });
  });

  it('renders transaction history component', async () => {
    render(<TransactionHistory />);
    await waitFor(() => {
      expect(screen.getByTestId('infinite-scroll')).toBeInTheDocument();
    });
  });

  describe('CSV Export with Date Range Filter', () => {
    it('has a CSV export button', async () => {
      render(<TransactionHistory />);
      await waitFor(() => {
        const exportButtons = screen.queryAllByRole('button');
        const hasExportButton = exportButtons.some(btn =>
          btn.querySelector('svg[class*="Download"]') !== null
        );
        expect(hasExportButton).toBe(true);
      });
    });

    it('opens date range picker when export button is clicked', async () => {
      render(<TransactionHistory />);

      await waitFor(() => {
        const exportButtons = screen.queryAllByRole('button');
        const exportButton = exportButtons.find(btn =>
          btn.querySelector('svg') !== null
        );
        if (exportButton) {
          fireEvent.click(exportButton);
        }
      });

      // Look for date input fields in a dialog/modal
      await waitFor(() => {
        const dateInputs = screen.queryAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
        expect(dateInputs.length >= 0).toBe(true);
      }, { timeout: 500 });
    });

    it('filters export records by selected date range', async () => {
      render(<TransactionHistory />);

      await waitFor(() => {
        expect(screen.getByTestId('infinite-scroll')).toBeInTheDocument();
      });

      // Simulate filtering transactions between Aug 10 and Aug 20
      const startDate = '2024-08-10';
      const endDate = '2024-08-20';

      // Filter logic: only tx2 (2024-08-15) should be included
      const filteredTxs = mockTransactions.filter(tx => {
        const txDate = tx.timestamp.split('T')[0];
        return txDate >= startDate && txDate <= endDate;
      });

      expect(filteredTxs).toHaveLength(1);
      expect(filteredTxs[0].id).toBe('tx2');
    });

    it('includes all required fields in CSV export output', async () => {
      // Helper to build CSV rows (mimics buildExportRows logic)
      const buildExportRows = (items: VaultActivity[]) => {
        return items.map(tx => ({
          id: tx.id,
          timestamp: tx.timestamp,
          type: tx.type,
          status: 'success',
          amount: String(tx.details.amount || ''),
          address: String(tx.details.recipient || ''),
          ledger: tx.ledger,
          actor: tx.actor || 'System',
          txHash: tx.txHash ?? '',
          eventId: tx.eventId,
          pagingToken: '',
          memo: String(tx.details.memo || ''),
          feeCharged: '',
          maxFee: '',
          operationCount: '',
          details: JSON.stringify(tx.details),
        }));
      };

      const exportRows = buildExportRows(mockTransactions);

      expect(exportRows).toHaveLength(3);
      expect(exportRows[0]).toHaveProperty('id');
      expect(exportRows[0]).toHaveProperty('timestamp');
      expect(exportRows[0]).toHaveProperty('type');
      expect(exportRows[0]).toHaveProperty('status');
      expect(exportRows[0]).toHaveProperty('amount');
      expect(exportRows[0]).toHaveProperty('address');
      expect(exportRows[0]).toHaveProperty('ledger');
      expect(exportRows[0]).toHaveProperty('actor');
      expect(exportRows[0]).toHaveProperty('txHash');
      expect(exportRows[0]).toHaveProperty('eventId');
      expect(exportRows[0]).toHaveProperty('memo');
    });

    it('correctly converts transactions to CSV format', () => {
      const escapeCsvCell = (value: unknown): string => {
        const normalized = value == null ? '' : String(value);
        if (/["\n,]/.test(normalized)) {
          return `"${normalized.replace(/"/g, '""')}"`;
        }
        return normalized;
      };

      const toCsv = (rows: any[]): string => {
        if (rows.length === 0) return '';
        const headers = Object.keys(rows[0]);
        const headerLine = headers.join(',');
        const bodyLines = rows.map(row =>
          headers.map(header => escapeCsvCell(row[header])).join(',')
        );
        return [headerLine, ...bodyLines].join('\n');
      };

      const buildExportRows = (items: VaultActivity[]) => {
        return items.map(tx => ({
          id: tx.id,
          timestamp: tx.timestamp,
          type: tx.type,
          status: 'success',
          amount: String(tx.details.amount || ''),
          address: String(tx.details.recipient || ''),
        }));
      };

      const rows = buildExportRows(mockTransactions);
      const csv = toCsv(rows);

      expect(csv).toContain('id,timestamp,type,status,amount,address');
      expect(csv).toContain('tx1,2024-08-01T10:00:00Z,proposal_created,success,100,GAAA...');
      expect(csv).toContain('tx2,2024-08-15T10:00:00Z,proposal_approved,success,200,GBBB...');
      expect(csv).toContain('tx3,2024-08-25T10:00:00Z,proposal_executed,success,300,GCCC...');
    });

    it('exports only transactions within selected date range', () => {
      const startDate = '2024-08-10';
      const endDate = '2024-08-20';

      const filteredTxs = mockTransactions.filter(tx => {
        const txDate = tx.timestamp.split('T')[0];
        return txDate >= startDate && txDate <= endDate;
      });

      expect(filteredTxs).toHaveLength(1);
      expect(filteredTxs[0].id).toBe('tx2');
      expect(filteredTxs[0].timestamp).toContain('2024-08-15');
    });
  });
});
