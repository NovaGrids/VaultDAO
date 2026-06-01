/**
 * AuditLog component tests
 *
 * Tests:
 * - Verify chain shows success banner
 * - Broken chain highlights entry and shows error banner
 * - CSV export triggers download
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockShowToast = vi.fn();
const mockNotify = vi.fn();

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ showToast: mockShowToast, notify: mockNotify }),
}));

// Mock react-infinite-scroll-component to render children directly
vi.mock('react-infinite-scroll-component', () => ({
  default: ({ children, loader, endMessage }: {
    children: React.ReactNode;
    loader: React.ReactNode;
    endMessage: React.ReactNode;
    dataLength: number;
    next: () => void;
    hasMore: boolean;
  }) => (
    <div data-testid="infinite-scroll">
      {children}
      {endMessage}
    </div>
  ),
}));

// Mock pdfExport
vi.mock('../utils/pdfExport', () => ({
  exportAuditToPDF: vi.fn().mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' })),
}));

// Mock exportHistory
vi.mock('../utils/exportHistory', () => ({
  saveExportHistoryItem: vi.fn(),
}));

// ─── Sample data ─────────────────────────────────────────────────────────────

const sampleEntries = [
  {
    id: 'entry-1',
    action: 'proposal_created',
    actor: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
    target: 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
    txHash: 'abc123',
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    hash: 'hash1',
    prev_hash: '0',
  },
  {
    id: 'entry-2',
    action: 'proposal_approved',
    actor: 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
    txHash: 'def456',
    timestamp: new Date(Date.now() - 30_000).toISOString(),
    hash: 'hash2',
    prev_hash: 'hash1',
  },
  {
    id: 'entry-3',
    action: 'proposal_executed',
    actor: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
    txHash: 'ghi789',
    timestamp: new Date().toISOString(),
    hash: 'hash3',
    prev_hash: 'hash2',
  },
];

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

function mockFetchAudit(entries = sampleEntries) {
  return vi.fn().mockImplementation((url: string) => {
    const urlStr = String(url);

    if (urlStr.includes('/audit/verify')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ verified: true, brokenAtEntry: null }),
      });
    }

    if (urlStr.includes('/audit/export')) {
      return Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['id,action\n1,proposal_created'], { type: 'text/csv' })),
      });
    }

    if (urlStr.includes('/audit')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ entries }),
      });
    }

    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

function mockFetchBrokenChain() {
  return vi.fn().mockImplementation((url: string) => {
    const urlStr = String(url);

    if (urlStr.includes('/audit/verify')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ verified: false, brokenAtEntry: 1 }),
      });
    }

    if (urlStr.includes('/audit')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ entries: sampleEntries }),
      });
    }

    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

// ─── Import component (after mocks) ──────────────────────────────────────────

import AuditLog from '../components/AuditLog';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuditLog — chain verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock URL.createObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    // Mock document.createElement for download link
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const el = originalCreate('a');
        el.click = vi.fn();
        return el;
      }
      return originalCreate(tag);
    });
  });

  it('renders audit entries from API', async () => {
    vi.stubGlobal('fetch', mockFetchAudit());

    render(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText('proposal_created')).toBeInTheDocument();
    });

    expect(screen.getByText('proposal_approved')).toBeInTheDocument();
    expect(screen.getByText('proposal_executed')).toBeInTheDocument();
  });

  it('shows "Chain Verified ✓" banner when verification succeeds', async () => {
    vi.stubGlobal('fetch', mockFetchAudit());

    render(<AuditLog />);

    // Wait for entries to load
    await waitFor(() => {
      expect(screen.getByText('proposal_created')).toBeInTheDocument();
    });

    // Click Verify Chain
    const verifyBtn = screen.getByTestId('verify-chain-button');
    await act(async () => {
      await userEvent.click(verifyBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('verification-banner')).toBeInTheDocument();
    });

    expect(screen.getByText(/chain verified/i)).toBeInTheDocument();
    expect(screen.getByTestId('verification-banner')).toHaveTextContent('Chain Verified ✓');
  });

  it('shows "Chain Broken" banner and highlights broken entry', async () => {
    vi.stubGlobal('fetch', mockFetchBrokenChain());

    render(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText('proposal_created')).toBeInTheDocument();
    });

    const verifyBtn = screen.getByTestId('verify-chain-button');
    await act(async () => {
      await userEvent.click(verifyBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('verification-banner')).toBeInTheDocument();
    });

    // Banner should show broken chain message
    expect(screen.getByTestId('verification-banner')).toHaveTextContent('Chain Broken');
    expect(screen.getByTestId('verification-banner')).toHaveTextContent('#1');

    // The broken entry should be highlighted
    await waitFor(() => {
      const brokenEntries = screen.getAllByTestId('broken-entry');
      expect(brokenEntries.length).toBeGreaterThan(0);
    });

    // Chain break tooltip should appear at the break point
    expect(screen.getByTestId('chain-break-tooltip')).toBeInTheDocument();
  });

  it('shows spinner during verification', async () => {
    let resolveVerify: (value: unknown) => void;
    const verifyPromise = new Promise((resolve) => {
      resolveVerify = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/audit/verify')) {
          return verifyPromise.then(() => ({
            ok: true,
            json: () => Promise.resolve({ verified: true, brokenAtEntry: null }),
          }));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ entries: sampleEntries }),
        });
      }),
    );

    render(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText('proposal_created')).toBeInTheDocument();
    });

    const verifyBtn = screen.getByTestId('verify-chain-button');
    await act(async () => {
      await userEvent.click(verifyBtn);
    });

    // Should show "Verifying…" text while in progress
    expect(screen.getByText(/verifying/i)).toBeInTheDocument();

    // Resolve the verification
    await act(async () => {
      resolveVerify!({});
    });

    await waitFor(() => {
      expect(screen.queryByText(/verifying/i)).toBeNull();
    });
  });
});

describe('AuditLog — CSV export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('triggers CSV download when Export button is clicked', async () => {
    vi.stubGlobal('fetch', mockFetchAudit());

    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const el = originalCreate('a');
        el.click = clickSpy;
        return el;
      }
      return originalCreate(tag);
    });

    render(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText('proposal_created')).toBeInTheDocument();
    });

    // The export button shows entry count
    const exportBtn = screen.getByTestId('export-button');
    expect(exportBtn).toHaveTextContent('Export 3');

    await act(async () => {
      await userEvent.click(exportBtn);
    });

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(global.URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('shows success toast after export', async () => {
    vi.stubGlobal('fetch', mockFetchAudit());

    render(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText('proposal_created')).toBeInTheDocument();
    });

    const exportBtn = screen.getByTestId('export-button');
    await act(async () => {
      await userEvent.click(exportBtn);
    });

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(
        'export_success',
        expect.stringContaining('Exported'),
        'success',
      );
    });
  });

  it('shows actor address with copy button', async () => {
    vi.stubGlobal('fetch', mockFetchAudit());

    render(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText('proposal_created')).toBeInTheDocument();
    });

    // Actor should be truncated
    expect(screen.getByText('GABC12…90AB')).toBeInTheDocument();

    // Copy button should be present
    const copyButtons = screen.getAllByTitle(/copy full address/i);
    expect(copyButtons.length).toBeGreaterThan(0);
  });

  it('shows relative timestamp with absolute on hover', async () => {
    vi.stubGlobal('fetch', mockFetchAudit());

    render(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText('proposal_created')).toBeInTheDocument();
    });

    // Relative time should be shown (e.g. "1m ago")
    const timeElements = screen.getAllByTitle(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(timeElements.length).toBeGreaterThan(0);
  });
});
