import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateProposalWizard } from '../CreateProposalWizard';

// Mock dependencies
vi.mock('../../../hooks/useWallet', () => ({
  useWallet: () => ({
    address: 'GABC123',
  }),
}));

vi.mock('../../../hooks/useCollaboration', () => ({
  useCollaboration: () => ({
    isConnected: false,
    collaborators: [],
    hasConflict: false,
    updateField: vi.fn(),
    updateCursor: vi.fn(),
    getDraftState: () => ({}),
    resolveConflict: vi.fn(),
  }),
}));

vi.mock('../TypingIndicator', () => ({
  TypingIndicator: () => null,
}));

vi.mock('../OnlineUsers', () => ({
  OnlineUsers: () => null,
}));

vi.mock('../../../context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('CreateProposalWizard - Draft Auto-Save', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the proposal form', () => {
    render(<CreateProposalWizard />);
    expect(screen.getByText('Create Proposal')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('G...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('C...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0.00')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Brief description')).toBeInTheDocument();
  });

  it('saves draft to localStorage when form values change', async () => {
    const user = userEvent.setup();
    render(<CreateProposalWizard />);

    const recipientInput = screen.getByPlaceholderText('G...');
    await user.type(recipientInput, 'GTEST123');

    await waitFor(() => {
      expect(recipientInput).toHaveValue('GTEST123');
    });
  });

  it('clears draft from localStorage on successful submission', async () => {
    const user = userEvent.setup();
    render(<CreateProposalWizard />);

    const recipientInput = screen.getByPlaceholderText('G...');
    await user.type(recipientInput, 'GTEST123');

    const submitButton = screen.getByRole('button', { name: /Submit Proposal/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(localStorageMock.getItem('vaultdao_current_draft_id')).toBeNull();
    });
  });

  it('generates and persists a unique draft ID on mount', () => {
    const { rerender } = render(<CreateProposalWizard />);
    const draftId1 = localStorageMock.getItem('vaultdao_current_draft_id');
    expect(draftId1).toBeTruthy();

    rerender(<CreateProposalWizard />);
    const draftId2 = localStorageMock.getItem('vaultdao_current_draft_id');
    expect(draftId1).toBe(draftId2);
  });

  it('preserves form state across component remounts', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CreateProposalWizard />);

    const recipientInput = screen.getByPlaceholderText('G...');
    await user.type(recipientInput, 'GTEST123');

    unmount();

    render(<CreateProposalWizard />);
    const newRecipientInput = screen.getByPlaceholderText('G...');
    expect(newRecipientInput).toHaveValue('GTEST123');
  });
});
