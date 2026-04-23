/**
 * Maps technical error codes to user-friendly messages and recovery suggestions.
 * Used by ErrorHandler, toasts, and ErrorReporting.
 */

import type { VaultError } from './errorParser';
import { parseError } from './errorParser';

export interface UserFriendlyError {
  title: string;
  message: string;
  recoverySuggestions: string[];
  canRetry: boolean;
}

const ERROR_MAP: Record<string, UserFriendlyError> = {
  // ── Generic ──────────────────────────────────────────────────────────────
  UNKNOWN: {
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try again.',
    recoverySuggestions: [
      'Refresh the page and try again.',
      'Check your internet connection.',
      'If the problem persists, try again later.',
    ],
    canRetry: true,
  },
  BOUNDARY: {
    title: 'Something went wrong',
    message: 'This part of the app ran into an error. You can try again or refresh the page.',
    recoverySuggestions: [
      'Click "Try again" to re-render this section.',
      'Refresh the page to get a fresh state.',
    ],
    canRetry: true,
  },

  // ── Wallet ────────────────────────────────────────────────────────────────
  WALLET_ERROR: {
    title: 'Wallet error',
    message: 'Your wallet encountered an error. Please try again.',
    recoverySuggestions: [
      'Ensure Freighter is installed and unlocked.',
      'Reconnect your wallet and try again.',
    ],
    canRetry: true,
  },
  WALLET_REJECTED: {
    title: 'Transaction declined',
    message: 'You declined the transaction in your wallet.',
    recoverySuggestions: [
      'Approve the transaction in Freighter when prompted.',
      'Try the action again and confirm in your wallet.',
    ],
    canRetry: true,
  },
  WALLET_NOT_CONNECTED: {
    title: 'Wallet not connected',
    message: 'Please connect your wallet before performing this action.',
    recoverySuggestions: [
      'Click "Connect Wallet" and select Freighter.',
      'Make sure Freighter is installed and unlocked.',
    ],
    canRetry: false,
  },

  // ── Network / RPC ─────────────────────────────────────────────────────────
  NETWORK_OFFLINE: {
    title: "You're offline",
    message: 'Please check your internet connection and try again.',
    recoverySuggestions: [
      'Connect to Wi-Fi or mobile data.',
      'Refresh the page once you are back online.',
    ],
    canRetry: true,
  },
  NETWORK_MISMATCH: {
    title: 'Wrong network',
    message: 'Your wallet is connected to the wrong Stellar network.',
    recoverySuggestions: [
      'Open Freighter and switch to the correct network (Testnet or Mainnet).',
      'Reload the page after switching networks.',
    ],
    canRetry: false,
  },
  RPC_ERROR: {
    title: 'Network issue',
    message: "We couldn't complete the request. This is often temporary.",
    recoverySuggestions: [
      'Check your internet connection.',
      'Wait a moment and try again.',
      'Stellar network may be busy; retry in a few seconds.',
    ],
    canRetry: true,
  },
  RPC_TIMEOUT: {
    title: 'Request timed out',
    message: 'The Stellar network took too long to respond.',
    recoverySuggestions: [
      'Wait a few seconds and try again.',
      'The network may be congested; retry shortly.',
    ],
    canRetry: true,
  },
  FETCH_FAILED: {
    title: 'Request failed',
    message: "We couldn't load the data. Please try again.",
    recoverySuggestions: ['Refresh the page.', 'Check your connection and try again.'],
    canRetry: true,
  },
  CONTRACT_NOT_CONFIGURED: {
    title: 'Contract not configured',
    message: 'The vault contract address is missing. Check your environment settings.',
    recoverySuggestions: [
      'Contact the vault administrator.',
      'Ensure the app is configured with a valid contract ID.',
    ],
    canRetry: false,
  },

  // ── Contract: Initialization ──────────────────────────────────────────────
  NOT_INITIALIZED: {
    title: 'Contract not set up',
    message: 'This vault contract has not been initialized yet.',
    recoverySuggestions: [
      'Contact the vault administrator to initialize the contract.',
      'If you are the admin, use the deploy/initialize flow.',
    ],
    canRetry: false,
  },
  ALREADY_INITIALIZED: {
    title: 'Already initialized',
    message: 'This contract has already been initialized.',
    recoverySuggestions: ['No action needed; use the vault as usual.'],
    canRetry: false,
  },
  NO_SIGNERS: {
    title: 'No signers configured',
    message: 'The vault has no signers. At least one signer is required.',
    recoverySuggestions: ['Ask an admin to add signers to the vault.'],
    canRetry: false,
  },
  THRESHOLD_TOO_LOW: {
    title: 'Threshold too low',
    message: 'The approval threshold must be at least 1.',
    recoverySuggestions: ['Set a threshold of 1 or higher.'],
    canRetry: true,
  },
  THRESHOLD_TOO_HIGH: {
    title: 'Threshold too high',
    message: 'The approval threshold cannot exceed the number of signers.',
    recoverySuggestions: ['Lower the threshold or add more signers first.'],
    canRetry: true,
  },
  QUORUM_TOO_HIGH: {
    title: 'Quorum too high',
    message: 'The quorum setting exceeds the number of available signers.',
    recoverySuggestions: ['Reduce the quorum or add more signers.'],
    canRetry: true,
  },
  QUORUM_NOT_REACHED: {
    title: 'Quorum not reached',
    message: 'Not enough signers have approved this action.',
    recoverySuggestions: [
      'Wait for more signers to approve.',
      'Share the proposal with other signers.',
    ],
    canRetry: true,
  },

  // ── Contract: Authorization ───────────────────────────────────────────────
  UNAUTHORIZED: {
    title: 'Access denied',
    message: "You don't have permission to perform this action.",
    recoverySuggestions: [
      'Check that your wallet is connected and is a signer.',
      'Ensure your role has the required permissions.',
      'Ask an admin to grant you access.',
    ],
    canRetry: false,
  },
  NOT_A_SIGNER: {
    title: 'Not a signer',
    message: 'Your wallet address is not registered as a vault signer.',
    recoverySuggestions: [
      'Ask an admin to add your address as a signer.',
      'Ensure you are connected with the correct wallet.',
    ],
    canRetry: false,
  },
  INSUFFICIENT_ROLE: {
    title: 'Insufficient role',
    message: 'Your role does not have the permissions required for this action.',
    recoverySuggestions: ['Ask an admin to upgrade your role.'],
    canRetry: false,
  },
  VOTER_NOT_IN_SNAPSHOT: {
    title: 'Not eligible to vote',
    message: 'Your address was not included in the voting snapshot for this proposal.',
    recoverySuggestions: [
      'Only signers present when the proposal was created can vote.',
      'Contact the proposal creator for more information.',
    ],
    canRetry: false,
  },

  // ── Contract: Proposals ───────────────────────────────────────────────────
  PROPOSAL_NOT_FOUND: {
    title: 'Proposal not found',
    message: 'The requested proposal does not exist.',
    recoverySuggestions: ['Refresh the proposals list and try again.'],
    canRetry: false,
  },
  PROPOSAL_NOT_PENDING: {
    title: 'Proposal not pending',
    message: 'This proposal is no longer in a pending state.',
    recoverySuggestions: ['Refresh the proposals list to see the current status.'],
    canRetry: false,
  },
  PROPOSAL_NOT_APPROVED: {
    title: 'Proposal not approved',
    message: 'This proposal has not received enough approvals to be executed.',
    recoverySuggestions: [
      'Wait for more signers to approve.',
      'Check the current approval count.',
    ],
    canRetry: false,
  },
  PROPOSAL_ALREADY_EXECUTED: {
    title: 'Already executed',
    message: 'This proposal has already been executed.',
    recoverySuggestions: ['No further action is needed for this proposal.'],
    canRetry: false,
  },
  PROPOSAL_EXPIRED: {
    title: 'Proposal expired',
    message: 'This proposal has passed its voting deadline.',
    recoverySuggestions: ['Create a new proposal if the transfer is still needed.'],
    canRetry: false,
  },
  PROPOSAL_ALREADY_CANCELLED: {
    title: 'Proposal cancelled',
    message: 'This proposal has already been cancelled.',
    recoverySuggestions: ['Create a new proposal if the transfer is still needed.'],
    canRetry: false,
  },
  VOTING_DEADLINE_PASSED: {
    title: 'Voting deadline passed',
    message: 'The voting period for this proposal has ended.',
    recoverySuggestions: ['Create a new proposal to restart the voting process.'],
    canRetry: false,
  },
  ALREADY_APPROVED: {
    title: 'Already approved',
    message: 'You have already approved this proposal.',
    recoverySuggestions: ['Wait for other signers to approve.'],
    canRetry: false,
  },

  // ── Contract: Spending limits ─────────────────────────────────────────────
  INVALID_AMOUNT: {
    title: 'Invalid amount',
    message: 'The transfer amount is invalid (zero or negative).',
    recoverySuggestions: ['Enter a positive amount and try again.'],
    canRetry: true,
  },
  EXCEEDS_PROPOSAL_LIMIT: {
    title: 'Exceeds proposal limit',
    message: 'The amount exceeds the maximum allowed per proposal.',
    recoverySuggestions: [
      'Reduce the transfer amount.',
      'Ask an admin to increase the proposal spending limit.',
    ],
    canRetry: true,
  },
  EXCEEDS_DAILY_LIMIT: {
    title: 'Daily limit exceeded',
    message: "The proposed amount exceeds the vault's daily spending limit.",
    recoverySuggestions: [
      'Split the payment across multiple days.',
      'Ask an admin to increase the daily limit.',
    ],
    canRetry: false,
  },
  EXCEEDS_WEEKLY_LIMIT: {
    title: 'Weekly limit exceeded',
    message: "The proposed amount exceeds the vault's weekly spending limit.",
    recoverySuggestions: [
      'Split the payment across multiple weeks.',
      'Ask an admin to increase the weekly limit.',
    ],
    canRetry: false,
  },
  VELOCITY_LIMIT_EXCEEDED: {
    title: 'Velocity limit exceeded',
    message: 'Too many transfers have been made in a short period.',
    recoverySuggestions: [
      'Wait before submitting another transfer.',
      'Ask an admin to review the velocity limit settings.',
    ],
    canRetry: false,
  },

  // ── Contract: Timelock ────────────────────────────────────────────────────
  TIMELOCK_NOT_EXPIRED: {
    title: 'Timelock active',
    message: 'This proposal is locked for 24 hours before it can be executed.',
    recoverySuggestions: [
      'Wait for the timelock period to expire.',
      'Check the proposal details for the unlock time.',
    ],
    canRetry: false,
  },
  SCHEDULING_ERROR: {
    title: 'Scheduling error',
    message: 'There was a problem scheduling this payment.',
    recoverySuggestions: ['Try again or contact the vault administrator.'],
    canRetry: true,
  },

  // ── Contract: Balance / Transfer ──────────────────────────────────────────
  INSUFFICIENT_BALANCE: {
    title: 'Insufficient balance',
    message: 'The vault does not have enough funds for this transfer.',
    recoverySuggestions: [
      'Deposit more funds into the vault first.',
      'Reduce the transfer amount and try again.',
    ],
    canRetry: true,
  },
  TRANSFER_FAILED: {
    title: 'Transfer failed',
    message: 'The token transfer could not be completed.',
    recoverySuggestions: [
      'Check the vault balance and try again.',
      'Ensure the recipient address is valid.',
    ],
    canRetry: true,
  },

  // ── Contract: Signers ─────────────────────────────────────────────────────
  SIGNER_ALREADY_EXISTS: {
    title: 'Signer already exists',
    message: 'This address is already a signer on the vault.',
    recoverySuggestions: ['No action needed; the address is already a signer.'],
    canRetry: false,
  },
  SIGNER_NOT_FOUND: {
    title: 'Signer not found',
    message: 'The address you are trying to remove is not a signer.',
    recoverySuggestions: ['Check the address and try again.'],
    canRetry: false,
  },
  CANNOT_REMOVE_SIGNER: {
    title: 'Cannot remove signer',
    message: 'Removing this signer would drop below the required threshold.',
    recoverySuggestions: [
      'Lower the threshold before removing this signer.',
      'Add another signer first.',
    ],
    canRetry: false,
  },

  // ── Contract: Recipient lists ─────────────────────────────────────────────
  RECIPIENT_NOT_WHITELISTED: {
    title: 'Recipient not allowed',
    message: 'This recipient is not on the vault whitelist.',
    recoverySuggestions: [
      'Ask an admin to add this address to the whitelist.',
      'Use a whitelisted recipient address.',
    ],
    canRetry: false,
  },
  RECIPIENT_BLACKLISTED: {
    title: 'Recipient blocked',
    message: 'This recipient address has been blacklisted.',
    recoverySuggestions: [
      'Use a different recipient address.',
      'Ask an admin to review the blacklist.',
    ],
    canRetry: false,
  },
  ADDRESS_ALREADY_ON_LIST: {
    title: 'Address already listed',
    message: 'This address is already on the list.',
    recoverySuggestions: ['No action needed; the address is already listed.'],
    canRetry: false,
  },
  ADDRESS_NOT_ON_LIST: {
    title: 'Address not on list',
    message: 'This address is not on the list.',
    recoverySuggestions: ['Check the address and try again.'],
    canRetry: false,
  },

  // ── Contract: Misc ────────────────────────────────────────────────────────
  INSURANCE_INSUFFICIENT: {
    title: 'Insurance reserve low',
    message: 'The vault insurance reserve is insufficient for this action.',
    recoverySuggestions: ['Ask an admin to top up the insurance reserve.'],
    canRetry: false,
  },
  GAS_LIMIT_EXCEEDED: {
    title: 'Gas limit exceeded',
    message: 'The transaction exceeded the compute budget.',
    recoverySuggestions: [
      'Try a smaller operation.',
      'Contact the vault administrator.',
    ],
    canRetry: false,
  },
  BATCH_TOO_LARGE: {
    title: 'Batch too large',
    message: 'The batch operation contains too many items.',
    recoverySuggestions: ['Split the batch into smaller groups and try again.'],
    canRetry: true,
  },
  CONDITIONS_NOT_MET: {
    title: 'Conditions not met',
    message: 'The required conditions for this action have not been satisfied.',
    recoverySuggestions: ['Review the proposal conditions and try again later.'],
    canRetry: false,
  },
  INTERVAL_TOO_SHORT: {
    title: 'Interval too short',
    message: 'The payment interval is below the minimum allowed.',
    recoverySuggestions: ['Set a longer interval (minimum 1 hour).'],
    canRetry: true,
  },
  DEX_ERROR: {
    title: 'DEX error',
    message: 'A decentralized exchange operation failed.',
    recoverySuggestions: ['Try again or contact the vault administrator.'],
    canRetry: true,
  },
  RETRY_ERROR: {
    title: 'Retry limit reached',
    message: 'The operation failed after multiple retries.',
    recoverySuggestions: ['Wait a moment and try again.'],
    canRetry: true,
  },
  TEMPLATE_NOT_FOUND: {
    title: 'Template not found',
    message: 'The proposal template does not exist.',
    recoverySuggestions: ['Select a valid template and try again.'],
    canRetry: false,
  },
  TEMPLATE_INACTIVE: {
    title: 'Template inactive',
    message: 'This proposal template is no longer active.',
    recoverySuggestions: ['Choose an active template.'],
    canRetry: false,
  },
  TEMPLATE_VALIDATION_FAILED: {
    title: 'Template validation failed',
    message: 'The proposal data does not match the template requirements.',
    recoverySuggestions: ['Review the template fields and correct any errors.'],
    canRetry: true,
  },
  FUNDING_ROUND_ERROR: {
    title: 'Funding round error',
    message: 'There was a problem with the funding round operation.',
    recoverySuggestions: ['Try again or contact the vault administrator.'],
    canRetry: true,
  },
  ATTACHMENT_HASH_INVALID: {
    title: 'Invalid attachment',
    message: 'The attachment hash is not a valid CID.',
    recoverySuggestions: ['Provide a valid IPFS CID for the attachment.'],
    canRetry: true,
  },
  TOO_MANY_ATTACHMENTS: {
    title: 'Too many attachments',
    message: 'This proposal has reached the maximum number of attachments.',
    recoverySuggestions: ['Remove an existing attachment before adding a new one.'],
    canRetry: false,
  },
  TOO_MANY_TAGS: {
    title: 'Too many tags',
    message: 'This proposal has reached the maximum number of tags.',
    recoverySuggestions: ['Remove a tag before adding a new one.'],
    canRetry: false,
  },
  METADATA_VALUE_INVALID: {
    title: 'Invalid metadata',
    message: 'A metadata value is empty or too long.',
    recoverySuggestions: ['Check all metadata fields and correct any invalid values.'],
    canRetry: true,
  },

  // ── Transaction submission ────────────────────────────────────────────────
  TX_FAILED: {
    title: 'Transaction failed',
    message: 'The transaction was rejected by the Stellar network.',
    recoverySuggestions: [
      'Check your XLM balance for fees.',
      'Try again in a few seconds.',
    ],
    canRetry: true,
  },
  ACCOUNT_NOT_FOUND: {
    title: 'Account not found',
    message: 'The Stellar account was not found. It may need to be funded.',
    recoverySuggestions: [
      'Fund the account with at least 1 XLM.',
      'Check that the address is correct.',
    ],
    canRetry: false,
  },
  CONTRACT_EXECUTION_ERROR: {
    title: 'Contract execution error',
    message: 'The smart contract encountered an unexpected error.',
    recoverySuggestions: [
      'Try again.',
      'Contact the vault administrator if the problem persists.',
    ],
    canRetry: true,
  },
  STORAGE_ERROR: {
    title: 'Storage error',
    message: 'The contract encountered a storage access error.',
    recoverySuggestions: ['Try again or contact the vault administrator.'],
    canRetry: true,
  },
};

const DEFAULT_USER_ERROR: UserFriendlyError = ERROR_MAP.UNKNOWN;

/**
 * Convert a VaultError (or code + message) to a user-friendly error with recovery suggestions.
 */
export function toUserFriendlyError(error: VaultError | { code: string; message?: string }): UserFriendlyError {
  const entry = ERROR_MAP[error.code];
  if (entry) return entry;
  return {
    ...DEFAULT_USER_ERROR,
    message: error.message || DEFAULT_USER_ERROR.message,
  };
}

/**
 * Get user-friendly error from an unknown thrown value (e.g. from catch).
 * Routes through parseError first for consistent code extraction.
 */
export function getUserFriendlyError(error: unknown): UserFriendlyError {
  // Already a VaultError — map directly.
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: string }).code === 'string') {
    return toUserFriendlyError(error as VaultError);
  }
  // Run through the full parse pipeline to get a canonical code.
  const parsed = parseError(error);
  return toUserFriendlyError(parsed);
}
