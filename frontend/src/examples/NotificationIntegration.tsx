/**
 * Example integration patterns for the Notification Center
 * 
 * This file demonstrates how to integrate notifications into various
 * parts of the VaultDAO application.
 */

import { useNotificationCenter } from '../hooks/useNotificationCenter';
import { useNavigate } from 'react-router-dom';

/**
 * Example: Proposal Management Integration
 */
export function useProposalNotifications() {
  const { notifyProposal, notifyCritical } = useNotificationCenter();
  const navigate = useNavigate();

  const notifyProposalCreated = (proposalId: string, title: string) => {
    notifyProposal(
      'New Proposal Created',
      `Proposal "${title}" has been submitted for review`,
      [
        {
          id: 'view-proposal',
          label: 'View Proposal',
          type: 'view',
          variant: 'primary',
          handler: async () => {
            navigate(`/dashboard/proposals?id=${proposalId}`);
          },
        },
        {
          id: 'dismiss',
          label: 'Dismiss',
          type: 'dismiss',
          variant: 'secondary',
        },
      ]
    );
  };

  const notifyProposalApproved = (_proposalId: string, title: string, approverCount: number) => {
    notifyProposal(
      'Proposal Approved',
      `Proposal "${title}" has received ${approverCount} approvals`,
      [
        {
          id: 'view-proposal',
          label: 'View Details',
          type: 'view',
          variant: 'primary',
          handler: async () => {
            navigate(`/dashboard/proposals?id=${_proposalId}`);
          },
        },
      ]
    );
  };

  const notifyProposalExecuted = (_proposalId: string, title: string) => {
    notifyProposal(
      'Proposal Executed',
      `Proposal "${title}" has been successfully executed`,
      [
        {
          id: 'view-activity',
          label: 'View Activity',
          type: 'view',
          variant: 'primary',
          handler: async () => {
            navigate('/dashboard/activity');
          },
        },
      ]
    );
  };

  const notifyProposalRejected = (proposalId: string, title: string, reason?: string) => {
    notifyCritical(
      'Proposal Rejected',
      `Proposal "${title}" was rejected${reason ? `: ${reason}` : ''}`,
      'proposals'
    );
  };

  return {
    notifyProposalCreated,
    notifyProposalApproved,
    notifyProposalExecuted,
    notifyProposalRejected,
  };
}

/**
 * Example: Transaction Approval Integration
 */
export function useTransactionNotifications() {
  const { notifyApproval, notifySystem, notifyCritical } = useNotificationCenter();
  const navigate = useNavigate();

  const notifySignatureRequired = (
    _transactionId: string,
    description: string,
    onApprove: () => Promise<void>
  ) => {
    notifyApproval(
      'Signature Required',
      `Your signature is needed: ${description}`,
      [
        {
          id: 'sign-now',
          label: 'Sign Now',
          type: 'approve',
          variant: 'primary',
          handler: async (_notificationId) => {
            try {
              await onApprove();
              notifySystem('Transaction Signed', 'Your signature has been recorded', 'normal');
            } catch (error) {
              notifyCritical(
                'Signature Failed',
                error instanceof Error ? error.message : 'Failed to sign transaction',
                'approvals'
              );
            }
          },
        },
        {
          id: 'view-details',
          label: 'View Details',
          type: 'view',
          variant: 'secondary',
          handler: async () => {
            navigate(`/dashboard/proposals?transaction=${_transactionId}`);
          },
        },
      ]
    );
  };

  const notifyTransactionComplete = (_transactionId: string, description: string) => {
    notifySystem(
      'Transaction Complete',
      `Transaction completed: ${description}`,
      'high'
    );
  };

  const notifyTransactionFailed = (transactionId: string, error: string) => {
    notifyCritical(
      'Transaction Failed',
      `Transaction ${transactionId} failed: ${error}`,
      'approvals'
    );
  };

  return {
    notifySignatureRequired,
    notifyTransactionComplete,
    notifyTransactionFailed,
  };
}

/**
 * Example: System Events Integration
 */
