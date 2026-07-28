/**
 * VaultDAO SDK — Public API
 *
 * Import everything you need from this single entry point.
 *
 * @example
 * import { proposeTransfer, signAndSubmit, buildOptions } from "@vaultdao/sdk";
 */

// Types
export type {
  InitConfig,
  VaultConfig,
  Proposal,
  RecurringPayment,
  StreamingPayment,
  Subscription,
  Escrow,
  ProposalTemplate,
  Comment,
  VaultMetrics,
  Reputation,
  AuditEntry,
  SdkOptions,
  SdkLogger,
  Network,
} from "./types";

// Enums & errors
export { Role, ProposalStatus, VaultErrorCode, VaultError } from "./types";

// Error code registry
export type { ErrorRegistryEntry } from "./errors";
export {
  ERROR_REGISTRY,
  ERROR_REGISTRY as DEFAULT_ERROR_REGISTRY,
  getErrorEntry,
  getErrorDescription,
  getAllErrorEntries,
} from "./errors";

// Utility functions
export type { WalletConnection } from "./utils";
export {
  buildOptions,
  connectWallet,
  buildTransaction,
  signAndSubmit,
  parseError,
  NETWORK_PASSPHRASES,
  DEFAULT_RPC_URLS,
  // ScVal converters — useful for advanced use cases
  addressToScVal,
  i128ToScVal,
  u64ToScVal,
  u32ToScVal,
  symbolToScVal,
  decodeScVal,
} from "./utils";

// Contract bindings
export {
  // Initialization
  initialize,
  // Proposal lifecycle
  proposeTransfer,
  approveProposal,
  executeProposal,
  rejectProposal,
  // Admin
  setRole,
  addSigner,
  removeSigner,
  updateLimits,
  updateThreshold,
  // Recurring payments
  schedulePayment,
  executeRecurringPayment,
  // Streaming payments
  createStream,
  claimStream,
  pauseStream,
  cancelStream,
  // Subscriptions
  createSubscription,
  renewSubscription,
  cancelSubscription,
  // Escrow
  createEscrow,
  completeMilestone,
  releaseEscrow,
  disputeEscrow,
  // Templates
  createTemplate,
  proposeFromTemplate,
  deactivateTemplate,
  // Comments
  addComment,
  editComment,
  getComments,
  // Recovery
  proposeRecovery,
  approveRecovery,
  executeRecovery,
  // Read functions
  getVaultMetrics,
  getReputation,
  getAuditTrail,
  getDelegationChain,
  // View / read-only
  getProposal,
  getRole,
  getTodaySpent,
  isSigner,
} from "./contract";

// Batch orchestration
export {
  createBatchOrchestrator,
  BatchProposalOrchestrator,
} from "./batch-orchestrator";

export type {
  BatchTransfer,
  RetryConfig,
} from "./batch-orchestrator";

// Testing utilities
export { MockVaultContract } from "./mock-contract";
export type { FailureInjectionConfig } from "./mock-contract";
