import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import StreamingPayments, { type Stream } from '../StreamingPayments';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockWallet = {
  address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
  isConnected: true,
};

vi.mock('../../../hooks/useWallet', () => ({
  useWallet: () => mockWallet,
}));

vi.mock('../../../context/ToastContext', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

vi.mock('../../../config/env', () => ({
  env: {
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    stellarNetwork: 'TESTNET',
  },
}));

const makeStream = (overrides: Partial<Stream> = {}): Stream => ({
  id: '1',
  sender: 'GSENDER1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
  recipient: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
  token: 'NATIVE',
  tokenSymbol: 'XLM',
  ratePerSecond: '0.001',
  totalAmount: '1000',
  claimedAmount: '0',
  accumulatedSeconds: 0,
  lastUpdateTimestamp: Math.floor(Date.now() / 1000) - 100,
  status: 'active',
  ...overrides,
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('StreamingPayments page', () => {
  beforeEach(() => {
    mockWallet.address = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';
    mockWallet.isConnected = true;
    // Mock fetch to return demo streams
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the page heading', async () => {
    render(<StreamingPayments />);
    await waitFor(() => {
      expect(screen.getByText('Streaming Payments')).toBeInTheDocument();
    });
  });

  it('shows demo streams when backend is unavailable', async () => {
    render(<StreamingPayments />);
    await waitFor(() => {
      expect(screen.getByText('Active Streams')).toBeInTheDocument();
    });
  });

  it('claimable counter increments over time for active streams', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ streams: [makeStream()] }),
    });

    render(<StreamingPayments />);
    await waitFor(() => screen.getByText('Claimable now'));

    // Advance time by 10 seconds
    act(() => { vi.advanceTimersByTime(10000); });

    // The claimable amount should have increased (rate 0.001 * 10s = 0.01 XLM more)
    await waitFor(() => {
      const claimableEl = screen.getByText(/Claimable now/i).closest('div')?.nextElementSibling;
      expect(claimableEl?.textContent).toMatch(/XLM/);
    });
    vi.useRealTimers();
  });

  it('shows paused status for paused streams', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ streams: [makeStream({ status: 'paused' })] }),
    });

    render(<StreamingPayments />);
    await waitFor(() => {
      expect(screen.getByText('Paused')).toBeInTheDocument();
      expect(screen.getByText('Stream is paused — counter frozen')).toBeInTheDocument();
    });
  });

  it('disables claim button when claimable < 1', async () => {
    // Stream with very low rate — claimable will be < 1
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        streams: [makeStream({ ratePerSecond: '0.000001', lastUpdateTimestamp: Math.floor(Date.now() / 1000) - 1 })],
      }),
    });

    render(<StreamingPayments />);
    await waitFor(() => screen.getByText('Nothing to claim yet'));
    const claimBtn = screen.getByRole('button', { name: /claim/i });
    expect(claimBtn).toBeDisabled();
  });

  it('shows "Connect your wallet" when not connected', () => {
    mockWallet.address = null;
    mockWallet.isConnected = false;
    render(<StreamingPayments />);
    expect(screen.getByText('Connect your wallet')).toBeInTheDocument();
  });
});
