/**
 * Maps technical error codes to user-friendly messages and recovery suggestions.
 * Used by ErrorHandler, toasts, and ErrorReporting.
 */

import type { VaultError } from './errorParser';

export interface UserFriendlyError {
  title: string;
  message: string;
  recoverySuggestions: string[];
  canRetry: boolean;
}

const ERROR_MAP: Record<string, UserFriendlyError> = {
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
  WALLET_ERROR: {
    title: 'Wallet action needed',
    message: 'The transaction was rejected or cancelled in your wallet.',
    recoverySuggestions: [
      'Confirm the transaction in your wallet (e.g. Freighter).',
      'Ensure you have enough XLM for fees.',
      'Try again and approve the transaction when prompted.',
    ],
    canRetry: true,
  },
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
  UNAUTHORIZED: {
    title: 'Access denied',
    message: "You don't have permission to perform this action.",
    recoverySuggestions: [
      'Check that your wallet is connected and is a signer.',
      'Ensure your role has the required permissions.',
      'Ask an admin to add you as a signer if needed.',
    ],
    canRetry: false,
  },
  INSUFFICIENT_FUNDS: {
    title: 'Insufficient balance',
    message: 'The vault does not have enough funds for this transfer.',
    recoverySuggestions: [
      'Deposit more funds into the vault first.',
      'Reduce the transfer amount and try again.',
    ],
    canRetry: true,
  },
  THRESHOLD_NOT_MET: {
    title: 'Not enough approvals',
    message: 'This proposal does not have enough approvals yet.',
    recoverySuggestions: [
      'Wait for more signers to approve the proposal.',
      'Share the proposal with other signers so they can approve.',
    ],
    canRetry: true,
  },
  DAILY_LIMIT_EXCEEDED: {
    title: 'Daily limit exceeded',
    message: 'The proposed amount exceeds the vault’s daily spending limit.',
    recoverySuggestions: [
      'Split the payment across multiple days.',
      'Ask an admin to increase the daily limit if appropriate.',
    ],
    canRetry: false,
  },
  RPC_ERROR: {
    title: 'Network issue',
    message: 'We couldn’t complete the request. This is often temporary.',
    recoverySuggestions: [
      'Check your internet connection.',
      'Wait a moment and try again.',
      'Stellar network may be busy; retry in a few seconds.',
    ],
    canRetry: true,
  },
  NETWORK_OFFLINE: {
    title: 'You’re offline',
    message: 'Please check your internet connection and try again.',
    recoverySuggestions: [
      'Connect to Wi‑Fi or mobile data.',
      'Refresh the page once you’re back online.',
    ],
    canRetry: true,
  },
  FETCH_FAILED: {
    title: 'Request failed',
    message: 'We couldn’t load the data. Please try again.',
    recoverySuggestions: [
      'Refresh the page.',
      'Check your connection and try again.',
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
 */
export function getUserFriendlyError(error: unknown): UserFriendlyError {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: string }).code === 'string') {
    return toUserFriendlyError(error as VaultError);
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('network') || msg.includes('fetch')) return ERROR_MAP.RPC_ERROR;
    if (msg.includes('wallet') || msg.includes('freighter')) return ERROR_MAP.WALLET_ERROR;
  }
  return {
    ...DEFAULT_USER_ERROR,
    message: error instanceof Error ? error.message : DEFAULT_USER_ERROR.message,
  };
}