export function useSystemNotifications() {
  const { notifySystem, notifyCritical } = useNotificationCenter();

  const notifyMaintenance = (scheduledTime: string) => {
    notifySystem(
      'Scheduled Maintenance',
      `System maintenance scheduled for ${scheduledTime}`,
      'normal'
    );
  };

  const notifyUpdate = (version: string, features: string[]) => {
    notifySystem(
      'System Updated',
      `VaultDAO has been updated to v${version}. New features: ${features.join(', ')}`,
      'normal'
    );
  };

  const notifySecurityAlert = (message: string) => {
    notifyCritical(
      'Security Alert',
      message,
      'system'
    );
  };

  const notifyConnectionLost = () => {
    notifyCritical(
      'Connection Lost',
      'Unable to connect to the Stellar network. Please check your connection.',
      'system'
    );
  };

  const notifyConnectionRestored = () => {
    notifySystem(
      'Connection Restored',
      'Successfully reconnected to the Stellar network',
      'normal'
    );
  };

  return {
    notifyMaintenance,
    notifyUpdate,
    notifySecurityAlert,
    notifyConnectionLost,
    notifyConnectionRestored,
  };
}

/**
 * Example: Vault Management Integration
 */
export function useVaultNotifications() {
  const { notify, notifySystem, notifyCritical } = useNotificationCenter();
  const navigate = useNavigate();

  const notifyVaultCreated = (_vaultId: string, vaultName: string) => {
    notify(
      'Vault Created',
      `Vault "${vaultName}" has been successfully created`,
      {
        category: 'system',
        priority: 'high',
        actions: [
          {
            id: 'view-vault',
            label: 'View Vault',
            type: 'view',
            variant: 'primary',
            handler: async () => {
              navigate(`/dashboard?vault=${_vaultId}`);
            },
          },
        ],
      }
    );
  };

  const notifyMemberAdded = (_vaultId: string, memberAddress: string) => {
    notifySystem(
      'Member Added',
      `New member ${memberAddress.slice(0, 8)}... added to vault`,
      'normal'
    );
  };

  const notifyThresholdChanged = (_vaultId: string, oldThreshold: number, newThreshold: number) => {
    notifySystem(
      'Threshold Updated',
      `Vault threshold changed from ${oldThreshold} to ${newThreshold}`,
      'high'
    );
  };

  const notifyVaultLocked = (_vaultId: string, reason: string) => {
    notifyCritical(
      'Vault Locked',
      `Vault has been locked: ${reason}`,
      'system'
    );
  };

  return {
    notifyVaultCreated,
    notifyMemberAdded,
    notifyThresholdChanged,
    notifyVaultLocked,
  };
}

/**
 * Example: Error Handling Integration
 */
export function useErrorNotifications() {
  const { notifyCritical, notifySystem } = useNotificationCenter();

  const notifyError = (error: Error, context?: string) => {
    const message = context
      ? `${context}: ${error.message}`
      : error.message;

    notifyCritical('Error Occurred', message, 'system');
  };

  const notifyNetworkError = () => {
    notifyCritical(
      'Network Error',
      'Unable to connect to the network. Please check your connection and try again.',
      'system'
    );
  };

  const notifyValidationError = (field: string, message: string) => {
    notifySystem(
      'Validation Error',
      `${field}: ${message}`,
      'normal'
    );
  };

  const notifyRateLimitExceeded = (retryAfter?: number) => {
    const message = retryAfter
      ? `Too many requests. Please try again in ${retryAfter} seconds.`
      : 'Too many requests. Please try again later.';

    notifySystem('Rate Limit Exceeded', message, 'high');
  };

  return {
    notifyError,
    notifyNetworkError,
    notifyValidationError,
    notifyRateLimitExceeded,
  };
}

/**
 * Example: Complete Integration in a Component
 */
export function ExampleProposalComponent() {
  const { notifyProposalCreated } = useProposalNotifications();
  const { notifyError } = useErrorNotifications();

  const _handleSubmitProposal = async (proposalData: any) => {
    try {
      // Submit proposal logic here
      const proposalId = 'prop-123';
      const title = proposalData.title;

      // Notify success
      notifyProposalCreated(proposalId, title);
    } catch (error) {
      // Notify error
      if (error instanceof Error) {
        notifyError(error, 'Failed to submit proposal');
      }
    }
  };

  return null; // Component implementation
}
