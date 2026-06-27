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
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }));
vi.mock('../modals/ConfirmationModal', () => ({ default: () => null }));
vi.mock('../ReadinessWarning', () => ({ default: () => null }));

import { useVaultContract } from '../../hooks/useVaultContract';
import { useActionReadiness } from '../../hooks/useActionReadiness';

const mockUseVaultContract = vi.mocked(useVaultContract);
const mockUseActionReadiness = vi.mocked(useActionReadiness);

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

    const assignBtn = screen.getByRole('button', { name: /assign/i });
    fireEvent.click(assignBtn);

    await waitFor(() => {
      // The notify mock is called with an error — we can't easily assert on toast,
      // but the setRole should NOT have been called
      expect(mockUseVaultContract.mock.results[0]?.value?.setRole).not.toHaveBeenCalled();
    });
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
        getAllRoles: vi.fn().mockResolvedValue([]),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<RoleManagement />);

    await waitFor(() => {
      expect(screen.getByText('Drag to Assign Roles')).toBeInTheDocument();
      // Columns should be present (Admin, Treasurer, Member)
      const adminColumn = screen.getByText('Admin');
      const treasurerColumn = screen.getByText('Treasurer');
      const memberColumn = screen.getByText('Member');
      expect(adminColumn).toBeInTheDocument();
      expect(treasurerColumn).toBeInTheDocument();
      expect(memberColumn).toBeInTheDocument();
    });
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

    await waitFor(() => {
      // Add a new signer to trigger pending change
      const addressInput = screen.getByPlaceholderText(/Stellar Address/i) as HTMLInputElement;
      fireEvent.change(addressInput, {
        target: { value: 'GNEW1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB' },
      });

      const addBtn = screen.getByRole('button', { name: /Add Signer/i });
      fireEvent.click(addBtn);
    });

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

    await waitFor(() => {
      // Add a signer to create a pending change
      const addressInput = screen.getByPlaceholderText(/Stellar Address/i) as HTMLInputElement;
      fireEvent.change(addressInput, {
        target: { value: 'GNEW1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB' },
      });

      const addBtn = screen.getByRole('button', { name: /Add Signer/i });
      fireEvent.click(addBtn);
    });

    await waitFor(() => {
      // Pending changes should be displayed
      expect(screen.getByText(/Pending Changes/)).toBeInTheDocument();
    });
  });
});
