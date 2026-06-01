import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RoleManagement from '../RoleManagement';
import { makeVaultContractMock, makeActionReadinessMock } from '../../test/mocks';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../../hooks/useVaultContract');
vi.mock('../../hooks/useActionReadiness');
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn(), showToast: vi.fn() }) }));
vi.mock('../modals/ConfirmationModal', () => ({
  default: ({ isOpen, title, onConfirm, onCancel }: { isOpen: boolean; title: string; onConfirm: () => void; onCancel: () => void }) =>
    isOpen ? (
      <div data-testid="confirmation-modal">
        <span>{title}</span>
        <button onClick={onConfirm}>confirm-btn</button>
        <button onClick={onCancel}>cancel-btn</button>
      </div>
    ) : null,
}));
vi.mock('../ReadinessWarning', () => ({ default: () => null }));

import { useVaultContract } from '../../hooks/useVaultContract';
import { useActionReadiness } from '../../hooks/useActionReadiness';

const mockUseVaultContract = vi.mocked(useVaultContract);
const mockUseActionReadiness = vi.mocked(useActionReadiness);

const ADMIN_ADDRESS = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';
const TREASURER_ADDRESS = 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('RoleManagement — permission matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActionReadiness.mockReturnValue(makeActionReadinessMock() as ReturnType<typeof useActionReadiness>);
  });

  it('renders permission matrix table for admin users', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([
          { address: ADMIN_ADDRESS, role: 2 },
          { address: TREASURER_ADDRESS, role: 1 },
        ]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('permission-matrix')).toBeInTheDocument();
    });

    // Should show both addresses (truncated)
    expect(screen.getByTitle(ADMIN_ADDRESS)).toBeInTheDocument();
    expect(screen.getByTitle(TREASURER_ADDRESS)).toBeInTheDocument();
  });

  it('shows check icons for granted permissions', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([{ address: ADMIN_ADDRESS, role: 2 }]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      // Admin has all permissions — should have multiple "Granted" aria-labels
      const granted = screen.getAllByLabelText('Granted');
      expect(granted.length).toBeGreaterThan(0);
    });
  });

  it('shows dash icons for non-granted permissions', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([{ address: TREASURER_ADDRESS, role: 0 }]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      // Member only has ViewProposals — rest should be "Not granted"
      const notGranted = screen.getAllByLabelText('Not granted');
      expect(notGranted.length).toBeGreaterThan(0);
    });
  });

  it('opens grant permission modal when "Grant Permission" button is clicked', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([{ address: ADMIN_ADDRESS, role: 2 }]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('permission-matrix')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /grant permission/i }));

    expect(screen.getByRole('dialog', { name: /grant permission/i })).toBeInTheDocument();
  });

  it('grant modal validates address before submitting', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      // Admin view loaded
      expect(screen.getByRole('button', { name: /grant permission/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /grant permission/i }));

    // Enter invalid address
    const addressInput = screen.getByPlaceholderText(/stellar address/i);
    fireEvent.change(addressInput, { target: { value: 'invalid-address' } });
    fireEvent.click(screen.getByRole('button', { name: /^grant permission$/i }));

    expect(screen.getByText(/invalid stellar address/i)).toBeInTheDocument();
  });

  it('grant modal submits with valid address and permission', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /grant permission/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /grant permission/i }));

    const addressInput = screen.getByPlaceholderText(/stellar address/i);
    fireEvent.change(addressInput, { target: { value: ADMIN_ADDRESS } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /^grant permission$/i }));

    // Modal should close (no error shown)
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /grant permission/i })).not.toBeInTheDocument();
    });
  });

  it('shows revoke confirmation dialog when revoke role is clicked', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([{ address: TREASURER_ADDRESS, role: 1 }]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('permission-matrix')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /revoke/i }));

    await waitFor(() => {
      expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
      expect(screen.getByText('Revoke Role')).toBeInTheDocument();
    });
  });

  it('table is sortable by address', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([
          { address: ADMIN_ADDRESS, role: 2 },
          { address: TREASURER_ADDRESS, role: 1 },
        ]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('permission-matrix')).toBeInTheDocument();
    });

    // Click Address sort header
    fireEvent.click(screen.getByRole('button', { name: /address/i }));
    // Click again to reverse
    fireEvent.click(screen.getByRole('button', { name: /address/i }));

    // Table still renders after sort toggle
    expect(screen.getByTestId('permission-matrix')).toBeInTheDocument();
  });

  it('shows delegations tab with empty state', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /delegations/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /delegations/i }));

    expect(screen.getByText(/no active delegations/i)).toBeInTheDocument();
  });

  it('filters by role', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([
          { address: ADMIN_ADDRESS, role: 2 },
          { address: TREASURER_ADDRESS, role: 1 },
        ]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('permission-matrix')).toBeInTheDocument();
    });

    const roleFilter = screen.getByLabelText(/filter by role/i);
    fireEvent.change(roleFilter, { target: { value: '2' } });

    // Only admin address should remain
    expect(screen.getByTitle(ADMIN_ADDRESS)).toBeInTheDocument();
    expect(screen.queryByTitle(TREASURER_ADDRESS)).not.toBeInTheDocument();
  });
});
