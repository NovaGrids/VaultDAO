import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ConflictResolutionPanel, { resolveMerge } from '../ConflictResolutionPanel';

describe('ConflictResolutionPanel', () => {
  const localData = {
    recipient: 'G_LOCAL_111',
    token: 'USDC',
    amount: '100',
    memo: 'Local proposal note',
  };

  const remoteData = {
    recipient: 'G_REMOTE_222',
    token: 'USDC',
    amount: '200',
    memo: 'Remote proposal note',
  };

  const baseData = {
    recipient: 'G_BASE_000',
    token: 'USDC',
    amount: '100',
    memo: 'Base memo',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders conflict warning header and description', () => {
      render(
        <ConflictResolutionPanel
          localData={localData}
          remoteData={remoteData}
          onResolve={vi.fn()}
        />
      );

      expect(screen.getByText('Conflict Detected')).toBeInTheDocument();
      expect(
        screen.getByText(/Another user edited these fields concurrently/i)
      ).toBeInTheDocument();
      expect(screen.getByText('Your Changes')).toBeInTheDocument();
      expect(screen.getByText('Their Changes')).toBeInTheDocument();
    });

    it('displays the list of conflicting fields when values differ', () => {
      render(
        <ConflictResolutionPanel
          localData={localData}
          remoteData={remoteData}
          onResolve={vi.fn()}
        />
      );

      expect(screen.getByText(/Conflicting fields:/i)).toBeInTheDocument();
      expect(screen.getByText(/recipient, amount, memo/i)).toBeInTheDocument();
    });

    it('displays notice when no fields conflict', () => {
      render(
        <ConflictResolutionPanel
          localData={{ recipient: 'G123', amount: '50' }}
          remoteData={{ recipient: 'G123', amount: '50' }}
          onResolve={vi.fn()}
        />
      );

      expect(screen.getByText('No conflicting fields detected.')).toBeInTheDocument();
    });

    it('toggles merged result preview display on and off', () => {
      render(
        <ConflictResolutionPanel
          localData={localData}
          remoteData={remoteData}
          onResolve={vi.fn()}
        />
      );

      const previewBtn = screen.getByTestId('toggle-preview-btn');
      expect(previewBtn).toHaveTextContent('Preview Merge');
      expect(screen.queryByTestId('merged-preview')).not.toBeInTheDocument();

      fireEvent.click(previewBtn);
      expect(screen.getByTestId('merged-preview')).toBeInTheDocument();
      expect(previewBtn).toHaveTextContent('Hide Merged Preview');

      fireEvent.click(previewBtn);
      expect(screen.queryByTestId('merged-preview')).not.toBeInTheDocument();
      expect(previewBtn).toHaveTextContent('Preview Merge');
    });
  });

  describe('Resolution Actions', () => {
    it("handles 'accept mine' action and calls onResolve with localData", () => {
      const onResolve = vi.fn();
      render(
        <ConflictResolutionPanel
          localData={localData}
          remoteData={remoteData}
          onResolve={onResolve}
        />
      );

      const acceptMineBtn = screen.getByTestId('accept-mine-btn');
      expect(acceptMineBtn).toHaveTextContent('Accept Mine');
      fireEvent.click(acceptMineBtn);

      expect(onResolve).toHaveBeenCalledTimes(1);
      expect(onResolve).toHaveBeenCalledWith(localData);
    });

    it("handles 'accept theirs' action and calls onResolve with remoteData", () => {
      const onResolve = vi.fn();
      render(
        <ConflictResolutionPanel
          localData={localData}
          remoteData={remoteData}
          onResolve={onResolve}
        />
      );

      const acceptTheirsBtn = screen.getByTestId('accept-theirs-btn');
      expect(acceptTheirsBtn).toHaveTextContent('Accept Theirs');
      fireEvent.click(acceptTheirsBtn);

      expect(onResolve).toHaveBeenCalledTimes(1);
      expect(onResolve).toHaveBeenCalledWith(remoteData);
    });

    it("handles 'merge' action and calls onResolve with merged data when onMerge is not provided", () => {
      const onResolve = vi.fn();
      render(
        <ConflictResolutionPanel
          localData={localData}
          remoteData={remoteData}
          baseData={baseData}
          onResolve={onResolve}
        />
      );

      const mergeBtn = screen.getByTestId('merge-btn');
      expect(mergeBtn).toHaveTextContent('Merge Changes');
      fireEvent.click(mergeBtn);

      expect(onResolve).toHaveBeenCalledTimes(1);
      const mergedCall = onResolve.mock.calls[0][0];
      expect(mergedCall).toBeDefined();
      expect(mergedCall.token).toBe('USDC');
    });

    it("handles 'merge' action and calls onMerge when provided", () => {
      const onResolve = vi.fn();
      const onMerge = vi.fn();
      render(
        <ConflictResolutionPanel
          localData={localData}
          remoteData={remoteData}
          onResolve={onResolve}
          onMerge={onMerge}
        />
      );

      const mergeBtn = screen.getByTestId('merge-btn');
      fireEvent.click(mergeBtn);

      expect(onMerge).toHaveBeenCalledTimes(1);
      expect(onResolve).not.toHaveBeenCalled();
    });
  });

  describe('Three-way and Two-way Merge Logic (resolveMerge)', () => {
    it('performs three-way merge when baseData is provided', () => {
      const base = {
        recipient: 'G_ORIGINAL',
        token: 'XLM',
        amount: '100',
        memo: 'Base memo',
        unchangedField: 'Original',
      };

      const local = {
        recipient: 'G_LOCAL_UPDATED', // only local changed
        token: 'XLM',                 // neither changed
        amount: '100',                // local kept base
        memo: 'Local conflict memo',  // both changed
        unchangedField: 'Original',
      };

      const remote = {
        recipient: 'G_ORIGINAL',      // remote kept base
        token: 'XLM',                 // neither changed
        amount: '500',                // only remote changed
        memo: 'Remote conflict memo', // both changed
        unchangedField: 'Original',
      };

      const result = resolveMerge(local, remote, base);

      // Local change preserved
      expect(result.recipient).toBe('G_LOCAL_UPDATED');
      // Remote change preserved
      expect(result.amount).toBe('500');
      // Unchanged preserved
      expect(result.token).toBe('XLM');
      expect(result.unchangedField).toBe('Original');
      // Conflict between two non-empty strings favors local
      expect(result.memo).toBe('Local conflict memo');
    });

    it('handles identical concurrent updates in three-way merge', () => {
      const base = { title: 'Old Title' };
      const local = { title: 'New Shared Title' };
      const remote = { title: 'New Shared Title' };

      const result = resolveMerge(local, remote, base);
      expect(result.title).toBe('New Shared Title');
    });

    it('handles non-string field conflicts in three-way merge', () => {
      const base = { count: 1, active: false };
      const local = { count: 10, active: true };
      const remote = { count: 20, active: false };

      const result = resolveMerge(local, remote, base);
      expect(result.count).toBe(10);
      expect(result.active).toBe(true);
    });

    it('falls back to remote string if local string is empty in three-way conflict', () => {
      const base = { memo: 'initial' };
      const local = { memo: '' };
      const remote = { memo: 'remote note' };

      const result = resolveMerge(local, remote, base);
      expect(result.memo).toBe('remote note');
    });

    it('falls back to remote value if localVal is undefined in conflict', () => {
      const base = { tag: 'init' };
      const local = { tag: undefined };
      const remote = { tag: 'remote-tag' };

      const result = resolveMerge(local, remote, base);
      expect(result.tag).toBe('remote-tag');
    });

    it('performs two-way merge when baseData is omitted', () => {
      const local = {
        recipient: 'G_LOCAL',
        token: 'USDC',
        localOnly: 'mine',
        blankMemo: '',
      };

      const remote = {
        recipient: 'G_REMOTE',
        token: 'USDC',
        remoteOnly: 'theirs',
        blankMemo: 'Remote fallback text',
      };

      const result = resolveMerge(local, remote);

      // Identical fields
      expect(result.token).toBe('USDC');
      // Disjoint fields
      expect(result.localOnly).toBe('mine');
      expect(result.remoteOnly).toBe('theirs');
      // Different values: local non-empty preferred
      expect(result.recipient).toBe('G_LOCAL');
      // Local empty string falls back to remote
      expect(result.blankMemo).toBe('Remote fallback text');
    });

    it('handles two-way merge with non-string differing fields and undefined localVal', () => {
      const local = { num: 42, flag: undefined };
      const remote = { num: 99, flag: true };

      const result = resolveMerge(local, remote);
      expect(result.num).toBe(42);
      expect(result.flag).toBe(true);
    });

    it('handles null and empty input arguments gracefully', () => {
      expect(resolveMerge(null as any, null as any)).toEqual({});
      expect(resolveMerge(undefined as any, undefined as any)).toEqual({});

      render(
        <ConflictResolutionPanel
          localData={null}
          remoteData={undefined}
          onResolve={vi.fn()}
        />
      );

      expect(screen.getByText('No conflicting fields detected.')).toBeInTheDocument();
    });
  });
});
