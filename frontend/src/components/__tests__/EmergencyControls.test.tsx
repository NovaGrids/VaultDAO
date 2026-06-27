import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EmergencyControls from '../EmergencyControls';

const mockGetVaultConfig = vi.fn().mockResolvedValue({ currentUserRole: 2 });
const mockUpdateSpendingLimits = vi.fn().mockResolvedValue(true);
const mockGetProposals = vi.fn().mockResolvedValue([]);
const mockRejectProposal = vi.fn().mockResolvedValue(true);
const mockShowToast = vi.fn();

vi.mock('../../hooks/useVaultContract', () => ({
  useVaultContract: () => ({
    getVaultConfig: mockGetVaultConfig,
    updateSpendingLimits: mockUpdateSpendingLimits,
    getProposals: mockGetProposals,
    rejectProposal: mockRejectProposal,
  }),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

describe('EmergencyControls and EmergencyConfirmationModal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockGetVaultConfig.mockResolvedValue({ currentUserRole: 2 });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('does not render anything if role is not admin (role !== 2)', async () => {
    mockGetVaultConfig.mockResolvedValueOnce({ currentUserRole: 1 });
    render(<EmergencyControls />);
    await waitFor(() => {
      expect(screen.queryByText(/emergency zone/i)).not.toBeInTheDocument();
    });
  });

  it('renders emergency zone and opens the confirmation modal when Pause Vault is clicked', async () => {
    render(<EmergencyControls />);

    // Wait for the admin check to pass and render the controls
    await screen.findByText(/emergency zone/i);

    // Find and click the Pause Vault button
    const pauseBtn = screen.getByRole('button', { name: /pause vault/i });
    fireEvent.click(pauseBtn);

    // Verify modal is open
    expect(screen.getByText('Emergency Pause Multi-Sig')).toBeInTheDocument();
  });

  it('handles multi-sig signer checkbox clicks and enables/disables Execute button', async () => {
    render(<EmergencyControls />);
    await screen.findByText(/emergency zone/i);

    const pauseBtn = screen.getByRole('button', { name: /pause vault/i });
    fireEvent.click(pauseBtn);

    // The current user (Signer #1) is signed by default (1/3 confirmations)
    // The Execute button requires 2/3 confirmations, so it should be disabled initially
    const executeBtn = screen.getByRole('button', { name: /execute pause/i });
    expect(executeBtn).toBeDisabled();

    // Click Signer #2 (GBIH...) to confirm (now 2/3 confirmations)
    const signer2 = screen.getByText('Signer #2');
    fireEvent.click(signer2);

    expect(executeBtn).toBeEnabled();

    // Click Execute Pause
    fireEvent.click(executeBtn);

    // Modal should close and the contract method should be triggered
    await waitFor(() => {
      expect(mockUpdateSpendingLimits).toHaveBeenCalledWith(0n, 0n, 0n);
      expect(screen.queryByText('Emergency Pause Multi-Sig')).not.toBeInTheDocument();
    });
  });

  it('cancels the modal when timeout of 60 seconds is reached using requestAnimationFrame', async () => {
    let rafCallback: FrameRequestCallback | null = null;
    const mockRaf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });

    render(<EmergencyControls />);
    await screen.findByText(/emergency zone/i);

    const pauseBtn = screen.getByRole('button', { name: /pause vault/i });
    fireEvent.click(pauseBtn);

    expect(screen.getByText('Emergency Pause Multi-Sig')).toBeInTheDocument();
    expect(rafCallback).toBeInstanceOf(Function);

    // Start timer at t=0
    act(() => {
      if (rafCallback) rafCallback(0);
    });

    // Advance to t=60,000ms (60 seconds)
    act(() => {
      if (rafCallback) rafCallback(60000);
    });

    // Modal should close due to timeout
    await waitFor(() => {
      expect(screen.queryByText('Emergency Pause Multi-Sig')).not.toBeInTheDocument();
    });

    mockRaf.mockRestore();
  });

  it('renders existing emergency logs from localStorage inside the modal', async () => {
    const mockLogs = [
      {
        timestamp: Date.now() - 3600000,
        action: 'Pause Vault',
        confirmedBy: ['GAIH...', 'GBIH...'],
      },
    ];
    localStorage.setItem('vaultdao_emergency_activation_logs', JSON.stringify(mockLogs));

    render(<EmergencyControls />);
    await screen.findByText(/emergency zone/i);

    const pauseBtn = screen.getByRole('button', { name: /pause vault/i });
    fireEvent.click(pauseBtn);

    // Confirm that the log entry is rendered
    expect(screen.getByText('Confirmed by 2 signers')).toBeInTheDocument();
  });
});
