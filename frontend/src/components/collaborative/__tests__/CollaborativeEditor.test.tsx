import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CollaborativeEditor from '../CollaborativeEditor';
import { useCollaboration } from '../../../hooks/useCollaboration';
import type { NewProposalFormData } from '../../modals/NewProposalModal';

// Mock dependencies of CollaborativeEditor
vi.mock('../../../hooks/useCollaboration');
vi.mock('../../../hooks/useVersionHistory', () => ({
  useVersionHistory: vi.fn(() => ({
    saveVersion: vi.fn(),
  })),
}));
vi.mock('../../../hooks/useChangeTracking', () => ({
  useChangeTracking: vi.fn(() => ({
    trackChange: vi.fn(),
  })),
}));

describe('CollaborativeEditor', () => {
  const initialData: NewProposalFormData = {
    recipient: 'G_INITIAL_111',
    token: 'NATIVE',
    amount: '100',
    memo: 'Initial Proposal Memo',
  };

  const mockUpdateField = vi.fn();
  const mockResolveConflict = vi.fn();
  const mockGetDraftState = vi.fn();
  const mockOnDataChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupHookMock = (overrides = {}) => {
    vi.mocked(useCollaboration).mockReturnValue({
      isConnected: true,
      collaborators: [],
      hasConflict: false,
      syncProgress: 100,
      updateField: mockUpdateField,
      updateCursor: vi.fn(),
      getDraftState: mockGetDraftState,
      undo: vi.fn(),
      redo: vi.fn(),
      resolveConflict: mockResolveConflict,
      ...overrides,
    });
  };

  it('renders editor form fields with initial data and without conflict panel', () => {
    setupHookMock({ hasConflict: false });

    render(
      <CollaborativeEditor
        draftId="draft-123"
        userId="user-1"
        userName="Alice"
        initialData={initialData}
        onDataChange={mockOnDataChange}
      />
    );

    expect(screen.getByLabelText(/Recipient Address/i) || screen.getByPlaceholderText('G...')).toHaveValue('G_INITIAL_111');
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Initial Proposal Memo')).toBeInTheDocument();
    expect(screen.queryByTestId('conflict-resolution-panel')).not.toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('handles field edits, notifies onDataChange, and updates CRDT', () => {
    setupHookMock({ hasConflict: false });

    render(
      <CollaborativeEditor
        draftId="draft-123"
        userId="user-1"
        userName="Alice"
        initialData={initialData}
        onDataChange={mockOnDataChange}
      />
    );

    const amountInput = screen.getByPlaceholderText('0.00');
    fireEvent.change(amountInput, { target: { value: '250.00' } });

    expect(mockOnDataChange).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '250.00' })
    );
    expect(mockUpdateField).toHaveBeenCalledWith('amount', '250.00');
  });

  it('renders ConflictResolutionPanel when two concurrent edits cause an unresolved conflict', () => {
    const remoteDraft = {
      recipient: 'G_REMOTE_CONCURRENT_222',
      token: 'USDC',
      amount: '500',
      memo: 'Concurrent edit by Bob',
    };

    mockGetDraftState.mockReturnValue(remoteDraft);

    // Simulate concurrent edit to the same field triggering conflict
    setupHookMock({
      hasConflict: true,
      getDraftState: mockGetDraftState,
    });

    render(
      <CollaborativeEditor
        draftId="draft-123"
        userId="user-1"
        userName="Alice"
        initialData={initialData}
        onDataChange={mockOnDataChange}
      />
    );

    // Conflict panel must render
    expect(screen.getByTestId('conflict-resolution-panel')).toBeInTheDocument();
    expect(screen.getByText('Conflict Detected')).toBeInTheDocument();
    expect(screen.getByTestId('accept-mine-btn')).toBeInTheDocument();
    expect(screen.getByTestId('accept-theirs-btn')).toBeInTheDocument();
    expect(screen.getByTestId('merge-btn')).toBeInTheDocument();
  });

  it("resolves conflict using 'accept mine' action", () => {
    const remoteDraft = {
      recipient: 'G_REMOTE_222',
      token: 'USDC',
      amount: '999',
      memo: 'Remote memo',
    };
    mockGetDraftState.mockReturnValue(remoteDraft);

    setupHookMock({
      hasConflict: true,
      getDraftState: mockGetDraftState,
    });

    render(
      <CollaborativeEditor
        draftId="draft-123"
        userId="user-1"
        userName="Alice"
        initialData={initialData}
        onDataChange={mockOnDataChange}
      />
    );

    const acceptMineBtn = screen.getByTestId('accept-mine-btn');
    fireEvent.click(acceptMineBtn);

    expect(mockResolveConflict).toHaveBeenCalledTimes(1);
    expect(mockResolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'G_INITIAL_111', amount: '100' })
    );
  });

  it("resolves conflict using 'accept theirs' action and updates form data", () => {
    const remoteDraft = {
      recipient: 'G_REMOTE_222',
      token: 'USDC',
      amount: '999',
      memo: 'Remote memo',
    };
    mockGetDraftState.mockReturnValue(remoteDraft);

    setupHookMock({
      hasConflict: true,
      getDraftState: mockGetDraftState,
    });

    render(
      <CollaborativeEditor
        draftId="draft-123"
        userId="user-1"
        userName="Alice"
        initialData={initialData}
        onDataChange={mockOnDataChange}
      />
    );

    const acceptTheirsBtn = screen.getByTestId('accept-theirs-btn');
    fireEvent.click(acceptTheirsBtn);

    expect(mockResolveConflict).toHaveBeenCalledTimes(1);
    expect(mockResolveConflict).toHaveBeenCalledWith(remoteDraft);
  });

  it("resolves conflict using 'merge' action combining concurrent edits", () => {
    const remoteDraft = {
      recipient: 'G_INITIAL_111', // unchanged from base
      token: 'USDC',              // remote changed token
      amount: '100',              // unchanged from base
      memo: 'Remote note',        // remote updated memo
    };
    mockGetDraftState.mockReturnValue(remoteDraft);

    setupHookMock({
      hasConflict: true,
      getDraftState: mockGetDraftState,
    });

    render(
      <CollaborativeEditor
        draftId="draft-123"
        userId="user-1"
        userName="Alice"
        initialData={initialData}
        onDataChange={mockOnDataChange}
      />
    );

    const mergeBtn = screen.getByTestId('merge-btn');
    fireEvent.click(mergeBtn);

    expect(mockResolveConflict).toHaveBeenCalledTimes(1);
    const resolvedPayload = mockResolveConflict.mock.calls[0][0];
    expect(resolvedPayload.token).toBe('USDC');
  });

  it('renders collaborator indicators and disconnected status', () => {
    setupHookMock({
      isConnected: false,
      collaborators: [
        {
          userId: 'user-2',
          userName: 'Bob',
          color: '#4ECDC4',
          cursor: null,
          lastSeen: Date.now(),
        },
        {
          userId: 'user-3',
          userName: 'Charlie',
          color: '#FF6B6B',
          cursor: null,
          lastSeen: Date.now(),
        },
        {
          userId: 'user-4',
          userName: 'Diana',
          color: '#BB8FCE',
          cursor: null,
          lastSeen: Date.now(),
        },
        {
          userId: 'user-5',
          userName: 'Evan',
          color: '#85C1E2',
          cursor: null,
          lastSeen: Date.now(),
        },
      ],
    });

    render(
      <CollaborativeEditor
        draftId="draft-123"
        userId="user-1"
        userName="Alice"
        initialData={initialData}
        onDataChange={mockOnDataChange}
      />
    );

    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByTitle('Bob')).toBeInTheDocument();
    expect(screen.getByTitle('Charlie')).toBeInTheDocument();
    expect(screen.getByTitle('Diana')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument(); // 4th collaborator shows as +1
  });
});
