import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import VersionHistory from '../collaborative/VersionHistory';

const mockRestoreVersion = vi.fn();

const versions = [
  {
    id: 'v2',
    draftId: 'draft-1',
    version: 2,
    recipient: 'GBBBB',
    token: 'USDC',
    amount: '12',
    memo: 'updated memo',
    changedBy: 'alice',
    changedAt: 200,
    changeDescription: 'Updated proposal',
  },
  {
    id: 'v1',
    draftId: 'draft-1',
    version: 1,
    recipient: 'GAAAA',
    token: 'USDC',
    amount: '10',
    memo: 'initial memo',
    changedBy: 'alice',
    changedAt: 100,
    changeDescription: 'Initial draft',
  },
];

vi.mock('../../hooks/useVersionHistory', () => ({
  useVersionHistory: () => ({
    versions,
    restoreVersion: mockRestoreVersion,
  }),
}));

describe('VersionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRestoreVersion.mockReturnValue({ recipient: 'GBBBB', token: 'USDC', amount: '12', memo: 'updated memo' });
  });

  it('renders timeline entries when expanded', () => {
    render(
      <VersionHistory
        draftId="draft-1"
        proposalAuthor="alice"
        viewerAddress="alice"
        viewerRole={null}
        onRestore={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /version history/i }));
    expect(screen.getByText('Updated proposal')).toBeInTheDocument();
    expect(screen.getByText('Initial draft')).toBeInTheDocument();
  });

  it('shows word-level diff panel for selected version', () => {
    render(
      <VersionHistory
        draftId="draft-1"
        proposalAuthor="alice"
        viewerAddress="alice"
        viewerRole={null}
        onRestore={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /version history/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /view diff/i })[0]);

    expect(screen.getByTestId('version-diff-panel')).toBeInTheDocument();
    expect(screen.getByText(/comparing v1 to v2/i)).toBeInTheDocument();
  });

  it('allows restore for author/admin and triggers restore callback', () => {
    const onRestore = vi.fn();

    render(
      <VersionHistory
        draftId="draft-1"
        proposalAuthor="alice"
        viewerAddress="alice"
        viewerRole={null}
        onRestore={onRestore}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /version history/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /restore this version/i })[0]);

    expect(mockRestoreVersion).toHaveBeenCalledWith('v2');
    expect(onRestore).toHaveBeenCalled();
  });

  it('blocks restore button for unauthorized users', () => {
    render(
      <VersionHistory
        draftId="draft-1"
        proposalAuthor="alice"
        viewerAddress="bob"
        viewerRole="Member"
        onRestore={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /version history/i }));
    const restoreButton = screen.getAllByRole('button', { name: /restore this version/i })[0];
    expect(restoreButton).toBeDisabled();
  });
});
