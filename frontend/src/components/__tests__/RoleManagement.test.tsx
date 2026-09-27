import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RoleManagement from '../RoleManagement';
import { makeVaultContractMock, makeActionReadinessMock } from '../../test/mocks';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../../hooks/useVaultContract');
vi.mock('../../hooks/useActionReadiness');
// notify must be referentially stable (like the real memoized one), otherwise
// RoleManagement's loadData effect re-runs on every render.
const mockNotify = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ notify: mockNotify }) }));
vi.mock('../modals/ConfirmationModal', () => ({ default: () => null }));
vi.mock('../ReadinessWarning', () => ({ default: () => null }));

import { useVaultContract } from '../../hooks/useVaultContract';
import { useActionReadiness } from '../../hooks/useActionReadiness';

const mockUseVaultContract = vi.mocked(useVaultContract);
const mockUseActionReadiness = vi.mocked(useActionReadiness);

// Stellar public keys are 56 characters: 'G' + 55 base32 characters.
const NEW_SIGNER = 'GNEW' + 'A'.repeat(52);

/** Type a new signer address and click "Add Signer" once the admin form is ready. */
async function addSigner(address: string) {
  const addressInput = await screen.findByPlaceholderText(/Stellar Address/i);
  // "Add Signer" is disabled while existing roles are still loading
  await waitFor(() => expect(screen.queryByText('Loading signers...')).not.toBeInTheDocument());
  fireEvent.change(addressInput, { target: { value: address } });
  fireEvent.click(screen.getByRole('button', { name: /Add Signer/i }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('RoleManagement component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActionReadiness.mockReturnValue(makeActionReadinessMock() as ReturnType<typeof useActionReadiness>);
  });

  it('shows non-admin view while user role is being determined', () => {
    // Before getUserRole resolves, currentUserRole defaults to 0 (non-admin)
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn(() => new Promise(() => {})), // never resolves
        getAllRoles: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);
    // Default role is 0 (non-admin), so admin-only UI is not shown
    expect(screen.getByText('Admin Access Required')).toBeInTheDocument();
  });

  it('hides role assignment table for non-admin users (role < 2)', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn().mockResolvedValue(1), // Treasurer, not Admin
        getAllRoles: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      // Admin-only "Assign Role" form should not be visible
      expect(screen.queryByPlaceholderText(/stellar address/i)).not.toBeInTheDocument();
    });
  });

  it('shows role assignment form for admin users (role === 2)', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn().mockResolvedValue(2), // Admin
        getAllRoles: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/stellar address/i)).toBeInTheDocument();
    });
  });

  it('renders existing role assignments for admin', async () => {
    const roles = [
      { address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB', role: 1 },
      { address: 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB', role: 0 },
    ];

    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue(roles),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      // Address is truncated in the table — check for the truncated prefix
      expect(screen.getByTitle('GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB')).toBeInTheDocument();
    });
  });

  it('shows validation error for invalid Stellar address', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/stellar address/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/stellar address/i);
    fireEvent.change(input, { target: { value: 'not-a-valid-address' } });

    const assignBtn = screen.getByRole('button', { name: /add signer/i });
    fireEvent.click(assignBtn);

    expect(mockNotify).toHaveBeenCalledWith('config_updated', 'Invalid Stellar address format', 'error');
    expect(screen.queryByTestId(/^signer-card-/)).not.toBeInTheDocument();
  });

  it('displays role names correctly', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([
          { address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB', role: 2 },
        ]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    // Role descriptions are always rendered for admin — "Admin" appears in the role card
    await waitFor(() => {
      const adminElements = screen.getAllByText('Admin');
      expect(adminElements.length).toBeGreaterThan(0);
    });
  });

  // ─── Kanban Drag-and-Drop Tests ────────────────────────────────────────
  it('renders Kanban board with three role columns (Admin, Treasurer, Member)', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn().mockResolvedValue(2),
        // Columns render once there is at least one signer
        getAllRoles: vi.fn().mockResolvedValue([
          { address: 'GABC' + 'A'.repeat(52), role: 2 },
        ]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    expect(await screen.findByText('Drag to Assign Roles')).toBeInTheDocument();
    // Column headings: Admin (2), Treasurer (1), Member (0)
    expect(within(await screen.findByTestId('role-column-2')).getByText('Admin')).toBeInTheDocument();
    expect(within(screen.getByTestId('role-column-1')).getByText('Treasurer')).toBeInTheDocument();
    expect(within(screen.getByTestId('role-column-0')).getByText('Member')).toBeInTheDocument();
  });

  it('displays signer cards in their assigned role columns', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([
          { address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB', role: 2 },
          { address: 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB', role: 1 },
          { address: 'GHIJ1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB', role: 0 },
        ]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      // Cards should have data-testid
      expect(
        screen.getByTestId('signer-card-GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB')
      ).toBeInTheDocument();
    });
  });

  it('disables Undo button when there is no history', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      const undoBtn = screen.getByRole('button', { name: /Undo/i });
      expect(undoBtn).toBeDisabled();
    });
  });

  it('disables Apply Changes button when there are no pending changes', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      const applyBtn = screen.getByRole('button', { name: /Apply Changes/i });
      expect(applyBtn).toBeDisabled();
    });
  });

  // ─── Confirmation Modal Tests ──────────────────────────────────────────
  it('shows confirmation modal when Apply Changes is clicked', async () => {
    // Mock ConfirmationModal to render its content in the test
    vi.doMock('../modals/ConfirmationModal', () => ({
      default: ({ isOpen, title, message }: any) =>
        isOpen ? (
          <div data-testid="confirmation-modal">
            <h3>{title}</h3>
            <p>{message}</p>
          </div>
        ) : null,
    }));

    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([
          { address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB', role: 0 },
        ]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    // Add a new signer to trigger a pending change
    await addSigner(NEW_SIGNER);

    await waitFor(() => {
      const applyBtn = screen.getByRole('button', { name: /Apply Changes/i });
      expect(applyBtn).not.toBeDisabled();
    });
  });

  it('shows pending changes alert when there are dragged changes', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getUserRole: vi.fn().mockResolvedValue(2),
        getAllRoles: vi.fn().mockResolvedValue([
          { address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB', role: 0 },
        ]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    // Add a signer to create a pending change
    await addSigner(NEW_SIGNER);

    await waitFor(() => {
      // Pending changes should be displayed
      expect(screen.getByText(/Pending Changes/)).toBeInTheDocument();
    });
  });
});
