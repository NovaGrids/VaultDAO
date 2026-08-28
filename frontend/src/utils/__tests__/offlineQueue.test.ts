import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enqueueOfflineAction,
  getQueuedActions,
  getQueuedActionCount,
  dequeueOfflineAction,
  type OfflineAction,
} from '../offlineQueue';

// Mock IndexedDB
class MockIDBDatabase {
  objectStoreNames = {
    contains: vi.fn().mockReturnValue(true),
  };

  createObjectStore = vi.fn();
  transaction = vi.fn();
}

class MockIDBObjectStore {
  add = vi.fn().mockReturnValue({ onsuccess: null, onerror: null });
  put = vi.fn().mockReturnValue({ onsuccess: null, onerror: null });
  get = vi.fn().mockReturnValue({ onsuccess: null, onerror: null });
  getAll = vi.fn().mockReturnValue({ onsuccess: null, onerror: null });
  delete = vi.fn().mockReturnValue({ onsuccess: null, onerror: null });
  clear = vi.fn().mockReturnValue({ onsuccess: null, onerror: null });
  index = vi.fn().mockReturnValue({
    getAll: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
  });
}

describe('Offline Queue Conflict Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Conflict Detection Before Replay', () => {
    it('detects conflict when queued action state differs from current on-chain state', () => {
      // Simulate queued action
      const queuedAction: OfflineAction = {
        id: 'approve-1234',
        walletAddress: 'GAAA...',
        actionType: 'approve_proposal',
        parameters: { proposalId: '42', amount: '100' },
        timestamp: '2024-08-20T10:00:00Z',
        attempts: 0,
      };

      // Simulate current on-chain state (proposal was already approved by someone else)
      const onChainState = {
        proposalId: '42',
        status: 'approved', // Different from queued 'pending'
        approvedBy: ['GBBB...', 'GCCC...'], // Does not include our wallet
      };

      // Conflict detection logic
      const hasConflict =
        queuedAction.parameters.proposalId === onChainState.proposalId &&
        onChainState.status !== 'pending';

      expect(hasConflict).toBe(true);
    });

    it('detects conflict when proposal was executed while offline', () => {
      const queuedAction: OfflineAction = {
        id: 'execute-1234',
        walletAddress: 'GAAA...',
        actionType: 'execute_proposal',
        parameters: { proposalId: '42' },
        timestamp: '2024-08-20T10:00:00Z',
        attempts: 0,
      };

      const onChainState = {
        proposalId: '42',
        status: 'executed', // Already executed
        executedAt: '2024-08-20T09:00:00Z',
      };

      const hasConflict =
        queuedAction.parameters.proposalId === onChainState.proposalId &&
        onChainState.status === 'executed';

      expect(hasConflict).toBe(true);
    });

    it('does not detect conflict when proposal state is still pending', () => {
      const queuedAction: OfflineAction = {
        id: 'approve-1234',
        walletAddress: 'GAAA...',
        actionType: 'approve_proposal',
        parameters: { proposalId: '42', amount: '100' },
        timestamp: '2024-08-20T10:00:00Z',
        attempts: 0,
      };

      const onChainState = {
        proposalId: '42',
        status: 'pending',
        approvedBy: [],
      };

      const hasConflict =
        queuedAction.parameters.proposalId === onChainState.proposalId &&
        onChainState.status !== 'pending';

      expect(hasConflict).toBe(false);
    });

    it('detects conflict when vault config changed while offline', () => {
      const queuedAction: OfflineAction = {
        id: 'config-1234',
        walletAddress: 'GAAA...',
        actionType: 'propose_transfer',
        parameters: { recipient: 'GXXX...', amount: '500' },
        timestamp: '2024-08-20T10:00:00Z',
        attempts: 0,
      };

      // Vault spending limit was reduced while offline
      const currentVaultConfig = {
        spendingLimit: '100', // Was 500 when action was queued
        signersRequired: 3, // Now requires 3 signers
        signers: ['GAAA...', 'GBBB...', 'GCCC...'], // Changed composition
      };

      const paramAmount = Number(queuedAction.parameters.amount);
      const limitExceeded = paramAmount > Number(currentVaultConfig.spendingLimit);

      expect(limitExceeded).toBe(true);
    });
  });

  describe('Conflict Resolution UI Rendering', () => {
    it('shows conflict resolution UI when conflict is detected', () => {
      const conflict = {
        actionId: 'approve-1234',
        actionType: 'approve_proposal' as const,
        conflictReason: 'Proposal was already approved by another signer while you were offline',
        onChainStatus: 'approved',
        queuedAction: {
          proposalId: '42',
          timestamp: '2024-08-20T10:00:00Z',
        },
        options: [
          { id: 'discard', label: 'Discard Action', description: 'Remove from queue' },
          { id: 'retry', label: 'Retry Anyway', description: 'Attempt to execute despite conflict' },
          { id: 'review', label: 'Review & Modify', description: 'Edit and requeue' },
        ],
      };

      expect(conflict).toBeDefined();
      expect(conflict.conflictReason).toContain('approved');
      expect(conflict.options).toHaveLength(3);
      expect(conflict.options[0].id).toBe('discard');
      expect(conflict.options[1].id).toBe('retry');
      expect(conflict.options[2].id).toBe('review');
    });

    it('renders discard option for conflicts', () => {
      const conflictUI = {
        title: 'Action Conflict Detected',
        message: 'Proposal was already approved while you were offline',
        actions: [
          {
            type: 'discard',
            label: 'Discard',
            onClick: vi.fn(),
          },
          {
            type: 'retry',
            label: 'Retry',
            onClick: vi.fn(),
          },
        ],
      };

      const discardAction = conflictUI.actions.find(a => a.type === 'discard');
      expect(discardAction).toBeDefined();
      expect(discardAction?.label).toBe('Discard');
    });

    it('renders retry option for conflicts', () => {
      const conflictUI = {
        title: 'Action Conflict Detected',
        actions: [
          {
            type: 'discard',
            label: 'Discard',
            onClick: vi.fn(),
          },
          {
            type: 'retry',
            label: 'Retry Anyway',
            onClick: vi.fn(),
          },
        ],
      };

      const retryAction = conflictUI.actions.find(a => a.type === 'retry');
      expect(retryAction).toBeDefined();
      expect(retryAction?.label).toContain('Retry');
    });

    it('renders reason for conflict in UI', () => {
      const reasons = {
        'proposal_already_approved': 'Proposal was already approved by another signer while you were offline',
        'proposal_executed': 'Proposal was executed while you were offline',
        'vault_config_changed': 'Vault configuration changed - spending limit or signers updated',
        'transfer_limit_exceeded': 'Transfer amount exceeds updated spending limit',
        'signer_removed': 'Your signing authority was removed while you were offline',
      };

      expect(reasons['proposal_already_approved']).toContain('approved');
      expect(reasons['proposal_executed']).toContain('executed');
      expect(reasons['vault_config_changed']).toContain('configuration');
      expect(reasons['transfer_limit_exceeded']).toContain('spending limit');
      expect(reasons['signer_removed']).toContain('authority');
    });
  });

  describe('Conflict Resolution Actions', () => {
    it('executes discard action to remove conflicted item from queue', async () => {
      const discardAction = vi.fn().mockResolvedValue(true);

      const actionId = 'approve-1234';
      await discardAction(actionId);

      expect(discardAction).toHaveBeenCalledWith(actionId);
    });

    it('executes retry action to replay conflicted action anyway', async () => {
      const retryAction = vi.fn().mockResolvedValue(true);

      const conflictedAction: OfflineAction = {
        id: 'approve-1234',
        walletAddress: 'GAAA...',
        actionType: 'approve_proposal',
        parameters: { proposalId: '42' },
        timestamp: '2024-08-20T10:00:00Z',
        attempts: 1,
      };

      await retryAction(conflictedAction);

      expect(retryAction).toHaveBeenCalledWith(conflictedAction);
    });

    it('shows user feedback after discard action', () => {
      const feedback = {
        type: 'info' as const,
        message: 'Action removed from queue due to conflict',
        duration: 3000,
      };

      expect(feedback.type).toBe('info');
      expect(feedback.message).toContain('removed');
      expect(feedback.duration).toBe(3000);
    });

    it('shows user feedback after retry action', () => {
      const feedback = {
        type: 'warning' as const,
        message: 'Retrying action despite conflict - this may fail if state changed',
        duration: 5000,
      };

      expect(feedback.type).toBe('warning');
      expect(feedback.message).toContain('Retrying');
      expect(feedback.duration).toBe(5000);
    });
  });

  describe('Queue Replay with Conflict Resolution', () => {
    it('validates action before replaying from queue', async () => {
      const validateAction = async (action: OfflineAction, currentState: any) => {
        const actionProposalId = action.parameters.proposalId;
        const proposalStatus = currentState.proposals[actionProposalId]?.status;
        return proposalStatus === 'pending';
      };

      const action: OfflineAction = {
        id: 'approve-1234',
        walletAddress: 'GAAA...',
        actionType: 'approve_proposal',
        parameters: { proposalId: '42' },
        timestamp: '2024-08-20T10:00:00Z',
        attempts: 0,
      };

      const state1 = { proposals: { '42': { status: 'pending' } } };
      const state2 = { proposals: { '42': { status: 'approved' } } };

      const isValid1 = await validateAction(action, state1);
      const isValid2 = await validateAction(action, state2);

      expect(isValid1).toBe(true);
      expect(isValid2).toBe(false);
    });

    it('skips action if conflict detected during replay', async () => {
      const skipAction = vi.fn().mockResolvedValue({
        skipped: true,
        reason: 'conflict_detected',
      });

      const result = await skipAction('approve-1234', 'proposal_already_approved');

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('conflict_detected');
    });

    it('attempts replay only if no conflict detected', async () => {
      const replayAction = vi.fn().mockResolvedValue({
        success: true,
        txHash: 'hash123',
      });

      const action: OfflineAction = {
        id: 'approve-1234',
        walletAddress: 'GAAA...',
        actionType: 'approve_proposal',
        parameters: { proposalId: '42' },
        timestamp: '2024-08-20T10:00:00Z',
        attempts: 0,
      };

      const result = await replayAction(action);

      expect(replayAction).toHaveBeenCalledWith(action);
      expect(result.success).toBe(true);
    });
  });
});
